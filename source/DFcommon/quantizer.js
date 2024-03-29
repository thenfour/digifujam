const { GetMidiNoteInfo } = require('./DFMusic');
const DF = require('./dfutil');

// use a "frame" to indicate a very small slice of musical time, so we can deal in integers.
// as opposed to like, milliseconds which are +/- too much, or beat fractions which run into
// floating point errors. this allows us to KEY off of a musical time.
// frame duration really doesn't need to be too big; pretty much impossible to actually hit that limit.
// i think there's no point in going below 5ms or so, because:
// - below that it's pretty imperceptible considering network jitter
// - it's pretty much as low as you can go and still avoid jamming up the scheduler. basically allows each time slice to run between intervals.
const FrameDurationMS = 6;
let MSToFrame = (ms) => {
  return Math.floor(ms / FrameDurationMS);
};
let beatToFrame = (beat, BPM) => {
  return MSToFrame(DF.BeatsToMS(beat, BPM));
};
let FrameToMS = f => {
  return f * FrameDurationMS;
};

// per ROOM.
class ServerRoomQuantizer {

  constructor(metronome) {
    this.metronome = metronome;
    this.noteEventsFlushRoutine = (noteOns, noteOffs) => {};

    // key is musical frame
    // this is easy access to the events in a frame.
    // also this holds both NOTE ON and NOTE OFF events to be processed in a frame.
    // each value is
    // { timerCookie, noteOns, noteOffs }
    // where noteOns / noteOffs are the notePacket struct.
    //   {
    //     userID, // not used for seq
    //     instrumentID, // not used for seq
    //     seqInstrumentID, // only used for seq
    //     seqNoteID,// only for seq to track deleted notes
    //     note,
    //     velocity, // only for note on
    //   };
    this.queuedFrames = new Map();

    // holds all NOTE ON events which appear in queuedFrames, as an easy way to access them
    // to map to the corresponding note off when it comes in.
    // for sequencer this is not used because we don't need to access this info after it's been scheduled.
    // each value is
    // eventInfo
    // {
    //   unquantizedBeat, // used for LIVE notes, to calculate note duration
    //   quantizedBeat, // used for LIVE notes, to calculate note duration
    //   quantizedFrame, // required
    //   discard,// bool if the note gets swallowed by quantization (think dupes). tells caller to drop the note.
    //   playQuantized, // tells caller whether a non-discarded note was accepted, or whether caller should play it immediately.
    //   notePacket (see above)
    // }
    this.allQueuedNoteOns = [];
  }

  setNoteEventsRoutine(routine) {
    this.noteEventsFlushRoutine = routine;
  }

  onInterval = (quantizedFrame) => {
    // if (!(quantizedFrame in this.queuedFrames)) {
    //     console.log(`quantized frame ${quantizedFrame} not in queue`);
    // }
    let frame = this.queuedFrames.get(quantizedFrame);

    // frame.noteOns.forEach(n => {
    //   console.log(`@${quantizedFrame} executing NOTE ON ${GetMidiNoteInfo(n.note).name}: ${JSON.stringify(n)}`);
    // });
    // frame.noteOffs.forEach(n => {
    //   console.log(`@${quantizedFrame} executing NOTE OFF ${GetMidiNoteInfo(n.note).name}: ${JSON.stringify(n)}`);
    // });

    this.noteEventsFlushRoutine(frame.noteOns, frame.noteOffs);

    this.queuedFrames.delete(quantizedFrame);
    frame.noteOns.forEach(
        played => {
          this.allQueuedNoteOns.removeIf(n =>
                                             n.notePacket.userID === played.userID && n.notePacket.instrumentID === played.instrumentID && n.notePacket.seqInstrumentID === played.seqInstrumentID && n.notePacket.note === played.note);
        });
  }

  // assuming an event happened NOW, calculate relevant timings
  getLiveQuantizedEventTiming(userPingMS, quantizeSpec) {
    let unquantizedBeat = this.metronome.getAbsoluteBeat();
    unquantizedBeat -= DF.MSToBeats(userPingMS / 2, this.metronome.getBPM()); // adjust user's one-way latency. this is our best guess when the user intended the note.

    // quantization segment
    let quantizationSegmentPos = DF.getDecimalPart(unquantizedBeat * quantizeSpec.beatDivision);
    let playQuantized = quantizationSegmentPos > quantizeSpec.quantizeBoundary;
    let discard = !playQuantized && (quantizationSegmentPos > quantizeSpec.swallowBoundary);

    let quantizedBeat = DF.dividedCeil(unquantizedBeat, quantizeSpec.beatDivision);

    // lerp using amt.
    quantizedBeat = DF.lerp(unquantizedBeat, quantizedBeat, quantizeSpec.quantizeAmt);

    let quantizedFrame = beatToFrame(quantizedBeat, this.metronome.getBPM());
    return {
      unquantizedBeat, // only used in calculating note length (for sequencer i can skip this)
      quantizedBeat,   // same here.
      quantizedFrame,
      discard,       // tells caller to drop the note.
      playQuantized, // tells caller to play immediately.
    };
  }

