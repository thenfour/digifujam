'use strict';

const DFSynthTools = require("./synthTools");
const FMPolySynth = require("./fm4instrument");
const FMVoice = require("./fm4voice");
const MixingDeskInstrument = require("./MixingDeskInstrument");
const sfzInstrument = require('./sfzInstrument')


// when you mute the synth engine, note ons and offs don't flow through synths to drive the keyboard view.
// so when muted, we use this to drive keyboard view.

// TODO: deal with sustain pedal
class FallbackNoteOnTracker {
	constructor(noteOnHandler, noteOffHandler) {
		this.noteOnHandler = noteOnHandler;
		this.noteOffHandler = noteOffHandler;
	}

	AllNotesOff() {
		//
	}

	NoteOn(user, instrumentSpec, note) {
		this.noteOnHandler(user, instrumentSpec, note);
	}

	NoteOff(user, instrumentSpec, note) {
		this.noteOffHandler(user, instrumentSpec, note);
	}

	PedalUp(user, instrumentSpec) {

	}

	PedalDown(user, instrumentSpec) {

	}
};



//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class DigifuSynth {
	constructor() {
		this.audioCtx = null;
		this.instruments = {};

		this.instrumentSpecs = null;

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

	set isMuted(val) {
		if (val) {
			this.masterGainNode.disconnect();
			Object.keys(this.instruments).forEach(k => {
				this.instruments[k].disconnect();
			});
		} else {
			this.masterGainNode.connect(this.audioCtx.destination);
			// don't connect instruments because they're connect as needed.
		}
		this._isMuted = !!val;
	}

	NoteOn(user, instrumentSpec, note, velocity) {
		if (this._isMuted || instrumentSpec.isMuted) {
			this.fallbackNoteOnTracker.NoteOn(user, instrumentSpec, note);
			return;
		}
		this.instruments[instrumentSpec.instrumentID].NoteOn(user, note, velocity);
	};

	NoteOff(user, instrumentSpec, note) {
		if (this._isMuted || instrumentSpec.isMuted) {
			this.fallbackNoteOnTracker.NoteOff(user, instrumentSpec, note);
		}
		this.instruments[instrumentSpec.instrumentID].NoteOff(user, note);
	};

	AllNotesOff(instrumentSpec) {
		this.fallbackNoteOnTracker.AllNotesOff();
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

	PedalUp(user, instrumentSpec) {
		if (this._isMuted || instrumentSpec.isMuted) {
			this.fallbackNoteOnTracker.PedalUp(user, instrumentSpec);
			return;
		}
		this.instruments[instrumentSpec.instrumentID].PedalUp(user);
	};

	PedalDown(user, instrumentSpec) {
		if (this._isMuted || instrumentSpec.isMuted) {
			this.fallbackNoteOnTracker.PedalDown(user, instrumentSpec);
			return;
		}
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
	InitInstruments(instrumentSpecs) {
		this.instrumentSpecs = instrumentSpecs;
		//this.internalMasterGain = internalMasterGain;
		this.UninitInstruments();
		instrumentSpecs.forEach(spec => {
			switch (spec.engine) {
				case "minifm":
					this.instruments[spec.instrumentID] = new FMPolySynth.FMPolySynth(this.audioCtx, this.masterGainNode, this.masterReverb, this.masterDelay, spec, (c, s) => new FMVoice.MiniFMSynthVoice(c, s),
						this.noteOnHandler,
						this.noteOffHandler);
					break;
				case "sfz":
					this.instruments[spec.instrumentID] = new sfzInstrument.sfzInstrument(this.audioCtx, this.masterGainNode, this.masterReverb, this.masterDelay, spec, this.sampleLibrarian, prog => this.onInstrumentLoadProgress(spec, prog),
						this.noteOnHandler,
						this.noteOffHandler);
					break;
				case "mixingdesk":
					this.instruments[spec.instrumentID] = new MixingDeskInstrument(this.audioCtx, spec, this.masterDelay, this.delayDryGain, this.delayVerbGain);
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

		this.instruments = {};
	}

	// call as a sort of ctor
	Init(audioCtx, roomStateGetter, onInstrumentLoadProgress, onLoadComplete, noteOnHandler, noteOffHandler) {
		console.assert(!this.audioCtx); // don't init more than once

		this.fallbackNoteOnTracker = new FallbackNoteOnTracker(noteOnHandler, noteOffHandler);

		this.onInstrumentLoadProgress = onInstrumentLoadProgress;
		this.roomStateGetter = roomStateGetter;
		this.sampleLibrarian = new DFSynthTools.SampleCache(audioCtx);

		// these get called when note ons / note offs are invoked from synths
		this.noteOnHandler = noteOnHandler;
		this.noteOffHandler = noteOffHandler;

		this.audioCtx = audioCtx;
		if (!this.audioCtx.createReverbFromUrl) {
			reverbjs.extend(this.audioCtx);
		}

		DFSynthTools.initSynthTools(this.audioCtx);

		// see other possible impulses: https://github.com/burnson/Reverb.js
		this.masterReverb = this.audioCtx.createReverbFromUrl("./reaper_stems_MidiverbMark2Preset29.m4a", () => { ////./MidiverbMark2Preset29.m4a", () => { // ./LadyChapelStAlbansCathedral.m4a

			/*
																				 [metronomeGainNode] --->
																				 [soundEffectGainNode] --->
			 (instruments) -----------------------------------------------------------------------------> [masterGainNode] -->  (destination)
						   --------------------------------------------> [masterReverb] ---------------->                  -> [analysis]
																	  .>
																	 /
												 .>[delayVerbGain]--'
												|
						   ---> [masterDelay] -`---[delayDryGain]--------------------------------------->
			*/

			this.masterGainNode = this.audioCtx.createGain("master");

			this.metronomeGainNode = this.audioCtx.createGain("metronomeGainNode");
			this.metronomeGainNode.connect(this.masterGainNode);

			this.soundEffectGainNode = this.audioCtx.createGain("soundEffectGainNode");
			this.soundEffectGainNode.connect(this.masterGainNode);

			this.masterGainNode.connect(this.audioCtx.destination);

			this.delayVerbGain = this.audioCtx.createGain("masterDelay");
			this.delayDryGain = this.audioCtx.createGain("masterDelay");

			this.masterDelay = this.audioCtx.createDFDelayNode("masterDelay", [this.delayVerbGain, this.delayDryGain]);

			this.delayVerbGain.connect(this.masterReverb);
			this.delayDryGain.connect(this.masterGainNode);

			this.masterReverb.connect(this.masterGainNode);

			onLoadComplete();
		});
	};
};


module.exports = {
	DigifuSynth
};

