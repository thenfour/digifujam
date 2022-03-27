const Seq = require('../DFcommon/SequencerCore');
const DFMusic = require('../DFcommon/DFMusic');
const DFU = require('../DFcommon/dfutil');
const DF = require('../DFcommon/DFCommon');

// when you make changes that require rescheduling sequencer notes, like note ons during arpeggiator mode, or changing
// any seq params, "throttle" recalcs by delaying a bit.
const gRecalcLatencyMS = 30;

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

// each arpeggiator mapping mode gets a function which transforms a div with notes on into a list of events.
// the most basic "none" mapping just looks at noteOns and pushes the events.
// mapping functions have a lot of power, to do all the various arp transformations, but it means they have a responsibility to:
// - respect cell.isMuted
// - respect patch transposition by calling patch.AdjustMidiNoteValue(cell.midiNoteValue)
// - set length, respecting swing and patch speed.
function MappingFunction_Seq(params) {
  const ret = [];
  for (let irow = 0; irow < params.div.noteOns.length; ++irow) {
    const cell = params.div.noteOns[irow];
    if (cell.isMuted)
      continue;

    ret.push({
      velocity : cell.velocity,
      midiNoteValue: params.patch.AdjustMidiNoteValue(cell.midiNoteValue),
      lengthQuarters : cell.thisLengthSwingQuarters / params.patch.speed,
      noteID : cell.id,
      // absQuarter is set later
    });
  }
  return ret;
}

// AsPlayed.
// do not examine pattern data at all; just repeat what you're playing
function MappingFunction_AsPlayed(params) {
  // LENGTH is tricky because we don't know. just pick the first non-muted cell for reference.
  let cell = null;
  for (let irow = 0; irow < params.div.noteOns.length; ++irow) {
    const o = params.div.noteOns[irow];
    if (o.isMuted)
      continue;
    cell = o;
    break;
  }
  if (!cell) return [];

  return params.heldNotes.map(o => ({
    velocity: o.velocity,
    midiNoteValue: params.patch.AdjustMidiNoteValue(o.note),
    lengthQuarters: cell.thisLengthSwingQuarters / params.patch.speed,
    noteID: cell.id,
  }));
}

// ignore pattern note value, use a random playing note
function MappingFunction_Random(params) {
  const ret = [];
  if (params.heldNotes.length === 0) return ret;

  for (let irow = 0; irow < params.div.noteOns.length; ++irow) {
    const cell = params.div.noteOns[irow];
    if (cell.isMuted)
      continue;

    //const ni = (params.absPatternFloor * params.patternView.patternNoteCount + cell.patternNoteIndex) % params.heldNotes.length;
    const ni = Math.random() * params.heldNotes.length;
    const heldNote = params.heldNotes.at(ni);
    ret.push({
      velocity: cell.velocity,
      midiNoteValue: params.patch.AdjustMidiNoteValue(heldNote.note),
      lengthQuarters: cell.thisLengthSwingQuarters / params.patch.speed,
      noteID: cell.id,
    });
  }
  return ret;
}

// ignore pattern note value, just go up in sequence according to rhythm and polyphony of x_Uprn
function MappingFunction_XUp(params) {
  const ret = [];
  if (params.heldNotes.length === 0) return ret;

  for (let irow = 0; irow < params.div.noteOns.length; ++irow) {
    const cell = params.div.noteOns[irow];
    if (cell.isMuted)
      continue;

    const absNoteIndex = params.absPatternFloor * params.patternView.patternNoteCount + cell.patternNoteIndex;
    const ni = absNoteIndex % params.heldNotes.length;
    const heldNote = params.heldNotes.at(ni);
    //console.log(`iabspat ${params.absPatternFloor} * notecount ${params.patternView.patternNoteCount} + patnoteid ${cell.patternNoteIndex} = ${absNoteIndex} % heldNoteslen ${params.heldNotes.length} = ${ni}  => note ${heldNote.note}`);
    ret.push({
      velocity: cell.velocity,
      midiNoteValue: params.patch.AdjustMidiNoteValue(heldNote.note),
      lengthQuarters: cell.thisLengthSwingQuarters / params.patch.speed,
      noteID: cell.id,
    });
  }
  return ret;
}


