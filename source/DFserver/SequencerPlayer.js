const Seq = require('../DFcommon/SequencerCore');
const DFMusic = require('../DFcommon/DFMusic');
const DFU = require('../DFcommon/dfutil');
const DF = require('../DFcommon/DFCommon');

// let gStart = null;
// let gPerfs = new Map();
// let gReported = Date.now();

// function DumpPerfData(ms) {
//   const now = Date.now();
//   let totalms = 0;
//   gPerfs.forEach((v, k) => {
//     if (now - k < ms) {
//       totalms += v;
//     }
//   });
//   console.log(`${totalms}ms of cpu over ${ms} ms of time`);
// }
// function StartPerf() {
//   gStart = Date.now();
// }
// function RegisterPerf() {
//   const now = Date.now();
//   const elapsed = now - gStart;
//   gPerfs.set(now, elapsed);
//   if (now - gReported > 5000) {
//     DumpPerfData(10000);
//     gReported = now;
//   }
// }

function StartPerf() {
}
function RegisterPerf() {
}


// when you make changes that require rescheduling sequencer notes, like note ons during arpeggiator mode, or changing
// any seq params, "throttle" recalcs by delaying a bit.
const gRecalcLatencyMS = 25;

// timer interval duration should be balanced:
// * too long and it will incur too much processing (meaning noticeable periodic spikes in processing)
// * too short and system will be crowded with the overhead of this thing.
//
// at very least we can say the timer should be expected to DO actual work each iteration.
// and probably even dozens of events are more efficient than a nop interval.
// so that suggests it should be pretty long, like once per few seconds. maybe 1 measure of 4/4 @ 100bpm.

// 350 is pretty much a sweet spot for local activity. But on the server, we should favor the
// longer period for stability.
const gIntervalMS = 941;

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

function RestrictTo1OctaveIfNecessary(cellNote, calculatedNote, params)
{
  if (!params.seq.GetRestrictTransposeToOneOctave()) return calculatedNote;
  let dist = calculatedNote - cellNote;
  while (dist > 6) dist -= 12;
  while (dist < -6) dist += 12;
  return cellNote + dist;
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
    midiNoteValue: params.patch.AdjustMidiNoteValue(RestrictTo1OctaveIfNecessary(cell.midiNoteValue, o.note, params)),
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

    const ni = Math.random() * params.heldNotes.length;
    const heldNote = params.heldNotes.at(ni);
    ret.push({
      velocity: cell.velocity,
      midiNoteValue: params.patch.AdjustMidiNoteValue(RestrictTo1OctaveIfNecessary(cell.midiNoteValue, heldNote.note, params)),
      lengthQuarters: cell.thisLengthSwingQuarters / params.patch.speed,
      noteID: cell.id,
    });
  }
  return ret;
}

// play the pattern, but transposed via (lastHeldNote - basenote) + cellNote
// this is the "key trigger" mode.
function MappingFunction_TranspSeq(params) {
  const ret = [];
  if (!params.lowestNoteValue) return ret; // don't play anything if no notes.
  const lowestNoteValue = params.lowestNoteValue;

  for (let irow = 0; irow < params.div.noteOns.length; ++irow) {
    const cell = params.div.noteOns[irow];
    if (cell.isMuted)
      continue;

    let transp = lowestNoteValue - params.seq.GetBaseNote();
    let note = cell.midiNoteValue + transp;

    ret.push({
      velocity: cell.velocity,
      midiNoteValue: params.patch.AdjustMidiNoteValue(RestrictTo1OctaveIfNecessary(cell.midiNoteValue, note, params)),
      lengthQuarters: cell.thisLengthSwingQuarters / params.patch.speed,
      noteID: cell.id,
    });
  }
  return ret;
}


// there are actually plenty of decisions to take here.
// we won't look at the note value to interpolate, but rather the index.
// for the sequencer, it's the index of the value over the whole sequence,
// for held notes obviously it's just 1 chord.
// then we just spread so 0=0 and 1=1 and everything else linear in between.

