'use strict';


//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

class MiniFMSynthVoice {
    constructor(audioCtx, dryDestination, wetDestination, instrumentSpec) {
        this.instrumentSpec = instrumentSpec;
        this.audioCtx = audioCtx;
        this.dryDestination = dryDestination;
        this.wetDestination = wetDestination;

        this.minGlideS = ClientSettings.InstrumentParamIntervalMS / 1000;

        this.midiNote = 0;
        this.velocity = 0;

        this.oscillators = [
            new MiniFMSynthOsc(audioCtx, instrumentSpec, "osc0_"),
            new MiniFMSynthOsc(audioCtx, instrumentSpec, "osc1_"),
            new MiniFMSynthOsc(audioCtx, instrumentSpec, "osc2_"),
            new MiniFMSynthOsc(audioCtx, instrumentSpec, "osc3_"),
        ];

        this.modulationGainers = [];

        this.isFilterConnected = false;
        this.isConnected = false;
    }

    connect(lfo1, lfo1_01, lfo2, lfo2_01) {
        if (this.isConnected) return;
        this.lfo1 = lfo1;
        this.lfo1_01 = lfo1_01;
        this.lfo2 = lfo2;
        this.lfo2_01 = lfo2_01;

        /*
          (lfos)------->
          [env1]------->[child oscillators] -->[oscSum]--> [waveshapeGain] --> [waveshape]-[waveshapePostGain]--------> [filter] -----------> [masterDryGain]
                                                                                                                        |    |              > [masterWetGain]
                                                                                                                   freq |   | Q
                                                                                                      [filterFreqLFO1Amt]   [filterQLFO1Amt]
                                                                                                     +[filterFreqLFO2Amt]   [filterQLFO2Amt]
                                                                                                     +[filterFreqENVAmt]   [filterQENVAmt]


            so detune is slightly tricky, because it should be controlled at the voice level.
            it depends on the FM algorithm as well. if A modulates B, then detune them both the same.
            and it depends how many oscillator groups there are.
            1 oscillator group = no detuning possible.
            2 oscillator groups = +detune, -detune
            3 oscillator groups = +detune, 0, -detune
            4 oscillator groups = +detune, +detune*.5, -detune*.5, -detune

     [detuneLFO1amt]                 
    +[detuneLFO2amt] --> [detuneSemis] -->[detuneSemisToFreq] -----------------------> [detuneFreq]----------------------> (osc group x)
    +[detuneENVamt]         +[midiNoteNode]-^                                     |                -->[detuneVar1]------> (osc group x)
    +[detuneBase]                          -->[midiNoteFreq]-->[midiNoteFreqInv]--                 -->[detuneVar2]------> (osc group x)
                                                                                                   -->[detuneVar3]------> (osc group x)
        */

        // env1
        this.env1 = ADSRNode(this.audioCtx, { // https://github.com/velipso/adsrnode
            attack: this.instrumentSpec.GetParamByID("env1_a").currentValue,
            peak: 1.0,
            decay: this.instrumentSpec.GetParamByID("env1_d").currentValue,
            decayCurve: 3, // https://rawgit.com/voidqk/adsrnode/master/demo.html
            sustain: this.instrumentSpec.GetParamByID("env1_s").currentValue,
            release: this.instrumentSpec.GetParamByID("env1_r").currentValue,
            releaseCurve: 3,
        });
        this.env1.start();

        // oscSum
        this.oscSum = this.audioCtx.createGain();
        this.oscSum.gain.value = 1;

        // waveshapeGain
        this.waveshapeGain = this.audioCtx.createGain();
        const waveshapeGainValue = this.instrumentSpec.GetParamByID("waveShape_gain").currentValue;
        this.waveshapeGain.gain.value = waveshapeGainValue;
        this.oscSum.connect(this.waveshapeGain);

        // waveshape
        this.waveshape = this.audioCtx.createWaveShaper();
        this.waveshapeGain.connect(this.waveshape);
        this._setWaveshapeCurve();

        // waveshapePostGain
        this.waveshapePostGain = this.audioCtx.createGain();
        this.waveshapePostGain.gain.value = 1.0 / Math.max(0.01, waveshapeGainValue);
        this.waveshape.connect(this.waveshapePostGain);

        // filterFreqLFO1Amt
        this.filterFreqLFO1Amt = this.audioCtx.createGain();
        this.filterFreqLFO1Amt.gain.value = this.instrumentSpec.GetParamByID("filterFreqLFO1").currentValue;
        this.lfo1.connect(this.filterFreqLFO1Amt);

        // filterFreqLFO2Amt
        this.filterFreqLFO2Amt = this.audioCtx.createGain();
        this.filterFreqLFO2Amt.gain.value = this.instrumentSpec.GetParamByID("filterFreqLFO2").currentValue;
        this.lfo2.connect(this.filterFreqLFO2Amt);

        // filterFreqENVAmt
        this.filterFreqENVAmt = this.audioCtx.createGain();
        this.filterFreqENVAmt.gain.value = this.instrumentSpec.GetParamByID("filterFreqENV").currentValue;
        this.env1.connect(this.filterFreqENVAmt);

        // filterQLFO1Amt
        this.filterQLFO1Amt = this.audioCtx.createGain();
        this.filterQLFO1Amt.gain.value = this.instrumentSpec.GetParamByID("filterQLFO1").currentValue;
        this.lfo1.connect(this.filterQLFO1Amt);

        // filterQLFO2Amt
        this.filterQLFO2Amt = this.audioCtx.createGain();
        this.filterQLFO2Amt.gain.value = this.instrumentSpec.GetParamByID("filterQLFO2").currentValue;
        this.lfo2.connect(this.filterQLFO2Amt);

        // filterQENVAmt
        this.filterQENVAmt = this.audioCtx.createGain();
        this.filterQENVAmt.gain.value = this.instrumentSpec.GetParamByID("filterQENV").currentValue;
        this.env1.connect(this.filterQENVAmt);

        // filter
        this.filter = this.audioCtx.createBiquadFilter();
        // type set later.
        this.filter.frequency.value = this.instrumentSpec.GetParamByID("filterFreq").currentValue;
        this.filter.Q.value = this.instrumentSpec.GetParamByID("filterQ").currentValue;

        this.filterFreqLFO1Amt.connect(this.filter.frequency);
        this.filterFreqLFO2Amt.connect(this.filter.frequency);
        this.filterFreqENVAmt.connect(this.filter.frequency);

        this.filterQLFO1Amt.connect(this.filter.Q);
        this.filterQLFO2Amt.connect(this.filter.Q);
        this.filterQENVAmt.connect(this.filter.Q);

        this.waveshapePostGain.connect(this.filter);

        this.isFilterConnected = true;

        // masterDryGain
        this.masterDryGain = this.audioCtx.createGain();
        this.filter.connect(this.masterDryGain);

        // masterWetGain
        this.masterWetGain = this.audioCtx.createGain();
        this.filter.connect(this.masterWetGain);

        let gainLevels = this.getGainLevels();
        this.masterDryGain.gain.value = gainLevels[0];
        this.masterWetGain.gain.value = gainLevels[1];


        // SET UP DETUNE GRAPH

        // detuneLFO1amt
        this.detuneLFO1amt = this.audioCtx.createGain();
        this.detuneLFO1amt.gain.value = this.instrumentSpec.GetParamByID("detuneLFO1").currentValue;
        this.lfo1.connect(this.detuneLFO1amt);

        // detuneLFO2amt
        this.detuneLFO2amt = this.audioCtx.createGain();
        this.detuneLFO2amt.gain.value = this.instrumentSpec.GetParamByID("detuneLFO2").currentValue;
        this.lfo2.connect(this.detuneLFO2amt);

        // detuneENVamt
        this.detuneENVamt = this.audioCtx.createGain();
        this.detuneENVamt.gain.value = this.instrumentSpec.GetParamByID("detuneENV1").currentValue;
        this.env1.connect(this.detuneENVamt);

        // detuneBase
        this.detuneBase = this.audioCtx.createConstantSource();
        this.detuneBase.start();
        this.detuneBase.offset.value = this.instrumentSpec.GetParamByID("detuneBase").currentValue;

        // detuneSemis
        this.detuneSemis = this.audioCtx.createGain();
        this.detuneSemis.gain.value = 1.0;// constant; this just sums up detune semis values.
        this.detuneBase.connect(this.detuneSemis);
        this.detuneLFO1amt.connect(this.detuneSemis);
        this.detuneLFO2amt.connect(this.detuneSemis);
        this.detuneENVamt.connect(this.detuneSemis);

        // midiNoteNode
        this.midiNoteNode = this.audioCtx.createConstantSource();
        this.midiNoteNode.start();
        this.midiNoteNode.offset.value = 0;

        // detuneSemisToFreq
        this.detuneSemisToFreq = this.audioCtx.createMidiNoteToFrequencyNode();
        this.midiNoteNode.connect(this.detuneSemisToFreq);
        this.detuneSemis.connect(this.detuneSemisToFreq);

        // midiNoteFreq
        this.midiNoteFreq = this.audioCtx.createMidiNoteToFrequencyNode();
        this.midiNoteNode.connect(this.midiNoteFreq);

        // midiNoteFreqInv
        this.midiNoteFreqInv = this.audioCtx.createGain();
        this.midiNoteFreqInv.gain.value = -1.0;
        this.midiNoteFreq.connect(this.midiNoteFreqInv);

        // detuneFreq
        this.detuneFreq = this.audioCtx.createGain();
        this.detuneFreq.gain.value = 1.0; // constant
        this.midiNoteFreqInv.connect(this.detuneFreq);
        this.detuneSemisToFreq.connect(this.detuneFreq);

        // detuneVar1
        this.detuneVar1 = this.audioCtx.createGain();
        this.detuneVar1.gain.value = 1.0;// set later in setting up algo.
        this.detuneFreq.connect(this.detuneVar1);

        // detuneVar2
        this.detuneVar2 = this.audioCtx.createGain();
        this.detuneVar2.gain.value = 1.0;// set later in setting up algo.
        this.detuneFreq.connect(this.detuneVar2);

        // detuneVar3
        this.detuneVar3 = this.audioCtx.createGain();
        this.detuneVar3.gain.value = 1.0;// set later in setting up algo.
        this.detuneFreq.connect(this.detuneVar3);

        // set up algo
        let algo = parseInt(this.instrumentSpec.GetParamByID("algo").currentValue);

        const algoSpec = this.instrumentSpec.GetFMAlgoSpec();

        // console.log(`=======applying detune stuff`);
        // console.log(algoSpec.oscGroups);

        let applyDetune = (oscGroup, detuneSrc) => {
            algoSpec.oscGroups[oscGroup].forEach(oscIndex => {
                if (algoSpec.oscEnabled[oscIndex]) {
                    this.oscillators[oscIndex].connect(lfo1, lfo1_01, lfo2, lfo2_01, this.env1, detuneSrc);
                }
            });
        };

        // detuneFreq is always the "+1" detune value
        // use detuneVar1, 2, 3 for variations of this, including "0" for center if needed.
        switch (algoSpec.oscGroups.length) {
            case 0:
                break; // nothing to do.
            case 1:
                this.detuneVar1.gain.value = 0; // no detuning, single osc group. give all oscillators the same "0" detune value.
                applyDetune(0, this.detuneVar1);
                break;
            case 2:
                this.detuneVar1.gain.value = -1; // 2 osc groups = + and - detune amt
                applyDetune(0, this.detuneFreq);
                applyDetune(1, this.detuneVar1);
                break;
            case 3:
                this.detuneVar1.gain.value = -1; // 3 osc groups = +, 0, - detune amt
                this.detuneVar2.gain.value = 0;
                applyDetune(0, this.detuneVar2);
                applyDetune(1, this.detuneVar1);
                applyDetune(2, this.detuneFreq);
                break;
            case 4:
                this.detuneVar1.gain.value = 0.5; // 4 oscillator groups = +detune, +detune*.5, -detune*.5, -detune
                this.detuneVar2.gain.value = -0.5;
                this.detuneVar3.gain.value = -1;
                applyDetune(0, this.detuneVar1);
                applyDetune(1, this.detuneVar2);
                applyDetune(2, this.detuneFreq);
                applyDetune(3, this.detuneVar3);
                break;
            default:
                console.warn(`invalid osc tuning group amt`);
                break;
        }

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
            osc.outputNode.connect(this.oscSum);
        };

