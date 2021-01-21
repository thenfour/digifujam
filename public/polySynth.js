'use strict';


//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class PolySynthVoice {
    constructor(audioCtx, dryDestination, wetDestination, instrumentSpec) {
        this.instrumentSpec = instrumentSpec;
        this.audioCtx = audioCtx;
        this.dryDestination = dryDestination;
        this.wetDestination = wetDestination;

        this.midiNote = 0;
        this.velocity = 0;
        this.pitchBend = 0; // semitones

        this.timestamp = null; // when did the note on start?

        this.detune = this.instrumentSpec.GetParamByID("detune").currentValue;
        this.cutoff = this.instrumentSpec.GetParamByID("cutoff").currentValue;

        this.isConnected = false;
        this.peakGain = 0.017;
    }

    connect() {
        if (this.isConnected) return;

        /*

            [oscillator1]-->[osc1Panner]------->
            [oscillator2]-->[osc2Panner]------->
            [oscillator3]-->[osc3Panner]------->[gain] --> [filter] --> [masterDryGain] --> 
                                                |                    > [masterWetGain] --> 
                                                |gain
                            [gainEnvelope]----->
        
        */

        // oscillators
        this.oscillator1 = this.audioCtx.createOscillator();
        this.oscillator2 = this.audioCtx.createOscillator();
        this.oscillator3 = this.audioCtx.createOscillator();
        this._setOscWaveform(this.instrumentSpec.GetParamByID("wave").currentValue);
        this.oscillator1.start(0);  // Go ahead and start up the oscillator
        this.oscillator2.start(0);  // Go ahead and start up the oscillator
        this.oscillator3.start(0);  // Go ahead and start up the oscillator

        // panners
        this.osc1Panner = this.audioCtx.createStereoPanner();
        this.oscillator1.connect(this.osc1Panner);
        this.osc2Panner = this.audioCtx.createStereoPanner();
        this.oscillator2.connect(this.osc2Panner);
        this.osc3Panner = this.audioCtx.createStereoPanner();
        this.oscillator3.connect(this.osc3Panner);
        this.osc1Panner.pan.value = -.5;
        this.osc2Panner.pan.value = 0.0;
        this.osc3Panner.pan.value = +.5;

        // gainEnvelope
        this.gainEnvelope = ADSRNode(this.audioCtx, { // https://github.com/velipso/adsrnode
            attack: this.instrumentSpec.GetParamByID("a").currentValue,//0.008, // seconds until hitting 1.0
            peak: this.peakGain, // why must this be so low? not sure...
            decay: this.instrumentSpec.GetParamByID("d").currentValue,//4.0, // seconds until hitting sustain value
            decayCurve: 6.8, // https://rawgit.com/voidqk/adsrnode/master/demo.html
            sustain: this.instrumentSpec.GetParamByID("s").currentValue * this.peakGain,//0.0, // sustain value
            release: this.instrumentSpec.GetParamByID("r").currentValue,// 0.07  // seconds until returning back to 0.0
            releaseCurve: 6.8,
        });
        this.gainEnvelope.start();//gain.value = 0.0;  // Mute the sound  // this thing does not like to be started more than once even with stop() in between

        // gain
        this.gain = this.audioCtx.createGain();
        this.gain.gain.value = 0; // a base value before controlled by adsr
        this.gainEnvelope.connect(this.gain.gain);
        this.osc1Panner.connect(this.gain);
        this.osc2Panner.connect(this.gain);
        this.osc3Panner.connect(this.gain);

        // filter
        this.filter = this.audioCtx.createBiquadFilter();
        this.gain.connect(this.filter);
        this.filter.type = "lowpass";
        this.filter.frequency.value = 2500; // will be set on note on.
        this.filter.Q.value = this.instrumentSpec.GetParamByID("q").currentValue;

        // masterDryGain
        this.masterDryGain = this.audioCtx.createGain();
        // masterWetGain
        this.masterWetGain = this.audioCtx.createGain();
        let gainLevels = this.getGainLevels();
        this.masterDryGain.gain.value = gainLevels[0];
        this.masterWetGain.gain.value = gainLevels[1];

        this.filter.connect(this.masterDryGain);
        this.filter.connect(this.masterWetGain);

        // connect out.
        this.masterDryGain.connect(this.dryDestination);
        this.masterWetGain.connect(this.wetDestination);

        this.isConnected = true;
    }

    disconnect() {
        this.AllNotesOff();
        if (!this.isConnected) return;

        this.gainEnvelope.stop();

        this.oscillator1.stop();
        this.oscillator2.stop();
        this.oscillator3.stop();

        this.gainEnvelope.stop();

        this.oscillator1.disconnect();
        this.oscillator2.disconnect();
        this.oscillator3.disconnect();

        this.osc1Panner.disconnect();
        this.osc2Panner.disconnect();
        this.osc3Panner.disconnect();

        this.gainEnvelope.disconnect();

        this.gain.disconnect();

        this.filter.disconnect();

        this.masterDryGain.disconnect();
        this.masterDryGain = null;

        this.masterWetGain.disconnect();
        this.masterWetGain = null;

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

    // returns [drygain, wetgain]
    getGainLevels() {
        let ms = this.instrumentSpec.GetParamByID("masterGain").currentValue;
        let vg = this.instrumentSpec.GetParamByID("verbMix").currentValue;
        // when verb mix is 0, drygain is the real master gain.
        // when verb mix is 1, drygain is 0 and verbmix is mastergain
        return [(1.0 - vg) * ms, vg * ms * 1.3]; // multiply verb gain to compensate, try and make wet as loud as dry.
    }

    SetParamValue(paramID, newVal) {
        switch (paramID) {
            case "pb":
                this.PitchBend(newVal);
                break;
            case "masterGain":
            case "verbMix":
                let levels = this.getGainLevels();
                this.masterDryGain.gain.linearRampToValueAtTime(levels[0], ClientSettings.InstrumentParamIntervalMS / 1000);
                this.masterWetGain.gain.linearRampToValueAtTime(levels[1], ClientSettings.InstrumentParamIntervalMS / 1000);
                break;
            case "detune":
                this.detune = newVal;
                let freqs = this._getOscFreqs();
                this.oscillator1.frequency.linearRampToValueAtTime(freqs[0], ClientSettings.InstrumentParamIntervalMS / 1000);
                this.oscillator2.frequency.linearRampToValueAtTime(freqs[1], ClientSettings.InstrumentParamIntervalMS / 1000);
                this.oscillator3.frequency.linearRampToValueAtTime(freqs[2], ClientSettings.InstrumentParamIntervalMS / 1000);
                break;
            case "wave":
                this._setOscWaveform(newVal);
                break;
            case "q":
                this.filter.Q.linearRampToValueAtTime(newVal, ClientSettings.InstrumentParamIntervalMS / 1000);
                break;
            case "cutoff":
                this.cutoff = newVal;
                this.filter.frequency.linearRampToValueAtTime((this.velocity / 128) * this.cutoff, ClientSettings.InstrumentParamIntervalMS / 1000);
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

    _getOscFreqs() {
        return [
            FrequencyFromMidiNote(this.pitchBend + this.midiNote + this.detune),
            FrequencyFromMidiNote(this.pitchBend + this.midiNote),
            FrequencyFromMidiNote(this.pitchBend + this.midiNote - this.detune),
        ];
    }

    PitchBend(val /*semis*/) {
        this.pitchBend = val;//((val / 0x3fff) * 2) - 1;
        let freqs = this._getOscFreqs();
        this.oscillator1.frequency.linearRampToValueAtTime(freqs[0], ClientSettings.InstrumentParamIntervalMS / 1000);
        this.oscillator2.frequency.linearRampToValueAtTime(freqs[1], ClientSettings.InstrumentParamIntervalMS / 1000);
        this.oscillator3.frequency.linearRampToValueAtTime(freqs[2], ClientSettings.InstrumentParamIntervalMS / 1000);
    }

    physicalAndMusicalNoteOn(midiNote, velocity) {
        this.timestamp = new Date();
        this.midiNote = midiNote;
        this.velocity = velocity;

        this.filter.frequency.value = (velocity / 128) * this.cutoff;

        let freqs = this._getOscFreqs();
        this.oscillator1.frequency.setValueAtTime(freqs[0], 0);
        this.oscillator2.frequency.setValueAtTime(freqs[1], 0);
        this.oscillator3.frequency.setValueAtTime(freqs[2], 0);

        this.gainEnvelope.trigger();
    }

    musicallyRelease() {
        this.timestamp = null;
        this.midiNote = 0;

        //this.filterEnvelope.release();
        this.gainEnvelope.release();
    }

    AllNotesOff() {
        if (this.gainEnvelope) this.gainEnvelope.reset();
        this.midiNote = 0;
        this.timestamp = null;
        this.velocity = 0;
        this.pitchBend = 0;
    }

};





// //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class GeneralPolySynth {
    constructor(audioCtx, dryDestination, wetDestination, instrumentSpec, createVoiceFn) {
        this.dryDestination = dryDestination;
        this.wetDestination = wetDestination;
        this.instrumentSpec = instrumentSpec;

        this.voices = [];
        for (let i = 0; i < instrumentSpec.maxPolyphony; ++i) {
            this.voices.push(createVoiceFn(audioCtx, dryDestination, wetDestination, instrumentSpec));
        }
        this.isSustainPedalDown = false;
        this.isConnected = false;

        this.isPoly = true; // poly or monophonic mode.

        this.physicallyHeldNotes = []; // array of [midiNote, velocity, voiceIndex] in order of note on.
    }

    connect() {
        this.isPoly = (this.instrumentSpec.GetParamByID("voicing").currentValue == 1);
        if (this.isPoly) {
            this.voices.forEach(v => { v.connect(); });
        } else {
            this.isPoly = false;
            this.voices[0].connect();
        }
        this.isConnected = true;
    }

    disconnect() {
        this.AllNotesOff();
        this.voices.forEach(v => { v.disconnect(); });
        this.isConnected = false;
    }

    // sent when there's a MIDI note on event.
    NoteOn(midiNote, velocity) {
        if (!this.isConnected) this.connect();

        // find a free voice and delegate.
        //let suitableVoice = null;
        let suitableVoiceIndex = -1;

        if (this.isPoly) {
            for (let i = 0; i < this.voices.length; ++i) {
                let v = this.voices[i];
                if (!v.IsPlaying) {
                    suitableVoiceIndex = i;// found a free voice; use it.
                    break;
                }

                // voice is playing, but in this case find the oldest voice.
                if (suitableVoiceIndex == -1) {
                    suitableVoiceIndex = i;
                } else {
                    if (v.timestamp < this.voices[suitableVoiceIndex].timestamp) {
                        suitableVoiceIndex = i;
                    }
                }
            }
            this.physicallyHeldNotes.push([midiNote, velocity, suitableVoiceIndex]);
            this.voices[suitableVoiceIndex].physicalAndMusicalNoteOn(midiNote, velocity, false);
        } else {
            // monophonic always just uses the 1st voice.
            suitableVoiceIndex = 0;
        }

        let isLegato = this.physicallyHeldNotes.length > 0;
        this.physicallyHeldNotes.push([midiNote, velocity, suitableVoiceIndex]);
        this.voices[suitableVoiceIndex].physicalAndMusicalNoteOn(midiNote, velocity, isLegato);
    }

    NoteOff(midiNote) {
        if (!this.isConnected) this.connect();

        this.physicallyHeldNotes.removeIf(n => n[0] == midiNote);
        if (this.isSustainPedalDown) return;

        if (this.isPoly) {
            let v = this.voices.find(v => v.midiNote == midiNote && v.IsPlaying);
            if (!v) return;
            v.musicallyRelease(midiNote);
            return;
        }

        // monophonic doesn't need a search.
        if (this.physicallyHeldNotes.length == 0) {
            this.voices[0].musicallyRelease(midiNote);
            return;
        }

        // if the note off is'nt the one the voice is currently playing then nothing else needs to be done.
        if (midiNote != this.voices[0].midiNote) {
            return;
        }

        // for monophonic here we always act like "triller" triggering. this lets oscillators pop the queue of freqs, 
        // and decide whether to trigger envelopes based on trigger behavior.
        let n = this.physicallyHeldNotes[this.physicallyHeldNotes.length - 1];
        this.voices[0].physicalAndMusicalNoteOn(n[0], n[1], true);
    }

    PedalDown() {
        if (!this.isConnected) this.connect();
        this.isSustainPedalDown = true;
    }

    VoiceIsPhysicalyHeld(voiceIndex) {
        return this.physicallyHeldNotes.find(x => x[2] == voiceIndex) != null;
    }

    PedalUp() {
        if (!this.isConnected) this.connect();
        this.isSustainPedalDown = false;
        // for each voice that's NOT physically held, but is playing, release the note.
        this.voices.forEach((v, vindex) => {
            if (v.IsPlaying && !this.VoiceIsPhysicalyHeld(vindex)) {
                v.musicallyRelease();
            }
        });
    }

    AllNotesOff() {
        this.physicallyHeldNotes = [];
        this.voices.forEach(v => v.AllNotesOff());
    }

    SetParamValues(patchObj) {
        let keys = Object.keys(patchObj);
        keys.forEach(paramID => {
            switch (paramID) {
                case "voicing":
                    {
                        let willBePoly = (patchObj[paramID] == 1);
                        if (!!willBePoly != !!this.isPoly) {
                            // transition from/to poly or monophonic.
                            this.isPoly = willBePoly;
                            if (willBePoly) {
                                // connect voices [1->]
                                for (let i = 1; i < this.voices.length; ++i) {
                                    this.voices[i].connect();
                                }
                            } else {
                                // disconnect voices [1->]
                                for (let i = 1; i < this.voices.length; ++i) {
                                    this.voices[i].disconnect();
                                }
                            }
                        }
                        break;
                    }
                default:
                    this.voices.forEach(voice => {
                        voice.SetParamValue(paramID, patchObj[paramID]);
                    });
                    break;
            }
        });
    };
};



