const DFUtil = require('./dfutil');

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



class MusicalTime {
    constructor(params) {
        Object.assign(this, params);
    }
    toString() { return `${this.measureBeatFloat.toFixed(2)}`; }
};




const FourFourSpec = { id: "4_4", name: "4/4", subdivsPerBeat: 1, subdivGroups: [1,1,1,1] };

// timesig defines how BPM relate to:
// measures
// subdivisions
// subdivision grouping (like in 6/8 time, two groups of 3 subdivisions. and 5/8 time, 2+3 or 3+2.)
//
// remember that "BEAT" is NOT the same as we normally think of a beat, because that's pretty fuzzy & complex.
// in 5/8, what is a "beat"? In 7jam, a "BEAT" is a quarter note, the way timesigs are spec'd out.
// typically the metronome pulses in quarter notes
class TimeSig {
    constructor(params) {
        Object.assign(this, params);
        if (!this.id) {
            Object.assign(this, FourFourSpec);
        }
        console.assert(this.subdivGroups);
        console.assert(this.subdivsPerBeat);
        console.assert(this.name);

        this.subdivCount = this.subdivGroups.reduce((a,b)=>a+b,0);
        this.beatsPerMeasure = this.subdivCount / this.subdivsPerBeat;
        this.subdivInfo = [];
        this.subdivGroups.forEach((groupSubdivCount, groupIndex) => {
            for (var groupSubdivIndex = 0; groupSubdivIndex < groupSubdivCount; ++ groupSubdivIndex) {
                this.subdivInfo.push({
                    groupSubdivIndex,
                    measureSubdivIndex: this.subdivInfo.length,
                    isMajorSubdiv: groupSubdivIndex == 0,
                });
            }
        });
    }

    GetSubdivInfo(subdiv) {
        isubdiv = Math.floor(subdiv);
        isubdiv = DFUtil.modulo(isubdiv, this.subdivCount);
        return this.subdivInfo[isubdiv];
    }

    isMajorSubdiv(subdiv) {
        return this.GetSubdivInfo(subdiv).isMajorSubdiv;
    }

    isMinorSubDiv(subdiv) {
        return !this.isMajorSubdiv(subdiv);
    }

    BeatsToSubdivs(beats) {
        return beats * this.subdivsPerBeat;
    }

    getMusicalTimeForSubdiv(subdiv) {
        const subdivFloat = DFUtil.modulo(subdiv, this.subdivCount);
        const subdivInfo = this.GetSubdivInfo(subdivFloat);

        const measureFloat = subdivFloat / this.subdivsPerBeat;
        const measureInt = Math.floor(measureFloat);
        const measureFrac = measureFloat - measureInt;

        return new MusicalTime({
            measureFloat,
            measureInt,
            measureFrac,
            subdivFloat,
            subdivInfo,
        });
    }

    getMusicalTimeForBeat(beat) {
        const measureFloat = beat / this.beatsPerMeasure; // -.5 / 4 = -.125
        const measureInt = Math.floor(measureFloat); // beat -.5 = -1
        const measureFrac = measureFloat - measureInt; // beat -.5 => .875
        const subdivFloat = measureFrac * this.subdivCount;
        const subdivInfo = this.GetSubdivInfo(subdivFloat);
        return new MusicalTime({
            measureFloat,
            measureInt,
            measureFrac,
            subdivFloat,
            subdivInfo,
        });
    }

    toString() {
        return this.name;
    }

}

const FourFour = new TimeSig(FourFourSpec);
const CommonTimeSignatures = [
    new TimeSig({ id: "3_4", name: "3/4", subdivsPerBeat: 1, subdivGroups: [1,1,1] }),
    FourFour,
    new TimeSig({ id: "5_4", name: "5/4", subdivsPerBeat: 1, subdivGroups: [1,1,1,1,1] }),
    new TimeSig({ id: "6_4", name: "6/4", subdivsPerBeat: 1, subdivGroups: [1,1,1,1,1,1] }),
    new TimeSig({ id: "7_4", name: "7/4", subdivsPerBeat: 1, subdivGroups: [1,1,1,1,1,1,1] }),
    new TimeSig({ id: "5_8", name: "5/8", subdivsPerBeat: 2, subdivGroups: [3,2] }),
    new TimeSig({ id: "6_8", name: "6/8", subdivsPerBeat: 2, subdivGroups: [3,3] }),
    new TimeSig({ id: "7_8", name: "7/8", subdivsPerBeat: 2, subdivGroups: [4,3] }),
    new TimeSig({ id: "9_8", name: "9/8", subdivsPerBeat: 2, subdivGroups: [3,3,3] }),
    new TimeSig({ id: "12_8", name: "12/8", subdivsPerBeat: 2, subdivGroups: [3,3,3,3] }),
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
    if (!Number.isInteger(v)) return false;
    if (v < 1) return false;
    if (v >= 127) return false;
    return true;
}

// guaranteed to always return an object
function GetTimeSigById(timeSigID) {
    const ret = CommonTimeSignatures.find(ts => ts.id === timeSigID);
    if (ret) return ret;
    return FourFour;
}

module.exports = {
    BeatDivisions,
    MusicalTimeTracker,
    CommonTimeSignatures,
    FourFour,
    TimeSig,
    MidiNoteInfo,
    isValidNoteValue,
    GetTimeSigById,
};


