'use strict';

//Pre-calculate the WaveShaper curves so that we can reuse them.
var gDFWaveshapingPulseCurve = new Float32Array(256);
for (var i = 0; i < 128; i++) {
    gDFWaveshapingPulseCurve[i] = -1;
    gDFWaveshapingPulseCurve[i + 128] = 1;
}

// PWM mode: when setWaveformType("pwm"),
//
//                  [osc(sawtooth)] ----> [pulseShaper] -->
//                 [shifter<width>] ---->
//
// NORMAL mode: for any other wave type,
//
//                  [osc] -->
//
class DFOscillator {
    constructor(audioCtx, name) {
        this.audioCtx = audioCtx;
        this.name = name;
        this.waveformType = "";

        this.destinations = new Set();

        this.osc = this.audioCtx.createOscillator("pwm");
        this.pulseShaper = null; // when null, this is not PWM mode.
        this.shifter = this.audioCtx.createConstantSource("pwm"); // this is always created, because it exposes an audioparam which i don't want to deal with optimizing conditionally.
        this.shifter.start();

        this.width = this.shifter.offset; // expose this audioparam as our own
        this.start = this.osc.start.bind(this.osc);
        this.stop = this.osc.stop.bind(this.osc);
        this.frequency = this.osc.frequency; // expose this audioparam as our own
    }

    connect(dest) {
        this.destinations.add(dest);
        if (!this.pulseShaper) {
            // NORMAL mode
            this.osc.connect(dest);
        } else {
            // PWM mode
            this.pulseShaper.connect(dest);
        }
    }

    disconnect(dest) {
        if (typeof (dest) === 'undefined') {
            // disconnect ALL.
            if (!this.pulseShaper) {
                // NORMAL mode
                this.osc.disconnect();
            } else {
                // PWM mode
                this.pulseShaper.disconnect();
            }
            this.destinations = new Set();
        } else {
            // selective disconnect
            this.destinations.delete(dest);
            if (!this.pulseShaper) {
                // NORMAL mode
                this.osc.disconnect(dest);
            } else {
                // PWM mode
                this.pulseShaper.disconnect(dest);
            }
        }
    }

    destroy() {
        this.osc.disconnect();
        if (this.pulseShaper) {
            this.pulseShaper.disconnect();
            this.pulseShaper = null;
        }
        if (this.shifter) {
            this.shifter.disconnect();
            this.shifter = null;
        }
    }

    get type() {
        if (!!this.pulseShaper) return "pwm";
        return this.osc.type;
    }

    set type(val) {
        if (val === "pwm") {
            this._ensurePWMMode();
            return;
        }
        this._ensureNormalMode();
        this.osc.type = val;
    }

    _ensureNormalMode() {
        if (!this.pulseShaper) return;

        // transition from 
        //                  [osc(sawtooth)] ----> [pulseShaper] -->
        //                 [shifter<width>] ---->
        //
        // to NORMAL mode: for any other wave type,
        //
        //                  [osc] -->

        this.osc.disconnect();
        this.pulseShaper.disconnect();
        this.pulseShaper = null;

        this.shifter.disconnect();

        this.destinations.forEach(dest => {
            this.osc.connect(dest);
        });

    }

    _ensurePWMMode() {
        if (this.pulseShaper) return;

        // transition from 
        //                  [osc] -->
        // to
        //                  [osc(sawtooth)] ----> [pulseShaper] -->
        //                 [shifter<width>] ---->

        this.osc.disconnect();

        // create pulse shape.
        this.pulseShaper = this.audioCtx.createWaveShaper("pwm");
        this.pulseShaper.curve = gDFWaveshapingPulseCurve;

        this.shifter.connect(this.pulseShaper);

        this.destinations.forEach(dest => {
            this.pulseShaper.connect(dest);
        });

        this.osc.connect(this.pulseShaper);
        this.shifter.connect(this.pulseShaper);
    }
};

