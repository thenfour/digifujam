const Seq = require('../clientsrc/SequencerCore');
const DFMusic = require('../clientsrc/DFMusic');
const DFU = require('../clientsrc/dfutil');
const DF = require('../clientsrc/DFCommon');

// timer interval duration should be balanced:
// * too long and it will incur too much processing (meaning noticeable periodic spikes in processing)
// * too short and system will be crowded with the overhead of this thing.
//
// at very least we can say the timer should be expected to DO actual work each iteration.
// and probably even dozens of events are more efficient than a nop interval.
// so that suggests it should be pretty long, like once per few seconds. maybe 1 measure of 4/4 @ 100bpm.
const gIntervalMS = 2500;

// each timer interval, a chunk of pattern data is scheduled.
// in theory it sholud just be over the next interval,
// but there should be some margin as well to account for jitter.
const gChunkSizeFactor = 1.15;

class RoomSequencerPlayer {
  constructor(roomState) {
    this.roomState = roomState;
    this.metronome = roomState.metronome;
    this.quantizer = roomState.quantizer;
    this.timer = null;
    this.instruments = this.roomState.instrumentCloset.filter(i => i.allowSequencer); // precalc a list of relevant instruments
    this.#invokeTimer();
  }

  // calls the time proc immediately and resets timer interval
  #invokeTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!this.instruments.length)
      return;
    this.timerProc();
  }

  // technically this can be all be optimized depending on the operation the user performed.
  // but this is all pretty fast so not worth it yet.
  onChanged_PlayStop(instrument, data) {
    //console.log(`onChanged_PlayStop(${JSON.stringify(data)})`);
    this.#invokeTimer();
   }
  onChanged_TimeSig(instrument, data) {
    //console.log(`onChanged_TimeSig(${JSON.stringify(data)})`);
    this.#invokeTimer();
  }
  onChanged_SetNoteMuted(instrument, data) {
    //console.log(`onChanged_SetNoteMuted(${JSON.stringify(data)})`);
    this.#invokeTimer();
  }
  onChanged_SelectPattern(instrument, data) {
    //console.log(`onChanged_SelectPattern(${JSON.stringify(data)})`);
    this.#invokeTimer();
  }
  onChanged_SetSpeed(instrument, data) {
    //console.log(`onChanged_SetSpeed(${JSON.stringify(data)})`);
    this.#invokeTimer();
  }
  onChanged_SetSwing(instrument, data) {
    //console.log(`onChanged_SetSwing(${JSON.stringify(data)})`);
    this.#invokeTimer();
  }
  onChanged_SetDiv(instrument, data) {
    //console.log(`onChanged_SetDiv(${JSON.stringify(data)})`);
    this.#invokeTimer();
  }
  onChanged_SetLength(instrument, data) {
    //console.log(`onChanged_SetLength(${JSON.stringify(data)})`);
    this.#invokeTimer();
  }
  onChanged_PatternOps(instrument, data) {
    //console.log(`onChanged_PatternOps(${JSON.stringify(data)})`);
    this.#invokeTimer();
  }

  timerProc() {
    //console.log(`{ --- seq timer proc --------------`);
    // if you call this directly, with no timer, then start interval.
    // this allows callers to invoke directly without timer, and it will restart everything.
    if (!this.timer) {
      this.timer = setInterval(() => this.timerProc(), gIntervalMS);
    }

    let beat = this.metronome.getAbsoluteBeat();
    this.instruments.forEach(i => {
      this.timerProcForInstrument(i, beat);
    });
    //console.log(`} seq timer proc`);
  }

  timerProcForInstrument(instrument, playheadAbsBeat) {
    //console.log(`for instrument ${instrument.instrumentID}`);

    const patch = instrument.sequencerDevice.livePatch;
    const patternView = new Seq.SequencerPatternView(patch, instrument.sequencerDevice.GetNoteLegend());

    if (!instrument.sequencerDevice.isPlaying) {
      //console.log(`not playing; clearing data.`);
      this.quantizer.setSequencerEvents(instrument.instrumentID, [], patternView, false);
      return;
    }

    const patternPlayheadInfo = patch.GetAbsQuarterInfo(playheadAbsBeat);
    const windowLengthMS = gIntervalMS * gChunkSizeFactor;
    const windowLengthQuarters = DFU.MSToBeats(windowLengthMS, this.metronome.getBPM());
    const windowEndAbsQuarters = playheadAbsBeat + windowLengthQuarters;

    // scheduling time must be in abs beats.
    // calc chunk, enforcing pattern end loops. accumulate a list of events.
    // for each note, add its noteon/noteoff for each loop until it's out of window.
    const events = [];
    patternView.divs.forEach(div => {
      const divLengthQuarters = (div.endPatternFrac - div.beginPatternFrac) * patternPlayheadInfo.patternLengthQuarters;

      const divBeginPatternQuarter = div.beginPatternFrac * patternPlayheadInfo.patternLengthQuarters;

      let divFirstFutureAbsQuarter = null;
      if (divBeginPatternQuarter < patternPlayheadInfo.patternQuarter) {
        // div occurs before the playhead within pattern
        //    ----D---------|-----------------D------------|----------------D----
        //        ^div                        ^div                          ^div
        //                  [-----------------] = divBeginPatternQuarter
        //                                         ^ playhead
        //                                                                  ^RETURN THIS
        divFirstFutureAbsQuarter = Math.ceil(patternPlayheadInfo.absPatternFloat) * patternPlayheadInfo.patternLengthQuarters + divBeginPatternQuarter;
      } else {
        //    ----D---------|-----------------D------------|----------------D----
        //        ^div                        ^div                          ^div
        //                  [-----------------] = divBeginPatternQuarter
        //                           ^ playhead
        //                                    ^RETURN THIS
        divFirstFutureAbsQuarter = Math.floor(patternPlayheadInfo.absPatternFloat) * patternPlayheadInfo.patternLengthQuarters + divBeginPatternQuarter
      }

      Object.entries(div.noteMap).forEach(e => {
        const midiNoteValue = e[0];
        const note = e[1]; // of PatternViewNote
        if (!note.hasNote || note.isMuted)
          return;

        for (let cursorAbsQuarter = divFirstFutureAbsQuarter; cursorAbsQuarter < windowEndAbsQuarters; cursorAbsQuarter += patternPlayheadInfo.patternLengthQuarters) {
          events.push({
            velocity : note.velocity,
            midiNoteValue,
            lengthQuarters : divLengthQuarters,
            noteID: note.id,
            absQuarter: cursorAbsQuarter,
          });
        }
      });
    });

    this.quantizer.setSequencerEvents(instrument.instrumentID, events, patternView, true);
  }
}

module.exports = {
  RoomSequencerPlayer,
}
