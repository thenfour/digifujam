const DF = require("../DFcommon/DFCommon");
const DFU = require("./util");
const DFMidi = require("./midi");
const DFMetronome = require("./metronome");
const DFSynth = require("./synth");
const DFNet = require("./net");
const DFMusic = require("../DFcommon/DFMusic");
const {eSoundEffects, SoundFxManager} = require('./soundFx');
const Seq = require("../DFcommon/SequencerCore");
const {pointInPolygon, ParamThrottler} = require('../DFcommon/dfutil');
const { DigifuUser } = require("../DFcommon/DFUser");
const EventEmitter = require('events');
const { RadioMachine } = require('./radioMachine');

// see in console:
// gDFApp.audioCtx.byName
// gDFApp.audioCtx.byType
// gDFApp.audioCtx.connectedNodes
const gUseDebugCtx = false;

window.OfflineAudioContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;

// https://github.com/WebAudio/web-audio-api/issues/6
function _hasSelectiveDisconnect() {
  var c = new OfflineAudioContext(1, 1, 44100);
  try {
    c.createGain().disconnect(c.destination);
    return false;
  } catch (error) {
    return true;
  }
}

const TapTempoState = {
  NA : 0,
  Waiting : 1,
  Tapping : 2,
};

const gTempoTapDurationsToConsider = 3;

class AudioContextWrapper {
  constructor() {
    this.connectedNodes = [];
    this.audioCtx = null;
    this.scope = [];
    this.byType = {};
    this.byName = {};
    this.rooms = {}; // this is the most recent ping data for ALL rooms. badly named.
  }

  beginScope(name) {
    this.scope.push(name);
  }
  endScope() {
    this.scope.pop();
  }

  getRedundantGainers() {
    let count = 0;
    let ret = {};
    Object.keys(this.byName).forEach(k => {
      ret[k] = this.byName[k].filter(n => {
        if (n.DFType !== "Gain")
          return false;
        //console.log(`${} val: ${n.gain.value}`);
        if (Math.abs(n.gain.value) < 0.0001)
          return true;
        if (Math.abs(1. - n.gain.value) < 0.0001)
          return true;
        return false;
      });
      count += ret[k].length;
    });
    console.log(`i found ${count} redundant gainers out of ${this.connectedNodes.length} total nodes (${(count * 100 / this.connectedNodes.length).toFixed(2)}%).`);
    return ret;
  }

  addTrackerForNode(node, nodeType, name) {
    node.oldconnect = node.connect;
    node.olddisconnect = node.disconnect;
    node.DFID = DFU.generateID();
    node.DFName = name; //this.scope.join(" > ") + " > " + (name || "unnamed");
    node.DFType = nodeType;
    node.DFConnectedTo = {};

    node.connect = (dest) => {
      dest.DFID = dest.DFID ?? DFU.generateID();
      node.DFConnectedTo[dest.DFID] = true;

      const idx = this.connectedNodes.findIndex(n => n.DFID == node.DFID);
      // if you connect a node multiple times only count this as 1
      if (idx == -1) {
        this.connectedNodes.push(node);

        if (this.byType[nodeType]) {
          this.byType[nodeType].push(node);
        } else {
          this.byType[nodeType] = [ node ];
        }

        if (this.byName[node.DFName]) {
          this.byName[node.DFName].push(node);
        } else {
          this.byName[node.DFName] = [ node ];
        }
      }

      node.oldconnect(dest);
    };

    node.disconnect = (dest) => {
      const idx = this.connectedNodes.findIndex(n => n.DFID == node.DFID);
      if (idx != -1) {
        //throw new Error(`Node not found...`);
        this.connectedNodes.splice(idx, 1);
      }

      if (dest) {
        delete node.DFConnectedTo[dest.DFID];
      } else {
        node.DFConnectedTo = {};
      }

      if (Object.keys(node.DFConnectedTo).length < 1) {
        //console.log(`disconnecting ${node.DFID}, name ${node.DFName}, type ${node.DFType}`);
        // remove from byType
        if (this.byType[node.DFType]) {
          const idx = this.byType[node.DFType].findIndex(n => n.DFID == node.DFID);
          if (idx != -1) {
            this.byType[node.DFType].splice(idx, 1);
            if (this.byType[node.DFType].length == 0) {
              delete this.byType[node.DFType];
            }
          }
        }

        // remove from byName
        if (this.byName[node.DFName]) {
          const idx = this.byName[node.DFName].findIndex(n => n.DFID == node.DFID);
          if (idx != -1) {
            this.byName[node.DFName].splice(idx, 1);
            if (this.byName[node.DFName].length == 0) {
              delete this.byName[node.DFName];
            }
          }
        }
      }

      node.olddisconnect.bind(node)(dest);
    };
    return node;
  }

  createBuffer(a, b, c) {
    return this.audioCtx.createBuffer(a, b, c);
  }

  createAnalyser(name) {
    return this.addTrackerForNode(this.audioCtx.createAnalyser(), "Analyser", name);
  }
  createConstantSource(name) {
    return this.addTrackerForNode(this.audioCtx.createConstantSource(), "ConstantSource", name);
  }
  createGain(name) {
    return this.addTrackerForNode(this.audioCtx.createGain(), "Gain", name);
  }
  createBufferSource(name) {
    return this.addTrackerForNode(this.audioCtx.createBufferSource(), "BufferSource", name);
  }
  createOscillator(name) {
    return this.addTrackerForNode(this.audioCtx.createOscillator(), "Oscillator", name);
  }
  createStereoPanner(name) {
    return this.addTrackerForNode(this.audioCtx.createStereoPanner(), "StereoPanner", name);
  }
  createWaveShaper(name) {
    return this.addTrackerForNode(this.audioCtx.createWaveShaper(), "WaveShaper", name);
  }
  createConvolver(name) {
    return this.addTrackerForNode(this.audioCtx.createConvolver(), "Convolver", name);
  }
  createBiquadFilter(name) {
    return this.addTrackerForNode(this.audioCtx.createBiquadFilter(), "BiquadFilter", name);
  }

  get currentTime() {
    return this.audioCtx.currentTime;
  }
  get destination() {
    return this.audioCtx.destination;
  }
  get sampleRate() {
    return this.audioCtx.sampleRate;
  }

  decodeAudioData(a, b, c) {
    return this.audioCtx.decodeAudioData(a, b, c);
  }
};

const eMonitoringType = {
  Off : "Off",
  Local : "Local",
  Remote : "Remote"
};

// this tracks which notes are currently held.
// does not ref count notes, so if you press C twice, then release once, it will be considered OFF.
class HeldNoteTracker {
  constructor() {
    this.AllNotesOff();
  }

  AllNotesOff() {
    this.pedalDown = false;
    this.notesOn = new Set();
    this.physicallyHeld = new Set();
    //console.log(this.toString(`AllNotesOff `));
  }

  NoteOn(note) {
    console.assert(Number.isInteger(note));
    this.notesOn.add(note);
    this.physicallyHeld.add(note);
    //console.log(this.toString(`NoteOn(${note}) `));
  }

  NoteOff(note) {
    console.assert(Number.isInteger(note));
    this.physicallyHeld.delete(note);
    if (!this.pedalDown) {
      this.notesOn.delete(note);
    }
    //console.log(this.toString(`NoteOff(${note}) `));
  }

  PedalUp() {
    this.pedalDown = false;
    // note off all notes which are playing but not physically held down
    this.notesOn = new Set([...this.notesOn ].filter(playingNote => this.physicallyHeld.has(playingNote)));
    //console.log(this.toString(`PedalUp() `));
  }

  PedalDown() {
    this.pedalDown = true;
    //console.log(this.toString(`PedalDown() `));
  }

