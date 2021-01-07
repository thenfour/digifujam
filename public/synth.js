'use strict';




//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class SoundfontInstrument {
	constructor(audioCtx, destination, instrumentSpec) {
		this.audioCtx = audioCtx;
		Soundfont.instrument(audioCtx, instrumentSpec.name, {destination})
			.then(function (inst) {
				this.sfinstrument = inst;
			}.bind(this));

		this.sfinstrument = null;
		this.instrumentSpec = instrumentSpec;
		this.sustainMode = false; // true = pedal down
		this.voices = new Array(128); // map midi note number to a voice
	};

	NoteOn(midiNote, velocity) {
		if (!this.sfinstrument) return;
		this.voices[midiNote] = this.sfinstrument.play(midiNote, null, {gain:velocity/128}); // https://www.npmjs.com/package/soundfont-player
		this.voices[midiNote].DFHolding = true;
		//log(`note on ${midiNote} holding=${this.voices[midiNote].DFHolding}`);
	};

	NoteOff(midiNote) {
		if (!this.sfinstrument) return;
		//log(`note off ${midiNote}`);
		// we have to respect if a note off happens without corresponding note on.
		//console.assert(this.voices[midiNote]);
		if (!this.voices[midiNote]) return;
		this.voices[midiNote].DFHolding = false;
		if (!this.sustainMode) {
			this.voices[midiNote].stop();
			this.voices[midiNote] = null;
		}
	};

	PedalDown() {
		if (!this.sfinstrument) return;
		this.sustainMode = true;
	};

	PedalUp() {
		if (!this.sfinstrument) return;
		this.sustainMode = false;
		// release notes which are playing but not physically pressed.
		for (let v of this.voices) {
			if (v) {
				if (!v.DFHolding) {
					v.stop();
				}
			}
		}
	};

	AllNotesOff() {
		if (!this.sfinstrument) return;
		this.voices = new Array(128); // reset all voices.
		this.sustainMode = false;
		this.sfinstrument.stop();
	};
};




//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function DigifuSynth() {
	this.audioCtx = null;
	this.instruments = {};
};

DigifuSynth.prototype.NoteOn = function (instrumentSpec, note, velocity) {
	this.instruments[instrumentSpec.instrumentID].NoteOn(note, velocity);
};

DigifuSynth.prototype.NoteOff = function (instrumentSpec, note) {
	this.instruments[instrumentSpec.instrumentID].NoteOff(note);
};

DigifuSynth.prototype.AllNotesOff = function (instrumentSpec) {
	this.instruments[instrumentSpec.instrumentID].AllNotesOff();
};

DigifuSynth.prototype.PedalUp = function (instrumentSpec) {
	this.instruments[instrumentSpec.instrumentID].PedalUp();
};

DigifuSynth.prototype.PedalDown = function (instrumentSpec) {
	this.instruments[instrumentSpec.instrumentID].PedalDown();
};

DigifuSynth.prototype.PitchBend = function (instrumentSpec, val) {
	this.instruments[instrumentSpec.instrumentID].PitchBend(val);
};

// call when you have a list of instruments
DigifuSynth.prototype.InitInstruments = function (instrumentSpecs) {
	this.instruments = {};
	log(`InitInstruments count=${instrumentSpecs.length}`);
	instrumentSpecs.forEach(s => {
		switch (s.engine) {
			case "synth":
				this.instruments[s.instrumentID] = new PolySynth(this.audioCtx, this.masterEffectsInputNode, s);
				break;
			case "soundfont":
				//let oldDest = this.audioCtx.destination;
				//this.audioCtx.destination = this.masterEffectsInputNode;
				this.instruments[s.instrumentID] = new SoundfontInstrument(this.audioCtx, this.masterEffectsInputNode, s);
				//this.audioCtx.destination  = oldDest;
				break;
		}
		//this.instruments[s.instrumentID] = new DigifuSynthInstrument(this.audioCtx, s);
		//log(`InitInstrument id=${s.instrumentID}, name=${s.name}`);
	});
};

// call as a sort of ctor
DigifuSynth.prototype.Init = function (audioCtx) {
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
