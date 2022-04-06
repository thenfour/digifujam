const DFUtil = require('./dfutil');

let keyNote = function(midiNoteValue, name, cssClass) {
  return {midiNoteValue, name, cssClass};
};

// defines the keys shown on the keyboard view
const firstNoteValue = 21;
const MidiNoteInfo = [
  keyNote(firstNoteValue, "A0", "white a"),
  keyNote(22, "A#0", "black as"),
  keyNote(23, "B0", "white b"),
  keyNote(24, "C1", "white c"),
  keyNote(25, "C#1", "black cs"),
  keyNote(26, "D1", "white d"),
  keyNote(27, "D#1", "black ds"),
  keyNote(28, "E1", "white e"),
  keyNote(29, "F1", "white f"),
  keyNote(30, "F#1", "black fs"),
  keyNote(31, "G1", "white g"),
  keyNote(32, "G#1", "black gs"),

  keyNote(33, "A1", "white a"),
  keyNote(34, "A#1", "black as"),
  keyNote(35, "B1", "white b"),
  keyNote(36, "C2", "white c"),
  keyNote(37, "C#2", "black cs"),
  keyNote(38, "D2", "white d"),
  keyNote(39, "D#2", "black ds"),
  keyNote(40, "E2", "white e"),
  keyNote(41, "F2", "white f"),
  keyNote(42, "F#2", "black fs"),
  keyNote(43, "G2", "white g"),
  keyNote(44, "G#2", "black gs"),

  keyNote(45, "A2", "white a"),
  keyNote(46, "A#2", "black as"),
  keyNote(47, "B2", "white b"),
  keyNote(48, "C3", "white c"),
  keyNote(49, "C#3", "black cs"),
  keyNote(50, "D3", "white d"),
  keyNote(51, "D#3", "black ds"),
  keyNote(52, "E3", "white e"),
  keyNote(53, "F3", "white f"),
  keyNote(54, "F#3", "black fs"),
  keyNote(55, "G3", "white g"),
  keyNote(56, "G#3", "black gs"),

  keyNote(57, "A3", "white a"),
  keyNote(58, "A#3", "black as"),
  keyNote(59, "B3", "white b"),
  keyNote(60, "C4", "white c"),
  keyNote(61, "C#4", "black cs"),
  keyNote(62, "D4", "white d"),
  keyNote(63, "D#4", "black ds"),
  keyNote(64, "E4", "white e"),
  keyNote(65, "F4", "white f"),
  keyNote(66, "F#4", "black fs"),
  keyNote(67, "G4", "white g"),
  keyNote(68, "G#4", "black gs"),

  keyNote(69, "A4", "white a"),
  keyNote(70, "A#4", "black as"),
  keyNote(71, "B4", "white b"),
  keyNote(72, "C5", "white c"),
  keyNote(73, "C#5", "black cs"),
  keyNote(74, "D5", "white d"),
  keyNote(75, "D#5", "black ds"),
  keyNote(76, "E5", "white e"),
  keyNote(77, "F5", "white f"),
  keyNote(78, "F#5", "black fs"),
  keyNote(79, "G5", "white g"),
  keyNote(80, "G#5", "black gs"),

  keyNote(81, "A5", "white a"),
  keyNote(82, "A#5", "black as"),
  keyNote(83, "B5", "white b"),
  keyNote(84, "C6", "white c"),
  keyNote(85, "C#6", "black cs"),
  keyNote(86, "D6", "white d"),
  keyNote(87, "D#6", "black ds"),
  keyNote(88, "E6", "white e"),
  keyNote(89, "F6", "white f"),
  keyNote(90, "F#6", "black fs"),
  keyNote(91, "G6", "white g"),
  keyNote(92, "G#6", "black gs"),

  keyNote(93, "A6", "white a"),
  keyNote(94, "A#6", "black as"),
  keyNote(95, "B6", "white b"),
  keyNote(96, "C7", "white c"),
  keyNote(97, "C#7", "black cs"),
  keyNote(98, "D7", "white d"),
  keyNote(99, "D#7", "black ds"),
  keyNote(100, "E7", "white e"),
  keyNote(101, "F7", "white f"),
  keyNote(102, "F#7", "black fs"),
  keyNote(103, "G7", "white g"),
  keyNote(104, "G#7", "black gs"),

  keyNote(105, "A7", "white a"),
  keyNote(106, "A#7", "black as"),
  keyNote(107, "B7", "white b"),
  keyNote(108, "C8", "white c"),
  // keyNote(109, "C#8", "black cs"),
  // keyNote(110, "D8", "white d"),
  // keyNote(111, "D#8", "black ds"),
  // keyNote(112, "E8", "white e"),
  // keyNote(113, "F8", "white f"),
  // keyNote(114, "F#8", "black fs"),
  // keyNote(115, "G8", "white g"),
  // keyNote(116, "G#8", "black gs"),

  // keyNote(117, "A8", "white a"),
  // keyNote(118, "A#8", "black as"),
  // keyNote(119, "B8", "white b"),
  // keyNote(120, "C9", "white c"),
  // keyNote(121, "C#9", "black cs"),
  // keyNote(122, "D9", "white d"),
  // keyNote(123, "D#9", "black ds"),
  // keyNote(124, "E9", "white e"),
  // keyNote(125, "F9", "white f"),
  // keyNote(126, "F#9", "black fs"),
  // keyNote(127, "G9", "white g"),
];

