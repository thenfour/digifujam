'use strict';

const gGainBoost = 2.0;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class DigifuSynth {
	constructor() {
		this.audioCtx = null;
		this.instruments = {};
		this.instrumentDryGainers = {}; // key = instrumentID
		this.instrumentWetGainers = {}; // key = instrumentID

		this.instrumentSpecs = null;
		this.internalMasterGain = null;

		this._isMuted = false;
		this.sampleLibrarian = null;
	}

	//this.masterGain = 1.0;// 0 = mute, 1.0 = unity, >1=amplify
	set masterGain(val) {
		if (!this.masterGainNode) return;
		this.masterGainNode.gain.value = val;
	}

	get masterGain() {
		if (!this.masterGainNode) return 1.0;
		return this.masterGainNode.gain.value;
	}

	get isMuted() {
		return this._isMuted; // unfortunately no "is connected" api exists so we must keep state.
	}

	set isMuted(val) {
		// instrumentSpecs, internalMasterGain
		if (val) {
			// stop all instruments and disconnect our graph temporarily
			this.masterReverb.disconnect();
			this.masterGainNode.disconnect();
			Object.keys(this.instruments).forEach(k => {
				this.instruments[k].disconnect();
			});
		} else {
			this.masterGainNode.connect(this.audioCtx.destination);
			this.masterReverb.connect(this.preMasterGain);
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
		if (!instrumentSpec) {
			// do for all instruments.
			Object.values(this.instruments).forEach(i => { i.AllNotesOff(); });
			return;
		}
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

	createParamMapping(inst, param, srcVal) {
		inst.ensureParamMappingParams(param, srcVal);
	}

	removeParamMapping(inst, param) {
		let patchObj = inst.removeParamMapping(param);
		this.SetInstrumentParams(inst, patchObj);
	}

	// returns true if the param changes incurred mapping propagation to other params
	SetInstrumentParams(instrumentSpec, patchObj /* RAW values, not calculated */) {
		const x = instrumentSpec.integrateRawParamChanges(patchObj);
		if (!this._isMuted) {
			this.instruments[instrumentSpec.instrumentID].SetParamValues(x.calculatedPatchObj);
		}
		return x.incurredMappings;
	}

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
		instrumentSpecs.forEach(spec => {
			let dryGainer = this.audioCtx.createGain("inst gainer");
			dryGainer.gain.value = 1;
			if (spec.gain) {
				dryGainer.gain.value = spec.gain;
			}
			dryGainer.gain.value *= internalMasterGain; // internal fader just for keeping things not too quiet. basically a complement to individual instrument gains.
			dryGainer.connect(this.preMasterGain);
			this.instrumentDryGainers[spec.instrumentID] = dryGainer;

			let wetGainer = this.audioCtx.createGain("inst gainer");
			wetGainer.gain.value = 1;
			if (spec.gain) {
				wetGainer.gain.value = spec.gain;
			}
			wetGainer.gain.value *= internalMasterGain; // internal fader just for keeping things not too quiet. basically a complement to individual instrument gains.
			if (this.masterReverb) {
				wetGainer.connect(this.masterReverb);
			}
			this.instrumentWetGainers[spec.instrumentID] = wetGainer;

			switch (spec.engine) {
				case "minifm":
					this.instruments[spec.instrumentID] = new FMPolySynth(this.audioCtx, dryGainer, wetGainer, spec, (c, s) => new MiniFMSynthVoice(c, s));
					break;
				case "soundfont":
					this.instruments[spec.instrumentID] = new SoundfontInstrument(this.audioCtx, dryGainer, wetGainer, spec);
					break;
				case "drumkit":
					this.instruments[spec.instrumentID] = new OneShotInstrument(this.audioCtx, this.sampleLibrarian, dryGainer, wetGainer, spec, (s, l) => new DrumKitVoice(s, l));
					break;
				default:
					alert(`Unknown synth engine '${spec.engine}'`);
					break;
			}
		});
	};

	UninitInstruments() {
		for (let inst in this.instruments) {
			this.instruments[inst].disconnect();
		}

		for (let inst in this.instrumentDryGainers) {
			this.instrumentDryGainers[inst].disconnect();
		}
		this.instrumentDryGainers = {};

		for (let inst in this.instrumentWetGainers) {
			this.instrumentWetGainers[inst].disconnect();
		}
		this.instrumentWetGainers = {};

		this.instruments = {};
	}

	// call as a sort of ctor
	Init(audioCtx) {
		console.assert(!this.audioCtx); // don't init more than once

		this.sampleLibrarian = new SampleCache(audioCtx);

		this.audioCtx = audioCtx;
		if (!this.audioCtx.createReverbFromUrl) {
			reverbjs.extend(this.audioCtx);
		}

		initSynthTools(this.audioCtx);

		//                                                                                                                ->[analysis]
		// (instruments) --> (instrumentDryGainers) --------------------------> [preMasterGain] --------------> [masterGainNode] -->  (destination)
		//               --> (instrumentWetGainers) ----> [masterReverb] ----->
		//
		this.preMasterGain = this.audioCtx.createGain("master");
		this.preMasterGain.gain.value = gGainBoost;

		this.masterGainNode = this.audioCtx.createGain("master");
		this.preMasterGain.connect(this.masterGainNode);

		// this.analysisNode = this.audioCtx.createAnalyser();
		// this.masterGainNode.connect(this.analysisNode);

		this.masterGainNode.connect(this.audioCtx.destination);

		// see other possible impulses: https://github.com/burnson/Reverb.js
		this.masterReverb = this.audioCtx.createReverbFromUrl("./reaper_stems_MidiverbMark2Preset29.m4a", () => { ////./MidiverbMark2Preset29.m4a", () => { // ./LadyChapelStAlbansCathedral.m4a

			for (let inst in this.instrumentWetGainers) {
				this.instrumentWetGainers[inst].connect(this.masterReverb);
			}

			// create wet signal path
			this.masterReverb.connect(this.preMasterGain);

		});
	};
};