  toString(prefix) {
    return `${prefix ?? ""} playing:[${[...this.notesOn].join(",")}], physicallyheld:[[${[...this.physicallyHeld].join(",")}]] ${this.pedalDown ? "pedal down" : ""}`;
  }
};

class DigifuApp {
  constructor() {
    window.gDFApp = this; // for debugging, so i can access this class in the JS console.
    this.roomState = null;
    this.worldPopulation = 0; // calculated on ping
    this.shortChatLog = [];   // contains aggregated entries instead of the full thing

    this.tapTempoState = TapTempoState.NA;

    this.events = new EventEmitter();

    this.stateChangeHandler = null; // called when any state changes; mostly for debugging / dev purposes only.
    this.handleRoomWelcome = null;  // called when you enter a new room.
    this.handleUserLeave = null;
    this.handleUserAllNotesOff = null;
    this.handleAllNotesOff = null;
    this.pleaseReconnectHandler = null;
    this.handleCheer = null; // ({ user:u.user, text:data.text, x:data.x, y:data.y });
    this.lastCheerSentDate = new Date();

    this.myRoomRegionIndex = null; // the region of the room your avatar is currently in.

    this.resetBeatPhaseOnNextNote = false;

    this.myUser = null;       // new DigifuUser(); // filled in when we identify to a server and fill users
    this.myInstrument = null; // filled when ownership is given to you.

    this._pitchBendRange = 2;
    this._midiPBValue = 0; // -1 to 1

    this.midi = new DFMidi.DigifuMidi();
    this.metronome = new DFMetronome.DigifuMetronome();
    this.synth = new DFSynth.DigifuSynth(); // contains all music-making stuff.
    this.heldNotes = new HeldNoteTracker();

    // monitoring your own playback
    this.monitoringType = eMonitoringType.Remote;

    this.net = new DFNet.DigifuNet();

    this.musicalTimeTracker = new DFMusic.MusicalTimeTracker();

    this.autoMIDIDeviceSelection = true;
    this.hasAutoSelectedMIDIDevice = false;
    this.deviceNameList = [];

    this.seqParamThrottlers = {
      swing : new ParamThrottler(DF.ClientSettings.InstrumentParamIntervalMS, (obj) => {
        this.net.SeqSetSwing(obj.get("swing"));
      }),
      stacc : new ParamThrottler(DF.ClientSettings.InstrumentParamIntervalMS, (obj) => {
        this.net.SeqPresetOp({
          op : "SeqAdjustNoteLenDivs",
          divs : obj.get("divs"),
        });
      }),
    };

    DFMidi.GetMidiInputDeviceList().then(inputs => {
      this.deviceNameList = inputs;

      // when you first launch, we listen on ALL devices.
      // when the first note is heard, stop listening on all other devices.
      // ignore devices which are not being listened.
      // when a user explicitly changes device, stop making any automatic device selection.
      inputs.forEach(deviceName => this.midi.ListenOnDevice(deviceName));

      if (this.stateChangeHandler) {
        this.stateChangeHandler();
      }
    });
  }

  IsListeningOnDevice(midiInputDeviceName) {
    return this.midi.IsListeningOnDevice(midiInputDeviceName);
  }

  StopListeningOnDevice(midiInputDeviceName) {
    this.autoMIDIDeviceSelection = false;
    this.stateChangeHandler();
    return this.midi.StopListeningOnDevice(midiInputDeviceName);
  }

  ListenOnDevice(midiInputDeviceName) {
    this.autoMIDIDeviceSelection = false;
    this.stateChangeHandler();
    return this.midi.ListenOnDevice(midiInputDeviceName);
  }

  get RoomID() {
    if (!this.roomState) {
      return window.DFRoomID;
    }
    return this.roomState.roomID;
  }

  get pitchBendRange() {
    return this._pitchBendRange;
  }

  set pitchBendRange(val) {
    this._pitchBendRange = val;
  }

  _addChatMessage(msg) {
    this.roomState.chatLog.push(msg);

    // if this is not aggregatable
    if (!msg.isAggregatable()) {
      this.shortChatLog.push(msg);
      return;
    }

    // last msg is aggregatable
    if (this.shortChatLog.length > 0) {
      let lastMsg = this.shortChatLog[this.shortChatLog.length - 1];
      if (lastMsg.messageType == DF.ChatMessageType.aggregate) {
        lastMsg.integrate(msg);
        return;
      }
    }

    // -> create aggregate of self and add.
    this.shortChatLog.push(msg.toAggregate());
  };

  IsWaitingForAutoMIDIDeviceSelect() {
    return this.autoMIDIDeviceSelection && !this.hasAutoSelectedMIDIDevice;
  }

  // can return null
  get MyRoomRegion() {
    if (!this.roomState?.roomRegions || !this.myUser)
      return null;
    if (!this.myRoomRegionIndex && this.roomState?.roomRegions && this.myUser) {
      this.myRoomRegionIndex = this.roomState.roomRegions.findIndex(r => pointInPolygon([ this.myUser.position.x, this.myUser.position.y ], r.polyPoints));
    }
    console.assert(this.myRoomRegionIndex < this.roomState.roomRegions.length);
    return this.roomState.roomRegions[this.myRoomRegionIndex];
  }

  // MIDI HANDLERS --------------------------------------------------------------------------------------
  MIDI_NoteOn(note, velocity, deviceName) {

    if (this.autoMIDIDeviceSelection && !this.hasAutoSelectedMIDIDevice) {
      // stop listening on any other devices.
      this.hasAutoSelectedMIDIDevice = true;
      this.deviceNameList.forEach(allDeviceName => {
        if (allDeviceName === deviceName)
          return;
        this.midi.StopListeningOnDevice(allDeviceName);
      });
      this.stateChangeHandler();
    }

    if (this.tapTempoState === TapTempoState.NA) {
      if (this.myInstrument == null)
        return;
      if (!this.myInstrument.wantsMIDIInput)
        return;
      this.net.SendNoteOn(note, velocity, this.resetBeatPhaseOnNextNote);
      this.heldNotes.NoteOn(note);
      this.resetBeatPhaseOnNextNote = false;
      if (this.monitoringType == eMonitoringType.Local) {
        this.synth.NoteOn(this.myUser, this.myInstrument, note, velocity, false);
      }
    } else if (this.tapTempoState === TapTempoState.Waiting) {
      this.tappingNote = note;
      this.registerTempoTap();
    } else if (this.tapTempoState === TapTempoState.Tapping) {
      if (note === this.tappingNote || !this.tappingNote) {
        this.tappingNote = note;
        this.registerTempoTap();
      } else {
        this.commitTappedTempo(); // while tapping, press a different key than you started with to register the new tempo.
      }
    }
  };

  MIDI_NoteOff(note) {
    if (this.myInstrument == null)
      return;
    if (!this.myInstrument.wantsMIDIInput)
      return;
    this.net.SendNoteOff(note);
    this.heldNotes.NoteOff(note);
    if (this.monitoringType == eMonitoringType.Local) {
      this.synth.NoteOff(this.myUser, this.myInstrument, note, false);
    }
  };

  GetMyCurrentlyPlayingNotes() {
    // synths track which notes are playing, but this is not the best place to
    // get this info. Synths do this as a matter of handling polyphony / monophonic,
    // and will also include notes which are being played from the sequencer.
    // here we just want to report notes the player has pressed without regards
    // to what the synth is rendering.
    return [...this.heldNotes.notesOn ];
  }

  // sent when midi devices change
  MIDI_AllNotesOff() {
    if (this.myInstrument == null)
      return;
    this.net.SendAllNotesOff();
    this.synth.AllNotesOff(this.myInstrument);
    this.heldNotes.AllNotesOff();
    this.handleUserAllNotesOff(this.myUser, this.myInstrument);
  };

