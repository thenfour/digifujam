'use strict';

const DF = require("./DFCommon");
const DFU = require('./dfutil');
const FM4OSC = require("./fm4oscillator");
const ADSR = require("./adhsr");
const DFSynthTools = require("./synthTools");

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

class MiniFMSynthVoice {
    constructor(audioCtx, instrumentSpec) {
        this.instrumentSpec = instrumentSpec;
        this.audioCtx = audioCtx;

        this.minGlideS = DF.ClientSettings.InstrumentParamIntervalMS / 1000;

        this.midiNote = 0;
        this.velocity = 0;

        this.oscillators = [
            new FM4OSC.MiniFMSynthOsc(audioCtx, instrumentSpec),
            new FM4OSC.MiniFMSynthOsc(audioCtx, instrumentSpec),
            new FM4OSC.MiniFMSynthOsc(audioCtx, instrumentSpec),
            new FM4OSC.MiniFMSynthOsc(audioCtx, instrumentSpec),
        ];

        this.modulationGainers = [];

        this.isConnected = false;

        this.nodes = {};
    }

    connect(lfo1, lfo2, dryDestination, verbDestination, delayDestination, algoSpec, pitchBendSemisNode, oscDetuneSemisMap, oscVariationMap) {
        if (this.isConnected) return;
        this.audioCtx.beginScope("voice");
        this.dryDestination = dryDestination;
        this.verbDestination = verbDestination;
        this.delayDestination = delayDestination;
        this.algoSpec = algoSpec;

        /*
          (pitchBendSemisNode)----->
          (oscDetuneSemisMap[i])--->
                      (lfos)------->                                                           > (dry)
                      [env1]------->[child oscillators] -->[oscSum]------> [filter] -----------> (verb)
                                                                           |    |              > (delay)
                                                                      freq |   | Q             
                                                         [filterFreqLFO1Amt]   [filterQLFO1Amt]
                                                        +[filterFreqLFO2Amt]   [filterQLFO2Amt]
                                                        +[filterFreqENVAmt]   [filterQENVAmt]

        */

        // env1
        this.nodes.env1 = ADSR.ADSRNode(this.audioCtx, { // https://github.com/velipso/adsrnode
            attack: this.instrumentSpec.GetParamByID("env1_a").currentValue,
            peak: 1.0,
            decay: this.instrumentSpec.GetParamByID("env1_d").currentValue,
            decayCurve: 3, // https://rawgit.com/voidqk/adsrnode/master/demo.html
            sustain: this.instrumentSpec.GetParamByID("env1_s").currentValue,
            release: this.instrumentSpec.GetParamByID("env1_r").currentValue,
            releaseCurve: 3,
        });
        this.nodes.env1.start();

        // oscSum
        this.nodes.oscSum = this.audioCtx.createGain("voice>master");
        this.nodes.oscSum.gain.value = 1;

        // filterFreqLFO1Amt
        this.nodes.filterFreqLFO1Amt = new DFSynthTools.OptimalGainer(this.audioCtx, "voice>filt");//this.audioCtx.createGain("voice>filt");
        this.nodes.filterFreqLFO1Amt.gain = this.instrumentSpec.GetParamByID("filterFreqLFO1").currentValue;
        this.nodes.filterFreqLFO1Amt.connectFrom(lfo1);

        // filterFreqLFO2Amt
        this.nodes.filterFreqLFO2Amt = new DFSynthTools.OptimalGainer(this.audioCtx, "voice>filt"); // this.audioCtx.createGain("voice>filt");
        this.nodes.filterFreqLFO2Amt.gain = this.instrumentSpec.GetParamByID("filterFreqLFO2").currentValue;
        this.nodes.filterFreqLFO2Amt.connectFrom(lfo2);

        // filterFreqENVAmt
        this.nodes.filterFreqENVAmt = new DFSynthTools.OptimalGainer(this.audioCtx, "voice>filt");// this.audioCtx.createGain("voice>filt");
        this.nodes.filterFreqENVAmt.gain = this.instrumentSpec.GetParamByID("filterFreqENV").currentValue;
        this.nodes.filterFreqENVAmt.connectFrom(this.nodes.env1);

        // filterQLFO1Amt
        this.nodes.filterQLFO1Amt = new DFSynthTools.OptimalGainer(this.audioCtx, "voice>filt");// this.audioCtx.createGain("voice>filt");
        this.nodes.filterQLFO1Amt.gain = this.instrumentSpec.GetParamByID("filterQLFO1").currentValue;
        this.nodes.filterQLFO1Amt.connectFrom(lfo1);

        // filterQLFO2Amt
        this.nodes.filterQLFO2Amt = new DFSynthTools.OptimalGainer(this.audioCtx, "voice>filt");// this.audioCtx.createGain("voice>filt");
        this.nodes.filterQLFO2Amt.gain = this.instrumentSpec.GetParamByID("filterQLFO2").currentValue;
        //lfo2.connect(this.nodes.filterQLFO2Amt);
        this.nodes.filterQLFO2Amt.connectFrom(lfo2);

        // filterQENVAmt
        this.nodes.filterQENVAmt = new DFSynthTools.OptimalGainer(this.audioCtx, "voice>filt");// this.audioCtx.createGain("voice>filt");
        this.nodes.filterQENVAmt.gain = this.instrumentSpec.GetParamByID("filterQENV").currentValue;
        //this.nodes.env1.connect(this.nodes.filterQENVAmt);
        this.nodes.filterQENVAmt.connectFrom(this.nodes.env1);

        // filter
        this.nodes.filter = this.audioCtx.createBiquadFilter("voice>filt");
        // type set later.
        this.nodes.filter.frequency.value = this.instrumentSpec.GetParamByID("filterFreq").currentValue;
        this.nodes.filter.Q.value = this.instrumentSpec.GetParamByID("filterQ").currentValue;

        this.nodes.filterFreqLFO1Amt.connect(this.nodes.filter.frequency);
        this.nodes.filterFreqLFO2Amt.connect(this.nodes.filter.frequency);
        this.nodes.filterFreqENVAmt.connect(this.nodes.filter.frequency);

        this.nodes.filterQLFO1Amt.connect(this.nodes.filter.Q);
        this.nodes.filterQLFO2Amt.connect(this.nodes.filter.Q);
        this.nodes.filterQENVAmt.connect(this.nodes.filter.Q);

        // connect oscillators
        this.oscLinkSpec = this.instrumentSpec.getOscLinkingSpec();
        algoSpec.oscEnabled.forEach((e, i) => {
            if (!e) return;
            // param prefixes are like "osc0_"
            const paramPrefix = `osc${this.oscLinkSpec.sources[i]}_`;
            //console.log(`paramPrefix: ${paramPrefix}`);
            this.oscillators[i].connect(lfo1, lfo2, this.nodes.env1, pitchBendSemisNode, oscDetuneSemisMap[i], paramPrefix, oscVariationMap[i]);
        });

        let mod = (src, dest) => {
            if (!src.isConnected) return;
            if (!dest.isConnected) return;

            let m0 = this.audioCtx.createGain("voice>mod");
            this.modulationGainers.push(m0);
            m0.gain.value = 20000;

            // 0 => 1
            src.outputNode.connect(m0);
            m0.connect(dest.inputNode.frequency);
        };

        let out = (osc) => {
            if (!osc.isConnected) return;
            osc.outputNode.connect(this.nodes.oscSum);
        };

        // and make the FM matrix connections
        let algo = parseInt(this.instrumentSpec.GetParamByID("algo").currentValue);
        switch (algo) {
            case 0: // "[1🡄2🡄3🡄4]",
                mod(this.oscillators[3], this.oscillators[2]);
                mod(this.oscillators[2], this.oscillators[1]);
                mod(this.oscillators[1], this.oscillators[0]);
                break;
            case 1: // "[1🡄2🡄3][4]",
                out(this.oscillators[3]);
                mod(this.oscillators[2], this.oscillators[1]);
                mod(this.oscillators[1], this.oscillators[0]);
                break;
            case 2: // "[1🡄(2+3)] [4]"
                mod(this.oscillators[1], this.oscillators[0]);
                mod(this.oscillators[2], this.oscillators[0]);
                out(this.oscillators[3]);
                break;
            case 3: // "[1🡄(2+3+4)]"
                mod(this.oscillators[1], this.oscillators[0]);
                mod(this.oscillators[2], this.oscillators[0]);
                mod(this.oscillators[3], this.oscillators[0]);
                break;
            case 4: // "[1🡄2🡄(3+4)]"
                mod(this.oscillators[2], this.oscillators[1]);
                mod(this.oscillators[3], this.oscillators[1]);
                mod(this.oscillators[1], this.oscillators[0]);
                break;

            case 5: // "[1🡄2][3🡄4]",
                mod(this.oscillators[3], this.oscillators[2]);
                out(this.oscillators[2]);
                mod(this.oscillators[1], this.oscillators[0]);
                break;
            case 6: // "[1🡄2][3][4]",
                out(this.oscillators[3]);
                out(this.oscillators[2]);
                mod(this.oscillators[1], this.oscillators[0]);
                break;
            case 7: // "[1][2][3][4]"
                out(this.oscillators[3]);
                out(this.oscillators[2]);
                out(this.oscillators[1]);
                break;

            default:
                console.warn(`unknown FM algorithm ${algo}`);
                break;
        }
        out(this.oscillators[0]);

        // connect to outside.
        this._SetFiltType();

        this.audioCtx.endScope("voice");
        this.isConnected = true;
    }

