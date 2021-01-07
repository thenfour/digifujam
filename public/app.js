'use strict';

function DigifuApp() {
    this.roomState = null;

    this.stateChangeHandler = null; // called when any state changes; mostly for debugging / dev purposes only.
    this.userStateChangeHandler = null; // similar, but only for user list updates. just to be lighter weight.

    this.myUser = null;// new DigifuUser(); // filled in when we identify to a server and fill users
    this.myInstrument = null; // filled when ownership is given to you.

    this.midi = new DigifuMidi();
    this.synth = new DigifuSynth(); // contains all music-making stuff.
    this.net = new DigifuNet();
};

// returns { instrument, index }
DigifuApp.prototype.FindInstrumentById = function (instrumentID) {
    let ret = null;
    this.roomState.instrumentCloset.forEach(function (instrument, index) {
        if (instrument.instrumentID != instrumentID) return;
        ret = { instrument, index };
    });
    return ret;
};

// returns { instrument, index }
DigifuApp.prototype.FindInstrumentByUserID = function (userID) {
    let ret = null;
    this.roomState.instrumentCloset.forEach(function (instrument, index) {
        if (instrument.controlledByUserID != userID) return;
        ret = { instrument, index };
    });
    return ret;
};

// returns { instrument, index }
DigifuApp.prototype.FindUserByID = function (userID) {
    let ret = null;
    this.roomState.users.forEach(function (user, index) {
        if (user.userID != userID) return;
        ret = { user, index };
    });
    return ret;
};


// MIDI HANDLERS --------------------------------------------------------------------------------------
DigifuApp.prototype.MIDI_NoteOn = function (note, velocity) {
    if (this.myInstrument == null) return;
    this.net.SendNoteOn(note, velocity);
    this.synth.NoteOn(this.myInstrument, note, velocity);
};

DigifuApp.prototype.MIDI_NoteOff = function (note) {
    if (this.myInstrument == null) return;
    this.net.SendNoteOff(note);
    this.synth.NoteOff(this.myInstrument, note);
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
    this.roomState = data.roomState;

    // find "you"
    this.roomState.users.forEach(u => {
        if (u.userID !== myUserID) return;
        this.myUser = u;
    });

    // connect instruments to synth
    this.synth.InitInstruments(this.roomState.instrumentCloset);

    if (this.stateChangeHandler) {
        this.stateChangeHandler();
    }
};

DigifuApp.prototype.NET_OnUserEnter = function (data) {
    this.roomState.users.push(data);
    log(`NET_OnUserEnter ${JSON.stringify(data)}`);
    if (this.stateChangeHandler) {
        this.stateChangeHandler();
    }
};

DigifuApp.prototype.NET_OnUserLeave = function (userID) {
    log("NET_OnUserLeave");

    let foundUser = this.FindUserByID(userID);
    if (foundUser == null) {
        log(`  user not found...`);
        return;
    }
    this.roomState.users.splice(foundUser.index, 1);
    if (this.stateChangeHandler) {
        this.stateChangeHandler();
    }
};

DigifuApp.prototype.NET_OnInstrumentOwnership = function (instrumentID, userID /* may be null */) {
    log(`NET_OnInstrumentOwnership ${instrumentID} ${userID}`);

    // we might validate the userid but not strictly necessary.

    let foundInstrument = this.FindInstrumentById(instrumentID);
    if (foundInstrument == null) {
        log(`  instrument not found...`);
        return;
    }

    this.synth.AllNotesOff(foundInstrument.instrument);

    if (userID == this.myUser.userID) {
        this.myInstrument = foundInstrument.instrument;
        } else {
        // or if your instrument is being given to someone else, then you no longer have an instrument
        if (foundInstrument.instrument.controlledByUserID == this.myUser.userID) {
            this.myInstrument = null;
        }
    }

    foundInstrument.instrument.controlledByUserID = userID;
    if (this.stateChangeHandler) {
        this.stateChangeHandler();
    }
};

DigifuApp.prototype.NET_OnNoteOn = function (userID, note, velocity) {
    let foundInstrument = this.FindInstrumentByUserID(userID);
    if (foundInstrument == null) {
        log(`instrument not found`);
        return;
    }
    this.synth.NoteOn(foundInstrument.instrument, note, velocity);
};

DigifuApp.prototype.NET_OnNoteOff = function (userID, note) {
    let foundInstrument = this.FindInstrumentByUserID(userID);
    if (foundInstrument == null) {
        log(`instrument not found`);
        return;
    }
    this.synth.NoteOff(foundInstrument.instrument, note);
};

DigifuApp.prototype.NET_OnPedalDown = function(userID) {
    let foundInstrument = this.FindInstrumentByUserID(userID);
    if (foundInstrument == null) {
        log(`NET_OnPedalDown instrument not found`);
        return;
    }
    this.synth.PedalDown(foundInstrument.instrument);
};

DigifuApp.prototype.NET_OnPedalUp = function(userID) {
    let foundInstrument = this.FindInstrumentByUserID(userID);
    if (foundInstrument == null) {
        log(`NET_OnPedalUp instrument not found`);
        return;
    }
    this.synth.PedalUp(foundInstrument.instrument);
};

DigifuApp.prototype.NET_OnPing = function (token, users) {
    this.net.SendPong(token);
    users.forEach(u => {
        this.FindUserByID(u.userID).user.pingMS = u.pingMS;
    });
    this.userStateChangeHandler();
};

DigifuApp.prototype.NET_OnUserChatMessage = function(msg) {
    this.roomState.chatLog.push(msg);
    if (this.stateChangeHandler) {
        this.stateChangeHandler();
    }
}

DigifuApp.prototype.NET_OnDisconnect = function() {
    log("todo: disconnection.");
}

// --------------------------------------------------------------------------------------

DigifuApp.prototype.RequestInstrument = function (instrumentID) {
    this.net.SendRequestInstrument(instrumentID);
};

DigifuApp.prototype.ReleaseInstrument = function () {    
    this.net.SendReleaseInstrument();
};

DigifuApp.prototype.SendChatMessage = function(msgText, toUserID) {
    let msg = new DigifuChatMessage();
    msg.message = msgText;
    msg.fromUserID = this.myUser.userID;
    msg.toUserID = toUserID;
    msg.timestampUTC = new Date();

    log(`${JSON.stringify(msg)}`);

    this.net.SendChatMessage(msg);
};


DigifuApp.prototype.Connect = function (midiInputDeviceName, userName, userColor, stateChangeHandler, userStateChangeHandler) {
    log("attempting connection...");
    this.myUser = new DigifuUser();
    this.myUser.name = userName;
    this.myUser.color = userColor;

    this.stateChangeHandler = stateChangeHandler;
    this.userStateChangeHandler = userStateChangeHandler;

    this.midi.Init(midiInputDeviceName, this);

	this.audioCtx = new AudioContext();
	this.audioCtx.audioWorklet.addModule("bitcrush.js").then(() => {
        this.synth.Init(this.audioCtx);
        this.net.Connect(this);
    });
};

DigifuApp.prototype.Disconnect = function () {
    if (this.net) {
        this.net.Disconnect();
    }
    this.roomState = null;
    this.myUser = null;// new DigifuUser(); // filled in when we identify to a server and fill users
};