  MIDI_PedalDown() {
    if (this.myInstrument == null)
      return;
    if (!this.myInstrument.wantsMIDIInput)
      return;
    this.net.SendPedalDown();
    this.heldNotes.PedalDown();
    if (this.monitoringType == eMonitoringType.Local) {
      this.synth.PedalDown(this.myUser, this.myInstrument);
    }
  };

  MIDI_PedalUp() {
    if (this.myInstrument == null)
      return;
    if (!this.myInstrument.wantsMIDIInput)
      return;
    this.net.SendPedalUp();
    this.heldNotes.PedalUp();
    if (this.monitoringType == eMonitoringType.Local) {
      this.synth.PedalUp(this.myUser, this.myInstrument);
    }
  };

  // val is -1 to 1
  MIDI_PitchBend(val) {
    this._midiPBValue = val;
    if (this.myInstrument == null)
      return;
    if (!this.myInstrument.wantsMIDIInput)
      return;
    let patchObj = {"pb" : val * this.pitchBendRange};
    this.net.SendInstrumentParams(patchObj, false);
    if (this.monitoringType == eMonitoringType.Local) {
      if (this.synth.SetInstrumentParams(this.myInstrument, patchObj, false)) {
        this.stateChangeHandler();
      }
    }
  };

  MIDI_CC(cc, val) {
    if (this.myInstrument == null)
      return;
    if (!this.myInstrument.wantsMIDIInput)
      return;
    if (!this.myInstrument.MIDICCHasMappings(cc))
      return;
    // ok we have a mapped CC. send to synth & net.
    let patchObj = {};
    patchObj["midicc_" + cc] = val;
    //console.log(`MIDI_CC: ${JSON.stringify(patchObj)}`);
    this.net.SendInstrumentParams(patchObj, false);
    if (this.monitoringType == eMonitoringType.Local) {
      if (this.synth.SetInstrumentParams(this.myInstrument, patchObj, false)) {
        this.stateChangeHandler();
      }
    }
  }

  PreviewNoteOn(midiNoteValue, vel) {
    if (this.myInstrument == null)
      return;
    this.PreviewNoteOff();
    this.synth.NoteOn(this.myUser, this.myInstrument, midiNoteValue, vel, false);
    this.previewingNote = midiNoteValue;
  }

  PreviewNoteOff() {
    if (this.myInstrument == null)
      return;
    if (!this.previewingNote)
      return;
    this.synth.NoteOff(this.myUser, this.myInstrument, this.previewingNote, false);
    this.previewingNote = 0;
  }

  // NETWORK HANDLERS --------------------------------------------------------------------------------------
  NET_OnPleaseIdentify() {
    this.net.SendIdentify({
      name : this.myUser.name,
      color : this.myUser.color,
      google_refresh_token : window.localStorage.getItem('google_refresh_token'),
    });
  };

  NET_OnWelcome(data) {
    this.tapTempoState = TapTempoState.NA;

    this.resetBeatPhaseOnNextNote = false;
    this.myRoomRegionIndex = null; // mark dirty.

    Seq.IntegrateSequencerConfig(data.globalSequencerConfig);

    // get user & room state
    let myUserID = data.yourUserID;

    // if the room specifies a URL and you're not currently there, manipulate browser history so you are.
    const urlsMatch = (a, b) => {
      if (a.origin != b.origin) {
        //console.log(`urls dont match; origin ${a.origin} != ${b.origin}.`);
        return false; // like, "http://localhost:8081"
      }
      if (a.pathname != b.pathname) { // path without query string. DONt match querystring. like "/maj7/"
        //console.log(`urls dont match; path ${a.pathname} != ${b.pathname}.`);
        return false; // like, "http://localhost:8081"
      }
      //console.log(`urls match; ${a} === ${b}.`);
      return true;
    };
    const currentURL = new URL(window.location);
    const roomURL = new URL(data.roomState.absoluteURL);
    if (data.roomState.absoluteURL) {
      if (!urlsMatch(currentURL, roomURL)) {
        // copy any query strings over to new URL.
        currentURL.searchParams.forEach((v, k) => {
          roomURL.searchParams.set(k, v);
        });
        //console.log(`pushing state.`);
        window.history.pushState({roomID : data.roomState.roomID}, '', roomURL);
      }
    }

    if (!window.history.state || (!('roomID' in window.history.state))) {
      window.history.replaceState({roomID : data.roomState.roomID}, '', window.location);
    }

    this.roomState = DF.DigifuRoomState.FromJSONData(data.roomState);

    // room-specific CSS is loaded at startup, so your initial room is also the CSS you load. joining new rooms doesn't load new CSS.
    const stylesheet = document.getElementById('roomcss');
    if (stylesheet) {
      stylesheet.parentNode.removeChild(stylesheet);
    }
    $("head").append("<link rel='stylesheet' id='roomcss' href='" + this.roomState.roomID + ".css' type='text/css' />");

    this.accessLevel = data.accessLevel;

    // find "you"
    this.myUser = this.roomState.FindUserByID(myUserID).user;

    window.localStorage.setItem("adminKey", data.adminKey);
    window.localStorage.setItem("userName", this.myUser.name);
    window.localStorage.setItem("userColor", this.myUser.color);

    // this is a client-only property.
    this.roomState.instrumentCloset.forEach(i => {
      i.isMuted = false;
    });

    // connect instruments to synth
    this.synth.InitInstruments(this.roomState.instrumentCloset);

    //set metronome bpm to the room bpm
    //this.metronome.bpm = this.roomState.bpm;

    // are any instruments assigned to you?
    this.myInstrument = this.roomState.instrumentCloset.find(i => i.controlledByUserID == myUserID);

    // initialize radio.
    if (!this.roomState.radio) {
      if (this.radio)
        this.radio.stop();
      this.radio = null;
    } else {
      this.radio = new RadioMachine(this, this.audioCtx);
    }

    // set up init abbreviated chat log
    let ch = this.roomState.chatLog;
    this.roomState.chatLog = [];
    this.shortChatLog = [];
    ch.forEach(msg => { this._addChatMessage(msg); });

    this.synth.AllNotesOff();
    this.heldNotes.AllNotesOff();
    this.handleAllNotesOff();

    this.FireUserDance(this.myUser);
    this.handleRoomWelcome();
  };

  NET_OnUserEnter(data) {
    if (!this.roomState)
      return;

    let nu = new DF.DigifuUser(data.user);
    this.roomState.users.push(nu);

    this.soundEffectManager.play(eSoundEffects.UserJoinNotification);

    if (data.chatMessageEntry) {
      let msg = Object.assign(new DF.DigifuChatMessage, data.chatMessageEntry);
      msg.thaw();
      this._addChatMessage(msg);
    }

    if (this.stateChangeHandler) {
      this.stateChangeHandler();
    }
  };

  NET_OnUserLeave(data) {
    if (!this.roomState)
      return;

    let foundUser = this.roomState.FindUserByID(data.userID);
    if (foundUser == null) {
      //log(`  user not found...`);
      return;
    }
    this.roomState.users.splice(foundUser.index, 1);

    this.soundEffectManager.play(eSoundEffects.UserPartNotification);

    if (data.chatMessageEntry) {
      let msg = Object.assign(new DF.DigifuChatMessage, data.chatMessageEntry);
      msg.thaw();
      this._addChatMessage(msg);
    }

    if (this.stateChangeHandler) {
      this.stateChangeHandler();
    }
    this.handleUserLeave(data.userID);
  };

