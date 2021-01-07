'use strict';

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function DigifuSynthInstrument(audioCtx, instrumentSpec) {
	this.audioCtx = audioCtx;
	Soundfont.instrument(audioCtx, instrumentSpec.name)
		.then(function (inst) {
			this.sfinstrument = inst;
		}.bind(this));

	this.sfinstrument = null;
	this.instrumentSpec = instrumentSpec;
	this.sustainMode = false; // true = pedal down
	this.voices = new Array(128); // map midi note number to a voice
};

DigifuSynthInstrument.prototype.NoteOn = function (midiNote, velocity) {
	if (!this.sfinstrument) return;
	this.voices[midiNote] = this.sfinstrument.play(midiNote);
	this.voices[midiNote].DFHolding = true;
	//log(`note on ${midiNote} holding=${this.voices[midiNote].DFHolding}`);
};

DigifuSynthInstrument.prototype.NoteOff = function (midiNote) {
	if (!this.sfinstrument) return;
	//log(`note off ${midiNote}`);
	console.assert(this.voices[midiNote]);
	this.voices[midiNote].DFHolding = false;
	if (!this.sustainMode) {
		this.voices[midiNote].stop();
		this.voices[midiNote] = null;
	}
};

DigifuSynthInstrument.prototype.PedalDown = function () {
	if (!this.sfinstrument) return;
	this.sustainMode = true;
};

DigifuSynthInstrument.prototype.PedalUp = function () {
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

DigifuSynthInstrument.prototype.AllNotesOff = function () {
	if (!this.sfinstrument) return;
	this.voices = new Array(128); // reset all voices.
	this.sustainMode = false;
	this.sfinstrument.stop();
};

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function DigifuSynth() {
	this.audioCtx = null;
	this.instruments = {};
};

DigifuSynth.prototype.NoteOn = function (instrumentSpec, note, velocity) {
	console.assert(this.audioCtx != null);
	this.instruments[instrumentSpec.instrumentID].NoteOn(note, velocity);
};

DigifuSynth.prototype.NoteOff = function (instrumentSpec, note) {
	console.assert(this.audioCtx != null);
	this.instruments[instrumentSpec.instrumentID].NoteOff(note);
};

DigifuSynth.prototype.AllNotesOff = function (instrumentSpec) {
	console.assert(this.audioCtx != null);
	this.instruments[instrumentSpec.instrumentID].AllNotesOff();
};

DigifuSynth.prototype.PedalUp = function (instrumentSpec) {
	console.assert(this.audioCtx != null);
	this.instruments[instrumentSpec.instrumentID].PedalUp();
};

DigifuSynth.prototype.PedalDown = function (instrumentSpec) {
	console.assert(this.audioCtx != null);
	this.instruments[instrumentSpec.instrumentID].PedalDown();
};

// call when you have a list of instruments
DigifuSynth.prototype.InitInstruments = function (instrumentSpecs) {
	this.instruments = {};
	log(`InitInstruments count=${instrumentSpecs.length}`);
	instrumentSpecs.forEach(s => {
		this.instruments[s.instrumentID] = new DigifuSynthInstrument(this.audioCtx, s);
		log(`InitInstrument id=${s.instrumentID}, name=${s.name}`);
	});
};

// call as a sort of ctor
DigifuSynth.prototype.Init = function () {
	this.audioCtx = new AudioContext();
};
