'use strict';

class DigifuMetronome {
		constructor() {
				this.audioCtx = null; //audio context
				this._bpm = 90; //beats per minute
				this._syncWithRoom = false; //synchronize with room BPM  

				this.metronomeTimer = setTimeout(() => { this.tick(); }, 60000/this._bpm); //local metronome timer

				this.sampleBuffer = null;
				this._isMuted = true; 
		}
		
		get bpm(){
			return this._bpm;
		}

		set bpm(val){
			if(val > 0 && val < 1000)
				this._bpm = val;
		}

		get isMuted() {
			return this._isMuted;
		} 

		set isMuted(val) {
			this._isMuted = val;
		}
		
		get syncWithRoom() {
			return this._syncWithRoom;
		}

		set syncWithRoom(val) {
			this._syncWithRoom = val;

			if(this._syncWithRoom) {
				clearTimeout(this.metronomeTimer); //if syncWithRoom was switched on, stop the local metronome timer 
				this.metronomeTimer = null;
			}
		}
		
		play() {
			if(!this._isMuted && this.sampleBuffer != null) {
				const source = this.audioCtx.createBufferSource();
				source.buffer = this.sampleBuffer;
				source.connect(this.audioCtx.destination);
				source.start();
			}
		}

		tick() {
			if(typeof(this.play) != 'undefined')
				this.play();
			//console.log("tick");
			this.metronomeTimer = setTimeout(() => { this.tick(); }, 60000 / this._bpm);
		}

		Init(audioCtx) {
			console.assert(!this.audioCtx); // don't init more than once

			var request = new XMLHttpRequest();

			request.open("GET", "Metronome.mp3", true);
			request.responseType = "arraybuffer";
			
			request.onload = () => {
					audioCtx.decodeAudioData(request.response, (data) => {
						this.sampleBuffer = data;
					}, function (e) { console.log("Error while decoding metronome audio: " + e); });
			};

			request.send();

			this.audioCtx = audioCtx;
		}

		OnRoomBeat(bpm){
			if(this._syncWithRoom){
				//console.log("sync tick");
				this._bpm = bpm;
				this.play();
			}else if(this.metronomeTimer == null){
				this.tick(); //start the local metronome  
			}
		}

};



module.exports = {
	DigifuMetronome,
};

