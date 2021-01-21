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


                                                                                                                      |gain          |gain     |gain
                                                                                   |gain               |gain     [lfo1PanAmt]+[lfo2PanAmt]+[env1PanAmt]
                                                                            [lfo1LevelAmt]       [lfo2LevelAmt]              |
        [env1 0 to 1]-->[env1FreqAmt] -->                                      |gain                |gain                    |pan
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

        // osc
        this.osc = this.audioCtx.createOscillator();
        this._setOscWaveform();
        this.osc.start();
        this.lfo1FreqAmt.connect(this.osc.frequency);
        this.env1FreqAmt.connect(this.osc.frequency);

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

        // lfo1PanAmt
        this.lfo1PanAmt = this.audioCtx.createGain();
        this.lfo1PanAmt.gain.value = this.paramValue("lfo1PanAmt");
        lfo1.connect(this.lfo1PanAmt);

        // env1PanAmt
        this.env1PanAmt = this.audioCtx.createGain();
        this.env1PanAmt.gain.value = this.paramValue("env1PanAmt");
        env1.connect(this.env1PanAmt);

        // panner
        this.panner = this.audioCtx.createStereoPanner();
        this.panner.pan.value = this.paramValue("pan");
        this.lfo1PanAmt.connect(this.panner.pan);
        this.env1PanAmt.connect(this.panner.pan);
        this.lfo1gainer.connect(this.panner);


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

        // lfo1PanAmt
        this.lfo1PanAmt.disconnect();
        this.lfo1PanAmt = null;

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
        const shapes = ["sine", "square", "sawtooth", "triangle", "sine"];
        this.osc.type = shapes[this.paramValue("wave")];
    }

    // returns [frequency of note,
    //   lfo1_pitchDepth frequency delta,
    //   env1_pitchDepth frequency delta,
    // ]
    getFreqs() {
        let pbsemis = this.instrumentSpec.GetParamByID("pb").currentValue;
        let freqmul = this.paramValue("freq_mult");
        let freqabs = this.paramValue("freq_abs");
        let ret = [
            FrequencyFromMidiNote(this.midiNote + pbsemis) * freqmul + freqabs,
            FrequencyFromMidiNote(this.midiNote + pbsemis + this.paramValue("lfo1_pitchDepth")) * freqmul + freqabs,
            FrequencyFromMidiNote(this.midiNote + pbsemis + this.paramValue("env1_pitchDepth")) * freqmul + freqabs,
        ];
        // since the modulated pitches modulate the osc, subtract.
        ret[1] -= ret[0];
        ret[2] -= ret[0];
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
            case "env1PanAmt":
                this.env1PanAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "lfo1_gainAmt":
                this.lfo1LevelAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
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
        ];

        this.modulationGainers = [];

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
                                  [env1]------->[child oscillators] --> [masterDryGain]
                                                                      > [masterWetGain]
        
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
        this.oscillators.forEach(o => o.connect(lfo1, lfo1_01, lfo2, lfo2_01, this.env1));

        // masterDryGain
        this.masterDryGain = this.audioCtx.createGain();
        // masterWetGain
        this.masterWetGain = this.audioCtx.createGain();

        let gainLevels = this.getGainLevels();
        this.masterDryGain.gain.value = gainLevels[0];
        this.masterWetGain.gain.value = gainLevels[1];

        // set up algo
        let algo = this.instrumentSpec.GetParamByID("algo").currentValue;

        switch (parseInt(algo)) {
            case 0:
                let m0 = this.audioCtx.createGain();
                this.modulationGainers.push(m0);
                m0.gain.value = 20000;

                // 0 => 1
                this.oscillators[0].outputNode.connect(m0);
                m0.connect(this.oscillators[1].inputNode.frequency);

                // 1 => dest
                this.oscillators[1].outputNode.connect(this.masterDryGain);
                this.oscillators[1].outputNode.connect(this.masterWetGain);
                break;

            case 1:
                this.oscillators[0].outputNode.connect(this.masterDryGain);
                this.oscillators[0].outputNode.connect(this.masterWetGain);
                this.oscillators[1].outputNode.connect(this.masterDryGain);
                this.oscillators[1].outputNode.connect(this.masterWetGain);
                break;
            default:
                console.log(`unknown algorithm ${algo}`);
                break;
        }

        // connect to outside.
        this.masterDryGain.connect(this.dryDestination);
        this.masterWetGain.connect(this.wetDestination);
        this.isConnected = true;
    }

    disconnect() {
        this.AllNotesOff();
        if (!this.isConnected) return;
        this.lfo1 = null;
        this.lfo1_01 = null;
        this.lfo2 = null;
        this.lfo2_01 = null;

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
            this.oscillators[oscid].SetParamValue(paramID.substring(5), newVal);
            return;
        }
        switch (paramID) {
            case "pb":
                this.PitchBend(newVal);
                break;
            case "masterGain":
            case "verbMix":
                let levels = this.getGainLevels();
                this.masterDryGain.gain.linearRampToValueAtTime(levels[0], this.audioCtx.currentTime + this.minGlideS);
                this.masterWetGain.gain.linearRampToValueAtTime(levels[1], this.audioCtx.currentTime + this.minGlideS);
                break;
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
        this.oscillators.forEach(o => { o.updateOscFreq(); });
    }

    physicalAndMusicalNoteOn(midiNote, velocity, isLegato) {
        this.timestamp = new Date();
        this.midiNote = midiNote;
        this.velocity = velocity;

        //console.log(`note on ${midiNote} islegato? ${isLegato} trigmode=${9}`);

        if (!isLegato || (this.instrumentSpec.GetParamByID("env1_trigMode").currentValue == 0)) {
            this.env1.trigger();
        }
        this.oscillators.forEach(o => {
            o.noteOn(midiNote, velocity, isLegato);
        });
    }

    musicallyRelease(midiNote) {
        // it's possible you get note off events when you haven't note-on, in case of holding multiple monophonic keys, for example.
        // or in that case you can even get note off events for notes we're not playing. if it doesn't match, don't note off.
        if (midiNote != this.midiNote) return;

        this.env1.release();
        this.oscillators.forEach(o => {
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