  NET_OnInstrumentOwnership(instrumentID, userID /* may be null */, idle) {
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(instrumentID);
    if (foundInstrument == null) {
      //log(`  instrument not found...`);
      return;
    }

    // when a sequencer is playing without a user controlling, it emits note ons / offs.
    // when ownership changes, remove its playing note refs.
    this.handleUserAllNotesOff(null, foundInstrument.instrument);

    let foundOldUser = null;
    foundOldUser = this.roomState.FindUserByID(foundInstrument.instrument.controlledByUserID);

    let foundNewUser = null;
    foundNewUser = this.roomState.FindUserByID(userID);
    if (foundNewUser && (foundNewUser.user.idle != idle)) {
      //console.log(`user ${foundNewUser.user.name} now idle=${idle}`);
      foundNewUser.user.idle = idle;
    }

    if (foundInstrument.instrument.controlledByUserID != userID) {
      // do all notes off when instrument changes
      this.synth.AllNotesOff(foundInstrument.instrument);
      if (foundOldUser) {
        this.handleUserAllNotesOff(foundOldUser.user, foundInstrument.instrument);
      }
      if (foundNewUser) {
        this.handleUserAllNotesOff(foundNewUser.user, foundInstrument.instrument);
      }

      if (userID == this.myUser.userID) {
        this.resetBeatPhaseOnNextNote = false;
        this.myInstrument = foundInstrument.instrument;
        this.onMyInstrumentChange(this.myInstrument);
      } else {
        // or if your instrument is being given to someone else, then you no longer have an instrument
        if (foundInstrument.instrument.controlledByUserID == this.myUser.userID) {
          this.myInstrument = null;
          this.onMyInstrumentChange(this.myInstrument);
        }
      }
      foundInstrument.instrument.controlledByUserID = userID;
      if (!userID) {
        foundInstrument.instrument.ReleaseOwnership();
      }
    }

    if (userID) { // bring instrument online, or offline depending on new ownership.
      this.synth.ConnectInstrument(foundInstrument.instrument);
    } else {
      this.synth.DisconnectInstrument(foundInstrument.instrument);
    }

    if (this.stateChangeHandler) {
      this.stateChangeHandler();
    }
  };

  NET_OnNoteEvents(noteOns, noteOffs) {
    for (let i = 0; i < noteOns.length; ++ i) {
      const e = noteOns[i];
      if (e.seqInstrumentID && e.op === "startPlaying") {
        this.NET_SeqStartPlaying(e);
      } else {
        this.NET_OnNoteOn(e.userID, parseInt(e.note), parseInt(e.velocity), e.seqInstrumentID);
      }
    }
    for (let i = 0; i < noteOffs.length; ++ i) {
      const e = noteOffs[i];
      this.NET_OnNoteOff(e.userID, parseInt(e.note), e.seqInstrumentID);
    }
  }

  NET_SeqStartPlaying(e) {
    let instrument = null;
    instrument = this.roomState.FindInstrumentById(e.seqInstrumentID).instrument;
    instrument.sequencerDevice.StartPlaying();
    this.stateChangeHandler();
  }

  NET_OnNoteOn(userID, note, velocity, seqInstrumentID) {
    if (!this.roomState)
      return;
    let user = null;
    let instrument = null;
    if (seqInstrumentID) {
      // there won't be a user specified here.
      instrument = this.roomState.FindInstrumentById(seqInstrumentID)?.instrument;
      if (!instrument)
        return; // sequencer sends stuff very out-of-time; it can happen before room state processed.
      let foundUser = this.roomState.FindUserByID(instrument.controlledByUserID);
      if (foundUser) {
        user = foundUser.user;
      }
    } else {
      let foundUser = this.roomState.FindUserByID(userID);
      if (!foundUser)
        return;
      user = foundUser.user;
      let foundInstrument = this.roomState.FindInstrumentByUserID(userID);
      if (!foundInstrument)
        return;
      instrument = foundInstrument.instrument;
    }

    if (user?.userID == this.myUser.userID) {
      // sequencer notes don't have any local monitoring option; let them through
      if (!seqInstrumentID && (this.monitoringType !== eMonitoringType.Remote)) {
        return;
      }
    }

    this.synth.NoteOn(user, instrument, note, velocity, !!seqInstrumentID);
  };

  NET_OnNoteOff(userID, note, seqInstrumentID) {
    if (!this.roomState)
      return;
    let user = null;
    let instrument = null;
    if (seqInstrumentID) {
      // there won't be a user specified here.
      instrument = this.roomState.FindInstrumentById(seqInstrumentID)?.instrument;
      if (!instrument)
        return; // sequencer sends stuff very out-of-time; it can happen before room state processed.
      let foundUser = this.roomState.FindUserByID(instrument.controlledByUserID);
      if (foundUser) {
        user = foundUser.user;
      }
    } else {
      let foundUser = this.roomState.FindUserByID(userID);
      if (!foundUser)
        return;
      user = foundUser.user;
      let foundInstrument = this.roomState.FindInstrumentByUserID(userID);
      if (!foundInstrument)
        return;
      instrument = foundInstrument.instrument;
    }

    if (user?.userID == this.myUser.userID) {
      // sequencer notes don't have any local monitoring option; let them through
      if (!seqInstrumentID && (this.monitoringType !== eMonitoringType.Remote)) {
        return;
      }
    }
    this.synth.NoteOff(user, instrument, note, !!seqInstrumentID);
  };

  NET_OnUserAllNotesOff(userID) {
    if (!this.roomState)
      return;
    let foundUser = this.roomState.FindUserByID(userID);
    if (!foundUser)
      return;
    let foundInstrument = this.roomState.FindInstrumentByUserID(userID);
    if (foundInstrument == null) {
      //log(`instrument not found`);
      return;
    }
    this.synth.AllNotesOff(foundInstrument.instrument);
    this.handleUserAllNotesOff(foundUser.user, foundInstrument.instrument);
  };

  NET_OnPedalDown(userID) {
    if (!this.roomState)
      return;
    let foundUser = this.roomState.FindUserByID(userID);
    if (!foundUser)
      return;
    let foundInstrument = this.roomState.FindInstrumentByUserID(userID);
    if (!foundInstrument)
      return;

    if (userID == this.myUser.userID) {
      if (this.monitoringType !== eMonitoringType.Remote) {
        return;
      }
    }
    this.synth.PedalDown(foundUser.user, foundInstrument.instrument);
  };

  NET_OnPedalUp(userID) {
    if (!this.roomState)
      return;
    let foundUser = this.roomState.FindUserByID(userID);
    if (!foundUser)
      return;
    let foundInstrument = this.roomState.FindInstrumentByUserID(userID);
    if (!foundInstrument)
      return;

    if (userID == this.myUser.userID) {
      if (this.monitoringType !== eMonitoringType.Remote) {
        return;
      }
    }

    this.synth.PedalUp(foundUser.user, foundInstrument.instrument);
  };

  //
  PatchChangeIsLinkedByMyInstrument(instrumentSpec, patchObj) {
    if (!this.myInstrument)
      return false;
    if (this.myInstrument.engine != 'mixingdesk')
      return false; // performance short circuit
    return Object.keys(patchObj).some(paramID => {
      // find a param which links to that
      if (this.myInstrument.params.some(p => p.sourceInstrumentID == instrumentSpec.instrumentID && p.sourceParamID == paramID)) {
        return true;
      }
      return false;
    });
    //return false;
  }

