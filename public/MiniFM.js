'use strict';



class MiniFMSynthOsc {
    constructor(audioCtx, instrumentSpec, paramPrefix) {
        this.instrumentSpec = instrumentSpec;
        this.audioCtx = audioCtx;
        this.paramPrefix = paramPrefix;

        this.minGlideS = ClientSettings.InstrumentParamIntervalMS / 1000;

        this.midiNote = 0;
        this.velocity = 0;
        this.timestamp = null; // when did the note on start?

        this.isConnected = false;
    }

    paramValue(paramID) {
        return this.instrumentSpec.GetParamByID(this.paramPrefix + paramID).currentValue;
    }

    // lfo1 is -1 to 1 range
    // lfo1_01 is 0 to 1 range.
    connect(lfo1, lfo1_01, lfo2, lfo2_01, env1) {
        /*
        each oscillator has                                                          


                          [lfo1PWMAmt]+[lfo2PWMAmt]+[env1PWMAmt]
                                            |
                                            |                                                                        |gain          |gain     |gain
                                            |                                      |gain               |gain     [lfo1PanAmt]+[lfo2PanAmt]+[env1PanAmt]
                                            |width                          [lfo1LevelAmt]       [lfo2LevelAmt]              |
        [env1 0 to 1]-->[env1FreqAmt] -->   |                                  |gain                |gain                    |pan
         [lfo-1 to 1]-->[lfo1FreqAmt] --> [osc] ----> [envGainer]   ---> [lfo1gainer]  -----> [lfo2gainer]  ------------> [panner]  ---> dest
         [lfo-1 to 1]-->[lfo2FreqAmt] -->               | <gain>
                                           [env]--> [envPeak]

        
         UNFORTUNATELY the webaudio oscillator does not have a way to self-feedback or modulate phase. it can feedback on its frequency, but that's not working like an FM synth.
         maybe we can hack together some waveshaping to give a continuous alterantive; for now "waveform" select is enough.

        */
        if (this.isConnected) return;

        // this code gets hard to understand quickly.so here's what i do:
        // for each graph node, LEFT TO RIGHT (aka deep to shallow),
        // - create it.
        // - init params
        // - connect FROM.

        // env1FreqAmt
        this.env1FreqAmt = this.audioCtx.createGain();
        this.env1FreqAmt.gain.value = 1.0;// this cannot be set when there's no note on, because the param is in semitones but this node is in frequency. it must be set for every note on.
        env1.connect(this.env1FreqAmt);

        // lfo1FreqAmt
        this.lfo1FreqAmt = this.audioCtx.createGain();
        this.lfo1FreqAmt.gain.value = 1.0;
        lfo1.connect(this.lfo1FreqAmt);

        // lfo2FreqAmt
        this.lfo2FreqAmt = this.audioCtx.createGain();
        this.lfo2FreqAmt.gain.value = 1.0;
        lfo2.connect(this.lfo2FreqAmt);

        // lfo1PWMAmt
        this.lfo1PWMAmt = this.audioCtx.createGain();
        this.lfo1PWMAmt.gain.value = this.paramValue("pwmLFO1");
        lfo1.connect(this.lfo1PWMAmt);

        // lfo2PWMAmt
        this.lfo2PWMAmt = this.audioCtx.createGain();
        this.lfo2PWMAmt.gain.value = this.paramValue("pwmLFO2");
        lfo2.connect(this.lfo2PWMAmt);

        // env1PWMAmt
        this.env1PWMAmt = this.audioCtx.createGain();
        this.env1PWMAmt.gain.value = this.paramValue("pwmENV");
        env1.connect(this.env1PWMAmt);

        // osc
        this.osc = this.audioCtx.createPulseOscillator();
        this._setOscWaveform();
        this.osc.start();
        this.lfo1FreqAmt.connect(this.osc.frequency);
        this.lfo2FreqAmt.connect(this.osc.frequency);
        this.env1FreqAmt.connect(this.osc.frequency);

        this.osc.width.value = this.paramValue("pwm_base");
        this.lfo1PWMAmt.connect(this.osc.width);
        this.lfo2PWMAmt.connect(this.osc.width);
        this.env1PWMAmt.connect(this.osc.width);

        // env
        this.env = ADSRNode(this.audioCtx, { // https://github.com/velipso/adsrnode
            attack: this.paramValue("a"),
            peak: 1.0,
            decay: this.paramValue("d"),
            decayCurve: 6.8, // https://rawgit.com/voidqk/adsrnode/master/demo.html
            sustain: this.paramValue("s"),
            release: this.paramValue("r"),
            releaseCurve: 6.8,
        });
        this.env.start();

        // envPeak
        this.envPeak = this.audioCtx.createGain();
        this.envPeak.gain.value = this.paramValue("level");
        this.env.connect(this.envPeak);

        // envGainer
        this.envGainer = this.audioCtx.createGain();
        this.envGainer.gain.value = 0.0;
        this.osc.connect(this.envGainer);
        this.envPeak.connect(this.envGainer.gain);

        // lfo1LevelAmt
        this.lfo1LevelAmt = this.audioCtx.createGain();
        this.lfo1LevelAmt.gain.value = this.paramValue("lfo1_gainAmt");
        lfo1_01.connect(this.lfo1LevelAmt);

        // lfo1gainer
        this.lfo1gainer = this.audioCtx.createGain();
        this.lfo1LevelAmt.connect(this.lfo1gainer.gain);
        this.envGainer.connect(this.lfo1gainer);

        // lfo2LevelAmt
        this.lfo2LevelAmt = this.audioCtx.createGain();
        this.lfo2LevelAmt.gain.value = this.paramValue("lfo2_gainAmt");
        lfo2_01.connect(this.lfo2LevelAmt);

        // lfo2gainer
        this.lfo2gainer = this.audioCtx.createGain();
        this.lfo2LevelAmt.connect(this.lfo2gainer.gain);
        this.lfo1gainer.connect(this.lfo2gainer);

        // lfo1PanAmt
        this.lfo1PanAmt = this.audioCtx.createGain();
        this.lfo1PanAmt.gain.value = this.paramValue("lfo1PanAmt");
        lfo1.connect(this.lfo1PanAmt);

        // lfo2PanAmt
        this.lfo2PanAmt = this.audioCtx.createGain();
        this.lfo2PanAmt.gain.value = this.paramValue("lfo2PanAmt");
        lfo2.connect(this.lfo2PanAmt);

        // env1PanAmt
        this.env1PanAmt = this.audioCtx.createGain();
        this.env1PanAmt.gain.value = this.paramValue("env1PanAmt");
        env1.connect(this.env1PanAmt);

        // panner
        this.panner = this.audioCtx.createStereoPanner();
        this.panner.pan.value = this.paramValue("pan");
        this.lfo1PanAmt.connect(this.panner.pan);
        this.lfo2PanAmt.connect(this.panner.pan);
        this.env1PanAmt.connect(this.panner.pan);
        this.lfo2gainer.connect(this.panner);


        // allow FM and output connections
        this.outputNode = this.panner;
        this.inputNode = this.osc;

        this.isConnected = true;
    }

