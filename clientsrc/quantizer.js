
const DF = require('./dfutil');

// use a "frame" to indicate a very small slice of musical time, so we can deal in integers.
// as opposed to like, milliseconds which are +/- too much, or beat fractions which run into
// floating point errors. this allows us to KEY off of a musical time.
const FrameDurationMS = 12;
let MSToFrame = (ms) => {
    return Math.floor(ms / FrameDurationMS);
};
let beatToFrame = (beat, BPM) => {
    return MSToFrame(DF.BeatsToMS(beat, BPM));
};
let FrameToMS = f => {
    return f * FrameDurationMS;
};

// per ROOM
// keep BPM and beat info for the room on the server.
class ServerRoomMetronome {
    constructor() {
        this.rootTime = new Date();
        this.BPM = 95; // BPM is when denom = 4.
        this.beatRoutine = () => { };
        this.intervalCookie = null;
    }

    scheduleNextTick() {
        // interval = ms till next beat.
        // next beat is 1. - current beat fraction
        let interval = this.getAbsoluteBeat();
        interval = 1.0 - DF.getDecimalPart(interval);
        // if we're aaaalmost at the end of the beat, give some leeway.
        if (interval < 0.01) interval ++;
        interval = DF.BeatsToMS(interval, this.BPM);

        this.intervalCookie = setTimeout(() => { this.timerProc(); }, interval);
    }

    resetTimer() {
        if (this.intervalCookie) {
            clearTimeout(this.intervalCookie);
        }
        this.scheduleNextTick();
    }

    timerProc() {
        this.beatRoutine();
        this.scheduleNextTick();
    }

    setBeatRoutine(routine) {
        this.beatRoutine = routine;
        this.resetTimer();
    }

    getBPM() {
        return this.BPM;
    }

    setBPM(newBPM) {
        // make it smoothly modulated; "now" should finish out the current beat.
        // so, make the new root time (now - current beat fraction * new bpm)
        let b = this.getAbsoluteBeat();
        let ms = DF.BeatsToMS(b, newBPM);
        this.rootTime = new Date() - ms;
        this.BPM = newBPM;
        this.resetTimer();
    }

    getAbsoluteBeat() {
        const absTimeMS = (new Date() - this.rootTime);
        const absoluteBeat = DF.MSToBeats(absTimeMS, this.BPM);
        return absoluteBeat;
    }
};

// per ROOM.
class ServerRoomQuantizer {

    constructor(metronome) {
        this.metronome = metronome;
        this.noteEventsFlushRoutine = (noteOns, noteOffs) => { };

        this.queuedFrames = {}; // key is musical frame
        this.allQueuedNoteOns = []; // 
    }

    setNoteEventsRoutine(routine) {
        this.noteEventsFlushRoutine = routine;
    }

    onInterval(quantizedFrame) {
        // if (!(quantizedFrame in this.queuedFrames)) {
        //     console.log(`quantized frame ${quantizedFrame} not in queue`);
        // }
        let frame = this.queuedFrames[quantizedFrame];
        this.noteEventsFlushRoutine(frame.noteOns, frame.noteOffs);
        // console.log(`Executed quantization frame ${quantizedFrame}: ${JSON.stringify(frame)}; now deleting it.`);
        delete this.queuedFrames[quantizedFrame];
        frame.noteOns.forEach(
            played => {
                //this.clearNote(played.userID, played.instrumentID, played.note);
                this.allQueuedNoteOns.removeIf(n => n.notePacket.userID == played.userID && n.notePacket.instrumentID == played.instrumentID && n.notePacket.note == played.note);
            }
        );

        // let qf = Object.keys(this.queuedFrames).map(k => {
        //     return {
        //         frame:k,
        //         noteOns: this.queuedFrames[k].noteOns,
        //         noteOffs: this.queuedFrames[k].noteOffs,
        //     };
        // });

        // console.log(` -> now queuedframes:${JSON.stringify(qf)}`);
        // console.log(` -> and allQueuedNoteOns: ${JSON.stringify(this.allQueuedNoteOns)}`);
    }

    // assuming an event happened NOW, calculate relevant timings
    getLiveQuantizedEventTiming(userPingMS, beatDivision) {
        let unquantizedBeat = this.metronome.getAbsoluteBeat();
        unquantizedBeat -= DF.MSToBeats(userPingMS / 2, this.metronome.getBPM());// adjust user's one-way latency. this is our best guess when the user intended the note.
        let quantizedBeat = DF.dividedCeil(unquantizedBeat, beatDivision);
        let quantizedFrame = beatToFrame(quantizedBeat, this.metronome.getBPM());
        return {
            unquantizedBeat,
            quantizedBeat,
            quantizedFrame
        };
    }