  NET_OnInstrumentParams(data) // instrumentID, patchObj, isWholePatch
  {
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
    if (!foundInstrument)
      return;

    if (foundInstrument.instrument === this.myInstrument) {
      if (this.monitoringType !== eMonitoringType.Remote) {
        return;
      }
    }
    if (this.synth.SetInstrumentParams(foundInstrument.instrument, data.patchObj, data.isWholePatch)) {
      this.stateChangeHandler();
    } else if (this.observingInstrument && foundInstrument.instrument.instrumentID == this.observingInstrument.instrumentID) {
      this.stateChangeHandler();
    } else if (this.PatchChangeIsLinkedByMyInstrument(foundInstrument.instrument, data.patchObj)) {
      this.stateChangeHandler();
    }
  }

  // // instrumentID, paramID, srcVal
  NET_OnCreateParamMapping(data) {
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
    if (foundInstrument == null) {
      //log(`NET_OnInstrumentParam instrument not found`);
      return;
    }
    this.synth.createParamMapping(foundInstrument.instrument, foundInstrument.instrument.GetParamByID(data.paramID), data.srcVal);
  }

  // instrumentID, paramID
  NET_OnRemoveParamMapping(data) {
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
    if (foundInstrument == null) {
      //log(`NET_OnInstrumentParam instrument not found`);
      return;
    }
    this.synth.removeParamMapping(foundInstrument.instrument, foundInstrument.instrument.GetParamByID(data.paramID));
  }

  NET_OnInstrumentPresetDelete(data) { // instrumentID, presetID
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
    if (foundInstrument == null) {
      return;
    }
    const bank = this.roomState.GetPresetBankForInstrument(foundInstrument.instrument);

    bank.presets.removeIf(p => p.presetID == data.presetID);
    this.stateChangeHandler();
  }

  NET_OnInstrumentFactoryReset(data) { // instrumentID, presets:[presets]
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
    if (foundInstrument == null) {
      return;
    }

    this.roomState.importAllPresetsArray(foundInstrument.instrument, data.presets, true);
    let initPreset = this.roomState.GetInitPreset(foundInstrument.instrument);
    this.synth.SetInstrumentParams(foundInstrument.instrument, initPreset, true);
    this.stateChangeHandler();
  }

  NET_OnInstrumentBankMerge(data) { // [presets]
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
    if (foundInstrument == null) {
      return;
    }

    this.roomState.importAllPresetsArray(foundInstrument.instrument, data.presets, false);

    this.stateChangeHandler();
  }

  NET_OnInstrumentPresetSave(data) { // instrumentID, patchObj:{params} just like InstParams, except will be saved. the "presetID" param specifies preset to overwrite. may be new.
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
    if (foundInstrument == null) {
      return;
    }

    const bank = this.roomState.GetPresetBankForInstrument(foundInstrument.instrument);

    let existing = bank.presets.find(p => p.presetID == data.patchObj.presetID);
    if (existing) {
      Object.assign(existing, data.patchObj);
    } else {
      bank.presets.push(data.patchObj);
    }

    // if you saved as a NEW preset, integrate the new ID.
    if (this.myInstrument) {
      if (foundInstrument.instrument.instrumentID == this.myInstrument.instrumentID) {
        if (!this.myInstrument.GetParamByID("presetID").currentValue) {
          this.myInstrument.GetParamByID("presetID").currentValue = data.patchObj.presetID;
          this.myInstrument.GetParamByID("presetID").rawValue = data.patchObj.presetID;
        }
      }
    }

    this.stateChangeHandler();
  }
  NET_OnPersistentSignOutComplete(data) {
    if (!this.roomState)
      return;
    if (!this.myUser)
      return;
    this.myUser.PersistentSignOut();
    this.stateChangeHandler();
  }
  NET_OnGoogleSignInComplete(data) {
    if (!this.roomState)
      return;
    if (!this.myUser)
      return;
    this.myUser.PersistentSignIn(data.hasPersistentIdentity, data.persistentID, data.persistentInfo);
    window.localStorage.setItem("adminKey", data.adminKey);
    this.stateChangeHandler();
  }

  // inbound SEQ stuff
  NET_SeqPlayStop(data) {
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
    if (foundInstrument == null) {
      return;
    }

    foundInstrument.instrument.sequencerDevice.SetPlaying(data.isPlaying);

    this.stateChangeHandler();
  }

  NET_SeqSetTimeSig(data) {
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
    if (foundInstrument == null) {
      return;
    }

    foundInstrument.instrument.sequencerDevice.livePatch.SetTimeSig(DFMusic.GetTimeSigById(data.timeSigID));

    this.stateChangeHandler();
  }

  NET_SetSetNoteMuted(data) {
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
    if (foundInstrument == null) {
      return;
    }

    foundInstrument.instrument.sequencerDevice.livePatch.SetNoteMuted(data.midiNoteValue, data.isMuted);
    this.stateChangeHandler();
  }

  NET_SeqSelectPattern(data) {
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
    if (foundInstrument == null) {
      return;
    }

    foundInstrument.instrument.sequencerDevice.livePatch.SelectPatternIndex(data.selectedPatternIdx);
    this.stateChangeHandler();
  }

  NET_SeqSetSpeed(data) {
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
    if (foundInstrument == null) {
      return;
    }

    foundInstrument.instrument.sequencerDevice.livePatch.SetSpeed(data.speed);
    this.stateChangeHandler();
  }

  NET_SeqSetSwing(data) {
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
    if (foundInstrument == null) {
      return;
    }

    foundInstrument.instrument.sequencerDevice.livePatch.SetSwing(data.swing);

    this.stateChangeHandler();
  }

  NET_SeqSetDiv(data) {
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
    if (foundInstrument == null) {
      return;
    }

    foundInstrument.instrument.sequencerDevice.livePatch.SetDivisionType(data.divisionType);
    this.stateChangeHandler();
  }

  NET_SeqSetOct(data) {
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
    if (foundInstrument == null) {
      return;
    }

    foundInstrument.instrument.sequencerDevice.livePatch.SetOctave(data.oct);
    this.stateChangeHandler();
  }

  NET_SeqSetLength(data) {
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
    if (foundInstrument == null) {
      return;
    }

    foundInstrument.instrument.sequencerDevice.livePatch.SetLengthMajorBeats(data.lengthMajorBeats);
    this.stateChangeHandler();
  }

  NET_SeqPatternOps(data) {
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
    if (foundInstrument == null) {
      return;
    }

    foundInstrument.instrument.sequencerDevice.livePatch.GetSelectedPattern().ProcessOps(data.ops, foundInstrument.instrument.sequencerDevice.livePatch);
    this.stateChangeHandler();
  }

  NET_SeqPatchInit(data) {
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
    if (foundInstrument == null) {
      return;
    }

    foundInstrument.instrument.sequencerDevice.InitPatch(data.presetID);
    this.stateChangeHandler();
  }

  NET_SeqPresetOp(data) {
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
    if (foundInstrument == null) {
      return;
    }
    const bank = this.roomState.GetSeqPresetBankForInstrument(foundInstrument.instrument);
    foundInstrument.instrument.sequencerDevice.SeqPresetOp(data, bank);
    this.stateChangeHandler();
  }

  NET_SeqMetadata(params) { // { instrumentID, title, description, tags }
    if (!this.roomState)
      return;
    let foundInstrument = this.roomState.FindInstrumentById(params.instrumentID);
    if (foundInstrument == null) {
      return;
    }

    foundInstrument.instrument.sequencerDevice.livePatch.SetMetadata(params);
    this.stateChangeHandler();
  }

  // ----------------------

  TransformPingRoomToWorldData(room) {
  }

