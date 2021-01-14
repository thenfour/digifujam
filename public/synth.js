'use strict';


//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class DigifuSynth {
	constructor() {
		this.audioCtx = null;
		this.instruments = {};
		this.instrumentGainers = {}; // key = instrumentID

		this.instrumentSpecs = null;
		this.internalMasterGain = null;

		this.masterEffectsInputNode = null;
		this.masterReverbGain = null;

		this._isMuted = false;
	}

	//this.masterGain = 1.0;// 0 = mute, 1.0 = unity, >1=amplify
	set masterGain(val) {
		if (!this.masterEffectsInputNode) return;
		this.masterEffectsInputNode.gain.value = val;
	}

	get masterGain() {
		if (!this.masterEffectsInputNode) return 1.0;
		return this.masterEffectsInputNode.gain.value;
	}

	set reverbGain(val) {
		if (!this.masterReverbGain) return;
		this.masterReverbGain.gain.value = val;

		if (val > 0.0001) {
			this.masterReverb.connect(this.masterReverbGain);
		} else {
			this.masterReverb.disconnect();
		}
	}

	get reverbGain() {
		if (!this.masterEffectsInputNode) return 0.5;
		if (!this.masterReverbGain) return 0.5;
		return this.masterReverbGain.gain.value;
	}

	get isMuted() {
		return this._isMuted; // unfortunately no "is connected" api exists so we must keep state.
	}

	set isMuted(val) {
		// instrumentSpecs, internalMasterGain
		if (val) {
			// stop all instruments and disconnect our graph temporarily
			this.masterReverbGain.disconnect();
			this.masterEffectsInputNode.disconnect();
			Object.keys(this.instruments).forEach(k => {
				this.instruments[k].disconnect();
			});
		} else {
			this.masterEffectsInputNode.connect(this.masterReverb);
			this.masterEffectsInputNode.connect(this.audioCtx.destination);
			this.masterReverbGain.connect(this.audioCtx.destination);
			//this.masterReverbGain.connect(this.audioCtx.destination);
			//this.reverbGain = this.reverbGain; // handles whether it should reconnect verb nodes

			// no need to reconnect; it should be done automatically.
			// Object.keys(this.instruments).forEach(k => {
			// 	this.instruments[k].connect(this.instrumentGainers[k]);
			// });
		}
		this._isMuted = !!val;
	}

	NoteOn(instrumentSpec, note, velocity) {
		if (this._isMuted) return;
		this.instruments[instrumentSpec.instrumentID].NoteOn(note, velocity);
	};

	NoteOff(instrumentSpec, note) {
		if (this._isMuted) return;
		this.instruments[instrumentSpec.instrumentID].NoteOff(note);
	};

	AllNotesOff(instrumentSpec) {
		if (this._isMuted) return;
		this.instruments[instrumentSpec.instrumentID].AllNotesOff();
	};

	PedalUp(instrumentSpec) {
		if (this._isMuted) return;
		this.instruments[instrumentSpec.instrumentID].PedalUp();
	};

	PedalDown(instrumentSpec) {
		if (this._isMuted) return;
		this.instruments[instrumentSpec.instrumentID].PedalDown();
	};

	PitchBend(instrumentSpec, val) {
		if (this._isMuted) return;
		this.instruments[instrumentSpec.instrumentID].PitchBend(val);
	};

	ConnectInstrument(instrumentSpec) {
		this.instruments[instrumentSpec.instrumentID].connect();
	}

	DisconnectInstrument(instrumentSpec) {
		this.instruments[instrumentSpec.instrumentID].disconnect();
	}

	// call when you have a list of instruments
	InitInstruments(instrumentSpecs, internalMasterGain) {
		this.instrumentSpecs = instrumentSpecs;
		this.internalMasterGain = internalMasterGain;
		this.UninitInstruments();
		instrumentSpecs.forEach(s => {
			let gainer = this.audioCtx.createGain();
			gainer.gain.value = 1;
			if (s.gain) {
				gainer.gain.value = s.gain;
			}
			gainer.gain.value *= internalMasterGain; // internal fader just for keeping things not too quiet. basically a complement to individual instrument gains.
			gainer.connect(this.masterEffectsInputNode);
			this.instrumentGainers[s.instrumentID] = gainer;
			switch (s.engine) {
				case "synth":
					this.instruments[s.instrumentID] = new PolySynth(this.audioCtx, gainer, s);
					break;
				case "soundfont":
					this.instruments[s.instrumentID] = new SoundfontInstrument(this.audioCtx, gainer, s);
					break;
			}
			//if (s.controlledByUserID) {
			//	this.instruments[s.instrumentID].connect(gainer);
			//}
		});
	};

	UninitInstruments() {
		for (let inst in this.instruments) {
			this.instruments[inst].disconnect();
		}
		for (let inst in this.instrumentGainers) {
			this.instrumentGainers[inst].disconnect();
		}
		this.instrumentGainers = {};
		this.instruments = {};
	}

	// call as a sort of ctor
	Init(audioCtx) {
		console.assert(!this.audioCtx); // don't init more than once

		this.audioCtx = audioCtx;
		if (!this.audioCtx.createReverbFromUrl) {
			reverbjs.extend(this.audioCtx);
		}

		// instruments] -> gain|------------------------------>|destination
		//                     |--> reverb ----> reverbGain -->|
		this.masterEffectsInputNode = this.audioCtx.createGain();
		// create dry signal path
		this.masterEffectsInputNode.connect(this.audioCtx.destination);

		// see other possible impulses: https://github.com/burnson/Reverb.js
		this.masterReverb = this.audioCtx.createReverbFromUrl("./LadyChapelStAlbansCathedral.m4a", () => {

			// create wet signal path
			this.masterReverbGain = this.audioCtx.createGain();

			this.masterEffectsInputNode.connect(this.masterReverb);
			this.masterReverb.connect(this.masterReverbGain);
			this.masterReverbGain.connect(this.audioCtx.destination);

			//
			this.masterReverbGain.gain.value = 0.5;
		});
	};
};


