'use strict';

var Soundfont = require('soundfont-player')

class AudioGraphHelper {
	constructor() {
		this.nodes = {};
	}
	disconnect() {
		Object.keys(this.nodes).forEach(k => {
			let n = this.nodes[k];
			if (n.stop) n.stop();
			n.disconnect();
		});
		this.nodes = {};
	}
};




//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class SoundfontInstrument {
	constructor(audioCtx, dryDestination, wetDestination, instrumentSpec) {
		/*

		(soundfont) --> [sfOutput] --> [masterDryGain] --> dryDestination
									 > [masterWetGain] --> wetDestination

		*/
		this.audioCtx = audioCtx;
		this.instrumentSpec = instrumentSpec;
		this.voices = new Array(128); // map midi note number to a voice
		this.sfinstrument = null;
		this.sustainMode = false; // true = pedal down
		this.isConnected = false;

		this.dryDestination = dryDestination;
		this.wetDestination = wetDestination;

		this.graph = new AudioGraphHelper();
	};

	connect() {
		if (this.isConnected) return;

		this.audioCtx.beginScope(this.instrumentSpec.engine);

		this.graph.nodes.sfOutput = this.audioCtx.createGain("sfOutput");
		this.graph.nodes.sfOutput.gain.value = 1.0;

		// masterDryGain
		this.graph.nodes.masterDryGain = this.audioCtx.createGain("masterDryGain");
		// masterWetGain
		this.graph.nodes.masterWetGain = this.audioCtx.createGain("masterWetGain");
		let gainLevels = this.getGainLevels();
		this.graph.nodes.masterDryGain.gain.value = gainLevels[0];
		this.graph.nodes.masterWetGain.gain.value = gainLevels[1];

		Soundfont.instrument(this.audioCtx, this.instrumentSpec.sfinstrumentName, { destination: this.graph.nodes.sfOutput })
			.then(function (inst) {
				this.sfinstrument = inst;
			}.bind(this));

		this.graph.nodes.sfOutput.connect(this.graph.nodes.masterDryGain);
		this.graph.nodes.sfOutput.connect(this.graph.nodes.masterWetGain);

		this.graph.nodes.masterDryGain.connect(this.dryDestination);
		this.graph.nodes.masterWetGain.connect(this.wetDestination);

		this.audioCtx.endScope();

		this.isConnected = true;
	}

	disconnect() {
		if (!this.isConnected) return;
		if (this.sfinstrument) {
			this.AllNotesOff();
			this.sfinstrument.stop();
			this.sfinstrument = null;
		}
		this.graph.disconnect();

		this.isConnected = false;
	}

	// returns [drygain, wetgain]
	getGainLevels() {
		let ms = this.instrumentSpec.GetParamByID("masterGain").currentValue;
		let vg = this.instrumentSpec.GetParamByID("verbMix").currentValue;
		// when verb mix is 0, drygain is the real master gain.
		// when verb mix is 1, drygain is 0 and verbmix is mastergain
		return [(1.0 - vg) * ms, vg * ms * 1.0];
	}

	NoteOn(midiNote, velocity) {
        if (!this.isConnected) this.connect();
		if (!this.sfinstrument) return;
		this.voices[midiNote] = this.sfinstrument.play(midiNote, null, { gain: velocity / 128 }); // https://www.npmjs.com/package/soundfont-player
		if (this.voices[midiNote]) {
			// i don't know why but very rarely .play() returns null. NBD we drop a note.
			this.voices[midiNote].DFHolding = true;
		}
		//log(`note on ${midiNote} holding=${this.voices[midiNote].DFHolding}`);
	};

	NoteOff(midiNote) {
        if (!this.isConnected) this.connect();
		if (!this.sfinstrument) return;
		// we have to respect if a note off happens without corresponding note on.
		if (!this.voices[midiNote]) return;
		this.voices[midiNote].DFHolding = false;
		if (!this.sustainMode) {
			this.voices[midiNote].stop();
			this.voices[midiNote] = null;
		}
	};

	PedalDown() {
        if (!this.isConnected) this.connect();
		if (!this.sfinstrument) return;
		this.sustainMode = true;
	};

	PedalUp() {
        if (!this.isConnected) this.connect();
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

	SetParamValues(patchObj) {
		Object.keys(patchObj).forEach(paramID => {
			switch (paramID) {
				case "masterGain":
				case "verbMix":
					let levels = this.getGainLevels();
					this.graph.nodes.masterDryGain.gain.value = levels[0];
					this.graph.nodes.masterWetGain.gain.value = levels[1];
					break;
			}
		});
	}

	AllNotesOff() {
		if (!this.sfinstrument) return;
		this.voices = new Array(128); // reset all voices.
		this.sustainMode = false;
		this.sfinstrument.stop();
	};
};


module.exports = {
	SoundfontInstrument,
	AudioGraphHelper
};

