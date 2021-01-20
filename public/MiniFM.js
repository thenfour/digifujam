'use strict';



class MiniFMSynthOsc {
    constructor(audioCtx, destination, instrumentSpec, paramPrefix) {
        this.instrumentSpec = instrumentSpec;
        this.audioCtx = audioCtx;
        this.destination = destination;
        this.paramPrefix = paramPrefix;

        this.midiNote = 0;
        this.velocity = 0;
        this.timestamp = null; // when did the note on start?
        this.isPhysicallyHeld = false; // differentiate notes sustaining due to pedal or physically playing

        this.isConnected = false;
    }

    paramValue(paramID) {
        return this.instrumentSpec.GetParamByID(this.paramPrefix + paramID).currentValue;
    }

    // lfo1 is -1 to 1 range
    // lfo1_01 is 0 to 1 range.
    connect(lfo1, lfo1_01, env1) {
        /*
        each oscillator has                                                          


                                                                                                      |gain          |gain
                                                                                |lfogain          [lfo1PanAmt]+[env1PanAmt]
                                                                            [lfo1LevelAmt]                    |
        [env1 0 to 1]-->[env1FreqAmt] -->                                      |gain                          |pan
         [lfo-1 to 1]-->[lfo1FreqAmt] --> [osc] ----> [envGainer]   ---> [lfo1gainer]  ------------------> [panner]  ---> dest
                                                        | <gain>
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
        this.envPeak.gain.linearRampToValueAtTime(p, ClientSettings.InstrumentParamIntervalMS / 1000);;
    }

    updateOscFreq() {
        let freq = this.getFreqs();
        this.osc.frequency.linearRampToValueAtTime(freq[0], ClientSettings.InstrumentParamIntervalMS / 1000);
        this.lfo1FreqAmt.gain.linearRampToValueAtTime(freq[1], ClientSettings.InstrumentParamIntervalMS / 1000);
        this.env1FreqAmt.gain.linearRampToValueAtTime(freq[2], ClientSettings.InstrumentParamIntervalMS / 1000);
    }

    noteOn(midiNote, velocity) {
        this.midiNote = midiNote;
        this.velocity = velocity;
        this.updateEnvPeakLevel();
        let freq = this.getFreqs();
        this.osc.frequency.setValueAtTime(freq[0], 0);
        this.lfo1FreqAmt.gain.setValueAtTime(freq[1], 0);
        this.env1FreqAmt.gain.setValueAtTime(freq[2], 0);
        //console.log(`setting env1 freq amt to ${freq[2]}`);
        this.env.trigger();
    }

    release() {
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
        switch (strippedParamID) {
            case "wave":
                this._setOscWaveform();
                break;
            case "env1_pitchDepth":
            case "lfo1_pitchDepth":
            case "freq_mult":
            case "freq_abs":
                this.updateOscFreq();
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
                this.panner.pan.linearRampToValueAtTime(newVal, ClientSettings.InstrumentParamIntervalMS / 1000);
                break;
            case "lfo1PanAmt":
                this.lfo1PanAmt.gain.linearRampToValueAtTime(newVal, ClientSettings.InstrumentParamIntervalMS / 1000);
                break;
            case "env1PanAmt":
                this.env1PanAmt.gain.linearRampToValueAtTime(newVal, ClientSettings.InstrumentParamIntervalMS / 1000);
                break;
            case "lfo1_gainAmt":
                this.lfo1LevelAmt.gain.linearRampToValueAtTime(newVal, ClientSettings.InstrumentParamIntervalMS / 1000);
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
    constructor(audioCtx, destination, instrumentSpec) {
        this.instrumentSpec = instrumentSpec;
        this.audioCtx = audioCtx;
        this.destination = destination;

        this.midiNote = 0;
        this.velocity = 0;
        this.timestamp = null; // when did the note on start?
        this.isPhysicallyHeld = false; // differentiate notes sustaining due to pedal or physically playing

        this.oscillators = [
            new MiniFMSynthOsc(audioCtx, destination, instrumentSpec, "osc0_"),
            new MiniFMSynthOsc(audioCtx, destination, instrumentSpec, "osc1_"),
        ];

        this.modulationGainers = [];

        this.isConnected = false;
    }

    connect() {
        if (this.isConnected) return;

        /*
        
        [lfo1]--------------------------------->[child oscillators] --> [masterDryGain]
                             |                                      
        [lfo1Offset] -------> [lfo1_01]---->
                                  [env1]------->
        
        */

        // lfo1
        this.lfo1 = this.audioCtx.createOscillator();
        this._setLFOWaveform();
        this.lfo1.frequency.value = this.instrumentSpec.GetParamByID("lfo1_speed").currentValue;
        this.lfo1.start();

        // lfo1Offset
        this.lfo1Offset = this.audioCtx.createConstantSource();
        this.lfo1Offset.offset.value = 1.0;

        // lfo1_01
        this.lfo1_01 = this.audioCtx.createGain();
        this.lfo1_01.gain.value = .5;
        this.lfo1Offset.connect(this.lfo1_01);
        this.lfo1.connect(this.lfo1_01);

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
        this.oscillators.forEach(o => o.connect(this.lfo1, this.lfo1_01, this.env1));

        // masterDryGain
        this.masterDryGain = this.audioCtx.createGain();
        this.masterDryGain.gain.value = this.instrumentSpec.GetParamByID("masterGain").currentValue;

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
                break;

            case 1:
                this.oscillators[0].outputNode.connect(this.masterDryGain);
                this.oscillators[1].outputNode.connect(this.masterDryGain);
                break;
            default:
                console.log(`unknown algorithm ${algo}`);
                break;
        }

        // connect to outside.
        this.masterDryGain.connect(this.destination);
        this.isConnected = true;
    }

    disconnect() {
        this.AllNotesOff();
        if (!this.isConnected) return;

        this.lfo1.stop();
        this.lfo1.disconnect();
        this.lfo1 = null;

        this.lfo1Offset.disconnect();
        this.lfo1Offset = null;

        this.masterDryGain.disconnect();
        this.masterDryGain = null;

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

    _setLFOWaveform() {
        const shapes = ["sine", "square", "sawtooth", "triangle", "sine"];
        this.lfo1.type = shapes[this.instrumentSpec.GetParamByID("lfo1_wave").currentValue];
    }


    get IsPlaying() {
        return !!this.timestamp;
    }

    SetParamValue(paramID, newVal) {
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
                this.masterDryGain.gain.linearRampToValueAtTime(newVal, ClientSettings.InstrumentParamIntervalMS / 1000);
                break;
            case "algo": {
                this.disconnect();
                this.connect();
                break;
            }
            case "lfo1_wave": {
                this._setLFOWaveform();
                break;
            }
            case "lfo1_speed": {
                this.lfo1.frequency.linearRampToValueAtTime(newVal, ClientSettings.InstrumentParamIntervalMS / 1000);
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

    physicalAndMusicalNoteOn(midiNote, velocity) {
        this.isPhysicallyHeld = true;
        this.timestamp = new Date();
        this.midiNote = midiNote;
        this.velocity = velocity;

        this.env1.trigger();
        this.oscillators.forEach(o => {
            o.noteOn(midiNote, velocity);
        });
    }

    physicallyRelease() {
        this.isPhysicallyHeld = false;
    }

    musicallyRelease() {
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
        this.isPhysicallyHeld = false;
        this.velocity = 0;
    }

};
