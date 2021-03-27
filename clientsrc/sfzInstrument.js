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

filter:
- fil_type: lpf_1p, hpf_1p, lpf_2p, hpf_2p, bpf_2p, brf_2p, 
- cutoff: "1998.54",
- resonance: "0.5",

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
const DFU = require('./dfutil');
const ADSR = require("./adhsr");

const GLOBAL_SFZ_GAIN = 0.2;


class SFZRegion {
    constructor(r) {
        Object.assign(this, r);
        // guarantee certain properties.
        this.noteRangeSpec = this.CalculateNoteRangeSpec();
        this.velocityRangeSpec = this.CalculateVelocityRangeSpec();
        this.ampEGSpec = this.CalculateAmpEGSpec();
        this.loopSpec = this.CalculateLoopSpec();

        this.isRedundant = false; // L/R pairs: this gets set to true for the R region, so it doesn't ever match directly. Let the L region match.
        this.correspondingRegion = null; // L/R pairs: L gets this set to the R region.

        if (!('pitch_keycenter' in this)) {
            if ('key' in this) {// https://sfzformat.com/opcodes/key
                this.pitch_keycenter = this.key;
            } else {
                this.pitch_keycenter = 60;
            }
        }

        this.midiFrequencyCenter = DFU.MidiNoteToFrequency(this.pitch_keycenter);
        this.tune = this.GetOpcodeVal('tune', 0);
        this.filterSpec = this.CalculateFilterSpec();
        this.pan = this.GetOpcodeVal('pan', 0);
        this.pan /= 100; // to be consistent with web audio.
    }

    CalculateFilterSpec() {
        if (!('fil_type' in this) || !('cutoff' in this)) return null;
        const ret = {
            cutoff: this.GetOpcodeVal('cutoff', 0),
            q: this.GetOpcodeVal('resonance', 0),
        };

        // lpf_1p, hpf_1p, lpf_2p, hpf_2p, bpf_2p, brf_2p, 
        if (this.fil_type.startsWith('lpf')) ret.type = 'lowpass';
        else if (this.fil_type.startsWith('hpf')) ret.type = 'highpass';
        else if (this.fil_type.startsWith('bpf')) ret.type = 'bandpass';
        else if (this.fil_type.startsWith('brf')) ret.type = 'notch';
        else return null;

        return ret;
    };

    CalculateLoopSpec() {
        /*
        - loop_mode
        - loop_start
        - loop_end

        no_loop: no looping will be performed. Sample will play straight from start to end, or until note off, whatever reaches first.
        <not needed> one_shot: sample will play from start to end, ignoring note off. This is commonly used for drums. This mode is engaged automatically if the count opcode is defined.
        loop_continuous: once the player reaches sample loop point, the loop will play until note expiration. This includes looping during the release phase.
        loop_sustain: the player will play the loop while the note is held, by keeping it depressed or by using the sustain pedal (CC64). During the release phase, there’s no looping.
        */
        if (!('loop_start' in this) || !('loop_end' in this)) return null; // looping only works with both set.
        if (this.loop_mode == 'one_shot') return null; // one-shot is sorta redundant and really isn't relevant to looping.
        if (this.loop_mode == 'no_loop') return null;
        return {
            start: this.loop_start,
            end: this.loop_end,
            stopLoopOnRelease: this.loop_mode === 'loop_sustain',
        };
    }

    CalculateNoteRangeSpec() {
        if ('lokey' in this) {
            if ('hikey' in this) {
                return [this.lokey, this.hikey];
            }
            return [this.lokey, 127];
        }
        if ('hikey' in this) {
            return [0, this.hikey];
        }
        if ('key' in this) {
            return [this.key, this.key];
        }
        return [0, 127];
    }

    CalculateVelocityRangeSpec() {
        if ('lovel' in this) {
            if ('hivel' in this) {
                return [this.lovel, this.hivel];
            }
            return [this.lovel, 127];
        }
        if ('hivel' in this) {
            return [0, this.hivel];
        }
        if ('vel' in this) {
            return [this.vel, this.vel];
        }
        return [0, 127];
    }