  scheduleEvent(quantizedFrame, noteOn, noteOff) {
    if (this.queuedFrames.has(quantizedFrame)) {
      if (noteOn)
        this.queuedFrames.get(quantizedFrame).noteOns.push(noteOn);
      if (noteOff)
        this.queuedFrames.get(quantizedFrame).noteOffs.push(noteOff);
      return;
    }

    let msRemaining = FrameToMS(quantizedFrame) - DF.BeatsToMS(this.metronome.getAbsoluteBeat(), this.metronome.getBPM());
    if (msRemaining < 0)
      msRemaining = 0;

    let timerCookie = setTimeout(this.onInterval,
                                 msRemaining, quantizedFrame);

    this.queuedFrames.set(quantizedFrame, {
      timerCookie,
      noteOns : noteOn ? [ noteOn ] : [],
      noteOffs : noteOff ? [ noteOff ] : [],
    });
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
      seqInstrumentID : null,
      note,
      velocity,
    };
    if (quantizeSpec.beatDivision == 0) {
      // no quantization. play it live.
      this.noteEventsFlushRoutine([ notePacket ], []);
      return;
    }

    // where SHOULD the note fall, based on beatDivision.
    let eventInfo = this.getLiveQuantizedEventTiming(userPingMS, quantizeSpec);
    if (eventInfo.discard) { // should be discarded entirely.
      return;
    }
    if (!eventInfo.playQuantized) {
      // play it unquantized per spec.
      this.noteEventsFlushRoutine([ notePacket ], []);
      return;
    }
    eventInfo.notePacket = notePacket;

    // important to not have duplicate notes in the queue, otherwise corresponding note offs can get misplaced.
    this.clearNoteOn(userID, instrumentID, note);

