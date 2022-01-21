// here's how divisions work in the sequencer:
// "loop" is the # of times a pattern has played; an absolute concept
// "pattern" is a looping range
// measure -> majorbeat -> minorbeat -> div
//   ^ a pattern concept, equal divisions
//                ^-------------^ a timesig concept, unequal divisions
//                                        ^ a pattern concept, unequal divisions per minorbeat due to swing

const DFUtil = require('./dfutil');
const DFMusic = require("./DFMusic");

const SequencerSettings = {
  PatternCount : 4,
  MaxDivs : 65,
  MaxNoteOnsPerColumn : 6,
};

const eDivisionType = {
  MajorBeat : "MajorBeat",
  MinorBeat : "MinorBeat",
  MinorBeat_x2 : "MinorBeat_x2",
  MinorBeat_x3 : "MinorBeat_x3",
  MinorBeat_x4 : "MinorBeat_x4",
};

const gDefaultPatternLengthMajorBeats = 4;
const gDefaultPatternDivisionType = eDivisionType.MajorBeat;

let globalSequencerConfig = {
  velocitySets : {},
  legends : {},
};

function IntegrateSequencerConfig(config) {
  // integrate the config to global state. each config is basically {velocitySets:{}, legends:{}}
  if (config.velocitySets) {
    Object.keys(config.velocitySets).forEach(k => {
      globalSequencerConfig.velocitySets[k] = config.velocitySets[k];
    });
  }
  if (config.legends) {
    Object.keys(config.legends).forEach(k => {
      globalSequencerConfig.legends[k] = config.legends[k];
    });
  }
}