// noteIndexInPattern01
function MappingFunction_Spread(params) {
  const ret = [];
  if (params.heldNotes.length === 0) return ret;

  for (let irow = 0; irow < params.div.noteOns.length; ++irow) {
    const cell = params.div.noteOns[irow];
    if (cell.isMuted)
      continue;

    let fidx = cell.noteIndexInPattern01 * (params.heldNotes.length - 1);
    fidx = Math.round(fidx) | 0;
    if (fidx >= params.heldNotes.length) --fidx;
    
    let note = params.heldNotes[fidx].note;

    ret.push({
      velocity: cell.velocity,
      midiNoteValue: params.patch.AdjustMidiNoteValue(RestrictTo1OctaveIfNecessary(cell.midiNoteValue, note, params)),
      lengthQuarters: cell.thisLengthSwingQuarters / params.patch.speed,
      noteID: cell.id,
    });
  }
  return ret;
}



function MappingFunction_ChordScale(params) {
  const ret = [];
  if (params.heldNotes.length === 0) return ret;

  let heldNotes3Oct = [...new Set(params.heldNotes.map(n => n.note % 12))]; // unique held notes without octave info
  heldNotes3Oct = heldNotes3Oct.concat(heldNotes3Oct.map(n => n + 12)).concat(heldNotes3Oct.map(n => n + 24));// repeat it for 3 octaves.
  //heldNotes3Oct.sort((a,b) => a - b); <-- could be an optimization for lookup below.

  for (let irow = 0; irow < params.div.noteOns.length; ++irow) {
    const cell = params.div.noteOns[irow];
    if (cell.isMuted)
      continue;

    // put this in octave 1 (not octave 0), so it lands in the middle of the 3-octave heldnotes array.
    // 12.4 instead of 12, so we need to favor transposing up just a bit, otherwise we get too many identical notes.
    const noteOct1 = (cell.midiNoteValue % 12) + 12.4; 

    // find the closest held note, then transpose it via octave to be nearest.
    let nearestNote = null;
    let nearestDist = 1e4;
    for (let ihn = 0; ihn < heldNotes3Oct.length; ++ ihn) {
      const hn = heldNotes3Oct[ihn];
      const dist = Math.abs(noteOct1 - hn);
      
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestNote = hn;
      }
    }

    if (!nearestNote) continue; // i don't think this is possible

    // apply the diff to the original pattern note.
    let note = Math.ceil((nearestNote - noteOct1) + cell.midiNoteValue);

    ret.push({
      velocity: cell.velocity,
      midiNoteValue: params.patch.AdjustMidiNoteValue(note),
      lengthQuarters: cell.thisLengthSwingQuarters / params.patch.speed,
      noteID: cell.id,
    });
  }
  return ret;
}


function MappingFunction_TranspChordScale(params) {
  const ret = [];
  if (!params.lowestNoteValue) return ret; // don't play anything if no notes.
  const lowestNoteValue = params.lowestNoteValue;

  let heldNotes3Oct = [...new Set(params.heldNotes.map(n => n.note % 12))]; // unique held notes without octave info
  heldNotes3Oct = heldNotes3Oct.concat(heldNotes3Oct.map(n => n + 12)).concat(heldNotes3Oct.map(n => n + 24));// repeat it for 3 octaves.

  for (let irow = 0; irow < params.div.noteOns.length; ++irow) {
    const cell = params.div.noteOns[irow];
    if (cell.isMuted)
      continue;

    // put this in octave 1 (not octave 0), so it lands in the middle of the 3-octave heldnotes array.
    // 12.4 instead of 12, so we need to favor transposing up just a bit, otherwise we get too many identical notes.
    let transp = lowestNoteValue - params.seq.GetBaseNote();
    if (params.seq.GetRestrictTransposeToOneOctave()) {
      while (transp > 6) transp -= 12;
      while (transp < -6) transp += 12;
    }

    let patternNote = cell.midiNoteValue + transp;
    const noteOct1 = (patternNote % 12) + 12.4;

    // find the closest held note, then transpose it via octave to be nearest.
    let nearestNote = null;
    let nearestDist = 1e4;
    for (let ihn = 0; ihn < heldNotes3Oct.length; ++ ihn) {
      const hn = heldNotes3Oct[ihn];
      const dist = Math.abs(noteOct1 - hn);
      
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestNote = hn;
      }
    }

    if (!nearestNote) continue; // i don't think this is possible

    // apply the diff to the original pattern note.
    let note = Math.ceil((nearestNote - noteOct1) + patternNote);

    ret.push({
      velocity: cell.velocity,
      midiNoteValue: params.patch.AdjustMidiNoteValue(RestrictTo1OctaveIfNecessary(cell.midiNoteValue, note, params)),
      lengthQuarters: cell.thisLengthSwingQuarters / params.patch.speed,
      noteID: cell.id,
    });
  }
  return ret;
}




