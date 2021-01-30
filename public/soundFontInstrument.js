'use strict';




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

		this.sfOutput = this.audioCtx.createGain();
		this.sfOutput.gain.value = 1.0;

		// masterDryGain
		this.masterDryGain = this.audioCtx.createGain();
		// masterWetGain
		this.masterWetGain = this.audioCtx.createGain();
		let gainLevels = this.getGainLevels();
		this.masterDryGain.gain.value = gainLevels[0];
		this.masterWetGain.gain.value = gainLevels[1];

		Soundfont.instrument(audioCtx, instrumentSpec.sfinstrumentName, { destination: this.sfOutput })
			.then(function (inst) {
				this.sfinstrument = inst;
			}.bind(this));

		this.sfOutput.connect(this.masterDryGain);
		this.sfOutput.connect(this.masterWetGain);

		this.masterDryGain.connect(dryDestination);
		this.masterWetGain.connect(wetDestination);

	};

	connect() {
		// nothing to do here; disconnect doesn't really disconnect anything
	}

	// returns [drygain, wetgain]
	getGainLevels() {
		let ms = this.instrumentSpec.GetParamByID("masterGain").currentValue;
		let vg = this.instrumentSpec.GetParamByID("verbMix").currentValue;
		// when verb mix is 0, drygain is the real master gain.
		// when verb mix is 1, drygain is 0 and verbmix is mastergain
		return [(1.0 - vg) * ms, vg * ms * 1.0];
	}

	disconnect() {
		if (!this.sfinstrument) return;
		this.AllNotesOff();
		this.sfinstrument.stop();
	}

	NoteOn(midiNote, velocity) {
		if (!this.sfinstrument) return;
		this.voices[midiNote] = this.sfinstrument.play(midiNote, null, { gain: velocity / 128 }); // https://www.npmjs.com/package/soundfont-player
		if (this.voices[midiNote]) {
			// i don't know why but very rarely .play() returns null. NBD we drop a note.
			this.voices[midiNote].DFHolding = true;
		}
		//log(`note on ${midiNote} holding=${this.voices[midiNote].DFHolding}`);
	};

	NoteOff(midiNote) {
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

	SetParamValues(patchObj) {
		Object.keys(patchObj).forEach(paramID => {
			switch (paramID) {
				case "masterGain":
				case "verbMix":
					let levels = this.getGainLevels();
					this.masterDryGain.gain.linearRampToValueAtTime(levels[0], ClientSettings.InstrumentParamIntervalMS / 1000);
					this.masterWetGain.gain.linearRampToValueAtTime(levels[1], ClientSettings.InstrumentParamIntervalMS / 1000);
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



