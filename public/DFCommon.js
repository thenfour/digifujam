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
    PedalUp: "PedalUp",
    UserState: "UserState", // name, color, img, x, y, flair, statustext
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
    PedalUp: "PedalUp", // user
    UserState: "UserState", // user, name, color, img, x, y, flair, statustext
};

const ServerSettings = {
    PingIntervalMS: 1000
};

const ClientSettings = {
};

class DigifuUser {
    constructor() {
        this.userID = null;
        this.pingMS = 0;

        this.name = "";
        this.statusText = "";
        this.color = "";
        this.flairID = null;
        this.position = {x:0,y:0}; // this is your TARGET position in the room/world. your position on screen will just be a client-side interpolation
        this.img = null;
    }
};

class DigifuInstrumentSpec {
    constructor() {
        this.name = "";
        this.sfinstrumentName = "";
        this.img = "";
        this.color = "";
        this.instrumentID = null;
        this.controlledByUserID = null;
        this.engine = "synth"; // soundfont, synth
        this.activityDisplay = "none"; // keyboard, drums, none
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

class DigifuFlair {
    constructor() {
        this.name = null;
        this.flairID = null;
        this.img = null;
        this.text = null;
    }
};

class DigifuRoomState {
    constructor() {
        this.instrumentCloset = []; // list of DigifuInstrument instances
        this.users = [];
        this.chatLog = []; // ordered by time asc
        this.flair = [];
        this.img = null;
        this.width = 16;
        this.height = 9;
    }
};

module.exports = {
    ClientMessages,
    ServerMessages,
    DigifuUser,
    DigifuInstrumentSpec,
    DigifuChatMessage,
    DigifuRoomState,
    DigifuFlair,
    ServerSettings,
    ClientSettings
};