    this.allQueuedNoteOns.push(eventInfo);
    this.scheduleEvent(eventInfo.quantizedFrame, notePacket, null);
  }

  onLiveNoteOff(userID, userPingMS, instrumentID, note, quantizeSpec) {
    let noteOffPacket = {
      userID,
      instrumentID,
      seqInstrumentID : null,
      note,
    };

    // find the original note, measure the duration.
    let correspondingNoteOn = this.allQueuedNoteOns.find(n => n.notePacket.userID == userID && n.notePacket.instrumentID == instrumentID && n.notePacket.note == note);
    if (!correspondingNoteOn || quantizeSpec.beatDivision == 0) {
      // if not found, just send the note off live.
      this.noteEventsFlushRoutine([], [ noteOffPacket ]);
      return;
    }

    // where SHOULD the event fall, based on beatDivision.
    let eventInfo = this.getLiveQuantizedEventTiming(userPingMS, quantizeSpec);
    // note offs never discarded.

    // length of the note as intended by the player...
    let beatLength = eventInfo.unquantizedBeat - correspondingNoteOn.unquantizedBeat;
    eventInfo.quantizedBeat = correspondingNoteOn.quantizedBeat + beatLength;
    eventInfo.quantizedFrame = beatToFrame(eventInfo.quantizedBeat, this.metronome.getBPM());

    this.scheduleEvent(eventInfo.quantizedFrame, null, noteOffPacket);
  }

  clearNoteOn(userID, instrumentID, note) {
    //Object.keys(this.queuedFrames).forEach(k => {
    this.queuedFrames.forEach((v, k) => {
      v.noteOns.removeIf(f => f.instrumentID == instrumentID && f.userID == userID && f.note == note);
    });
    //});

    this.allQueuedNoteOns.removeIf(n => n.notePacket.userID == userID && n.notePacket.instrumentID == instrumentID && n.notePacket.note == note);
  }

  clearInstrument(instrumentID) {
    this.queuedFrames.forEach((v, k) => {
      v.noteOns.removeIf(f => f.instrumentID == instrumentID);
      v.noteOffs.removeIf(f => f.instrumentID == instrumentID);
    });

    this.allQueuedNoteOns.removeIf(n => n.notePacket.instrumentID == instrumentID);
  }

  clearUser(userID) {
    this.queuedFrames.forEach((v, k) => {
      v.noteOns.removeIf(f => f.userID == userID);
      v.noteOffs.removeIf(f => f.userID == userID);
    });

    this.allQueuedNoteOns.removeIf(n => n.notePacket.userID == userID);
  }

  // clear scheduled sequencer events.
  // there's a scenario that we need to handle carefully.
  // when a note is currently playing, what do we do? setting the current data will simply not include this note
  //
  // Let's say this is a legit note:
  // ..........[NoteOn=============NoteOff]
  //                     ^ and we hit interval here:
  // the caller will not specify to play this note, and that's ambiguous: it means either the note is currently playing
  // or it's been deleted.
  //
  // IF the note has been deleted, then we need to generate a note off event for it,
  // if we determine it's currently playing. to know that we look at its first event and if it's a note off, then we assume it's currently playing
  //
  // so we need to know basically if the note has been deleted or not.
  // in order to do this, we save the seq note ID, and can look it up.
  setSequencerEvents(roomID, instrumentID, notes, seqPatternView, isSeqPlaying) {
    //if (instrumentID != 'fm4a') return;
    //if (roomID != 'pub') return;
    //console.log(`SetSequencerEvents begin: ${roomID} / ${instrumentID}---------------------------------------------------`);

    // we detect "treating a note mid-way" by detecting if the first event to be executed is a note off.
    // that only works if all scheduled notes NEVER overlap in timing.
    // AND that we completely ignore non-sequenced scheduled events.
    // so first set quantized frames
    for (let i = 0; i < notes.length; ++ i) {
      let n = notes[i];
      n.noteOnQuantizedFrame = beatToFrame(n.absQuarter, this.metronome.getBPM());
      n.noteOffQuantizedFrame = beatToFrame(n.absQuarter + n.lengthQuarters, this.metronome.getBPM()) - 1;
      //console.log(`Reqd sched note: ${GetMidiNoteInfo(n.midiNoteValue).name} id:${n.noteID} @on:${n.noteOnQuantizedFrame} - @off:${n.noteOffQuantizedFrame}`);
    }

    // now adjust noteoff times to avoid overlaps.
    for (let i = 0; i < notes.length; ++ i) {
      let n = notes[i];
      let noteOffQuantizedFrame = n.noteOffQuantizedFrame;
      // fix overlaps: set note end not past [subsequent note ons] [of the same note value]
      for (let i2 = 0; i2 < notes.length; ++ i2) {
        let n2 = notes[i2];
        if (i2 === i) continue;
        if (n2.midiNoteValue !== n.midiNoteValue) continue; // [of the same note value]
        if (n2.noteOnQuantizedFrame >= n.noteOnQuantizedFrame) // [subsequent note ons] -- nb: DUPE notes would also be treated here.
        noteOffQuantizedFrame = Math.min(noteOffQuantizedFrame, n2.noteOnQuantizedFrame - 1);
      }
      n.noteOffQuantizedFrame = noteOffQuantizedFrame;

      //console.log(`Adjusted sched note: ${GetMidiNoteInfo(n.midiNoteValue).name} id:${n.noteID} @on:${n.noteOnQuantizedFrame} - @off:${n.noteOffQuantizedFrame}`);
    }
    // and remove 0-length notes.
    notes = notes.filter(n => {
      const ret = (n.noteOffQuantizedFrame - n.noteOnQuantizedFrame) >= 2;
      // if (!ret) {
      //   console.log(`Removing 0-length sched note: ${GetMidiNoteInfo(n.midiNoteValue).name} id:${n.noteID} @on:${n.noteOnQuantizedFrame} - @off:${n.noteOffQuantizedFrame}`);
      // }
      return ret;
    }); // at least 2 frames duration. even that's iffy.

    // for each note value, the earliest event removed
    // basically, if the first event we remove is a note-off, then we are treating the note mid-play.
    const noteEarliestEventRemoved = {}; // key=note, value={frame,isNoteOff}

    // remove existing events for this instrument, save what was removed.
    this.queuedFrames.forEach((v, k) => {
      v.noteOns.removeIf(f => {
        if (f.seqInstrumentID !== instrumentID)
          return false;
        if (!(f.note in noteEarliestEventRemoved)) {
          noteEarliestEventRemoved[f.note] = {
            frame : k,
            isNoteOff : false,
          };
        } else {
          const e = noteEarliestEventRemoved[f.note];
          if (k < e.frame) {
            e.frame = k;
            e.isNoteOff = false;
          }
        }
        //console.log(`removing scheduled note on: ${GetMidiNoteInfo(f.note).name} @${k}`);
        return true;
      });

      v.noteOffs.removeIf(f => {
        if (f.seqInstrumentID !== instrumentID)
          return false;
        if (!(f.note in noteEarliestEventRemoved)) {
          noteEarliestEventRemoved[f.note] = {
            frame : k,
            isNoteOff : true,
            seqNoteID : f.seqNoteID,
          };
        } else {
          const e = noteEarliestEventRemoved[f.note];
          if (k < e.frame) {
            e.frame = k;
            e.isNoteOff = true;
            e.seqNoteID = f.seqNoteID;
          }
        }
        //console.log(`removing scheduled note off: ${GetMidiNoteInfo(f.note).name} @${k}`);
        return true;
      });
    });

    //const noteEarliestEventRemoved = {}; // key=note, value={frame,isNoteOn,seqNoteID}
    const removedPlayingNoteEntries = Object.entries(noteEarliestEventRemoved).filter(e => e[1].isNoteOff); // list of note entries where we assume we're cutting it off mid-way.

    if (!isSeqPlaying) {
      // the sequencer is no(longer)t playing. all playing notes should be sent a note-off.
      const noteOffsToEmit = removedPlayingNoteEntries.map(e => ({
          seqInstrumentID : instrumentID,
          note : parseInt(e[0]),
          seqNoteID: e[1].seqNoteID,
        }));
      if (noteOffsToEmit.length) {
        //console.log(`Seq is no longer playing; sending noteoffs for ${noteOffsToEmit.length} notes: ${JSON.stringify(noteOffsToEmit)}`);
        this.noteEventsFlushRoutine([], noteOffsToEmit);
      }
      //console.log(`SetSequencerEvents end (seq not playing) ---------------------------------------------------`);
      return;
    }

    // for every note where:
    // - the earliest item removed was a noteoff
    // - and, it's been deleted,
    // emit note offs immediately.
    // if the note has'nt been deleted then re-schedule its original note off.
    const noteOffsToEmit = [];

    removedPlayingNoteEntries.forEach(e => {
      console.assert(!!e[1].seqNoteID);
      let quantizedFrame = e[1].frame;
      const midiNoteValue = parseInt(e[0]);
      if (seqPatternView.HasViewCellID(e[1].seqNoteID)) {
        // note has not been deleted. reschedule this noteoff event.
        
        //console.log(`Rescheduling the note off; oops! ${GetMidiNoteInfo(midiNoteValue).name} @ frame ${quantizedFrame} ...`);

        // if the incoming events also contains this note, then rescheduling this in the future could result in
        // overlapping notes. Not a deal-breaker but it will sound ugly, consume an extra voice, and cause some
        // old note to live too long.
        // find the earliest incoming note event for this note
        const sameIncNotesNoteOnFrame = notes
          .filter(n => n.midiNoteValue === midiNoteValue)
          .map(n => n.noteOnQuantizedFrame);
        if (sameIncNotesNoteOnFrame.length) {
          const earliestQuantizedFrame = Math.min(...sameIncNotesNoteOnFrame);
          quantizedFrame = Math.min(quantizedFrame, earliestQuantizedFrame - 1);
          //console.log(` -> Preventing overlapping notes; shifting noteoff frame back to ${quantizedFrame}`);
        }

        this.scheduleEvent(quantizedFrame, null, {
          note : midiNoteValue,
          seqInstrumentID : instrumentID,
          seqNoteID : e[1].seqNoteID,
        });
      } else {
        // note has been removed from view, emit immediate note off
        //console.log(`Note no longer exists; emitting courtesy note off. ${GetMidiNoteInfo(midiNoteValue).name} @ frame ${quantizedFrame}`);
        noteOffsToEmit.push({
          seqInstrumentID : instrumentID,
          note : midiNoteValue,
          seqNoteID: e[1].seqNoteID,
        });
      }
    });

    if (noteOffsToEmit.length) {
      //console.log(`Deleted notes will be immediately note-off'd ${noteOffsToEmit.length} notes: ${JSON.stringify(noteOffsToEmit)}`);
      this.noteEventsFlushRoutine([], noteOffsToEmit);
    }

    // schedule notes
    notes.forEach(n => {
      //const noteOnQuantizedFrame = beatToFrame(n.absQuarter, this.metronome.getBPM());
      this.scheduleEvent(n.noteOnQuantizedFrame, { // note on
        note : n.midiNoteValue,
        seqInstrumentID : instrumentID,
        seqNoteID : n.noteID,
        velocity: n.velocity,
      }, null);
      
      // subtract 1 so adjascent notes in the sequencer don't get noteOff and noteOn at exactly the same time causing ambiguity.
      //console.log(`Scheduling a note on + corresponding note off for ${GetMidiNoteInfo(n.midiNoteValue).name}, id ${n.noteID} @onframe:${n.noteOnQuantizedFrame} @offrame:${n.noteOffQuantizedFrame} (len quart:${n.lengthQuarters})`);
      this.scheduleEvent(n.noteOffQuantizedFrame, null, { // corresponding note off.
        note : n.midiNoteValue,
        seqInstrumentID : instrumentID,
        seqNoteID : n.noteID,
      });
    }); // foreach notes

    //console.log(`SetSequencerEvents end---------------------------------------------------`);
  }
};

module.exports = {
  ServerRoomQuantizer,
};
