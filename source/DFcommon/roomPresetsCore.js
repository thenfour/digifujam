// based a lot on SeqPresetBank

const DFUtil = require('./dfutil');

const RoomPresetSettings = {
  NameMaxLen: 30,
  DescriptionMaxLen: 300,
  TagsMaxLen: 100,
};

function IsValidRoomPatchName(s) {
  if (!s) return false;
  return s.length < RoomPresetSettings.NameMaxLen;
}

function IsValidRoomPatchDescription(s) {
  if (!s) return false;
  return s.length < RoomPresetSettings.DescriptionMaxLen;
}

function IsValidRoomPatchTags(s) {
  if (!s) return false;
  return s.length < RoomPresetSettings.TagsMaxLen;
}



class InstSeqSelection
{
  #roomState;
  #originalPatch;

  constructor(roomState, roomPatch) {
    // 2 scenarios:
    // loading a room patch, initialize with everything MINUS what's currently taken.
    // saving a room patch, initialize with instruments which are taken, or have sequencers playing.
    this.#roomState = roomState;
    this.#originalPatch = roomPatch;
    this.instrumentIDs = [];
    this.sequencerInstrumentIDs = [];

    if (roomPatch) {
      // you are loading a selection. start with everything that's in the patch, only if it's valid.
      this.SelectAll();
    } else {
      this.SelectAuto();
    }
  }

