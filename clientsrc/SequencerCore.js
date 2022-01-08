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

function IsValidSequencerPatternIndex(i) {
   return Number.isInteger(i) && i >= 0 && i < SequencerSettings.PatternCount;
}

function IsValidSequencerSpeed(n) {
   return n > 0 && n < 100;
}

function IsValidSequencerSwing(n) {
   return n >= -1 && n <= 1;
}

function IsValidSequencerLengthMinorBeats(n) {
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

class SequencerNote {
   constructor(params) {
      if (params)
         Object.assign(this, params);

      console.assert(DFMusic.isValidNoteValue(this.noteVal));
      //this.velocity ??= 0.5;
      //this.lengthBeats ??= 1;
      //this.timeBeats ??= 0; // beat relative to pattern start
   }
}

class SequencerPattern {
   constructor(params) {
      if (params)
         Object.assign(this, params);

      if (!Array.isArray(this.notes))
         this.notes = [];
      this.notes = this.notes.map(n => new SequencerNote(n));

      this.lengthMinorBeats ??= 8;
      this.divisionType ??= eDivisionType.MinorBeat;
   }

   hasData() {
      return this.notes.length > 0;
   }
}

// the sequencer pattern data holds all the data. it can have notes beyond the visible pattern bounds
// for example, or very precise note timings. so shorter lengths, and coarse division means notes should be "quantized" together
// selectively.
// let's create a pattern view which reflects current playback settings and optimizes for display
class SequencerPatternView {
   // map divs to note array
}

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
   SetLengthMinorBeats(lengthMinorBeats) {
      this.patterns[this.selectedPatternIdx].lengthMinorBeats = lengthMinorBeats;
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
      const ret = [];
      //let measureDivIndex = 0;
      mbiArray.forEach(minbi => {
         // subdivide minbi.
         minorBeatDurationInMeasures = minbi.endMeasureFrac - minbi.beginMeasureFrac;
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
      const patternLengthMeasures = pattern.lengthMinorBeats / this.timeSig.minorBeatsPerMeasure;
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
               beginPatternFrac: (iMeasure / patternLengthMeasures) + (div.beginMeasureFrac / patternLengthMeasures),
               endPatternFrac: (iMeasure / patternLengthMeasures) + (div.endMeasureFrac / patternLengthMeasures),
            });
         }));
      }

      // partial measure. be inclusive, so if you require .51 mesaures, take any div which includes .51. don't take only whole portions.
      ret = ret.concat(measureDivisionInfo.filter(div => div.beginMeasureFrac < partialMeasureFrac).map(div => {
         return Object.assign(Object.assign({}, div), {
            patternMeasure : wholeMeasures,
            patternDivIndex : patternDivIndex++,
            beginPatternFrac: (wholeMeasures / patternLengthMeasures) + (div.beginMeasureFrac / patternLengthMeasures),
            endPatternFrac: (wholeMeasures / patternLengthMeasures) + (div.endMeasureFrac / patternLengthMeasures),
         });
      }));
      return ret;
   }

   GetLengthMinorBeats() {
      return this.GetSelectedPattern().lengthMinorBeats;
   }

   // SubdivsToDivs(subdivs) {
   //    return subdivs * this.GetDivisions();
   // }

   // BeatsToDivs(beats) {
   //    return this.SubdivsToDivs(this.timeSig.BeatsToSubdivs(beats));
   // }

   // takes float beats-in-measure (in 4/4, thats [0,3]), and returns the float division index.
   // MeasureBeatToDiv(b) {
   //    return
   // }

   // for getting info to display pattern grid
   // GetInfoAtPatternDiv(idiv) {
   //    //
   // }

   GetPatternDivisionCount() {
      return this.GetMeasureDivisionInfo().length;
   }

   GetPatternFracAtAbsQuarter(absQuarter) {
      const pattern = this.GetSelectedPattern();
      // could theoretically be precalculated
      const patternLengthMeasures = pattern.lengthMinorBeats / this.timeSig.minorBeatsPerMeasure;
      const patternLengthQuarters = patternLengthMeasures * this.timeSig.quartersPerMeasure;

      const speedAdjustedQuarter = absQuarter * this.speed;

      const absPatternPosition = speedAdjustedQuarter / patternLengthQuarters;
      return DFUtil.getDecimalPart(absPatternPosition);
   }

   // for getting info about playhead / global musical time
   //GetInfoAtAbsBeat(absBeat) {
      // const pattern = this.GetSelectedPattern();

      // // could theoretically be precalculated
      // const patternLengthMeasures = pattern.lengthMinorBeats / this.timeSig.subdivCount;
      // const patternLengthBeats = patternLengthMeasures * this.timeSig.beatsPerMeasure;

      // // create a list of divisions

      // // consider swing
      // const speedAdjustedBeat = absBeat * this.speed;
      // const absLoop = speedAdjustedBeat / patternLengthBeats;
      // const patternBeat = DFUtil.getDecimalPart(absLoop) * patternLengthBeats;
      // const patternTime = this.timeSig.getMusicalTimeForBeat(patternBeat);
      // const patternMeasure = patternBeat / this.timeSig.beatsPerMeasure;
      // //const patternMeasureBeat = DFUtil.getDecimalPart(patternMeasure) * this.timeSig.beatsPerMeasure;
      // const patternDiv = this.GetMeasureDivisions() * patternMeasure; //patternMeasureBeat / this.GetPatternDivisions() .MeasureBeatToDiv(patternMeasureBeat);
      // const measureDiv = this.MeasureToDivision(patternMeasure);
      // // ms until next div
      // // ms until next subdiv
      // return {
      //     // measureDiv
      //     // minorBeatDiv

      //     // patternLengthMeasures,
      //     // patternLengthBeats,
      //     // speedAdjustedBeat,
      //     // absLoop,
      //     // patternBeat,
      //     // patternTime,
      //     // patternMeasure,
      //     //patternMeasureBeat,
      //     //patternDiv,
      // };
   //}
}

class SequencerDevice {
   constructor(params) {
      if (params)
         Object.assign(this, params);

      // note legend

      this.isPlaying ??= false;

      this.livePatch = new SequencerPatch(this.livePatch);

      if (!Array.isArray(this.presetList))
         this.presetList = [];
      this.presetList = this.presetList.map(p => new SequencerPatch(p));
   }

   // returns [{name, midiNoteValue, cssClass}]
   GetNoteLegend() {
      return DFMusic.MidiNoteInfo.filter(n => n.midiNoteValue > 60 && n.midiNoteValue < 80).reverse();
   }
}

module.exports = {
   SequencerSettings,
   SequencerDevice,
   IsValidSequencerPatternIndex,
   IsValidSequencerSpeed,
   IsValidSequencerSwing,
   IsValidSequencerDivisionType,
   IsValidSequencerLengthMinorBeats,
   eDivisionType,
};
