/*

https://github.com/mohayonao/adsr-envelope


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
- ampeg_delay <-- not supported
- ampeg_decay
- ampeg_hold   <-- not supported
- ampeg_release
- ampeg_start
- ampeg_sustain

todo:
- pitcheg_* pitch modulations etc.
- fileg_* filter modulation

*/

const ADSREnvelope = require("adsr-envelope");
const DFSynthTools = require("./synthTools");
const DFU = require('./dfutil');

const GLOBAL_SFZ_GAIN = 0.5;

class ProgressSpec {
    constructor(progressCallback) {
        this.progressCallback = progressCallback;
        this.successes = 0;
        this.errors = 0;
        this.totalFiles = 0;
    }
    addTotal(n) {
        this.totalFiles += n;
        this.progressCallback(this);
    }

    addSuccesses(n) {
        this.successes += n;
        this.progressCallback(this);
    }

    addErrors(n) {
        this.errors += n;
        this.progressCallback(this);
    }

    ProgressPercent() {
        if (this.totalFiles <= 0) return 100;
        return Math.trunc((this.successes + this.errors) / this.totalFiles * 100);
    }

    isComplete() {
        return (this.successes + this.errors) >= this.totalFiles;
    }
}

const eLoadStatus = {
    Unknown: 0,
    InProgress: 1,
    Complete: 2,
};

class _SFZAssetLoader {
    constructor() {
        this.cacheStatus = {}; // map JSONURL to eLoadStatus
    }

    GetLoadStatus(jsonURL) {
        if (!(jsonURL in this.cacheStatus)) return eLoadStatus.Unknown;
        return this.cacheStatus[jsonURL];
    }

    CacheSFZAssets(sampleLibrarian, jsonURL, progressCallback, existingProgressSpec, onJSONLoadComplete, onJSONLoadError, onSampleLoadComplete, onSampleLoadError) {

        switch (this.GetLoadStatus(jsonURL)) {
            case eLoadStatus.Unknown:
                break;
            case eLoadStatus.InProgress: // fall through
            case eLoadStatus.Complete: // fall through
            default:
                throw new Exception(`Don't try to cache things more than once. It's innocent enough but if you're expecting progress callbacks and all that it's not so simple.`);
        }

        const progressSpec = existingProgressSpec || new ProgressSpec(progressCallback);
        progressSpec.addTotal(1);
        DFSynthTools.LoadCachedJSON(jsonURL, regions => {

            progressSpec.addSuccesses(1);

            const baseURL = jsonURL.substring(0, jsonURL.lastIndexOf("/") + 1); // get directory name + /
            regions.forEach(r => {
                r.sampleFullPath = baseURL + r.sample;
            });
            const sampleURLs = new Set(regions.map(region => region.sampleFullPath));

            onJSONLoadComplete && onJSONLoadComplete(regions);

            progressSpec.addTotal(sampleURLs.size);

            sampleURLs.forEach(sampleURL => {
                sampleLibrarian.loadSampleFromURL(sampleURL, buffer => {
                    //console.log(`Loaded sample successfully: ${sampleURL}`);
                    progressSpec.addSuccesses(1); // successfully loaded sample; it's available now in the cache.
                    onSampleLoadComplete && onSampleLoadComplete(sampleURL, buffer);
                }, _ => {
                    //console.log(`Error loading sample: ${sampleURL}`);
                    progressSpec.addErrors(1); // error loading sample
                    onSampleLoadError && onSampleLoadError(sampleURL);
                }); // load sample
            }); // iterate regions
        }, () => {
            progressSpec.addErrors(1);// error loading json.
            onJSONLoadError && onJSONLoadError(jsonURL);
        }); // load json
    }

    /*
        cacheLoadProgress.successes
        cacheLoadProgress.errors
        cacheLoadProgress.totalFiles
    */
    // instrumentSpecs is an array of instrumentSpec of sfz instruments.
    CacheAllSFZAssets(sampleLibrarian, instrumentSpecs, progressCallback) {
        const progressSpec = new ProgressSpec(progressCallback);

        const jsonURLs = new Set();
        instrumentSpecs.forEach(instrumentSpec => {
            instrumentSpec.sfzArray.forEach(i => {
                jsonURLs.add(i.sfzURL);
            })
        });

        jsonURLs.forEach(jsonURL => {
            this.CacheSFZAssets(sampleLibrarian, jsonURL, progressCallback, progressSpec,
                null,
                () => { // json load error
                    console.log(`Error loading JSON: ${jsonURL}`);
                },
                null,
                (sampleURL) => {
                    console.log(`Error loading sample: ${sampleURL}`);
                });
        })
    }
};

let SFZAssetLoader = new _SFZAssetLoader();