function MappingFunction_FillUp(params) {
  const ret = [];
  if (params.heldNotes.length === 0) return ret;

  // try to center the octaves.
  let octaveShift = Math.floor((params.patternView.allNoteValues.length / params.heldNotes.length / 2) - .33); // using .Round (at .5) is not good; we want to slightly favor going UP so using 0.33.

  for (let irow = 0; irow < params.div.noteOns.length; ++irow) {
    const cell = params.div.noteOns[irow];
    if (cell.isMuted)
      continue;

    let patNoteIdx = cell.noteValueInPatternIndexFromBottom;// * (params.heldNotes.length - 1);
    let heldNoteIdx = patNoteIdx % params.heldNotes.length;
    let octave = Math.floor(patNoteIdx / params.heldNotes.length);
    
    let note = params.heldNotes[heldNoteIdx].note;
    note += (octave - octaveShift) * 12;

    ret.push({
      velocity: cell.velocity,
      midiNoteValue: params.patch.AdjustMidiNoteValue(RestrictTo1OctaveIfNecessary(cell.midiNoteValue, note, params)),
      lengthQuarters: cell.thisLengthSwingQuarters / params.patch.speed,
      noteID: cell.id,
    });
  }
  return ret;
}

function MappingFunction_FillDown(params) {
  const ret = [];
  if (params.heldNotes.length === 0) return ret;

  // try to center the octaves.
  let octaveShift = Math.floor((params.patternView.allNoteValues.length / params.heldNotes.length / 2) - .33); // using .Round (at .5) is not good; we want to slightly favor going UP so using 0.33.
  //octaveShift = 0;

  for (let irow = 0; irow < params.div.noteOns.length; ++irow) {
    const cell = params.div.noteOns[irow];
    if (cell.isMuted)
      continue;

    let patNoteIdx = cell.noteValueInPatternIndexFromTop;
    let heldNoteIdx = patNoteIdx % params.heldNotes.length;
    let octave = Math.floor(patNoteIdx / params.heldNotes.length);
    
    let note = params.heldNotes[params.heldNotes.length - 1 - heldNoteIdx].note;
    note -= octave * 12;
    note += octaveShift * 12;

    ret.push({
      velocity: cell.velocity,
      midiNoteValue: params.patch.AdjustMidiNoteValue(RestrictTo1OctaveIfNecessary(cell.midiNoteValue, note, params)),
      lengthQuarters: cell.thisLengthSwingQuarters / params.patch.speed,
      noteID: cell.id,
    });
  }
  return ret;
}

// ignore pattern note value, just go DOWN in sequence according to rhythm and polyphony of x_Uprn
function MappingFunction_ArpGeneric(params, indexFn) {
  const ret = [];
  if (params.heldNotes.length === 0) return ret;

  for (let irow = 0; irow < params.div.noteOns.length; ++irow) {
    const cell = params.div.noteOns[irow];
    if (cell.isMuted)
      continue;

    const absNoteIndex = params.absPatternFloor * params.patternView.patternNoteCount + cell.patternNoteIndex;
    const ni = indexFn(absNoteIndex, params);// % params.heldNotes.length;
    const heldNote = params.heldNotes.at(ni);
    ret.push({
      velocity: cell.velocity,
      midiNoteValue: params.patch.AdjustMidiNoteValue(RestrictTo1OctaveIfNecessary(cell.midiNoteValue, heldNote.note, params)),
      lengthQuarters: cell.thisLengthSwingQuarters / params.patch.speed,
      noteID: cell.id,
    });
  }
  return ret;
}