// ignore pattern note value, just go DOWN in sequence according to rhythm and polyphony of x_Uprn
function MappingFunction_XDown(params) {
  const ret = [];
  if (params.heldNotes.length === 0) return ret;

  for (let irow = 0; irow < params.div.noteOns.length; ++irow) {
    const cell = params.div.noteOns[irow];
    if (cell.isMuted)
      continue;

    const absNoteIndex = params.absPatternFloor * params.patternView.patternNoteCount + cell.patternNoteIndex;
    const ni = absNoteIndex % params.heldNotes.length;
    const heldNote = params.heldNotes.at(params.heldNotes.length - 1 - ni);
    //console.log(`iabspat ${params.absPatternFloor} * notecount ${params.patternView.patternNoteCount} + patnoteid ${cell.patternNoteIndex} = ${absNoteIndex} % heldNoteslen ${params.heldNotes.length} = ${ni}  => note ${heldNote.note}`);
    ret.push({
      velocity: cell.velocity,
      midiNoteValue: params.patch.AdjustMidiNoteValue(heldNote.note),
      lengthQuarters: cell.thisLengthSwingQuarters / params.patch.speed,
      noteID: cell.id,
    });
  }
  return ret;
}


// ignore pattern note value, just go DOWN in sequence according to rhythm and polyphony of x_Uprn
function MappingFunction_XUpDown(params) {
  const ret = [];
  if (params.heldNotes.length === 0) return ret;

  for (let irow = 0; irow < params.div.noteOns.length; ++irow) {
    const cell = params.div.noteOns[irow];
    if (cell.isMuted)
      continue;

    const absNoteIndex = params.absPatternFloor * params.patternView.patternNoteCount + cell.patternNoteIndex;
    const period = params.heldNotes.length < 2 ? 1 : ((params.heldNotes.length * 2) - 2); // - 2 to not repeat top or bottom notes.
    let ni = absNoteIndex % period;
    if (ni >= params.heldNotes.length) {
      // after the "up" segment, reverse.
      ni = period - ni;
      // len=5. p=8
      // 0 1 2 3 4 5 6 7
      // 0 1 2 3 4 3 2 1
    }
    const heldNote = params.heldNotes.at(ni);
    //console.log(`iabspat ${params.absPatternFloor} * notecount ${params.patternView.patternNoteCount} + patnoteid ${cell.patternNoteIndex} = ${absNoteIndex} % heldNoteslen ${params.heldNotes.length} = ${ni}  => note ${heldNote.note}`);
    ret.push({
      velocity: cell.velocity,
      midiNoteValue: params.patch.AdjustMidiNoteValue(heldNote.note),
      lengthQuarters: cell.thisLengthSwingQuarters / params.patch.speed,
      noteID: cell.id,
    });
  }
  return ret;
}






/////////////////////////////////////////////////////////////////////////////////////////////////////////
class InstrumentSequencerPlayer {
  constructor(roomState, instrument) {
    this.roomState = roomState;
    this.metronome = roomState.metronome;
    this.quantizer = roomState.quantizer;
    this.timer = null;
    this.instrument = instrument;
    this.noteTracker = new DFMusic.HeldNoteTracker();
    this.divMappers = {};

    this.divMappers["ArpMap_AsPlayed"] = MappingFunction_AsPlayed;
    this.divMappers["ArpMap_ArpUp"] = MappingFunction_XUp;
    this.divMappers["ArpMap_ArpDown"] = MappingFunction_XDown;
    this.divMappers["ArpMap_ArpUpDown"] = MappingFunction_XUpDown;
    this.divMappers["ArpMap_Random"] = MappingFunction_Random;
    this.divMappers["ArpMap_Seq"] = MappingFunction_Seq;

    this.#invokeTimer();
  }

