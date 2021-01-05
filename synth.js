
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function DigifuSynthVoice() {
	this.UserID = null;
	this.InstrumentType = null; // sampler drum kit, 
}

DigifuSynthVoice.prototype.NoteOn = function(instrumentSpec, note, velocity) {
	// if instrument type has changed, then reset and set up new instrument.
};

DigifuSynthVoice.prototype.NoteOff = function() {
	// if instrument type has changed, then reset and set up new instrument.
};

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function DigifuSynthInstrument() {
	// voice allocator stuff.
	this.Voices = []; // DigifuSynthVoice
};

DigifuSynthInstrument.prototype.NoteOn = function (instrumentSpec, note, velocity) {
	// delegate to instrument
};

DigifuSynthInstrument.prototype.NoteOff = function (instrumentSpec, note) {
	//
};


//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function DigifuSynth() {
	// voice allocator stuff.
	this.Instruments = []; // DigifuSynthInstrument
};

DigifuSynth.prototype.NoteOn = function (instrumentSpec, note, velocity) {
	// delegate to instrument
};

DigifuSynth.prototype.NoteOff = function (instrumentSpec, note) {
	//
};

DigifuSynth.prototype.InitInstruments = function (instrumentSpecs) {
	// reset, then set all instruments
};

DigifuSynth.prototype.Init = function () {
	// create voices and init them
};


// // https://webaudioapi.com/samples/rhythm/