function IndexMap_Up(absNoteIndex, params) {
  return absNoteIndex % params.heldNotes.length;
}



// ignore pattern note value, just go up in sequence according to rhythm and polyphony of x_Uprn
function MappingFunction_XUp(params) {
  return MappingFunction_ArpGeneric(params, IndexMap_Up);
}

function IndexMap_Down(absNoteIndex, params) {
  const ni = absNoteIndex % params.heldNotes.length;
  return params.heldNotes.length - 1 - ni;
}


// ignore pattern note value, just go DOWN in sequence according to rhythm and polyphony of x_Uprn
function MappingFunction_XDown(params) {
  return MappingFunction_ArpGeneric(params, IndexMap_Down);
}

function IndexMap_UpDown(absNoteIndex, params) {
  const period = params.heldNotes.length < 2 ? 1 : ((params.heldNotes.length * 2) - 2); // - 2 to not repeat top or bottom notes.
  let ni = absNoteIndex % period;
  if (ni >= params.heldNotes.length) {
    // after the "up" segment, reverse.
    ni = period - ni;
    // len=5. p=8
    // 0 1 2 3 4 5 6 7
    // 0 1 2 3 4 3 2 1
  }
  return ni;
}


// ignore pattern note value, just go DOWN in sequence according to rhythm and polyphony of x_Uprn
function MappingFunction_XUpDown(params) {
  return MappingFunction_ArpGeneric(params, IndexMap_UpDown);
}

function IndexMap_Inward(absNoteIndex, params) {
  let ni = absNoteIndex % params.heldNotes.length;
  // morph ni to our pattern.
  if (ni & 1) {
    ni = -1 - (ni - 1) / 2;// odd
  } else {
    ni /= 2;// even.
  }
  return ni;
}


function MappingFunction_Inward(params) {
  return MappingFunction_ArpGeneric(params, IndexMap_Inward);
}


function IndexMap_Outward(absNoteIndex, params) {
  let ni = absNoteIndex % params.heldNotes.length;
  ni = params.heldNotes.length - 1 - ni;
  return IndexMap_Inward(ni, params);
}

function MappingFunction_Outward(params) {
  return MappingFunction_ArpGeneric(params, IndexMap_Outward);
}


// 0 1 2 3 4 5  |len=6
// 0         1
//   2     3
//     4 5
//   6     7    |period=8

// 0 1 2 3 4
// 0       1
//   2   3
//     4
//   5   6

// eh, todo.
// function IndexMap_InwardOutward(absNoteIndex, params) {
// }

// function MappingFunction_InwardOutward(params) {
//   return MappingFunction_ArpGeneric(params, IndexMap_InwardOutward);
// }





/////////////////////////////////////////////////////////////////////////////////////////////////////////
class InstrumentSequencerPlayer {
  constructor(roomPlayer, roomState, instrument) {
    this.roomPlayer = roomPlayer;
    this.roomState = roomState;
    this.metronome = roomState.metronome;
    this.quantizer = roomState.quantizer;
    this.timer = null;
    this.instrument = instrument;
    this.noteTracker = new DFMusic.HeldNoteTracker();
    this.autoLatchingNoteTracker = new DFMusic.AutoLatchingHeldNoteTracker();

    this.divMappers = {};

    this.divMappers["ArpMap_Seq"] = MappingFunction_Seq;
    this.divMappers["ArpMap_TranspSeq"] = MappingFunction_TranspSeq;
    this.divMappers["ArpMap_ChordScale"] = MappingFunction_ChordScale;
    this.divMappers["ArpMap_TranspChordScale"] = MappingFunction_TranspChordScale;
    this.divMappers["ArpMap_AsPlayed"] = MappingFunction_AsPlayed;
    this.divMappers["ArpMap_ArpUp"] = MappingFunction_XUp;
    this.divMappers["ArpMap_ArpDown"] = MappingFunction_XDown;
    this.divMappers["ArpMap_ArpUpDown"] = MappingFunction_XUpDown;
    this.divMappers["ArpMap_Random"] = MappingFunction_Random;
    this.divMappers["ArpMap_Spread"] = MappingFunction_Spread;
    this.divMappers["ArpMap_ArpInward"] = MappingFunction_Inward;
    this.divMappers["ArpMap_ArpOutward"] = MappingFunction_Outward;
    //this.divMappers["ArpMap_ArpInOut"] = MappingFunction_InwardOutward;
    this.divMappers["ArpMap_FillUp"] = MappingFunction_FillUp;
    this.divMappers["ArpMap_FillDown"] = MappingFunction_FillDown;
    
    

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
    this.autoLatchingNoteTracker.AllNotesOff();
    //this.#invokeTimer();
  }

