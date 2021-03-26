/*
layering/region selection:
- lokey
- hikey
- key
- hivel
- lovel

polyphony/choke groups:
- group=1
- off_by=1
- off_mode  "fast"=immediate release or "normal"=note-off; https://sfzformat.com/opcodes/off_mode

loop regions:
- loop_start
- loop_end
- loop_mode
- loop_crossfade [unsupported]

pitch:
- pitch_keycenter
- tune (aka pitch)

amplitude ADSR https://sfzformat.com/opcodes/ampeg_attack
- ampeg_attack
- ampeg_delay
- ampeg_decay
- ampeg_hold
- ampeg_release
- ampeg_start
- ampeg_sustain

todo:
- pitcheg_* pitch modulations etc.
- fileg_* filter modulation

*/

const DFSynthTools = require("./synthTools");

class SFZRegion {
    constructor(r) {
        Object.assign(this, r);
    }

    RegionMatches(midiNote, velocity) {
        if (('key' in this) && this.key != midiNote) return false;
        if ('lokey' in this) {
            if (midiNote < this.lokey) return false;
            if (('hikey' in this) && (midiNote > this.hikey)) return false;
        }
        if ('lovel' in this) {
            if (velocity < this.lovel) return false;
            if (('hivel' in this) && (velocity > this.hivel)) return false;
        }
        return true;
    };
    get AmpEG_Release() {
        if ('ampeg_release' in this) return this.ampeg_release;
        return 0;
    }

    // pitch:
    // - pitch_keycenter
    // - tune (aka pitch)    
    CalculateDetune(midiNote) {
        let detune = ('pitch_keycenter' in this) ? (midiNote - this.pitch_keycenter) : (midiNote - 60); // middle c
        return detune * 100;
    }
};


// filter, lfo, adsr, buffer
class sfzVoice {
    constructor(audioCtx, instrumentSpec, sampleLibrarian) {
        this.audioCtx = audioCtx;
        this.instrumentSpec = instrumentSpec;
        this.sampleLibrarian = sampleLibrarian;
        this.graph = new DFSynthTools.AudioGraphHelper();
    }

    get IsPlaying() {
        if (!this.isConnected) return false;
        if (this.timestamp) return true; // note is definitely playing.
        if (!this.noteOffTimestamp) return false;
        // note is off; check if we're still in envelope "release" stage.
        if ((Date.now() - this.noteOffTimestamp) < (this.sfzRegion.AmpEG_Release * 1000)) {
            return true;
        }
        this.noteOffTimestamp = null;
        this.sfzRegion = null;
        return false;
    }

    // timestamp

    connect(dest1, dest2) {
        console.assert(!this.isConnected);
        this.dest1 = dest1;
        this.dest2 = dest2;

        /*
        thing is, with SFZ, each region can have all its own params. so it must be done on noteon, not in connect().
                          -> dest1
        (buffer) -> (???) -> dest2
        */

        this.isConnected = true;
    }

    disconnect() {
        if (!this.isConnected) return;
        this.graph.disconnect();

        this.isConnected = false;
    }


    AllNotesOff() {
        this.midiNote = 0;
        this.timestamp = null;
        this.noteOffTimestamp = null;
        this.velocity = 0;
        this.sfzRegion = null;
        //if (this.nodes.env) this.nodes.env.reset();
    }

    getPitchBendSemis() {
        const pb = this.instrumentSpec.GetParamByID("pb");
        if (pb) return pb.currentValue;
        return 0;
    }

