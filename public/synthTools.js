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
        scaledNoteToScaledFreqCurve[i + 127] = Math.sign(i) * FrequencyFromMidiNote(Math.abs(i)) / 13000.0;
    }

    //Add a new factory method to the AudioContext object.
    audioCtx.createMidiNoteToFrequencyNode = function () {
        let divider = audioCtx.createGain();
        divider.gain.value = 1.0 / 127.0;

        let shaper = audioCtx.createWaveShaper();
        shaper.curve = scaledNoteToScaledFreqCurve;
        divider.connect(shaper);

        let multiplier = audioCtx.createGain();
        multiplier.gain.value = 13000;
        shaper.connect(multiplier);

        // Override "connect" and "disconnect" method so that the
        //new node's output actually comes from the outpNode.
        divider.oldConnect = divider.connect; // save for later.
        divider.oldDisconnect = divider.disconnect; // save for later.
        divider.connect = function () {
            multiplier.connect.apply(multiplier, arguments);
        }
        divider.disconnect = function () {
            multiplier.disconnect.apply(multiplier, arguments);
        }

        return divider;
    };
};