    disconnect() {
        if (!this.isConnected) return;

        // env1FreqAmt
        this.env1FreqAmt.disconnect();
        this.env1FreqAmt = null;

        // lfo1FreqAmt
        this.lfo1FreqAmt.disconnect();
        this.lfo1FreqAmt = null;

        // lfo2FreqAmt
        this.lfo2FreqAmt.disconnect();
        this.lfo2FreqAmt = null;

        this.lfo1PWMAmt.disconnect();
        this.lfo1PWMAmt = null;
        this.lfo2PWMAmt.disconnect();
        this.lfo2PWMAmt = null;
        this.env1PWMAmt.disconnect();
        this.env1PWMAmt = null;

        // osc
        this.osc.stop();
        this.osc.disconnect();
        this.osc = null;

        // env
        this.env.stop();
        this.env.disconnect();
        this.env = null;

        // envPeak
        this.envPeak.disconnect();
        this.envPeak = null;

        // envGainer
        this.envGainer.disconnect();
        this.envGainer = null;

        // lfo1LevelAmt
        this.lfo1LevelAmt.disconnect();
        this.lfo1LevelAmt = null;

        // lfo1gainer
        this.lfo1gainer.disconnect();
        this.lfo1gainer = null;

        // lfo2LevelAmt
        this.lfo2LevelAmt.disconnect();
        this.lfo2LevelAmt = null;

        // lfo2gainer
        this.lfo2gainer.disconnect();
        this.lfo2gainer = null;

        // lfo1PanAmt
        this.lfo1PanAmt.disconnect();
        this.lfo1PanAmt = null;

        // lfo1PanAmt
        this.lfo2PanAmt.disconnect();
        this.lfo2PanAmt = null;

        // env1PanAmt
        this.env1PanAmt.disconnect();
        this.env1PanAmt = null;

        // panner
        this.panner.disconnect();
        this.env1PanAmt = null;

        // reset FM and output connections
        this.outputNode = null;
        this.inputNode = null;

        this.isConnected = false;
    }

