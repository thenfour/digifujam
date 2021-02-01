'use strict';



class MiniFMSynthOsc {
    constructor(audioCtx, instrumentSpec) {
        this.instrumentSpec = instrumentSpec;
        this.audioCtx = audioCtx;

        this.minGlideS = ClientSettings.InstrumentParamIntervalMS / 1000;

        this.midiNote = 0;
        this.velocity = 0;
        this.timestamp = null; // when did the note on start?
        this.noteOffTimestamp = null; // when did the note release ? 

        this.isConnected = false;

        this.nodes = {};
    }

    paramValue(paramID) {
        const fullParamID = this.paramPrefix + paramID;
        const val = this.instrumentSpec.GetParamByID(fullParamID).currentValue;
        //console.log(`fullParamID = ${fullParamID} = ${val}`);
        return val;
    }

    // lfo1 is -1 to 1 range
    // lfo1_01 is 0 to 1 range.
    connect(lfo1, lfo1_01, lfo2, lfo2_01, env1, pitchBendSemisNode, detuneSemisNode, paramPrefix, variationFactor) {
        this.isPoly = this.instrumentSpec.GetParamByID("voicing").currentValue == 1;
        this.paramPrefix = paramPrefix;
        this.variationFactor = variationFactor;

        /*
        each oscillator has                                                          

          [lfo1PWMAmt]+[lfo2PWMAmt]+[env1PWMAmt]
                                             |
                                             |                                                                              |gain          |gain     |gain
                                             |                                    |gain               |gain          [lfo1PanAmt]+[lfo2PanAmt]+[env1PanAmt]
                                             |<width>                         [lfo1LevelAmt]       [lfo2LevelAmt]              |
                                             |                                   |                    |                        |
                                             |                                   |                    |                        |
                                             |                                  |gain                |gain                    |pan
                (freq calculation)--><freq>[osc] ----> [envGainer]   ---> [lfo1gainer]  -----> [lfo2gainer]  ------------> [panner]  ---> dest
                                                       | <gain>
                                                       |
                                        [env]--> [envPeak]

        LETS look at the frequency calculation part of the graph.

             (detuneSemisNode) ---------------------->
             (pitchBendSemisNode) ------------------->
            [env1 0 to 1]-->[env1SemisAmt] ---------->
             [lfo-1 to 1]-->[lfo1SemisAmt] ---------->
             [lfo-1 to 1]-->[lfo2SemisAmt] ---------->
                                  [transposeSemis] -->
                               [baseFreqMidiNote]  --> [semisToHz] -><freq>[osc]

         UNFORTUNATELY the webaudio oscillator does not have a way to self-feedback or modulate phase. it can feedback on its frequency, but that's not working like an FM synth.
         maybe we can hack together some waveshaping to give a continuous alterantive; for now "waveform" select is enough.

        */
        if (this.isConnected) return;

        // this code gets hard to understand quickly.so here's what i do:
        // for each graph node, LEFT TO RIGHT (aka deep to shallow),
        // - create it.
        // - init params
        // - connect FROM.

        // env1SemisAmt
        this.nodes.env1SemisAmt = this.audioCtx.createGain();
        this.nodes.env1SemisAmt.gain.value = this.paramValue("env1_pitchDepth");
        env1.connect(this.nodes.env1SemisAmt);

        // lfo1SemisAmt
        this.nodes.lfo1SemisAmt = this.audioCtx.createGain();
        this.nodes.lfo1SemisAmt.gain.value = this.paramValue("lfo1_pitchDepth");
        lfo1.connect(this.nodes.lfo1SemisAmt);

        // lfo2SemisAmt
        this.nodes.lfo2SemisAmt = this.audioCtx.createGain();
        this.nodes.lfo2SemisAmt.gain.value = this.paramValue("lfo2_pitchDepth");
        lfo2.connect(this.nodes.lfo2SemisAmt);

        // transposeSemis
        this.nodes.transposeSemis = this.audioCtx.createConstantSource();
        this.nodes.transposeSemis.offset.value = this.paramValue("freq_transp");
        this.nodes.transposeSemis.start();

        // baseFreqToMidiNote
        this.nodes.baseFreqMidiNote = this.audioCtx.createConstantSource();
        this.nodes.baseFreqMidiNote.start();

        // semisToHz
        this.nodes.semisToHz = this.audioCtx.createMidiNoteToFrequencyNode();
        detuneSemisNode.connect(this.nodes.semisToHz);
        pitchBendSemisNode.connect(this.nodes.semisToHz);
        this.nodes.env1SemisAmt.connect(this.nodes.semisToHz);
        this.nodes.lfo1SemisAmt.connect(this.nodes.semisToHz);
        this.nodes.lfo2SemisAmt.connect(this.nodes.semisToHz);
        this.nodes.transposeSemis.connect(this.nodes.semisToHz);
        this.nodes.baseFreqMidiNote.connect(this.nodes.semisToHz);

        // lfo1PWMAmt
        this.nodes.lfo1PWMAmt = this.audioCtx.createGain();
        this.nodes.lfo1PWMAmt.gain.value = this.paramValue("pwmLFO1");
        lfo1.connect(this.nodes.lfo1PWMAmt);

        // lfo2PWMAmt
        this.nodes.lfo2PWMAmt = this.audioCtx.createGain();
        this.nodes.lfo2PWMAmt.gain.value = this.paramValue("pwmLFO2");
        lfo2.connect(this.nodes.lfo2PWMAmt);

        // env1PWMAmt
        this.nodes.env1PWMAmt = this.audioCtx.createGain();
        this.nodes.env1PWMAmt.gain.value = this.paramValue("pwmENV");
        env1.connect(this.nodes.env1PWMAmt);

        // osc
        this.nodes.osc = this.audioCtx.createPulseOscillator();
        this._setOscWaveform();
        this.nodes.osc.start();
        this.nodes.osc.frequency.value = this.paramValue("freq_abs");
        this.nodes.semisToHz.connect(this.nodes.osc.frequency);

        this.nodes.osc.width.value = this.paramValue("pwm_base");
        this.nodes.lfo1PWMAmt.connect(this.nodes.osc.width);
        this.nodes.lfo2PWMAmt.connect(this.nodes.osc.width);
        this.nodes.env1PWMAmt.connect(this.nodes.osc.width);

        // env
        this.nodes.env = ADSRNode(this.audioCtx, { // https://github.com/velipso/adsrnode
            attack: this.paramValue("a"),
            peak: 1.0,
            decay: this.paramValue("d"),
            decayCurve: 6.8, // https://rawgit.com/voidqk/adsrnode/master/demo.html
            sustain: this.paramValue("s"),
            release: this.paramValue("r"),
            releaseCurve: 6.8,
        });
        this.nodes.env.start();

        // envPeak
        this.nodes.envPeak = this.audioCtx.createGain();
        this.nodes.envPeak.gain.value = this.paramValue("level");
        this.nodes.env.connect(this.nodes.envPeak);

        // envGainer
        this.nodes.envGainer = this.audioCtx.createGain();
        this.nodes.envGainer.gain.value = 0.0;
        this.nodes.osc.connect(this.nodes.envGainer);
        this.nodes.envPeak.connect(this.nodes.envGainer.gain);

        // lfo1LevelAmt
        this.nodes.lfo1LevelAmt = this.audioCtx.createGain();
        this.nodes.lfo1LevelAmt.gain.value = this.paramValue("lfo1_gainAmt");
        lfo1_01.connect(this.nodes.lfo1LevelAmt);

        // lfo1gainer
        this.nodes.lfo1gainer = this.audioCtx.createGain();
        this.nodes.lfo1LevelAmt.connect(this.nodes.lfo1gainer.gain);
        this.nodes.envGainer.connect(this.nodes.lfo1gainer);

        // lfo2LevelAmt
        this.nodes.lfo2LevelAmt = this.audioCtx.createGain();
        this.nodes.lfo2LevelAmt.gain.value = this.paramValue("lfo2_gainAmt");
        lfo2_01.connect(this.nodes.lfo2LevelAmt);

        // lfo2gainer
        this.nodes.lfo2gainer = this.audioCtx.createGain();
        this.nodes.lfo2LevelAmt.connect(this.nodes.lfo2gainer.gain);
        this.nodes.lfo1gainer.connect(this.nodes.lfo2gainer);

        // lfo1PanAmt
        this.nodes.lfo1PanAmt = this.audioCtx.createGain();
        this.nodes.lfo1PanAmt.gain.value = this.paramValue("lfo1PanAmt");
        lfo1.connect(this.nodes.lfo1PanAmt);

        // lfo2PanAmt
        this.nodes.lfo2PanAmt = this.audioCtx.createGain();
        this.nodes.lfo2PanAmt.gain.value = this.paramValue("lfo2PanAmt");
        lfo2.connect(this.nodes.lfo2PanAmt);

        // env1PanAmt
        this.nodes.env1PanAmt = this.audioCtx.createGain();
        this.nodes.env1PanAmt.gain.value = this.paramValue("env1PanAmt");
        env1.connect(this.nodes.env1PanAmt);

        // panner
        this.nodes.panner = this.audioCtx.createStereoPanner();
        this.nodes.panner.pan.value = this.GetPanBaseValue();
        this.nodes.lfo1PanAmt.connect(this.nodes.panner.pan);
        this.nodes.lfo2PanAmt.connect(this.nodes.panner.pan);
        this.nodes.env1PanAmt.connect(this.nodes.panner.pan);
        this.nodes.lfo2gainer.connect(this.nodes.panner);


        // allow FM and output connections
        this.outputNode = this.nodes.panner;
        this.inputNode = this.nodes.osc;

        this.isConnected = true;
    }

