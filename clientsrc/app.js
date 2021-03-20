'use strict';

const DF = require("./DFCommon");
const DFU = require("./util");
const DFMidi = require("./midi");
const DFMetronome = require("./metronome");
const DFSynth = require("./synth");
const DFNet = require("./net");

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

class AudioContextWrapper {
    constructor() {
        this.connectedNodes = [];
        this.audioCtx = null;
        this.scope = [];
        this.byType = {};
        this.byName = {};
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
                if (n.DFType !== "Gain") return false;
                //console.log(`${} val: ${n.gain.value}`);
                if (Math.abs(n.gain.value) < 0.0001) return true;
                if (Math.abs(1. - n.gain.value) < 0.0001) return true;
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
        node.DFID = DF.generateID();
        node.DFName = name;//this.scope.join(" > ") + " > " + (name || "unnamed");
        node.DFType = nodeType;
        node.DFConnectedTo = {};

        node.connect = (dest) => {
            dest.DFID = dest.DFID || DF.generateID();
            node.DFConnectedTo[dest.DFID] = true;

            const idx = this.connectedNodes.findIndex(n => n.DFID == node.DFID);
            // if you connect a node multiple times only count this as 1
            if (idx == -1) {
                this.connectedNodes.push(node);

                if (this.byType[nodeType]) {
                    this.byType[nodeType].push(node);
                } else {
                    this.byType[nodeType] = [node];
                }

                if (this.byName[node.DFName]) {
                    this.byName[node.DFName].push(node);
                } else {
                    this.byName[node.DFName] = [node];
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
    Off: "Off",
    Local: "Local",
    Remote: "Remote"
};

class DigifuApp {
    constructor() {
        window.gDFApp = this; // for debugging, so i can access this class in the JS console.
        this.roomState = null;
        this.worldPopulation = 0; // calculated on ping
        this.shortChatLog = []; // contains aggregated entries instead of the full thing

        this.stateChangeHandler = null; // called when any state changes; mostly for debugging / dev purposes only.
        this.handleRoomWelcome = null; // called when you enter a new room.
        this.noteOnHandler = null; // (user, midiNote) callback to trigger animations
        this.noteOffHandler = null;
        this.handleUserLeave = null;
        this.handleUserAllNotesOff = null;
        this.handleAllNotesOff = null;
        this.pleaseReconnectHandler = null;
        this.handleCheer = null; // ({ user:u.user, text:data.text, x:data.x, y:data.y });
        this.lastCheerSentDate = new Date();

        this.resetBeatPhaseOnNextNote = false;

        this.myUser = null;// new DigifuUser(); // filled in when we identify to a server and fill users
        this.myInstrument = null; // filled when ownership is given to you.

        this._pitchBendRange = 2;
        this._midiPBValue = 0; // -1 to 1

        this.midi = new DFMidi.DigifuMidi();
        this.metronome = new DFMetronome.DigifuMetronome();
        this.synth = new DFSynth.DigifuSynth(); // contains all music-making stuff.
        //this.isSelfMuted = false; // ability to mute yourself

        // monitoring your own playback
        this.monitoringType = eMonitoringType.Local;

        this.net = new DFNet.DigifuNet();

        this.deviceNameList = [];

        DFMidi.GetMidiInputDeviceList().then(inputs => {
            this.deviceNameList = inputs;
            if (this.stateChangeHandler) {
                this.stateChangeHandler();
            }
        });
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
        // Object.keys(this.instruments).forEach(k => {
        //     this.instruments[k].setPitchBendRange(val);
        // });
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

    // MIDI HANDLERS --------------------------------------------------------------------------------------
    MIDI_NoteOn(note, velocity) {
        if (this.myInstrument == null) return;
        this.net.SendNoteOn(note, velocity, this.resetBeatPhaseOnNextNote);
        this.resetBeatPhaseOnNextNote = false;
        if (this.monitoringType == eMonitoringType.Local) {
            this.synth.NoteOn(this.myInstrument, note, velocity);
            this.noteOnHandler(this.myUser, this.myInstrument, note, velocity);
        }
    };

    MIDI_NoteOff(note) {
        if (this.myInstrument == null) return;
        this.net.SendNoteOff(note);
        if (this.monitoringType == eMonitoringType.Local) {
            this.synth.NoteOff(this.myInstrument, note);
            this.noteOffHandler(this.myUser, this.myInstrument, note);
        }
    };

    // sent when midi devices change
    MIDI_AllNotesOff() {
        if (this.myInstrument == null) return;
        this.net.SendAllNotesOff();
        this.synth.AllNotesOff(this.myInstrument);
        this.handleUserAllNotesOff(this.myUser, this.myInstrument);
    };

    MIDI_PedalDown() {
        if (this.myInstrument == null) return;
        this.net.SendPedalDown();
        if (this.monitoringType == eMonitoringType.Local) {
            this.synth.PedalDown(this.myInstrument);
        }
    };

    MIDI_PedalUp() {
        if (this.myInstrument == null) return;
        this.net.SendPedalUp();
        if (this.monitoringType == eMonitoringType.Local) {
            this.synth.PedalUp(this.myInstrument);
        }
    };

    // val is -1 to 1
    MIDI_PitchBend(val) {
        this._midiPBValue = val;
        if (this.myInstrument == null) return;
        let patchObj = { "pb": val * this.pitchBendRange };
        this.net.SendInstrumentParams(patchObj, false);
        if (this.monitoringType == eMonitoringType.Local) {
            if (this.synth.SetInstrumentParams(this.myInstrument, patchObj, false)) {
                this.stateChangeHandler();
            }
        }
    };

    MIDI_CC(cc, val) {
        if (this.myInstrument == null) return;
        if (!this.myInstrument.MIDICCHasMappings(cc)) return;
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

    // NETWORK HANDLERS --------------------------------------------------------------------------------------
    NET_OnPleaseIdentify() {
        this.net.SendIdentify(this.myUser);
    };

    NET_OnWelcome(data) {

        this.resetBeatPhaseOnNextNote = false;

        // get user & room state
        let myUserID = data.yourUserID;

        this.roomState = DF.DigifuRoomState.FromJSONData(data.roomState);

        // room-specific CSS is loaded at startup, so your initial room is also the CSS you load. joining new rooms doesn't load new CSS.
        const stylesheet = document.getElementById('roomcss');
        if (stylesheet) {
            stylesheet.parentNode.removeChild(stylesheet);
        }
        // $("head").append("<link rel='stylesheet' id='roomcss' href='" + this.roomState.roomID + ".css' type='text/css' />");

        this.accessLevel = data.accessLevel;

        // find "you"
        this.myUser = this.roomState.FindUserByID(myUserID).user;

        window.localStorage.setItem("userName", this.myUser.name);
        window.localStorage.setItem("userColor", this.myUser.color);

        // this is a client-only property.
        this.roomState.instrumentCloset.forEach(i => {
            i.isMuted = false;
        });

        // connect instruments to synth
        this.synth.InitInstruments(this.roomState.instrumentCloset, this.roomState.internalMasterGain);

        //set metronome bpm to the room bpm
        //this.metronome.bpm = this.roomState.bpm;

        // are any instruments assigned to you?
        this.myInstrument = this.roomState.instrumentCloset.find(i => i.controlledByUserID == myUserID);

        // set up init abbreviated chat log
        let ch = this.roomState.chatLog;
        this.roomState.chatLog = [];
        this.shortChatLog = [];
        ch.forEach(msg => { this._addChatMessage(msg); });

        this.synth.AllNotesOff();
        this.handleAllNotesOff();

        this.handleRoomWelcome();
    };

    NET_OnUserEnter(data) {
        if (!this.roomState) return;

        let nu = Object.assign(new DF.DigifuUser(), data.user);
        nu.thaw();
        this.roomState.users.push(nu);

        let msg = Object.assign(new DF.DigifuChatMessage, data.chatMessageEntry);
        msg.thaw();
        this._addChatMessage(msg);

        if (this.stateChangeHandler) {
            this.stateChangeHandler();
        }
    };

    NET_OnUserLeave(data) {
        if (!this.roomState) return;

        let foundUser = this.roomState.FindUserByID(data.userID);
        if (foundUser == null) {
            //log(`  user not found...`);
            return;
        }
        this.roomState.users.splice(foundUser.index, 1);

        let msg = Object.assign(new DF.DigifuChatMessage, data.chatMessageEntry);
        msg.thaw();
        this._addChatMessage(msg);

        if (this.stateChangeHandler) {
            this.stateChangeHandler();
        }
        this.handleUserLeave(data.userID);
    };

    NET_OnInstrumentOwnership(instrumentID, userID /* may be null */, idle) {
        if (!this.roomState) return;
        let foundInstrument = this.roomState.FindInstrumentById(instrumentID);
        if (foundInstrument == null) {
            //log(`  instrument not found...`);
            return;
        }

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
            } else {
                // or if your instrument is being given to someone else, then you no longer have an instrument
                if (foundInstrument.instrument.controlledByUserID == this.myUser.userID) {
                    this.myInstrument = null;
                }
            }
            foundInstrument.instrument.controlledByUserID = userID;
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
        noteOns.forEach(e => {
            this.NET_OnNoteOn(e.userID, e.note, e.velocity);
        });
        noteOffs.forEach(e => {
            this.NET_OnNoteOff(e.userID, e.note);
        });
    }

    NET_OnNoteOn(userID, note, velocity) {
        if (!this.roomState) return;
        let foundUser = this.roomState.FindUserByID(userID);
        if (!foundUser) return;
        let foundInstrument = this.roomState.FindInstrumentByUserID(userID);
        if (!foundInstrument) return;

        if (foundUser.user.userID == this.myUser.userID) {
            if (this.monitoringType !== eMonitoringType.Remote) {
                return;
            }
        }

        this.synth.NoteOn(foundInstrument.instrument, note, velocity);
        this.noteOnHandler(foundUser.user, foundInstrument.instrument, note, velocity);
    };

    NET_OnNoteOff(userID, note) {
        if (!this.roomState) return;
        let foundUser = this.roomState.FindUserByID(userID);
        if (!foundUser) return;
        let foundInstrument = this.roomState.FindInstrumentByUserID(userID);
        if (!foundInstrument) return;

        if (foundUser.user.userID == this.myUser.userID) {
            if (this.monitoringType !== eMonitoringType.Remote) {
                return;
            }
        }
        this.synth.NoteOff(foundInstrument.instrument, note);
        this.noteOffHandler(foundUser.user, foundInstrument.instrument, note);
    };

    NET_OnUserAllNotesOff(userID) {
        if (!this.roomState) return;
        let foundUser = this.roomState.FindUserByID(userID);
        if (!foundUser) return;
        let foundInstrument = this.roomState.FindInstrumentByUserID(userID);
        if (foundInstrument == null) {
            //log(`instrument not found`);
            return;
        }
        this.synth.AllNotesOff(foundInstrument.instrument);
        this.handleUserAllNotesOff(foundUser.user, foundInstrument.instrument);
    };

    NET_OnPedalDown(userID) {
        if (!this.roomState) return;
        let foundInstrument = this.roomState.FindInstrumentByUserID(userID);
        if (!foundInstrument) return;

        if (userID == this.myUser.userID) {
            if (this.monitoringType !== eMonitoringType.Remote) {
                return;
            }
        }
        this.synth.PedalDown(foundInstrument.instrument);
    };

    NET_OnPedalUp(userID) {
        if (!this.roomState) return;
        let foundInstrument = this.roomState.FindInstrumentByUserID(userID);
        if (!foundInstrument) return;

        if (userID == this.myUser.userID) {
            if (this.monitoringType !== eMonitoringType.Remote) {
                return;
            }
        }
        this.synth.PedalUp(foundInstrument.instrument);
    };

    NET_OnInstrumentParams(data) // userID, instrumentID, patchObj, isWholePatch
    {
        if (!this.roomState) return;
        let foundInstrument = this.roomState.FindInstrumentByUserID(data.userID);
        if (!foundInstrument) return;

        if (data.userID == this.myUser.userID) {
            if (this.monitoringType !== eMonitoringType.Remote) {
                return;
            }
        }
        if (this.synth.SetInstrumentParams(foundInstrument.instrument, data.patchObj, data.isWholePatch)) {
            this.stateChangeHandler();
        } else if (this.observingInstrument && foundInstrument.instrument.instrumentID == this.observingInstrument.instrumentID) {
            this.stateChangeHandler();
        }
    }

    // // instrumentID, paramID, srcVal
    NET_OnCreateParamMapping(data) {
        if (!this.roomState) return;
        let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
        if (foundInstrument == null) {
            //log(`NET_OnInstrumentParam instrument not found`);
            return;
        }
        this.synth.createParamMapping(foundInstrument.instrument, foundInstrument.instrument.GetParamByID(data.paramID), data.srcVal);
    }

    // instrumentID, paramID
    NET_OnRemoveParamMapping(data) {
        if (!this.roomState) return;
        let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
        if (foundInstrument == null) {
            //log(`NET_OnInstrumentParam instrument not found`);
            return;
        }
        this.synth.removeParamMapping(foundInstrument.instrument, foundInstrument.instrument.GetParamByID(data.paramID));
    }


    NET_OnInstrumentPresetDelete(data) { // instrumentID, presetID
        if (!this.roomState) return;
        let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
        if (foundInstrument == null) {
            return;
        }
        const bank = this.roomState.GetPresetBankForInstrument(foundInstrument.instrument);

        bank.presets.removeIf(p => p.presetID == data.presetID);
        this.stateChangeHandler();
    }

    NET_OnInstrumentFactoryReset(data) { // instrumentID, presets:[presets]
        if (!this.roomState) return;
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
        if (!this.roomState) return;
        let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
        if (foundInstrument == null) {
            return;
        }

        this.roomState.importAllPresetsArray(foundInstrument.instrument, data.presets, false);

        this.stateChangeHandler();
    }

    NET_OnInstrumentPresetSave(data) { // instrumentID, patchObj:{params} just like InstParams, except will be saved. the "presetID" param specifies preset to overwrite. may be new.
        if (!this.roomState) return;
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

    NET_OnPing(data) {
        if (!this.roomState) return;
        this.net.SendPong(data.token);
        if (!this.roomState) return; // technically a ping could be sent before we've populated room state.

        // token, rooms: [{roomID, roomName, users [{ userid, pingMS }], stats}]
        this.rooms = data.rooms;

        // bring user stats to our room's user list
        let room = data.rooms.find(r => r.roomID == this.roomState.roomID);
        console.assert(!!room, "what, we're in a room, get a ping that doesn't have stats about this room???");
        room.users.forEach(u => {
            let foundUser = this.roomState.FindUserByID(u.userID);
            if (!foundUser) return; // this is possible because the server may be latent in sending this user data.
            //foundUser.user.pingMS = u.pingMS;
            foundUser.user.IntegrateFromPing(u);
        });
        this.worldPopulation = data.rooms.reduce((a, b) => a + b.users.length, 0);
        this.serverUptimeSec = data.serverUptimeSec;

        // pings are a great time to do some cleanup.

        // prune chat.
        let now = new Date();
        this.roomState.chatLog = this.roomState.chatLog.filter(msg => {
            return ((now - new Date(msg.timestampUTC)) < DF.ClientSettings.ChatHistoryMaxMS);
        });
        this.shortChatLog = this.shortChatLog.filter(msg => {
            return ((now - new Date(msg.timestampUTC)) < DF.ClientSettings.ChatHistoryMaxMS);
        });

        this.stateChangeHandler();
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
        }
    }

    NET_OnUserChatMessage(msg) {
        if (!this.roomState) return;

        let ncm = Object.assign(new DF.DigifuChatMessage(), msg);
        ncm.thaw();
        this._addChatMessage(ncm);

        this.stateChangeHandler();
    }

    NET_OnUserState(data) {
        if (!this.roomState) return;
        let u = this.roomState.FindUserByID(data.state.userID);
        if (!u.user) {
            console.log(`NET_OnUserState: unknown user ${data.state.userID}`);
            return;
        }
        u.user.name = data.state.name;
        u.user.color = data.state.color;
        u.user.img = data.state.img;
        u.user.position = data.state.position;

        if (u.user.userID == this.myUser.userID) {
            window.localStorage.setItem("userName", this.myUser.name);
            window.localStorage.setItem("userColor", this.myUser.color);
            // room interaction based on intersection.
            this.roomState.roomItems.forEach(item => {
                if (item.rect.PointIntersects(this.myUser.position)) {
                    this._DoUserItemInteraction(item, "onAvatarEnter");
                }
            });
        }

        if (data.chatMessageEntry) {
            let m = Object.assign(new DF.DigifuChatMessage(), data.chatMessageEntry);
            m.thaw();
            this._addChatMessage(m);
        }

        this.stateChangeHandler();
    }

    NET_OnUserCheer(data) {
        if (!this.roomState) return;
        let u = this.roomState.FindUserByID(data.userID);
        if (!u.user) {
            console.log(`NET_OnUserState: unknown user ${data.userID}`);
            return;
        }

        this.handleCheer({ user: u.user, text: data.text, x: data.x, y: data.y });
        this.stateChangeHandler();
    }

    NET_OnRoomBeat(data) {
        // data.bpm
        this.metronome.OnRoomBeat();
    }

    NET_OnRoomBPMUpdate(data) {
        this.roomState.bpm = data.bpm;
        this.stateChangeHandler();
        //this.metronome.setServerBPM(data.bpm);
    }

    NET_pleaseReconnectHandler() {
        this.pleaseReconnectHandler();
    }


    NET_OnDisconnect() {
        //this.handleDisconnect();
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
            name: this.myUser.name,
            color: this.myUser.color,
            img: this.myUser.img,
            position: pos
        });
    };

    SetUserNameColor(name, color) {
        this.net.SendUserState({
            name: name,
            color: color,
            img: this.myUser.img,
            position: this.myUser.position
        });
    };

    SendRoomBPM (bpm) {
        if (bpm != this.roomState.bpm) {
            this.net.SendRoomBPM(bpm);
        }
    };

    SetQuantizationSpec(beatDivision) {
        this.net.SendUserQuantizationSpec(beatDivision);
        this.myUser.quantizeBeatDivision = beatDivision;
    }

    SendCheer(text, x, y) {

        const now = new Date();
        if ((now - this.lastCheerSentDate) < DF.ClientSettings.MinCheerIntervalMS) return;

        this.lastCheerSentDate = now;

        text = DF.sanitizeCheerText(text);
        if (text == null) return;
        this.net.SendCheer(text, x, y);
    };

    loadPatchObj(presetObj /* RAW values */, isWholePatch) {
        if (!this.myInstrument) return;
        this.net.SendInstrumentParams(presetObj, isWholePatch);
        if (this.synth.SetInstrumentParams(this.myInstrument, presetObj, isWholePatch)) {
            this.stateChangeHandler();
        }
    };

    SetInstrumentParam(inst, param, newVal) {
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
        if (!this.myInstrument) return;
        if (!presetObj) return;
        if (!presetObj.presetID) return;
        this.net.SendDeletePreset(presetObj.presetID);
    }

    savePreset(patchObj) {
        if (!this.myInstrument) return;
        this.net.SendInstrumentPresetSave(patchObj);
    }

    // saves the live patch. if it's a loaded preset, then it will overwrite the orig. if it's not, then it will be saved as new
    saveLoadedPreset() {
        if (!this.myInstrument) return;
        this.savePreset(this.myInstrument.exportPatchObj());
    }

    // save live as a new preset, even if the current patch is an existing one.
    savePatchAsNewPreset() {
        if (!this.myInstrument) return;
        // force saving as new. IT ALSO allows us to know that when the server comes back with a presetID, we should use it live.
        this.myInstrument.GetParamByID("presetID").currentValue = null;
        this.myInstrument.GetParamByID("presetID").rawValue = null;
        this.saveLoadedPreset();
    }

    saveOverwriteExistingPreset(presetIDToOverwrite) {
        if (!this.myInstrument) return;
        this.myInstrument.GetParamByID("presetID").currentValue = presetIDToOverwrite;
        this.myInstrument.GetParamByID("presetID").rawValue = presetIDToOverwrite;
        this.saveLoadedPreset();
    }

    // return true/false success
    mergePresetBankJSON(bankJSON) {
        if (!DFU.IsValidJSONString(bankJSON)) return false;
        if (!this.myInstrument) return false;
        this.net.SendInstrumentBankMerge(bankJSON);
    }

    factoryResetInstrument() {
        if (!this.myInstrument) return false;
        this.net.SendInstrumentFactoryReset();
    }

    loadInitPatch() {
        if (!this.myInstrument) return false;
        const presetObj = this.roomState.GetInitPreset(this.myInstrument);
        this.loadPatchObj(presetObj, true);
    }

    createParamMappingFromSrcVal(param, srcVal) { // srcVal is directly mapped to MIDI CC
        if (!this.myInstrument) return;
        this.net.SendCreateParamMapping(param, srcVal);
        this.synth.createParamMapping(this.myInstrument, param, srcVal);
    }

    createParamMappingFromMacro(param, macroIndex) {
        return this.createParamMappingFromSrcVal(param, macroIndex + DF.eParamMappingSource.Macro0);
    }

    removeParamMapping(param) {
        if (!this.myInstrument) return;
        this.net.SendRemoveParamMapping(param);
        this.synth.removeParamMapping(this.myInstrument, param);
    }

    setMonitoringType(mt) {
        this.monitoringType = mt;
        if (this.myInstrument == null) return;
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

    Connect(userName, userColor, stateChangeHandler, noteOnHandler, noteOffHandler, handleUserAllNotesOff, handleAllNotesOff, handleUserLeave, pleaseReconnectHandler, handleCheer, handleRoomWelcome, google_access_token) {
        this.myUser = new DF.DigifuUser();
        this.myUser.name = userName;
        this.myUser.color = userColor;

        this.stateChangeHandler = stateChangeHandler;
        this.noteOnHandler = noteOnHandler;
        this.noteOffHandler = noteOffHandler;
        this.handleUserLeave = handleUserLeave;
        this.handleAllNotesOff = handleAllNotesOff;
        this.handleUserAllNotesOff = handleUserAllNotesOff;
        this.pleaseReconnectHandler = pleaseReconnectHandler;
        this.handleCheer = handleCheer; // ({ user:u.user, text:data.text, x:data.x, y:data.y });
        this.handleRoomWelcome = handleRoomWelcome;
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
            this.audioCtx.audioCtx = new AudioContext();
        } else {
            this.audioCtx = new AudioContext();
            this.audioCtx.beginScope = () => { };
            this.audioCtx.endScope = () => { };
        }

        this.synth.Init(this.audioCtx);
        this.metronome.Init(this.audioCtx, this.synth.metronomeGainNode);
        this.net.Connect(this, google_access_token);
    };

    Disconnect() {
        if (this.net) {
            this.net.Disconnect();
        }
        this.roomState = null;
        this.myUser = null;// new DigifuUser(); // filled in when we identify to a server and fill users
        this.synth.UninitInstruments();
    };

};

module.exports = {
    AudioContextWrapper,
    DigifuApp,
    eMonitoringType,
};

