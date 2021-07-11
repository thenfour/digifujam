
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

class MusicalTime {
    constructor(bpm, measureInt, measureBeatFloat) {
        this.bpm = bpm; // from server

        this.measureInt = measureInt;
        this.measureBeatFloat = measureBeatFloat; // decimal beat. So like, 0.5 means on the 1st 8th note boundary.
        this.measureBeatInt = Math.trunc(this.measureBeatFloat);
        this.measureBeatFrac = this.measureBeatFloat - this.measureBeatInt;
    }
    toString() { return this.str; }
};


// time signatures. the room has a time signature which interacts with the room BPM.
// num = numerator, denom = denominator
// beatDivs = how many metronome ticks per measure.
const FourFour = { num: 4, denom: 4, beatDivs:4, name: "4/4", id: "4_4", };
const CommonTimeSignatures = [
    { num: 3, denom: 4, beatDivs:4, name: "3/4", id: "3_4", },
    FourFour,
    { num: 5, denom: 4, beatDivs:5, name: "5/4", id: "5_4", },
    { num: 6, denom: 4, beatDivs:6, name: "6/4", id: "6_4", },
    { num: 5, denom: 8, beatDivs:1, name: "5/8", id: "5_8", },
    { num: 6, denom: 8, beatDivs:2, name: "6/8", id: "6_8", },
    { num: 7, denom: 8, beatDivs:1, name: "7/8", id: "7_8", },
    { num: 9, denom: 8, beatDivs:3, name: "9/8", id: "9_8", },
    { num: 12, denom: 8, beatDivs:4, name: "12/8", id: "12_8", },
];


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
        const ageMS = Date.now() - this.beatTime;
        let ageBeats = ageMS / (60000 / this.bpm); // beats since roomBeat message. may be >=1
        let absBeatsFloat = ageBeats + this.beat;

        // beatDivs

        // so n/4 timesigs = 1
        // and n/8 timesigs = 2
        let measureFloat = absBeatsFloat / this.timeSig.beatDivs;
        let measureInt = Math.trunc(measureFloat);

        let measureBeatFloat = (measureFloat - measureInt) * this.timeSig.num;

        return new MusicalTime(this.bpm, measureInt, measureBeatFloat);
    }
};


module.exports = {
    BeatDivisions,
    MusicalTimeTracker,
    CommonTimeSignatures,
    FourFour,
    //getBeatsPerMeasure,
    //getNumeratorsPerBeat,
};


