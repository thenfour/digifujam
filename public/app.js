'use strict';

function DigifuApp() {
    this.roomState = null;

    this.stateChangeHandler = null; // called when any state changes; mostly for debugging / dev purposes only.
    this.noteOnHandler = null; // (user, midiNote) callback to trigger animations
    this.noteOffHandler = null;
    this.handleUserLeave = null;
    this.handleUserAllNotesOff = null;
    this.handleDisconnect = null;

    this.myUser = null;// new DigifuUser(); // filled in when we identify to a server and fill users
    this.myInstrument = null; // filled when ownership is given to you.

    this.midi = new DigifuMidi();
    this.synth = new DigifuSynth(); // contains all music-making stuff.
    this.net = new DigifuNet();
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

    // connect instruments to synth
    this.synth.InitInstruments(this.roomState.instrumentCloset, this.roomState.internalMasterGain);

    // load room CSS
    if (this.roomState.roomCSS) {
        $("head").append("<link rel='stylesheet' id='roomcss' href='" + this.roomState.roomCSS + "' type='text/css' />");
    }

    if (this.stateChangeHandler) {
        this.stateChangeHandler();
    }
};

DigifuApp.prototype.NET_OnUserEnter = function (data) {
    this.roomState.users.push(data);
    //log(`NET_OnUserEnter ${JSON.stringify(data)}`);
    if (this.stateChangeHandler) {
        this.stateChangeHandler();
    }
};

DigifuApp.prototype.NET_OnUserLeave = function (userID) {
    //log("NET_OnUserLeave");

    let foundUser = this.roomState.FindUserByID(userID);
    if (foundUser == null) {
        //log(`  user not found...`);
        return;
    }
    this.roomState.users.splice(foundUser.index, 1);
    if (this.stateChangeHandler) {
        this.stateChangeHandler();
    }
    this.handleUserLeave(userID);
};

DigifuApp.prototype.NET_OnInstrumentOwnership = function (instrumentID, userID /* may be null */, idle) {
    let foundInstrument = this.roomState.FindInstrumentById(instrumentID);
    if (foundInstrument == null) {
        //log(`  instrument not found...`);
        return;
    }

    let foundOldUser = null;
    if (userID) {
        foundOldUser = this.roomState.FindUserByID(userID);
        if (!foundOldUser) return;
        foundOldUser.user.idle = idle;
        console.log(`set user ${foundOldUser.user.userID} to IDLE = ${idle}`);
    }

    if (foundInstrument.instrument.controlledByUserID != userID) {

        // do all notes off when instrument changes for safety.
        this.synth.AllNotesOff(foundInstrument.instrument);
        if (foundOldUser) {
            this.handleUserAllNotesOff(foundOldUser.user, foundInstrument.instrument);
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
        this.roomState.FindUserByID(u.userID).user.pingMS = u.pingMS;
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
    this.roomState.chatLog.push(msg);

    let now = new Date();
    this.roomState.chatLog = this.roomState.chatLog.filter(msg => {
        return ((now - new Date(msg.timestampUTC)) < ClientSettings.ChatHistoryMaxMS);
    });

    this.stateChangeHandler();
}

DigifuApp.prototype.NET_OnUserState = function (data) {
    let u = this.roomState.FindUserByID(data.userID);
    u.user.name = data.name;
    u.user.statusText = data.statusText;
    u.user.color = data.color;
    u.user.img = data.img;
    u.user.position = data.position;
    this.stateChangeHandler();
}

DigifuApp.prototype.NET_OnDisconnect = function () {
    //log("DigifuApp disconnection happened; stop using this object.");
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
        statusText: this.myUser.statusText,
        position: pos
    });
};

DigifuApp.prototype.SetUserNameColorStatus = function (name, color, status) {
    this.net.SendUserState({
        name: name,
        color: color,
        img: this.myUser.img,
        statusText: status,
        position: this.myUser.position
    });
};


DigifuApp.prototype.Connect = function (userName, userColor, userStatusText, stateChangeHandler, noteOnHandler, noteOffHandler, handleUserAllNotesOff, handleUserLeave, disconnectHandler) {
    log("attempting connection... status = " + userStatusText);
    this.myUser = new DigifuUser();
    this.myUser.name = userName;
    this.myUser.color = userColor;
    this.myUser.statusText = userStatusText;

    this.stateChangeHandler = stateChangeHandler;
    this.noteOnHandler = noteOnHandler;
    this.noteOffHandler = noteOffHandler;
    this.handleUserLeave = handleUserLeave;
    this.handleUserAllNotesOff = handleUserAllNotesOff;
    this.handleDisconnect = disconnectHandler;

    this.midi.Init(this);

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
};


