'use strict';

function DigifuApp() {
    this.roomState = null;
    this.shortChatLog = []; // contains aggregated entries instead of the full thing

    this.stateChangeHandler = null; // called when any state changes; mostly for debugging / dev purposes only.
    this.noteOnHandler = null; // (user, midiNote) callback to trigger animations
    this.noteOffHandler = null;
    this.handleUserLeave = null;
    this.handleUserAllNotesOff = null;
    this.handleDisconnect = null;
    this.handleCheer = null; // ({ user:u.user, text:data.text, x:data.x, y:data.y });

    this.myUser = null;// new DigifuUser(); // filled in when we identify to a server and fill users
    this.myInstrument = null; // filled when ownership is given to you.

    this.midi = new DigifuMidi();
    this.synth = new DigifuSynth(); // contains all music-making stuff.
    this.net = new DigifuNet();
};

DigifuApp.prototype._addChatMessage = function (msg) {
    this.roomState.chatLog.push(msg);

    // look at the last message, see if it can be aggregated.
    if (this.shortChatLog.length < 1) {
        this.shortChatLog.push(msg);
        return;
    }
    let lastMsg = this.shortChatLog[this.shortChatLog.length - 1];
    if (lastMsg.messageType == ChatMessageType.aggregate && msg.isAggregatable()) {
        lastMsg.integrate(msg);
        return;
    }
    if (!lastMsg.isAggregatable()) {
        this.shortChatLog.push(msg);
        return;
    }
    let nm = DigifuChatMessage.createAggregate(lastMsg, msg);
    this.shortChatLog[this.shortChatLog.length - 1] = nm;
};

// MIDI HANDLERS --------------------------------------------------------------------------------------
DigifuApp.prototype.MIDI_NoteOn = function (note, velocity) {
    if (this.myInstrument == null) return;
    this.net.SendNoteOn(note, velocity);
    this.synth.NoteOn(this.myInstrument, note, velocity);
    this.noteOnHandler(this.myUser, this.myInstrument, note, velocity);
};

DigifuApp.prototype.MIDI_NoteOff = function (note) {
    if (this.myInstrument == null) return;
    this.net.SendNoteOff(note);
    this.synth.NoteOff(this.myInstrument, note);
    this.noteOffHandler(this.myUser, this.myInstrument, note);
};

// sent when midi devices change
DigifuApp.prototype.MIDI_AllNotesOff = function () {
    if (this.myInstrument == null) return;
    this.net.SendAllNotesOff();
    this.synth.AllNotesOff(this.myInstrument);
    this.handleUserAllNotesOff(this.myUser, this.myInstrument);
};

DigifuApp.prototype.MIDI_PedalDown = function () {
    if (this.myInstrument == null) return;
    this.net.SendPedalDown();
    this.synth.PedalDown(this.myInstrument);
};

DigifuApp.prototype.MIDI_PedalUp = function () {
    if (this.myInstrument == null) return;
    this.net.SendPedalUp();
    this.synth.PedalUp(this.myInstrument);
};



// NETWORK HANDLERS --------------------------------------------------------------------------------------
DigifuApp.prototype.NET_OnPleaseIdentify = function () {
    // send your details
    log(`sending identify as ${JSON.stringify(this.myUser)}`);
    this.net.SendIdentify(this.myUser);
};

DigifuApp.prototype.NET_OnWelcome = function (data) {
    // get user & room state
    // {"yourUserID":1,
    // "roomState":{"InstrumentCloset":[{"Name":"piano","Color":"#884400","InstrumentID":69,"ControlledByUserID":null},{"Name":"marimba","Color":"#00ff00","InstrumentID":420,"ControlledByUserID":null}],"Users":[{"Name":"tenfour","Color":"#ff00ff","UserID":1}]}
    let myUserID = data.yourUserID;

    this.roomState = DigifuRoomState.FromJSONData(data.roomState);

    // find "you"
    this.myUser = this.roomState.FindUserByID(myUserID).user;

    Cookies.set(this.roomName + "_userName", this.myUser.name);
    Cookies.set(this.roomName + "_userColor", this.myUser.color);

    // connect instruments to synth
    this.synth.InitInstruments(this.roomState.instrumentCloset, this.roomState.internalMasterGain);

    // set up init abbreviated chat log
    let ch = this.roomState.chatLog;
    this.roomState.chatLog = [];
    this.shortChatLog = [];
    ch.forEach(msg => { this._addChatMessage(msg); });

    if (this.stateChangeHandler) {
        this.stateChangeHandler();
    }
};