    GetOpcodeVal(opcodeName, defaultValue) {
        if (opcodeName in this) return this[opcodeName];
        return defaultValue;
    }

    CalculateAmpEGSpec() {
        const ret = {
            base: 0, // 
            attack: this.GetOpcodeVal('ampeg_attack', 0),
            attackCurve: 0, // linear https://sfzformat.com/opcodes/ampeg_attack
            peak: 1,
            hold: this.GetOpcodeVal('ampeg_hold', 0),
            decay: this.GetOpcodeVal('ampeg_decay', 0),
            decayCurve: 3.5,
            sustain: this.GetOpcodeVal('ampeg_sustain', 1),
            release: this.GetOpcodeVal('ampeg_release', -1), // if this is <0, consider the sample a one-shot.
            releaseCurve: 3.5,
        };
        /*
        amplitude ADSR https://sfzformat.com/opcodes/ampeg_attack
        - ampeg_delay  <-- currently unsupported

        {
        ampeg_start       base:         5.0, // starting/ending value (default: 0)
        ampeg_attack      attack:       0.2, // seconds until hitting peak value (default: 0)
                          attackCurve:  0.0, // amount of curve for attack (default: 0)
                          peak:         9.0, // peak value (default: 1)
        ampeg_hold        hold:         0.3, // seconds to hold at the peak value (default: 0)
        ampeg_decay       decay:        0.4, // seconds until hitting sustain value (default: 0)
                          decayCurve:   5.0, // amount of curve for decay (default: 0)
        ampeg_sustain     sustain:      3.0, // sustain value (required)
        ampeg_release     release:      0.5, // seconds until returning back to base value (default: 0)
                          releaseCurve: 1.0  // amount of curve for release (default: 0)
        }*/
        return ret;
    }

    // pitch:
    // - pitch_keycenter
    // - tune (aka pitch)    
    CalculateDetune(midiNote) {
        const ret = {
            detuneCents: ((midiNote - this.pitch_keycenter) * 100) + this.tune,
        };
        ret.midiFrequency = DFU.MidiNoteToFrequency(this.pitch_keycenter + (ret.detuneCents / 100));
        ret.playbackRatio = this.midiFrequencyCenter / ret.midiFrequency;
        return ret;
    }

    RegionMatches(midiNote, velocity) {
        if (this.isRedundant) return false;
        if (midiNote < this.noteRangeSpec[0]) return false;
        if (midiNote > this.noteRangeSpec[1]) return false;
        if (velocity < this.velocityRangeSpec[0]) return false;
        if (velocity > this.velocityRangeSpec[1]) return false;
        return true;
    };
};

function IsVeryCloseTo(a, b) {
    return Math.abs(a - b) < 0.001;
}

// there are regions which are stereo L/R pairs; we want to group them up because we don't support playing multiple regions at once,
// and this is a common idiom.
function PreprocessSFZRegions(regions) {
    regions.forEach(leftRegion => {
        // if this is a left sample, and we can find a corresponding right sample, link them
        // and mark the right same as redundant.
        if (!IsVeryCloseTo(leftRegion.pan, -1)) return false;
        let rightRegion = regions.find(r => {
            if (!IsVeryCloseTo(r.pan, 1)) return false;
            if ('key' in leftRegion && leftRegion.key != r.key) return false;
            if ('lovel' in leftRegion && leftRegion.lovel != r.lovel) return false;
            if ('hivel' in leftRegion && leftRegion.hivel != r.hivel) return false;
            if ('lokey' in leftRegion && leftRegion.lokey != r.lokey) return false;
            if ('hikey' in leftRegion && leftRegion.hikey != r.hikey) return false;
            return true;
        }); // find rightRegion

        if (!rightRegion) return false;

        // found a match.
        rightRegion.isRedundant = true;
        leftRegion.correspondingRegion = rightRegion;
    });
};



