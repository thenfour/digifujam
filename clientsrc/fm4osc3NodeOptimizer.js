const AudioGraphHelper = require('./synthTools').AudioGraphHelper;

/*
    each oscillator has                                                          
                                                                          |gain          |gain     |gain
                                |gain               |gain          [lfo1PanAmt]+[lfo2PanAmt]+[env1PanAmt]
                            [lfo1LevelAmt]       [lfo2LevelAmt]              |
                               |                    |                        |
                               |                    |                        |
                              |gain                |gain                    |pan
  [envGainer] --------> [lfo1gainer]  -----> [lfo2gainer]  ------------> [panner]  ---> dest

  these 3 nodes:             ^                   ^                          ^

  can all be optimized out most of the time, when they're not in use.
  the trick is to make the correct connections depending on the state of all the incoming nodes.
  only when ALL incoming nodes are in "zero mode" can a node be eliminated.

  another complicating factor is that the panner node is consiedred the "output node" of the oscillator,
  which means if we're switching it on and off, then we also need to reroute the destination.

  so we need to expose a "connect" method and make sure to handle this.

  seems like a lot of logic & effort to remove 1 node, but most of the time they are in zero mode,
  and this is for each oscillator of each voice of polyphony. At 10 polyphony 4 oscillator, that's already 40
  nodes just for 1 synth instance. And most of the time all 3 nodes will be disabled, for 120 eliminated nodes.
  I think each oscillator has somethnig like 7 other required nodes so it's really significant.
*/

class FM4OscThreeNodeOptimizer {
    // opts holds all the connected nodes referenced in the diagram above.
    constructor(opts) {
        /*
            opts is :

            audioCtx,
            initialPanValue,
            envGainer,  <-- source node
            lfo1LevelAmt,
            lfo2LevelAmt,
            lfo1PanAmt,
            lfo2PanAmt,
            env1PanAmt,
        */
        this.opts = opts;
        this.audioCtx = opts.audioCtx;
        this.destinations = new Set();
        this.outputNode = opts.envGainer; // initially passthrough
        this.basePanValue = this.opts.initialPanValue;

        // subscribe to mode changes
        opts.lfo1LevelAmt.listenForZeroModeChange(() => this.ensureCorrectConnections());
        opts.lfo2LevelAmt.listenForZeroModeChange(() => this.ensureCorrectConnections());
        opts.lfo1PanAmt.listenForZeroModeChange(() => this.ensureCorrectConnections());
        opts.lfo2PanAmt.listenForZeroModeChange(() => this.ensureCorrectConnections());
        opts.env1PanAmt.listenForZeroModeChange(() => this.ensureCorrectConnections());

        this.basePanValue = opts.initialPanValue; // this will ensure the correct connections / nodes.
    }

    connect(dest) {
        this.destinations.add(dest);
        if (this.outputNode) {
            this.outputNode.connect(dest);
        }
    }

    disconnect() {
        // this is called to totally deconstruct.
        if (this.lfo1gainer && this.opts.lfo1LevelAmt) {
            this.opts.lfo1LevelAmt.disconnect();
        }
        if (this.lfo1gainer) {
            this.lfo1gainer.disconnect();
        }

        if (this.lfo2gainer && this.opts.lfo2LevelAmt) {
            this.opts.lfo2LevelAmt.disconnect();
        }
        if (this.lfo2gainer) {
            this.lfo2gainer.disconnect();
        }

        if (this.panner && this.opts.lfo1PanAmt) {
            this.opts.lfo1PanAmt.disconnect();
        }
        if (this.panner && this.opts.lfo2PanAmt) {
            this.opts.lfo2PanAmt.disconnect();
        }
        if (this.panner && this.opts.env1PanAmt) {
            this.opts.env1PanAmt.disconnect();
        }
        if (this.panner) {
            this.panner.disconnect();
        }
    }

