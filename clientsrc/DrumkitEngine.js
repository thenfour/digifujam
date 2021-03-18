'use strict';
const DFU = require('./dfutil');

// SampleCache holds loading & accessing samples
// DrumKitVoice handles translating a MIDI message into a drum sample
// OneShotInstrument handles polyphony & voicing & triggering & instrument-level effects


// handler receives (buffer)
let gLoadSample = function (audioContext, url, successHandler, errorHandler) {
    var request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.responseType = "arraybuffer";
    request.onload = () => {
        audioContext.decodeAudioData(request.response, successHandler, errorHandler);
    };
    request.error = errorHandler;
    request.abort = errorHandler;
    request.send();
}

// just maps name to prepared sample buffer, and hands out AudioBufferSourceNodes when needed.
class SampleCache {
    constructor(audioCtx) {
        this.sampleMap = {}; // map URL to { buffer<nullable>, completions[] }
        this.audioCtx = audioCtx;
    }
    loadSampleFromURL(url, onSuccess, onError) {
        let existing = this.sampleMap[url];
        if (existing) {
            if (existing.buffer) {
                //console.log(`SampleCache: returning existing buffer for ${url}`);
                onSuccess(existing.buffer);
                return;
            }
            // it's still loading; just add the completion handlers.
            //console.log(`SampleCache: still loading; adding handler for ${url}`);
            existing.completions.push({ onSuccess, onError });
            return;
        }
        this.sampleMap[url] = {
            buffer: null,
            completions: [{ onSuccess, onError }]
        };
        gLoadSample(this.audioCtx, url, buffer => {
            this.sampleMap[url].buffer = buffer;
            this.sampleMap[url].completions.forEach(h => h.onSuccess(buffer));
            this.sampleMap[url].completions = [];
        }, err => {
            this.sampleMap[url].completions.forEach(e => e.onError(err));
            this.sampleMap[url].completions = [];
        });
    };
};


//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// handles the musical work (note ons etc)
class DrumKitVoice {
    constructor(instrumentSpec, sampleLibrarian) {
        this.instrumentSpec = instrumentSpec;
        this.sampleLibrarian = sampleLibrarian;

        this.midiNote = 0;
        this.velocity = 0;
        this.timestamp = null; // when did the note on start?
        this.isConnected = false;

        this.bufferSourceNode = null; // when we play a sample, this gets populated

        // create a mapping from midi note to spec
        this.midiNoteMap = [];
        for (let i = 0; i < 128; ++i) {
            this.midiNoteMap.push({ spec: null, buffer: null });
        }
    };

    connect(audioCtx, destination1, destination2) {
        if (this.isConnected) return;
        this.AllNotesOff();

        this.audioCtx = audioCtx;

        /*
        (buffer)--> [velocityGainer] --> destination1
                                       > destination2
        */
        this.velocityGainer = audioCtx.createGain();

        this.velocityGainer.connect(destination1);
        if (destination2) {
            this.velocityGainer.connect(destination2);
        }

        this.ensureKitLoaded();
        this.isConnected = true;
    }

    disconnect() {
        if (!this.isConnected) return;
        this.AllNotesOff();

        this.velocityGainer.disconnect();
        this.velocityGainer = null;
        this.isConnected = false;
    }

    NoteOn(midiNote, velocity /* 0-127 */) {
        let spec = this.midiNoteMap[midiNote].spec;
        let buffer = this.midiNoteMap[midiNote].buffer;
        if (!buffer) return; // probably not loaded yet; ignore.
        let newBufferNode = this.audioCtx.createBufferSource();
        newBufferNode.buffer = buffer;
        this.AllNotesOff();

        this.timestamp = new Date();
        this.noteDurationMS = buffer.duration * 1000; // TODO: adjust the duration to account for detune.

        this.midiNote = midiNote;
        this.velocity = velocity;

        this.velocityGainer.gain.value = velocity / 127;

        this.bufferSourceNode = newBufferNode;

        if (spec.detune) {
            this.bufferSourceNode.detune.value = spec.detune;
        }
        //this.bufferSourceNode.playbackRate
        this.bufferSourceNode.connect(this.velocityGainer);
        this.bufferSourceNode.start();

        return spec.sendNoteOffToNotes;
    };

    NoteOff(midiNote) { }
    ForceNoteOff() {
        // for the moment just panic(). but eventually this should release an envelope.
        this.AllNotesOff();
    }
    PedalDown() { }
    PedalUp() { }

