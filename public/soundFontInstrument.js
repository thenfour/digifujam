'use strict';




//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class SoundfontInstrument {
	constructor(audioCtx, destination, instrumentSpec) {
		this.audioCtx = audioCtx;
		Soundfont.instrument(audioCtx, instrumentSpec.sfinstrumentName, { destination })
			.then(function (inst) {
				this.sfinstrument = inst;
			}.bind(this));

		this.sfinstrument = null;
		this.instrumentSpec = instrumentSpec;
		this.sustainMode = false; // true = pedal down
		this.voices = new Array(128); // map midi note number to a voice
	};
    
    connect() {
        // nothing to do here; disconnect doesn't really disconnect anything
    }

	disconnect() {
		if (!this.sfinstrument) return;
		this.AllNotesOff();
		this.sfinstrument.stop();
	}

	NoteOn(midiNote, velocity) {
		if (!this.sfinstrument) return;
		this.voices[midiNote] = this.sfinstrument.play(midiNote, null, { gain: velocity / 128 }); // https://www.npmjs.com/package/soundfont-player
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

	SetParamValue(param, newVal) {
		// nothing supported.
		return;
	}

	PitchBend(val) {
		// not supported.
	}

	setPitchBendRange(val) {} // not supported

	AllNotesOff() {
		if (!this.sfinstrument) return;
		this.voices = new Array(128); // reset all voices.
		this.sustainMode = false;
		this.sfinstrument.stop();
    };
};



