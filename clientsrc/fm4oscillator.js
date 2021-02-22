'use strict';

const DF = require("./DFCommon");
const ADSR = require("./adhsr");
const DFSynthTools = require("./synthTools");
const PWM = require("./pwm");
const FM4OscThreeNodeOptimizer = require("./fm4osc3NodeOptimizer").FM4OscThreeNodeOptimizer;
const AudioGraphHelper = require('./synthTools').AudioGraphHelper;

class MiniFMSynthOsc {
    constructor(audioCtx, instrumentSpec) {
        this.instrumentSpec = instrumentSpec;
        this.audioCtx = audioCtx;

        this.minGlideS = DF.ClientSettings.InstrumentParamIntervalMS / 1000;

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
    connect(lfo1, lfo2, env1, pitchBendSemisNode, detuneSemisNode, paramPrefix, variationFactor) {
        this.isPoly = this.instrumentSpec.GetParamByID("voicing").currentValue == 1;
        this.paramPrefix = paramPrefix;
        this.variationFactor = variationFactor;
        this.audioCtx.beginScope("oscillator");

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
        this.nodes.env1SemisAmt = new DFSynthTools.OptimalGainer(this.audioCtx, "osc>pitchmod");//this.audioCtx.createGain("osc>pitchmod");
        this.nodes.env1SemisAmt.gain = this.paramValue("env1_pitchDepth");
        this.nodes.env1SemisAmt.connectFrom(env1);

        // lfo1SemisAmt
        this.nodes.lfo1SemisAmt = new DFSynthTools.OptimalGainer(this.audioCtx, "osc>pitchmod");//this.audioCtx.createGain("osc>pitchmod");
        this.nodes.lfo1SemisAmt.gain = this.paramValue("lfo1_pitchDepth");
        this.nodes.lfo1SemisAmt.connectFrom(lfo1);

        // lfo2SemisAmt
        this.nodes.lfo2SemisAmt = new DFSynthTools.OptimalGainer(this.audioCtx, "osc>pitchmod");//this.audioCtx.createGain("osc>pitchmod");
        this.nodes.lfo2SemisAmt.gain = this.paramValue("lfo2_pitchDepth");
        this.nodes.lfo2SemisAmt.connectFrom(lfo2);

        // transposeSemis
        this.nodes.transposeSemis = this.audioCtx.createConstantSource("osc>pitchmod");
        this.nodes.transposeSemis.offset.value = this.paramValue("freq_transp");
        this.nodes.transposeSemis.start();

        // baseFreqToMidiNote
        this.nodes.baseFreqMidiNote = this.audioCtx.createConstantSource("osc>pitch");
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
        this.nodes.lfo1PWMAmt = new DFSynthTools.OptimalGainer(this.audioCtx, "osc>pwmmod");//this.audioCtx.createGain("osc>pwmmod");
        this.nodes.lfo1PWMAmt.gain = this.paramValue("pwmLFO1");
        this.nodes.lfo1PWMAmt.connectFrom(lfo1);

        // lfo2PWMAmt
        this.nodes.lfo2PWMAmt = new DFSynthTools.OptimalGainer(this.audioCtx, "osc>pwmmod");//this.audioCtx.createGain("osc>pwmmod");
        this.nodes.lfo2PWMAmt.gain = this.paramValue("pwmLFO2");
        //lfo2.connect(this.nodes.lfo2PWMAmt);
        this.nodes.lfo2PWMAmt.connectFrom(lfo2);

        // env1PWMAmt
        this.nodes.env1PWMAmt = new DFSynthTools.OptimalGainer(this.audioCtx, "osc>pwmmod");//this.audioCtx.createGain("osc>pwmmod");
        this.nodes.env1PWMAmt.gain = this.paramValue("pwmENV");
        //env1.connect(this.nodes.env1PWMAmt);
        this.nodes.env1PWMAmt.connectFrom(env1);

        // osc
        this.nodes.osc = new PWM.DFOscillator(this.audioCtx, "osc");// this.audioCtx.createPulseOscillator();
        this._setOscWaveform();
        this.nodes.osc.start();
        this.nodes.osc.frequency.value = this.paramValue("freq_abs");
        this.nodes.semisToHz.connect(this.nodes.osc.frequency);

        this.nodes.osc.width.value = this.paramValue("pwm_base");
        this.nodes.lfo1PWMAmt.connect(this.nodes.osc.width);
        this.nodes.lfo2PWMAmt.connect(this.nodes.osc.width);
        this.nodes.env1PWMAmt.connect(this.nodes.osc.width);

        // env
        this.nodes.env = ADSR.ADSRNode(this.audioCtx, { // https://github.com/velipso/adsrnode
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
        this.nodes.envPeak = this.audioCtx.createGain("osc>envpeak");
        this.nodes.envPeak.gain.value = this.paramValue("level");
        this.nodes.env.connect(this.nodes.envPeak);

        // envGainer
        this.nodes.envGainer = this.audioCtx.createGain("osc>envgain");
        this.nodes.envGainer.gain.value = 0.0;
        this.nodes.osc.connect(this.nodes.envGainer);
        this.nodes.envPeak.connect(this.nodes.envGainer.gain);

        // lfo1LevelAmt
        this.nodes.lfo1LevelAmt = new DFSynthTools.OptimalGainer(this.audioCtx, "osc>gain_mod");
        this.nodes.lfo1LevelAmt.gain = this.paramValue("lfo1_gainAmt");
        this.nodes.lfo1LevelAmt.connectFrom(lfo1);

        // lfo1gainer (see threeNodesOptimizer)

        // lfo2LevelAmt
        this.nodes.lfo2LevelAmt = new DFSynthTools.OptimalGainer(this.audioCtx, "osc>gain_mod");//this.audioCtx.createGain("osc>gain_mod");
        this.nodes.lfo2LevelAmt.gain = this.paramValue("lfo2_gainAmt");
        this.nodes.lfo2LevelAmt.connectFrom(lfo2);

        // lfo2gainer (see threeNodesOptimizer)

        // lfo1PanAmt
        this.nodes.lfo1PanAmt = new DFSynthTools.OptimalGainer(this.audioCtx, "osc>pan_mod");//this.audioCtx.createGain("osc>pan_mod");
        this.nodes.lfo1PanAmt.gain = this.paramValue("lfo1PanAmt");
        //lfo1.connect(this.nodes.lfo1PanAmt);
        this.nodes.lfo1PanAmt.connectFrom(lfo1);

        // lfo2PanAmt
        this.nodes.lfo2PanAmt = new DFSynthTools.OptimalGainer(this.audioCtx, "osc>pan_mod");// this.audioCtx.createGain("osc>pan_mod");
        this.nodes.lfo2PanAmt.gain = this.paramValue("lfo2PanAmt");
        //lfo2.connect(this.nodes.lfo2PanAmt);
        this.nodes.lfo2PanAmt.connectFrom(lfo2);

        // env1PanAmt
        this.nodes.env1PanAmt = new DFSynthTools.OptimalGainer(this.audioCtx, "osc>pan_mod");//this.audioCtx.createGain("osc>pan_mod");
        this.nodes.env1PanAmt.gain = this.paramValue("env1PanAmt");
        //env1.connect(this.nodes.env1PanAmt);
        this.nodes.env1PanAmt.connectFrom(env1);

        // panner (see threeNodesOptimizer)

        this.nodes.threeNodesOptimizer = new FM4OscThreeNodeOptimizer({
            audioCtx: this.audioCtx,
            initialPanValue: this.GetPanBaseValue(),
            envGainer: this.nodes.envGainer,
            lfo1LevelAmt: this.nodes.lfo1LevelAmt,
            lfo2LevelAmt: this.nodes.lfo2LevelAmt,
            lfo1PanAmt: this.nodes.lfo1PanAmt,
            lfo2PanAmt: this.nodes.lfo2PanAmt,
            env1PanAmt: this.nodes.env1PanAmt,
        });

        // allow FM and output connections
        this.outputNode = this.nodes.threeNodesOptimizer;
        this.inputNode = this.nodes.osc;

        this.audioCtx.endScope();
        this.isConnected = true;
    }

    disconnect() {
        if (!this.isConnected) return;

        Object.keys(this.nodes).forEach(k => {
            let n = this.nodes[k];
            if (n.stop) n.stop();
            n.disconnect();
            if (n.destroy) n.destroy(); // for PWM oscillator
        });
        this.nodes = {};

        // reset FM and output connections
        this.outputNode = null;
        this.inputNode = null;

        this.isConnected = false;
    }

    _setOscWaveform() {
        const shapes = ["sine", "square", "sawtooth", "triangle", "pwm"];
        this.nodes.osc.type =shapes[this.paramValue("wave")];
    }

    GetPanBaseValue() {
        return DF.baseClamp(
            this.paramValue("pan") + (this.instrumentSpec.GetParamByID("pan_spread").currentValue * this.variationFactor),
            -1, 1
        );
    }

    // account for key & vel scaling
    updateEnvPeakLevel() {
        let vsAmt = this.paramValue("vel_scale");
        let vs = 1.0 - DF.remap(this.velocity, 0.0, 128.0, vsAmt, -vsAmt); // when vsAmt is 0, the range of vsAmt,-vsAmt is 0. hence making this 1.0-x
        let ksAmt = this.paramValue("key_scale");
        const halfKeyScaleRangeSemis = 12 * 4;
        let ks = 1.0 - DF.remap(this.midiNote, 60.0 /* middle C */ - halfKeyScaleRangeSemis, 60.0 + halfKeyScaleRangeSemis, ksAmt, -ksAmt); // when vsAmt is 0, the range of vsAmt,-vsAmt is 0. hence making this 1.0-x
        let p = this.paramValue("level") * ks * vs;
        //this.nodes.envPeak.gain.linearRampToValueAtTime(p, this.audioCtx.currentTime + this.minGlideS);
        this.nodes.envPeak.gain.value = p;
    }

    updateBaseFreq() {
        if (!this.isConnected) return;
        if (!this.baseFreq) return;
        let portamentoDurationS = this.isPoly ? 0 : this.paramValue("portamento");
        // for some reason, calling exponentialRampToValueAtTime or linearRampToValueAtTime will make a sudden jump of the current value. setTargetAtTime is the only one that works smoothly.
        let realFreq = this.baseFreq * this.paramValue("freq_mult");
        let midiNote = DF.FrequencyToMidiNote(realFreq);
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
                this.nodes.env1SemisAmt.gain = this.paramValue("env1_pitchDepth");
                break;
            case "lfo1_pitchDepth":
                this.nodes.lfo1SemisAmt.gain = this.paramValue("lfo1_pitchDepth");
                break;
            case "lfo2_pitchDepth":
                this.nodes.lfo2SemisAmt.gain = this.paramValue("lfo2_pitchDepth");
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
                this.nodes.threeNodesOptimizer.SetBasePanValue(this.GetPanBaseValue());
                break;
            case "lfo1PanAmt":
                this.nodes.lfo1PanAmt.gain = newVal;
                break;
            case "lfo2PanAmt":
                this.nodes.lfo2PanAmt.gain = newVal;
                break;
            case "env1PanAmt":
                this.nodes.env1PanAmt.gain = newVal;
                break;
            case "lfo1_gainAmt":
                this.nodes.lfo1LevelAmt.gain = newVal;
                break;
            case "lfo2_gainAmt":
                this.nodes.lfo2LevelAmt.gain = newVal;
                break;
            case "pwm_base":
                this.nodes.osc.width.value = newVal;
                break;
            case "pwmLFO1":
                this.nodes.lfo1PWMAmt.gain = newVal;
                break;
            case "pwmLFO2":
                this.nodes.lfo2PWMAmt.gain = newVal;
                break;
            case "pwmENV":
                this.nodes.env1PWMAmt.gain = newVal;
                break;
        }
    }
}


module.exports = {
    MiniFMSynthOsc,
};

