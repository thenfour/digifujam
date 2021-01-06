'use strict';

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function DigifuSynthInstrument(audioCtx, instrumentSpec) {
	this.audioCtx = audioCtx;
	Soundfont.instrument(audioCtx, instrumentSpec.name)
		.then(function(inst) {
			this.sfinstrument = inst;
		}.bind(this));

	this.sfinstrument = null;
	this.instrumentSpec = instrumentSpec;
	this.voices = new Array(256); // map midi note number to a voice
};

DigifuSynthInstrument.prototype.NoteOn = function (midiNote, velocity) {
	if (!this.sfinstrument) return;
	//log(`on: ${midiNote}`);
	this.voices[midiNote] = this.sfinstrument.play(midiNote);
};

DigifuSynthInstrument.prototype.NoteOff = function (midiNote) {
	if (!this.sfinstrument) return;
	console.assert(this.voices[midiNote]);
	//log(`off: ${midiNote}`);
	this.voices[midiNote].stop();
};

DigifuSynthInstrument.prototype.AllNotesOff = function () {
	if (!this.sfinstrument) return;
	//log(`all notes off`);
	this.voices = new Array(256); // reset all voices.
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
	//log(`AllNotesOff instrumentSpec=${JSON.stringify(instrumentSpec)}`);
	//log(`AllNotesOff instrumentSpec.instrumentID=${instrumentSpec.instrumentID}, obj=${this.instruments[instrumentSpec.instrumentID]}`);
	this.instruments[instrumentSpec.instrumentID].AllNotesOff();
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
