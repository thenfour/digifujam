const DF = require('./dfutil');

// per ROOM
// keep BPM and beat info for the room on the server.
class ServerRoomMetronome {
  constructor() {
      // advertised beats is time_to_beats(now - roottime) + beatOffset.
      this.beatOffset = 0; // # of beats added, just for output
      this.rootTime = Date.now(); // time from when beats are being counted.
      this.BPM = 95; // BPM is when denom = 4.
      this.beatRoutine = () => { };
      this.intervalCookie = null;
  }

  scheduleNextTick() {
      let currentBeat = this.getInternalAbsoluteBeat(); // like 123.34. so next beat will be 1.0-.34 beats from now.
      let nextRunBeat = currentBeat + 0.01; // if we're almost at the end of a beat, skip to the next. when making quick BPM adjustments it helps avoid very short glitchy beats.
      nextRunBeat = Math.ceil(nextRunBeat); // the beat to schedule
      let nextRunMS = DF.BeatsToMS(nextRunBeat, this.BPM);
      let absNextRunTime = this.rootTime + nextRunMS;
      let now = Date.now();
      let interval = absNextRunTime - now;
      //console.log(`scheduleNextTick interval = ${interval}. currentBeat=${currentBeat} nextRunBeat=${nextRunBeat} nextRunMS=${nextRunMS} rootTime=${this.rootTime} absNextRunTime=${absNextRunTime} now=${now}`);
      this.intervalCookie = setTimeout(this.timerProc, interval);
  }

  resetTimer() {
      if (this.intervalCookie) {
          clearTimeout(this.intervalCookie);
      }
      this.scheduleNextTick();
  }

  timerProc = () => {
      this.scheduleNextTick();
      this.beatRoutine();
  }

  setBeatRoutine(routine) {
      this.beatRoutine = routine;
      this.resetTimer();
  }

  OffsetBeats(relativeBeats) {
      //console.log(`offset beats ${relativeBeats}`);
      this.beatOffset += relativeBeats;
      //this.resetTimer();
  }

  getBPM() {
      return this.BPM;
  }

  setBPM(newBPM) {
      //console.log(`setBPM ${newBPM}`);
      // make it smoothly modulated; "now" should finish out the current beat.
      // so, make the new root time (now - current beat fraction * new bpm)
      // this is required in order to make BPM changes and not cause total chaos with regards to sequencer timing.
      let b = this.getInternalAbsoluteBeat();
      let ms = DF.BeatsToMS(b, newBPM);
      this.rootTime = Date.now() - ms;
      this.BPM = newBPM;
      this.resetTimer();
  }

  AdjustPhase(relativeMS) {
      //console.log(`AdjustPhase ${relativeMS}`);
      this.rootTime += relativeMS;
      this.resetTimer();
  }

  resetBeatPhase() {
      //console.log(`resetBeatPhase`);
      this.rootTime = Date.now();
      this.resetTimer();
  }

  getInternalAbsoluteBeat() {
      const absTimeMS = (Date.now() - this.rootTime);
      const absoluteBeat = DF.MSToBeats(absTimeMS, this.BPM);
      return absoluteBeat;
  }

  getAbsoluteBeat() {
      return this.getInternalAbsoluteBeat() + this.beatOffset;
  }
};


module.exports = {
  ServerRoomMetronome,
}