    // try to make as few changes as possible because this happens during param sliding.
    ensureCorrectConnections() {
        // first create/destroy nodes as needed, then set up the graph topology.

        // lfo1gainer
        // if zero mode, it means the "gain" of the LFO is sent 0. which means no LFO influence. Default
        // base gain is 1, so zero mode means we can pass through.
        // if lfo1LevelAmt is passthrough or gain mode, it means amt is >0, and the LFO is let through.. we need the gainer in this case.
        const shouldLfo1GainerBeConnected = !this.opts.lfo1LevelAmt.isZeroMode;
        if (shouldLfo1GainerBeConnected) {
            if (!this.lfo1gainer) {
                this.lfo1gainer = this.audioCtx.createGain("osc>lfo1gainer");
            }
            this.opts.lfo1LevelAmt.connect(this.lfo1gainer.gain);
        } else {
            if (this.lfo1gainer) {
                this.opts.lfo1LevelAmt.disconnect();
                this.lfo1gainer.disconnect();
                this.lfo1gainer = null;
            }
        }

        // lfo2gainer
        const shouldLfo2GainerBeConnected = !this.opts.lfo2LevelAmt.isZeroMode;
        if (shouldLfo2GainerBeConnected) {
            if (!this.lfo2gainer) {
                this.lfo2gainer = this.audioCtx.createGain("osc>lfo2gainer");
            }
            this.opts.lfo2LevelAmt.connect(this.lfo2gainer.gain);
        } else {
            if (this.lfo2gainer) {
                this.opts.lfo2LevelAmt.disconnect();
                this.lfo2gainer.disconnect();
                this.lfo2gainer = null;
            }
        }

        // panner
        // for panner it's the same logic; when zero mode for ALL sources including our own base value,
        // then remove self.
        // if pan value is anything but 0, then we must use the panner node.
        const shouldPannerBeConnected =
            !this.opts.lfo1PanAmt.isZeroMode
            || !this.opts.lfo2PanAmt.isZeroMode
            || !this.opts.env1PanAmt.isZeroMode
            || (this.basePanValue != 0);

        if (shouldPannerBeConnected) {
            if (!this.panner) {
                this.panner = this.audioCtx.createStereoPanner("osc>panner");
            }
            this.panner.pan.value = this.basePanValue;
            this.opts.lfo1PanAmt.connect(this.panner.pan);
            this.opts.lfo2PanAmt.connect(this.panner.pan);
            this.opts.env1PanAmt.connect(this.panner.pan);
        } else {
            if (this.panner) {
                this.opts.lfo1PanAmt.disconnect();
                this.opts.lfo2PanAmt.disconnect();
                this.opts.env1PanAmt.disconnect();
                this.panner.disconnect();
                this.panner = null;
            }
        }

        // connect up the graph now, and set dest node.
        if (this.lfo1gainer) {
            if (this.lfo2gainer) {
                if (this.panner) {
                    // (opts.envGainer) --> [lfo1gainer] --> [lfo2gainer] --> [panner] -->
                    this.opts.envGainer.connect(this.lfo1gainer);
                    this.lfo1gainer.connect(this.lfo2gainer);
                    this.lfo2gainer.connect(this.panner);
                    this.outputNode = this.panner;
                } else {
                    // (opts.envGainer) --> [lfo1gainer] --> [lfo2gainer] --> 
                    this.opts.envGainer.connect(this.lfo1gainer);
                    this.lfo1gainer.connect(this.lfo2gainer);
                    this.outputNode = this.lfo2gainer;
                }
            } else {
                if (this.panner) {
                    // (opts.envGainer) --> [lfo1gainer] --> [panner] -->
                    this.opts.envGainer.connect(this.lfo1gainer);
                    this.lfo1gainer.connect(this.panner);
                    this.outputNode = this.panner;
                } else {
                    // (opts.envGainer) --> [lfo1gainer] -->
                    this.opts.envGainer.connect(this.lfo1gainer);
                    this.outputNode = this.lfo1gainer;
                }
            }
        } else {
            if (this.lfo2gainer) {
                if (this.panner) {
                    // (opts.envGainer) --> [lfo2gainer] --> [panner] -->
                    this.opts.envGainer.connect(this.lfo2gainer);
                    this.lfo2gainer.connect(this.panner);
                    this.outputNode = this.panner;
                } else {
                    // (opts.envGainer) --> [lfo2gainer] -->
                    this.opts.envGainer.connect(this.lfo2gainer);
                    this.outputNode = this.lfo2gainer;
                }
            } else {
                if (this.panner) {
                    // (opts.envGainer) --> [panner] -->
                    this.opts.envGainer.connect(this.panner);
                    this.outputNode = this.panner;
                } else {
                    // (opts.envGainer) -->
                    this.outputNode = this.opts.envGainer;
                }
            }
        }

        // and connect to destinations.
        this.destinations.forEach(dest => {
            this.outputNode.connect(dest);
        });
    }

    SetBasePanValue(p) {
        this.basePanValue = p;
        this.ensureCorrectConnections();
    }
};


module.exports = {
    FM4OscThreeNodeOptimizer,
};

