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
   PatternCount: 4,
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

function IsValidSequencerDivisions(n) {
   return Number.isInteger(n) && n > 0 && n < 64;
}

function IsValidSequencerLengthSubdivs(n) {
   return Number.isInteger(n) && n > 0 && n < 64;
}



class SequencerNote
{
   constructor(params) {
      if (params)
         Object.assign(this, params);
      
      console.assert(DFMusic.isValidNoteValue(this.noteVal));
      this.velocity ??= 0.5;
      this.lengthBeats ??= 1;
      this.timeBeats ??= 0; // beat relative to pattern start
   }
}

class SequencerPattern
{
   constructor(params) {
      if (params)
         Object.assign(this, params);
      
      if (!Array.isArray(this.notes))
         this.notes = [];
      this.notes = this.notes.map(n => new SequencerNote(n));

      this.lengthSubdivs ??= 8;
      this.divisions ??= 2;
   }

   hasData() {
      return this.notes.length > 0;
   }
}

// the sequencer pattern data holds all the data. it can have notes beyond the visible pattern bounds 
// for example, or very precise note timings. so shorter lengths, and coarse division means notes should be "quantized" together
// selectively.
// let's create a pattern view which reflects current playback settings and optimizes for display
class SequencerPatternView
{
   // map divs to note array
}


// this encapsulates the configuration for the whole sequencer
// it gets serialized as saveable presets
class SequencerPatch
{
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
         this.patterns = [...new Array(SequencerSettings.PatternCount)].map(_ => new SequencerPattern());
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
      if (i === -1) return;

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
   SetDivisions(divisions) {
      this.patterns[this.selectedPatternIdx].divisions = divisions;
   }
   SetLengthSubdivs(lengthSubdivs) {
      this.patterns[this.selectedPatternIdx].lengthSubdivs = lengthSubdivs;
   }

   SetTimeSig(ts) {
      this.timeSig = ts;
   }

   GetSelectedPattern() {
      return this.patterns[this.selectedPatternIdx];
   }

   GetDivisions() {
      return this.GetSelectedPattern().divisions;
   }
   GetLengthSubdivs() {
      return this.GetSelectedPattern().lengthSubdivs;
   }

   SubdivsToDivs(subdivs) {
      return subdivs * this.GetDivisions();
   }

   BeatsToDivs(beats) {
      return this.SubdivsToDivs(this.timeSig.BeatsToSubdivs(beats));
   }

   GetInfoAtAbsBeat(absBeat) {
      // consider some kind of offset? (todo)
      // consider swing
      const pattern = this.GetSelectedPattern();
      const speedAdjustedBeat = absBeat * this.speed;
      const patternLengthMeasures = pattern.lengthSubdivs / this.timeSig.subdivCount;
      const patternLengthBeats = patternLengthMeasures * this.timeSig.beatsPerMeasure;
      const absLoop = speedAdjustedBeat / patternLengthBeats;
      const patternBeat = DFUtil.getDecimalPart(absLoop) * patternLengthBeats;
      const patternTime = this.timeSig.getMusicalTimeForBeat(patternBeat);
      const patternDiv = this.BeatsToDivs(patternBeat);
      return {
         speedAdjustedBeat,
         patternLengthMeasures,
         patternLengthBeats,
         absLoop,
         patternBeat,
         patternTime,
         patternDiv,
      };
   }
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
      return DFMusic.MidiNoteInfo.filter(n => n.midiNoteValue > 60 && n.midiNoteValue < 80);
   }
}




module.exports = {
   SequencerSettings,
   SequencerDevice,
   IsValidSequencerPatternIndex,
   IsValidSequencerSpeed,
   IsValidSequencerSwing,
   IsValidSequencerDivisions,
   IsValidSequencerLengthSubdivs,
};

