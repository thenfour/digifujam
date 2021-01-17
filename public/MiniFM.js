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

    connect(lfo1, env1) {
        /*
        each oscillator has

        [env1 0 to 1]-->[env1FreqAmt] -->
         [lfo-1 to 1]-->[lfo1FreqAmt] --> [OSC] -----------> [outp_gain]
                                                               | <gain>
                                                   [env]--> [envGain]

         params:
         - wave
         - freq_mult
         - freq_abs
         - level output level
         - vel_scale output vel scale
         - a
         - d
         - s
         - r

         UNFORTUNATELY the webaudio oscillator does not have a way to self-feedback or modulate phase. it can feedback on its frequency, but that's not working like an FM synth.
         maybe we can hack together some waveshaping to give a continuous alterantive; for now "waveform" select is enough.

        */
        if (this.isConnected) return;

        this.lfo1FreqAmt = this.audioCtx.createGain();
        this.lfo1FreqAmt.gain.value = 1.0;// this cannot be set when there's no note on, because the param is in semitones but this node is in frequency. it must be set for every note on.

        this.env1FreqAmt = this.audioCtx.createGain();
        this.env1FreqAmt.gain.value = 1.0;// this cannot be set when there's no note on, because the param is in semitones but this node is in frequency. it must be set for every note on.

        this.outp_gain = this.audioCtx.createGain();
        this.outp_gain.gain.value = 0.0;

        this.osc = this.audioCtx.createOscillator();
        this._setOscWaveform();
        this.osc.start();

        this.env = ADSRNode(this.audioCtx, { // https://github.com/velipso/adsrnode
            attack: this.paramValue("a"),
            peak: 1.0, // why must this be so low? not sure...
            decay: this.paramValue("d"),
            decayCurve: 6.8, // https://rawgit.com/voidqk/adsrnode/master/demo.html
            sustain: this.paramValue("s"),
            release: this.paramValue("r"),
            releaseCurve: 6.8,
        });
        this.env.start();

        lfo1.connect(this.lfo1FreqAmt);
        this.lfo1FreqAmt.connect(this.osc.frequency);

        env1.connect(this.env1FreqAmt);
        this.env1FreqAmt.connect(this.osc.frequency);

        this.envGain = this.audioCtx.createGain();
        this.envGain.gain.value = this.paramValue("level");

        this.env.connect(this.envGain);
        this.osc.connect(this.outp_gain);
        this.envGain.connect(this.outp_gain.gain);

        // allow FM and output connections
        this.outputNode = this.outp_gain;
        this.inputNode = this.osc;

        this.isConnected = true;
    }

    disconnect() {
        if (!this.isConnected) return;

        this.env.stop();
        this.env.disconnect();
        this.env = null;

        this.osc.stop();
        this.osc.disconnect();
        this.osc = null;

        this.outp_gain.disconnect();
        this.outp_gain = null;

        this.envGain.disconnect();
        this.envGain = null;

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
        let vel01 = this.velocity / 128; // 0 - 1 velocity.
        let scaling = this.paramValue("vel_scale"); // when this is 0, we want to output 1. when this is 1, output vel01
        scaling = remap(scaling, 0, 1, 1, vel01);
        let p = this.paramValue("level") * scaling;
        this.envGain.gain.linearRampToValueAtTime(p, ClientSettings.InstrumentParamIntervalMS / 1000);;
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

        // set up our framework around oscillators.
        this.lfo1 = this.audioCtx.createOscillator();
        this._setLFOWaveform();
        this.lfo1.frequency.value = this.instrumentSpec.GetParamByID("lfo1_speed").currentValue;
        this.lfo1.start();

        this.env1 = ADSRNode(this.audioCtx, { // https://github.com/velipso/adsrnode
            attack: this.instrumentSpec.GetParamByID("env1_a").currentValue,
            peak: 1.0,
            decay: this.instrumentSpec.GetParamByID("env1_d").currentValue,
            decayCurve: 6.8, // https://rawgit.com/voidqk/adsrnode/master/demo.html
            sustain: this.instrumentSpec.GetParamByID("env1_s").currentValue,
            release: this.instrumentSpec.GetParamByID("env1_r").currentValue,
            releaseCurve: 6.8,
        });
        this.env1.start();

        this.oscillators.forEach(o => o.connect(this.lfo1, this.env1));

        // set up algo
        let algo = this.instrumentSpec.GetParamByID("algo").currentValue;

        switch (parseInt(algo)) {
            case 0:
                let m0 = this.audioCtx.createGain();
                this.modulationGainers.push(m0);
                m0.gain.value = 10000;

                // 0 => 1
                this.oscillators[0].outp_gain.connect(m0);
                m0.connect(this.oscillators[1].inputNode.frequency);

                // 1 => dest
                this.oscillators[1].outp_gain.connect(this.destination);
                break;

            case 1:
                this.oscillators[0].outp_gain.connect(this.destination);
                this.oscillators[1].outp_gain.connect(this.destination);
                break;
            default:
                console.log(`unknown algorithm ${algo}`);
                break;
        }

        this.isConnected = true;
    }

    disconnect() {
        this.AllNotesOff();
        if (!this.isConnected) return;

        this.lfo1.stop();
        this.lfo1.disconnect();
        this.lfo1 = null;

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
        if (paramID.startsWith("osc")) {
            let oscid = parseInt(paramID[3]);
            this.oscillators[oscid].SetParamValue(paramID.substring(5), newVal);
            return;
        }
        switch (paramID) {
            case "pb":
                this.PitchBend(newVal);
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
        if (this.env1) this.env1.stop();
        this.oscillators.forEach(o => {
            o.AllNotesOff();
        });
        this.midiNote = 0;
        this.timestamp = null;
        this.isPhysicallyHeld = false;
        this.velocity = 0;
    }

};