function ResolveSequencerConfig() {
  // after seq config files are loaded, resolve the refs.
  Object.keys(globalSequencerConfig.legends).forEach(legendID => {
    // each legends[legendID] = array of { name, midiNoteValue, legendCssClass, velocitySetRef }
    globalSequencerConfig.legends[legendID].forEach(note => {
      // transform the velocitySetRef into a velocitySet. NB: they will be refs, not copies.
      let velSet = Object.values(globalSequencerConfig.velocitySets)[0];
      if (note.velocitySetRef in globalSequencerConfig.velocitySets) {
        velSet = globalSequencerConfig.velocitySets[note.velocitySetRef];
      }
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
  Nop : "Nop", // needed when clients send server some invalid op, and the server converts it to a Nop.
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

function IsValidSequencerDivisionType(n) {
  return n in eDivisionType;
}

function IsValidSequencerOctave(oct) {
  return Number.isInteger(oct) && oct >= -3 && oct <= 3;
}

function IsValidDivCount(divsPerMeasure, divCount) {
  if (!Number.isInteger(divCount))
    return false;
  if (divCount < 1)
    return false;
  if (divCount > SequencerSettings.MaxDivs)
    return false;
  // for the moment you must also have patterns be an even measure length.
  if (!Number.isInteger(divCount / divsPerMeasure))
    return false;
  return true;
}

function IsValidSequencerTranspose(transpose) {
  transpose = parseInt(transpose);
  if (transpose < -12)
    return false;
  if (transpose > 12)
    return false;
  this.transpose = transpose;
  return true;
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
    this.timestamp ??= Date.now();
  }

  GetEndPatternMajorBeat() {
    return this.patternMajorBeat + this.lengthMajorBeats;
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

    this.lengthMajorBeats ??= gDefaultPatternLengthMajorBeats;
    this.divisionType ??= gDefaultPatternDivisionType;
  }

  HasData() {
    return this.notes.length > 0;
  }

  #Clear() {
    this.notes = [];
    return true;
  }

  #AddNoteOp(op) {
    if (DFUtil.IsServer()) {
      op.id ??= DFUtil.generateID(); // hm why ??=? shouldn't the id always be generated?
      op.timestamp = Date.now();
    }
    console.assert(op.id);
    // TODO: ensure no conflicts / overlaps. if so, arrange notes so things aren't broken.
    // todo: enforce SequencerSettings.MaxNoteOnsPerColumn; currently only enforecd on client
    this.notes.push(new SequencerNote({
      midiNoteValue : op.midiNoteValue,
      id : op.id,
      velocityIndex : op.velocityIndex,
      patternMajorBeat : op.patternMajorBeat,
      lengthMajorBeats : op.lengthMajorBeats,
    }));
    return true;
  }

  #DeleteNoteOp(op) {
    console.assert(op.id);
    const i = this.notes.findIndex(n => n.id === op.id);
    if (i === -1) {
      op.type = eSeqPatternOp.Nop;
      return false;
    }
    this.notes.splice(i, 1);
    return true;
  }

  // this not only processes, but ADDS ids and timestamps where necessary (server)
  ProcessOps(ops, patch) {
    patch.MarkCachedViewDirty();
    ops.forEach(op => {
      switch (op.type) {
      case eSeqPatternOp.ClearPattern:
        return this.#Clear();
      case eSeqPatternOp.AddNote:
        return this.#AddNoteOp(op);
      case eSeqPatternOp.DeleteNote:
        return this.#DeleteNoteOp(op);
      }
    });
  }

  GetDivsPerMeasure(ts) {
    switch (this.divisionType) {
    default:
    case eDivisionType.MajorBeat: // so 4/4 returns 4, 7/8 returns 2 (unequal beats)
      return ts.majorBeatInfo.length;
    case eDivisionType.MinorBeat: // 8ths
      return ts.minorBeatInfo.length * Math.ceil(2 / ts.minorBeatsPerQuarter);
    case eDivisionType.MinorBeat_x2:
      return ts.minorBeatInfo.length * Math.ceil(4 / ts.minorBeatsPerQuarter);
    case eDivisionType.MinorBeat_x3:
      return ts.minorBeatInfo.length * Math.ceil(6 / ts.minorBeatsPerQuarter);
    case eDivisionType.MinorBeat_x4:
      return ts.minorBeatInfo.length * Math.ceil(8 / ts.minorBeatsPerQuarter);
    }
  }

  GetDivCountForTimesig(ts) {
    const divsPerMeasure = this.GetDivsPerMeasure(ts);
    const measures = this.lengthMajorBeats / ts.majorBeatsPerMeasure;
    const divsFloat = measures * divsPerMeasure;
    return Math.ceil(divsFloat);
  }

  CanDouble(ts) {
    return IsValidDivCount(this.GetDivsPerMeasure(ts), this.GetDivCountForTimesig(ts) * 2);
  }
  CanHalf(ts) {
    return IsValidDivCount(this.GetDivsPerMeasure(ts), this.GetDivCountForTimesig(ts) / 2);
  }
  CanExpand(ts) {
    return this.CanDouble(ts);
  }
  CanContract(ts) {
    return this.CanHalf(ts);
  }

  // expands this pattern and returns the resulting pattern.
  // pass in the time signature so we can verify div counts
  GetExpandedPattern(ts) {
    const ret = new SequencerPattern(JSON.parse(JSON.stringify(this)));
    if (!this.CanExpand(ts))
      return ret;
    ret.lengthMajorBeats *= 2;
    ret.notes.forEach(n => {
      n.patternMajorBeat *= 2;
      // lengths don't change
    });
    return ret;
  }
  GetContractedPattern(ts) {
    const ret = new SequencerPattern(JSON.parse(JSON.stringify(this)));
    if (!this.CanContract(ts))
      return ret;
    ret.lengthMajorBeats /= 2;
    ret.notes.forEach(n => {
      n.patternMajorBeat /= 2;
    });
    return ret;
  }
  GetDoubledPattern(ts) {
    const ret = new SequencerPattern(JSON.parse(JSON.stringify(this)));
    if (!this.CanExpand(ts))
      return ret;
    const oldlen = ret.lengthMajorBeats;
    ret.lengthMajorBeats *= 2;
    ret.notes = ret.notes.concat(ret.notes.map(n =>
                                                   new SequencerNote(Object.assign(JSON.parse(JSON.stringify(n)), {
                                                     id : DFUtil.generateID(),
                                                     patternMajorBeat : n.patternMajorBeat + oldlen
                                                   }))));
    return ret;
  }
  GetHalvedPattern(ts) {
    const ret = new SequencerPattern(JSON.parse(JSON.stringify(this)));
    if (!this.CanContract(ts))
      return ret;
    ret.lengthMajorBeats /= 2;
    ret.notes = ret.notes.filter(n => n.patternMajorBeat < ret.lengthMajorBeats - 0.01); // crop
    return ret;
  }

  GetShiftedPatternVert(ts, n, legend) {
    const ret = new SequencerPattern(JSON.parse(JSON.stringify(this)));

    ret.notes = ret.notes.filter(n => n.patternMajorBeat < ret.lengthMajorBeats - 0.01); // crop

    ret.notes.forEach(note => {
      // figure out which legend index
      let index = legend.findIndex(l => l.midiNoteValue === note.midiNoteValue); //legend.findIndex(div => div.IncludesPatternMajorBeat(note.patternMajorBeat));
      if (index === -1) {
        // not in legend; drop it.
        note.midiNoteValue = 0;
        return;
      }

      index += n;
      if (index < 0)
        index = legend.length - 1;
      if (index >= legend.length)
        index = 0;
      note.midiNoteValue = legend[index].midiNoteValue;
    });

    // delete bad notes
    ret.notes = ret.notes.filter(n => n.midiNoteValue > 0);

    return ret;
  }

  GetShiftedPatternHoriz(ts, n, patternView) {
    const ret = new SequencerPattern(JSON.parse(JSON.stringify(this)));
    ret.notes.forEach(note => {
      // figure out which div index
      let divIndex = patternView.divs.findIndex(div => div.IncludesPatternMajorBeat(note.patternMajorBeat));
      console.assert(divIndex !== -1);
      divIndex += n;
      if (divIndex < 0)
        divIndex = patternView.divs.length - 1;
      if (divIndex >= patternView.divs.length)
        divIndex = 0;
      // convert back to major beat.
      note.patternMajorBeat = patternView.divs[divIndex].beginPatternMajorBeat;
    });
    return ret;
  }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
/*
this gets a LOT of properties; just adds some methods to it.
beginMeasureFrac:0
beginMeasureMajorBeat:0
beginPatternFrac:0
beginPatternMajorBeat:0
endMeasureFrac:0.125
endMeasureMajorBeat:0.5
endPatternFrac:0.0625
endPatternMajorBeat:0.5
isMajorBeatBoundary:true
isMeasureBoundary:true
isMinorBeatBoundary:true
measureDivIndex:0
minorBeatDivIndex:0
patternDivIndex:0
patternMeasure:0
*/
class SeqDivInfo {
  constructor(params) {
    Object.assign(this, params);
    this.rows = {}; // convenience for pattern view.
  }
  get lengthMajorBeats() {
    return this.endPatternMajorBeat - this.beginPatternMajorBeat;
  }
  getLengthQuarters(patternLengthQuarters) {
    let ret = this.endPatternFrac - this.beginPatternFrac;
    return ret * patternLengthQuarters;
  }
  IncludesPatternMajorBeat(b) {
    return (b >= this.beginPatternMajorBeat) && (b < this.endPatternMajorBeat);
  }

  IncludesPatternFracWithSwing(playheadPatternQuarter) {
    return (playheadPatternQuarter >= this.swingBeginPatternQuarter) && (playheadPatternQuarter < this.swingEndPatternQuarter);
  }

  // // for pattern view div info
  // GetNoteCount() {
  //   return Object.values(this.noteMap).reduce((a, b) => a + ((b.underlyingNotes?.length) ?? 0), 0);
  // }
  // GetSomeUnderlyingNoteIDsExcept(idsToExclude, count) {
  //   if (count < 1)
  //     return [];
  //   // create list of underlying notes, sorted by date created
  //   let un = [];
  //   Object.values(this.noteMap).forEach(pvn => {
  //     const matchingUNs = pvn.underlyingNotes.filter(un => !idsToExclude.some(ex => ex === un.id));
  //     un = un.concat(matchingUNs);
  //   });

  //   un.sort((a, b) => a.timestamp < b.timestamp ? -1 : 1);

  //   const y = un.slice(0, count);
  //   const ret = y.map(x => x.id);
  //   return ret;
  // }

  // there are 5 cases
  //           |-----div-----|
  // |note|                             <- 0%
  //        |note|                      <- partial, contains note off
  //               |note|               <- 100%,    contains note on + note off
  //                      |note|        <- partial, contains note on
  //                             |note| <- 0%
  // clamping note bounds div bounds, then just div by length accounts for all cases.
  //           |-----div-----|
  //           |               <- 0%
  //           |e|             <- partial
  //               |note|      <- 100%
  //                      |no| <- partial
  //                         | <- 0%
  // NB NB NB : does NOT account for wrapping/looping behavior. if the window goes off the pattern, it's ignored,
  // as if the pattern does not loop.
  calcCoverageOfWindow(begin, end) {
    console.assert(this.lengthMajorBeats > 0);
    let clampedBegin = DFUtil.baseClamp(begin, this.beginPatternMajorBeat, this.endPatternMajorBeat);
    let clampedEnd = DFUtil.baseClamp(end, this.beginPatternMajorBeat, this.endPatternMajorBeat);
    console.assert(clampedEnd >= clampedBegin);
    return (clampedEnd - clampedBegin) / this.lengthMajorBeats;
  }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
// this encapsulates the configuration for the whole sequencer
// it gets serialized as saveable presets
class SequencerPatch {

  // private fields are not JSON serialized
  #cachedView;
  #cachedViewDirty;

  constructor(params) {
    if (params)
      Object.assign(this, params);

    this.timeSig = new DFMusic.TimeSig(this.timeSig);

    this.presetName ??= '(init)';
    this.presetDescription ??= '';
    this.presetTags ??= '';
    this.presetAuthor ??= '';
    this.presetSavedDate ??= Date.now();
    this.presetSavedDate = new Date(this.presetSavedDate); // ensure date type
    this.presetID ??= DFUtil.generateID();

    this.selectedPatternIdx ??= 0;

    if (!Array.isArray(this.patterns) || (this.patterns.length != SequencerSettings.PatternCount)) {
      this.patterns = [...new Array(SequencerSettings.PatternCount) ].map(_ => new SequencerPattern());
    } else {
      this.patterns = this.patterns.map(p => new SequencerPattern(p));
    }

    this.speed ??= 1;
    this.swing ??= 0; // -1 to +1
    this.octave ??= 0;
    this.transpose ??= 0;

    // this could be a Set(), but it doesn't automatically serialize via JSON.serialize, and there should rarely be many entries.
    // since there are only 128 midi notes, an option is also to just create a fixed-size array of bools
    if (!Array.isArray(this.mutedNotes))
      this.mutedNotes = [];

    this.#cachedView = null;
    this.#cachedViewDirty = true;
  }

  GetCachedView() {
    if (this.#cachedViewDirty)
      return null;
    return this.#cachedView; // may still return null.
  }
  SetCachedView(v) {
    this.#cachedView = v;
    this.#cachedViewDirty = false;
  }
  MarkCachedViewDirty() {
    this.#cachedView = null;
    this.#cachedViewDirty = true;
  }

  PasteSelectedPattern(pattern) {
    this.#cachedViewDirty = true;
    this.patterns[this.selectedPatternIdx] = new SequencerPattern(pattern);
  }

  // can return nullish if out of range / should not be played.
  AdjustMidiNoteValue(midiNoteValue) {
    let ret = midiNoteValue;
    midiNoteValue += this.octave * 12;
    midiNoteValue += this.transpose;
    if (midiNoteValue < 1)
      return 0;
    if (midiNoteValue > 127)
      return 0;
    return midiNoteValue;
  }

  IsNoteMuted(midiNoteValue) {
    return this.mutedNotes.some(n => n === midiNoteValue);
  }

  SetNoteMuted(midiNoteValue, isMuted) {
    this.#cachedViewDirty = true;
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
    this.#cachedViewDirty = true;
    this.selectedPatternIdx = selectedPatternIdx;
  }
  SetSpeed(speed) {
    this.#cachedViewDirty = true;
    this.speed = speed;
  }
  SetSwing(swing) {
    this.#cachedViewDirty = true;
    this.swing = swing;
  }
  SetDivisionType(divisionType) {
    this.#cachedViewDirty = true;
    // if setting div type results in a pattern that's too long, don't allow.
    const oldVal = this.patterns[this.selectedPatternIdx].divisionType;
    this.patterns[this.selectedPatternIdx].divisionType = divisionType;
    if (this.GetPatternDivisionCount() > SequencerSettings.MaxDivs) {
      this.patterns[this.selectedPatternIdx].divisionType = oldVal;
    }
  }
  SetLengthMajorBeats(lengthMajorBeats) {
    this.#cachedViewDirty = true;
    const oldVal = this.patterns[this.selectedPatternIdx].lengthMajorBeats;
    this.patterns[this.selectedPatternIdx].lengthMajorBeats = lengthMajorBeats;
    if (this.GetPatternDivisionCount() > SequencerSettings.MaxDivs) {
      this.patterns[this.selectedPatternIdx].lengthMajorBeats = oldVal;
    }
  }

  SetTimeSig(ts) {
    this.#cachedViewDirty = true;
    this.timeSig = ts;
    if (this.GetLengthMeasures() < 1) {
      // easy case; try to always keep at least 1 measure.
      this.SetLengthMajorBeats(this.timeSig.majorBeatsPerMeasure);
      return;
    }
    // otherwise, round to nearest new measure.
    // if notes become hidden, expand.
    const pattern = this.patterns[this.selectedPatternIdx];
    const origNotesHidden = this.GetHiddenNoteCount();
    let newMeas = Math.round(this.GetLengthMeasures());
    this.SetLengthMajorBeats(newMeas * this.timeSig.majorBeatsPerMeasure);
    while (this.GetHiddenNoteCount() > origNotesHidden) {
      newMeas++;
      this.SetLengthMajorBeats(newMeas * this.timeSig.majorBeatsPerMeasure);
    }
    // subtract until we're within max length.
    while ((this.GetPatternDivisionCount() > SequencerSettings.MaxDivs) && (newMeas > 1)) {
      newMeas--;
      this.SetLengthMajorBeats(newMeas * this.timeSig.majorBeatsPerMeasure);
    }
  }

  GetHiddenNoteCount() {
    // count notes which begin past the visible pattern.
    const pattern = this.patterns[this.selectedPatternIdx];
    return pattern.notes.filter(note => note.patternMajorBeat >= pattern.lengthMajorBeats).length;
  }

  GetLengthMeasures() {
    return this.GetLengthMajorBeats() / this.timeSig.majorBeatsPerMeasure;
  }

  GetSelectedPattern() {
    return this.patterns[this.selectedPatternIdx];
  }

  GetDivisionType() {
    return this.GetSelectedPattern().divisionType;
  }

  SetOctave(oct) {
    this.#cachedViewDirty = true;
    this.octave = oct;
  }
  GetOctave() {
    return this.octave;
  }

  SetTranspose(transpose) {
    if (!IsValidSequencerTranspose(transpose))
      return false;
    this.#cachedViewDirty = true;
    this.transpose = parseInt(transpose);
    return true;
  }

  GetTranspose() {
    return this.transpose;
  }

  #SubdivideMeasureMinorBeats(elementsPerQuarter) {
    const ret = [];

    const minorBeats = this.timeSig.minorBeatInfo;

    elementsPerQuarter /= this.timeSig.minorBeatsPerQuarter;
    elementsPerQuarter = Math.ceil(elementsPerQuarter); // if non-integral subdivisions, subdivide further. handles cases like 6/8.

    minorBeats.forEach(minbi => {
      // subdivide minbi.
      const minorBeatsInThisMajorBeat = this.timeSig.majorBeatInfo[minbi.majorBeatIndex].minorBeats.length;
      const minorBeatDurationInMeasures = minbi.endMeasureFrac - minbi.beginMeasureFrac;
      const divDurationInMeasures = minorBeatDurationInMeasures / elementsPerQuarter;
      for (let minorBeatDivIndex = 0; minorBeatDivIndex < elementsPerQuarter; ++minorBeatDivIndex) {
        const n = {
          __minbi : minbi,
          beginMeasureFrac : minbi.beginMeasureFrac + (divDurationInMeasures * minorBeatDivIndex),
          endMeasureFrac : minbi.beginMeasureFrac + (divDurationInMeasures * (1 + minorBeatDivIndex)),
          measureDivIndex : ret.length, // measureDivIndex++,
          minorBeatDivIndex,
          isMeasureBoundary : ret.length === 0,
          isMajorBeatBoundary : minbi.isMajorBeatBoundary && minorBeatDivIndex === 0 && minbi.minorBeatOfMajorBeat === 0, //    minbi.minorBeatOfMajorBeat == 0 && ,
          isMinorBeatBoundary : minorBeatDivIndex === 0,
          beginMeasureMajorBeat : minbi.beginMeasureMajorBeat + (minorBeatDivIndex / elementsPerQuarter) / minorBeatsInThisMajorBeat,
          endMeasureMajorBeat : minbi.beginMeasureMajorBeat + ((minorBeatDivIndex + 1) / elementsPerQuarter) / minorBeatsInThisMajorBeat,
        };
        ret.push(n);
      }
    });
    return ret;
  }

  GetMeasureDivisionInfo() {
    switch (this.GetSelectedPattern().divisionType) {
    case eDivisionType.MajorBeat: // so 4/4 returns 4, 7/8 returns 2 (unequal beats). no swing is supported at this level.
      return this.timeSig.majorBeatInfo.map(majbi => {
        const n = {
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
        return n;
      });
    case eDivisionType.MinorBeat: // 8ths
      return this.#SubdivideMeasureMinorBeats(2);
    case eDivisionType.MinorBeat_x2: // 16ths
      return this.#SubdivideMeasureMinorBeats(4);
    case eDivisionType.MinorBeat_x3: // 24ths
      return this.#SubdivideMeasureMinorBeats(6);
    case eDivisionType.MinorBeat_x4: // 32nd
      return this.#SubdivideMeasureMinorBeats(8);
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

    // calculate swing pattern frac positions
    //const swingBasisQuarters = 0.5; // swing 8ths always
    const patternLengthQuarters = patternLengthMeasures * this.timeSig.quartersPerMeasure;
    ret.forEach(div => {
      div.beginPatternQuarter = div.beginPatternFrac * patternLengthQuarters;
      div.swingBeginPatternQuarter = DFMusic.ApplySwingToValueFrac(div.beginPatternQuarter, this.swing);
      div.endPatternQuarter = div.endPatternFrac * patternLengthQuarters;
      div.swingEndPatternQuarter = DFMusic.ApplySwingToValueFrac(div.endPatternQuarter, this.swing);
    });

    return ret.map(r => new SeqDivInfo(r));
  }

  GetLengthMajorBeats() {
    return this.GetSelectedPattern().lengthMajorBeats;
  }

  // this should always match this.GetPatternDivisionInfo().length
  GetPatternDivisionCount() {
    return this.GetSelectedPattern().GetDivCountForTimesig(this.timeSig);
  }

  // these are PATTERN quarters, not speed-adjusted quarters.
  // so if you need to account for pattern speed, caller needs to do it.
  GetPatternLengthQuarters() {
    const pattern = this.GetSelectedPattern();
    const patternLengthMeasures = pattern.lengthMajorBeats / this.timeSig.majorBeatsPerMeasure;
    return patternLengthMeasures * this.timeSig.quartersPerMeasure;
  }

  // // { title, description, tags }
  SetMetadata(data) {
    // TODO: validation (server)
    this.presetName = data.title;
    this.presetDescription = data.description;
    this.presetTags = data.tags;
    return true;
  }
  GetMetadata() {
    return {
      title: this.presetName,
          description: this.presetDescription,
          tags: this.presetTags,
    }
  }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
// remember this class is json serialized to clients in roomstate!
class SequencerDevice {
  constructor(params) {
    if (params)
      Object.assign(this, params);

    this.isPlaying ??= false;          // false while cueued
    //this.startFromAbsQuarter ??= null; // if set, then we are cueued to begin playing at this abs room beat.

    // shifts playback
    //this.baseAbsQuarter ??= 0; // NOT SPEED adjusted. this is an offset of the incoming global abs playhead

    //this.wasPlayingBeforeCue ??= false;
    //this.baseAbsQuarterBeforeCue ??= 0;

    this.livePatch = new SequencerPatch(this.livePatch);
  }

  //IsCueued() { return !!this.startFromAbsQuarter; }

  // // called on the server; returns info about the cue status to pass to clients.
  // Cue(currentAbsQuarter) {
  //   this.wasPlayingBeforeCue = this.isPlaying;
  //   this.baseAbsQuarterBeforeCue = this.baseAbsQuarter;

  //   this.isPlaying = false;

  //   const info = this.GetAbsQuarterInfo(currentAbsQuarter);
  //   const patternMeasure = info.patternQuarter / this.livePatch.timeSig.quartersPerMeasure;
  //   const patternMeasureFrac = DFUtil.getDecimalPart(patternMeasure);
  //   let measuresLeft = 1.0 - patternMeasureFrac;
  //   if (measuresLeft < 0.2) { // don't surprise users with insta-cue
  //     measuresLeft += 1;
  //   }
  //   const quartersLeft = measuresLeft * this.livePatch.timeSig.quartersPerMeasure;
  //   this.startFromAbsQuarter = currentAbsQuarter + quartersLeft;
  //   // for simplicity, do NOT allow base time to be in the future. it creates negative value scenarios we can easily avoid.
  //   this.baseAbsQuarter = this.startFromAbsQuarter - (this.livePatch.timeSig.quartersPerMeasure * 2); // guaranteed always in the past.

  //   return {
  //     startFromAbsQuarter : this.startFromAbsQuarter,
  //     baseAbsQuarter : this.baseAbsQuarter,
  //   };
  // }

  // CancelCue() {
  //   if (!this.IsCueued())
  //     return true;
  //   this.isPlaying = this.wasPlayingBeforeCue;
  //   this.startFromAbsQuarter = null;                    // cancel cue
  //   this.baseAbsQuarter = this.baseAbsQuarterBeforeCue; // cancel your new offset
  //   return true;
  // }

  // // called on client with server-given params. no need to do much really, just set state.
  // SetCueInfo(data) {
  //   this.wasPlayingBeforeCue = this.isPlaying;
  //   this.isPlaying = false;
  //   this.startFromAbsQuarter = data.startFromAbsQuarter;
  //   console.assert(!!data.baseAbsQuarter);
  //   this.baseAbsQuarter = data.baseAbsQuarter;
  //   return true;
  // }

  SetPlaying(b) {
    //this.CancelCue();
    if (this.isPlaying === !!b)
      return;

    if (!b) {
      // stop.
      this.isPlaying = false;
      return;
    }
    this.StartPlaying();
  }

  StartPlaying() {
    this.isPlaying = true;
    //this.startFromAbsQuarter = null;
  }

  IsPlaying() { return this.isPlaying; }


  // NOTE: return is SPEED-ADJUSTED
  // given abs quarter (absolute room beat, NOT speed-adjusted), calculate some pattern times.
  // this is where absolute playhead is converted to a pattern position.
  GetAbsQuarterInfo(absQuarter) {
    const patternLengthQuarters = this.livePatch.GetPatternLengthQuarters();

    //absQuarter -= this.baseAbsQuarter;
    //const nonSpeedAdjustedAbsQuarter = absQuarter;
    // adjust the playhead to speed-adjusted.
    absQuarter *= this.livePatch.speed;

    const absPatternFloat = absQuarter / patternLengthQuarters;
    const patternFrac = Math.abs(DFUtil.getDecimalPart(absPatternFloat));
    return {
      shiftedAbsQuarter : absQuarter, // so callers can now compare an abs playhead with the returned info
      //nonSpeedAdjustedAbsQuarter,
      absPatternFloat,
      patternLengthQuarters, // speed-adjusted; means you cannot just compare this to normal abs quarters.
      patternFrac,
      patternQuarter : patternFrac * patternLengthQuarters,
    };
  }

  InitPatch(presetID) {
    //this.CancelCue();
    this.livePatch = new SequencerPatch({presetID});
  }

  SerializePattern() {
    return JSON.stringify(this.livePatch.GetSelectedPattern());
  }

  GetPatternOpsForClearPattern() {
    return [ {type : eSeqPatternOp.ClearPattern} ];
  }

  GetPatchOpsForPastePatternJSON(json) {
    try {
      const pat = new SequencerPattern(JSON.parse(json));
      return this.GetPatchOpsForPastePattern(pat);
    } catch (e) {
      return null;
    }
  }

  GetPatchOpsForPastePattern(pattern) {
    return {
      op : "pastePattern",
      pattern : JSON.parse(JSON.stringify(pattern)),
    };
  }

  HasData() {
    return this.livePatch.GetSelectedPattern().HasData();
  }

  GetNoteLegend() {
    this.legendRef ??= "GeneralNotes";
    return globalSequencerConfig.legends[this.legendRef];
  }

  LoadPatch(patchObj) {
    //this.CancelCue();
    this.livePatch = new SequencerPatch(patchObj);
    return true;
  }

  LoadPattern(pattern) {
    this.livePatch.PasteSelectedPattern(pattern);
    return true;
  }

  // client-side; handles incoming server msgs
  SeqPresetOp(data, bank) {
    switch (data.op) {
    case "load": {
      let preset = bank.GetPresetById(data.presetID);
      if (!preset) {
        console.log(`unknown seq preset ID ${presetID}`);
        return false;
      }
      this.LoadPatch(preset);
      return true;
    }
    case "save": {
      // save the live patch to a presetID specified.
      this.livePatch.presetID = data.presetID; // when you save as, link live patch to the new one
      return bank.Save(data.presetID, data.author, data.savedDate, this.livePatch);
    }
    case "delete": {
      return bank.DeletePresetById(data.presetID);
    }
    case "pastePattern": {
      this.LoadPattern(data.pattern);
      return true;
    }
    case "pastePatch": {
      this.LoadPatch(data.patch);
      return true;
    }
    case "pasteBank": {
      bank.ReplaceBank(data.bank);
      return true;
    }
    case "SeqSetTranspose": {
      this.livePatch.SetTranspose(data.transpose);
      return true;
    }
    case "cue": {
      return this.SetCueInfo(data);
    }
    case "cancelCue":
      //return this.CancelCue();
      console.assert(false);
      return false;
    }
    return false;
  }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
// represents a link to a PatternNote. begin & end get
class UnderlyingNote {
  constructor(patternNote, patternLengthMajorBeats) {
    console.assert(!!patternLengthMajorBeats);
    this.patternNote = patternNote;
    this.midiNoteValue = patternNote.midiNoteValue;
    // ensure all note lengths are < pattern length to guarantee no overlapping / looping weirdness.
    // expected when the user temporarily makes their loop very short, then back long again for example.
    this.begin = patternNote.patternMajorBeat;
    this.length = Math.min(patternNote.lengthMajorBeats, patternLengthMajorBeats);
    this.end = this.begin + this.length;
  }
}

const eBorderType = {
  NoteOn : "NoteOn",
  NoteOff : "NoteOff",
  Continue : "Continue",
  Empty : "Empty",
};

/////////////////////////////////////////////////////////////////////////////////////////////////////////
// used:
// - by the GUI to render the sequencer grid
// - by the GUI to enable user interaction (regarding clicking velocity, note length etc)
// - by the sequencerplayer to schedule notes. if this is a note on, it will also contain its calculated note length in major beats.
class PatternViewCellInfo {

  // "thisNote" is the note which exists in underlyingNotes which is considered currently playing. can be null.
  // "previousNote" is the note which was considered playing before this one, to allow callers to extend its length
  constructor(patch, legend, midiNoteValue, underlyingNotes, div, thisNote, previousNote, previousNoteLenQuarters, previousNoteLenMajorBeats, beginBorderType, endBorderType, noteOnNotes, noteOnCell) {
    this.midiNoteValue = midiNoteValue;
    this.legend = legend;
    this.underlyingNotes = underlyingNotes; // list of the UnderlyingNotes in this cell.
    this.div = div;
    this.beginBorderType = beginBorderType;
    this.endBorderType = endBorderType;
    this.thisNote = thisNote;
    this.thisLengthQuarters = -2;   // not set yet. this is only valid for NOTE ON cells, and is a convenience for the seq player to know the duration of this note.
    this.thisLengthMajorBeats = -2; // not set yet.
    this.isMuted = patch.IsNoteMuted(midiNoteValue);
    this.noteOnNotes = noteOnNotes; // a list of UnderlyingNote which are note ons in this cell.
    this.noteOnCell = noteOnCell;   // link to the cell which represents the note on of this continued note.

    this.previousNote = previousNote;                       // major beats
    this.previousNoteLenQuarters = previousNoteLenQuarters; // if the user were to set prev note to this length, how long would it then be?
    this.previousNoteLenMajorBeats = previousNoteLenMajorBeats;

    this.#updateThisNoteProperties();

    // just to optimize; this is only necessary for note ons.
    if (beginBorderType === eBorderType.NoteOn) {
      this.noteOnCell = this;
      this.id = "pvci_" + this.underlyingNotes.reduce((rv, un) => rv + un.patternNote.id, "");
    }
  }

  #updateThisNoteProperties() {
    this.velocityIndex = this.thisNote?.patternNote?.velocityIndex ?? 0;
    const l = this.legend.find(l => l.midiNoteValue === this.midiNoteValue)?.velocitySet[this.velocityIndex];
    this.velocity = l?.vel ?? 89;
    this.cssClass = l?.cssClass ?? "";
  }

  // call to specify that this cell is actually a note off.
  MarkNoteOff(noteOnCell, lenQuarters, lenMajorBeats) {
    console.assert(this.beginBorderType !== eBorderType.Empty); // you can't note-off something that's not playing.
    noteOnCell.thisLengthQuarters = lenQuarters;
    noteOnCell.thisLengthMajorBeats = lenMajorBeats;
    this.thisLengthQuarters = lenQuarters;
    this.thisLengthMajorBeats = lenMajorBeats;
    this.endBorderType = eBorderType.NoteOff;
  }

  // used to set current & prev notes after we've populated stuff here. resolving ambiguity after looping to the beginning of the pattern.
  SetCurrentAndPrevNotes(currentNote, prevNote, previousNoteLenQuarters, previousNoteLenMajorBeats, noteOnCell) {
    // these are previously set to empty because we didn't know if there would be a continuation or not.
    this.endBorderType = this.beginBorderType = currentNote ? eBorderType.Continue : eBorderType.Empty;
    this.thisNote = currentNote;
    this.previousNote = prevNote;
    this.previousNoteLenQuarters = previousNoteLenQuarters;
    this.previousNoteLenMajorBeats = previousNoteLenMajorBeats;
    this.noteOnCell = noteOnCell;
    this.#updateThisNoteProperties();
  }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
// the sequencer pattern data holds all the data. it can have notes beyond the visible pattern bounds
// for example, or very precise note timings. so shorter lengths, and coarse division means notes should be "quantized" together
// selectively.
// let's create a pattern VIEW which reflects current playback settings and optimizes for display and sequencer playback
class SequencerPatternView {

  // so we have to do a LOT of processing, to get a lot of different information.
  // and at the same time we should try to be optimal.
  constructor(patch, legend) {
    const start = Date.now();
    //let nodesVisited = 0;

    this.legend = legend;
    this.divs = patch.GetPatternDivisionInfo(); // COLUMNS. each column holds a noteIndexMap, with a list of indices to this.notes.

    const pattern = patch.GetSelectedPattern();
    this.pattern = pattern;
    const patternLen = this.GetLengthMajorBeats();
    const patternLenQuarters = patch.GetPatternLengthQuarters();

    const t = pattern.notes
                  .filter(n => n.patternMajorBeat < patternLen) // filter out notes which are not in view.
                  .map(n => new UnderlyingNote(n, patternLen)); // this will correct note lengths to fit in the pattern
    const underlyingNotesByMidiVal = DFUtil.groupBy(t, un => un.midiNoteValue);

    // for each row,
    Object.entries(underlyingNotesByMidiVal).forEach(e => {
      const midiNoteValue = e[0] | 0;
      const underlyingNotes = e[1];

      // for each underlying note, calculate snapped divs representing note ons & note offs.
      underlyingNotes.forEach(un => {
        // populate un.divs with divs which THEORETICALLY represent this note. they will get chopped off later.
        // NB: the first entry of un.divs is where we determine its NOTE ON is.
        // and the last = note off.
        un.divs = [];
        let i = 0;

        // find best div of note ON. find the div which contains this note, and
        // choose whether to use the begin or end of the div as its note on.
        for (; i < this.divs.length; ++i) {
          //nodesVisited ++;
          const div = this.divs[i];
          // calc position of un.begin within the div 0-1.
          // ------|---------|------
          //       0         1
          const pos = ((un.begin + 0.01) - div.beginPatternMajorBeat) / div.lengthMajorBeats; // add tiny bias to ensure it lands securely in the safer (right) div.
          if (pos < 0 || pos > 1)
            continue;
          if (pos < 0.5) {
            break; // use this div begin.
          } else {
            i++; // use div end (i.e. the next div)
            break;
          }
        }

        if (i >= this.divs.length) {
          // notes can still be out of view but not get filtered by above, if they
          // begin within view, but get "snapped" out of view. if so, ignore them.
          return;
        }

        let noteOnIndex = i;
        un.divs.push(this.divs[i]);

        i++;

        // now walk divs and find the note off.
        for (; i < this.divs.length; ++i) {
          //nodesVisited ++;
          const div = this.divs[i];
          // calc portion of div covered by un.
          let cov = div.calcCoverageOfWindow(un.begin, un.end);
          if (cov < 0.5) {
            break; // note off
          }
          un.divs.push(div);
        }

        // if we did not find a note off yet, check if the note loops around the pattern.
        if (i === this.divs.length) {
          for (i = 0; i < noteOnIndex; ++i) {
            //nodesVisited ++;
            const div = this.divs[i];
            // calc portion of div covered by un.
            let cov = div.calcCoverageOfWindow(0, un.end - patternLen);
            if (cov < 0.5) {
              break; // note off
            }
            un.divs.push(div);
          }
        }
      }); // for each underlying note, calc div coverage

      // now we have a list of snapped underlying notes and the divs they cover.
      // we need to now walk through and group notes together so cells are represented by 1 note,
      // and calculate note ons / note offs to interrupt long notes which get interrupted.
      let currentNote = null;
      let currentNoteOnCell = null;
      let previousNote = null;      // for empty divs, keep track of the last playing note, so the user has the option to extend the length of that note.
      let noteLengthQuarters = 0;   // keep track of how long we've held the previous note, in QUARTERS, so if the user were to extend that length, how long would it be?
      let noteLengthMajorBeats = 0; // same in major beats. some things need this instead.
      let firstNoteOnIndex = null;
      for (let idiv = 0; idiv < this.divs.length; ++idiv) {
        const div = this.divs[idiv];
        const uns = [];
        let currentNoteAppearsAs = null;
        let noteOns = [];
        underlyingNotes.forEach(un => {
          if (!un.divs.some(d => {
                //            nodesVisited ++;
                return d.patternDivIndex === div.patternDivIndex;
              })) {
            return;
          }
          uns.push(un);                                             // found a note which appears.
          if (un.divs[0].patternDivIndex === div.patternDivIndex) { // is it a note-on?
            noteOns.push(un);
          }
          if (un.patternNote.id === currentNote?.patternNote?.id) {
            currentNoteAppearsAs = un;
          }
        });

        const anyNotesAppear = !!uns.length;
        const anyNoteOns = !!noteOns.length;
        const hasCurrentNote = !!currentNote;
        const currentNoteAppears = !!currentNoteAppearsAs;

        const noteOffCurrentNote = () => {
          console.assert(idiv > 0);
          this.divs[idiv - 1].rows[midiNoteValue].MarkNoteOff(currentNoteOnCell, noteLengthQuarters, noteLengthMajorBeats);
        };
        const createCell = (leftborder, rightborder) => {
          noteLengthQuarters += div.getLengthQuarters(patternLenQuarters);
          noteLengthMajorBeats += div.lengthMajorBeats;
          return div.rows[midiNoteValue] = new PatternViewCellInfo(patch, legend, midiNoteValue, uns, div,
                                                                   currentNote, previousNote, noteLengthQuarters, noteLengthMajorBeats,
                                                                   leftborder, rightborder, noteOns, currentNoteOnCell);
        }

        if (!anyNotesAppear) { // assume anyNoteOns = false & currentNoteAppears = false
          if (hasCurrentNote) {
            //       noteoff |---<empty>---|
            noteOffCurrentNote();
            previousNote = currentNote;
            currentNote = null;
          }
          createCell(eBorderType.Empty, eBorderType.Empty);
        }
        else {              // some notes appear
          if (anyNoteOns) { // can ignore currentNoteAppears from here
            // select the best note on. it's important to actually select this deterministically because
            // the client & server both make this decision indepedently.
            // so select the one with the higher velocity, or the one with longer length.
            const noteOn = noteOns.sort((a, b) => {
              //nodesVisited ++;
              if (a.velocityIndex < b.velocityIndex)
                return 1;
              if (a.velocityIndex > b.velocityIndex)
                return -1;
              return (a.lengthMajorBeats < b.lengthMajorBeats) ? 1 : -1;
            })[0];

            if (hasCurrentNote) {
              //  ...noteoff | noteon .... |
              noteOffCurrentNote();
            }
            previousNote = null; // don't need to keep prevnote info. there's no point tracking prevnote info there
            noteLengthQuarters = 0;
            noteLengthMajorBeats = 0;
            currentNote = noteOn;
            firstNoteOnIndex ??= idiv;
            currentNoteOnCell = createCell(eBorderType.NoteOn, eBorderType.Continue);
          } else { // notes appear but no note-ons
            if (hasCurrentNote) {
              if (currentNoteAppears) {
                // normal note continuation.
                //  ...continue|continue......|
                createCell(eBorderType.Continue, eBorderType.Continue);
              } else {
                // notes appear but no note-ons. we have a current note but it doesn't appear.
                // since we have a current note, ignore those notes
                //  ...note off|<empty>......|
                noteOffCurrentNote();
                previousNote = currentNote;
                currentNote = null;
                createCell(eBorderType.Empty, eBorderType.Empty);
              }
            } else {
              // don't have a current note, but notes exist, but no note-ons... it can be either
              // notes warpped to beginning of pattern, or notes which last longer than having been interrupted.
              // but then we're not sure which note is actually continuing. we'll have to handle this case after we have scanned the row.
              // so for now just mark which notes exist there and leave it. we will have to set current & prev notes in a next pass.
              createCell(eBorderType.Empty, eBorderType.Empty);
            }
          } // no note-ons in this div
        }   // do notes appear in this div
      };    // for each column

      // now scan from beginning of row to the first noteon, setting current/prev note, and noteoffs for looped note.
      for (let idiv = 0; idiv < firstNoteOnIndex; ++idiv) {
        //nodesVisited ++;
        const hasCurrentNote = !!currentNote;
        const hasPrevNote = !!previousNote;
        if (!hasCurrentNote && !hasPrevNote)
          break;
        const div = this.divs[idiv];
        const cell = div.rows[midiNoteValue];
        console.assert(!!cell);

        const currentNoteAppearsAs = hasCurrentNote && cell.underlyingNotes.find(un => {
                                                                                     //nodesVisited ++;
                                                                                     return un.patternNote.id === currentNote.patternNote.id});
        const currentNoteAppears = !!currentNoteAppearsAs;

        if (hasCurrentNote) {
          if (!currentNoteAppears) {
            // current note doesn't appear. send noteoff to prev cell (may be the end of the pattern!).
            // and rotate out current note
            // ---current--|<empty>
            this.divs.at(idiv - 1).rows[midiNoteValue].MarkNoteOff(currentNoteOnCell, noteLengthQuarters, noteLengthMajorBeats);
            previousNote = currentNoteAppearsAs;
            currentNote = null;
          }
        } // else { // we don't have a current note.
        noteLengthQuarters += div.getLengthQuarters(patternLenQuarters);
        noteLengthMajorBeats += div.lengthMajorBeats;
        cell.SetCurrentAndPrevNotes(currentNote, previousNote, noteLengthQuarters, noteLengthMajorBeats, currentNoteOnCell);
      }; // for each column

      // finally, if the current note still doesn't hvae a noteoff, it lasts exactly the entire pattern.
      // give it its noteoff.
      if (!!currentNote) {
        this.divs.at(firstNoteOnIndex - 1).rows[midiNoteValue].MarkNoteOff(currentNoteOnCell, noteLengthQuarters, noteLengthMajorBeats);
      }
    }); // for each row.

    // here we could remove the underlyingnotes.divs, because it's misleading.

    const duration = (Date.now() - start);
    //console.log(`generating pattern view took ${duration} ms`);
    //console.log(`  nodesVisited = ${nodesVisited}`);
  }

  dump() {
    let line = "    ";
    this.divs.forEach(div => {
      line += (div.patternDivIndex + "--------").substring(0, 7) + " ";
    });

    const borderToString = (b) => {
      if (b === eBorderType.Empty)
        return " ";
      if (b === eBorderType.NoteOn)
        return "[";
      if (b === eBorderType.NoteOff)
        return "]";
      if (b === eBorderType.Continue)
        return ">";
      return "??";
    };

    console.log(line);
    this.legend.forEach(ln => {
      line = (ln.midiNoteValue + "   ").substring(0, 3) + " ";
      this.divs.forEach(div => {
        const m = div.rows[ln.midiNoteValue];
        if (!m) {
          line += "        ";
          return;
        }

        let id = (m.thisNote?.patternNote?.id) ?? (m.previousNote?.patternNote?.id) ?? "  ";

        let len = m.previousNoteLenMajorBeats;
        if (m.beginBorderType === eBorderType.NoteOn)
          len = m.thisLengthMajorBeats;

        let pl = ("    " + len.toString()).slice(-3);
        line += borderToString(m.beginBorderType) + id + pl + borderToString(m.endBorderType) + " ";
      });
      console.log(line);

      // log note on cell
      line = "    ";
      this.divs.forEach(div => {
        const m = div.rows[ln.midiNoteValue];
        if (!m) {
          line += "        ";
          return;
        }
        if (m.noteOnCell) {
          line += "* ";
        } else {
          line += "  ";
        }
        line += (m.noteOnNotes.length.toString() + "       ").substring(0, 6);
      });
      console.log(line);
    });
  }

  HasViewCellID(id) {
    return this.divs.some(div => Object.entries(div.rows).some(e => e[1].id === id));
  }

  GetLengthMajorBeats() {
    return this.divs.at(-1).endPatternMajorBeat;
  }

  // looks at rows other than midiNoteValue, where a note on is assumed to be adding a new note on,
  // and finds the oldest notes which breach MaxNoteOnsPerColumn.
  // if midiNoteValues has more than SequencerSettings.MaxNoteOnsPerColumn elements, then everything will be cleared,
  // and it's up to the caller to reduce the # of note ons.
  GetPatternOpsToEnforceMaxNotesPerColumn(div, midiNoteValues) {
    let candidates = [];
    Object.values(div.rows).forEach(cell => {
      if (midiNoteValues.some(n => n === cell.midiNoteValue))
        return;
      candidates = candidates.concat(cell.noteOnNotes);
    });
    if (candidates.length <= (SequencerSettings.MaxNoteOnsPerColumn - 1))
      return [];
    candidates.sort((a, b) => a.patternNote.timestamp < b.patternNote.timestamp ? -1 : 1); // oldest to newest notes
    let overflowCount = (candidates.length + midiNoteValues.length) - SequencerSettings.MaxNoteOnsPerColumn;
    const removals = (overflowCount >= candidates.length) ? candidates : candidates.slice(0, overflowCount);
    return removals.map(un => {
      return {
        type : eSeqPatternOp.DeleteNote,
        id : un.patternNote.id,
      };
    });
  }

  GetPatternOpsForCellRemove(divInfo, note) {
    const patternViewCell = divInfo.rows[note.midiNoteValue];
    if (!patternViewCell?.thisNote)
      return null;
    // we know this cell has a note.
    const ret = [];
    patternViewCell.noteOnCell.noteOnNotes.forEach(un => {
      ret.push({
        type : eSeqPatternOp.DeleteNote,
        id : un.patternNote.id,
      });
    });
    return ret;
  }

  GetPatternOpsForCellRemoveMulti(divInfo, notes) {
    let ret = [];
    notes.forEach(note => {
      const x = this.GetPatternOpsForCellRemove(divInfo, {midiNoteValue:note});
      if (x) {
        ret = ret.concat(x);
      }
    });
    return ret;
  }


  // when a user clicks a cell, cycle through velocity indices as defined in the note legend.
  GetPatternOpsForCellToggle(divInfo, note, multiNotes, velIndex) {
    const patternViewCell = divInfo.rows[note.midiNoteValue];
    const addNotes = multiNotes.slice(0, SequencerSettings.MaxNoteOnsPerColumn); // if you're holding too many notes, choppaa
    const addSpec = addNotes.map(n => ({
      type : eSeqPatternOp.AddNote,
      midiNoteValue : n,
      velocityIndex : DFUtil.modulo(velIndex, note.velocitySet.length),
      patternMajorBeat : divInfo.beginPatternMajorBeat,
      lengthMajorBeats : divInfo.endPatternMajorBeat - divInfo.beginPatternMajorBeat,
    }));
    if (!patternViewCell?.thisNote) {
      // this cell has no "note on" or "continue" note. so just add
      return [ ...addSpec ].concat(this.GetPatternOpsToEnforceMaxNotesPerColumn(divInfo, addNotes));
    }
    // we know this cell has a note. we could either remove the note + add it at the correct velocity level, or delete.
    const ret = this.GetPatternOpsForCellRemoveMulti(divInfo, multiNotes);
    if (patternViewCell.velocityIndex === velIndex) { // is correct; just delete.
      //console.log(`delete vel ${velIndex}`);
      return ret;
    }
    //console.log(`delete + add vel ${velIndex} because old vel ${patternViewCell.velocityIndex} doesn't match desired val ${velIndex}`);
    ret = ret.concat(addSpec);
    return ret;
  }

  // when a user clicks a cell, cycle through velocity indices as defined in the note legend.
  // that operation will be applied for all notes in multiNotes
  GetPatternOpsForCellCycle(divInfo, note, multiNotes) {
    let patternViewCell = divInfo.rows[note.midiNoteValue];
    const velSetLen = note.velocitySet.length;
    const addNotes = multiNotes.slice(0, SequencerSettings.MaxNoteOnsPerColumn); // if you're holding too many notes, choppaa
    if (patternViewCell?.thisNote) {
      // note exists; cycle to next vel
      patternViewCell = patternViewCell.noteOnCell;
      divInfo = patternViewCell.div;
      let ret = this.GetPatternOpsForCellRemoveMulti(divInfo, multiNotes);
      if (patternViewCell.velocityIndex === (velSetLen - 1)) {
        // just delete the note, it's disappearing
        return ret;
      }
      // cycle vel & add it.

      ret = ret.concat(addNotes.map(n => ({
        type : eSeqPatternOp.AddNote,
        midiNoteValue : n,
        velocityIndex : DFUtil.modulo(patternViewCell.velocityIndex - 1, velSetLen),
        patternMajorBeat : divInfo.beginPatternMajorBeat,
        lengthMajorBeats : patternViewCell.thisLengthMajorBeats, // .divInfo.endPatternMajorBeat - divInfo.beginPatternMajorBeat,
      })));
      return ret;
    }

    // no note; add a fresh new one. if it overlaps the other, no worries the pattern view will take care of that.
    let ret = addNotes.map(n => ({
      type : eSeqPatternOp.AddNote,
      midiNoteValue : n,
      velocityIndex : 0,
      patternMajorBeat : divInfo.beginPatternMajorBeat,
      lengthMajorBeats : divInfo.lengthMajorBeats, // .divInfo.endPatternMajorBeat - divInfo.beginPatternMajorBeat,
    }));

    ret = ret.concat(this.GetPatternOpsToEnforceMaxNotesPerColumn(divInfo, addNotes));
    return ret;
  }

  GetPatternWithDurationsMultiplied(n) {
    const ret = new SequencerPattern(JSON.parse(JSON.stringify(this.pattern))); // create pattern copy
    const patternLenMajorBeats = this.GetLengthMajorBeats();
    ret.notes.forEach(note => {
      // find the div containing this note.
      const div = this.divs.find(div => {
        const ul = div.rows[note.midiNoteValue];
        if (!ul)
          return false;
        const ret = ul.noteOnCell?.noteOnNotes?.some(cell => cell.patternNote.id === note.id);
        return !!ret;
      });
      if (!div)
        return; // don't alter invisible notes because we can't reliably clamp lengths, so it's safer.
      const smallestLength = div.lengthMajorBeats;
      note.lengthMajorBeats = DFUtil.baseClamp(note.lengthMajorBeats * n, smallestLength, patternLenMajorBeats);
    });
    return ret;
  }

  // n is either -1 or 1. no other value works because i don't loop.
  GetPatternWithDurationDivsAdded(n) {
    const ret = new SequencerPattern(JSON.parse(JSON.stringify(this.pattern))); // create pattern copy
    const patternLenMajorBeats = this.GetLengthMajorBeats();
    ret.notes.forEach(note => {
      // find the div containing this note.
      let idiv = this.divs.findIndex(div => {
        const ul = div.rows[note.midiNoteValue];
        if (!ul)
          return false;
        const ret = ul.noteOnCell?.noteOnNotes?.some(cell => cell.patternNote.id === note.id);
        return !!ret;
      });
      if (idiv === -1)
        return; // don't alter invisible notes because we can't reliably clamp lengths, so it's safer.
      const smallestLength = this.divs[idiv].lengthMajorBeats;

      idiv = DFUtil.modulo(idiv + n, this.divs.length);
      const div = this.divs[idiv];
      const delta = Math.sign(n) * div.lengthMajorBeats;

      note.lengthMajorBeats = DFUtil.baseClamp(note.lengthMajorBeats + delta, smallestLength, patternLenMajorBeats);
    });
    return ret;
  }

  GetPatternOpsForSetNoteLengthPrevious(cell) {
    const ret = [ {
                   type : eSeqPatternOp.DeleteNote,
                   id : cell.previousNote.patternNote.id,
                 },
                  {
                    type : eSeqPatternOp.AddNote,
                    midiNoteValue : cell.midiNoteValue,
                    velocityIndex : cell.previousNote.patternNote.velocityIndex,
                    patternMajorBeat : cell.previousNote.patternNote.patternMajorBeat,
                    lengthMajorBeats : cell.previousNoteLenMajorBeats,
                  } ];
    return ret;
  }

  GetPatternOpsForSetNoteLengthCurrent(cell) {
    const ret = [ {
                   type : eSeqPatternOp.DeleteNote,
                   id : cell.thisNote.patternNote.id,
                 },
                  {
                    type : eSeqPatternOp.AddNote,
                    midiNoteValue : cell.midiNoteValue,
                    velocityIndex : cell.thisNote.patternNote.velocityIndex,
                    patternMajorBeat : cell.thisNote.patternNote.patternMajorBeat,
                    lengthMajorBeats : cell.previousNoteLenMajorBeats,
                  } ];
    return ret;
  }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
// this is little more than an array of SequencerPatch objects
class SeqPresetBank {
  constructor(params) {
    Object.assign(this, params);
    this.id ??= DFUtil.generateID();
    this.presets ??= [];
    this.presets = this.presets.map(o => new SequencerPatch(o));
  }

  Save(presetID, author, savedDate, patchObj) {
    const n = new SequencerPatch(patchObj);
    patchObj.presetID = presetID;
    n.presetID = presetID;
    if (author)
      n.presetAuthor = author; // client side doesn't need to set author/date info
    if (savedDate)
      n.presetSavedDate = new Date(savedDate);
    const existingIndex = this.presets.findIndex(p => p.presetID === presetID);
    if (existingIndex === -1) {
      this.presets.push(n);
      return true;
    }
    this.presets[existingIndex] = n;
    return true;
  }

  GetPresetById(presetID) {
    const obj = this.presets.find(p => p.presetID === presetID);
    if (!obj)
      return null;
    return new SequencerPatch(obj);
  }

  ReplaceBank(presetsArrayObj) {
    this.presets = presetsArrayObj.map(p => new SequencerPatch(p));
    return true;
  }

  ExportBankAsJSON() {
    return JSON.stringify(this.presets); // destructure/deref everything
  }

  DeletePresetById(presetID) {
    const existingIndex = this.presets.findIndex(p => p.presetID === presetID);
    if (existingIndex === -1)
      return true;
    this.presets.splice(existingIndex, 1);
    return true;
  }
}

function GetPatternView(patch, noteLegend) {
  let ret = patch.GetCachedView();
  if (ret)
    return ret;
  ret = new SequencerPatternView(patch, noteLegend);
  patch.SetCachedView(ret);
  return ret;
}


/////////////////////////////////////////////////////////////////////////////////////////////////////////
module.exports = {
  SequencerSettings,
  SequencerPatch,
  SequencerDevice,
  IsValidSequencerPatternIndex,
  IsValidSequencerSpeed,
  IsValidSequencerSwing,
  IsValidSequencerDivisionType,
  IsValidSequencerLengthMajorBeats,
  IsValidSequencerOctave,
  IsValidSequencerTranspose,
  eDivisionType,
  eSeqPatternOp,
  SequencerPatternView,
  IntegrateSequencerConfig,
  GetGlobalSequencerConfig,
  ResolveSequencerConfig,
  SeqPresetBank,
  GetPatternView,
  eBorderType,
};
