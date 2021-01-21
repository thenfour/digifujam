'use strict';




//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class PolySynthVoice {
    constructor(audioCtx, dryDestination, wetDestination, instrumentSpec) {
        this.instrumentSpec = instrumentSpec;
        this.audioCtx = audioCtx;
        this.dryDestination = dryDestination;
        this.wetDestination = wetDestination;

        this.midiNote = 0;
        this.velocity = 0;
        this.pitchBend = 0; // semitones

        this.timestamp = null; // when did the note on start?

        this.detune = this.instrumentSpec.GetParamByID("detune").currentValue;
        this.cutoff = this.instrumentSpec.GetParamByID("cutoff").currentValue;

        this.isConnected = false;
        this.peakGain = 0.017;
    }

    connect() {
        if (this.isConnected) return;

        /*

            [oscillator1]-->[osc1Panner]------->
            [oscillator2]-->[osc2Panner]------->
            [oscillator3]-->[osc3Panner]------->[gain] --> [filter] --> [masterDryGain] --> 
                                                |                    > [masterWetGain] --> 
                                                |gain
                            [gainEnvelope]----->
        
        */

        // panners
        this.osc1Panner = this.audioCtx.createStereoPanner();
        this.osc2Panner = this.audioCtx.createStereoPanner();
        this.osc3Panner = this.audioCtx.createStereoPanner();
        this.osc1Panner.pan.value = -.5;
        this.osc2Panner.pan.value = 0.0;
        this.osc3Panner.pan.value = +.5;

        // gainEnvelope
        this.gainEnvelope = ADSRNode(this.audioCtx, { // https://github.com/velipso/adsrnode
            attack: this.instrumentSpec.GetParamByID("a").currentValue,//0.008, // seconds until hitting 1.0
            peak: this.peakGain, // why must this be so low? not sure...
            decay: this.instrumentSpec.GetParamByID("d").currentValue,//4.0, // seconds until hitting sustain value
            decayCurve: 6.8, // https://rawgit.com/voidqk/adsrnode/master/demo.html
            sustain: this.instrumentSpec.GetParamByID("s").currentValue * this.peakGain,//0.0, // sustain value
            release: this.instrumentSpec.GetParamByID("r").currentValue,// 0.07  // seconds until returning back to 0.0
            releaseCurve: 6.8,
        });
        this.gainEnvelope.start();//gain.value = 0.0;  // Mute the sound  // this thing does not like to be started more than once even with stop() in between

        // gain
        this.gain = this.audioCtx.createGain();
        this.gain.gain.value = 0; // a base value before controlled by adsr
        this.gainEnvelope.connect(this.gain.gain);
        this.osc1Panner.connect(this.gain);
        this.osc2Panner.connect(this.gain);
        this.osc3Panner.connect(this.gain);

        // filter
        this.filter = this.audioCtx.createBiquadFilter();
        this.gain.connect(this.filter);
        this.filter.type = "lowpass";
        this.filter.frequency.value = 2500; // will be set on note on.
        this.filter.Q.value = this.instrumentSpec.GetParamByID("q").currentValue;

        // masterDryGain
        this.masterDryGain = this.audioCtx.createGain();
        // masterWetGain
        this.masterWetGain = this.audioCtx.createGain();
        let gainLevels = this.getGainLevels();
        this.masterDryGain.gain.value = gainLevels[0];
        this.masterWetGain.gain.value = gainLevels[1];

        this.filter.connect(this.masterDryGain);
        this.filter.connect(this.masterWetGain);

        // connect out.
        this.masterDryGain.connect(this.dryDestination);
        this.masterWetGain.connect(this.wetDestination);

        this.isConnected = true;

        this._setOscWaveform();
    }

    disconnect() {
        this.AllNotesOff();
        if (!this.isConnected) return;

        this.gainEnvelope.stop();

        this._disconnectOscillators();

        this.gainEnvelope.stop();


        this.osc1Panner.disconnect();
        this.osc2Panner.disconnect();
        this.osc3Panner.disconnect();

        this.gainEnvelope.disconnect();

        this.gain.disconnect();

        this.filter.disconnect();

        this.masterDryGain.disconnect();
        this.masterDryGain = null;

        this.masterWetGain.disconnect();
        this.masterWetGain = null;

        // set to null
        this.gainEnvelope = null;
        this.osc1Panner = null;
        this.osc2Panner = null;
        this.osc3Panner = null;
        this.gainEnvelope = null;
        this.gain = null;
        this.filter = null;

        this.isConnected = false;
    }

    get IsPlaying() {
        return !!this.timestamp;
    }

    _createOscillators() {
        // oscillators
        let waveType = this.instrumentSpec.GetParamByID("wave").currentValue
        const shapes = ["sine", "square", "sawtooth", "triangle", "pwm"];
        let shape = shapes[waveType];
        if (shape == "pwm") {
            this.oscillator1 = this.audioCtx.createPulseOscillator();
            this.oscillator2 = this.audioCtx.createPulseOscillator();
            this.oscillator3 = this.audioCtx.createPulseOscillator();
            let dc = this.instrumentSpec.GetParamByID("dutyCycle").currentValue;
            this.oscillator1.width.value = dc;
            this.oscillator2.width.value = dc;
            this.oscillator3.width.value = dc;
        } else {
            this.oscillator1 = this.audioCtx.createOscillator();
            this.oscillator2 = this.audioCtx.createOscillator();
            this.oscillator3 = this.audioCtx.createOscillator();
            this.oscillator1.type = shape;
            this.oscillator2.type = shape;
            this.oscillator3.type = shape;
        }

        // set wave not yet.
        this.oscillator1.start(0);  // Go ahead and start up the oscillator
        this.oscillator2.start(0);  // Go ahead and start up the oscillator
        this.oscillator3.start(0);  // Go ahead and start up the oscillator
        this.oscillator1.connect(this.osc1Panner);
        this.oscillator2.connect(this.osc2Panner);
        this.oscillator3.connect(this.osc3Panner);
    }

    _disconnectOscillators() {
        if (!this.oscillator1) return;
        this.oscillator1.stop();
        this.oscillator2.stop();
        this.oscillator3.stop();
        this.oscillator1.disconnect();
        this.oscillator2.disconnect();
        this.oscillator3.disconnect();
        this.oscillator1 = null;
        this.oscillator2 = null;
        this.oscillator3 = null;
    }

    _setOscWaveform() {
        this._disconnectOscillators();
        this._createOscillators();
    }

    // returns [drygain, wetgain]
    getGainLevels() {
        let ms = this.instrumentSpec.GetParamByID("masterGain").currentValue;
        let vg = this.instrumentSpec.GetParamByID("verbMix").currentValue;
        // when verb mix is 0, drygain is the real master gain.
        // when verb mix is 1, drygain is 0 and verbmix is mastergain
        return [(1.0 - vg) * ms, vg * ms * 1.3]; // multiply verb gain to compensate, try and make wet as loud as dry.
    }

    SetParamValue(paramID, newVal) {
        switch (paramID) {
            case "pb":
                this.PitchBend(newVal);
                break;
            case "dutyCycle":
                if (this.oscillator1.width) {
                    this.oscillator1.width.value = newVal;
                    this.oscillator2.width.value = newVal;
                    this.oscillator3.width.value = newVal;
                }
                break;
            case "masterGain":
            case "verbMix":
                let levels = this.getGainLevels();
                this.masterDryGain.gain.linearRampToValueAtTime(levels[0], ClientSettings.InstrumentParamIntervalMS / 1000);
                this.masterWetGain.gain.linearRampToValueAtTime(levels[1], ClientSettings.InstrumentParamIntervalMS / 1000);
                break;
            case "detune":
                this.detune = newVal;
                let freqs = this._getOscFreqs();
                this.oscillator1.frequency.linearRampToValueAtTime(freqs[0], ClientSettings.InstrumentParamIntervalMS / 1000);
                this.oscillator2.frequency.linearRampToValueAtTime(freqs[1], ClientSettings.InstrumentParamIntervalMS / 1000);
                this.oscillator3.frequency.linearRampToValueAtTime(freqs[2], ClientSettings.InstrumentParamIntervalMS / 1000);
                break;
            case "wave":
                this._setOscWaveform();
                break;
            case "q":
                this.filter.Q.linearRampToValueAtTime(newVal, ClientSettings.InstrumentParamIntervalMS / 1000);
                break;
            case "cutoff":
                this.cutoff = newVal;
                this.filter.frequency.linearRampToValueAtTime((this.velocity / 128) * this.cutoff, ClientSettings.InstrumentParamIntervalMS / 1000);
                break;
            case "a":
                this.gainEnvelope.update({ attack: newVal });
                break;
            case "d":
                this.gainEnvelope.update({ decay: newVal });
                break;
            case "s":
                this.gainEnvelope.update({ sustain: newVal * this.peakGain });
                break;
            case "r":
                this.gainEnvelope.update({ release: newVal });
                break;
        }
    }

    _getOscFreqs() {
        return [
            FrequencyFromMidiNote(this.pitchBend + this.midiNote + this.detune),
            FrequencyFromMidiNote(this.pitchBend + this.midiNote),
            FrequencyFromMidiNote(this.pitchBend + this.midiNote - this.detune),
        ];
    }

    PitchBend(val /*semis*/) {
        this.pitchBend = val;//((val / 0x3fff) * 2) - 1;
        let freqs = this._getOscFreqs();
        this.oscillator1.frequency.linearRampToValueAtTime(freqs[0], ClientSettings.InstrumentParamIntervalMS / 1000);
        this.oscillator2.frequency.linearRampToValueAtTime(freqs[1], ClientSettings.InstrumentParamIntervalMS / 1000);
        this.oscillator3.frequency.linearRampToValueAtTime(freqs[2], ClientSettings.InstrumentParamIntervalMS / 1000);
    }

    physicalAndMusicalNoteOn(midiNote, velocity) {
        this.timestamp = new Date();
        this.midiNote = midiNote;
        this.velocity = velocity;

        this.filter.frequency.value = (velocity / 128) * this.cutoff;

        let freqs = this._getOscFreqs();
        this.oscillator1.frequency.setValueAtTime(freqs[0], 0);
        this.oscillator2.frequency.setValueAtTime(freqs[1], 0);
        this.oscillator3.frequency.setValueAtTime(freqs[2], 0);

        this.gainEnvelope.trigger();
    }

    musicallyRelease() {
        this.timestamp = null;
        this.midiNote = 0;

        //this.filterEnvelope.release();
        this.gainEnvelope.release();
    }

    AllNotesOff() {
        if (this.gainEnvelope) this.gainEnvelope.reset();
        this.midiNote = 0;
        this.timestamp = null;
        this.velocity = 0;
        this.pitchBend = 0;
    }

};


