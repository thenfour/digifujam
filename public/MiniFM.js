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

    connect() {
        /*
        each oscillator has

        [fbOsc] -> [fb_gain] -><freq>[OSC] ----> [outp_gain]
                                                  | <gain>
                                [env]--> [envGain]

         params:
         - fb_amt feedback amt (fb_gain.gain)
         - freq_mult
         - freq_abs
         - level output level
         - vel_scale output vel scale
         - a
         - d
         - s
         - r
        */
        if (this.isConnected) return;

        this.outp_gain = this.audioCtx.createGain();
        this.outp_gain.gain.value = 0.0;

        this.osc = this.audioCtx.createOscillator();
        this.osc.type = "sine";
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

        this.envGain = this.audioCtx.createGain();
        this.envGain.gain.value = this.paramValue("level");

        this.fb_gain = this.audioCtx.createGain();
        this.fb_gain.gain.value = this.paramValue("fb_amt");

        this.osc.connect(this.fb_gain);
        this.fb_gain.connect(this.osc.frequency);

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

        this.fb_gain.disconnect();
        this.fb_gain = null;

        this.outp_gain.disconnect();
        this.outp_gain = null;

        this.envGain.disconnect();
        this.envGain = null;

        // reset FM and output connections
        this.outputNode = null;
        this.inputNode = null;

        this.isConnected = false;
    }

    getFreq() {
        let pbsemis = this.instrumentSpec.GetParamByID("pb").currentValue;
        let ret = FrequencyFromMidiNote(this.midiNote + pbsemis) * this.paramValue("freq_mult") + this.paramValue("freq_abs");
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
        let freq = this.getFreq();
        this.osc.frequency.linearRampToValueAtTime(freq, ClientSettings.InstrumentParamIntervalMS / 1000);
    }

    noteOn(midiNote, velocity) {
        this.midiNote = midiNote;
        this.velocity = velocity;
        this.updateEnvPeakLevel();
        let freq = this.getFreq();
        this.osc.frequency.setValueAtTime(freq, 0);
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
            case "fb_amt":
                this.fb_gain.gain.linearRampToValueAtTime(this.paramValue("fb_amt"), ClientSettings.InstrumentParamIntervalMS / 1000);
                break;
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
        this.oscillators.forEach(o => o.connect());

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
            default:
                console.log(`unknown algorithm ${algo}`);
                break;
        }

        this.isConnected = true;
    }

    disconnect() {
        this.AllNotesOff();
        if (!this.isConnected) return;

        this.oscillators.forEach(o => o.disconnect());

        this.modulationGainers.forEach(m => {
            m.disconnect();
        });
        this.modulationGainers = [];

        this.isConnected = false;
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

        this.oscillators.forEach(o => {
            o.noteOn(midiNote, velocity);
        });
    }

    physicallyRelease() {
        this.isPhysicallyHeld = false;
    }

    musicallyRelease() {
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