    physicalAndMusicalNoteOn(sfzRegion, midiNote, velocity) {
        this.timestamp = Date.now();
        this.midiNote = midiNote;
        this.velocity = velocity;
        this.sfzRegion = sfzRegion;

        // /*
        // create the playback node graph for this region to support its features.
        // (buffer)--> [envGainer]----> (--)
        //                   |<gain>
        //                   |
        //               [ampEG]
        // */
        //             //   - ampeg_attack
        //             //   - ampeg_delay
        //             //   - ampeg_decay
        //             //   - ampeg_hold
        //             //   - ampeg_release
        //             //   - ampeg_start
        //             //   - ampeg_sustain
                      
        //               // reset env params.

        // // envelope
        // this.graph.nodes.envGainer = this.audioCtx.createGain("sfz>envGainer");

        // this.graph.nodes.ampEG = ADSR.ADSRNode(this.audioCtx, { // https://github.com/velipso/adsrnode
        //     // attack:       0.2, // seconds until hitting peak value (default: 0)
        //     // peak:         9.0, // peak value (default: 1)
        //     // hold:         0.3, // seconds to hold at the peak value (default: 0)
        //     // decay:        0.4, // seconds until hitting sustain value (default: 0)
        //     // decayCurve:   5.0, // amount of curve for decay (default: 0)
        //     // sustain:      3.0, // sustain value (required)
        //     // release:      0.5, // seconds until returning back to base value (default: 0)
        //     // releaseCurve: 1.0  // amount of curve for release (default: 0)
        //     attack: this.paramValue("a"),
        //     peak: 1.0,
        //     decay: this.paramValue("d"),
        //     decayCurve: 3.5, // https://rawgit.com/voidqk/adsrnode/master/demo.html
        //     sustain: this.paramValue("s"),
        //     release: this.paramValue("r"),
        //     releaseCurve: 6.8,
        // });
        // this.graph.nodes.ampEG.start();
        // this.graph.nodes.ampEG.connect(this.graph.nodes.envGainer.gain);

        // this.nodes.env.trigger();

        // this.graph.nodes.envGainer.connect(this.graph.nodes.velGainer);

        // set velgainer

        this.bufferSourceNode = this.audioCtx.createBufferSource();
        this.bufferSourceNode.buffer = sfzRegion.buffer;

        // detune & playbackRate are the only ways to control the pitch.
        const detune = sfzRegion.CalculateDetune(midiNote + this.getPitchBendSemis());
        this.bufferSourceNode.detune.value = detune;

        //console.log(`play ${midiNote} detune ${detune} sample: ${sfzRegion.sample}`);

        this.bufferSourceNode.connect(this.graph.nodes.envGainer);
        this.bufferSourceNode.start();
    }

    musicallyRelease() {
        if (!this.timestamp) {
            return; // some odd synth state can cause releases without note ons (pedal up after taking the instrument for example)
        }
        this.graph.nodes.ampEG.release();

        this.timestamp = null;
        //this.sfzRegion = null; <-- dont kill this while noteOffTimestamp is still there
        this.noteOffTimestamp = Date.now();
        this.midiNote = 0;
        this.velocity = 0;
    }

    ParamHasChanged(paramID) {
        if (!this.isConnected) return;
        switch (paramID) {
            case "pb":
                if (this.sfzRegion && this.bufferSourceNode) {
                    this.bufferSourceNode.detune.value = this.sfzRegion.CalculateDetune(this.midiNote + this.getPitchBendSemis());
                }
                break;
            default:
                console.log(`unknown param ${paramID}`);
                break;
        }
    };
}; // class sfzVoice


////////////////////////////////////////////////////////////////////////////////////////////////////////////
class sfzInstrument {
    constructor(audioCtx, dryDestination, wetDestination, instrumentSpec, sampleLibrarian) {
        this.audioCtx = audioCtx;
        this.dryDestination = dryDestination;
        this.wetDestination = wetDestination;
        this.instrumentSpec = instrumentSpec;
        this.sampleLibrarian = sampleLibrarian;
        this.isConnected = false;
        this.regions = null; // later, populated with the SFZ region opcodes
        this.hasStartedLoading = false; // on first connect, we load.
        this.hasCompletedLoading = false;

        this.voices = [];
        for (let i = 0; i < instrumentSpec.maxPolyphony; ++i) {
            this.voices.push(new sfzVoice(audioCtx, instrumentSpec, sampleLibrarian));
        }

        this.isSustainPedalDown = false;
        this.physicallyHeldNotes = []; // array of {note, sfzRegion, voiceIndex} in order of note on.

        this.graph = new DFSynthTools.AudioGraphHelper();
    }

