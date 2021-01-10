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

	AllNotesOff() {
		if (!this.sfinstrument) return;
		this.voices = new Array(128); // reset all voices.
		this.sustainMode = false;
		this.sfinstrument.stop();
	};
};




//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class DigifuSynth {
	constructor() {
		this.audioCtx = null;
		this.instruments = {};
		this.instrumentGainers = {}; // key = instrumentID

		this.masterEffectsInputNode = null;
		this.masterReverbGain = null;
	}

	//this.masterGain = 1.0;// 0 = mute, 1.0 = unity, >1=amplify
	set masterGain(val) {
		if (!this.masterEffectsInputNode) return;
		this.masterEffectsInputNode.gain.value = val;
	}

	get masterGain() {
		if (!this.masterEffectsInputNode) return 1.0;
		return this.masterEffectsInputNode.gain.value;
	}

	set reverbGain(val) {
		if (!this.masterReverbGain) return;
		this.masterReverbGain.gain.value = val;

		if (val > 0.0001) {
			this.masterReverbGain.connect(this.audioCtx.destination);
		} else {
			this.masterReverbGain.disconnect();
		}
	}

	NoteOn(instrumentSpec, note, velocity) {
		this.instruments[instrumentSpec.instrumentID].NoteOn(note, velocity);
	};

	NoteOff(instrumentSpec, note) {
		this.instruments[instrumentSpec.instrumentID].NoteOff(note);
	};

	AllNotesOff(instrumentSpec) {
		this.instruments[instrumentSpec.instrumentID].AllNotesOff();
	};

	PedalUp(instrumentSpec) {
		this.instruments[instrumentSpec.instrumentID].PedalUp();
	};

	PedalDown(instrumentSpec) {
		this.instruments[instrumentSpec.instrumentID].PedalDown();
	};

	PitchBend(instrumentSpec, val) {
		this.instruments[instrumentSpec.instrumentID].PitchBend(val);
	};

	// call when you have a list of instruments
	InitInstruments(instrumentSpecs, internalMasterGain) {
		this.instruments = {};
		instrumentSpecs.forEach(s => {
			let gainer = this.audioCtx.createGain();
			gainer.gain.value = 1;
			if (s.gain) {
				gainer.gain.value = s.gain;
			}
			gainer.gain.value *= internalMasterGain; // internal fader just for keeping things not too quiet. basically a complement to individual instrument gains.
			gainer.connect(this.masterEffectsInputNode);
			this.instrumentGainers[s.instrumentID] = gainer;
			switch (s.engine) {
				case "synth":
					this.instruments[s.instrumentID] = new PolySynth(this.audioCtx, gainer, s);
					break;
				case "soundfont":
					this.instruments[s.instrumentID] = new SoundfontInstrument(this.audioCtx, gainer, s);
					break;
			}
		});
	};

	// call as a sort of ctor
	Init(audioCtx) {
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
};


