'use strict';


//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

class MiniFMSynthVoice {
    constructor(audioCtx, instrumentSpec) {
        this.instrumentSpec = instrumentSpec;
        this.audioCtx = audioCtx;

        this.minGlideS = ClientSettings.InstrumentParamIntervalMS / 1000;

        this.midiNote = 0;
        this.velocity = 0;

        this.oscillators = [
            new MiniFMSynthOsc(audioCtx, instrumentSpec),
            new MiniFMSynthOsc(audioCtx, instrumentSpec),
            new MiniFMSynthOsc(audioCtx, instrumentSpec),
            new MiniFMSynthOsc(audioCtx, instrumentSpec),
        ];

        this.modulationGainers = [];

        this.isConnected = false;

        this.nodes = {};
    }

    connect(lfo1, lfo1_01, lfo2, lfo2_01, dryDestination, wetDestination, algoSpec, pitchBendSemisNode, oscDetuneSemisMap) {
        if (this.isConnected) return;
        this.dryDestination = dryDestination;
        this.wetDestination = wetDestination;
        this.algoSpec = algoSpec;

        /*
          (pitchBendSemisNode)----->
          (oscDetuneSemisMap[i])--->
                      (lfos)------->
                      [env1]------->[child oscillators] -->[oscSum]------> [filter] -----------> (wetdest)
                                                                           |    |              > (drydest)
                                                                      freq |   | Q
                                                         [filterFreqLFO1Amt]   [filterQLFO1Amt]
                                                        +[filterFreqLFO2Amt]   [filterQLFO2Amt]
                                                        +[filterFreqENVAmt]   [filterQENVAmt]

        */

        // env1
        this.nodes.env1 = ADSRNode(this.audioCtx, { // https://github.com/velipso/adsrnode
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
        this.nodes.oscSum = this.audioCtx.createGain();
        this.nodes.oscSum.gain.value = 1;

        // filterFreqLFO1Amt
        this.nodes.filterFreqLFO1Amt = this.audioCtx.createGain();
        this.nodes.filterFreqLFO1Amt.gain.value = this.instrumentSpec.GetParamByID("filterFreqLFO1").currentValue;
        lfo1.connect(this.nodes.filterFreqLFO1Amt);

        // filterFreqLFO2Amt
        this.nodes.filterFreqLFO2Amt = this.audioCtx.createGain();
        this.nodes.filterFreqLFO2Amt.gain.value = this.instrumentSpec.GetParamByID("filterFreqLFO2").currentValue;
        lfo2.connect(this.nodes.filterFreqLFO2Amt);

        // filterFreqENVAmt
        this.nodes.filterFreqENVAmt = this.audioCtx.createGain();
        this.nodes.filterFreqENVAmt.gain.value = this.instrumentSpec.GetParamByID("filterFreqENV").currentValue;
        this.nodes.env1.connect(this.nodes.filterFreqENVAmt);

        // filterQLFO1Amt
        this.nodes.filterQLFO1Amt = this.audioCtx.createGain();
        this.nodes.filterQLFO1Amt.gain.value = this.instrumentSpec.GetParamByID("filterQLFO1").currentValue;
        lfo1.connect(this.nodes.filterQLFO1Amt);

        // filterQLFO2Amt
        this.nodes.filterQLFO2Amt = this.audioCtx.createGain();
        this.nodes.filterQLFO2Amt.gain.value = this.instrumentSpec.GetParamByID("filterQLFO2").currentValue;
        lfo2.connect(this.nodes.filterQLFO2Amt);

        // filterQENVAmt
        this.nodes.filterQENVAmt = this.audioCtx.createGain();
        this.nodes.filterQENVAmt.gain.value = this.instrumentSpec.GetParamByID("filterQENV").currentValue;
        this.nodes.env1.connect(this.nodes.filterQENVAmt);

        // filter
        this.nodes.filter = this.audioCtx.createBiquadFilter();
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
            this.oscillators[i].connect(lfo1, lfo1_01, lfo2, lfo2_01, this.nodes.env1, pitchBendSemisNode, oscDetuneSemisMap[i], paramPrefix);
        });

        let mod = (src, dest) => {
            if (!src.isConnected) return;
            if (!dest.isConnected) return;

            let m0 = this.audioCtx.createGain();
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
            // [oscSum]---------> (wetdest)
            //                  > (drydest)
            this.nodes.filter.disconnect();
            ///console.log(`disabling filter`);

            this.nodes.oscSum.disconnect();
            this.nodes.oscSum.connect(this.dryDestination);
            this.nodes.oscSum.connect(this.wetDestination);

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
            this.nodes.filter.connect(this.wetDestination);

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
        return this.oscillators.some(o => o.IsPlaying);
    }


    _updateFilterBaseFreq() {
        let vsAmt = this.instrumentSpec.GetParamByID("filterFreqVS").currentValue;
        let vs = 1.0 - remap(this.velocity, 0.0, 128.0, vsAmt, -vsAmt); // when vsAmt is 0, the range of vsAmt,-vsAmt is 0. hence making this 1.0-x
        let ksAmt = this.instrumentSpec.GetParamByID("filterFreqKS").currentValue;
        const halfKeyScaleRangeSemis = 12 * 4;
        let ks = 1.0 - remap(this.midiNote, 60.0 /* middle C */ - halfKeyScaleRangeSemis, 60.0 + halfKeyScaleRangeSemis, ksAmt, -ksAmt); // when vsAmt is 0, the range of vsAmt,-vsAmt is 0. hence making this 1.0-x
        let p = this.instrumentSpec.GetParamByID("filterFreq").currentValue;
        p = p * ks * vs;
        //console.log(`filter freq: ${p}`);
        this.nodes.filter.frequency.value = p;//, this.audioCtx.currentTime + this.minGlideS);
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
            case "filterType":
                this._SetFiltType();
                break;
            case "filterFreqVS":
            case "filterFreqKS":
            case "filterFreq":
                this._updateFilterBaseFreq();
                break;
            case "filterQ":
                this.nodes.filter.Q.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "filterFreqLFO1":
                this.nodes.filterFreqLFO1Amt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "filterFreqLFO2":
                this.nodes.filterFreqLFO2Amt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "filterFreqENV":
                this.nodes.filterFreqENVAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "filterQLFO1":
                this.nodes.filterQLFO1Amt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "filterQLFO2":
                this.nodes.filterQLFO2Amt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "filterQENV":
                this.nodes.filterQENVAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
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

        let baseFreq = MidiNoteToFrequency(midiNote);

        this._updateFilterBaseFreq();

        let isPoly = this.instrumentSpec.GetParamByID("voicing").currentValue == 1;
        if (isPoly || !isLegato || (this.instrumentSpec.GetParamByID("env1_trigMode").currentValue == 0)) {
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
