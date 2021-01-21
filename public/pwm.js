'use strict';

// thank you https://github.com/pendragon-andyh/WebAudio-PulseOscillator

let initPWM = (ac) => {

    //Pre-calculate the WaveShaper curves so that we can reuse them.
    var pulseCurve = new Float32Array(256);
    for (var i = 0; i < 128; i++) {
        pulseCurve[i] = -1;
        pulseCurve[i + 128] = 1;
    }
    var constantOneCurve = new Float32Array(2);
    constantOneCurve[0] = 1;
    constantOneCurve[1] = 1;


    // when setWaveformType("pwm"),
    //
    //                  [node] -----------> [pulseShaper] --> [outpNode]
    //                    |               |
    //    [constantOneShaper] --> [widthGain]

    // or for any other normal type,
    //
    //                  [this] --> [outp]

    //Add a new factory method to the AudioContext object.
    ac.createPulseOscillator = function () {
        //Use a normal oscillator as the basis of our new oscillator.
        var node = this.createOscillator();
        node.type = "sawtooth";

        //Pass a constant value of 1 into the widthGain – so the "width" setting
        //is duplicated to its output.
        node.constantOneShaper = this.createWaveShaper();
        node.constantOneShaper.curve = constantOneCurve;
        node.connect(node.constantOneShaper);

        //Use a GainNode as our new "width" audio parameter.
        var widthGain = ac.createGain();
        widthGain.gain.value = 0; //Default width.
        node.width = widthGain.gain; //Add parameter to oscillator node.
        node.constantOneShaper.connect(widthGain);

        //Shape the output into a pulse wave.
        node.pulseShaper = ac.createWaveShaper();
        node.pulseShaper.curve = pulseCurve;
        node.connect(node.pulseShaper);
        widthGain.connect(node.pulseShaper);

        // create an output node
        node.outpNode = ac.createGain();
        node.outpNode.gain.value = 1;
        node.pulseShaper.connect(node.outpNode);

        //Override the oscillator's "connect" and "disconnect" method so that the
        //new node's output actually comes from the outpNode.
        node.oscConnect = node.connect; // save for later.
        node.oscDisconnect = node.disconnect; // save for later.
        node.connect = function () {
            node.outpNode.connect.apply(node.outpNode, arguments);
        }
        node.disconnect = function () {
            node.outpNode.disconnect.apply(node.outpNode, arguments);
        }

        // now, we want to be able to still use the "type" property. so using this function,
        // setWaveformType(), you can switch between waveforms seamlessly.
        node.isPWM = true;
        node.setWaveformType = function(shape) {
            if (shape == "pwm") {
                if (this.isPWM) return;
                // we need to switch to PWM mode.
                this.isPWM = true;
                this.oscDisconnect();
                this.pulseShaper.disconnect();
                this.oscConnect(this.constantOneShaper);
                this.oscConnect(this.pulseShaper);
                this.pulseShaper.connect(this.outpNode);
                return;
            }
            this.type = shape;
            if (!this.isPWM) return;
            this.isPWM = false;
            // we need to switch to standard mode.
            this.oscDisconnect();
            this.pulseShaper.disconnect();
            this.oscConnect(this.outpNode);
        }.bind(node);

        return node;
    }
};