    disconnect() {
        this.AllNotesOff();
        if (!this.isConnected) return;

        Object.keys(this.nodes).forEach(k => {
            let n = this.nodes[k];
            if (n.stop) n.stop();
            n.disconnect();
        });
        this.nodes = {};

        this.oscillators.forEach(o => o.disconnect());

        this.modulationGainers.forEach(m => {
            m.disconnect();
        });
        this.modulationGainers = [];

        this.isConnected = false;
    }

    _SetFiltType() {
        let disableFilter = () => {
            // [oscSum]---------> (verbdest)
            //                  > (drydest)
            //                  > (delaydest)
            this.nodes.filter.disconnect();
            ///console.log(`disabling filter`);

            this.nodes.oscSum.disconnect();
            this.nodes.oscSum.connect(this.dryDestination);
            this.nodes.oscSum.connect(this.verbDestination);
            this.nodes.oscSum.connect(this.delayDestination);

            this.isFilterConnected = false;
        };
        let enableFilter = () => {
            // [oscSum]------> [filter] -----------> (wetdest)
            //                                     > (drydest)
            //console.log(`enabling filter`);

            this.nodes.oscSum.disconnect();
            this.nodes.oscSum.connect(this.nodes.filter);

            this.nodes.filter.disconnect();
            this.nodes.filter.connect(this.dryDestination);
            this.nodes.filter.connect(this.verbDestination);
            this.nodes.filter.connect(this.delayDestination);

            this.isFilterConnected = true;
        };
        switch (parseInt(this.instrumentSpec.GetParamByID("filterType").currentValue)) {
            case 0: // off
                disableFilter();
                return;
            case 1:
                enableFilter();
                this.nodes.filter.type = "lowpass";
                return;
            case 2:
                enableFilter();
                this.nodes.filter.type = "highpass";
                return;
            case 3:
                enableFilter();
                this.nodes.filter.type = "bandpass";
                return;
        }
        console.warn(`unknown filter type ${this.instrumentSpec.GetParamByID("filterType").currentValue}`);
    }

