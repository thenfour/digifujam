const DFU = require('../DFcommon/dfutil');
const DFDelayNode = require('./DelayNode');

// helps disconnecting big-ish audio graphs.
// in ctor
//   this.graph = new AudioGraphHelper();
// in connect when building graph, 
//   this.graph.nodes.sfOutput = this.audioCtx.createGain("sfOutput");
// when disconnecting,
//   this.graph.disconnect();
class AudioGraphHelper {
    constructor() {
        this.nodes = {};
    }
    disconnect() {
        Object.keys(this.nodes).forEach(k => {
            let n = this.nodes[k];
            if (n) {
                if (n.reset) n.reset();
                if (n.stop) n.stop();
                if (n.disconnect) n.disconnect();
            }
        });
        this.nodes = {};
    }
};


// handler receives an object
let AjaxJSON = function (url, successHandler, errorHandler) {
    try {
        var request = new XMLHttpRequest();
        request.open("GET", url, true);
        request.responseType = "arraybuffer";
        request.onload = () => {
            try {

                let strjson = null;
                if (request.responseType === 'arraybuffer') {
                    strjson = (new TextDecoder("utf-8")).decode(request.response);
                } else if (request.responseType === 'text') {
                    strjson = request.responseText;
                }
                successHandler(strjson);
            }
            catch (e) {
                errorHandler(e);
            }
        };
        request.onerror = errorHandler;
        request.onabort = errorHandler;

        request.send();

    } catch (e) {
        errorHandler(e);
    }
}

// just maps name to prepared sample buffer, and hands out AudioBufferSourceNodes when needed.
class JSONCache {
    constructor() {
        this.responseMap = {}; // map URL to { text, completions[] }
    }
    loadFromURL(url, onSuccess, onError) {
        let existing = this.responseMap[url];
        if (existing) {
            if (existing.text) {
                onSuccess(existing.text);
                return;
            }
            // it's still loading; add the completion handlers.
            existing.completions.push({ onSuccess, onError });
            return;
        }
        this.responseMap[url] = {
            text: null,
            completions: [{ onSuccess, onError }]
        };
        AjaxJSON(url, text => {
            this.responseMap[url].text = text;
            this.responseMap[url].completions.forEach(h => h.onSuccess(text));
            this.responseMap[url].completions = [];
        }, err => {
            this.responseMap[url].completions.forEach(e => e.onError(err));
            delete this.responseMap[url];//.completions = []; <-- this way it will be available to re-try.
        });
    };
};

const gJSONCache = new JSONCache();

let LoadCachedJSON = function (url, successHandler, errorHandler) {
    gJSONCache.loadFromURL(url, text => successHandler(JSON.parse(text)), errorHandler);
};



// SampleCache holds loading & accessing samples
// DrumKitVoice handles translating a MIDI message into a drum sample
// OneShotInstrument handles polyphony & voicing & triggering & instrument-level effects

// handler receives (buffer)
let gLoadSample = function (audioContext, url, successHandler, errorHandler) {
    try {
        var request = new XMLHttpRequest();
        request.open("GET", url, true);
        request.responseType = "arraybuffer";
        request.onload = () => {
            try {
                audioContext.decodeAudioData(request.response, successHandler, errorHandler);
            } catch (e) {
                errorHandler(e);
            }
        };
        request.onerror = errorHandler;
        request.onabort = errorHandler;
        request.send();
    } catch (e) {
        errorHandler(e);
    }
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
                onSuccess(existing.buffer);
                return;
            }
            // it's still loading; just add the completion handlers.
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
            delete this.sampleMap[url];// it's now available to retry.
        });
    };
};





// we need to be able to convert midi note value to frequency in the graph itself.
// but i don't think it's possible in the superficial obvious way using gainers etc.
// but here we can use a wave shaper to curve it properly.
//
// (midi note stream) --> [divider] --> [shaper] --> [multiplier] -->
// divider is a gainer that scales midi note stream from -128 to 128 to -1 to 1.
// shaper is a wave shaper which converts linear -1 to 1 into a scaled frequency curve
// and multiplier scales the freq curve back up to a true frequency value.
// how much will we scale frequency by? well the highest freq is about 12khz, so let's go with 13000.