function GetMidiNoteInfo(noteValue) {
  return MidiNoteInfo.at(noteValue - firstNoteValue);
}

const FourFourSpec = {
  id : "4_4",
  name : "4/4",
  minorBeatsPerQuarter : 1,
  minorBeatGroups : [ 1, 1, 1, 1 ]
};

// timesig defines how BPM relate to:
// measures
// majorbeats
// minorbeats (like in 6/8 time, two groups (aka major beats) of 3 minor beats. and 5/8 time, 2+3 or 3+2.)
//
// "BEAT" is NOT the same as we normally think of a beat, because that's pretty fuzzy & complex.
// in 5/8, what is a "beat"? In 7jam, a "BEAT" is a quarter note, the way timesigs are spec'd out.
// typically the metronome pulses in quarter notes
class TimeSig {
  toJSON() {
    return {
      id : this.id,
      name : this.name,
      minorBeatsPerQuarter : this.minorBeatsPerQuarter,
      minorBeatGroups : this.minorBeatGroups,
    };
  }
  constructor(params) {
    Object.assign(this, params);
    if (!this.id) {
      Object.assign(this, FourFourSpec);
    }
    console.assert(this.minorBeatGroups);
    console.assert(this.minorBeatsPerQuarter);
    console.assert(this.name);

    this.majorBeatsPerMeasure = this.minorBeatGroups.length;                     // NOT EQUAL length
    this.minorBeatsPerMeasure = this.minorBeatGroups.reduce((a, b) => a + b, 0); // EQUAL length
    this.quartersPerMeasure = this.minorBeatsPerMeasure / this.minorBeatsPerQuarter;

    this.minorBeatInfo = this.getMinorBeatInfo();

    // create major beat info as well. so when subdividing by major beats we have info like above.
    this.majorBeatInfo = [...new Array(this.majorBeatsPerMeasure) ];
    this.minorBeatInfo.forEach(minbi => {
      let majbi = this.majorBeatInfo[minbi.majorBeatIndex];
      if (!majbi) {
        majbi = {
          minorBeats : [],
          beginMeasureFrac : 2,
          endMeasureFrac : -1,
          index : minbi.majorBeatIndex,
        };
        this.majorBeatInfo[minbi.majorBeatIndex] = majbi;
      }
      majbi.minorBeats.push(minbi);
      majbi.beginMeasureFrac = Math.min(majbi.beginMeasureFrac, minbi.beginMeasureFrac);
      majbi.endMeasureFrac = Math.max(majbi.endMeasureFrac, minbi.endMeasureFrac);
    });
  }

