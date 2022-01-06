const DFUtil = require('./dfutil');
const DFMusic = require("./DFMusic");

class SequencerPattern
{
   // list of notes [noteval, time(measure:subdiv), velocity, length(subdiv)]
   // length measures
   // division
}


// this encapsulates the configuration for the whole sequencer
// it gets serialized as saveable presets
class SequencerPatch
{
   constructor(params) {
      if (params)
         Object.assign(this, params);
      // timesig
      // preset info: name, desc, tags, author, date
      // selected pattern
      // patterns

      // speed
      // swing
      // is playing
      
      // muted note list
   }
}


class SequencerConfig {
   constructor(params) {
      if (params)
         Object.assign(this, params);

      // and ensure values/defaults
      // note names
      this.livePatch = new SequencerPatch(this.livePatch);
      // preset list
   }

   // returns [{name, midivalue, cssclass, velocities}]
   GetNoteLegend() {
      //
   }
}


class SequencerPatternView
{
}



module.exports = {
   SequencerConfig,
};