// filter, lfo, adsr, buffer
class sfzVoice {
    constructor(audioCtx, instrumentSpec, sampleLibrarian) {
        this.audioCtx = audioCtx;
        this.instrumentSpec = instrumentSpec;
        this.sampleLibrarian = sampleLibrarian;
        this.graph = new DFSynthTools.AudioGraphHelper();
        this.perfGraph = new DFSynthTools.AudioGraphHelper();
        this.isConnected = false;
    }

    get IsPlaying() {
        if (!this.isConnected) return false;
        if (this.timestamp) return true; // note is definitely playing.
        if (!this.noteOffTimestamp) return false;
        // note is off; check if we're still in envelope "release" stage.

        let releaseLength = this.sfzRegion.ampEGSpec.release;
        if (this.sfzRegion.ampEGSpec.release < 0) {
            // if release is a one-shot style (inf), then the release len is the whole length of the sample.
            releaseLength = this.sfzRegion.buffer.duration;
        }

        // stretch the duration based on the rate it was played at.
        releaseLength *= this.playbackRatio;

        if ((Date.now() - this.noteOffTimestamp) < (releaseLength * 1000)) {
            return true;
        }
        this.noteOffTimestamp = null;
        this.sfzRegion = null;
        return false;
    }

    // timestamp

    connect(dest1, dest2) {
        if (this.isConnected) {
            let a = 0;
        }
        console.assert(!this.isConnected);

        this.dest1 = dest1;
        this.dest2 = dest2;

        /*
            with SFZ, each region can have all its own params. so it must be done on noteon, not in connect().
        */

        this.isConnected = true;
    }

    disconnect() {
        if (!this.isConnected) return;
        this.graph.disconnect();
        this.perfGraph.disconnect();

        this.isConnected = false;
    }

    AllNotesOff() {
        this.perfGraph.disconnect();
        this.midiNote = 0;
        this.timestamp = null;
        this.noteOffTimestamp = null;
        this.velocity = 0;
        this.sfzRegion = null;
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

        this.perfGraph.disconnect();

        /*
        thing is, with SFZ, each region can have all its own params. so it must be done on noteon, not in connect().

                                                                       -> dest1
        (bufferL) -> [panL] -> [envGainer] ----> [velGain] -> [filter] -> dest2
        (bufferR) -> [panR] ->       |<gain> 
                                     |
                                  [ampEG]
        */

        this.bufferSourceNode1 = null;
        this.bufferSourceNode2 = null;

        // source buffers & panners
        const detuneSpec = sfzRegion.CalculateDetune(midiNote + this.getPitchBendSemis());
        this.playbackRatio = detuneSpec.playbackRatio; // needed to calculate the correct duration of the sample

        this.perfGraph.nodes.pan1 = this.audioCtx.createStereoPanner("sfz>pan1");
        this.perfGraph.nodes.pan1.pan.value = sfzRegion.pan;

        this.bufferSourceNode1 = this.audioCtx.createBufferSource();
        this.bufferSourceNode1.buffer = sfzRegion.buffer;
        this.bufferSourceNode1.detune.value = detuneSpec.detuneCents;
        if (sfzRegion.loopSpec) {
            this.bufferSourceNode1.loop = true;
            this.bufferSourceNode1.loopStart = sfzRegion.loopSpec.start;
            this.bufferSourceNode1.loopEnd = sfzRegion.loopSpec.end;
        }
        this.bufferSourceNode1.connect(this.perfGraph.nodes.pan1);


        if (sfzRegion.correspondingRegion) {
            this.perfGraph.nodes.pan2 = this.audioCtx.createStereoPanner("sfz>pan2");
            this.perfGraph.nodes.pan2.pan.value = sfzRegion.correspondingRegion.pan;
            this.bufferSourceNode2 = this.audioCtx.createBufferSource();
            this.bufferSourceNode2.buffer = sfzRegion.correspondingRegion.buffer;
            this.bufferSourceNode2.detune.value = detuneSpec.detuneCents;
            if (sfzRegion.correspondingRegion.loopSpec) {
                this.bufferSourceNode2.loop = true;
                this.bufferSourceNode2.loopStart = sfzRegion.correspondingRegion.loopSpec.start;
                this.bufferSourceNode2.loopEnd = sfzRegion.correspondingRegion.loopSpec.end;
            }
            this.bufferSourceNode2.connect(this.perfGraph.nodes.pan2);
        }

        // envGainer / ADSR
        this.perfGraph.nodes.envGainer = this.audioCtx.createGain("sfz>envGainer");
        this.perfGraph.nodes.pan1.connect(this.perfGraph.nodes.envGainer);
        if (this.perfGraph.nodes.pan2) this.perfGraph.nodes.pan2.connect(this.perfGraph.nodes.envGainer);
        this.perfGraph.nodes.envGainer.gain.value = 0;

        this.perfGraph.nodes.ampEG = ADSR.ADSRNode(this.audioCtx, this.sfzRegion.ampEGSpec);
        this.perfGraph.nodes.ampEG.connect(this.perfGraph.nodes.envGainer.gain);
        this.perfGraph.nodes.ampEG.start();
        this.perfGraph.nodes.ampEG.trigger();

        // velGain
        this.perfGraph.nodes.velGain = this.audioCtx.createGain("sfz>velGain");
        this.perfGraph.nodes.envGainer.connect(this.perfGraph.nodes.velGain);
        this.perfGraph.nodes.velGain.gain.value = (velocity / 128) * GLOBAL_SFZ_GAIN;

        // filter
        if (sfzRegion.filterSpec) {
            this.perfGraph.nodes.filter = this.audioCtx.createBiquadFilter("sfz>filt");
            this.perfGraph.nodes.velGain.connect(this.perfGraph.nodes.filter);

            this.perfGraph.nodes.filter.frequency.value = sfzRegion.filterSpec.cutoff;
            this.perfGraph.nodes.filter.Q.value = sfzRegion.filterSpec.q;
            this.perfGraph.nodes.filter.type = sfzRegion.filterSpec.type;
            this.perfGraph.nodes.filter.connect(this.dest1);
            this.perfGraph.nodes.filter.connect(this.dest2);
        } else {
            this.perfGraph.nodes.velGain.connect(this.dest1);
            this.perfGraph.nodes.velGain.connect(this.dest2);
        }

        if (this.bufferSourceNode1) this.bufferSourceNode1.start();
        if (this.bufferSourceNode2) this.bufferSourceNode2.start();

    }