    get IsPlaying() {
        return this.isConnected && !!this.timestamp && ((new Date() - this.timestamp) < this.noteDurationMS);
    }

    // makes sure the librarian is caching the samples of this kit, and populate buffers as they load.
    ensureKitLoaded() {
        let p = this.instrumentSpec.GetParamByID("kit");
        let loadingKitID = p.currentValue;
        let kit = p.enumNames[loadingKitID];

        //console.log(`ensureKitLoaded loading ${kit}`);

        // init the map with emptiness.
        this.midiNoteMap = [];
        console.assert(!!this.instrumentSpec.drumKits);
        console.assert(!!this.instrumentSpec.drumKits[kit]);
        for (let i = 0; i < 128; ++i) {
            this.midiNoteMap.push({ spec: null, buffer: null });
        }

        // populate it with all known kit samples.
        let kitSamples = this.instrumentSpec.drumKits[kit].samples; // this object so far is just {samples:[]}
        kitSamples.forEach(sampleSpec => {
            // populate mapped notes with "loading" state
            sampleSpec.midiNotes.forEach(midiNote => {
                this.midiNoteMap[midiNote] = { spec: sampleSpec, buffer: null };
            });

            // load sample and on completion, fill those buffers in.
            // { "url": "/drum-samples/LINN/Acoustic_Snare.m4a", "midiNotes": [ 38, 40 ] },
            this.sampleLibrarian.loadSampleFromURL(sampleSpec.url, buffer => {
                //console.log(`Loaded sample ${sampleSpec.url}`);
                // make sure this is not an obsolete call; these can come out of order.
                let updatedKit = this.instrumentSpec.GetParamByID("kit").currentValue;
                if (updatedKit != loadingKitID) {
                    //console.warn(`Kit has changed since loading the sample! Whoooah`);
                    return;
                }
                sampleSpec.midiNotes.forEach(midiNote => {
                    this.midiNoteMap[midiNote].buffer = buffer;
                });
            }, err => {
                console.warn(`Error loading drum sample at ${sampleSpec.url}; ${err}`);
            });

        });
    }

    SetParamValue(paramID) {
        switch (paramID) {
            case "kit":
                this.ensureKitLoaded();
                break;
        }
    }

    AllNotesOff() {
        if (this.bufferSourceNode) {
            this.bufferSourceNode.stop();
            this.bufferSourceNode.disconnect();
            this.bufferSourceNode = null;
        }
    };
};



//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// like polysynth in that it handles polyphony and voicing, but doesn't have modulation, doesn't care about note-offs etc.
class OneShotInstrument {
    constructor(audioCtx, sampleLibrarian, dryDestination, wetDestination, instrumentSpec, createVoiceFn) {
        this.audioCtx = audioCtx;
        this.dryDestination = dryDestination;
        this.wetDestination = wetDestination;
        this.instrumentSpec = instrumentSpec;

        this.sampleLibrarian = sampleLibrarian;

        this.voices = [];
        for (let i = 0; i < instrumentSpec.maxPolyphony; ++i) {
            this.voices.push(createVoiceFn(instrumentSpec, sampleLibrarian));
        }
        this.isConnected = false;
    }

    connect() {
        /*
        (voice) --> [filter] --> [masterDryGain] --> dryDestination
                               > [masterWetGain] --> wetDestination
        */
        if (this.isConnected) return;
        this.audioCtx.beginScope(this.instrumentSpec.getDisplayName());

        // create the filter but don't connect it yet.
        this.filter = this.audioCtx.createBiquadFilter("drum>filter");
        this.filter.frequency.value = this.instrumentSpec.GetParamByID("filterFreq").currentValue;
        this.filter.Q.value = this.instrumentSpec.GetParamByID("filterQ").currentValue;

        this.masterDryGain = this.audioCtx.createGain();
        this.masterWetGain = this.audioCtx.createGain();

        let gainLevels = this.getGainLevels();
        this.masterDryGain.gain.value = gainLevels[0];
        this.masterWetGain.gain.value = gainLevels[1];

        this.masterDryGain.connect(this.dryDestination);
        this.masterWetGain.connect(this.wetDestination);

        this.voices.forEach(v => {
            v.connect(this.audioCtx, this.dryDestination, this.wetDestination);
        });

        this._SetFiltType(); // this will connect the voices & filter

        this.isConnected = true;
        this.audioCtx.endScope();
    }

