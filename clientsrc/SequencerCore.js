const DFUtil = require('./dfutil');
const DFMusic = require("./DFMusic");

const SequencerSettings = {
   PatternCount: 4,
};

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

      this.lengthBeats ??= 8;
      this.divisions ??= 2;
   }
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
         this.patterns = [];
      } else {
         this.patterns = this.patterns.map(p => new SequencerPattern(p));
      }

      this.speed ??= 1;
      this.swing ??= 0; // -1 to +1
      
      if (!Array.isArray(this.mutedNotes))
         this.mutedNotes = [];
   }
}


class SequencerDevice {
   constructor(params) {
      if (params)
         Object.assign(this, params);

      // note legend
      
      this.isPlaying = false;

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
};

