'use strict';

const PolySynthSettings = {
    MaxVoices: 16
};

let FrequencyFromMidiNote = function (midiNote) {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
};


class PolySynthVoice {
    constructor(audioCtx, destination, instrumentSpec) {
        //this.destination = destination;
        //this.audioCtx = audioCtx;
        this.instrumentSpec = instrumentSpec;

        this.midiNote = 0;
        this.timestamp = null; // when did the note on start?
        this.isPhysicallyHeld = false; // differentiate notes sustaining due to pedal or physically playing

        // create graph nodes
        this.oscillator1 = audioCtx.createOscillator();
        this.oscillator2 = audioCtx.createOscillator();
        this.oscillator3 = audioCtx.createOscillator();

        this.osc1Panner = audioCtx.createStereoPanner();
        this.osc2Panner = audioCtx.createStereoPanner();
        this.osc3Panner = audioCtx.createStereoPanner();

        this.gainEnvelope = ADSRNode(audioCtx, { // https://github.com/velipso/adsrnode
            attack: 0.008, // seconds until hitting 1.0
            peak: 0.017,
            decay: 4.0, // seconds until hitting sustain value
            decayCurve: 6.8, // https://rawgit.com/voidqk/adsrnode/master/demo.html
            sustain: 0.0, // sustain value
            release: 0.07  // seconds until returning back to 0.0
        });

        this.filterEnvelope = ADSRNode(audioCtx, { // https://github.com/velipso/adsrnode
            attack: 0.0, // seconds until hitting 1.0
            peak: 6000,
            decay: 3.0, // seconds until hitting sustain value
            decayCurve: 6.8, // https://rawgit.com/voidqk/adsrnode/master/demo.html
            sustain: 0.0, // sustain value
            release: 1  // seconds until returning back to 0.0
        });

        this.gain = audioCtx.createGain();
        this.gain.gain.value = 0; // a base value before controlled by adsr

        this.filter = audioCtx.createBiquadFilter();

        // create graph geometry (R to L
        this.oscillator1.connect(this.osc1Panner);
        this.oscillator2.connect(this.osc2Panner);
        this.oscillator3.connect(this.osc3Panner);

        this.osc1Panner.connect(this.gain);
        this.osc2Panner.connect(this.gain);
        this.osc3Panner.connect(this.gain);

        this.gainEnvelope.connect(this.gain.gain);

        this.gain.connect(this.filter);

        //this.filterEnvelope.connect(this.filter.frequency);
        this.filter.connect(destination);

        // init node params
        this.filterEnvelope.start();//gain.value = 0.0;  // Mute the sound
        this.gainEnvelope.start();//gain.value = 0.0;  // Mute the sound

        this.oscillator1.start(0);  // Go ahead and start up the oscillator
        this.oscillator2.start(0);  // Go ahead and start up the oscillator
        this.oscillator3.start(0);  // Go ahead and start up the oscillator

        this.osc1Panner.pan.value = -.5;
        this.osc2Panner.pan.value = 0.0;
        this.osc3Panner.pan.value = +.5;

        this.oscillator1.type = "square";
        this.oscillator2.type = "square";
        this.oscillator3.type = "square";

        this.filter.frequency.value = 2500;
        this.filter.type = "lowpass";
        this.filter.Q.value = 1.0;

        this.detune = 0.05;
    }

    get IsPlaying() {
        return !!this.timestamp;
    }

    physicalAndMusicalNoteOn(midiNote, velocity) {
        this.isPhysicallyHeld = true;
        this.timestamp = new Date();
        this.midiNote = midiNote;

        //this.oscillator.frequency.cancelScheduledValues(0);
        this.oscillator1.frequency.setValueAtTime(FrequencyFromMidiNote(midiNote + this.detune), 0);
        this.oscillator2.frequency.setValueAtTime(FrequencyFromMidiNote(midiNote), 0);
        this.oscillator3.frequency.setValueAtTime(FrequencyFromMidiNote(midiNote - this.detune), 0);

        this.filterEnvelope.trigger();
        this.gainEnvelope.trigger();
    }

    physicallyRelease() {
        this.isPhysicallyHeld = false;
    }

    musicallyRelease() {
        this.timestamp = null;
        this.midiNote = 0;

        this.filterEnvelope.release();
        this.gainEnvelope.release();
    }

    panic() {
        this.filterEnvelope.reset();
        this.gainEnvelope.reset();
        this.midiNote = 0;
        this.timestamp = null;
        this.isPhysicallyHeld = false;
    }
};

class PolySynth {
    constructor(audioCtx, destination, instrumentSpec) {
        //this.destination = destination;
        this.instrumentSpec = instrumentSpec;

        // create an instrument fx chain
        // TODO: why doesn't this work? produces silence.
        //this.masterBitcrush = new AudioWorkletNode(audioCtx, "bit-crusher-processor");
        //this.masterBitcrush.connect(destination);

        this.voices = [];
        for (let i = 0; i < PolySynthSettings.MaxVoices; ++i) {
            this.voices.push(new PolySynthVoice(audioCtx, destination, instrumentSpec));
        }
        this.isSustainPedalDown = false;
    }

    NoteOn(midiNote, velocity) {
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
        let v = this.voices.find(v => v.midiNote == midiNote);
        if (!v) return;
        v.physicallyRelease();
        if (!this.isSustainPedalDown) {
            v.musicallyRelease();
        }
    }

    PedalDown() {
        this.isSustainPedalDown = true;
    }

    PedalUp() {
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
};



