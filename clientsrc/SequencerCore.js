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
  MaxDivs : 65,
  MaxNotesPerColumn : 6,
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

function IsValidSequencerTranspose(transpose) {
  transpose = parseInt(transpose);
  if (transpose < -12) return false;
  if (transpose > 12) return false;
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
    // todo: enforce SequencerSettings.MaxNotesPerColumn; currently only enforecd on client
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
noteMap:{}
patternDivIndex:0
patternMeasure:0
*/
class SeqDivInfo {
  constructor(params) {
    Object.assign(this, params);
    this.noteMap = {}; // convenience for pattern view.
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

  // for pattern view div info
  GetNoteCount() {
    return Object.values(this.noteMap).reduce((a, b) => a + ((b.underlyingNotes?.length) ?? 0), 0);
  }
  GetSomeUnderlyingNoteIDsExcept(idsToExclude, count) {
    if (count < 1) return [];
    // create list of underlying notes, sorted by date created
    let un = [];
    Object.values(this.noteMap).forEach(pvn => {
      const matchingUNs = pvn.underlyingNotes.filter(un => !idsToExclude.some(ex => ex === un.id));
      un = un.concat(matchingUNs);
    });

    un.sort((a,b) => a.timestamp < b.timestamp ? -1 : 1);

    const y = un.slice(0, count);
    const ret = y.map(x => x.id);
    return ret;
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
    if (this.#cachedViewDirty) return null;
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

  // can return nullish if out of range / should not be played.
  AdjustMidiNoteValue(midiNoteValue) {
    let ret = midiNoteValue;
    midiNoteValue += this.octave * 12;
    midiNoteValue += this.transpose;
    // todo: other transposition?
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
    if (!IsValidSequencerTranspose(transpose)) return false;
    this.#cachedViewDirty = true;
    this.transpose = parseInt(transpose);
    return true;
  }

  GetTranspose() {
    return this.transpose;
  }

  #SubdivideMeasureMinorBeats(mbiArray, n) {
    n = Math.ceil(n); // if non-integral subdivisions, subdivide further. handles cases like 6/8.
    const ret = [];
    //let measureDivIndex = 0;
    mbiArray.forEach(minbi => {
      // subdivide minbi.
      const minorBeatsInThisMajorBeat = this.timeSig.majorBeatInfo[minbi.majorBeatIndex].minorBeats.length;
      const minorBeatDurationInMeasures = minbi.endMeasureFrac - minbi.beginMeasureFrac;
      const divDurationInMeasures = minorBeatDurationInMeasures / n;
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
    return this.GetPatternDivisionInfo().length;
  }

  // must account for speed!
  GetPatternLengthQuarters() {
    const pattern = this.GetSelectedPattern();
    const patternLengthMeasures = pattern.lengthMajorBeats / this.timeSig.majorBeatsPerMeasure;
    return patternLengthMeasures * this.timeSig.quartersPerMeasure / this.speed;
  }

  GetPatternFracAtAbsQuarter(absQuarter) {
    const i = this.GetAbsQuarterInfo(absQuarter);
    return i.patternFrac;
  }

  // given abs quarter (absolute room beat), calculate some pattern times.
  GetAbsQuarterInfo(absQuarter) {
    const patternLengthQuarters = this.GetPatternLengthQuarters();
    const absPatternFloat = absQuarter / patternLengthQuarters;
    const patternFrac = DFUtil.getDecimalPart(absPatternFloat);
    return {
      absPatternFloat,
      patternLengthQuarters,
      patternFrac,
      patternQuarter : patternFrac * patternLengthQuarters,
    };
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

    this.isPlaying ??= false;

    this.livePatch = new SequencerPatch(this.livePatch);
    //console.assert(!!this.legendRef); <-- you may not have a legendref if this seq device is inactive/inaccessible/allowed.
  }

  InitPatch(presetID) {
    this.livePatch = new SequencerPatch({presetID});
    console.log(`initpatch; livepatch now ID ${this.livePatch.presetID}`);
  }

  SerializePattern() {
    return JSON.stringify(this.livePatch.GetSelectedPattern());
  }

  GetPatternOpsForClearPattern() {
    return [ {type : eSeqPatternOp.ClearPattern} ];
  }

  GetPatternOpsForPastePattern(json) {
    try {
      const ret = [ {type : eSeqPatternOp.ClearPattern} ]; // start by clearing pattern.
      const pat = new SequencerPattern(JSON.parse(json));
      pat.notes.forEach(note => {
        ret.push({
          type : eSeqPatternOp.AddNote,
          midiNoteValue : note.midiNoteValue,
          velocityIndex : note.velocityIndex,
          patternMajorBeat : note.patternMajorBeat,
          lengthMajorBeats : note.lengthMajorBeats,
        });
      });

      return ret;
    } catch (e) {
      return null;
    }
  }

  HasData() {
    return this.livePatch.GetSelectedPattern().HasData();
  }

  GetNoteLegend() {
    this.legendRef ??= "GeneralNotes";
    return globalSequencerConfig.legends[this.legendRef];
  }

  LoadPatch(patchObj) {
    this.livePatch = new SequencerPatch(patchObj);
    return true;
  }

  SeqPresetOp(data, bank) {
    switch (data.op) {
      case "load":
        {
          let preset = bank.GetPresetById(data.presetID);
          if (!preset) {
            console.log(`unknown seq preset ID ${presetID}`);
            return false;
          }
          this.LoadPatch(preset);
          return true;
        }
      case "save":
        {
          // save the live patch to a presetID specified.
          this.livePatch.presetID = data.presetID; // when you save as, link live patch to the new one
          return bank.Save(data.presetID, data.author, data.savedDate, this.livePatch);
        }
      case "delete":
        {
          return bank.DeletePresetById(data.presetID);
        }
      case "pastePatch":
        {
          this.LoadPatch(data.patch);
          return true;
        }
      case "pasteBank":
        {
          bank.ReplaceBank(data.bank);
          return true;
        }
      case "SeqSetTranspose":
        {
          this.livePatch.SetTranspose(data.transpose);
          return true;
        }
    }
    return false;
  }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
/*
beginNoteContinue:false
beginNoteOn:true
cssClass:' vel0 genvel0'
endNoteContinue:false
endNoteOff:true
hasNote:true
midiNoteValue:69
underlyingNotes:(1) [SequencerNote]
velocity:100
velocityIndex:0
noteID
*/
class PatternViewNote {
  constructor(midiNoteValue, patch) {
    this.midiNoteValue = midiNoteValue;

    this.hasNote = false;
    this.beginNoteOn = false;       // beginning of cell = note on
    this.beginNoteContinue = false; // beginning of cell = continuation
    this.endNoteOff = false;        // end of cell = note off
    this.endNoteContinue = false;
    this.id = "pvn_";
    this.isMuted = patch.IsNoteMuted(midiNoteValue);

    // time & length are assumed to be beginning & end of this cell.

    this.underlyingNotes = [];
  }

  // note is of SequencerNote
  Integrate(div, note, legend) {
    this.hasNote = true;

    // TODO: this can be much more sophisticated

    // the ID is important, because it's how the scheduler knows whether a note should get noteoff or not.
    // when the timer hits,
    // 1. pattern data is cleared
    // 2. any notes which were still playing will either:
    //    a. get their noteoff rescheduled if they still exist on the patternview
    //    b. or, get noteoff immediately if it's been deleted (not found in the current patternview)
    //
    // if we use uniqueIDs, it means there's no way to know if a note existing previously. all notes playing at the time
    // of the timerproc will be killed because we assume they've been deleted.
    //
    // that could be mitigated by caching patternviews, but i don't like the complexity of forming that relationship.
    //
    // we could use the ID of just 1 note too, but there are scenarios ( think user changing speeds or timesigs) where
    // notes will get shuffled into other bins and basically, the most "safe" is to hash all underlying notes.
    // well the MOST safe would be to hash underlying notes AND pattern config like speed and divs bpm, etc, anything that could
    // potentially change arrangement. but that will be handled in other more musical ways in the server sequencerplayer.

    this.id += note.id; // in order to know if this is a new note, the ID must be a hash of all underlying notes
    this.beginNoteOn = true;
    this.endNoteOff = true;
    this.velocityIndex = note.velocityIndex;
    this.underlyingNotes.push(note);
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

    // place each pattern note in the correct div-note cell
    pattern.notes.forEach(note => {
      this.#bringNoteIntoView(patch, note, legend);
    });

    const duration = (Date.now() - start);
    //console.log(`generating pattern view took ${duration} ms`);
  }

  HasViewNoteID(id) {
    return this.divs.some(div => Object.entries(div.noteMap).some(e => e[1].id === id));
  }

  // when a user clicks a cell, cycle through velocity indices as defined in the note legend.
  GetPatternOpsForCellCycle(divInfo, note, velIndexDelta) {
    const patternViewNote = divInfo.noteMap[note.midiNoteValue];
    let newNoteCount = divInfo.GetNoteCount();
    let idsDeleted = [];
    if (patternViewNote?.hasNote) {
      // remove note & add new with cycled vel
      const ret = [];
      // we don't modify notes, we remove & add them. it's simpler this way, and resolves some ambiguities regarding underlying note data.
      newNoteCount--;
      patternViewNote.underlyingNotes.forEach(n => {
        idsDeleted.push(n.id);
        ret.push({
          type : eSeqPatternOp.DeleteNote,
          id : n.id,
        });
      });

      const newVelIndex = patternViewNote.velocityIndex + velIndexDelta;
      if (newVelIndex < note.velocitySet.length) { // if there are velocity indices left to cycle through, add it. otherwise just remove.
        newNoteCount++;
        ret.push({
          type : eSeqPatternOp.AddNote,
          midiNoteValue : note.midiNoteValue,
          velocityIndex : newVelIndex,
          patternMajorBeat : divInfo.beginPatternMajorBeat,
          lengthMajorBeats : divInfo.endPatternMajorBeat - divInfo.beginPatternMajorBeat,
        });
      }

      const overflowIDs = divInfo.GetSomeUnderlyingNoteIDsExcept(idsDeleted, newNoteCount - SequencerSettings.MaxNotesPerColumn);
      overflowIDs.forEach(noteID => {
        ret.push({
          type : eSeqPatternOp.DeleteNote,
          id : noteID,
        });
      });

      return ret;
    }

    // add note.
    const ret = [ {
      type : eSeqPatternOp.AddNote,
      midiNoteValue : note.midiNoteValue,
      velocityIndex : DFUtil.modulo(velIndexDelta - 1, note.velocitySet.length),
      patternMajorBeat : divInfo.beginPatternMajorBeat,
      lengthMajorBeats : divInfo.endPatternMajorBeat - divInfo.beginPatternMajorBeat,
    } ];
    newNoteCount++;

    const overflowIDs = divInfo.GetSomeUnderlyingNoteIDsExcept(idsDeleted, newNoteCount - SequencerSettings.MaxNotesPerColumn);
    overflowIDs.forEach(noteID => {
      ret.push({
        type : eSeqPatternOp.DeleteNote,
        id : noteID,
      });
    });

    return ret;
  }

  // when a user clicks a cell, cycle through velocity indices as defined in the note legend.
  GetPatternOpsForCellToggle(divInfo, note, velIndex) {
    const patternViewNote = divInfo.noteMap[note.midiNoteValue];
    let newNoteCount = divInfo.GetNoteCount();
    let idsDeleted = [];
    if (patternViewNote?.hasNote) {
      // remove note & add new with cycled vel
      const ret = [];
      patternViewNote.underlyingNotes.forEach(n => {
        idsDeleted.push(n.id);
        ret.push({
          type : eSeqPatternOp.DeleteNote,
          id : n.id,
        });
      });
      return ret;
    }

    // add note.
    const ret = [ {
      type : eSeqPatternOp.AddNote,
      midiNoteValue : note.midiNoteValue,
      velocityIndex : DFUtil.modulo(velIndex, note.velocitySet.length),
      patternMajorBeat : divInfo.beginPatternMajorBeat,
      lengthMajorBeats : divInfo.endPatternMajorBeat - divInfo.beginPatternMajorBeat,
    } ];
    newNoteCount++;

    const overflowIDs = divInfo.GetSomeUnderlyingNoteIDsExcept(idsDeleted, newNoteCount - SequencerSettings.MaxNotesPerColumn);
    overflowIDs.forEach(noteID => {
      ret.push({
        type : eSeqPatternOp.DeleteNote,
        id : noteID,
      });
    });

    return ret;
  }

  GetPatternOpsForCellRemove(divInfo, note) {
    const patternViewNote = divInfo.noteMap[note.midiNoteValue];
    if (patternViewNote?.hasNote) {
      // remove note & add new with cycled vel
      const ret = [];
      // we don't modify notes, we remove & add them. it's simpler this way, and resolves some ambiguities regarding underlying note data.
      patternViewNote.underlyingNotes.forEach(n => {
        ret.push({
          type : eSeqPatternOp.DeleteNote,
          id : n.id,
        });
      });
      return ret;
    }
    return null;
  }

  #bringNoteIntoView(patch, note, legend) {
    let div = DFUtil.findNearest(this.divs, (div) => Math.abs(div.beginPatternMajorBeat - note.patternMajorBeat));
    let viewNote = null;
    if (note.midiNoteValue in div.noteMap) {
      viewNote = div.noteMap[note.midiNoteValue];
    } else {
      viewNote = new PatternViewNote(note.midiNoteValue, patch);
      div.noteMap[note.midiNoteValue] = viewNote;
    }
    viewNote.Integrate(div, note, legend);
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
    if (author) n.presetAuthor = author; // client side doesn't need to set author/date info
    if (savedDate) n.presetSavedDate = new Date(savedDate);
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
    if (!obj) return null;
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
  if (ret) return ret;
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
};