class SFZRegion {
    constructor(r, sfzItem) {
        Object.assign(this, r);
        // guarantee certain properties.
        this.buffer = null; // caller set this whenever
        this.noteRangeSpec = this.CalculateNoteRangeSpec(sfzItem);
        this.velocityRangeSpec = this.CalculateVelocityRangeSpec(sfzItem);
        this.ampEGSpec = this.CalculateAmpEGSpec(sfzItem);
        this.loopSpec = this.CalculateLoopSpec(sfzItem);

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
        this.filterSpec = this.CalculateFilterSpec(sfzItem);
        this.pan = this.GetOpcodeVal('pan', 0);
        this.pan /= 100; // to be consistent with web audio.
        this.pan = DFU.baseClamp(this.pan, -1, 1);

        this.volumeMul = this.GetTransformedOpcodeVal('volume', 1, v => DFU.DBToLinear(v));
    }

    GetTransformedOpcodeVal(opcodeName, defaultValue, transformProc) {
        if (opcodeName in this) return transformProc(this[opcodeName]);
        return defaultValue;
    }

    GetOpcodeVal(opcodeName, defaultValue) {
        if (opcodeName in this) return this[opcodeName];
        return defaultValue;
    }

    CalculateFilterSpec(sfzItem) {
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

        if ('filtCutoffMul' in sfzItem) {
            ret.cutoff *= sfzItem.filtCutoffMul;
        }

        return ret;
    };

