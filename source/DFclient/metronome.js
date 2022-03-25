// the client-side metronome instrument. does not perform timing stuff.

const DFQ = require('../DFcommon/quantizer');

class DigifuMetronome {
	constructor() {
		this.audioCtx = null; //audio context
		this.sampleBuffer = null;
		this._isMuted = true;
	}

	get isMuted() {
		return this._isMuted;
	}

	set isMuted(val) {
		this._isMuted = val;
	}

	play(ignoreMutedState) {
		let isReallyMuted = this._isMuted;
		if (!!ignoreMutedState) isReallyMuted = false;
		if (!isReallyMuted && this.sampleBuffer != null) {
			const source = this.audioCtx.createBufferSource();
			source.buffer = this.sampleBuffer;
			source.connect(this.dest);
			source.start();
		}
	}

	Init(audioCtx, dest) {
		console.assert(!this.audioCtx); // don't init more than once

		var request = new XMLHttpRequest();

		request.open("GET", StaticURL("uisfx/Metronome.mp3"), true);
		request.responseType = "arraybuffer";

		request.onload = () => {
			audioCtx.decodeAudioData(request.response, (data) => {
				this.sampleBuffer = data;
				this.audioCtx = audioCtx;
				this.dest = dest;
			}, function (e) { console.log("Error while decoding metronome audio: " + e); });
		};

		request.send();
	}

	// from server
	OnRoomBeat() {
		this.play();
	}

};

module.exports = {
	DigifuMetronome,
};

