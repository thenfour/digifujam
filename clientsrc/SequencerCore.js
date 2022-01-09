// here's how divisions work in the sequencer:
// "loop" is the # of times a pattern has played; an absolute concept
// "pattern" is a looping range
// measure -> subdiv group -> subdiv -> div
//   ^ a pattern concept
//                ^-------------^ a timesig concept
//                                        ^ a pattern concept

const DFUtil = require('./dfutil');
const DFMusic = require("./DFMusic");

const SequencerSettings = {
  PatternCount : 4,
};

let globalSequencerConfig = {
  velocitySets : {},
  legends : {},
};

function IntegrateSequencerConfig(config) {
  // integrate the config to global state. each config is basically {velocitySets:{}, legends:{}}
  Object.keys(config.velocitySets).forEach(k => {
    globalSequencerConfig.velocitySets[k] = config.velocitySets[k];
  });
  Object.keys(config.legends).forEach(k => {
    globalSequencerConfig.legends[k] = config.legends[k];
  });
}

function ResolveSequencerConfig() {
  // after seq config files are loaded, resolve the refs.
  Object.keys(globalSequencerConfig.legends).forEach(legendID => {
    // each legends[legendID] = array of { name, midiNoteValue, legendCssClass, velocitySetRef }
    globalSequencerConfig.legends[legendID].forEach(note => {
      // transform the velocitySetRef into a velocitySet. NB: they will be refs, not copies.
      const velSet = globalSequencerConfig.velocitySets[note.velocitySetRef];
      note.velocitySet = velSet;
      delete note.velocitySetRef;
    });
  });

  // now all vel sets have been resolved; they're no longer needed.
  globalSequencerConfig.velocitySets = {};
}

function GetGlobalSequencerConfig() {
  return globalSequencerConfig;
}

const eSeqPatternOp = {
  ClearPattern : "ClearPattern",
  AddNote : "AddNote",
  DeleteNote : "DeleteNote",
};

function IsValidSequencerPatternIndex(i) {
  return Number.isInteger(i) && i >= 0 && i < SequencerSettings.PatternCount;
}

function IsValidSequencerSpeed(n) {
  return n > 0 && n < 100;
}

function IsValidSequencerSwing(n) {
  return n >= -1 && n <= 1;
}

function IsValidSequencerLengthMajorBeats(n) {
  return Number.isInteger(n) && n > 0 && n < 64;
}

const eDivisionType = {
  MajorBeat : "MajorBeat",
  MinorBeat : "MinorBeat",
  MinorBeat_x2 : "MinorBeat_x2",
  MinorBeat_x3 : "MinorBeat_x3",
  MinorBeat_x4 : "MinorBeat_x4",
};