    connect() {
        if (this.isConnected) return true;
        if (this.hasStartedLoading && !this.hasCompletedLoading) return false;// loading still in progress
        if (!this.hasStartedLoading) {
            this.hasStartedLoading = true;
            this.pendingLoads = 0; // how many samples are in "loading" state.
            this.regions = [];
            DFSynthTools.AjaxJSON(this.instrumentSpec.sfzURL, regions => {
                let baseURL = this.instrumentSpec.sfzURL;
                baseURL = baseURL.substring(0, baseURL.lastIndexOf("/") + 1);
                this.instrumentSpec.sfzRegions = regions;//.map(r => new SFZRegion(r));
                regions.forEach(r => {
                    // for each region, load up the sample it references
                    this.pendingLoads++;
                    const sampleURL = baseURL + r.sample;
                    this.sampleLibrarian.loadSampleFromURL(sampleURL, (buffer) => {
                        // save this sample buffer somewhere.
                        let reg = new SFZRegion(r);// Object.assign({}, r);
                        reg.buffer = buffer;
                        this.regions.push(reg);
                        this.pendingLoads--;
                        if (!this.pendingLoads) {
                            this.hasCompletedLoading = true;
                            console.log(`Finished loading instrument ${this.instrumentSpec.instrumentID}`);
                            this.connect();
                        }
                    });
                });
            });
            return false;
        }

        /*
        (voices) --> [wetGainer] -> wetDestination
                   > [dryGainer] -> dryDestination
        */
        let gainLevels = this.getGainLevels();

        this.graph.nodes.dryGainer = this.audioCtx.createGain("sfz>master");
        this.graph.nodes.wetGainer = this.audioCtx.createGain("sfz>master");
        this.graph.nodes.dryGainer.gain.value = gainLevels[0];
        this.graph.nodes.wetGainer.gain.value = gainLevels[1];

        this.graph.nodes.dryGainer.connect(this.dryDestination);
        this.graph.nodes.wetGainer.connect(this.wetDestination);

        this.voices.forEach(v => {
            v.connect(this.graph.nodes.dryGainer, this.graph.nodes.wetGainer);
        });

        this.isConnected = true;
        return true;
    }

    disconnect() {
        this.isConnected = false;
        this.graph.disconnect();
        this.AllNotesOff();
    }

    AllNotesOff() {
        this.physicallyHeldNotes = [];
        this.isSustainPedalDown = false;
        this.voices.forEach(v => {
            v.AllNotesOff();
        });
    }

    // returns [drygain, wetgain]
    getGainLevels() {
        let ms = this.instrumentSpec.GetParamByID("masterGain").currentValue;
        let vg = this.instrumentSpec.GetParamByID("verbMix").currentValue;
        // when verb mix is 0, drygain is the real master gain.
        // when verb mix is 1, drygain is 0 and verbmix is mastergain
        return [(1.0 - vg) * ms, vg * ms * 1.];
    }



    NoteOn(midiNote, velocity) {
        if (!this.connect()) return;

        // find a SFZ region.
        const sfzRegion = this.regions.find(r => r.RegionMatches(midiNote, velocity));
        if (!sfzRegion) return;

        // find a free voice and delegate.
        let suitableVoiceIndex = -1;

        for (let i = 0; i < this.voices.length; ++i) {
            let v = this.voices[i];
            if (!v.IsPlaying) {
                suitableVoiceIndex = i;// found a free voice; use it.
                break;
            }

            // voice is playing; in this case find the oldest voice.
            if (suitableVoiceIndex == -1) {
                suitableVoiceIndex = i;
            } else {
                if (v.timestamp < this.voices[suitableVoiceIndex].timestamp) {
                    suitableVoiceIndex = i;
                }
            }
        }
        this.physicallyHeldNotes.push({
            note: midiNote,
            sfzRegion,
            voiceIndex: suitableVoiceIndex
        });
        this.voices[suitableVoiceIndex].physicalAndMusicalNoteOn(sfzRegion, midiNote, velocity);
    };

    NoteOff(midiNote) {
        if (!this.connect()) return;

        this.physicallyHeldNotes.removeIf(n => n.note === midiNote);
        if (this.isSustainPedalDown) return;

        let v = this.voices.find(v => v.midiNote == midiNote && v.IsPlaying);
        if (v) {
            v.musicallyRelease();
        }
    };

    PedalDown() {
        if (!this.connect()) return;
        this.isSustainPedalDown = true;
    };

    PedalUp() {
        if (!this.connect()) return;
        this.isSustainPedalDown = false;
        // for each voice that's NOT physically held, but is playing, release the note.
        this.voices.forEach((v, vindex) => {
            if (v.IsPlaying && !this.VoiceIsPhysicalyHeld(vindex)) {
                v.musicallyRelease();
            }
        });
    };

    VoiceIsPhysicalyHeld(voiceIndex) {
        return this.physicallyHeldNotes.find(x => x.voiceIndex == voiceIndex) != null;
    }

    SetParamValues(patchObj) {
        if (!this.isConnected) return;
        Object.keys(patchObj).forEach(paramID => {
            switch (paramID) {
                case "masterGain":
                case "verbMix":
                    let levels = this.getGainLevels();
                    this.graph.nodes.dryGainer.gain.value = levels[0];
                    this.graph.nodes.wetGainer.gain.value = levels[1];
                    break;
                default:
                    this.voices.forEach(voice => {
                        voice.ParamHasChanged(paramID);
                    });
                    break;
            }
        });
    };
};



module.exports = sfzInstrument;

