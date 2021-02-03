'use strict';

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
        scaledNoteToScaledFreqCurve[i + 127] = Math.sign(i) * MidiNoteToFrequency(Math.abs(i)) / 13000.0;
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
};

// THIS is a drop-in relacement for the OptimalGainer which just uses non-optimized behavior, for debugging
// purposes. LEAVE IT HERE. it may even be used in the future if there are browsers which don't support selective disconnects.

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

    _ensureZeroMode() {
        if (this.gainer) {
            //console.log(`${this.name} gain => zero`);
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
            return;
        } else if (this.passthrough) {
            //console.log(`${this.name} passthrough => zero`);
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
            return;
        }
    }

    _ensurePassthroughMode() {
        if (this.gainer) {
            //console.log(`${this.name} gain => passthrough`);
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
        //console.log(`${this.name} zero => passthrough`);
    }

    _ensureGainMode(gainVal) {
        if (this.gainer) {
            this.gainer.gain.value = gainVal;
            return;
        }

        this.gainer = this.audioCtx.createGain(this.name);
        this.gainer.gain.value = gainVal;

        if (this.passthrough) {
            //console.log(`${this.name} passthrough => gain`);
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

        //console.log(`${this.name} zero => gain`);

        // connect sources to gainer.
        this.sources.forEach(src => {
            src.connect(this.gainer);
        });

        // and connect gainer to dest
        this.destinations.forEach(dest => {
            this.gainer.connect(dest);
        });
    }
};
