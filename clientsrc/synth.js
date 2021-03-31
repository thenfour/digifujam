'use strict';

const DF = require("./DFCommon");
const soundFontInstrument = require("./soundFontInstrument.js")
const DFDrumkit = require("./DrumkitEngine");
const DFSynthTools = require("./synthTools");
const FMPolySynth = require("./fm4instrument");
const FMVoice = require("./fm4voice");
const MixingDeskInstrument = require("./MixingDeskInstrument");
const sfzInstrument = require('./sfzInstrument')

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

	get metronomeGain() {
		if (!this.metronomeGainNode) return 1.0;
		return this.metronomeGainNode.gain.value;
	}

	set metronomeGain(val) {
		if (!this.metronomeGainNode) return;
		this.metronomeGainNode.gain.value = val;
	}

	get isMuted() {
		return this._isMuted; // unfortunately no "is connected" api exists so we must keep state.
	}

	//                                                                        [metronomeGainNode] -->
	// (instruments) --> (instrumentDryGainers) ---------------------> [preMasterGain] -------------> [masterGainNode] -->  (destination)
	//               --> (instrumentWetGainers) --> [masterReverb] -->                             -> [analysis]
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
		if (this._isMuted || instrumentSpec.isMuted) return;
		this.instruments[instrumentSpec.instrumentID].NoteOn(note, velocity);
	};

	NoteOff(instrumentSpec, note) {
		if (this._isMuted || instrumentSpec.isMuted) return;
		this.instruments[instrumentSpec.instrumentID].NoteOff(note);
	};

	AllNotesOff(instrumentSpec) {
		if (this._isMuted) return;
		if (!instrumentSpec) {
			// do for all instruments.
			Object.values(this.instruments).forEach(i => {
				if (i.isMuted) return;
				i.AllNotesOff();
			});
			return;
		}
		if (instrumentSpec.isMuted) return;
		this.instruments[instrumentSpec.instrumentID].AllNotesOff();
	};

	PedalUp(instrumentSpec) {
		if (this._isMuted || instrumentSpec.isMuted) return;
		this.instruments[instrumentSpec.instrumentID].PedalUp();
	};

	PedalDown(instrumentSpec) {
		if (this._isMuted || instrumentSpec.isMuted) return;
		this.instruments[instrumentSpec.instrumentID].PedalDown();
	};

	createParamMapping(inst, param, srcVal) {
		inst.ensureParamMappingParams(param, srcVal);
	}

	removeParamMapping(inst, param) {
		let patchObj = inst.removeParamMapping(param);
		this.SetInstrumentParams(inst, patchObj, false);
	}

	// returns true if the param changes incurred mapping propagation to other params
	SetInstrumentParams(instrumentSpec, patchObj /* RAW values, not calculated */, isWholePatch) {
		const x = this.roomStateGetter().integrateRawParamChanges(instrumentSpec, patchObj, isWholePatch);
		if (!this._isMuted || instrumentSpec.isMuted) {
			this.instruments[instrumentSpec.instrumentID].SetParamValues(x.calculatedPatchObj);
		} else if ('SetParamValuesMuted' in this.instruments[instrumentSpec.instrumentID]) {
			// here we want to send params sometimes even if the instrument is muted.
			this.instruments[instrumentSpec.instrumentID].SetParamValuesMuted(x.calculatedPatchObj);
		}
		// handle downstream linked params.
		var ret = x.incurredMappings;
		Object.keys(x.downstreamInstruments).forEach(instrumentID => {
			this.SetInstrumentParams(this.instrumentSpecs.find(i => i.instrumentID == instrumentID), x.downstreamInstruments[instrumentID].calculatedPatchObj, false);
			ret = true;
		});
		return ret;
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

			spec.loadProgress = 0;

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
					this.instruments[spec.instrumentID] = new FMPolySynth.FMPolySynth(this.audioCtx, dryGainer, wetGainer, spec, (c, s) => new FMVoice.MiniFMSynthVoice(c, s));
					break;
				case "soundfont":
					this.instruments[spec.instrumentID] = new soundFontInstrument.SoundfontInstrument(this.audioCtx, dryGainer, wetGainer, spec);
					break;
				case "sfz":
					this.instruments[spec.instrumentID] = new sfzInstrument.sfzInstrument(this.audioCtx, dryGainer, wetGainer, spec, this.sampleLibrarian, prog => this.onInstrumentLoadProgress(spec, prog));
					break;
				case "drumkit":
					this.instruments[spec.instrumentID] = new DFDrumkit.OneShotInstrument(this.audioCtx, this.sampleLibrarian, dryGainer, wetGainer, spec, (s, l) => new DFDrumkit.DrumKitVoice(s, l));
					break;
				case "mixingdesk":
					this.instruments[spec.instrumentID] = new MixingDeskInstrument();
					break;
				default:
					alert(`Unknown synth engine '${spec.engine}'`);
					break;
			}
		});
	};

	cacheSFZInstruments(progressCallback) {
		sfzInstrument.SFZAssetLoader.CacheAllSFZAssets(
			this.sampleLibrarian,
			this.instrumentSpecs.filter(i => i.engine === "sfz"),
			progressCallback);
	}

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
	Init(audioCtx, roomStateGetter, onInstrumentLoadProgress) {
		console.assert(!this.audioCtx); // don't init more than once

		this.onInstrumentLoadProgress = onInstrumentLoadProgress;
		this.roomStateGetter = roomStateGetter;
		this.sampleLibrarian = new DFSynthTools.SampleCache(audioCtx);

		this.audioCtx = audioCtx;
		if (!this.audioCtx.createReverbFromUrl) {
			reverbjs.extend(this.audioCtx);
		}

		DFSynthTools.initSynthTools(this.audioCtx);

		//                                                                             [metronomeGainNode] --->
		// (instruments) --> (instrumentDryGainers) --------------------------> [preMasterGain] --------------> [masterGainNode] -->  (destination)
		//               --> (instrumentWetGainers) ----> [masterReverb] ----->                              -> [analysis]
		//
		//this.compressor = this.audioCtx.createDynamicsCompressor("masterCompressor");

		this.preMasterGain = this.audioCtx.createGain("master");
		this.preMasterGain.gain.value = gGainBoost;

		this.masterGainNode = this.audioCtx.createGain("master");
		this.preMasterGain.connect(this.masterGainNode);

		this.metronomeGainNode = this.audioCtx.createGain("metronomeGainNode");
		this.metronomeGainNode.connect(this.masterGainNode);

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


module.exports = {
	DigifuSynth
};