let initSynthTools = (audioCtx) => {

    var scaledNoteToScaledFreqCurve = new Float32Array(255);
    for (var i = -127; i <= 127; i++) {
        scaledNoteToScaledFreqCurve[i + 127] = Math.sign(i) * DFU.MidiNoteToFrequency(Math.abs(i)) / 13000.0;
    }

    //Add a new factory method to the AudioContext object.
    audioCtx.createMidiNoteToFrequencyNode = function () {
        audioCtx.beginScope("MIDINoteToFrequency");
        let divider = audioCtx.createGain("MIDINoteToFrequency");
        divider.gain.value = 1.0 / 127.0;

        divider.DFshaper = audioCtx.createWaveShaper("MIDINoteToFrequency");
        divider.DFshaper.curve = scaledNoteToScaledFreqCurve;
        divider.connect(divider.DFshaper);

        divider.DFmultiplier = audioCtx.createGain("MIDINoteToFrequency");
        divider.DFmultiplier.gain.value = 13000;
        divider.DFshaper.connect(divider.DFmultiplier);

        // Override "connect" and "disconnect" method so that the
        //new node's output actually comes from the outpNode.
        divider.oldConnect = divider.connect; // save for later.
        divider.oldDisconnect = divider.disconnect; // save for later.
        divider.connect = function () {
            divider.DFmultiplier.connect.apply(divider.DFmultiplier, arguments);
        }
        divider.disconnect = function () {
            divider.DFshaper.disconnect.apply(divider.DFshaper, arguments);
            divider.DFmultiplier.disconnect.apply(divider.DFmultiplier, arguments);
            divider.oldDisconnect.apply(divider, arguments);
        }
        audioCtx.endScope();
        return divider;
    };

    audioCtx.createDFDelayNode = (name, destNodes) => {
        return new DFDelayNode(audioCtx, name, destNodes);
    }
};

// THIS is a drop-in relacement for the OptimalGainer which just uses non-optimized behavior, for debugging
// purposes. LEAVE IT HERE. it may even be used in the future if there are browsers which don't support selective disconnects.
// class OptimalGainer {
//     constructor(audioCtx, name) {
//         this.name = name;
//         this.audioCtx = audioCtx;
//         this.gainer = this.audioCtx.createGain(this.name);
//     }

//     connect(dest) {
//         this.gainer.connect(dest);
//     }

//     connectFrom(prev) {
//         prev.connect(this.gainer);
//     }

//     disconnect(dest) {
//         if (typeof (dest) === 'undefined') {
//             this.gainer.disconnect();
//         } else {
//             this.gainer.disconnect(dest);
//         }
//     }

//     get gain() {
//         return this.gainer.gain.value;
//     }

//     set gain(val) {
//         this.gainer.gain.value = val;
//     }

// };



// this returns a gainer-like object which removes itself from the audio graph when gain is 0 or 1.
// the catch:
// - gain is no longer an AudioParam.
// - do not connect to this normally (prev.connect(this)). instead, this node needs to know who's connected to it,
//   so you must do this.connectFrom(prev) instead.
// - THERE is a scenario where this just won't work. the graph looks like this:
//
//   [source] --> [this] --> [dest]
//          `-------------->
//  in that case, removing "this" would cause a duplicate linkage between source & dest which won't do what we wish it did.
//
class OptimalGainer {
    constructor(audioCtx, name) {
        this.name = name;
        this.destinations = new Set();
        this.sources = new Set();
        this.audioCtx = audioCtx;
        // default gain is 1.0, which for us is pass-through.
        this.gainer = null;
        this.passthrough = true;
    }

    connect(dest) {
        this.destinations.add(dest);
        if (this.gainer) {
            this.gainer.connect(dest);
        } else if (this.passthrough) {
            // connect all sources to dest
            this.sources.forEach(s => { s.connect(dest); });
        }
    }

    connectFrom(prev) {
        this.sources.add(prev);
        if (this.gainer) {
            prev.connect(this.gainer);
        } else if (this.passthrough) {
            this.destinations.forEach(dest => { prev.connect(dest); });
        }
    }