DigifuApp.prototype.NET_OnUserEnter = function (data) {

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

DigifuApp.prototype.NET_OnUserLeave = function (data) {

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

DigifuApp.prototype.NET_OnInstrumentOwnership = function (instrumentID, userID /* may be null */, idle) {
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
        console.log(`user ${foundNewUser.user.name} now idle=${idle}`);
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

DigifuApp.prototype.NET_OnNoteOn = function (userID, note, velocity) {
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

DigifuApp.prototype.NET_OnNoteOff = function (userID, note) {
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

DigifuApp.prototype.NET_OnUserAllNotesOff = function (userID) {
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



DigifuApp.prototype.NET_OnPedalDown = function (userID) {
    let foundInstrument = this.roomState.FindInstrumentByUserID(userID);
    if (foundInstrument == null) {
        //log(`NET_OnPedalDown instrument not found`);
        return;
    }
    this.synth.PedalDown(foundInstrument.instrument);
};

DigifuApp.prototype.NET_OnPedalUp = function (userID) {
    let foundInstrument = this.roomState.FindInstrumentByUserID(userID);
    if (foundInstrument == null) {
        //log(`NET_OnPedalUp instrument not found`);
        return;
    }
    this.synth.PedalUp(foundInstrument.instrument);
};

DigifuApp.prototype.NET_OnPing = function (token, users) {
    this.net.SendPong(token);
    if (!this.roomState) return; // technically a ping could be sent before we've populated room state.
    users.forEach(u => {
        let foundUser = this.roomState.FindUserByID(u.userID);
        if (!foundUser) return; // this is possible because the server may be latent in sending this user data.
        foundUser.user.pingMS = u.pingMS;
    });

    // pings are a great time to do some cleanup.

    // prune chat.
    let now = new Date();
    this.roomState.chatLog = this.roomState.chatLog.filter(msg => {
        return ((now - new Date(msg.timestampUTC)) < ClientSettings.ChatHistoryMaxMS);
    });

    this.stateChangeHandler();
};

DigifuApp.prototype.NET_OnUserChatMessage = function (msg) {

    let ncm = Object.assign(new DigifuChatMessage(), msg);
    ncm.thaw();
    this._addChatMessage(ncm);

    this.stateChangeHandler();
}

DigifuApp.prototype.NET_OnUserState = function (data) {
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
        Cookies.set(this.roomName + "_userName", this.myUser.name);
        Cookies.set(this.roomName + "_userColor", this.myUser.color);
    }

    if (data.chatMessageEntry) {
        let m = Object.assign(new DigifuChatMessage(), data.chatMessageEntry);
        m.thaw();
        this._addChatMessage(m);
    }

    this.stateChangeHandler();
}

DigifuApp.prototype.NET_OnUserCheer = function (data) {
    let u = this.roomState.FindUserByID(data.userID);
    if (!u.user) {
        console.log(`NET_OnUserState: unknown user ${data.userID}`);
        return;
    }

    this.handleCheer({ user: u.user, text: data.text, x: data.x, y: data.y });
    this.stateChangeHandler();
}


DigifuApp.prototype.NET_OnDisconnect = function () {
    this.handleDisconnect();
}

// --------------------------------------------------------------------------------------

DigifuApp.prototype.RequestInstrument = function (instrumentID) {
    this.net.SendRequestInstrument(instrumentID);
};

DigifuApp.prototype.ReleaseInstrument = function () {
    this.net.SendReleaseInstrument();
};

DigifuApp.prototype.SendChatMessage = function (msgText, toUserID) {
    let msg = new DigifuChatMessage();
    msg.message = msgText;
    msg.fromUserID = this.myUser.userID;
    msg.toUserID = toUserID;
    msg.timestampUTC = new Date();

    this.net.SendChatMessage(msg);
};

DigifuApp.prototype.SetUserPosition = function (pos) {
    this.net.SendUserState({
        name: this.myUser.name,
        color: this.myUser.color,
        img: this.myUser.img,
        position: pos
    });
};

DigifuApp.prototype.SetUserNameColor = function (name, color) {
    this.net.SendUserState({
        name: name,
        color: color,
        img: this.myUser.img,
        position: this.myUser.position
    });
};

DigifuApp.prototype.SendCheer = function (text, x, y) {
    text = sanitizeCheerText(text);
    if (text == null) return;
    this.net.SendCheer(text, x, y);
};


DigifuApp.prototype.Connect = function (userName, userColor, stateChangeHandler, noteOnHandler, noteOffHandler, handleUserAllNotesOff, handleUserLeave, disconnectHandler, handleCheer) {
    this.myUser = new DigifuUser();
    this.myUser.name = userName;
    this.myUser.color = userColor;

    this.stateChangeHandler = stateChangeHandler;
    this.noteOnHandler = noteOnHandler;
    this.noteOffHandler = noteOffHandler;
    this.handleUserLeave = handleUserLeave;
    this.handleUserAllNotesOff = handleUserAllNotesOff;
    this.handleDisconnect = disconnectHandler;
    this.handleCheer = handleCheer; // ({ user:u.user, text:data.text, x:data.x, y:data.y });

    this.midi.Init(this);

    this.roomName = routeToRoomName(window.location.pathname); // is it a good idea to calc like this? not sure but for now it is!

    this.audioCtx = new AudioContext();
    // this.audioCtx.audioWorklet.addModule("bitcrush.js").then(() => {
    // });
    this.synth.Init(this.audioCtx);
    this.net.Connect(this);
};

DigifuApp.prototype.Disconnect = function () {
    if (this.net) {
        this.net.Disconnect();
    }
    this.roomState = null;
    this.myUser = null;// new DigifuUser(); // filled in when we identify to a server and fill users
    this.synth.UninitInstruments();
};