    _setOscWaveform() {
        const shapes = ["sine", "square", "sawtooth", "triangle", "pwm"];
        this.osc.setWaveformType(shapes[this.paramValue("wave")]);
    }

    // returns [frequency of note,
    //   lfo1_pitchDepth frequency delta,
    //   env1_pitchDepth frequency delta,
    //   lfo2_pitchDepth frequency delta,
    // ]
    getFreqs() {
        let pbsemis = this.instrumentSpec.GetParamByID("pb").currentValue;
        let freqmul = this.paramValue("freq_mult");
        let freqabs = this.paramValue("freq_abs");
        let ret = [
            FrequencyFromMidiNote(this.midiNote + pbsemis) * freqmul + freqabs,
            FrequencyFromMidiNote(this.midiNote + pbsemis + this.paramValue("lfo1_pitchDepth")) * freqmul + freqabs,
            FrequencyFromMidiNote(this.midiNote + pbsemis + this.paramValue("env1_pitchDepth")) * freqmul + freqabs,
            FrequencyFromMidiNote(this.midiNote + pbsemis + this.paramValue("lfo2_pitchDepth")) * freqmul + freqabs,
        ];
        // since the modulated pitches modulate the osc, subtract.
        ret[1] -= ret[0];
        ret[2] -= ret[0];
        ret[3] -= ret[0];
        return ret;
    }

    // account for key & vel scaling
    updateEnvPeakLevel() {

        let vsAmt = this.paramValue("vel_scale");
        let vs = 1.0 - remap(this.velocity, 0.0, 128.0, vsAmt, -vsAmt); // when vsAmt is 0, the range of vsAmt,-vsAmt is 0. hence making this 1.0-x
        let ksAmt = this.paramValue("key_scale");
        const halfKeyScaleRangeSemis = 12 * 4;
        let ks = 1.0 - remap(this.midiNote, 60.0 /* middle C */ - halfKeyScaleRangeSemis, 60.0 + halfKeyScaleRangeSemis, ksAmt, -ksAmt); // when vsAmt is 0, the range of vsAmt,-vsAmt is 0. hence making this 1.0-x
        let p = this.paramValue("level") * ks * vs;
        this.envPeak.gain.linearRampToValueAtTime(p, this.audioCtx.currentTime + this.minGlideS);
    }