    musicallyRelease() {
        if (!this.timestamp) {
            return; // some odd synth state can cause releases without note ons (pedal up after taking the instrument for example)
        }
        if (this.perfGraph.nodes.ampEG) {
            this.perfGraph.nodes.ampEG.release();
        }

        if (this.sfzRegion.loopSpec && this.sfzRegion.loopSpec.stopLoopOnRelease) {
            this.bufferSourceNode1.loop = false;
        }
        if (this.sfzRegion.correspondingRegion && this.sfzRegion.correspondingRegion.loopSpec && this.sfzRegion.correspondingRegion.loopSpec.stopLoopOnRelease) {
            this.bufferSourceNode2.loop = false;
        }

        this.timestamp = null;
        //this.sfzRegion = null; <-- dont kill this while noteOffTimestamp is still there
        //this.midiNote = 0; <-- dont kill this while noteOffTimestamp is still there
        this.noteOffTimestamp = Date.now();
        this.velocity = 0;
    }

    ParamHasChanged(paramID) {
        if (!this.isConnected) return;
        switch (paramID) {
            case "pb":
                if (this.sfzRegion) {
                    const detuneCents = this.sfzRegion.CalculateDetune(this.midiNote + this.getPitchBendSemis()).detuneCents;
                    // don't bother setting this.playbackRatio; it will not be accurate
                    if (this.bufferSourceNode1) {
                        this.bufferSourceNode1.detune.value = detuneCents;
                    }
                    if (this.bufferSourceNode2) {
                        this.bufferSourceNode2.detune.value = detuneCents;
                    }
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
                            PreprocessSFZRegions(this.regions);
                            this.hasCompletedLoading = true;
                            console.log(`Finished loading instrument ${this.instrumentSpec.instrumentID}`);
                            this.connect();
                        }
                    }); // load sample
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

