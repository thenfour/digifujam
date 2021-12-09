
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
        this.intervalCookie = setTimeout(() => { this.timerProc(); }, interval);
    }

    resetTimer() {
        if (this.intervalCookie) {
            clearTimeout(this.intervalCookie);
        }
        this.scheduleNextTick();
    }

    timerProc() {
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
    getLiveQuantizedEventTiming(userPingMS, quantizeSpec) {
        let unquantizedBeat = this.metronome.getAbsoluteBeat();
        unquantizedBeat -= DF.MSToBeats(userPingMS / 2, this.metronome.getBPM());// adjust user's one-way latency. this is our best guess when the user intended the note.
        
        // quantization segment
        let quantizationSegmentPos = DF.getDecimalPart(unquantizedBeat * quantizeSpec.beatDivision);
        let playQuantized = quantizationSegmentPos > quantizeSpec.quantizeBoundary;
        let discard = !playQuantized && (quantizationSegmentPos > quantizeSpec.swallowBoundary);

        let quantizedBeat = DF.dividedCeil(unquantizedBeat, quantizeSpec.beatDivision);

        // lerp using amt.
        quantizedBeat = DF.lerp(unquantizedBeat, quantizedBeat, quantizeSpec.quantizeAmt);

        let quantizedFrame = beatToFrame(quantizedBeat, this.metronome.getBPM());
        return {
            unquantizedBeat,
            quantizedBeat,
            quantizedFrame,
            discard,
            playQuantized,
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

    onLiveNoteOn(userID, userPingMS, instrumentID, note, velocity, quantizeSpec) {
        let notePacket = {
            userID,
            instrumentID,
            note,
            velocity,
        };
        if (quantizeSpec.beatDivision == 0) {
            // no quantization. play it live.
            this.noteEventsFlushRoutine([notePacket], []);
            return;
        }

        // where SHOULD the note fall, based on beatDivision.
        let eventInfo = this.getLiveQuantizedEventTiming(userPingMS, quantizeSpec);
        if (eventInfo.discard) { // should be discarded entirely.
            return;
        }
        if (!eventInfo.playQuantized) {
            // play it unquantized per spec.
            this.noteEventsFlushRoutine([notePacket], []);
            return;
        }
        eventInfo.notePacket = notePacket;

        // important to not have duplicate notes in the queue, otherwise corresponding note offs can get misplaced.
        this.clearNoteOn(userID, instrumentID, note);

        this.allQueuedNoteOns.push(eventInfo);
        this.scheduleEvent(eventInfo.quantizedFrame, notePacket, null, eventInfo);
    }

    onLiveNoteOff(userID, userPingMS, instrumentID, note, quantizeSpec) {
        let noteOffPacket = {
            userID,
            instrumentID,
            note,
        };

        // console.log(`note off:`);
        // console.log(`  -> allQueuedNoteOns: ${JSON.stringify(this.allQueuedNoteOns)} `);

        // find the original note, measure the duration.
        let correspondingNoteOn = this.allQueuedNoteOns.find(n => n.notePacket.userID == userID && n.notePacket.instrumentID == instrumentID && n.notePacket.note == note);
        if (!correspondingNoteOn || quantizeSpec.beatDivision == 0) {
            // if not found, just send the note off live.
            // console.log(`  -> note on not found. fuck it weré goin live`);
            this.noteEventsFlushRoutine([], [noteOffPacket]);
            return;
        }

        // where SHOULD the event fall, based on beatDivision.
        let eventInfo = this.getLiveQuantizedEventTiming(userPingMS, quantizeSpec);
        // note offs never discarded.

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