    CalculateLoopSpec(sfzItem) {
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

        // see "C:\root\Dropbox\root\MUS\samples\soundfonts\sf2\aria_converted\ARIAConverted\sf2\ConcertGM0_97test3_sf2\000\000_Grand_Piano.sfz"
        // here, loop_start and loop_end are specified but they're clearly wrong.
        // according to the docs, if it's unspecified, we should also not loop. so...
        if (!('loop_mode') in this) return null;
        if (sfzItem.ignoreLoop) return null;

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

    CalculateAmpEGSpec(sfzItem) {
        const ret = {
            //base: 0, // 
            attack: this.GetOpcodeVal('ampeg_attack', 0),
            //attackCurve: 0, // linear https://sfzformat.com/opcodes/ampeg_attack
            //peak: 1,
            hold: this.GetOpcodeVal('ampeg_hold', 0),
            decay: this.GetOpcodeVal('ampeg_decay', 0),
            //decayCurve: 9,
            sustain: this.GetTransformedOpcodeVal('ampeg_sustain', 1, v => v / 100), // https://sfzformat.com/opcodes/ampeg_sustain in percentage (0-100)
            release: this.GetOpcodeVal('ampeg_release', -1), // if this is <0, consider the sample a one-shot.
            //releaseCurve: 9, // this feels about right
        };

        if (('sfzReleaseMul' in sfzItem) && (ret.release > 0)) {
            ret.release *= sfzItem.sfzReleaseMul;
        }
        if ('sfzForceOneShot' in sfzItem) {
            ret.release = -1;
        }
        //ret.decay *= 0.125;
        //ret.release *= 0.125;

        return {
            attackTime: ret.attack,
            decayTime: ret.decay * 0.8, // this just seems to be the right match.
            sustainLevel: ret.sustain,
            releaseTime: ret.release * 0.8, // this just seems to be the right match.
            decayCurve: "exp",
            releaseCurve: "exp",
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
        velocity = Math.trunc(velocity);
        if (velocity < this.velocityRangeSpec[0]) return false;
        if (velocity > this.velocityRangeSpec[1]) return false;
        return true;
    };
};

function IsVeryCloseTo(a, b) {
    return Math.abs(a - b) < 0.001;
}

// there are SFZRegion objects which are stereo L/R pairs; we want to group them up because we
// don't support playing multiple regions at once,
// and this is a common idiom.
function PreprocessSFZRegions(regions, sfzSpec) {

    // extend range if requested. basically for some 
    if (sfzSpec.sfzExtendRange) {
        // find low & high key ranges.
        let lokey = 127;
        let hikey = 0;
        regions.forEach(r => {
            lokey = Math.min(lokey, r.noteRangeSpec[0]);
            hikey = Math.max(hikey, r.noteRangeSpec[1]);
        });

        // now all regions which match these boundaries get extended.
        regions.forEach(r => {
            if (r.noteRangeSpec[0] == lokey) {
                r.noteRangeSpec[0] = 0;
            }
            if (r.noteRangeSpec[1] == hikey) {
                r.noteRangeSpec[1] = 127;
            }
        });
    }

    regions.forEach(leftRegion => {
        if (leftRegion.lokey == 59) {
            let a = 0;
        }
        // if this is a left sample, and we can find a corresponding right sample, link them
        // and mark the right same as redundant.
        if (!IsVeryCloseTo(leftRegion.pan, -1)) return false;
        let rightRegion = regions.find(r => {
            if (r.lokey == 59) {
                let a = 0;
            }
            if (!IsVeryCloseTo(r.pan, 1)) return false;

            if ('key' in leftRegion && leftRegion.key != r.key) return false;
            if ('lovel' in leftRegion && leftRegion.lovel != r.lovel) return false;
            if ('hivel' in leftRegion && leftRegion.hivel != r.hivel) return false;
            if ('lokey' in leftRegion && leftRegion.lokey != r.lokey) return false;
            if ('hikey' in leftRegion && leftRegion.hikey != r.hikey) return false;
            return true;
        }); // find rightRegion

        if (leftRegion.lokey == 59) {
            let a = 0;
        }

        if (!rightRegion) return false;

        // found a match.
        rightRegion.isRedundant = true;
        leftRegion.correspondingRegion = rightRegion;
    });
};



// filter, lfo, adsr, buffer
class sfzVoice {
    constructor(audioCtx, instrumentSpec, sampleLibrarian, myVoiceIndex) {
        this.audioCtx = audioCtx;
        this.instrumentSpec = instrumentSpec;
        this.sampleLibrarian = sampleLibrarian;
        this.graph = new DFSynthTools.AudioGraphHelper();
        this.perfGraph = new DFSynthTools.AudioGraphHelper();
        this.myVoiceIndex = myVoiceIndex;
        this.isConnected = false;
    }

    // used to match note on to note off.
    get IsPlaying() {
        if (!this.isConnected) return false;
        if (this.timestamp && this.midiNote) return true; // note is definitely playing.
    }

    GetAvailabilityScore() {
        // note free prio...
        // 1. released [time since note off]
        // 2. playing currently [time since note on]
        const now = Date.now();
        if (this.timestamp) {
            return ((now - this.timestamp) / 1000);
        }
        if (this.noteOffTimestamp) {
            return ((now - this.noteOffTimestamp) / 1000) + 100000;
        }
        return 999999;
    }

    connect(needsFilter, needsPan2) {
        if (this.isConnected) return;

        /*
        each region can have all its own params. so it must be done on noteon, not in connect().
 
                                                                       -> (dest1)
        (bufferL) -> [panL] -> [envGainer] ----> [velGain] -> [filter] -> (dest2)
        (bufferR) -> [panR] ->       |<gain> 
                                     |
                            [ampEG] -
        */

        // source buffers & panners
        this.graph.nodes.pan1 = this.audioCtx.createStereoPanner("sfz>pan1");
        if (needsPan2) {
            this.graph.nodes.pan2 = this.audioCtx.createStereoPanner("sfz>pan2");
        }

        this.graph.nodes.velGain = this.audioCtx.createGain("sfz>velGain");

        // filter - create it but disconnected to start with.
        if (needsFilter) {
            this.graph.nodes.filter = this.audioCtx.createBiquadFilter("sfz>filt");
        }

        this.isConnected = true;
    }

    disconnect() {
        if (!this.isConnected) return;
        this.graph.disconnect();
        this.perfGraph.disconnect();

        this.isConnected = false;
    }

    AllNotesOff() {
        if (!this.isConnected) return;
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

    physicalAndMusicalNoteOn(sfzRegion, midiNote, velocity, destinations) {
        if (!this.isConnected) {
            return;
        }
        if (!sfzRegion.buffer) {
            return; // sample is still loading.
        }

        this.timestamp = Date.now();
        this.midiNote = midiNote;
        this.velocity = velocity;
        this.sfzRegion = sfzRegion;

        this.perfGraph.disconnect();

        // source buffers & panners
        //const transpose = ('transpose' in this.instrumentSpec) ? this.instrumentSpec.transpose : 0;
        const detuneSpec = sfzRegion.CalculateDetune(midiNote + this.getPitchBendSemis() + (this.instrumentSpec.GetParamByID("adjustFinetune").currentValue / 100));
        this.playbackRatio = detuneSpec.playbackRatio; // needed to calculate the correct duration of the sample
        this.graph.nodes.pan1.pan.value = sfzRegion.pan;

        this.perfGraph.nodes.bufferSourceNode1 = this.audioCtx.createBufferSource();
        this.perfGraph.nodes.bufferSourceNode1.buffer = sfzRegion.buffer;
        this.perfGraph.nodes.bufferSourceNode1.detune.value = detuneSpec.detuneCents;
        if (sfzRegion.loopSpec) {
            this.perfGraph.nodes.bufferSourceNode1.loop = true;
            this.perfGraph.nodes.bufferSourceNode1.loopStart = sfzRegion.loopSpec.start;
            this.perfGraph.nodes.bufferSourceNode1.loopEnd = sfzRegion.loopSpec.end;
        }
        this.perfGraph.nodes.bufferSourceNode1.connect(this.graph.nodes.pan1);

        if (sfzRegion.correspondingRegion && this.graph.nodes.pan2 && sfzRegion.correspondingRegion.buffer) {
            this.graph.nodes.pan2.pan.value = sfzRegion.correspondingRegion.pan;
            this.perfGraph.nodes.bufferSourceNode2 = this.audioCtx.createBufferSource();
            this.perfGraph.nodes.bufferSourceNode2.buffer = sfzRegion.correspondingRegion.buffer;
            this.perfGraph.nodes.bufferSourceNode2.detune.value = detuneSpec.detuneCents;
            if (sfzRegion.correspondingRegion.loopSpec) {
                this.perfGraph.nodes.bufferSourceNode2.loop = true;
                this.perfGraph.nodes.bufferSourceNode2.loopStart = sfzRegion.correspondingRegion.loopSpec.start;
                this.perfGraph.nodes.bufferSourceNode2.loopEnd = sfzRegion.correspondingRegion.loopSpec.end;
            }
            this.perfGraph.nodes.bufferSourceNode2.connect(this.graph.nodes.pan2);
        }

        // adjust EG spec based on params.
        this.sfzRegion.adjustedAmpEGSpec = Object.assign({}, this.sfzRegion.ampEGSpec);
        const adjA = this.instrumentSpec.GetParamByID("adjustA").currentValue;
        const adjD = this.instrumentSpec.GetParamByID("adjustD").currentValue;
        const adjS = this.instrumentSpec.GetParamByID("adjustS").currentValue;
        const adjR = this.instrumentSpec.GetParamByID("adjustR").currentValue;
        if (adjA < 0) {
            this.sfzRegion.adjustedAmpEGSpec.attackTime *= (adjA + 1);// -1 means *0, 0 means *1
        } else {
            this.sfzRegion.adjustedAmpEGSpec.attackTime += (adjA * 1.5);// 0 meanss no change, 1 = add up to 1.5 seconds attack time
        }
        if (adjD < 0) {
            this.sfzRegion.adjustedAmpEGSpec.decayTime *= (adjD + 1);// -1 means *0, 0 means *1
        } else {
            this.sfzRegion.adjustedAmpEGSpec.decayTime += (adjD * 1.5);// 0 meanss no change, 1 = add up to 1.5 seconds
        }
        if (adjS < 0) {
            this.sfzRegion.adjustedAmpEGSpec.sustainLevel *= (adjS + 1);// -1 means *0, 0 means *1
        } else {
            //this.sfzRegion.adjustedAmpEGSpec.sustainLevel += (adjD * 1.5);// 0 means no change, 1 = 1
            DFU.lerp(this.sfzRegion.adjustedAmpEGSpec.sustainLevel, 1, adjS);
        }
        if (adjR < 0) {
            this.sfzRegion.adjustedAmpEGSpec.releaseTime *= (adjR + 1);// -1 means *0, 0 means *1
        } else {
            this.sfzRegion.adjustedAmpEGSpec.releaseTime += (adjR * 1.5);// 0 meanss no change, 1 = add up to 1.5 seconds
        }

        this.perfGraph.nodes.ampEG = new ADSREnvelope(this.sfzRegion.adjustedAmpEGSpec);

        this.graph.nodes.pan1.disconnect();
        if (this.perfGraph.nodes.pan2) this.perfGraph.nodes.pan2.disconnect();

        this.perfGraph.nodes.envGainer = this.audioCtx.createGain("sfz>envGainer");
        this.graph.nodes.pan1.connect(this.perfGraph.nodes.envGainer);
        if (this.graph.nodes.pan2) {
            this.graph.nodes.pan2.connect(this.perfGraph.nodes.envGainer);
        }
        this.perfGraph.nodes.envGainer.gain.value = 0;

        this.perfGraph.nodes.envGainer.connect(this.graph.nodes.velGain);

        const velAmpMul = DFU.remap(this.instrumentSpec.GetParamByID("velAmpMod").currentValue, 0, 1, 1, (velocity / 127));
        this.graph.nodes.velGain.gain.value = velAmpMul * GLOBAL_SFZ_GAIN * this.sfzRegion.volumeMul;

        // filter
        if (sfzRegion.filterSpec) {
            this.graph.nodes.filter.frequency.value = sfzRegion.filterSpec.cutoff;
            this.graph.nodes.filter.Q.value = sfzRegion.filterSpec.q;
            this.graph.nodes.filter.type = sfzRegion.filterSpec.type;
        }

        let releaseLength = this.sfzRegion.adjustedAmpEGSpec.releaseTime;
        if (this.sfzRegion.adjustedAmpEGSpec.releaseTime < 0) {
            // if release is a one-shot style (inf), then the release len is the whole length of the sample.
            releaseLength = this.sfzRegion.buffer.duration;
        }

        // stretch the duration based on the rate it was played at.
        releaseLength *= this.playbackRatio;
        this.releaseLengthMS = releaseLength * 1000;

        //console.log (` -> sfz note on @ ${Date.now()}`);

        if (this.perfGraph.nodes.bufferSourceNode1) this.perfGraph.nodes.bufferSourceNode1.start();
        if (this.perfGraph.nodes.bufferSourceNode2) this.perfGraph.nodes.bufferSourceNode2.start();

        this.startMusicalTime = this.audioCtx.currentTime;
        this.perfGraph.nodes.ampEG.applyTo(this.perfGraph.nodes.envGainer.gain, this.startMusicalTime);

        this.setDestNodes(destinations);
    }

    setDestNodes(destinations) {
        if (!this.isConnected) return;

        if (!this.sfzRegion) return;
        if (this.sfzRegion.filterSpec) {
            this.graph.nodes.velGain.disconnect();
            this.graph.nodes.velGain.connect(this.graph.nodes.filter);

            this.graph.nodes.filter.disconnect();
            destinations.forEach(d => {
                this.graph.nodes.filter.connect(d);
            });
        } else {
            this.graph.nodes.velGain.disconnect();
            destinations.forEach(d => {
                this.graph.nodes.velGain.connect(d);
            });
        }
    }

    musicallyRelease(offBecauseGroup) {
        if (!this.isConnected) return;
        if (offBecauseGroup) {
            // if this note is being released because of a group, like openhat off because of hihat, then it should override the normal note off.
            if (this.perfGraph.nodes.bufferSourceNode1) this.perfGraph.nodes.bufferSourceNode1.stop();
            if (this.perfGraph.nodes.bufferSourceNode2) this.perfGraph.nodes.bufferSourceNode2.stop();
        }

        if (!this.timestamp) {
            return; // some odd synth state can cause releases without note ons (pedal up after taking the instrument for example)
        }

        if (this.sfzRegion.loopSpec && this.sfzRegion.loopSpec.stopLoopOnRelease) {
            this.perfGraph.nodes.bufferSourceNode1.loop = false;
        }
        if (this.sfzRegion.correspondingRegion && this.sfzRegion.correspondingRegion.loopSpec && this.sfzRegion.correspondingRegion.loopSpec.stopLoopOnRelease && this.perfGraph.nodes.bufferSourceNode2) {
            this.perfGraph.nodes.bufferSourceNode2.loop = false;
        }

        if (!offBecauseGroup) {
            if (this.perfGraph.nodes.ampEG && (this.sfzRegion.adjustedAmpEGSpec.releaseTime >= 0)) {
                this.perfGraph.nodes.ampEG.gateTime = this.audioCtx.currentTime - this.startMusicalTime;
                this.perfGraph.nodes.ampEG.applyTo(this.perfGraph.nodes.envGainer.gain, this.startMusicalTime);

                if (this.perfGraph.nodes.bufferSourceNode1) this.perfGraph.nodes.bufferSourceNode1.stop(this.startMusicalTime + this.perfGraph.nodes.ampEG.duration);
                if (this.perfGraph.nodes.bufferSourceNode2) this.perfGraph.nodes.bufferSourceNode2.stop(this.startMusicalTime + this.perfGraph.nodes.ampEG.duration);
            }
        }

        this.timestamp = null;
        this.noteOffTimestamp = Date.now();
        this.velocity = 0;
    }

    ParamHasChanged(paramID) {
        if (!this.isConnected) return;
        switch (paramID) {
            case "adjustFinetune":
            case "pb":
                if (this.sfzRegion) {
                    const detuneCents = this.sfzRegion.CalculateDetune(this.midiNote + this.getPitchBendSemis() + (this.instrumentSpec.GetParamByID("adjustFinetune").currentValue / 100)).detuneCents;
                    // don't bother setting this.playbackRatio; it will not be accurate
                    if (this.perfGraph.nodes.bufferSourceNode1) {
                        this.perfGraph.nodes.bufferSourceNode1.detune.value = detuneCents;
                    }
                    if (this.perfGraph.nodes.bufferSourceNode2) {
                        this.perfGraph.nodes.bufferSourceNode2.detune.value = detuneCents;
                    }
                }
                break;
            default:
                break;
        }
    };
}; // class sfzVoice


////////////////////////////////////////////////////////////////////////////////////////////////////////////
class sfzInstrument {
    constructor(audioCtx, dryDestination, verbDestination, delayDestination, instrumentSpec, sampleLibrarian, onLoadProgress, noteOnHandler, noteOffHandler) {
        this.noteOnHandler = noteOnHandler;
        this.noteOffHandler = noteOffHandler;

        this.audioCtx = audioCtx;
        this.dryDestination = dryDestination;
        this.verbDestination = verbDestination;
        this.delayDestination = delayDestination;
        this.instrumentSpec = instrumentSpec;
        this.sampleLibrarian = sampleLibrarian;
        this.isConnected = false;
        this.regions = null; // later, populated with the SFZ containing region opcodes
        this.sfzCache = {}; // map sfzURL to regions.
        this.onLoadProgress = onLoadProgress;
        this.instrumentSpec.loadProgress = null;

        this.voices = [];
        for (let i = 0; i < instrumentSpec.maxPolyphony; ++i) {
            this.voices.push(new sfzVoice(audioCtx, instrumentSpec, sampleLibrarian, i));
        }

        this.isSustainPedalDown = false;
        this.physicallyHeldNotes = []; // array of {note, sfzRegion, voiceIndex} in order of note on.

        this.graph = new DFSynthTools.AudioGraphHelper();
    }

    getCurrentSFZSpec() {
        const sfzSelect = this.instrumentSpec.GetParamByID("sfzSelect");
        const r1 = this.instrumentSpec.sfzArray[sfzSelect.currentValue];
        if (r1) return r1;
        return this.instrumentSpec;
    }

    ensureSelectedSFZVariantParams() {
        // for multi-sfz, make sure the selected one is .. selected
        const sfzSpec = this.getCurrentSFZSpec();
        // start by removing all properties that are set by the child sfz array
        this.instrumentSpec.sfzArray.forEach(s => {
            Object.keys(s).forEach(k => {
                if (k === 'name') return; // don't overwrite this one!
                delete this.instrumentSpec[k];
            });
        });
        Object.keys(sfzSpec).forEach(k => {
            if (k === 'name') return; // don't overwrite this one!
            this.instrumentSpec[k] = sfzSpec[k];
        });

        // a sfz can specify params to set when its selected too. this goes against convention; typically param changes are done externally. but let's allow it.
        if (this.instrumentSpec.sfzPatch) {
            Object.keys(this.instrumentSpec.sfzPatch).forEach(paramID => {
                const p = this.instrumentSpec.GetParamByID(paramID);
                p.currentValue = p.rawValue = this.instrumentSpec.sfzPatch[paramID];
            });
        }
    }

    onJSONLoadSuccess(sfzSpec, loadedRegions) {
        const a = [];
        loadedRegions.forEach(r => {
            let reg = new SFZRegion(r, sfzSpec);
            a.push(reg);
        });

        PreprocessSFZRegions(a, sfzSpec);
        this.sfzCache[sfzSpec.sfzURL] = a;
    }

    onSampleLoadSuccess(sfzSpec, sampleFullPath, buffer) {
        const regions = this.sfzCache[sfzSpec.sfzURL]; // samples may still be loading but we don't care in connect().
        regions.forEach(r => {
            if (r.sampleFullPath !== sampleFullPath) return;
            r.buffer = buffer;
        });
    }

    connect() {
        if (this.isConnected) return true;

        this.ensureSelectedSFZVariantParams();
        const sfzSpec = this.getCurrentSFZSpec();

        if (this.instrumentSpec.sfzURL in this.sfzCache) {
            this.regions = this.sfzCache[sfzSpec.sfzURL]; // samples may still be loading but we don't care in connect().
        } else {
            // queue this for loading.
            if (SFZAssetLoader.GetLoadStatus(sfzSpec.sfzURL) === eLoadStatus.Unknown) {
                SFZAssetLoader.CacheSFZAssets(this.sampleLibrarian, sfzSpec.sfzURL,
                    (progressSpec) => { // progress
                        this.instrumentSpec.loadProgress = progressSpec;
                        this.onLoadProgress(progressSpec);
                    },
                    null,// existing prog spec
                    (regions) => { // json load success
                        // generate our sfzCache item which 
                        this.onJSONLoadSuccess(sfzSpec, regions);
                    },
                    () => { // json error.
                        // todo. not even sure what to do here.
                        throw new Error(`ERROR loading JSON ${sfzSpec.sfzURL}`);
                    },
                    (sampleURL, buffer) => { // on sample success. fill out buffers.
                        this.onSampleLoadSuccess(sfzSpec, sampleURL, buffer);
                    },
                    (sampleURL) => { // sample load error.
                        throw new Error(`ERROR loading sample ${sampleURL}`);
                    }
                );
            }

            return false; // can't connect yet.
        };

        /*
        (voice) --> [filter] --> [verbGainer] --> verbDestination
                               > [dryGainer] --> dryDestination
                               > [delayGainer] --> delayDestination

        (voice) ---------------> [verbGainer] --> verbDestination
                               > [dryGainer] --> dryDestination
                               > [delayGainer] --> delayDestination
        */
        let gainLevels = this.getGainLevels();

        this.graph.nodes.dryGainer = this.audioCtx.createGain("sfz>master");
        this.graph.nodes.verbGainer = this.audioCtx.createGain("sfz>master");
        this.graph.nodes.delayGainer = this.audioCtx.createGain("sfz>master");
        this.graph.nodes.dryGainer.gain.value = gainLevels[0];
        this.graph.nodes.verbGainer.gain.value = gainLevels[1];
        this.graph.nodes.delayGainer.gain.value = gainLevels[2];

        this.graph.nodes.dryGainer.connect(this.dryDestination);
        this.graph.nodes.verbGainer.connect(this.verbDestination);
        this.graph.nodes.delayGainer.connect(this.delayDestination);

        this.childDestinations = [this.graph.nodes.dryGainer, this.graph.nodes.verbGainer, this.graph.nodes.delayGainer];
        this.needsFilter = this.regions.some(r => !!r.filterSpec);
        this.needsPan2 = this.regions.some(r => !!r.correspondingRegion);

        this.voices.forEach(v => {
            v.connect(this.needsFilter, this.needsPan2);
        });

        this.isConnected = true;

        this.isFilterConnected = false;
        this._SetFiltType(); // this will connect the voices & filter if needed.

        return true;
    }

    disconnect() {
        this.isConnected = false;
        this.AllNotesOff();
        //console.log(`Inst disconnect`);
        this.voices.forEach(v => v.disconnect());
        this.graph.disconnect();
    }

    AllNotesOff() {
        this.physicallyHeldNotes = [];
        this.isSustainPedalDown = false;
        this.voices.forEach(v => {
            v.AllNotesOff();
        });
    }

    // returns [drygain, verbgain, delaygain]
    getGainLevels() {
        const masterFacter = this.instrumentSpec.GetParamByID("masterGain").currentValue * DFU.DBToLinear(this.instrumentSpec.GetParamByID("mixerGainDB").currentValue);
        let mainMul = masterFacter * (('gain' in this.instrumentSpec) ? this.instrumentSpec.gain : 1);
        let verbMul = this.instrumentSpec.GetParamByID("verbMix").currentValue;
        let delayMul = this.instrumentSpec.GetParamByID("delayMix").currentValue;
        // when verb mix is 0, drygain is the real master gain.
        // when verb mix is 1, drygain is 0 and verbmix is mastergain
        return [
            (1.0 - verbMul) * mainMul, // not-verb, scaled by master gain
            verbMul * mainMul, // verb, scaled by master gain
            delayMul * mainMul,
        ];
    }

    NoteOn(user, midiNote, velocity) {
        if (!this.connect()) return;

        const velcurve = this.instrumentSpec.GetParamByID("velCurve").currentValue;
        velocity = Math.pow(DFU.baseClamp(velocity / 127, 0, 1), velcurve) * 127;

        midiNote += this.instrumentSpec.transpose || 0;

        // find a SFZ region.
        const sfzRegionIndex = this.regions.findIndex(r => r.RegionMatches(midiNote, velocity));
        if (sfzRegionIndex == -1) return;
        const sfzRegion = this.regions[sfzRegionIndex];

        let bestAvailabilityScore = 0;
        let bestVoiceIndex = 0;
        this.voices.forEach((v, i) => {
            const s = v.GetAvailabilityScore();
            if (s <= bestAvailabilityScore) return;
            bestAvailabilityScore = s;
            bestVoiceIndex = i;
        });

        this.physicallyHeldNotes.push({
            note: midiNote,
            sfzRegion,
            voiceIndex: bestVoiceIndex
        });
        if (this.voices[bestVoiceIndex].IsPlaying) {
            this.noteOffHandler(user, this.instrumentSpec, this.voices[bestVoiceIndex].midiNote);
        }
        this.voices[bestVoiceIndex].physicalAndMusicalNoteOn(sfzRegion, midiNote, velocity, this.childDestinations);
        this.noteOnHandler(user, this.instrumentSpec, midiNote);

        // handle off_by
        //- group=1 off_by=1 polyphony
        if ('group' in sfzRegion) {
            const group = sfzRegion.group;
            // release playing notes which are off_by this group.
            this.voices.forEach((v, vi) => {
                if (vi == bestVoiceIndex) return;
                if (v.sfzRegion && ('off_by' in v.sfzRegion) && (v.sfzRegion.off_by == group) && v.midiNote) {
                    //console.log(`off_by ${v.midiNote}`);
                    this.noteOffHandler(user, this.instrumentSpec, v.midiNote);
                    v.musicallyRelease(true);
                    //this.NoteOff(v.midiNote, true);
                }
            });
        }
    };

    NoteOff(user, midiNote, offBecauseGroup) {
        if (!this.connect()) return;
        midiNote += this.instrumentSpec.transpose || 0;
        this.physicallyHeldNotes.removeIf(n => n.note === midiNote);
        if (this.isSustainPedalDown) return;

        let v = this.voices.find(v => v.midiNote == midiNote && v.IsPlaying);
        if (v) {
            this.noteOffHandler(user, this.instrumentSpec, v.midiNote);
            v.musicallyRelease(offBecauseGroup);
        }
    };

    PedalDown() {
        if (!this.connect()) return;
        this.isSustainPedalDown = true;
    };

    PedalUp(user) {
        if (!this.connect()) return;
        this.isSustainPedalDown = false;
        // for each voice that's NOT physically held, but is playing, release the note.
        this.voices.forEach((v, vindex) => {
            if (v.IsPlaying && !this.VoiceIsPhysicalyHeld(vindex)) {
                this.noteOffHandler(user, this.instrumentSpec, v.midiNote);
                v.musicallyRelease();
            }
        });
    };

    VoiceIsPhysicalyHeld(voiceIndex) {
        return this.physicallyHeldNotes.find(x => x.voiceIndex == voiceIndex) != null;
    }


    _SetFiltType() {
        let disableFilter = () => {
            if (!this.isFilterConnected) return; // already disconnected.

            //console.log(`DISABLING filter`);

            /*
            (voice) ---------------> [verbGainer] --> verbDestination
                                   > [dryGainer] --> dryDestination
                                   > [delayGainer] --> delayDestination
            */
            // reconnect voices to the destinations instead of filter.
            this.childDestinations = [this.graph.nodes.dryGainer, this.graph.nodes.verbGainer, this.graph.nodes.delayGainer];
            this.voices.forEach(v => {
                v.setDestNodes(this.childDestinations);
            });
            this.graph.nodes.filter.disconnect();
            this.graph.nodes.filter = null;

            this.isFilterConnected = false;
        };
        let enableFilter = () => {
            if (this.isFilterConnected) return; // already connected.
            //console.log(`ENABLING filter`);

            /*
            (voice) --> [filter] --> [verbGainer] --> verbDestination
                                   > [dryGainer] --> dryDestination
                                   > [delayGainer] --> delayDestination
            */
            this.graph.nodes.filter = this.audioCtx.createBiquadFilter("sfz>filter");
            this.graph.nodes.filter.frequency.value = this.instrumentSpec.GetParamByID("filterFreq").currentValue;
            this.graph.nodes.filter.Q.value = this.instrumentSpec.GetParamByID("filterQ").currentValue;

            this.graph.nodes.filter.connect(this.graph.nodes.dryGainer);
            this.graph.nodes.filter.connect(this.graph.nodes.verbGainer);
            this.graph.nodes.filter.connect(this.graph.nodes.delayGainer);

            // reconnect voices to the destinations instead of filter.
            this.childDestinations = [this.graph.nodes.filter];
            this.voices.forEach(v => {
                v.setDestNodes(this.childDestinations);
            });

            this.isFilterConnected = true;
            this._updateFilterBaseFreq();
        };
        switch (parseInt(this.instrumentSpec.GetParamByID("filterType").currentValue)) {
            case 0: // off
                disableFilter();
                return;
            case 1:
                enableFilter();
                this.graph.nodes.filter.type = "lowpass";
                return;
            case 2:
                enableFilter();
                this.graph.nodes.filter.type = "highpass";
                return;
            case 3:
                enableFilter();
                this.graph.nodes.filter.type = "bandpass";
                return;
        }
        console.warn(`unknown filter type ${this.instrumentSpec.GetParamByID("filterType").currentValue}`);
    }

    _updateFilterBaseFreq() {
        if (!this.graph.nodes.filter) return;
        let p = this.instrumentSpec.GetParamByID("filterFreq").currentValue;
        const freqParam = this.graph.nodes.filter.frequency;
        //console.log(`filter freq = ${p}`);
        freqParam.value = DFU.baseClamp(p, freqParam.minValue, freqParam.maxValue);
    }

    SetParamValuesMuted(patchObj) {
        Object.keys(patchObj).forEach(paramID => {
            switch (paramID) {
                case "sfzSelect":
                    this.disconnect();
                    this.ensureSelectedSFZVariantParams();
                    break;
            }
        });
    };

    SetParamValues(patchObj) {
        if (!this.isConnected) return; // mixing desk can change params when it's not even connected.
        Object.keys(patchObj).forEach(paramID => {
            switch (paramID) {
                case "mixerGainDB":
                case "delayMix":
                case "masterGain":
                case "verbMix":
                    let levels = this.getGainLevels();
                    this.graph.nodes.dryGainer.gain.value = levels[0];
                    this.graph.nodes.verbGainer.gain.value = levels[1];
                    this.graph.nodes.delayGainer.gain.value = levels[2];
                    break;
                case "sfzSelect":
                    this.disconnect();
                    this.connect();
                    break;
                case "filterType":
                    this._SetFiltType();
                    break;
                case "filterFreq":
                    this._updateFilterBaseFreq();
                    break;
                case "filterQ":
                    if (this.graph.nodes.filter) {
                        this.graph.nodes.filter.Q.value = this.instrumentSpec.GetParamByID("filterQ").currentValue;
                    }
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

module.exports = {
    sfzInstrument,
    SFZAssetLoader
};