  // calls the time proc "soon" and resets timer interval
  #invokeTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.latentTimer) {
      clearTimeout(this.latentTimer);
    }
    this.latentTimer = setTimeout(() => {
      this.timerProc();
    }, gRecalcLatencyMS);
  }

  OnChanged() {
    this.#invokeTimer();
  }

  AllNotesOff() {
    this.noteTracker.AllNotesOff();
    //this.#invokeTimer();
  }

  // return true to swallow the event
  NoteOn(note, velocity) {
    this.noteTracker.NoteOn(note, velocity);
    const swallow = this.instrument.sequencerDevice.ShouldLiveNoteOnsAndOffsBeSwallowed();
    if (swallow) this.#invokeTimer(); // hacky but basically if a note is to be swallowed it's because we're doing something with it.
    return swallow;
  }

  // return true to swallow the event
  NoteOff(note) {
    this.noteTracker.NoteOff(note);
    const swallow = this.instrument.sequencerDevice.ShouldLiveNoteOnsAndOffsBeSwallowed();
    if (swallow) this.#invokeTimer(); // hacky but basically if a note is to be swallowed it's because we're doing something with it.
    return swallow;
  }

  PedalUp() {
    this.noteTracker.PedalUp();
    const swallow = this.instrument.sequencerDevice.ShouldLiveNoteOnsAndOffsBeSwallowed();
    if (swallow) this.#invokeTimer(); // hacky but basically if a note is to be swallowed it's because we're doing something with it.
    return swallow;
  }

  PedalDown() {
    this.noteTracker.PedalDown();
    const swallow = this.instrument.sequencerDevice.ShouldLiveNoteOnsAndOffsBeSwallowed();
    if (swallow) this.#invokeTimer(); // hacky but basically if a note is to be swallowed it's because we're doing something with it.
    return swallow;
  }

  timerProc() {
    // if you call this directly, with no timer, then start interval.
    // this allows callers to invoke directly without timer, and it will restart everything.
    if (!this.timer) {
      this.timer = setInterval(() => this.timerProc(), gIntervalMS);
    }

    let playheadAbsBeat = this.metronome.getAbsoluteBeat();

    const seq = this.instrument.sequencerDevice;
    const patch = this.instrument.sequencerDevice.livePatch;
    const patternView = Seq.GetPatternView(patch, this.instrument.sequencerDevice.GetNoteLegend());

    if (!this.instrument.sequencerDevice.isPlaying) {
      //console.log(`not playing; clearing data.`);
      this.quantizer.setSequencerEvents(this.instrument.instrumentID, [], patternView, false, null);
      return;
    }

    const heldNotes = this.noteTracker;

    const patternPlayheadInfo = this.instrument.sequencerDevice.GetAbsQuarterInfo(playheadAbsBeat); // adjusted for patch speed
    const absPatternFloor = Math.floor(patternPlayheadInfo.absPatternFloat);
    const windowLengthMS = gIntervalMS * gChunkSizeFactor;
    const windowLengthQuarters = DFU.MSToBeats(windowLengthMS, this.metronome.getBPM()) * patch.speed; // speed-adjusted
    const windowEndShiftedQuarters = patternPlayheadInfo.shiftedAbsQuarter + windowLengthQuarters;     // speed-adjusted

    const divMappingFunction = this.divMappers[seq.GetArpMapping().id];
    if (!divMappingFunction) {
      console.log(`!! Unsupported mapping style ${seq.GetArpMapping().id}`);
      return;
    }

    const heldNotesByNoteValue = heldNotes.heldNotesByNoteValue;
    //console.log(`==== scheduling. heldnotes = ${JSON.stringify(heldNotesByNoteValue)}`);

    // scheduling time must be in abs quarters.
    // this walks through all pattern divs, and for all notes in each div, schedules note on/off event pairs.
    // for each note, this adds multiple if the pattern is less than the window len.
    const events = [];

    for (let idiv = 0; idiv < patternView.divsWithNoteOn.length; ++idiv) {
      const div = patternView.divsWithNoteOn[idiv];
      const divBeginPatternQuarter = div.swingBeginPatternQuarter; // these are pattern quarters. which means they're speed-adjusted.
      let tempAbsPatternFloor = absPatternFloor;

      // figure out which abs pattern to start from. if the "current" is passed, then advance a whole pattern forward in abs time.
      let divFirstFutureAbsQuarter = null; // speed-adjusted quarters.
      if (divBeginPatternQuarter < patternPlayheadInfo.patternQuarter) {
        // this div's begin occurs before the playhead within pattern; the first time this note on would appear is in the NEXT loop.
        //    -pattern------------][-pattern------------------][-pattern---------------------   <-- abs timeline
        //        ^div                     [-thisdiv---]               [-thisdiv---]
        //                                        ^abs playhead pattern frac
        //                                 ^this is too old            ^so use this.
        tempAbsPatternFloor += 1;
        divFirstFutureAbsQuarter = Math.ceil(patternPlayheadInfo.absPatternFloat) * patternPlayheadInfo.patternLengthQuarters + divBeginPatternQuarter;
      } else {
        //    -pattern------------][-pattern------------------][-pattern---------------------   <-- abs timeline
        //        ^div                     [-thisdiv---]               [-thisdiv---]
        //                              ^abs playhead pattern frac
        //                                 ^use this
        divFirstFutureAbsQuarter = Math.floor(patternPlayheadInfo.absPatternFloat) * patternPlayheadInfo.patternLengthQuarters + divBeginPatternQuarter
      }

      // now "loop" this pattern for this note until out of window.
      for (let cursorShiftedQuarter = divFirstFutureAbsQuarter; cursorShiftedQuarter <= windowEndShiftedQuarters; cursorShiftedQuarter += patternPlayheadInfo.patternLengthQuarters) {
        const divEvents = divMappingFunction({
          heldNotes: heldNotesByNoteValue,
          div,
          patch,
          absPatternFloor: tempAbsPatternFloor,
          patternView
        });
        //console.log(`Mapping result: ` + JSON.stringify(divEvents));
        const absQuarter = cursorShiftedQuarter / patch.speed;
        for (let ievent = 0; ievent < divEvents.length; ++ ievent) {
          const e = divEvents[ievent];
          events.push(Object.assign({
            absQuarter,
            //tempAbsPatternFloor,
            //eventLen: events.length,
          }, e));
        }
        tempAbsPatternFloor ++;
      }

    } // for each div

    //console.log(`scheduling ${events.length} seq events in SA window [${patternPlayheadInfo.shiftedAbsQuarter} - ${windowEndShiftedQuarters}] and SA minmax [${minAbsQuarter}, ${maxAbsQuarter}]`);
    //console.log(`window length quarters: ${windowLengthQuarters}, scheduling ${events.length} events`);
    //console.log(`Events to schedule: ` + JSON.stringify(events));

    this.quantizer.setSequencerEvents(this.instrument.instrumentID, events, patternView, true, this.instrument.sequencerDevice.startFromAbsQuarter);
  }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////