  NET_OnPing(data) {
    if (!this.roomState)
      return;
    this.net.SendPong(data.token);
    if (!this.roomState)
      return; // technically a ping could be sent before we've populated room state.

    data.rooms.forEach(room => {
      room.users = room.users.map(user => DigifuUser.FromPing(user));
    });
    this.rooms = data.rooms;

    // bring user stats to our room's user list
    let room = this.rooms.find(r => r.roomID == this.roomState.roomID);
    console.assert(!!room, "what, we're in a room, get a ping that doesn't have stats about this room???");
    room.users.forEach(u => {
      let foundUser = this.roomState.FindUserByID(u.userID);
      if (!foundUser)
        return; // this is possible because the server may be latent in sending this user data.
      foundUser.user.IntegrateFromPing(u);
    });
    this.serverUptimeSec = data.serverUptimeSec;

    // world population should count UNIQUE userIDs, in case users are in multiple rooms. that may be the case with
    // discord ("external"/"offline") users.
    this.worldPopulation = data.worldPopulation; // (new Set(this.rooms.map(r => r.users).reduce((a,b)=>a.concat(b), []).map(u => u.userID))).size;

    // pings are a great time to do some cleanup.

    // prune chat.
    let now = new Date();
    this.roomState.chatLog = this.roomState.chatLog.filter(msg => {
      return ((now - new Date(msg.timestampUTC)) < DF.ClientSettings.ChatHistoryMaxMS);
    });
    this.shortChatLog = this.shortChatLog.filter(msg => {
      return ((now - new Date(msg.timestampUTC)) < DF.ClientSettings.ChatHistoryMaxMS);
    });

    this.events.emit('ping');
  };

  NET_ChangeRoomState(data) {
    switch (data.cmd) {
    case "setAnnouncementHTML":
      this.roomState.announcementHTML = data.params;
      this.stateChangeHandler();
      break;
    case "setRoomImg":
      this.roomState.img = data.params;
      this.stateChangeHandler();
      break;
    case "setRadioChannel":
      if (this.radio)
        this.radio.stop();
      if (!this.roomState.radio) {
        this.radio = null;
      } else {
        this.roomState.radio.channelID = data.params.channelID;
        this.radio = new RadioMachine(this, this.audioCtx);
      }
      this.events.emit("changeRadioChannel");
      this.stateChangeHandler();
      break;
    case "setRadioFX":
      if (!this.roomState.radio) return;
      this.roomState.radio.fxEnabled = data.params.fxEnabled;
      this.roomState.radio.reverbGain = data.params.reverbGain;
      this.roomState.radio.filterType = data.params.filterType;
      this.roomState.radio.filterFrequency = data.params.filterFrequency;
      this.roomState.radio.filterQ = data.params.filterQ;
      if (this.radio) {
        this.radio.FXEnabled = this.roomState.radio.fxEnabled;
        this.radio.ReverbLevel = this.roomState.radio.reverbGain;
        this.radio.FilterType = this.roomState.radio.filterType;
        this.radio.FilterFrequency = this.roomState.radio.filterFrequency;
        this.radio.FilterQ = this.roomState.radio.filterQ;
      }
      this.events.emit("changeRadioFX");
      break;
    }
  }

  NET_OnUserChatMessage(msg) {
    if (!this.roomState)
      return;

    let ncm = Object.assign(new DF.DigifuChatMessage(), msg);
    ncm.thaw();

    // ignore server welcome messages which we've already seen.
    if (ncm.welcomeMsgID && ncm.source === DF.eMessageSource.Server) {
      const existingStr = window.localStorage.getItem("seenServerWelcomeMessages");
      if (existingStr) {
        let existingArray = null;
        try {
          existingArray = JSON.parse(existingStr);
        } catch (e) {
          existingArray = [];
        }
        if (existingArray.some(id => id === ncm.welcomeMsgID)) {
          //console.log(`Ignoring already seen welcome msg ${ncm.welcomeMsgID}`);
          return;
        }
        existingArray.push(ncm.welcomeMsgID);
        window.localStorage.setItem("seenServerWelcomeMessages", JSON.stringify(existingArray));
      } else {
        window.localStorage.setItem("seenServerWelcomeMessages", JSON.stringify([ ncm.welcomeMsgID ]));
      }
    }

    this._addChatMessage(ncm);
    this.soundEffectManager.play(eSoundEffects.ChatMessageNotification);

    this.stateChangeHandler();
  }

  NET_OnUserState(data) {
    if (!this.roomState)
      return;
    let u = this.roomState.FindUserByID(data.state.userID);
    if (!u.user) {
      console.log(`NET_OnUserState: unknown user ${data.state.userID}`);
      return;
    }
    u.user.name = data.state.name;
    u.user.color = data.state.color;
    u.user.position = data.state.position;

    if (u.user.userID == this.myUser.userID) {
      this.myRoomRegionIndex = null; // mark dirty.
      window.localStorage.setItem("userName", this.myUser.name);
      window.localStorage.setItem("userColor", this.myUser.color);
      // room interaction based on intersection.
      this.roomState.roomItems.forEach(item => {
        if (item.rect.PointIntersects(this.myUser.position)) {
          this._DoUserItemInteraction(item, "onAvatarEnter");
        }
      });

      //
    }

    if (data.chatMessageEntry) {
      let m = Object.assign(new DF.DigifuChatMessage(), data.chatMessageEntry);
      m.thaw();
      this._addChatMessage(m);
    }

    this.stateChangeHandler();
  }

  NET_OnUserCheer(data) {
    if (!this.roomState)
      return;
    let u = this.roomState.FindUserByID(data.userID);
    if (!u.user) {
      console.log(`NET_OnUserState: unknown user ${data.userID}`);
      return;
    }

    this.handleCheer({user : u.user, text : data.text, x : data.x, y : data.y});
    this.stateChangeHandler(); // <-- pretty sure this is not needed.
  }

  NET_OnRoomBeat(data) {
    if (this.tapTempoState != TapTempoState.NA) {
      return;
    }
    // data.bpm, data.beat
    this.metronome.OnRoomBeat();
    if (this.roomState) {
      this.musicalTimeTracker.onRoomBeat(data.bpm, data.beat);
    }
  }

  NET_OnRoomBPMUpdate(data) {
    this.roomState.bpm = data.bpm;
    this.stateChangeHandler();
  }

  NET_OnGraffitiOps(data) {
    data.forEach(op => {
      switch (op.op) {
      case "place":
        this.roomState.importGraffiti(op.graffiti);
        break;
      case "remove":
        this.roomState.removeGraffiti(op.id);
        break;
      }
    });
    this.stateChangeHandler();
  }

  NET_OnUserDance(data) {
    if (!this.roomState)
      return;
    let u = this.roomState.FindUserByID(data.userID);
    if (!u.user) {
      console.log(`NET_OnUserDance: unknown user ${data.userID}`);
      return;
    }

    u.user.danceID = data.danceID;
    console.log(`user dance: ${u.user.danceID}`);
    //this.handle({user : u.user, text : data.text, x : data.x, y : data.y});
    this.FireUserDance(u.user);
  }

  FireUserDance(user) {
    this.events.emit('userDance', {
      app: this,
      user,
      danceID: user.danceID,
    });
  }

  NET_pleaseReconnectHandler() {
    this.pleaseReconnectHandler();
  }

  NET_OnDisconnect() {
    this.synth.AllNotesOff(this.myInstrument); // prevent disconnect leaving you in a noisy state. anyway when you reconnect you'll reset all synths anyway.
    if (this.radio)
      this.radio.stop();
    this.radio = null;
    this.stateChangeHandler();
  }

  // --------------------------------------------------------------------------------------

  RequestInstrument(instrumentID) {
    this.net.SendRequestInstrument(instrumentID);
  };

  ReleaseInstrument() {
    this.net.SendReleaseInstrument();
  };

  observeInstrument(inst) {
    this.observingInstrument = inst;
  }

