'use strict';

const PolySynthSettings = {
    MaxVoices: 10
};

let FrequencyFromMidiNote = function (midiNote) {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
};


//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class PolySynthVoice {
    constructor(audioCtx, destination, instrumentSpec) {
        this.instrumentSpec = instrumentSpec;
        this.audioCtx = audioCtx;
        this.destination = destination;

        this.midiNote = 0;
        this.velocity = 0;
        this.timestamp = null; // when did the note on start?
        this.isPhysicallyHeld = false; // differentiate notes sustaining due to pedal or physically playing

        this.detune = this.instrumentSpec.GetParamByID("detune").currentValue;
        this.cutoff = this.instrumentSpec.GetParamByID("cutoff").currentValue;

        this.isConnected = false;
        this.peakGain = 0.017;
    }

    connect() {
        if (this.isConnected) return;

        // create graph nodes
        this.oscillator1 = this.audioCtx.createOscillator();
        this.oscillator2 = this.audioCtx.createOscillator();
        this.oscillator3 = this.audioCtx.createOscillator();

        this.osc1Panner = this.audioCtx.createStereoPanner();
        this.osc2Panner = this.audioCtx.createStereoPanner();
        this.osc3Panner = this.audioCtx.createStereoPanner();

        this.gainEnvelope = ADSRNode(this.audioCtx, { // https://github.com/velipso/adsrnode
            attack: this.instrumentSpec.GetParamByID("a").currentValue,//0.008, // seconds until hitting 1.0
            peak: this.peakGain, // why must this be so low? not sure...
            decay: this.instrumentSpec.GetParamByID("d").currentValue,//4.0, // seconds until hitting sustain value
            decayCurve: 6.8, // https://rawgit.com/voidqk/adsrnode/master/demo.html
            sustain: this.instrumentSpec.GetParamByID("s").currentValue,//0.0, // sustain value
            release: this.instrumentSpec.GetParamByID("r").currentValue,// 0.07  // seconds until returning back to 0.0
            releaseCurve: 6.8,
        });
        this.gainEnvelope.start();//gain.value = 0.0;  // Mute the sound  // this thing does not like to be started more than once even with stop() in between

        this.gain = this.audioCtx.createGain();
        this.gain.gain.value = 0; // a base value before controlled by adsr

        this.filter = this.audioCtx.createBiquadFilter();

        // create graph geometry (R to L
        this.oscillator1.connect(this.osc1Panner);
        this.oscillator2.connect(this.osc2Panner);
        this.oscillator3.connect(this.osc3Panner);

        this.osc1Panner.connect(this.gain);
        this.osc2Panner.connect(this.gain);
        this.osc3Panner.connect(this.gain);

        this.gainEnvelope.connect(this.gain.gain);

        this.gain.connect(this.filter);

        this.filter.connect(this.destination);

        // init node params
        this.oscillator1.start(0);  // Go ahead and start up the oscillator
        this.oscillator2.start(0);  // Go ahead and start up the oscillator
        this.oscillator3.start(0);  // Go ahead and start up the oscillator

        this.osc1Panner.pan.value = -.5;
        this.osc2Panner.pan.value = 0.0;
        this.osc3Panner.pan.value = +.5;

        this._setOscWaveform(this.instrumentSpec.GetParamByID("wave").currentValue);

        this.filter.frequency.value = 2500;
        this.filter.type = "lowpass";
        this.filter.Q.value = this.instrumentSpec.GetParamByID("q").currentValue;

        this.isConnected = true;
    }

    disconnect() {
        this.panic();
        if (!this.isConnected) return;

        this.gainEnvelope.stop();

        this.oscillator1.stop();
        this.oscillator2.stop();
        this.oscillator3.stop();

        //this.osc1Panner.stop();
        //this.osc2Panner.stop();
        //this.osc3Panner.stop();
        this.gainEnvelope.stop();
        //this.gain.stop();
        //this.filter.stop();

        this.oscillator1.disconnect();
        this.oscillator2.disconnect();
        this.oscillator3.disconnect();

        this.osc1Panner.disconnect();
        this.osc2Panner.disconnect();
        this.osc3Panner.disconnect();

        this.gainEnvelope.disconnect();

        this.gain.disconnect();

        this.filter.disconnect();

        // set to null
        this.gainEnvelope = null;
        this.oscillator1 = null;
        this.oscillator2 = null;
        this.oscillator3 = null;
        this.osc1Panner = null;
        this.osc2Panner = null;
        this.osc3Panner = null;
        this.gainEnvelope = null;
        this.gain = null;
        this.filter = null;

        this.isConnected = false;
    }

    get IsPlaying() {
        return !!this.timestamp;
    }

    _setOscWaveform(specVal) {
        const shapes = ["sine", "square", "sawtooth", "triangle", "sine"];
        this.oscillator1.type = shapes[specVal];
        this.oscillator2.type = shapes[specVal];
        this.oscillator3.type = shapes[specVal];
    }

    SetParamValue(param, newVal) {
        switch (param.paramID) {
            case "detune":
                this.detune = newVal;
                this.oscillator1.frequency.linearRampToValueAtTime(FrequencyFromMidiNote(this.midiNote + this.detune), ClientSettings.InstrumentParamIntervalMS / 1000);
                this.oscillator2.frequency.linearRampToValueAtTime(FrequencyFromMidiNote(this.midiNote), ClientSettings.InstrumentParamIntervalMS / 1000);
                this.oscillator3.frequency.linearRampToValueAtTime(FrequencyFromMidiNote(this.midiNote - this.detune), ClientSettings.InstrumentParamIntervalMS / 1000);
                break;
            case "wave":
                this._setOscWaveform(newVal);
                break;
            case "q":
                this.filter.Q.linearRampToValueAtTime(param.currentValue, ClientSettings.InstrumentParamIntervalMS / 1000);
                break;
            case "cutoff":
                this.cutoff = param.currentValue;
                this.filter.frequency.linearRampToValueAtTime((this.velocity / 128) * this.cutoff, ClientSettings.InstrumentParamIntervalMS / 1000);
                break;
            case "pbrange":
                break;
            case "a":
                this.gainEnvelope.update({ attack: newVal });
                break;
            case "d":
                this.gainEnvelope.update({ decay: newVal });
                break;
            case "s":
                this.gainEnvelope.update({ sustain: newVal * this.peakGain });
                break;
            case "r":
                this.gainEnvelope.update({ release: newVal });
                break;
        }
    }

    physicalAndMusicalNoteOn(midiNote, velocity) {
        this.isPhysicallyHeld = true;
        this.timestamp = new Date();
        this.midiNote = midiNote;
        this.velocity = velocity;

        //this.oscillator.frequency.cancelScheduledValues(0);
        this.filter.frequency.value = (velocity / 128) * this.cutoff

        this.oscillator1.frequency.setValueAtTime(FrequencyFromMidiNote(midiNote + this.detune), 0);
        this.oscillator2.frequency.setValueAtTime(FrequencyFromMidiNote(midiNote), 0);
        this.oscillator3.frequency.setValueAtTime(FrequencyFromMidiNote(midiNote - this.detune), 0);

        //this.filterEnvelope.trigger();
        this.gainEnvelope.trigger();
    }

    physicallyRelease() {
        this.isPhysicallyHeld = false;
    }

    musicallyRelease() {
        this.timestamp = null;
        this.midiNote = 0;

        //this.filterEnvelope.release();
        this.gainEnvelope.release();
    }

    panic() {
        if (this.gainEnvelope) this.gainEnvelope.reset();
        this.midiNote = 0;
        this.timestamp = null;
        this.isPhysicallyHeld = false;
    }

};

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class PolySynth {
    constructor(audioCtx, destination, instrumentSpec) {
        this.destination = destination;
        this.instrumentSpec = instrumentSpec;

        this.voices = [];
        for (let i = 0; i < PolySynthSettings.MaxVoices; ++i) {
            this.voices.push(new PolySynthVoice(audioCtx, destination, instrumentSpec));
        }
        this.isSustainPedalDown = false;
        this.isConnected = false;
    }

    connect() {
        this.voices.forEach(v => { v.connect(); });
        this.isConnected = true;
    }

    disconnect() {
        this.AllNotesOff();
        this.voices.forEach(v => { v.disconnect(); });
        this.isConnected = false;
    }

    NoteOn(midiNote, velocity) {
        if (!this.isConnected) this.connect();

        // find a free voice and delegate.
        let suitableVoice = null;

        for (let i = 0; i < this.voices.length; ++i) {
            let v = this.voices[i];
            if (!v.IsPlaying) {
                suitableVoice = v; // found a free voice; use it.
                break;
            }

            // voice is playing, but in this case find the oldest voice.
            if (!suitableVoice) {
                suitableVoice = v;
            } else {
                if (v.timestamp < suitableVoice.timestamp) {
                    suitableVoice = v;
                }
            }
        }

        suitableVoice.physicalAndMusicalNoteOn(midiNote, velocity);
    }

    NoteOff(midiNote) {
        if (!this.isConnected) this.connect();

        let v = this.voices.find(v => v.midiNote == midiNote);
        if (!v) return;
        v.physicallyRelease();
        if (!this.isSustainPedalDown) {
            v.musicallyRelease();
        }
    }

    PedalDown() {
        if (!this.isConnected) this.connect();

        this.isSustainPedalDown = true;
    }

    PedalUp() {
        if (!this.isConnected) this.connect();

        this.isSustainPedalDown = false;
        this.voices.forEach(v => {
            if (!v.isPhysicallyHeld && v.IsPlaying) {
                v.musicallyRelease();
            }
        });
    }

    AllNotesOff() {
        this.voices.forEach(v => v.panic());
    }

    PitchBend(val) {
        // todo
    }

    SetParamValue(param, newVal) {
        if (!this.isConnected) this.connect();
        this.voices.forEach(v => v.SetParamValue(param, newVal));
    }

};