    get IsPlaying() {
        if (!this.isConnected) return false;
        if (!this.midiNote) return false;
        return this.oscillators.some(o => o.IsPlaying);
    }


    _updateFilterBaseFreq() {
        let vsAmt = this.instrumentSpec.GetParamByID("filterFreqVS").currentValue;
        let vs = 1.0 - DFU.remap(this.velocity, 0.0, 128.0, vsAmt, -vsAmt); // when vsAmt is 0, the range of vsAmt,-vsAmt is 0. hence making this 1.0-x
        let ksAmt = this.instrumentSpec.GetParamByID("filterFreqKS").currentValue;
        const halfKeyScaleRangeSemis = 12 * 4;
        let ks = 1.0 - DFU.remap(this.midiNote, 60.0 /* middle C */ - halfKeyScaleRangeSemis, 60.0 + halfKeyScaleRangeSemis, ksAmt, -ksAmt); // when vsAmt is 0, the range of vsAmt,-vsAmt is 0. hence making this 1.0-x
        let p = this.instrumentSpec.GetParamByID("filterFreq").currentValue;
        p = p * ks * vs;
        //console.log(`filter freq: ${p}`);

        const freqParam = this.nodes.filter.frequency;
        freqParam.value = DFU.baseClamp(p, freqParam.minValue, freqParam.maxValue);//, this.audioCtx.currentTime + this.minGlideS);
    }

