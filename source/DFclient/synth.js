const DFSynthTools = require("./synthTools");
const FMPolySynth = require("./fm4instrument");
const FMVoice = require("./fm4voice");
const MixingDeskInstrument = require("./MixingDeskInstrument");
const sfzInstrument = require('./sfzInstrument');
const EventEmitter = require('events');

// how many milliseconds must elapse before a note is accepted?
const gDupeNoteMarginMS = 20;

// when you mute the synth engine, note ons and offs don't flow through synths to drive the keyboard view.
// so when muted, we use this to drive keyboard view.

// TODO: deal with sustain pedal
class FallbackNoteOnTracker {
	constructor(noteOnHandler, noteOffHandler) {
		this.noteOnHandler = noteOnHandler;
		this.noteOffHandler = noteOffHandler;
	}

	AllNotesOff() {
	}

	NoteOn(user, instrumentSpec, note, isFromSequencer) {
		this.noteOnHandler(user, instrumentSpec, note, isFromSequencer);
	}

	NoteOff(user, instrumentSpec, note, isFromSequencer) {
		this.noteOffHandler(user, instrumentSpec, note, isFromSequencer);
	}

	PedalUp(user, instrumentSpec) {
	}

	PedalDown(user, instrumentSpec) {
	}
};

// https://github.com/thenfour/digifujam/issues/241
// network hiccups can cause a huge burst of notes. especially in sequencers that can result in
// playing the same note duplicated many times. this keeps track of last time a note was played
// so we can swallow them if needed.
class DupeNoteSwallower {
	constructor() {
		this.instruments = new Map(); // map instrumentID => map of notes => date last played
	}

	// return true if the note should be swallowed.
	NoteOnShouldBeSwallowed(user, instrumentSpec, note, velocity, isFromSequencer) {
		const now = Date.now();
		if (!this.instruments.has(instrumentSpec.instrumentID)) {
			this.instruments.set(instrumentSpec.instrumentID, new Map());
		}
		const instMap = this.instruments.get(instrumentSpec.instrumentID);
		if (!instMap.has(note)) {
			instMap.set(note, now); // first time this note has been played on this instrument.
			return false;
		}
		const prevTime = instMap.get(note);
		if ((now - prevTime) < gDupeNoteMarginMS) {
			//console.log(`note ${note} swallowed! within ${now - prevTime} ms`);
			return true; // swallow, and don't register this note. allow time to elapse.
		}

		// don't swallow. register this note on.
		instMap.set(note, now);
		return false;
	}

}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class DigifuSynth {
	constructor() {
		this.audioCtx = null;
		this.instruments = {};

		this.instrumentSpecs = null;

		this.dupeNoteSwallower = new DupeNoteSwallower();

		this._isMuted = false;
		this.sampleLibrarian = null;

		this.events = new EventEmitter();
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

	NoteOn(user, instrumentSpec, note, velocity, isFromSequencer) {
		if (this.dupeNoteSwallower.NoteOnShouldBeSwallowed(user, instrumentSpec, note, velocity, isFromSequencer))
			return;

		this.events.emit("noteOn", {user, instrumentSpec, note, velocity, isFromSequencer});

		instrumentSpec.RegisterPlayingActivity();

		if (this._isMuted || instrumentSpec.isMuted) {
			this.fallbackNoteOnTracker.NoteOn(user, instrumentSpec, note, isFromSequencer);
			return;
		}
		this.instruments[instrumentSpec.instrumentID].NoteOn(user, note, velocity, isFromSequencer);
	};

	NoteOff(user, instrumentSpec, note, isFromSequencer) {
		if (this._isMuted || instrumentSpec.isMuted) {
			this.fallbackNoteOnTracker.NoteOff(user, instrumentSpec, note, isFromSequencer);
		}
		this.instruments[instrumentSpec.instrumentID].NoteOff(user, note, isFromSequencer);
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
	Init(audioCtx, roomStateGetter, onInstrumentLoadProgress, noteOnHandler, noteOffHandler) {
		console.assert(!this.audioCtx); // don't init more than once

		this.fallbackNoteOnTracker = new FallbackNoteOnTracker(noteOnHandler, noteOffHandler);

		this.onInstrumentLoadProgress = onInstrumentLoadProgress;
		this.roomStateGetter = roomStateGetter;
		this.sampleLibrarian = new DFSynthTools.SampleCache(audioCtx);

		// these get called when note ons / note offs are invoked from synths
		this.noteOnHandler = noteOnHandler;
		this.noteOffHandler = noteOffHandler;

		this.audioCtx = audioCtx;

		DFSynthTools.initSynthTools(this.audioCtx);

		/*
																				                                                     [soundEffectGainNode] --->
																				[metronomeGainNode] --->
			(instruments) -----------------------------------------------------------------------------> [masterGainNode] -->  (destination)
						--------------------------------------------> [masterReverb] ---------------->
																	.>
																	/
												.>[delayVerbGain]--'
											|
						---> [masterDelay] -`---[delayDryGain]--------------------------------------->
		*/
		this.masterReverb = this.audioCtx.createConvolver("masterVerb");

		this.masterGainNode = this.audioCtx.createGain("master");

		this.metronomeGainNode = this.audioCtx.createGain("metronomeGainNode");
		this.metronomeGainNode.connect(this.masterGainNode);

		this.soundEffectGainNode = this.audioCtx.createGain("soundEffectGainNode");
		this.soundEffectGainNode.connect(this.audioCtx.destination);

		this.masterGainNode.connect(this.audioCtx.destination);

		this.delayVerbGain = this.audioCtx.createGain("masterDelay");
		this.delayDryGain = this.audioCtx.createGain("masterDelay");

		this.masterDelay = this.audioCtx.createDFDelayNode("masterDelay", [this.delayVerbGain, this.delayDryGain]);

		this.delayVerbGain.connect(this.masterReverb);
		this.delayDryGain.connect(this.masterGainNode);
		this.masterReverb.connect(this.masterGainNode);

		DFSynthTools.gLoadSample(this.audioCtx, StaticURL("uisfx/reaper_stems_MidiverbMark2Preset29.m4a"),
			(buffer) => {
				this.masterReverb.buffer = buffer;
			},
			(e) => {
				console.log(`Error loading reverb impulse`);
				console.log(e);
			}
		);
	};
};


module.exports = {
	DigifuSynth
};

