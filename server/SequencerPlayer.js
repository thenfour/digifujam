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
  onChanged_General() {
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
    const patternView = Seq.GetPatternView(patch, instrument.sequencerDevice.GetNoteLegend());

    if (!instrument.sequencerDevice.isPlaying) {
      //console.log(`not playing; clearing data.`);
      this.quantizer.setSequencerEvents(instrument.instrumentID, [], patternView, false, null);
      return;
    }

    const patternPlayheadInfo = instrument.sequencerDevice.GetAbsQuarterInfo(playheadAbsBeat); // adjusted for patch speed
    const windowLengthMS = gIntervalMS * gChunkSizeFactor;
    const windowLengthQuarters = DFU.MSToBeats(windowLengthMS, this.metronome.getBPM()) * patch.speed; // speed-adjusted
    const windowEndShiftedQuarters = patternPlayheadInfo.shiftedAbsQuarter + windowLengthQuarters;     // speed-adjusted
    //const shiftQuarters = instrument.sequencerDevice.baseAbsQuarter;                                   // NOT speed-adjusted.

    // let minAbsQuarter = null;
    // let maxAbsQuarter = null;

    // scheduling time must be in abs quarters.
    // this walks through all pattern divs, and for all notes in each div, schedules note on/off event pairs.
    // for each note, this adds multiple if the pattern is less than the window len.
    const events = [];
    patternView.divs.forEach(div => {
      const divBeginPatternQuarter = div.swingBeginPatternQuarter; // these are pattern quarters. which means they're speed-adjusted.

      // figure out which abs pattern to start from. if the "current" is passed, then advance a whole pattern forward in abs time.
      let divFirstFutureAbsQuarter = null; // speed-adjusted quarters.
      if (divBeginPatternQuarter < patternPlayheadInfo.patternQuarter) {
        // this div's begin occurs before the playhead within pattern; the first time this note on would appear is in the NEXT loop.
        //    -pattern------------][-pattern------------------][-pattern---------------------   <-- abs timeline
        //        ^div                     [-thisdiv---]               [-thisdiv---]
        //                                        ^abs playhead pattern frac
        //                                 ^this is too old            ^so use this.
        divFirstFutureAbsQuarter = Math.ceil(patternPlayheadInfo.absPatternFloat) * patternPlayheadInfo.patternLengthQuarters + divBeginPatternQuarter;
      } else {
        //    -pattern------------][-pattern------------------][-pattern---------------------   <-- abs timeline
        //        ^div                     [-thisdiv---]               [-thisdiv---]
        //                              ^abs playhead pattern frac
        //                                 ^use this
        divFirstFutureAbsQuarter = Math.floor(patternPlayheadInfo.absPatternFloat) * patternPlayheadInfo.patternLengthQuarters + divBeginPatternQuarter
      }

      Object.entries(div.rows).forEach(e => {
        const midiNoteValue = patch.AdjustMidiNoteValue(parseInt(e[0]));
        const cell = e[1]; // of PatternViewNote
        if (cell.isMuted)
          return;
        if (cell.beginBorderType !== Seq.eBorderType.NoteOn) // only care about note ons. it contains all info
          return;

        // now "loop" this pattern for this note until out of window.
        for (let cursorShiftedQuarter = divFirstFutureAbsQuarter; cursorShiftedQuarter < windowEndShiftedQuarters; cursorShiftedQuarter += patternPlayheadInfo.patternLengthQuarters) {
          // minAbsQuarter = (minAbsQuarter == null) ? cursorShiftedQuarter : Math.min(minAbsQuarter, cursorShiftedQuarter);
          // maxAbsQuarter = (maxAbsQuarter == null) ? cursorShiftedQuarter : Math.max(maxAbsQuarter, cursorShiftedQuarter);

          const nonSpeedAdjustedCursor = cursorShiftedQuarter / patch.speed;
          // if (nonSpeedAdjustedCursor < (instrument.sequencerDevice.startFromAbsQuarter - shiftQuarters))
          //   continue;
          const absQ = nonSpeedAdjustedCursor;// + shiftQuarters;
          events.push({
            velocity : cell.velocity,
            midiNoteValue,
            lengthQuarters : cell.thisLengthQuarters / patch.speed,
            noteID : cell.id,
            absQuarter : absQ,
          });
        }
      });
    }); // for each div

    //console.log(`scheduling ${events.length} seq events in SA window [${patternPlayheadInfo.shiftedAbsQuarter} - ${windowEndShiftedQuarters}] and SA minmax [${minAbsQuarter}, ${maxAbsQuarter}]`);

    this.quantizer.setSequencerEvents(instrument.instrumentID, events, patternView, true, instrument.sequencerDevice.startFromAbsQuarter);
  }
}

module.exports = {
  RoomSequencerPlayer,
}