  getMeasureFracForAbsQuarter(quarter) {
    return DFUtil.getDecimalPart(quarter / this.quartersPerMeasure);
  }

  getMinorBeatInfo() {
    let iMinorBeatOfMeasure = 0;
    const minorBeatInfo = [];
    this.minorBeatGroups.forEach((minorBeatCount, majorBeatIndex) => {
      for (var iMinorBeat = 0; iMinorBeat < minorBeatCount; ++iMinorBeat) {
        minorBeatInfo.push({
          // for maintainability only return what's actually needed.
          majorBeatIndex,
          beginMeasureFrac : iMinorBeatOfMeasure / this.minorBeatsPerMeasure,
          endMeasureFrac : (iMinorBeatOfMeasure + 1) / this.minorBeatsPerMeasure,
          minorBeatOfMajorBeat : iMinorBeat,
          minorBeatOfMeasure : iMinorBeatOfMeasure,
          isMajorBeatBoundary : iMinorBeat === 0,
          beginMeasureMajorBeat : majorBeatIndex + (iMinorBeat / minorBeatCount),
          endMeasureMajorBeat : majorBeatIndex + ((iMinorBeat + 1) / minorBeatCount),
        });
        iMinorBeatOfMeasure++;
      }
    });
    return minorBeatInfo;
  }


  toString() {
    return this.name;
  }
}

const FourFour = new TimeSig(FourFourSpec);
const CommonTimeSignatures = [
  new TimeSig({id : "1_4", name : "1/4", minorBeatsPerQuarter : 1, minorBeatGroups : [ 1 ]}),
  new TimeSig({id : "2_4", name : "2/4", minorBeatsPerQuarter : 1, minorBeatGroups : [ 1, 1 ]}),
  new TimeSig({id : "3_4", name : "3/4", minorBeatsPerQuarter : 1, minorBeatGroups : [ 1, 1, 1 ]}),
  FourFour,
  new TimeSig({id : "5_4", name : "5/4", minorBeatsPerQuarter : 1, minorBeatGroups : [ 1, 1, 1, 1, 1 ]}),
  new TimeSig({id : "6_4", name : "6/4", minorBeatsPerQuarter : 1, minorBeatGroups : [ 1, 1, 1, 1, 1, 1 ]}),
  new TimeSig({id : "7_4", name : "7/4", minorBeatsPerQuarter : 1, minorBeatGroups : [ 1, 1, 1, 1, 1, 1, 1 ]}),
  new TimeSig({id : "5_8", name : "5/8", minorBeatsPerQuarter : 2, minorBeatGroups : [ 3, 2 ]}),
  new TimeSig({id : "6_8", name : "6/8", minorBeatsPerQuarter : 3, minorBeatGroups : [ 3, 3 ]}),
  new TimeSig({id : "7_8", name : "7/8", minorBeatsPerQuarter : 2, minorBeatGroups : [ 4, 3 ]}),
  new TimeSig({id : "9_8", name : "9/8", minorBeatsPerQuarter : 3, minorBeatGroups : [ 3, 3, 3 ]}),
  new TimeSig({id : "12_8", name : "12/8", minorBeatsPerQuarter : 3, minorBeatGroups : [ 3, 3, 3, 3 ]}),
];

// client uses this to get realtime musical time. the server sends RoomBeat periodically
// and based on that we can provide continuous real-time best-guess musical time.
class MusicalTimeTracker {
  constructor() {
    this.beat = 0;
    this.beatTime = Date.now();
    this.bpm = 100;
  }
  onRoomBeat(bpm, beat) {
    //beat = 401.75;
    this.bpm = bpm;
    this.beat = beat;
    this.beatTime = Date.now();
  }