    disconnect() {
        this.AllNotesOff();
        if (!this.isConnected) return;
        this.voices.forEach(v => { v.disconnect(); });

        this.filter.disconnect();
        this.filter = null;

        this.masterDryGain.disconnect();
        this.masterWetGain.disconnect();
        this.masterDryGain = null;
        this.masterWetGain = null;
        this.isConnected = false;
    }

    NoteOn(midiNote, velocity) {
        if (!this.isConnected) this.connect();

        this._updateFilterBaseFreq();

        // find a free voice and delegate.
        //let suitableVoice = null;
        let suitableVoiceIndex = -1;

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
        const sendNoteOffToNotes = this.voices[suitableVoiceIndex].NoteOn(midiNote, velocity, false);
        if (sendNoteOffToNotes) {
            sendNoteOffToNotes.forEach(noteToKill => {
                this.ForceNoteOff(noteToKill);
            });
        }
    }

    // MIDI note offs don't do anything; these are one-shots. we do though do note-offs in ForceNoteOff
    NoteOff(midiNote) { }

    ForceNoteOff(midiNote) {
        this.voices.forEach(v => {
            if (v.IsPlaying && v.midiNote == midiNote) {
                v.ForceNoteOff();
            }
        });
    }

    PedalDown() { }

    PedalUp() { }

    AllNotesOff() {
        this.voices.forEach(v => v.AllNotesOff());
    }

    // returns [drygain, wetgain]
    getGainLevels() {
        let ms = this.instrumentSpec.GetParamByID("masterGain").currentValue;
        let vg = this.instrumentSpec.GetParamByID("verbMix").currentValue;
        // when verb mix is 0, drygain is the real master gain.
        // when verb mix is 1, drygain is 0 and verbmix is mastergain
        return [(1.0 - vg) * ms, vg * ms * 1.0];
    }


    _SetFiltType() {
        let disableFilter = () => {
            if (!this.isFilterConnected) return; // already disconnected.

            this.filter.disconnect();

            // reconnect voices to the wet/dry destinations instead of filter.
            this.voices.forEach(v => {
                v.disconnect();
                v.connect(this.audioCtx, this.masterDryGain, this.masterWetGain);
            });
    
            this.isFilterConnected = false;
        };
        let enableFilter = () => {
            if (this.isFilterConnected) return; // already connected.

            this.filter.connect(this.masterDryGain);
            this.filter.connect(this.masterWetGain);

            // reconnect voices to the wet/dry destinations instead of filter.
            this.voices.forEach(v => {
                v.disconnect();
                v.connect(this.audioCtx, this.filter);
            });

            this.isFilterConnected = true;
        };
        switch (parseInt(this.instrumentSpec.GetParamByID("filterType").currentValue)) {
            case 0: // off
                disableFilter();
                return;
            case 1:
                enableFilter();
                this.filter.type = "lowpass";
                return;
            case 2:
                enableFilter();
                this.filter.type = "highpass";
                return;
            case 3:
                enableFilter();
                this.filter.type = "bandpass";
                return;
        }
        console.warn(`unknown filter type ${this.instrumentSpec.GetParamByID("filterType").currentValue}`);
    }

    _updateFilterBaseFreq() {
        let p = this.instrumentSpec.GetParamByID("filterFreq").currentValue;
        const freqParam = this.filter.frequency;
        freqParam.value = DFU.baseClamp(p, freqParam.minValue, freqParam.maxValue);//, this.audioCtx.currentTime + this.minGlideS);
    }


    SetParamValues(patchObj) {
        let keys = Object.keys(patchObj);
        keys.forEach(paramID => {
            switch (paramID) {
                case "masterGain":
                case "verbMix":
                    let levels = this.getGainLevels();
                    this.masterDryGain.gain.value = levels[0];
                    this.masterWetGain.gain.value = levels[1];
                    break;
                case "filterType":
                    this._SetFiltType();
                    break;
                case "filterFreq":
                    this._updateFilterBaseFreq();
                    break;
                case "filterQ":
                    this.filter.Q.value = this.instrumentSpec.GetParamByID("filterQ").currentValue;
                    break;
                default:
                    this.voices.forEach(voice => {
                        voice.SetParamValue(paramID, patchObj[paramID]);
                    });
                    break;
            }
        });
    };
};

module.exports = {
    gLoadSample,
    SampleCache,
    OneShotInstrument,
    DrumKitVoice,
};