  // return true to swallow the event
  BPMChanged(bpm) {
    this.instrument.sequencerDevice.OnBPMChanged(bpm);
    this.#invokeTimer();
  }

  // return true to swallow the event
  NoteOn(note, velocity) {
    this.noteTracker.NoteOn(note, velocity);
    this.autoLatchingNoteTracker.NoteOn(note, velocity);
    const swallow = this.instrument.sequencerDevice.OnNoteOnOffPedalUpDown(this.noteTracker);
    if (swallow) this.#invokeTimer(); // hacky but basically if a note is to be swallowed it's because we're doing something with it.
    return swallow;
  }

  // return true to swallow the event
  NoteOff(note) {
    this.noteTracker.NoteOff(note);
    this.autoLatchingNoteTracker.NoteOff(note);
    const swallow = this.instrument.sequencerDevice.OnNoteOnOffPedalUpDown(this.noteTracker);
    if (swallow) this.#invokeTimer(); // hacky but basically if a note is to be swallowed it's because we're doing something with it.
    return swallow;
  }

  PedalUp() {
    this.noteTracker.PedalUp();
    this.autoLatchingNoteTracker.PedalUp();
    const swallow = this.instrument.sequencerDevice.OnNoteOnOffPedalUpDown(this.noteTracker);
    if (swallow) this.#invokeTimer(); // hacky but basically if a note is to be swallowed it's because we're doing something with it.
    return swallow;
  }

  PedalDown() {
    this.noteTracker.PedalDown();
    this.autoLatchingNoteTracker.PedalDown();
    const swallow = this.instrument.sequencerDevice.OnNoteOnOffPedalUpDown(this.noteTracker);
    if (swallow) this.#invokeTimer(); // hacky but basically if a note is to be swallowed it's because we're doing something with it.
    return swallow;
  }

