'use strict';

const ClientMessages = {
    Identify: "Identify", // user info
    // move. like to the couch, bar, dance floor, stage
    InstrumentRequest: "InstrumentRequest", // instid
    InstrumentRelease: "InstrumentRelease",
    ChatMessage: "ChatMessage",// (to_userID_null, msg)
    Pong: "Pong", // token
    NoteOn: "NoteOn", // note, velocity
    NoteOff: "NoteOff", // note
    PedalDown: "PedalDown",
    PedalUp: "PedalUp"
};

const ServerMessages = {
    PleaseIdentify: "PleaseIdentify",
    Welcome: "Welcome",// (your UserID & room state)
    UserEnter: "UserEnter",// (user data)
    UserLeave: "UserLeave",// UserID
    UserChatMessage: "UserChatMessage",// (fromUserID, toUserID_null, msg)
    Ping: "Ping", // data, { userid, pingMS }
    InstrumentOwnership: "InstrumentOwnership",// [InstrumentID, UserID_nullabl]
    NoteOn: "NoteOn", // user, note, velocity
    NoteOff: "NoteOff", // user, note
    PedalDown: "PedalDown", // user
    PedalUp: "PedalUp" // user
};

const ServerSettings = {
    PingIntervalMS: 1000
};

const ClientSettings = {
};

class DigifuUser {
    constructor() {
        this.name = "";
        this.color = "";
        this.userID = null;
        this.pingMS = 0;
    }
};

class DigifuInstrumentSpec {
    constructor() {
        this.name = "";
        this.color = "";
        this.instrumentID = null;
        this.controlledByUserID = null;
        //this.SynthInstrumentType = "soundfont" or synth or ...
    }
};

class DigifuChatMessage {
    constructor() {
        this.message = null;
        this.fromUserID = null;
        this.toUserID = null;
        this.timestampUTC = null;
    }
};

class DigifuRoomState {
    constructor() {
        this.instrumentCloset = []; // list of DigifuInstrument instances
        this.users = [];
        this.chatLog = []; // ordered by time asc
    }
};

module.exports = {
    ClientMessages,
    ServerMessages,
    DigifuUser,
    DigifuInstrumentSpec,
    DigifuRoomState,
    ServerSettings,
    ClientSettings
};