  SendChatMessage(msgText, toUserID) {

    // parse commands.
    const l = msgText.toLowerCase();
    if (l.startsWith("/g ")) {
      this.net.SendGraffitiOps([ {
        op : "place",
        content : msgText.substring(3),
      } ]);
      return;
    }

    let cmd = "/graffiti ";
    if (l.startsWith(cmd)) {
      this.net.SendGraffitiOps([ {
        op : "place",
        content : msgText.substring(cmd.length),
      } ]);
      return;
    }

    cmd = "/nick ";
    if (l.startsWith(cmd)) {
      return this.SetUserNameColor(msgText.substring(cmd.length), this.myUser.color);
    }

    cmd = "/n ";
    if (l.startsWith(cmd)) {
      return this.SetUserNameColor(msgText.substring(cmd.length), this.myUser.color);
    }

    cmd = "/color ";
    if (l.startsWith(cmd)) {
      return this.SetUserNameColor(this.myUser.name, msgText.substring(cmd.length));
    }
    cmd = "/c ";
    if (l.startsWith(cmd)) {
      return this.SetUserNameColor(this.myUser.name, msgText.substring(cmd.length));
    }

    cmd = "/dance"; // intentionally no space. just feels natural i don't know why.
    if (l.startsWith(cmd)) {
      const danceID = parseInt(msgText.substring(cmd.length));
      if (Number.isInteger(danceID)) {
        return this.net.SendDance(danceID);
      }
    }
    cmd = "/d"; // intentionally no space. just feels natural i don't know why.
    if (l.startsWith(cmd)) {
      const danceID = parseInt(msgText.substring(cmd.length));
      if (Number.isInteger(danceID)) {
        return this.net.SendDance(danceID);
      }
    }


    let msg = new DF.DigifuChatMessage();
    msg.message = msgText;
    msg.fromUserID = this.myUser.userID;
    msg.toUserID = toUserID;
    msg.timestampUTC = new Date();

    this.net.SendChatMessage(msg);
  };

  _DoToggleSign(item, interactionParams) {
    item.params.isShown = !item.params.isShown;
    //this.stateChangeHandler(); <-- will be handled anyway by a state change from caller
  }

  _DoUserItemInteraction(item, interactionType) {
    let interactionSpec = item[interactionType];
    if (!interactionSpec) {
      //console.log(`Item ${item.itemID} has no interaction type ${interactionType}`);
      return;
    }
    if (interactionSpec.processor != "client") {
      return;
    }
    switch (interactionSpec.fn) {
    case DF.RoomFns.toggleSign:
      this._DoToggleSign(item, interactionSpec.params);
      break;
    default:
      console.log(`Item ${item.itemID} / interaction type ${interactionType} has unknown interaction FN ${interactionSpec.fn}`);
      break;
    }
  };

  SetUserPosition(pos) {
    this.net.SendUserState({
      name : this.myUser.name,
      color : this.myUser.color,
      position : pos
    });
  };

  SetUserNameColor(name, color) {
    this.net.SendUserState({
      name : name,
      color : color,
      position : this.myUser.position
    });
  };

  SendRoomBPM(bpm, phaseRelativeMS) {
    this.net.SendRoomBPM(bpm, phaseRelativeMS);
  };

  SetQuantizationSpec(quantizeSpec) {
    this.net.SendUserQuantizationSpec(quantizeSpec);
    this.myUser.quantizeSpec = quantizeSpec;
  }

  SendCheer(text, x, y) {

    const now = new Date();
    if ((now - this.lastCheerSentDate) < DF.ClientSettings.MinCheerIntervalMS)
      return;

    this.lastCheerSentDate = now;

    text = DF.sanitizeCheerText(text);
    if (text == null)
      return;
    this.net.SendCheer(text, x, y);
  };

  loadPatchObj(presetObj /* RAW values */, isWholePatch) {
    if (!this.myInstrument)
      return;
    this.net.SendInstrumentParams(presetObj, isWholePatch);
    if (this.synth.SetInstrumentParams(this.myInstrument, presetObj, isWholePatch)) {
      this.stateChangeHandler();
    }
  };

  SetInstrumentParam(_, param, newVal) {
    let presetObj = {};
    presetObj[param.paramID] = newVal;
    this.loadPatchObj(presetObj);
  };

  setMacroDisplayName(macroIdx, name) {
    let presetObj = {};
    presetObj[`macro${macroIdx}_name`] = name;
    this.loadPatchObj(presetObj);
  }

  deletePreset(presetObj) {
    if (!this.myInstrument)
      return;
    if (!presetObj)
      return;
    if (!presetObj.presetID)
      return;
    this.net.SendDeletePreset(presetObj.presetID);
  }

  savePreset(patchObj) {
    if (!this.myInstrument)
      return;
    this.net.SendInstrumentPresetSave(patchObj);
  }

  // saves the live patch. if it's a loaded preset, then it will overwrite the orig. if it's not, then it will be saved as new
  saveLoadedPreset() {
    if (!this.myInstrument)
      return;
    this.savePreset(this.myInstrument.exportPatchObj());
  }

  // save live as a new preset, even if the current patch is an existing one.
  savePatchAsNewPreset() {
    if (!this.myInstrument)
      return;
    // force saving as new. IT ALSO allows us to know that when the server comes back with a presetID, we should use it live.
    this.myInstrument.GetParamByID("presetID").currentValue = null;
    this.myInstrument.GetParamByID("presetID").rawValue = null;
    this.saveLoadedPreset();
  }

  saveOverwriteExistingPreset(presetIDToOverwrite) {
    if (!this.myInstrument)
      return;
    this.myInstrument.GetParamByID("presetID").currentValue = presetIDToOverwrite;
    this.myInstrument.GetParamByID("presetID").rawValue = presetIDToOverwrite;
    this.saveLoadedPreset();
  }

  // return true/false success
  mergePresetBankJSON(bankJSON) {
    if (!DFU.IsValidJSONString(bankJSON))
      return false;
    if (!this.myInstrument)
      return false;
    this.net.SendInstrumentBankMerge(bankJSON);
  }

  factoryResetInstrument() {
    if (!this.myInstrument)
      return false;
    this.net.SendInstrumentFactoryReset();
  }

  loadInitPatch() {
    if (!this.myInstrument)
      return false;
    const presetObj = this.roomState.GetInitPreset(this.myInstrument);
    this.loadPatchObj(presetObj, true);
  }

  createParamMappingFromSrcVal(param, srcVal) { // srcVal is directly mapped to MIDI CC
    if (!this.myInstrument)
      return;
    this.net.SendCreateParamMapping(param, srcVal);
    this.synth.createParamMapping(this.myInstrument, param, srcVal);
  }

  createParamMappingFromMacro(param, macroIndex) {
    return this.createParamMappingFromSrcVal(param, macroIndex + DF.eParamMappingSource.Macro0);
  }

  removeParamMapping(param) {
    if (!this.myInstrument)
      return;
    this.net.SendRemoveParamMapping(param);
    this.synth.removeParamMapping(this.myInstrument, param);
  }

  setMonitoringType(mt) {
    this.monitoringType = mt;
    if (this.myInstrument == null)
      return;
    this.synth.AllNotesOff(this.myInstrument);
    this.handleUserAllNotesOff(this.myUser, this.myInstrument);
  }

  ToggleResetBeatPhaseOnNextNote() {
    this.resetBeatPhaseOnNextNote = !this.resetBeatPhaseOnNextNote;
  }
  GetResetBeatPhaseOnNextNote() {
    return this.resetBeatPhaseOnNextNote;
  }

  AdjustBeatPhase(relativeMS) {
    this.net.SendAdjustBeatPhase(relativeMS);
  }

