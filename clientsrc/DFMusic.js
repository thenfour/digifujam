const DFUtil = require('./dfutil');


let keyNote = function (midiNoteValue, name, cssClass) {
    return { midiNoteValue, name, cssClass };
};

const MidiNoteInfo = [
    keyNote(21, "A0", "white a"),
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




// this is like MIDI PPQ, parts per quarter. We want to work in integral divisions
// even while working in triplets, 5tuplets, etc. This calls for a highly composite
// number. MIDI PPQ used to be 120 standard, many DAWs up this to 480, 960, or super 
// high numbers to allow sample-accurate timing.
//
// this number works pretty well and allows triplets, 5tuplets, 7tuplets, 9tuplets, 11tuplets
// down to the 256th notes.
//
// such a high number only risks that we run out of significant bits for expressing long times.
// a signed 32-bit int can represent about 9600 beats at this resolution, which is about
// 32 minutes at 300bpm. this is more than enough for our case.
const BeatDivisions = 221760;

class TimeSig {
    constructor(params) {
        Object.assign(this, params);
    }

    // beat is 0 based; can be floating point.
    isMajorBeat(beat) {
        return Math.floor(beat)%(this.num / this.beatDivs) === 0;
    }
    isMinorBeat(beat) {
        return !this.isMajorBeat(beat);
    }
    toString() {
        return this.name;
    }
}

// time signatures. the room has a time signature which interacts with the room BPM.
// num = numerator, denom = denominator
// beatDivs = how many metronome ticks per measure.
const FourFour = new TimeSig({ num: 4, denom: 4, beatDivs:4, name: "4/4", id: "4_4", });
const CommonTimeSignatures = [
    new TimeSig({ num: 3, denom: 4, beatDivs:4, name: "3/4", id: "3_4", }),
    FourFour,
    new TimeSig({ num: 5, denom: 4, beatDivs:5, name: "5/4", id: "5_4", }),
    new TimeSig({ num: 6, denom: 4, beatDivs:6, name: "6/4", id: "6_4", }),
    new TimeSig({ num: 5, denom: 8, beatDivs:1, name: "5/8", id: "5_8", }),
    new TimeSig({ num: 6, denom: 8, beatDivs:2, name: "6/8", id: "6_8", }),
    new TimeSig({ num: 7, denom: 8, beatDivs:1, name: "7/8", id: "7_8", }),
    new TimeSig({ num: 9, denom: 8, beatDivs:3, name: "9/8", id: "9_8", }),
    new TimeSig({ num: 12, denom: 8, beatDivs:4, name: "12/8", id: "12_8", }),
];

class MusicalTime {
    constructor(bpm, measureInt, measureBeatFloat, nowMS, timeSig) {
        this.bpm = bpm; // from server
        this.nowMS = nowMS;
        this.timeSig = timeSig;

        this.measureInt = measureInt;
        this.measureBeatFloat = measureBeatFloat; // decimal beat. So like, 0.5 means on the 1st 8th note boundary.
        this.measureBeatInt = Math.trunc(this.measureBeatFloat);
        this.measureBeatFrac = this.measureBeatFloat - this.measureBeatInt;
    }
    get msSinceLastBeat() {
        return DFUtil.BeatsToMS(this.measureBeatFrac);
    }
    toString() { return `${this.measureBeatFloat.toFixed(2)}`; }
};



// client uses this to get realtime musical time. the server sends RoomBeat periodically
// and based on that we can provide continuous real-time best-guess musical time.
class MusicalTimeTracker {
    constructor() {
        this.beat = 0;
        this.beatTime = Date.now();
        this.timeSig = FourFour;
        this.bpm = 100;
    }
    onRoomBeat(bpm, beat, timeSig) {
        //beat = 401.75;
        this.bpm = bpm;
        this.beat = beat;
        this.beatTime = Date.now();
        this.timeSig = timeSig;
    }

    getCurrentMusicalTime() {
        const now = Date.now();
        const ageMS = now - this.beatTime;
        let ageBeats = ageMS / (60000 / this.bpm); // beats since roomBeat message. may be >=1
        let absBeatsFloat = ageBeats + this.beat;

        // beatDivs

        // so n/4 timesigs = 1
        // and n/8 timesigs = 2
        let measureFloat = absBeatsFloat / this.timeSig.beatDivs;
        let measureInt = Math.trunc(measureFloat);

        let measureBeatFloat = (measureFloat - measureInt) * this.timeSig.num;

        return new MusicalTime(this.bpm, measureInt, measureBeatFloat, now, this.timeSig);
    }
};


module.exports = {
    BeatDivisions,
    MusicalTimeTracker,
    CommonTimeSignatures,
    FourFour,
    TimeSig,
    MidiNoteInfo,
};