  getAbsoluteBeatFloat() {
    const now = Date.now();
    const ageMS = now - this.beatTime;
    let ageBeats = ageMS / (60000 / this.bpm); // beats since roomBeat message. may be >=1
    let absBeatsFloat = ageBeats + this.beat;
    return absBeatsFloat;
  }
};

function isValidNoteValue(v) {
  if (!Number.isInteger(v))
    return false;
  if (v < 1)
    return false;
  if (v >= 127)
    return false;
  return true;
}

// guaranteed to always return an object
function GetTimeSigById(timeSigID) {
  const ret = CommonTimeSignatures.find(ts => ts.id === timeSigID);
  if (ret)
    return ret;
  return FourFour;
}

// https://www.desmos.com/calculator/qqoyyvutsj
// x is a value from 0-1
// swing amt is 0 to 1, representing the new location of the halfway mark. .5 means no swing is applied.
function ApplySwingToValue01(x, s) {
    if (x < s) return x / (2 * s);
    return ((x - 1) / (2 - 2 * s)) + 1;
}

function RemoveSwingFromValue01(x, s) {
  if (x < .5) return x * 2 * s;
  return (1-s)*(2*x-2)+1;
}

// https://www.desmos.com/calculator/jh2voouisu
// takes a straight beat value (x), and a swing value -1 to 1,
// and returns the location of the beat in straight time.
// it's effectively the inverse of the above function (.5)
// for convenience of callers S is -1 to 1
function ApplySwingToValueFrac(x, sN11) {
  // scale s into 0-1 range to be compatible
  let s = sN11 + 1; // 0-2
  s /= 2; // 0-1
  //s = 1 - s; // this inverts the range.
  const integral = Math.floor(x);
  const fractional = x - integral;
  return integral + RemoveSwingFromValue01(fractional, s);
}


// this tracks which notes are currently held.
// does not ref count notes, so if you press C4 twice, then release once, it will be considered OFF.
class HeldNoteTracker {
  constructor() {
    this.AllNotesOff();
  }

  AllNotesOff() {
    this.pedalDown = false;
    this.notesOn = [];
  }

  NoteOn(note, velocity) {
    console.assert(Number.isInteger(note));
    const existing = this.notesOn.find(o => o.note === note);
    if (existing) {
      existing.velocity = velocity;
      existing.physicallyHeld = true;
      existing.timestamp = Date.now();
      return;
    }
    this.notesOn.push({
      note,
      velocity,
      timestamp: Date.now(),
      physicallyHeld: true,
    });
  }

  NoteOff(note) {
    console.assert(Number.isInteger(note));
    const existingIndex = this.notesOn.findIndex(o => o.note === note);
    if (existingIndex === -1) return; // huh?
    if (this.pedalDown) {
      this.notesOn[existingIndex].physicallyHeld = false;
      return;
    }
    this.notesOn.splice(existingIndex, 1);
  }

  PedalUp() {
    this.pedalDown = false;
    // note off all notes which are playing but not physically held down
    //this.notesOn = new Set([...this.notesOn ].filter(playingNote => this.physicallyHeld.has(playingNote)));
    this.notesOn.removeIf(n => !n.physicallyHeld);
  }

  PedalDown() {
    this.pedalDown = true;
  }

  get heldNotesByNoteValue() {
    return this.notesOn.sort((a, b) => a.note - b.note);
  }

  get lowestNoteValue() {
    if (this.notesOn.length === 0) return null;
    let minval = this.notesOn[0].note;
    for (let i = 1; i < this.notesOn.length; ++ i) {
      if (this.notesOn[i].note < minval) {
        minval = this.notesOn[i].note;
      }
    }
    return minval;
  }