class RoomSequencerPlayer {
  constructor(roomState) {
    this.roomState = roomState;
    this.metronome = roomState.metronome;
    this.quantizer = roomState.quantizer;

    this.instruments = this.roomState.instrumentCloset.filter(i => i.allowSequencer); // precalc a list of relevant instruments
    this.instrumentPlayers = new Map();                                               // map instrumentID to a held note tracker.
    this.instruments.forEach(inst => {
      this.instrumentPlayers.set(inst.instrumentID, new InstrumentSequencerPlayer(roomState, inst));
    });
  }

  AllNotesOff(instrument) {
    this.instrumentPlayers.get(instrument.instrumentID).AllNotesOff();
  }

  // return true to swallow the event
  NoteOn(instrument, note, velocity) {
    return this.instrumentPlayers.get(instrument.instrumentID).NoteOn(note, velocity);
  }

  // return true to swallow the event
  NoteOff(instrument, note) {
    return this.instrumentPlayers.get(instrument.instrumentID).NoteOff(note);
  }

  PedalUp(instrument) {
    this.instrumentPlayers.get(instrument.instrumentID).PedalUp();
  }

  PedalDown(instrument) {
    this.instrumentPlayers.get(instrument.instrumentID).PedalDown();
  }

  onChanged_PlayStop(instrument, data) {
    this.onChanged_Instrument(instrument);
  }
  onChanged_TimeSig(instrument, data) {
    this.onChanged_Instrument(instrument);
  }
  onChanged_SetNoteMuted(instrument, data) {
    this.onChanged_Instrument(instrument);
  }
  onChanged_SelectPattern(instrument, data) {
    this.onChanged_Instrument(instrument);
  }
  onChanged_SetSpeed(instrument, data) {
    this.onChanged_Instrument(instrument);
  }
  onChanged_SetSwing(instrument, data) {
    this.onChanged_Instrument(instrument);
  }
  onChanged_SetDiv(instrument, data) {
    this.onChanged_Instrument(instrument);
  }
  onChanged_SetLength(instrument, data) {
    this.onChanged_Instrument(instrument);
  }
  onChanged_PatternOps(instrument, data) {
    this.onChanged_Instrument(instrument);
  }
  onChanged_General() {
    this.instrumentPlayers.forEach(player => player.OnChanged());
  }
  onChanged_Instrument(instrument) {
    this.instrumentPlayers.get(instrument.instrumentID).OnChanged();
  }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////

module.exports = {
  RoomSequencerPlayer,
}