    SetParamValue(paramID, newVal) {
        if (!this.isConnected) return;
        //console.log(`setting ${paramID} to ${newVal}`);
        if (paramID.startsWith("osc")) {
            let oscid = parseInt(paramID[3]);
            let strippedParamID = paramID.substring(5);
            // send param change to all oscillators that depend on this value.
            this.oscLinkSpec.sources.forEach((masterOscIndex, dependentOscIndex) => {
                if (masterOscIndex == oscid) {
                    if (this.oscillators[dependentOscIndex].isConnected) {
                        this.oscillators[dependentOscIndex].SetParamValue(strippedParamID, newVal);
                    }
                }
            });
            return;
        }
        switch (paramID) {
            case "pan_spread":
                this.oscillators.forEach(osc => {
                    if (osc.isConnected) {
                        osc.SetParamValue("pan", newVal);
                    }
                });
                break;
            case "filterType":
                this._SetFiltType();
                break;
            case "filterFreqVS":
            case "filterFreqKS":
            case "filterFreq":
                this._updateFilterBaseFreq();
                break;
            case "filterQ":
                this.nodes.filter.Q.value = newVal;
                break;
            case "filterFreqLFO1":
                this.nodes.filterFreqLFO1Amt.gain = newVal;
                break;
            case "filterFreqLFO2":
                this.nodes.filterFreqLFO2Amt.gain = newVal;
                break;
            case "filterFreqENV":
                this.nodes.filterFreqENVAmt.gain = newVal;
                break;
            case "filterQLFO1":
                this.nodes.filterQLFO1Amt.gain = newVal;
                break;
            case "filterQLFO2":
                this.nodes.filterQLFO2Amt.gain = newVal;
                break;
            case "filterQENV":
                this.nodes.filterQENVAmt.gain = newVal;
                break;
            case "env1_s":
                this.nodes.env1.update({ sustain: newVal });
                break;
            case "env1_a":
                this.nodes.env1.update({ attack: newVal });
                break;
            case "env1_d":
                this.nodes.env1.update({ decay: newVal });
                break;
            case "env1_r":
                this.nodes.env1.update({ release: newVal });
                break;
        }
    }


    physicalAndMusicalNoteOn(midiNote, velocity, isLegato) {
        this.timestamp = new Date();
        this.midiNote = midiNote;
        this.velocity = velocity;

        let baseFreq = DFU.MidiNoteToFrequency(midiNote);

        this._updateFilterBaseFreq();

        let isPoly = this.instrumentSpec.GetParamByID("voicing").currentValue == 1;
        if (isPoly || !isLegato || (this.instrumentSpec.GetParamByID("env1_trigMode").currentValue == 0)) {
            //  env keytracking
            let vsAmt = this.instrumentSpec.GetParamByID("env1_vel_scale").currentValue; // -1 to 1
            let vs = 1.0 - DFU.remap(this.velocity, 0.0, 127.0, vsAmt, -vsAmt); // when vsAmt is 0, the range of vsAmt,-vsAmt is 0. hence making this 1.0-x
            this.nodes.env1.update({
                peak: vs,
                sustain: vs * this.instrumentSpec.GetParamByID("env1_s").currentValue
            });
            this.nodes.env1.trigger();
        }
        this.oscillators.forEach(o => {
            if (!o.isConnected) return;
            o.noteOn(midiNote, velocity, isLegato, baseFreq);
        });
    }

    musicallyRelease(midiNote) {
        // it's possible you get note off events when you haven't note-on, in case of holding multiple monophonic keys, for example.
        // or in that case you can even get note off events for notes we're not playing. if it doesn't match, don't note off.
        if (midiNote != this.midiNote) {
            //console.log(`midi note ${midiNote} doesn't match mine ${this.midiNote}`);
            return;
        }
        if (!this.timestamp) {
            return; // some odd synth state can cause releases without note ons (pedal up after taking the instrument for example)
        }

        this.nodes.env1.release();
        this.oscillators.forEach(o => {
            if (!o.isConnected) return;
            o.release();
        });

        this.timestamp = null;
        this.noteOffTimestamp = new Date();
        this.midiNote = 0;
        this.velocity = 0;
    }

    AllNotesOff() {
        this.oscillators.forEach(o => {
            o.AllNotesOff();
        });
        this.midiNote = 0;
        this.timestamp = null;
        this.noteOffTimestamp = null;
        this.velocity = 0;
    }

};


module.exports = {
    MiniFMSynthVoice,
};