    disconnect() {
        if (!this.isConnected) return;

        Object.keys(this.nodes).forEach(k => {
            let n = this.nodes[k];
            if (n.stop) n.stop();
            n.disconnect();
        });
        this.nodes = {};

        // reset FM and output connections
        this.outputNode = null;
        this.inputNode = null;

        this.isConnected = false;
    }

    _setOscWaveform() {
        const shapes = ["sine", "square", "sawtooth", "triangle", "pwm"];
        this.nodes.osc.setWaveformType(shapes[this.paramValue("wave")]);
    }

    GetPanBaseValue() {
        return this.paramValue("pan") + (this.instrumentSpec.GetParamByID("pan_spread").currentValue * this.variationFactor);
    }

    // account for key & vel scaling
    updateEnvPeakLevel() {
        let vsAmt = this.paramValue("vel_scale");
        let vs = 1.0 - remap(this.velocity, 0.0, 128.0, vsAmt, -vsAmt); // when vsAmt is 0, the range of vsAmt,-vsAmt is 0. hence making this 1.0-x
        let ksAmt = this.paramValue("key_scale");
        const halfKeyScaleRangeSemis = 12 * 4;
        let ks = 1.0 - remap(this.midiNote, 60.0 /* middle C */ - halfKeyScaleRangeSemis, 60.0 + halfKeyScaleRangeSemis, ksAmt, -ksAmt); // when vsAmt is 0, the range of vsAmt,-vsAmt is 0. hence making this 1.0-x
        let p = this.paramValue("level") * ks * vs;
        this.nodes.envPeak.gain.linearRampToValueAtTime(p, this.audioCtx.currentTime + this.minGlideS);
    }