  timerProc() {
    //const start = Date.now();
    StartPerf();

    // if you call this directly, with no timer, then start interval.
    // this allows callers to invoke directly without timer, and it will restart everything.
    if (!this.timer) {
      this.timer = setInterval(() => this.timerProc(), gIntervalMS);
    }

    let playheadAbsBeat = this.metronome.getAbsoluteBeat();

    const seq = this.instrument.sequencerDevice;
    const patch = this.instrument.sequencerDevice.livePatch;
    
    const patternView = Seq.GetPatternView(patch, this.instrument.sequencerDevice.GetNoteLegend());

    if (!this.instrument.sequencerDevice.isPlaying || !this.roomState.HasJamPurpose()) {
      //console.log(`not playing; clearing data.`);
      this.quantizer.setSequencerEvents(this.roomState.roomID, this.instrument.instrumentID, [], patternView, false, null);
      RegisterPerf();
      return;
    }

    const patternPlayheadInfo = this.instrument.sequencerDevice.GetAbsQuarterInfo(playheadAbsBeat); // adjusted for patch speed
    const absPatternFloor = Math.floor(patternPlayheadInfo.absPatternFloat);
    const windowLengthMS = gIntervalMS * gChunkSizeFactor;
    const windowLengthQuarters = DFU.MSToBeats(windowLengthMS, this.metronome.getBPM()) * patch.speed; // speed-adjusted
    const windowEndShiftedQuarters = patternPlayheadInfo.shiftedAbsQuarter + windowLengthQuarters;     // speed-adjusted

    const latchMode = seq.GetLatchMode(this.roomState);
    let heldNotes = this.roomPlayer.GetHeldNotesForInstrumentID(seq.listeningToInstrumentID, latchMode.id);
    if (!heldNotes) {
      heldNotes = (latchMode.id === 'LMAuto') ? this.autoLatchingNoteTracker : this.noteTracker;
    }

    let divMappingFunction = this.divMappers[seq.GetArpMapping().id];
    if (!divMappingFunction) {
      console.log(`!! Unsupported mapping style ${seq.GetArpMapping().id}`);
      RegisterPerf();
      return;
    }

    const heldNotesByNoteValue = heldNotes.heldNotesByNoteValue;
    const lowestNoteValue = heldNotes.lowestNoteValue;
    //console.log(`==== scheduling. heldnotes = ${JSON.stringify(heldNotesByNoteValue)}`);

    //console.log(`using seq mapping mode ${seq.GetLatchMode().id }`);

    if ((heldNotesByNoteValue.length === 0) && seq.GetArpMapping().swallowNotes && (seq.GetPlaySequenceWhenIdle())) {
      divMappingFunction = MappingFunction_Seq;
    }

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
          lowestNoteValue,
          div,
          patch,
          seq,
          absPatternFloor: tempAbsPatternFloor,
          patternView
        });

        //console.log(`Mapping result: ` + JSON.stringify(divEvents));
        // we want to avoid scheduling duplicate notes as well.
        const noteValuesScheduled = new Array(128);
        const absQuarter = cursorShiftedQuarter / patch.speed;
        for (let ievent = 0; ievent < divEvents.length; ++ ievent) {
          const e = divEvents[ievent];
          if (noteValuesScheduled[e.midiNoteValue]) {
            //console.log(`skipping dupe note ${JSON.stringify(e)}`);
            continue;
          }
          noteValuesScheduled[e.midiNoteValue] = e;
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
    if (events.length) {
      seq.RegisterPlayingActivity();
    }

    this.quantizer.setSequencerEvents(this.roomState.roomID, this.instrument.instrumentID, events, patternView, true);
    RegisterPerf();
  }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////

class RoomSequencerPlayer {
  constructor(roomState) {
    this.roomState = roomState;
    this.metronome = roomState.metronome;
    this.quantizer = roomState.quantizer;

    this.instruments = this.roomState.instrumentCloset;//.filter(i => i.allowSequencer); // precalc a list of relevant instruments
    this.instrumentPlayers = new Map();                                               // map instrumentID to a held note tracker.
    this.instruments.forEach(inst => {
      this.instrumentPlayers.set(inst.instrumentID, new InstrumentSequencerPlayer(this, roomState, inst));
    });
  }

  GetHeldNotesForInstrumentID(instrumentID, latchModeID) {
    if (this.instrumentPlayers.has(instrumentID)) {
      return (latchModeID === 'LMAuto' || latchModeID === 'LMAutoSeq') ?
        this.instrumentPlayers.get(instrumentID).autoLatchingNoteTracker
        : this.instrumentPlayers.get(instrumentID).noteTracker;
    }
    return null;
  }

  InvalidateDependentSequencers(instrument) {
    this.instruments.forEach(i => { // invalidate dependent sequencers
      if (!i.IsSequencerSidechainedTo(instrument)) return;
      this.onChanged_Instrument(i);
    });
  }


  BPMChanged(bpm) {
    this.instrumentPlayers.forEach(player => player.BPMChanged(bpm));
  }

  AllNotesOff(instrument) {
    this.instrumentPlayers.get(instrument.instrumentID).AllNotesOff();
  }

  // return true to swallow the event
  NoteOn(instrument, note, velocity) {
    this.InvalidateDependentSequencers(instrument);
    return this.instrumentPlayers.get(instrument.instrumentID).NoteOn(note, velocity);
  }

  // return true to swallow the event
  NoteOff(instrument, note) {
    this.InvalidateDependentSequencers(instrument);
    return this.instrumentPlayers.get(instrument.instrumentID).NoteOff(note);
  }

  PedalUp(instrument) {
    this.InvalidateDependentSequencers(instrument);
    this.instrumentPlayers.get(instrument.instrumentID).PedalUp();
  }

  PedalDown(instrument) {
    this.InvalidateDependentSequencers(instrument);
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
