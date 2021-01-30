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
        this.noteOffTimestamp = null; // when did the note release ? 

        this.isConnected = false;
    }

    paramValue(paramID) {
        return this.instrumentSpec.GetParamByID(this.paramPrefix + paramID).currentValue;
    }

    // lfo1 is -1 to 1 range
    // lfo1_01 is 0 to 1 range.
    connect(lfo1, lfo1_01, lfo2, lfo2_01, env1, detune) {
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
         detune --> [detuneScale]------->
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

        // detuneScale
        this.detuneScale = this.audioCtx.createGain();
        this.detuneScale.gain.value = 1.0; // this is also based on frequency so don't set now.
        detune.connect(this.detuneScale);

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
        this.detuneScale.connect(this.osc.frequency);

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

        this.detuneScale.disconnect();
        this.detuneScale = null;

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
        let isPoly = this.instrumentSpec.GetParamByID("voicing").currentValue == 1;
        let portamentoDurationS = isPoly ? 0 : this.paramValue("portamento");
        if (alwaysSmooth && portamentoDurationS < this.minGlideS) portamentoDurationS = this.minGlideS;
        // for some reason, calling exponentialRampToValueAtTime or linearRampToValueAtTime will make a sudden jump of the current value. setTargetAtTime is the only one that works smoothly.
        if (portamentoDurationS <= this.minGlideS) {
            this.osc.frequency.linearRampToValueAtTime(freq[0], this.audioCtx.currentTime + portamentoDurationS);
        } else {
            this.osc.frequency.setTargetAtTime(freq[0], this.audioCtx.currentTime, portamentoDurationS);
        }
        //this.osc.frequency.cancelAndHoldAtTime(this.audioCtx.currentTime);
        //this.osc.frequency.exponentialRampToValueAtTime(freq[0], this.audioCtx.currentTime + portamentoDurationS);
        this.detuneScale.gain.linearRampToValueAtTime(this.paramValue("freq_mult"), this.audioCtx.currentTime + this.minGlideS);
        this.lfo1FreqAmt.gain.linearRampToValueAtTime(freq[1], this.audioCtx.currentTime + this.minGlideS);
        this.lfo2FreqAmt.gain.linearRampToValueAtTime(freq[3], this.audioCtx.currentTime + this.minGlideS);
        this.env1FreqAmt.gain.linearRampToValueAtTime(freq[2], this.audioCtx.currentTime + this.minGlideS);
    }

    noteOn(midiNote, velocity, isLegato) {
        this.midiNote = midiNote;
        this.velocity = velocity;
        this.timestamp = new Date();
        this.updateEnvPeakLevel();
        this.updateOscFreq(false);
        let isPoly = this.instrumentSpec.GetParamByID("voicing").currentValue == 1;
        if (isPoly || !isLegato || (this.paramValue("env_trigMode") == 0)) {
            this.env.trigger();
        }
    }

    release() {
        if (!this.midiNote) return null;
        this.timestamp = null;
        this.noteOffTimestamp = new Date();
        this.midiNote = 0;
        this.velocity = 0;
        this.env.release();
    }

    get IsPlaying() {
        if (!this.isConnected) return false;
        if (this.timestamp) return true; // note is definitely playing.
        if (!this.noteOffTimestamp) return false;
        // note is off; check if we're still in envelope "release" stage.
        if ((new Date() - this.noteOffTimestamp) < (this.paramValue("r") * 1000)) {
            return true;
        }
        this.noteOffTimestamp = null;
        return false;
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
