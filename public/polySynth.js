'use strict';


//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class GeneralPolySynth {
    constructor(audioCtx, dryDestination, wetDestination, instrumentSpec, createVoiceFn) {
        this.audioCtx = audioCtx;
        this.dryDestination = dryDestination;
        this.wetDestination = wetDestination;
        this.instrumentSpec = instrumentSpec;

        this.minGlideS = ClientSettings.InstrumentParamIntervalMS / 1000;

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
        if (this.isConnected) return;
        // [LFO1] ------------------------------------> (voices)
        //           |
        //           `->[lfo1Offset] ---> [lfo1_01] -->
        // [LFO2] ------------------------------------>
        //           |
        //           `->[lfo2Offset] ---> [lfo2_01] -->

        // lfo1
        this.lfo1 = this.audioCtx.createOscillator();
        //this._setLFOWaveforms();
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


        // lfo2
        this.lfo2 = this.audioCtx.createOscillator();
        this._setLFOWaveforms();
        this.lfo2.frequency.value = this.instrumentSpec.GetParamByID("lfo2_speed").currentValue;
        this.lfo2.start();

        // lfo2Offset
        this.lfo2Offset = this.audioCtx.createConstantSource();
        this.lfo2Offset.offset.value = 1.0;

        // lfo2_01
        this.lfo2_01 = this.audioCtx.createGain();
        this.lfo2_01.gain.value = .5;
        this.lfo2Offset.connect(this.lfo2_01);
        this.lfo2.connect(this.lfo2_01);

        this.isPoly = (this.instrumentSpec.GetParamByID("voicing").currentValue == 1);
        if (this.isPoly) {
            this.voices.forEach(v => {
                v.connect(this.lfo1, this.lfo1_01, this.lfo2, this.lfo2_01);
            });
        } else {
            this.isPoly = false;
            this.voices[0].connect(this.lfo1, this.lfo1_01, this.lfo2, this.lfo2_01);
        }
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

        this.lfo1_01.disconnect();
        this.lfo1_01 = null;


        this.lfo2.stop();
        this.lfo2.disconnect();
        this.lfo2 = null;

        this.lfo2Offset.disconnect();
        this.lfo2Offset = null;

        this.lfo2_01.disconnect();
        this.lfo2_01 = null;

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

    _setLFOWaveforms() {
        const shapes = ["sine", "square", "sawtooth", "triangle", "sine"];
        this.lfo1.type = shapes[this.instrumentSpec.GetParamByID("lfo1_wave").currentValue];
        this.lfo2.type = shapes[this.instrumentSpec.GetParamByID("lfo2_wave").currentValue];
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
                                    this.voices[i].connect(this.lfo1, this.lfo1_01, this.lfo2, this.lfo2_01);
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
                case "lfo1_wave":
                case "lfo2_wave":
                    this._setLFOWaveforms();
                    break;
                case "lfo1_speed": {
                    this.lfo1.frequency.linearRampToValueAtTime(patchObj[paramID], this.audioCtx.currentTime + this.minGlideS);
                    break;
                }
                case "lfo2_speed": {
                    this.lfo2.frequency.linearRampToValueAtTime(patchObj[paramID], this.audioCtx.currentTime + this.minGlideS);
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