  get lastNoteOn() {
    if (this.notesOn.length === 0) return null;
    let maxval = this.notesOn[0].timestamp;
    let maxobj = this.notesOn[0];
    for (let i = 1; i < this.notesOn.length; ++ i) {
      let o = this.notesOn[i];
      if (o.timestamp > maxval) {
        maxval = o.timestamp;
        maxobj = o;
      }
    }
    return maxobj;
  }

  toString(prefix) {
    return `todo HeldNoteTracker toString`;
    //return `${prefix ?? ""} playing:[${[...this.notesOn].join(",")}], physicallyheld:[[${[...this.physicallyHeld].join(",")}]] ${this.pedalDown ? "pedal down" : ""}`;
  }
};





// tracks which notes are held, specifically for use with the sequencer in an arpeggiator mode, with "auto latch".
// see https://github.com/thenfour/digifujam/issues/266
// pedal is ignored. notes are either "held" or "latched".
// when you release a note, it stays "latched".
// when you press a note which is currently latched, that 1 note is released.
// when you press a note which is not currently latched, latched notes are released (held notes remain held)
class AutoLatchingHeldNoteTracker {
  constructor() {
    this.AllNotesOff();

    // if you play the last latched note, it's a special case to turn all notes off.
    // but then if you're still holding it and hold other notes, bring them all back, including the one that caused the all notes off.
    // it feels intuitive even though complex.
    // and very unintuitive to be holding a note where only some of them are playing.
    this.maybeHeldNote = null;
  }

  AllNotesOff() {
    this.notesOn = [];
  }

  NoteOn(note, velocity) {
    console.assert(Number.isInteger(note));

    if (this.maybeHeldNote && this.maybeHeldNote.note !== note) {
      // there's a "maybe held note" and you pressed other keys. bring the maybeHeld Note back into playing.
      this.notesOn.push(this.maybeHeldNote);
      this.maybeHeldNote = null;
    }

    const ei = this.notesOn.findIndex(n => (!n.physicallyHeld && (n.note === note)));
    if (ei !== -1) {
      // convert a latched note to physically held note
      this.notesOn[ei].physicallyHeld = true;
      this.notesOn[ei].timestamp = Date.now();
      this.notesOn[ei].velocity = velocity;

      // this is a latched note. if it's the only note, then remove it and you'll have nothing playing.
      if (this.notesOn.length === 1) {
        this.maybeHeldNote = this.notesOn[ei];
        this.notesOn = [];
        return;
      }

      this.notesOn = this.notesOn.filter(n => n.physicallyHeld); // remove all latched notes
      return;
    }
    this.notesOn = this.notesOn.filter(n => n.physicallyHeld); // remove all latched notes
    this.notesOn.push({
      note,
      velocity,
      timestamp: Date.now(),
      physicallyHeld: true,
    });
  }

  NoteOff(note) {
    console.assert(Number.isInteger(note));
    if (this.maybeHeldNote && this.maybeHeldNote.note === note) {
      this.maybeHeldNote = null; // you released the "maybe held note"
    }
    const ei = this.notesOn.findIndex(n => (n.physicallyHeld && (n.note === note))); // existing physically held
    if (ei === -1) {
      // not currently physically held note, that you note-off?
      // can happen if you pressed this note in order to un-latch a note. you have to play it again to register it.
      return;
    }
    this.notesOn[ei].physicallyHeld = false;
  }

  PedalUp() {
  }

  PedalDown() {
  }

  get heldNotesByNoteValue() {
    return this.notesOn.sort((a, b) => a.note - b.note);
  }

  get lowestNoteValue() {
    return this.heldNotesByNoteValue.at(0)?.note;
  }
};





module.exports = {
  MusicalTimeTracker,
  CommonTimeSignatures,
  FourFour,
  TimeSig,
  MidiNoteInfo,
  isValidNoteValue,
  ApplySwingToValue01,
  ApplySwingToValueFrac,
  GetTimeSigById,
  GetMidiNoteInfo,
  HeldNoteTracker,
  AutoLatchingHeldNoteTracker,
};