    updateBaseFreq() {
        if (!this.isConnected) return;
        if (!this.baseFreq) return;
        let portamentoDurationS = this.isPoly ? 0 : this.paramValue("portamento");
        // for some reason, calling exponentialRampToValueAtTime or linearRampToValueAtTime will make a sudden jump of the current value. setTargetAtTime is the only one that works smoothly.
        let realFreq = this.baseFreq * this.paramValue("freq_mult");
        let midiNote = FrequencyToMidiNote(realFreq);
        if (portamentoDurationS <= this.minGlideS) {
            this.nodes.baseFreqMidiNote.offset.linearRampToValueAtTime(midiNote, this.audioCtx.currentTime + portamentoDurationS);
        } else {
            this.nodes.baseFreqMidiNote.offset.setTargetAtTime(midiNote, this.audioCtx.currentTime, portamentoDurationS);
        }
    }

    noteOn(midiNote, velocity, isLegato, baseFreq) {
        this.midiNote = midiNote;
        this.velocity = velocity;
        this.baseFreq = baseFreq;
        this.timestamp = new Date();
        this.updateEnvPeakLevel();
        this.updateBaseFreq();
        if (this.isPoly || !isLegato || (this.paramValue("env_trigMode") == 0)) {
            this.nodes.env.trigger();
        }
    }

    release() {
        if (!this.midiNote) return null;
        this.timestamp = null;
        this.noteOffTimestamp = new Date();
        this.midiNote = 0;
        this.velocity = 0;
        this.nodes.env.release();
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
                this.nodes.env1SemisAmt.gain.value = this.paramValue("env1_pitchDepth");
                break;
            case "lfo1_pitchDepth":
                this.nodes.lfo1SemisAmt.gain.value = this.paramValue("lfo1_pitchDepth");
                break;
            case "lfo2_pitchDepth":
                this.nodes.lfo2SemisAmt.gain.value = this.paramValue("lfo2_pitchDepth");
                break;
            case "freq_mult":
                this.updateBaseFreq();
                break;
            case "freq_abs":
                this.nodes.osc.frequency.value = this.paramValue("freq_abs");
                break;
            case "freq_transp":
                this.nodes.transposeSemis.offset.value = this.paramValue("freq_transp");
                break;
            case "key_scale":
            case "vel_scale":
            case "level":
                this.updateEnvPeakLevel();
                break;
            case "s":
                this.nodes.env.update({ sustain: newVal });
                break;
            case "a":
                this.nodes.env.update({ attack: newVal });
                break;
            case "d":
                this.nodes.env.update({ decay: newVal });
                break;
            case "r":
                this.nodes.env.update({ release: newVal });
                break;
            case "pan":
                //this.nodes.panner.pan.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                this.nodes.panner.pan.value = this.GetPanBaseValue();
                break;
            case "lfo1PanAmt":
                this.nodes.lfo1PanAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "lfo2PanAmt":
                this.nodes.lfo2PanAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "env1PanAmt":
                this.nodes.env1PanAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "lfo1_gainAmt":
                this.nodes.lfo1LevelAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "lfo2_gainAmt":
                this.nodes.lfo2LevelAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "pwm_base":
                this.nodes.osc.width.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "pwmLFO1":
                this.nodes.lfo1PWMAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "pwmLFO2":
                this.nodes.lfo2PWMAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
            case "pwmENV":
                this.nodes.env1PWMAmt.gain.linearRampToValueAtTime(newVal, this.audioCtx.currentTime + this.minGlideS);
                break;
        }
    }
}