        // and make the FM matrix connections
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
        this.masterDryGain.connect(this.dryDestination);
        this.masterWetGain.connect(this.wetDestination);

        this._SetFiltType();

        this.isConnected = true;
    }

    disconnect() {
        this.AllNotesOff();
        if (!this.isConnected) return;
        this.lfo1 = null;
        this.lfo1_01 = null;
        this.lfo2 = null;
        this.lfo2_01 = null;

        this.oscSum.disconnect();
        this.oscSum = null;

        this.filterFreqLFO1Amt.disconnect();
        this.filterFreqLFO1Amt = null;

        this.filterFreqLFO2Amt.disconnect();
        this.filterFreqLFO2Amt = null;

        this.filterFreqENVAmt.disconnect();
        this.filterFreqENVAmt = null;

        this.filterQLFO1Amt.disconnect();
        this.filterQLFO1Amt = null;

        this.filterQLFO2Amt.disconnect();
        this.filterQLFO2Amt = null;

        this.filterQENVAmt.disconnect();
        this.filterQENVAmt = null;

        this.filter.disconnect();
        this.filter = null;

        this.masterDryGain.disconnect();
        this.masterDryGain = null;

        this.masterWetGain.disconnect();
        this.masterWetGain = null;

        this.env1.stop();
        this.env1.disconnect();
        this.env1 = null;


        this.detuneBase.stop();
        this.midiNoteNode.stop();

        this.detuneLFO1amt.disconnect();
        this.detuneLFO1amt = null;
        this.detuneLFO2amt.disconnect();
        this.detuneLFO2amt = null;
        this.detuneENVamt.disconnect();
        this.detuneENVamt = null;
        this.detuneBase.disconnect();
        this.detuneBase = null;
        this.detuneFreq.disconnect();
        this.detuneFreq = null;
        this.detuneVar1.disconnect();
        this.detuneVar1 = null;
        this.detuneVar2.disconnect();
        this.detuneVar2 = null;
        this.detuneVar3.disconnect();
        this.detuneVar3 = null;


        this.detuneSemis.disconnect();
        this.detuneSemis = null;
        this.detuneSemisToFreq.disconnect();
        this.detuneSemisToFreq = null;
        this.midiNoteNode.disconnect();
        this.midiNoteNode = null;
        this.midiNoteFreq.disconnect();
        this.midiNoteFreq = null;
        this.midiNoteFreqInv.disconnect();
        this.midiNoteFreqInv = null;

        this.waveshapePostGain.disconnect();
        this.waveshapePostGain = null;

        this.waveshape.disconnect();
        this.waveshape = null;
        this.waveshapeGain.disconnect();
        this.waveshapeGain = null;

        this.oscillators.forEach(o => o.disconnect());

        this.modulationGainers.forEach(m => {
            m.disconnect();
        });
        this.modulationGainers = [];

        this.isConnected = false;
    }

    _SetFiltType() {
        let disableFilter = () => {
            if (!this.isFilterConnected) return;
            // waveshapePostGain] --> [masterDryGain
            //                      > [masterWetGain
            this.filter.disconnect();

            this.waveshapePostGain.disconnect();
            this.waveshapePostGain.connect(this.masterDryGain);
            this.waveshapePostGain.connect(this.masterWetGain);

            this.isFilterConnected = false;
        };
        let enableFilter = () => {
            if (this.isFilterConnected) return;
            this.waveshapePostGain.disconnect();
            this.waveshapePostGain.connect(this.filter);

            this.filter.disconnect();
            this.filter.connect(this.masterDryGain);
            this.filter.connect(this.masterWetGain);

            this.isFilterConnected = true;
        };
        switch (parseInt(this.instrumentSpec.GetParamByID("filterType").currentValue)) {
            case 0: // off
                disableFilter();
                return;
            case 1:
                enableFilter();
                this.filter.type = "lowpass";
                return;
            case 2:
                enableFilter();
                this.filter.type = "highpass";
                return;
            case 3:
                enableFilter();
                this.filter.type = "bandpass";
                return;
        }
        console.assert(false, `unknown filter type ${this.instrumentSpec.GetParamByID("filterType").currentValue}`);
    }

    // returns [drygain, wetgain]
    getGainLevels() {
        let ms = this.instrumentSpec.GetParamByID("masterGain").currentValue;
        let vg = this.instrumentSpec.GetParamByID("verbMix").currentValue;
        // when verb mix is 0, drygain is the real master gain.
        // when verb mix is 1, drygain is 0 and verbmix is mastergain
        return [(1.0 - vg) * ms, vg * ms * 1.];
    }

    get IsPlaying() {
        if (!this.isConnected) return false;
        return this.oscillators.some(o => o.IsPlaying);
    }

    _setWaveshapeCurve() {
        // https://stackoverflow.com/a/52472603/402169

        if (!this.instrumentSpec.GetParamByID("waveShape_enabled").currentValue) {
            this.waveshape.curve = null;
            return;
        }

        // x is -1 to 1, a is 0-1
        let transf = (x, a) => {
            let s = Math.sin(x / 2 * Math.PI); // a sine curve from 0-1
            a *= 3;
            let c = a * s + (1 - a) * x; // blend between linear & sine.
            let t = Math.sin(c * Math.PI / 2);// when a is >1, clipping occurs; this "folds" back.
            if (a < 1) {
                // but we want 0 to be linear, so blend between linear & folded for lower values.
                t = a * t + (1 - a) * x;
            }
            return t;
        };

        let makeDistortionCurve = (amt) => {
            let n_samples = 256, curve = new Float32Array(n_samples);
            for (let i = 0; i < n_samples; ++i) {
                let x = i * 2 / n_samples - 1;
                //curve[i] = Math.sign(x)*(1-0.25/(Math.abs(x)+0.25));// http://www.carbon111.com/waveshaping1.html
                curve[i] = transf(x, amt);
            }
            return curve;
        };

        this.waveshape.curve = makeDistortionCurve(this.instrumentSpec.GetParamByID("waveShape_curve").currentValue);
    }

    _updateFilterBaseFreq() {
        let vsAmt = this.instrumentSpec.GetParamByID("filterFreqVS").currentValue;
        let vs = 1.0 - remap(this.velocity, 0.0, 128.0, vsAmt, -vsAmt); // when vsAmt is 0, the range of vsAmt,-vsAmt is 0. hence making this 1.0-x
        let ksAmt = this.instrumentSpec.GetParamByID("filterFreqKS").currentValue;
        const halfKeyScaleRangeSemis = 12 * 4;
        let ks = 1.0 - remap(this.midiNote, 60.0 /* middle C */ - halfKeyScaleRangeSemis, 60.0 + halfKeyScaleRangeSemis, ksAmt, -ksAmt); // when vsAmt is 0, the range of vsAmt,-vsAmt is 0. hence making this 1.0-x
        let p = this.instrumentSpec.GetParamByID("filterFreq").currentValue;
        p = p * ks * vs;
        this.filter.frequency.linearRampToValueAtTime(p, this.audioCtx.currentTime + this.minGlideS);
    }

    SetParamValue(paramID, newVal) {
        if (!this.isConnected) return;
        //console.log(`setting ${paramID} to ${newVal}`);
        if (paramID.startsWith("osc")) {
            let oscid = parseInt(paramID[3]);
            if (this.oscillators[oscid].isConnected) {
                this.oscillators[oscid].SetParamValue(paramID.substring(5), newVal);
            }
            return;
        }
        switch (paramID) {
            case "pb":
                this.PitchBend(newVal);
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
                this.filter.Q.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "filterFreqLFO1":
                this.filterFreqLFO1Amt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "filterFreqLFO2":
                this.filterFreqLFO2Amt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "filterFreqENV":
                this.filterFreqENVAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "filterQLFO1":
                this.filterQLFO1Amt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "filterQLFO2":
                this.filterQLFO2Amt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "filterQENV":
                this.filterQENVAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "masterGain":
            case "verbMix":
                let levels = this.getGainLevels();
                this.masterDryGain.gain.linearRampToValueAtTime(levels[0], this.audioCtx.currentTime + this.minGlideS);
                this.masterWetGain.gain.linearRampToValueAtTime(levels[1], this.audioCtx.currentTime + this.minGlideS);
                break;
            case "enable_osc0":
            case "enable_osc1":
            case "enable_osc2":
            case "enable_osc3":
            case "algo": {
                let lfo1 = this.lfo1;
                let lfo1_01 = this.lfo1_01;
                let lfo2 = this.lfo2;
                let lfo2_01 = this.lfo2_01;

                this.disconnect();
                this.connect(lfo1, lfo1_01, lfo2, lfo2_01);
                break;
            }
            case "env1_s":
                this.env1.update({ sustain: newVal });
                break;
            case "env1_a":
                this.env1.update({ attack: newVal });
                break;
            case "env1_d":
                this.env1.update({ decay: newVal });
                break;
            case "env1_r":
                this.env1.update({ release: newVal });
                break;
            case "detuneBase":
                //console.log(`setting detune base ${newVal}`);
                this.detuneBase.offset.value = newVal;
                break;
            case "detuneLFO1":
                this.detuneLFO1amt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "detuneLFO2":
                this.detuneLFO2amt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "detuneENV1":
                this.detuneENVamt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "waveShape_enabled":
            case "waveShape_curve":
                this._setWaveshapeCurve();
                break;
            case "waveShape_gain":
                this.waveshapeGain.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                this.waveshapePostGain.gain.linearRampToValueAtTime(1.0 / newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
        }
    }

    PitchBend(semis) {
        this._updateBaseFreq();
        this.oscillators.forEach(o => {
            if (!o.isConnected) return;
            o.updateOscFreq();
        });
    }

    _updateBaseFreq() {
        let pbsemis = this.instrumentSpec.GetParamByID("pb").currentValue;
        //let freq = FrequencyFromMidiNote(this.midiNote + pbsemis);
        this.midiNoteNode.offset.value = this.midiNote + pbsemis;
        //this.detuneFreq.gain.linearRampToValueAtTime(freq, this.audioCtx.currentTime + this.minGlideS);
    }

    physicalAndMusicalNoteOn(midiNote, velocity, isLegato) {
        this.timestamp = new Date();
        this.midiNote = midiNote;
        this.velocity = velocity;

        this._updateBaseFreq();
        this._updateFilterBaseFreq();

        let isPoly = this.instrumentSpec.GetParamByID("voicing").currentValue == 1;
        if (isPoly || !isLegato || (this.instrumentSpec.GetParamByID("env1_trigMode").currentValue == 0)) {
            this.env1.trigger();
        }
        this.oscillators.forEach(o => {
            if (!o.isConnected) return;
            o.noteOn(midiNote, velocity, isLegato);
        });
    }

    musicallyRelease(midiNote) {
        // it's possible you get note off events when you haven't note-on, in case of holding multiple monophonic keys, for example.
        // or in that case you can even get note off events for notes we're not playing. if it doesn't match, don't note off.
        if (midiNote != this.midiNote) {
            //console.log(`midi note ${midiNote} doesn't match mine ${this.midiNote}`);
            return;
        }

        this.env1.release();
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