  AdjustBeatOffset(relativeBeats) {
    this.net.SendAdjustBeatOffset(relativeBeats);
  }

  GoogleSignOut() {
    this.net.PersistentSignOut();
  }

  GoogleSignIn(google_access_token) {
    this.net.GoogleSignIn(google_access_token);
  }

  IsMuted() {
    return this.synth.isMuted;
  }

  SetMuted(b) {
    this.synth.isMuted = b;
    this.handleAllNotesOff();
  }

  getAbsoluteBeatFloat() {
    return this.musicalTimeTracker.getAbsoluteBeatFloat();
  }

  registerTempoTap() {
    // register tap / duration
    const now = Date.now();
    console.log(`now = ${now}, this.lastTempoTick = ${this.lastTempoTick}`);
    if (!this.lastTempoTick) {
      console.assert(this.tapTempoState === TapTempoState.Waiting);
      this.tapTempoState = TapTempoState.Tapping;

      this.lastTempoTick = now;
      this.metronome.play(true);
      this.stateChangeHandler();
      return;
    }
    this.tempoTapDurations.push(now - this.lastTempoTick);
    this.tempoTapDurations = this.tempoTapDurations.slice(-gTempoTapDurationsToConsider);

    console.log(this.tempoTapDurations);

    // calculate new bpm
    const avgDurationMS = this.tempoTapDurations.reduce((a, b) => a + b, 0) / this.tempoTapDurations.length;
    // convert MS duration to bpm
    let bpm = 60.0 / avgDurationMS * 1000;
    bpm = Math.max(1, bpm);
    while (bpm < 20) {
      bpm *= 2;
    }
    while (bpm > 300) {
      bpm /= 2;
    }
    bpm = Math.round(bpm);

    this.tappedTempoBPM = bpm;

    this.lastTempoTick = now;
    this.metronome.play(true);
    this.stateChangeHandler();
  }

  commitTappedTempo() {
    if (!this.tappedTempoBPM) {
      return;
    }
    this.SendRoomBPM(this.tappedTempoBPM, -this.myUser.pingMS);
    this.tapTempoState = TapTempoState.NA;
    this.stateChangeHandler();
  }

  beginTapTempo() {
    this.tapTempoState = TapTempoState.Waiting;
    this.tempoTapDurations = [];
    this.lastTempoTick = null;
    this.tappedTempoBPM = null;
    this.stateChangeHandler();
  }

  cancelTapTempo() {
    this.tapTempoState = TapTempoState.NA;
    this.stateChangeHandler();
  }

  // SEQUENCER

  SeqSetTimeSig(timeSig) {
    this.net.SeqSetTimeSig(timeSig);
  }

  SeqPlayStop(isPlaying, instrumentID) {
    this.net.SeqPlayStop(isPlaying, instrumentID);
  }

  SetSetNoteMuted(midiNoteValue, isMuted) {
    this.net.SetSetNoteMuted(midiNoteValue, isMuted);
  }
  SeqSelectPattern(selectedPatternIdx) {
    this.net.SeqSelectPattern(selectedPatternIdx);
  }
  SeqSetSpeed(speed) {
    this.net.SeqSetSpeed(speed);
  }
  SeqSetSwing(swing) {
    if (this.myInstrument?.sequencerDevice?.livePatch?.GetSwing() === swing)
      return;
    this.seqParamThrottlers.swing.InvokeChange("swing", swing, false);
  }
  SeqSetDiv(divisions) {
    this.net.SeqSetDiv(divisions);
  }
  SeqSetOct(oct) {
    this.net.SeqSetOct(oct);
  }
  SeqSetLength(lengthMajorBeats) {
    this.net.SeqSetLength(lengthMajorBeats);
  }
  SeqPatternOps(ops) {
    this.net.SeqPatternOps(ops);
  }
  SeqPatchInit() {
    this.net.SeqPatchInit();
  }
  SeqPresetOp(data) {
    this.net.SeqPresetOp(data);
  }
  SeqMetadata(params) {
    this.net.SeqMetadata(params);
  }
  SeqSetTranspose(transpose) {
    this.net.SeqPresetOp({
      op : "SeqSetTranspose",
      transpose,
    });
  }
  SeqSetStacc(divs) {
    if (this.myInstrument?.sequencerDevice?.livePatch?.GetNoteLenAdjustDivs() === divs)
      return;
    this.seqParamThrottlers.stacc.InvokeChange("divs", divs, false);
  }
  // cancel is boolean
  SeqCue(instrumentID, cancel) {
    this.net.SeqCue(instrumentID, cancel);
  }

  // --------------
  IsConnected() {
    return !!(this.net?.IsConnected());
  }

  Connect(userName, userColor, stateChangeHandler, noteOnHandler, noteOffHandler, handleUserAllNotesOff, handleAllNotesOff, handleUserLeave, pleaseReconnectHandler, handleCheer, handleRoomWelcome, google_access_token, onInstrumentLoadProgress, onMyInstrumentChange) {
    this.myUser = new DF.DigifuUser();
    this.myUser.name = userName;
    this.myUser.color = userColor;

    this.tapTempoState = TapTempoState.NA;

    this.stateChangeHandler = stateChangeHandler;
    this.handleUserLeave = handleUserLeave;
    this.handleAllNotesOff = handleAllNotesOff;
    this.handleUserAllNotesOff = handleUserAllNotesOff;
    this.pleaseReconnectHandler = pleaseReconnectHandler;
    this.handleCheer = handleCheer; // ({ user:u.user, text:data.text, x:data.x, y:data.y });
    this.handleRoomWelcome = handleRoomWelcome;
    this.onMyInstrumentChange = onMyInstrumentChange;

    this.resetBeatPhaseOnNextNote = false;

    if (_hasSelectiveDisconnect()) {
      //alert("selective disconnect supported");
    } else {
      alert("selective disconnect not supported. please report this as a bug.");
    }

    this.midi.Init(this);

    window.AudioContext = window.AudioContext || window.webkitAudioContext;
    if (gUseDebugCtx) {
      this.audioCtx = new AudioContextWrapper();
      try {
        this.audioCtx.audioCtx = new AudioContext();
      } catch (e) {
        console.log(e);
      }
    } else {
      try {
        // a higher sample rate means slightly less latency (buffer size is in samples therefore higher sample rate is faster)
        // however it complicates things wrt hardware support. and i did not feel any noticeable change in latency; i think it's not at all the bottleneck.
        this.audioCtx = new AudioContext();
      } catch (e) {
        console.log(e);
      }
      this.audioCtx.beginScope = () => {};
      this.audioCtx.endScope = () => {};
    }

    this.synth.Init(this.audioCtx, () => { return this.roomState; }, onInstrumentLoadProgress,
                    noteOnHandler,
                    noteOffHandler);

    this.metronome.Init(this.audioCtx, this.synth.metronomeGainNode);
    this.soundEffectManager = new SoundFxManager(this.audioCtx, this.synth.soundEffectGainNode);

    //console.log(`APP CONNECT event; installing onpopstate handler`);
    window.onpopstate = (e) => {
      if (e.state && e.state.roomID) {
        //console.log(`you want to move to room ${e.state.roomID}`);
        this.net.JoinRoom(e.state.roomID);
      }
    };

    this.net.Connect(this, google_access_token);
  };

  Disconnect() {
    if (this.net) {
      this.net.Disconnect();
    }
    this.roomState = null;
    this.myUser = null; // new DigifuUser(); // filled in when we identify to a server and fill users
    this.synth.UninitInstruments();
  };
};

module.exports = {
  AudioContextWrapper,
  DigifuApp,
  eMonitoringType,
  TapTempoState,
};
