'use strict';

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

        this.myUser = null;// new DigifuUser(); // filled in when we identify to a server and fill users
        this.myInstrument = null; // filled when ownership is given to you.

        this._pitchBendRange = 2;
        this._midiPBValue = 0; // -1 to 1

        this.accessLevel = AccessLevels.User; // on the client of course this doesn't allow you to do anything except send the commands to the server who will reject them.

        this.midi = new DigifuMidi();
        this.synth = new DigifuSynth(); // contains all music-making stuff.
        this.net = new DigifuNet();

        this.deviceNameList = [];

        GetMidiInputDeviceList().then(inputs => {
            this.deviceNameList = inputs;
            if (this.stateChangeHandler) {
                this.stateChangeHandler();
            }
        });
    }

    get isAdmin() {
        return this.accessLevel == AccessLevels.Admin;
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
            if (lastMsg.messageType == ChatMessageType.aggregate) {
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
        this.net.SendNoteOn(note, velocity);
        this.synth.NoteOn(this.myInstrument, note, velocity);
        this.noteOnHandler(this.myUser, this.myInstrument, note, velocity);
    };

    MIDI_NoteOff(note) {
        if (this.myInstrument == null) return;
        this.net.SendNoteOff(note);
        this.synth.NoteOff(this.myInstrument, note);
        this.noteOffHandler(this.myUser, this.myInstrument, note);
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
        this.synth.PedalDown(this.myInstrument);
    };

    MIDI_PedalUp() {
        if (this.myInstrument == null) return;
        this.net.SendPedalUp();
        this.synth.PedalUp(this.myInstrument);
    };

    // val is -1 to 1
    MIDI_PitchBend(val) {
        this._midiPBValue = val;
        if (this.myInstrument == null) return;
        let patchObj = { "pb": val * this.pitchBendRange };
        this.net.SendInstrumentParams(patchObj);
        this.synth.SetInstrumentParams(this.myInstrument, patchObj);
    };


    // NETWORK HANDLERS --------------------------------------------------------------------------------------
    NET_OnPleaseIdentify() {
        this.net.SendIdentify(this.myUser);
    };

    NET_OnWelcome(data) {
        // get user & room state
        let myUserID = data.yourUserID;

        this.roomState = DigifuRoomState.FromJSONData(data.roomState);

        // room-specific CSS is loaded at startup, so your initial room is also the CSS you load. joining new rooms doesn't load new CSS.
        const stylesheet = document.getElementById('roomcss');
        if (stylesheet) {
            stylesheet.parentNode.removeChild(stylesheet);
        }
        $("head").append("<link rel='stylesheet' id='roomcss' href='" + this.roomState.roomID + ".css' type='text/css' />");

        this.accessLevel = data.accessLevel;

        // find "you"
        this.myUser = this.roomState.FindUserByID(myUserID).user;

        Cookies.set(this.roomState.roomID + "_userName", this.myUser.name);
        Cookies.set(this.roomState.roomID + "_userColor", this.myUser.color);

        // connect instruments to synth
        this.synth.InitInstruments(this.roomState.instrumentCloset, this.roomState.internalMasterGain);

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

        let nu = Object.assign(new DigifuUser(), data.user);
        nu.thaw();
        this.roomState.users.push(nu);

        let msg = Object.assign(new DigifuChatMessage, data.chatMessageEntry);
        msg.thaw();
        this._addChatMessage(msg);

        if (this.stateChangeHandler) {
            this.stateChangeHandler();
        }
    };

    NET_OnUserLeave(data) {

        let foundUser = this.roomState.FindUserByID(data.userID);
        if (foundUser == null) {
            //log(`  user not found...`);
            return;
        }
        this.roomState.users.splice(foundUser.index, 1);

        let msg = Object.assign(new DigifuChatMessage, data.chatMessageEntry);
        msg.thaw();
        this._addChatMessage(msg);

        if (this.stateChangeHandler) {
            this.stateChangeHandler();
        }
        this.handleUserLeave(data.userID);
    };

    NET_OnInstrumentOwnership(instrumentID, userID /* may be null */, idle) {
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

    NET_OnNoteOn(userID, note, velocity) {
        let foundUser = this.roomState.FindUserByID(userID);
        if (!foundUser) return;
        let foundInstrument = this.roomState.FindInstrumentByUserID(userID);
        if (foundInstrument == null) {
            //log(`instrument not found`);
            return;
        }
        this.synth.NoteOn(foundInstrument.instrument, note, velocity);
        this.noteOnHandler(foundUser.user, foundInstrument.instrument, note, velocity);
    };

    NET_OnNoteOff(userID, note) {
        let foundUser = this.roomState.FindUserByID(userID);
        if (!foundUser) return;
        let foundInstrument = this.roomState.FindInstrumentByUserID(userID);
        if (foundInstrument == null) {
            //log(`instrument not found`);
            return;
        }
        this.synth.NoteOff(foundInstrument.instrument, note);
        this.noteOffHandler(foundUser.user, foundInstrument.instrument, note);
    };

    NET_OnUserAllNotesOff(userID) {
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
        let foundInstrument = this.roomState.FindInstrumentByUserID(userID);
        if (foundInstrument == null) {
            //log(`NET_OnPedalDown instrument not found`);
            return;
        }
        this.synth.PedalDown(foundInstrument.instrument);
    };

    NET_OnPedalUp(userID) {
        let foundInstrument = this.roomState.FindInstrumentByUserID(userID);
        if (foundInstrument == null) {
            //log(`NET_OnPedalUp instrument not found`);
            return;
        }
        this.synth.PedalUp(foundInstrument.instrument);
    };

    NET_OnInstrumentParams(data) // userID, instrumentID, patchObj
    {
        let foundInstrument = this.roomState.FindInstrumentByUserID(data.userID);
        if (foundInstrument == null) {
            //log(`NET_OnInstrumentParam instrument not found`);
            return;
        }
        this.synth.SetInstrumentParams(foundInstrument.instrument, data.patchObj);
        if (this.observingInstrument && foundInstrument.instrument.instrumentID == this.observingInstrument.instrumentID) {
            this.stateChangeHandler();
        }
    }

    NET_OnInstrumentPresetDelete(data) { // instrumentID, presetID
        let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
        if (foundInstrument == null) {
            return;
        }
        foundInstrument.instrument.presets.removeIf(p => p.presetID == data.presetID);
        this.stateChangeHandler();
    }

    NET_OnInstrumentFactoryReset(data) { // instrumentID, presets:[presets]
        let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
        if (foundInstrument == null) {
            return;
        }

        foundInstrument.instrument.importAllPresetsArray(data.presets);
        let initPreset = foundInstrument.instrument.GetInitPreset();
        this.synth.SetInstrumentParams(foundInstrument.instrument, initPreset);

        this.stateChangeHandler();
    }

    NET_OnInstrumentBankReplace(data) { // [presets]
        let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
        if (foundInstrument == null) {
            return;
        }

        foundInstrument.instrument.importAllPresetsArray(data.presets);

        this.stateChangeHandler();
    }

    NET_OnInstrumentPresetSave(data) { // instrumentID, patchObj:{params} just like InstParams, except will be saved. the "presetID" param specifies preset to overwrite. may be new.
        let foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
        if (foundInstrument == null) {
            return;
        }

        let existing = foundInstrument.instrument.presets.find(p => p.presetID == data.patchObj.presetID);
        if (existing) {
            Object.assign(existing, data.patchObj);
        } else {
            foundInstrument.instrument.presets.push(data.patchObj);
        }

        // if you saved as a NEW preset, integrate the new ID.
        if (this.myInstrument) {
            if (foundInstrument.instrument.instrumentID == this.myInstrument.instrumentID) {
                if (!this.myInstrument.GetParamByID("presetID").currentValue) {
                    this.myInstrument.GetParamByID("presetID").currentValue = data.patchObj.presetID;
                }
            }
        }

        this.stateChangeHandler();
    }

    NET_OnPing(data) {
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
            foundUser.user.pingMS = u.pingMS;
        });
        this.worldPopulation = data.rooms.reduce((a,b) => a + b.users.length, 0);

        // pings are a great time to do some cleanup.

        // prune chat.
        let now = new Date();
        this.roomState.chatLog = this.roomState.chatLog.filter(msg => {
            return ((now - new Date(msg.timestampUTC)) < ClientSettings.ChatHistoryMaxMS);
        });
        this.shortChatLog = this.shortChatLog.filter(msg => {
            return ((now - new Date(msg.timestampUTC)) < ClientSettings.ChatHistoryMaxMS);
        });

        this.stateChangeHandler();
    };

    NET_OnUserChatMessage(msg) {

        let ncm = Object.assign(new DigifuChatMessage(), msg);
        ncm.thaw();
        this._addChatMessage(ncm);

        this.stateChangeHandler();
    }

    NET_OnUserState(data) {
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
            Cookies.set(this.roomState.roomID + "_userName", this.myUser.name);
            Cookies.set(this.roomState.roomID + "_userColor", this.myUser.color);
            // room interaction based on intersection.
            this.roomState.roomItems.forEach(item => {
                if (item.rect.PointIntersects(this.myUser.position)) {
                    this._DoUserItemInteraction(item, "onAvatarEnter");
                }
            });
        }

        if (data.chatMessageEntry) {
            let m = Object.assign(new DigifuChatMessage(), data.chatMessageEntry);
            m.thaw();
            this._addChatMessage(m);
        }

        this.stateChangeHandler();
    }

    NET_OnUserCheer(data) {
        let u = this.roomState.FindUserByID(data.userID);
        if (!u.user) {
            console.log(`NET_OnUserState: unknown user ${data.userID}`);
            return;
        }

        this.handleCheer({ user: u.user, text: data.text, x: data.x, y: data.y });
        this.stateChangeHandler();
    }

    NET_pleaseReconnectHandler() {
        this.pleaseReconnectHandler();
    }


    NET_OnDisconnect() {
        //console.log(`what is iths`);
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
        let msg = new DigifuChatMessage();
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
            case RoomFns.toggleSign:
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

    SendCheer(text, x, y) {
        text = sanitizeCheerText(text);
        if (text == null) return;
        this.net.SendCheer(text, x, y);
    };

    loadPatchObj(presetObj) {
        if (!this.myInstrument) return;
        Object.keys(presetObj).forEach(k => {
            presetObj[k] = this.myInstrument.sanitizeInstrumentParamVal(k, presetObj[k]);
        });
        this.net.SendInstrumentParams(presetObj);
        this.synth.SetInstrumentParams(this.myInstrument, presetObj);
    };


    SetInstrumentParam(inst, param, newVal) {
        let presetObj = {};
        newVal = inst.sanitizeInstrumentParamVal(param, newVal);

        presetObj[param.paramID] = newVal;
        this.loadPatchObj(presetObj);
    };


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
        this.saveLoadedPreset();
    }

    saveOverwriteExistingPreset(presetIDToOverwrite) {
        if (!this.myInstrument) return;
        this.myInstrument.GetParamByID("presetID").currentValue = presetIDToOverwrite;
        this.saveLoadedPreset();
    }

    // return true/false success
    importAllPresetsJSON(bankJSON) {
        if (!IsValidJSONString(bankJSON)) return false;
        if (!this.myInstrument) return false;
        //this.myInstrument.importAllPresetsJSON(bankJSON);
        this.net.SendInstrumentBankReplace(bankJSON);
    }

    factoryResetInstrument() {
        if (!this.myInstrument) return false;
        this.net.SendInstrumentFactoryReset();
    }




    Connect(userName, userColor, stateChangeHandler, noteOnHandler, noteOffHandler, handleUserAllNotesOff, handleAllNotesOff, handleUserLeave, pleaseReconnectHandler, handleCheer, handleRoomWelcome) {
        this.myUser = new DigifuUser();
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

        this.midi.Init(this);

        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioContext();
        // this.audioCtx.audioWorklet.addModule("bitcrush.js").then(() => {
        // });
        this.synth.Init(this.audioCtx);
        this.net.Connect(this);
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