    updateOscFreq(alwaysSmooth) {
        let freq = this.getFreqs();
        //let isPoly = this.instrumentSpec.GetParamByID("voicing").currentValue == 1;
        let portamentoDurationS = this.paramValue("portamento");
        if (alwaysSmooth && portamentoDurationS < this.minGlideS) portamentoDurationS = this.minGlideS;

        //console.log(`ramping from ${this.osc.frequency.value} to ${freq[0]} in ${portamentoDurationS} sec`);

        // for some reason, calling exponentialRampToValueAtTime or linearRampToValueAtTime will make a sudden jump of the current value. setTargetAtTime is the only one that works smoothly.
        this.osc.frequency.setTargetAtTime(freq[0], this.audioCtx.currentTime, portamentoDurationS);
        //this.osc.frequency.cancelAndHoldAtTime(this.audioCtx.currentTime);
        //this.osc.frequency.exponentialRampToValueAtTime(freq[0], this.audioCtx.currentTime + portamentoDurationS);
        this.lfo1FreqAmt.gain.linearRampToValueAtTime(freq[1], this.audioCtx.currentTime + this.minGlideS);
        this.lfo2FreqAmt.gain.linearRampToValueAtTime(freq[3], this.audioCtx.currentTime + this.minGlideS);
        this.env1FreqAmt.gain.linearRampToValueAtTime(freq[2], this.audioCtx.currentTime + this.minGlideS);
    }

    noteOn(midiNote, velocity, isLegato) {
        this.midiNote = midiNote;
        this.velocity = velocity;
        this.updateEnvPeakLevel();
        this.updateOscFreq(false);
        if (!isLegato || (this.paramValue("env_trigMode") == 0)) {
            this.env.trigger();
        }
    }

    release() {
        if (!this.midiNote) return null;
        this.midiNote = 0;
        this.velocity = 0;
        this.env.release();
    }

    AllNotesOff() {
        this.midiNote = 0;
        this.velocity = 0;
        if (this.env) this.env.reset();
    }