function IsValidSequencerDivisionType(n) {
  return n in eDivisionType;
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
class SequencerNote {
  constructor(params) {
    if (params)
      Object.assign(this, params);

    console.assert(DFMusic.isValidNoteValue(this.midiNoteValue));
    this.id ??= 0;
    this.velocityIndex ??= 0; // velocities are defined in the note legend, and they are midi-style velocity values.
    this.patternMajorBeat ??= 0;
    this.lengthMajorBeats ??= 1;
  }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
class SequencerPattern {
  constructor(params) {
    if (params)
      Object.assign(this, params);

    if (!Array.isArray(this.notes))
      this.notes = [];
    this.notes = this.notes.map(n => new SequencerNote(n));

    this.lengthMajorBeats ??= 8;
    this.divisionType ??= eDivisionType.MinorBeat;
  }

  HasData() {
    return this.notes.length > 0;
  }

  Clear() {
    this.notes = [];
    return true;
  }

  AddNoteOp(op) {
    if (DFUtil.IsServer()) {
      op.id ??= DFUtil.generateID();
    }
    console.assert(op.id);
    // TODO: ensure no conflicts / overlaps. if so, arrange notes so things aren't broken.
    this.notes.push(new SequencerNote({
      midiNoteValue : op.midiNoteValue,
      id : op.id,
      velocityIndex : op.velocityIndex,
      patternMajorBeat : op.patternMajorBeat,
      lengthMajorBeats : op.lengthMajorBeats,
    }));
    return true;
  }

  DeleteNoteOp(op) {
    console.assert(op.id);
    const i = this.notes.findIndex(n => n.id === op.id);
    if (i === -1)
      return false;
    this.notes.splice(i, 1);
    return true;
  }

  // this not only processes, but ADDS ids where necessary (server)
  ProcessOps(ops) {
    return ops.every(op => {
      switch (op.type) {
      case eSeqPatternOp.ClearPattern:
        return this.Clear();
      case eSeqPatternOp.AddNote:
        return this.AddNoteOp(op);
      case eSeqPatternOp.DeleteNote:
        return this.DeleteNoteOp(op);
      }
    });
  }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
/*
this gets a LOT of properties; just adds some methods to it.
beginMeasureFrac
beginMeasureMajorBeat
beginPatternFrac
beginPatternMajorBeat
endMeasureFrac
endMeasureMajorBeat
endPatternFrac
endPatternMajorBeat
isMajorBeatBoundary
isMeasureBoundary
isMinorBeatBoundary
measureDivIndex
minorBeatDivIndex
patternDivIndex
patternMeasure
*/
class SeqDivInfo {
  constructor(params) {
    Object.assign(this, params);
  }
  IncludesPatternMajorBeat(b) {
    return (b >= this.beginPatternMajorBeat) && (b < this.endPatternMajorBeat);
  }
  IncludesPatternMajorBeatRange(begin, end) {
    if (end <= this.beginPatternMajorBeat)
      return false;
    if (begin >= this.endPatternMajorBeat)
      return false;
    return true;
  }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
// this encapsulates the configuration for the whole sequencer
// it gets serialized as saveable presets
class SequencerPatch {
  constructor(params) {
    if (params)
      Object.assign(this, params);

    this.timeSig = new DFMusic.TimeSig(this.timeSig);

    this.presetName ??= '(init)';
    this.presetDescription ??= '';
    this.presetTags ??= '';
    this.presetAuthor ??= '';
    this.presetSavedDate ??= Date.now();

    this.selectedPatternIdx ??= 0;

    if (!Array.isArray(this.patterns) || (this.patterns.length != SequencerSettings.PatternCount)) {
      this.patterns = [...new Array(SequencerSettings.PatternCount) ].map(_ => new SequencerPattern());
    } else {
      this.patterns = this.patterns.map(p => new SequencerPattern(p));
    }

    this.speed ??= 1;
    this.swing ??= 0; // -1 to +1

    // this could be a Set(), but it doesn't automatically serialize via JSON.serialize, and there should rarely be many entries.
    // since there are only 128 midi notes, an option is also to just create a fixed-size array of bools
    if (!Array.isArray(this.mutedNotes))
      this.mutedNotes = [];
  }

  IsNoteMuted(midiNoteValue) {
    return this.mutedNotes.some(n => n === midiNoteValue);
  }

  SetNoteMuted(midiNoteValue, isMuted) {
    if (isMuted) {
      // ensure exists in array.
      if (!this.IsNoteMuted(midiNoteValue)) {
        this.mutedNotes.push(midiNoteValue);
      }
      return;
    }
    const i = this.mutedNotes.findIndex(n => n === midiNoteValue);
    if (i === -1)
      return;

    // remove existing.
    this.mutedNotes.splice(i, 1);
  }
  SelectPatternIndex(selectedPatternIdx) {
    this.selectedPatternIdx = selectedPatternIdx;
  }
  SetSpeed(speed) {
    this.speed = speed;
  }
  SetSwing(swing) {
    this.swing = swing;
  }
  SetDivisionType(divisionType) {
    this.patterns[this.selectedPatternIdx].divisionType = divisionType;
  }
  SetLengthMajorBeats(lengthMajorBeats) {
    this.patterns[this.selectedPatternIdx].lengthMajorBeats = lengthMajorBeats;
  }

  SetTimeSig(ts) {
    this.timeSig = ts;
  }

  GetSelectedPattern() {
    return this.patterns[this.selectedPatternIdx];
  }

  GetDivisionType() {
    return this.GetSelectedPattern().divisionType;
  }

  #SubdivideMeasureMinorBeats(mbiArray, n) {
    n = Math.ceil(n); // if non-integral subdivisions, subdivide further. handles cases like 6/8.
    const ret = [];
    //let measureDivIndex = 0;
    mbiArray.forEach(minbi => {
      // subdivide minbi.
      const minorBeatsInThisMajorBeat = this.timeSig.majorBeatInfo[minbi.majorBeatIndex].minorBeats.length;
      const minorBeatDurationInMeasures = minbi.endMeasureFrac - minbi.beginMeasureFrac;
      divDurationInMeasures = minorBeatDurationInMeasures / n;
      for (let minorBeatDivIndex = 0; minorBeatDivIndex < n; ++minorBeatDivIndex) {
        ret.push({
          __minbi : minbi,
          beginMeasureFrac : minbi.beginMeasureFrac + (divDurationInMeasures * minorBeatDivIndex),
          endMeasureFrac : minbi.beginMeasureFrac + (divDurationInMeasures * (1 + minorBeatDivIndex)),
          measureDivIndex : ret.length, // measureDivIndex++,
          minorBeatDivIndex,
          isMeasureBoundary : ret.length === 0,
          isMajorBeatBoundary : minbi.isMajorBeatBoundary && minorBeatDivIndex === 0 && minbi.minorBeatOfMajorBeat === 0, //    minbi.minorBeatOfMajorBeat == 0 && ,
          isMinorBeatBoundary : minorBeatDivIndex === 0,
          beginMeasureMajorBeat : minbi.beginMeasureMajorBeat + (minorBeatDivIndex / n) / minorBeatsInThisMajorBeat,
          endMeasureMajorBeat : minbi.beginMeasureMajorBeat + ((minorBeatDivIndex + 1) / n) / minorBeatsInThisMajorBeat,
        });
      }
    });
    return ret;
  }

  GetMeasureDivisionInfo() {
    switch (this.GetSelectedPattern().divisionType) {
    case eDivisionType.MajorBeat: // so 4/4 returns 4, 7/8 returns 2 (unequal beats)
      return this.timeSig.majorBeatInfo.map(majbi => {
        return {
          beginMeasureFrac : majbi.beginMeasureFrac,
          endMeasureFrac : majbi.endMeasureFrac,
          measureDivIndex : majbi.index,
          minorBeatDivIndex : 0,
          isMeasureBoundary : majbi.index === 0,
          isMajorBeatBoundary : true,
          isMinorBeatBoundary : true,
          beginMeasureMajorBeat : majbi.index,
          endMeasureMajorBeat : majbi.index + 1,
        };
      });
    case eDivisionType.MinorBeat: // 8ths
      return this.#SubdivideMeasureMinorBeats(this.timeSig.minorBeatInfo, 2 / this.timeSig.minorBeatsPerQuarter);
    case eDivisionType.MinorBeat_x2:
      return this.#SubdivideMeasureMinorBeats(this.timeSig.minorBeatInfo, 4 / this.timeSig.minorBeatsPerQuarter);
    case eDivisionType.MinorBeat_x3:
      return this.#SubdivideMeasureMinorBeats(this.timeSig.minorBeatInfo, 6 / this.timeSig.minorBeatsPerQuarter);
    case eDivisionType.MinorBeat_x4:
      return this.#SubdivideMeasureMinorBeats(this.timeSig.minorBeatInfo, 8 / this.timeSig.minorBeatsPerQuarter);
    }
  }

  GetPatternDivisionInfo() {
    const pattern = this.GetSelectedPattern();
    const patternLengthMeasures = pattern.lengthMajorBeats / this.timeSig.majorBeatsPerMeasure;
    const wholeMeasures = Math.floor(patternLengthMeasures);
    const partialMeasureFrac = patternLengthMeasures - wholeMeasures - 0.01; // guarantee for rounding error

    let ret = [];
    let measureDivisionInfo = this.GetMeasureDivisionInfo();
    // for each whole measure
    let patternDivIndex = 0;
    for (let iMeasure = 0; iMeasure < wholeMeasures; ++iMeasure) {
      ret = ret.concat(measureDivisionInfo.map(div => {
        return Object.assign(Object.assign({}, div), {
          patternMeasure : iMeasure,
          patternDivIndex : patternDivIndex++,
          beginPatternFrac : (iMeasure / patternLengthMeasures) + (div.beginMeasureFrac / patternLengthMeasures),
          endPatternFrac : (iMeasure / patternLengthMeasures) + (div.endMeasureFrac / patternLengthMeasures),
          beginPatternMajorBeat : (iMeasure * this.timeSig.majorBeatsPerMeasure) + div.beginMeasureMajorBeat,
          endPatternMajorBeat : (iMeasure * this.timeSig.majorBeatsPerMeasure) + div.endMeasureMajorBeat,
        });
      }));
    }

    // partial measure. be inclusive, so if you require .51 mesaures, take any div which includes .51. don't take only whole portions.
    ret = ret.concat(measureDivisionInfo.filter(div => div.beginMeasureFrac < partialMeasureFrac).map(div => {
      return Object.assign(Object.assign({}, div), {
        patternMeasure : wholeMeasures,
        patternDivIndex : patternDivIndex++,
        beginPatternFrac : (wholeMeasures / patternLengthMeasures) + (div.beginMeasureFrac / patternLengthMeasures),
        endPatternFrac : (wholeMeasures / patternLengthMeasures) + (div.endMeasureFrac / patternLengthMeasures),
        beginPatternMajorBeat : (wholeMeasures * this.timeSig.majorBeatsPerMeasure) + div.beginMeasureMajorBeat,
        endPatternMajorBeat : (wholeMeasures * this.timeSig.majorBeatsPerMeasure) + div.endMeasureMajorBeat,
      });
    }));
    return ret.map(r => new SeqDivInfo(r));
  }

  GetLengthMajorBeats() {
    return this.GetSelectedPattern().lengthMajorBeats;
  }

  GetPatternDivisionCount() {
    return this.GetMeasureDivisionInfo().length;
  }

  GetPatternFracAtAbsQuarter(absQuarter) {
    const pattern = this.GetSelectedPattern();
    // could theoretically be precalculated
    const patternLengthMeasures = pattern.lengthMajorBeats / this.timeSig.majorBeatsPerMeasure;
    const patternLengthQuarters = patternLengthMeasures * this.timeSig.quartersPerMeasure;

    const speedAdjustedQuarter = absQuarter * this.speed;

    const absPatternPosition = speedAdjustedQuarter / patternLengthQuarters;
    return DFUtil.getDecimalPart(absPatternPosition);
  }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
// remember this class is json serialized to clients in roomstate!
class SequencerDevice {
  constructor(params) {
    if (params)
      Object.assign(this, params);

    this.isPlaying ??= false;

    this.livePatch = new SequencerPatch(this.livePatch);
    //console.assert(!!this.legendRef); <-- you may not have a legendref if this seq device is inactive/inaccessible/allowed.

    if (!Array.isArray(this.presetList))
      this.presetList = [];
    this.presetList = this.presetList.map(p => new SequencerPatch(p));
  }

  HasData() {
    return this.livePatch.GetSelectedPattern().HasData();
  }

  GetNoteLegend() {
    return globalSequencerConfig.legends[this.legendRef];
  }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
class PatternViewNote {
  constructor(midiNoteValue) {
    this.midiNoteValue = midiNoteValue;

    this.hasNote = false;
    this.beginNoteOn = false;       // beginning of cell = note on
    this.beginNoteContinue = false; // beginning of cell = continuation
    this.endNoteOff = false;        // end of cell = note off
    this.endNoteContinue = false;

    // time & length are assumed to be beginning & end of this cell.

    this.underlyingNotes = [];
  }

  Integrate(div, note, legend) {
    this.hasNote = true;

    // TODO: this can be much more sophisticated
    this.beginNoteOn = true;
    this.endNoteOff = true;
    this.velocityIndex = note.velocityIndex;
    this.underlyingNotes = [ note ];
    this.cssClass = "";
    const legendNote = legend.find(n => n.midiNoteValue === note.midiNoteValue);
    if (legendNote && legendNote.cssClass) {
      this.cssClass = legendNote.cssClass;
    }

    const velocityEntry = legendNote.velocitySet[note.velocityIndex];
    this.velocity = velocityEntry.vel;
    this.cssClass += ` vel${note.velocityIndex}`;
    if (velocityEntry.cssClass)
      this.cssClass += " " + velocityEntry.cssClass;
  }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
// the sequencer pattern data holds all the data. it can have notes beyond the visible pattern bounds
// for example, or very precise note timings. so shorter lengths, and coarse division means notes should be "quantized" together
// selectively.
// let's create a pattern view which reflects current playback settings and optimizes for display
class SequencerPatternView {
  // map divs to note array
  constructor(patch, legend) {
    const start = Date.now();

    const pattern = patch.GetSelectedPattern();
    this.divs = patch.GetPatternDivisionInfo(); // get COLUMN info.

    // initialize rows: arrays for each div to correspond with underlying pattern notes
    this.divs.forEach(div => {
      div.noteMap = [...new Array(128) ].map((_, i) => new PatternViewNote(i));
    });

    // place each pattern note in the correct div-note cell
    pattern.notes.forEach(note => {
      this.#bringNoteIntoView(note, legend);
    });

    const duration = (Date.now() - start);
    console.log(`generating pattern view took ${duration} ms`);
  }

  // when a user clicks a cell, cycle through velocity indices as defined in the note legend.
  GetPatternOpsForCellCycle(divInfo, note) {
    // determine what needs to happen.
    const patternViewNote = divInfo.noteMap[note.midiNoteValue];
    if (patternViewNote.hasNote) {
      // remove note & add new with cycled vel
      const ret = [];
      // we don't modify notes, we remove & add them. it's simpler this way, and resolves some ambiguities regarding underlying note data.
      patternViewNote.underlyingNotes.forEach(n => {
        ret.push({
          type : eSeqPatternOp.DeleteNote,
          id : n.id,
        });
      });
      const oldVelIndex = patternViewNote.velocityIndex;
      if (oldVelIndex < note.velocitySet.length - 1) { // if there are velocity indices left to cycle through, add it. otherwise just remove.
        ret.push({
          type : eSeqPatternOp.AddNote,
          midiNoteValue : note.midiNoteValue,
          velocityIndex : oldVelIndex + 1,
          patternMajorBeat : divInfo.beginPatternMajorBeat,
          lengthMajorBeats : divInfo.endPatternMajorBeat - divInfo.beginPatternMajorBeat,
        });
      }
      return ret;
    }

    // add note.
    return [ {
      type : eSeqPatternOp.AddNote,
      midiNoteValue : note.midiNoteValue,
      velocityIndex : 0,
      patternMajorBeat : divInfo.beginPatternMajorBeat,
      lengthMajorBeats : divInfo.endPatternMajorBeat - divInfo.beginPatternMajorBeat,
    } ];
  }

  #bringNoteIntoView(note, legend) {
    let div = DFUtil.findNearest(this.divs, (div) => Math.abs(div.beginPatternMajorBeat - note.patternMajorBeat));
    const viewNote = div.noteMap[note.midiNoteValue];
    viewNote.Integrate(div, note, legend);
  }
}

module.exports = {
  SequencerSettings,
  SequencerDevice,
  IsValidSequencerPatternIndex,
  IsValidSequencerSpeed,
  IsValidSequencerSwing,
  IsValidSequencerDivisionType,
  IsValidSequencerLengthMajorBeats,
  eDivisionType,
  eSeqPatternOp,
  SequencerPatternView,
  IntegrateSequencerConfig,
  GetGlobalSequencerConfig,
  ResolveSequencerConfig,
};