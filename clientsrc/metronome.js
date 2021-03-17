'use strict';

const DFQ = require('./quantizer');

class DigifuMetronome {
	constructor() {
		this.audioCtx = null; //audio context
		//this._syncWithRoom = true; //synchronize with room BPM  

		// this._timer = new DFQ.ServerRoomMetronome();
		// this._timer.setBPM(99);
		// this._timer.setBeatRoutine(() => {
		// 	if (this._syncWithRoom) return; // server-based timer doesn't play on local timer.
		// 	this.play();
		// });

		this.sampleBuffer = null;
		this._isMuted = true;
	}

	// get bpm() {
	// 	return this._timer.getBPM();
	// }

	// set bpm(val) {
	// 	this._timer.setBPM(val);
	// }

	get isMuted() {
		return this._isMuted;
	}

	set isMuted(val) {
		this._isMuted = val;
	}

	// get syncWithRoom() {
	// 	return this._syncWithRoom;
	// }

	// set syncWithRoom(val) {
	// 	this._syncWithRoom = val;

	// 	if (this._syncWithRoom) {
	// 		clearTimeout(this.metronomeTimeout); //if syncWithRoom was switched on, stop the local metronome timeout 
	// 		this.metronomeTimeout = null;
	// 	}
	// }

	play() {
		if (!this._isMuted && this.sampleBuffer != null) {
			const source = this.audioCtx.createBufferSource();
			source.buffer = this.sampleBuffer;
			source.connect(this.dest);
			source.start();
		}
	}

	Init(audioCtx, dest) {
		console.assert(!this.audioCtx); // don't init more than once

		var request = new XMLHttpRequest();

		request.open("GET", "Metronome.mp3", true);
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
		//if (this._syncWithRoom) {
			//console.log("sync tick");
			//this._bpm = bpm;
			this.play();
		// } else if (this.metronomeTimeout == null) {
		// 	this.tick(); //start the local metronome  
		// }
	}

};

module.exports = {
	DigifuMetronome,
};