    SetParamValue(strippedParamID, newVal) {
        if (!this.isConnected) return;
        switch (strippedParamID) {
            case "wave":
                this._setOscWaveform();
                break;
            case "env1_pitchDepth":
            case "lfo1_pitchDepth":
            case "lfo2_pitchDepth":
            case "freq_mult":
            case "freq_abs":
                this.updateOscFreq(true);
                break;
            case "key_scale":
            case "vel_scale":
            case "level":
                this.updateEnvPeakLevel();
                break;
            case "s":
                this.env.update({ sustain: newVal });
                break;
            case "a":
                this.env.update({ attack: newVal });
                break;
            case "d":
                this.env.update({ decay: newVal });
                break;
            case "r":
                this.env.update({ release: newVal });
                break;
            case "pan":
                this.panner.pan.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "lfo1PanAmt":
                this.lfo1PanAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "lfo2PanAmt":
                this.lfo2PanAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "env1PanAmt":
                this.env1PanAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "lfo1_gainAmt":
                this.lfo1LevelAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "lfo2_gainAmt":
                this.lfo2LevelAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "pwm_base":
                this.osc.width.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "pwmLFO1":
                this.lfo1PWMAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "pwmLFO2":
                this.lfo2PWMAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "pwmENV":
                this.env1PWMAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
        }
    }
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/*
algo: ...
lfo: wave, speed, delay, pitch mod depth 1 2 3 4, amp mod depth 1 2 3 4
pitch env a, d, s, r, depth 1 2 3 4 
*/
class MiniFMSynthVoice {
    constructor(audioCtx, dryDestination, wetDestination, instrumentSpec) {
        this.instrumentSpec = instrumentSpec;
        this.audioCtx = audioCtx;
        this.dryDestination = dryDestination;
        this.wetDestination = wetDestination;

        this.minGlideS = ClientSettings.InstrumentParamIntervalMS / 1000;

        this.midiNote = 0;
        this.velocity = 0;
        this.timestamp = null; // when did the note on start?

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
          [env1]------->[child oscillators] -->[oscSum]--> [filter] -----------> [masterDryGain]
                                                            |    |              > [masterWetGain]
                                                       freq |   | Q
                                          [filterFreqLFO1Amt]   [filterQLFO1Amt]
                                         +[filterFreqLFO2Amt]   [filterQLFO2Amt]
                                         +[filterFreqENVAmt]   [filterQENVAmt]
        
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

        // child oscillators
        if (this.instrumentSpec.GetParamByID("enable_osc0").currentValue) {
            this.oscillators[0].connect(lfo1, lfo1_01, lfo2, lfo2_01, this.env1);
        }
        if (this.instrumentSpec.GetParamByID("enable_osc1").currentValue) {
            this.oscillators[1].connect(lfo1, lfo1_01, lfo2, lfo2_01, this.env1);
        }
        if (this.instrumentSpec.GetParamByID("enable_osc2").currentValue) {
            this.oscillators[2].connect(lfo1, lfo1_01, lfo2, lfo2_01, this.env1);
        }
        if (this.instrumentSpec.GetParamByID("enable_osc3").currentValue) {
            this.oscillators[3].connect(lfo1, lfo1_01, lfo2, lfo2_01, this.env1);
        }

        // oscSum
        this.oscSum = this.audioCtx.createGain();
        this.oscSum.gain.value = 1;

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

        this.oscSum.connect(this.filter);

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

        // set up algo
        let algo = this.instrumentSpec.GetParamByID("algo").currentValue;

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

        //   "enumNames": [
        //     "[1🡄2🡄3🡄4]",
        //     "[1🡄2🡄3][4]",
        //     "[1🡄2][3🡄4]",
        //     "[1🡄2][3][4]",
        //     "[1][2][3][4]"
        switch (parseInt(algo)) {
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
            case 2: // "[1🡄2][3🡄4]",
                mod(this.oscillators[3], this.oscillators[2]);
                out(this.oscillators[2]);
                mod(this.oscillators[1], this.oscillators[0]);
                break;
            case 3: // "[1🡄2][3][4]",
                out(this.oscillators[3]);
                out(this.oscillators[2]);
                mod(this.oscillators[1], this.oscillators[0]);
                break;
            case 4: // "[1][2][3][4]"
                out(this.oscillators[3]);
                out(this.oscillators[2]);
                out(this.oscillators[1]);
                break;
            default:
                console.log(`unknown algorithm ${algo}`);
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
            // oscSum] --> [masterDryGain
            //           > [masterWetGain
            this.filter.disconnect();

            this.oscSum.disconnect();
            this.oscSum.connect(this.masterDryGain);
            this.oscSum.connect(this.masterWetGain);

            this.isFilterConnected = false;
        };
        let enableFilter = () => {
            if (this.isFilterConnected) return;
            this.oscSum.disconnect();
            this.oscSum.connect(this.filter);

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
        return [(1.0 - vg) * ms, vg * ms * 1.3]; // multiply verb gain to compensate, try and make wet as loud as dry.
    }

    get IsPlaying() {
        return this.isConnected && !!this.timestamp;
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
            case "filterFreq":
                this.filter.frequency.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
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
        }
    }

    PitchBend(semis) {
        this.oscillators.forEach(o => {
            if (!o.isConnected) return;
            o.updateOscFreq();
        });
    }

    physicalAndMusicalNoteOn(midiNote, velocity, isLegato) {
        this.timestamp = new Date();
        this.midiNote = midiNote;
        this.velocity = velocity;

        if (!isLegato || (this.instrumentSpec.GetParamByID("env1_trigMode").currentValue == 0)) {
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
        if (midiNote != this.midiNote) return;

        this.env1.release();
        this.oscillators.forEach(o => {
            if (!o.isConnected) return;
            o.release();
        });

        this.timestamp = null;
        this.midiNote = 0;
        this.velocity = 0;
    }

    AllNotesOff() {
        this.oscillators.forEach(o => {
            o.AllNotesOff();
        });
        this.midiNote = 0;
        this.timestamp = null;
        this.velocity = 0;
    }

};