    scheduleEvent(quantizedFrame, noteOn, noteOff, context) {
        // now start the timer if it doesn't exist.
        // if (noteOn) {
        //     console.log(`scheduling noteOn to frame ${quantizedFrame} ${JSON.stringify(context)}. NOWabsbeat=${this.metronome.getAbsoluteBeat()}`);
        // }
        // if (noteOff) {
        //     console.log(`scheduling noteOff to frame ${quantizedFrame} ${JSON.stringify(context)}. NOWabsbeat=${this.metronome.getAbsoluteBeat()}`);
        // }
        if (quantizedFrame in this.queuedFrames) {
            if (noteOn) this.queuedFrames[quantizedFrame].noteOns.push(noteOn);
            if (noteOff) this.queuedFrames[quantizedFrame].noteOffs.push(noteOff);
            return;
        }

        let msRemaining = FrameToMS(quantizedFrame) - DF.BeatsToMS(this.metronome.getAbsoluteBeat(), this.metronome.getBPM());
        if (msRemaining < 0) msRemaining = 0;

        let timerCookie = setTimeout(() => { this.onInterval(quantizedFrame); },
            msRemaining);

        this.queuedFrames[quantizedFrame] = {
            timerCookie,
            noteOns: noteOn ? [noteOn] : [],
            noteOffs: noteOff ? [noteOff] : [],
        };
    }

    /*
    how we can deal with ping:
    - pingMS is round trip. so in theory it's about pingMS/2 since they sent the message.
    - we should also smooth it out to avoid spikes
    - we should probably limit the amount of drift.
    */

    onLiveNoteOn(userID, userPingMS, instrumentID, note, velocity, beatDivision) {
        let notePacket = {
            userID,
            instrumentID,
            note,
            velocity,
        };
        if (beatDivision == 0) {
            // no quantization. play it live.
            this.noteEventsFlushRoutine([notePacket], []);
            return;
        }

        // where SHOULD the note fall, based on beatDivision.
        let eventInfo = this.getLiveQuantizedEventTiming(userPingMS, beatDivision);
        eventInfo.notePacket = notePacket;

        // important to not have duplicate notes in the queue, otherwise corresponding note offs can get misplaced.
        this.clearNoteOn(userID, instrumentID, note);

        this.allQueuedNoteOns.push(eventInfo);
        this.scheduleEvent(eventInfo.quantizedFrame, notePacket, null, eventInfo);
    }

    onLiveNoteOff(userID, userPingMS, instrumentID, note, beatDivision) {
        let noteOffPacket = {
            userID,
            instrumentID,
            note,
        };

        // console.log(`note off:`);
        // console.log(`  -> allQueuedNoteOns: ${JSON.stringify(this.allQueuedNoteOns)} `);

        // find the original note, measure the duration.
        let correspondingNoteOn = this.allQueuedNoteOns.find(n => n.notePacket.userID == userID && n.notePacket.instrumentID == instrumentID && n.notePacket.note == note);
        if (!correspondingNoteOn || beatDivision == 0) {
            // if not found, just send the note off live.
            // console.log(`  -> note on not found. fuck it weré goin live`);
            this.noteEventsFlushRoutine([], [noteOffPacket]);
            return;
        }

        // where SHOULD the event fall, based on beatDivision.
        let eventInfo = this.getLiveQuantizedEventTiming(userPingMS, beatDivision);
        // console.log(`  -> note off eventInfo ${JSON.stringify(eventInfo)}`);
        // console.log(`  -> corresp noteon:${JSON.stringify(correspondingNoteOn)}`);

        // length of the note as intended by the player...
        let beatLength = eventInfo.unquantizedBeat - correspondingNoteOn.unquantizedBeat;
        eventInfo.quantizedBeat = correspondingNoteOn.quantizedBeat + beatLength;
        eventInfo.quantizedFrame = beatToFrame(eventInfo.quantizedBeat, this.metronome.getBPM());
        // console.log(`  -> LEN=${beatLength} beats`);

        this.scheduleEvent(eventInfo.quantizedFrame, null, noteOffPacket, eventInfo);
    }

    clearNoteOn(userID, instrumentID, note) {
        Object.keys(this.queuedFrames).forEach(k => {
            this.queuedFrames[k].noteOns.removeIf(f => f.instrumentID == instrumentID && f.userID == userID && f.note == note);
            //this.queuedFrames[k].noteOffs.removeIf(f => f.instrumentID == instrumentID && f.userID == userID && f.note == note);
        });

        this.allQueuedNoteOns.removeIf(n => n.notePacket.userID == userID && n.notePacket.instrumentID == instrumentID && n.notePacket.note == note);
    }

    clearInstrument(instrumentID) {
        Object.keys(this.queuedFrames).forEach(k => {
            this.queuedFrames[k].noteOns.removeIf(f => f.instrumentID == instrumentID);
            this.queuedFrames[k].noteOffs.removeIf(f => f.instrumentID == instrumentID);
        });

        this.allQueuedNoteOns.removeIf(n => n.notePacket.instrumentID == instrumentID);
    }

    clearUser(userID) {
        Object.keys(this.queuedFrames).forEach(k => {
            this.queuedFrames[k].noteOns.removeIf(f => f.userID == userID);
            this.queuedFrames[k].noteOffs.removeIf(f => f.userID == userID);
        });

        this.allQueuedNoteOns.removeIf(n => n.notePacket.userID == userID);
    }

};


module.exports = {
    ServerRoomMetronome,
    ServerRoomQuantizer,
};