    disconnect(dest) {
        if (typeof (dest) === 'undefined') {
            // disconnect ALL.
            if (this.gainer) {
                this.gainer.disconnect();
            } else if (this.passthrough) {
                // sources are connected to dests on behalf of this node; remove these specific connections.
                this.destinations.forEach(dest => {
                    this.sources.forEach(src => {
                        try {
                            src.disconnect(dest);
                        } catch (e) {
                            // swallow. if a node fails to disconnect it may just be that it was already disconnected in some other external code.
                        }
                    });
                });
            }
            this.destinations = new Set();
        } else {
            // selective disconnect
            this.destinations.delete(dest);
            if (this.gainer) {
                this.gainer.disconnect(dest);
            } else if (this.passthrough) {
                this.sources.forEach(src => {
                    try {
                        src.disconnect(dest);
                    } catch (e) {
                        // swallow. if a node fails to disconnect it may just be that it was already disconnected in some other external code.
                    }
                });
            }
        }
    }

    get gain() {
        if (this.gainer) return this.gainer.gain.value;
        return this.passthrough ? 1 : 0;
    }

    set gain(val) {
        if (Math.abs(val) < 0.0001) {
            this._ensureZeroMode();
        } else if (Math.abs(1.0 - val) < 0.0001) {
            this._ensurePassthroughMode();
        } else {
            this._ensureGainMode(val);
        }
    }

    listenForZeroModeChange(handler) {
        console.assert(!this.zeroModeChangeHandler);
        this.zeroModeChangeHandler = handler;
    }

    get isZeroMode() {
        return !this.gainer && !this.passthrough;
    }

    _ensureZeroMode() {
        if (this.gainer) {
            this.sources.forEach(src => { // disconnect sources from our gainer
                try {
                    src.disconnect(this.gainer);
                } catch (e) {
                    // swallow. if a node fails to disconnect it may just be that it was already disconnected in some other external code.
                }
            })
            this.gainer.disconnect();
            this.gainer = null;
            this.passthrough = false;
            if (this.zeroModeChangeHandler) {
                this.zeroModeChangeHandler(this);
            }
            return;
        } else if (this.passthrough) {
            this.destinations.forEach(dest => { // disconnect sources from destinations
                this.sources.forEach(src => {
                    try {
                        src.disconnect(dest);
                    } catch (e) {
                        // swallow. if a node fails to disconnect it may just be that it was already disconnected in some other external code.
                    }
                });
            });
            this.passthrough = false;
            if (this.zeroModeChangeHandler) {
                this.zeroModeChangeHandler(this);
            }
            return;
        }
    }

    _ensurePassthroughMode() {
        if (this.gainer) {
            this.sources.forEach(src => { // disconnect sources from our gainer
                try {
                    src.disconnect(this.gainer);
                } catch (e) {
                    // swallow. if a node fails to disconnect it may just be that it was already disconnected in some other external code.
                }
            });
            this.sources.forEach(src => { // connect those sources instead to the destinations.
                this.destinations.forEach(dest => {
                    src.connect(dest);
                })
            });

            this.gainer.disconnect(); // and destroy the gainer.
            this.gainer = null;
            this.passthrough = true;
            return;
        } else if (this.passthrough) {
            return;
        }

        // in zero mode.
        this.sources.forEach(src => { // connect sources to the destinations.
            this.destinations.forEach(dest => {
                src.connect(dest);
            })
        });
        this.passthrough = true;
        if (this.zeroModeChangeHandler) {
            this.zeroModeChangeHandler(this);
        }
    }

    _ensureGainMode(gainVal) {
        if (this.gainer) {
            this.gainer.gain.value = gainVal;
            return;
        }

        this.gainer = this.audioCtx.createGain(this.name);
        this.gainer.gain.value = gainVal;

        if (this.passthrough) {
            this.destinations.forEach(dest => { // disconnect sources from destinations
                this.sources.forEach(src => {
                    try {
                        src.disconnect(dest);
                    } catch (e) {
                        // swallow. if a node fails to disconnect it may just be that it was already disconnected in some other external code.
                    }
                })
            });
        }

        // zero mode

        // connect sources to gainer.
        this.sources.forEach(src => {
            src.connect(this.gainer);
        });

        // and connect gainer to dest
        this.destinations.forEach(dest => {
            this.gainer.connect(dest);
        });

        if (this.zeroModeChangeHandler) {
            this.zeroModeChangeHandler(this);
        }
    }
};



module.exports = {
    initSynthTools,
    gLoadSample,
    OptimalGainer,
    AudioGraphHelper,
    SampleCache,
    AjaxJSON,
    LoadCachedJSON,
};