  SelectAll() {
    if (this.#originalPatch) {
      this.instrumentIDs = [...new Set(Object.keys(this.#originalPatch.instPatches))].filter(instrumentID => InstSeqSelection.InstrumentIDIsSelectableInstrument(this.#roomState, instrumentID));
      this.sequencerInstrumentIDs = [...new Set(Object.keys(this.#originalPatch.seqPatches))].filter(instrumentID => InstSeqSelection.InstrumentIDIsSelectableSequencer(this.#roomState, instrumentID));
    } else {
      this.instrumentIDs = this.#roomState.instrumentCloset
        .filter(inst => InstSeqSelection.InstrumentIDIsSelectableInstrument(this.#roomState, inst.instrumentID))
        .map(inst => inst.instrumentID);

      this.sequencerInstrumentIDs = this.#roomState.instrumentCloset
        .filter(inst => InstSeqSelection.InstrumentIDIsSelectableSequencer(this.#roomState, inst.instrumentID))
        .map(inst => inst.instrumentID);
    }
  }

  SelectNone() {
    this.instrumentIDs = [];
    this.sequencerInstrumentIDs = [];
  }

  SelectAuto() {
    // auto-populate.
    this.instrumentIDs = [];
    this.sequencerInstrumentIDs = [];
    this.#roomState.instrumentCloset.forEach(inst => {
      if (InstSeqSelection.ShouldBeIncludedInDefaultInstSelection(inst)) {
        this.instrumentIDs.push(inst.instrumentID);
      }
      if (InstSeqSelection.ShouldBeIncludedInDefaultSeqSelection(inst)) {
        this.sequencerInstrumentIDs.push(inst.instrumentID);
      }
    });
  }

  toString() {
    return JSON.stringify(this);
  }

  static InstrumentIDIsSelectableInstrument(roomState, instrumentID) {
    const i = roomState.FindInstrumentById(instrumentID);
    if (!i) return false;
    return i.instrument.supportsPresets;
  }

  static InstrumentIDIsSelectableSequencer(roomState, instrumentID) {
    const i = roomState.FindInstrumentById(instrumentID);
    if (!i) return false;
    return i.instrument.supportsPresets;
  }

  static ShouldBeIncludedInDefaultSeqSelection(instrument) {
    if (!instrument.allowSequencer) return false;
    if (instrument.sequencerDevice.IsPlaying()) return true;
    return instrument.sequencerDevice.HasData();
  }

  static ShouldBeIncludedInDefaultInstSelection(instrument) {
    if (instrument.controlledByUserID) return true;
    return InstSeqSelection.ShouldBeIncludedInDefaultSeqSelection(instrument);
  }

}





// SERIALIZABLE
class RoomPresetMetadata {
  constructor(params) {
    Object.assign(this, params);
    
    // current metadata for room
    this.name ??= "untitled";
    this.description ??= "";
    this.tags ??= "";
    this.bpm ??= 100;
    this.author ??= ""; // set by server on save.
    if (this.date) { // set by server on save.
      this.date = new Date(this.date);
    }
    if (isNaN(this.date)) {
      this.date = new Date();
    }
    
  }
}



// SERIALIZABLE
class CompactRoomPreset {
  constructor(params) {
    if (params.metadata) {
      console.log(`!! wrong type of object to compact!`);
      this.presetID = params.presetID;
    } else {
      Object.assign(this, params);
    }

    console.assert(this.presetID);

    this.name ??= "untitled";
    this.description ??= "";
    this.tags ??= "";
    this.bpm ??= 100;
    this.author ??= ""; // set by server on save.
    if (this.date) { // set by server on save.
      this.date = new Date(this.date);
    }
    if (isNaN(this.date)) {
      this.date = new Date();
    }
  }
}



// SERIALIZABLE
// contains instrument patches, sequencer patches, and metadata for the room.
class RoomPreset {
  constructor(params) {
    Object.assign(this, params);
    this.presetID ??= DFUtil.generateID();
    this.metadata = new RoomPresetMetadata(this.metadata);

    this.instPatches ??= {};
    this.seqPatches ??= {}; // instrumentIDs and seq patches
    this.seqPlaying ??= []; // instrumentIDs which are ON
  }

  GenerateUniquePatchID() {
    this.presetID = DFUtil.generateID();
  }

  // selection of InstSeqSelection
  KeepOnlySelected(selection) {
    const instIDsToDelete = [];
    Object.keys(this.instPatches).forEach(k => {
      const isSelected = !!selection.instrumentIDs.find(iid => iid === k);
      if (!isSelected) instIDsToDelete.push(k);
    });
    instIDsToDelete.forEach(iid => delete this.instPatches[iid]);
    
    const seqInstIDsToDelete = [];
    Object.keys(this.seqPatches).forEach(k => {
      const isSelected = !!selection.sequencerInstrumentIDs.find(iid => iid === k);
      if (!isSelected) seqInstIDsToDelete.push(k);
    });
    seqInstIDsToDelete.forEach(iid => delete this.seqPatches[iid]);

    this.seqPlaying.removeIf(iid => !selection.sequencerInstrumentIDs.find(i2 => i2 === iid));
  }

  ToCompactObj() {
    return new CompactRoomPreset({
      presetID: this.presetID,
      name: this.metadata.name,
      description: this.metadata.description,
      tags: this.metadata.tags,
      bpm: this.metadata.bpm,
      author: this.metadata.author,
      date: this.metadata.date,
    });
  }
}

// SERIALIZABLE
class RoomPresetManager {

  #roomState;

  constructor(roomState, params) {
    Object.assign(this, params);

    this.#roomState = roomState;
    
    this.livePresetID ??= DFUtil.generateID();
    this.liveMetadata = new RoomPresetMetadata(this.liveMetadata);

    this.compactPresets ??= []; // no class obj for these.
    this.compactPresets = this.compactPresets.map(o => new CompactRoomPreset(o));

    // Do not use .presets from the client, because it's just too much huge amount of data. that's what compactPresets is for, which just stores metadata.
    this.presets ??= [];
    this.presets = this.presets.map(o => new RoomPreset(o));
  }

  // when sending to users on room Welcome, do not send the ENTIRE stuff. it's too much data.
  // so transform it to mostly just an array of metadata.
  ToCompactObj() {
    return {
      livePresetID: this.livePresetID,
      liveMetadata: this.liveMetadata,
      compactPresets: this.compactPresets,
    };
  }

  // validates, returns true
  SetMetadata(metadata) {
    if (metadata.name && IsValidRoomPatchName(metadata.name))
      this.liveMetadata.name = metadata.name;
    if (metadata.description && IsValidRoomPatchDescription(metadata.description))
      this.liveMetadata.description = metadata.description;
    if (metadata.tags && IsValidRoomPatchTags(metadata.tags))
      this.liveMetadata.tags = metadata.tags;
    if (metadata.bpm && IsValidRoomPatchBPM(metadata.bpm))
      this.liveMetadata.bpm = metadata.bpm;
    return true;
  }

  GetCompactPresetById(presetID) {
    return this.compactPresets.find(p => p.presetID === presetID);
  }

  GetFullPresetById(presetID) {
    console.assert(DFUtil.IsServer()); // clients don't have full presets
    return this.presets.find(p => p.presetID === presetID);
  }

  DeletePresetByID(presetID) {
    this.compactPresets.removeIf(p => p.presetID === presetID);
    this.presets.removeIf(p => p.presetID === presetID);
    return true;
  }

  // create a new RoomPreset object with settings of the room.
  // instSeqSelection of InstSeqSelection
  GetLivePatchObj(instSeqSelection) {
    const ret = new RoomPreset({
      presetID: this.livePresetID,
      metadata: Object.assign({}, this.liveMetadata),
    });

    ret.metadata.bpm = this.#roomState.bpm;

    instSeqSelection ??= new InstSeqSelection(this.#roomState);

    instSeqSelection.instrumentIDs.forEach(instrumentID => {
      let inst = this.#roomState.FindInstrumentById(instrumentID);
      if (!inst) return;
      inst = inst.instrument;
      if (inst.supportsPresets) {
        ret.instPatches[inst.instrumentID] = inst.exportPatchObj();
      }
    });

    instSeqSelection.sequencerInstrumentIDs.forEach(instrumentID => {
      let inst = this.#roomState.FindInstrumentById(instrumentID);
      if (!inst) return;
      inst = inst.instrument;
      if (!inst.allowSequencer) return;
      ret.seqPatches[inst.instrumentID] = inst.sequencerDevice.GetLivePatchObj();
      if (inst.sequencerDevice.IsPlaying()) {
        ret.seqPlaying.push(inst.instrumentID);
      }
    });

    return ret;
  }

  Paste(data, synthPatchHandler, seqPatchHandler, bpmHandler) {
    // set live metadata
    if (!data.presetID) return false;
    if (!data.metadata) return false;
    if (!data.instPatches) return false;
    if (!data.seqPatches) return false;
    if (!data.seqPlaying) return false;

    let ret = {
      instPatchesImported: 0,
      seqPatchesImported: 0,
    };

    Object.entries(data.instPatches).forEach(e => {
      const instrumentID = e[0];
      const patch = e[1];
      const instrument = this.#roomState.FindInstrumentById(instrumentID);
      if (!instrument) {
        console.log(`attempting to import instrument patch for instrumentID; instrument ${instrumentID} was not found. continuing...`);
        return;
      }
      if (synthPatchHandler(instrument.instrument, patch)) {
        ret.instPatchesImported ++;
      }
    });

    Object.entries(data.seqPatches).forEach(e => {
      const instrumentID = e[0];
      const patch = e[1];
      const instrument = this.#roomState.FindInstrumentById(instrumentID);
      if (!instrument) {
        console.log(`attempting to import sequencer patch for instrumentID; instrument ${instrumentID} was not found. continuing...`);
        return;
      }
      if (seqPatchHandler(instrument.instrument, patch, !!data.seqPlaying[instrumentID])) {
        ret.seqPatchesImported ++;
      }
    });

    if (data.metadata?.bpm) {
      bpmHandler(data.metadata.bpm);
    }

    this.liveMetadata = new RoomPresetMetadata(data.metadata);
    this.livePresetID = data.presetID;

    //console.log(`Imported room patch '${this.liveMetadata.name}'; ${ret.instPatchesImported} inst patches, ${ret.seqPatchesImported} seq patches.`);

    return true;
  }

  // return the preset obj
  SaveCompletePreset(data, user) {
    console.assert(data.presetID);
    console.assert(DFUtil.IsServer());

    data.metadata.author = user.name;
    data.metadata.date = new Date();

    data = new RoomPreset(data);
    let i = this.presets.findIndex(p => p.presetID === data.presetID);
    if (i === -1) {
      this.presets.push(data);
      //console.log(`saved new whole room preset ${data.presetID}`);
    } else {
      // existing.
      this.presets[i] = data;
      //console.log(`overwrote whole room preset ${data.presetID}`);
    }

    i = this.compactPresets.findIndex(p => p.presetID === data.presetID);
    if (i === -1) {
      this.compactPresets.push(data.ToCompactObj());
      //console.log(`saved new whole room preset ${data.presetID}`);
    } else {
      // existing.
      this.compactPresets[i] = data.ToCompactObj();
      //console.log(`overwrote whole room preset ${data.presetID}`);
    }
    return data;
  }

  // this comes from the server; no need to modify anything.
  SaveCompactPreset(data) {
    console.assert(data.presetID);
    console.assert(DFUtil.IsClient());
    let i = this.compactPresets.findIndex(p => p.presetID === data.presetID);
    data = new CompactRoomPreset(data);
    if (i !== -1) {
      // existing.
      this.compactPresets[i] = data;
      //console.log(`overwrote compact room preset ${data.presetID}`);
      return;
    }
    this.compactPresets.push(data);
    //console.log(`saved new compact room preset ${data.presetID}`);
  }

  DeletePresetById(presetID) {
    const existingIndex = this.presets.findIndex(p => p.presetID === presetID);
    if (existingIndex === -1)
      return true;
    this.presets.splice(existingIndex, 1);
    return true;
  }
}


module.exports = {
  RoomPreset,
  RoomPresetManager,
  RoomPresetSettings,
  InstSeqSelection,
}


