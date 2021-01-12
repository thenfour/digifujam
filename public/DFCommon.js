'use strict';


Array.prototype.removeIf = function (callback) {
    var i = this.length;
    while (i--) {
        if (callback(this[i], i)) {
            this.splice(i, 1);
        }
    }
};


const ClientMessages = {
    Identify: "Identify", // user info
    // move. like to the couch, bar, dance floor, stage
    InstrumentRequest: "InstrumentRequest", // instid
    InstrumentRelease: "InstrumentRelease",
    ChatMessage: "ChatMessage",// (to_userID_null, msg)
    Pong: "Pong", // token
    NoteOn: "NoteOn", // note, velocity
    NoteOff: "NoteOff", // note
    AllNotesOff: "AllNotesOff", // this is needed for example when you change MIDI device
    PedalDown: "PedalDown",
    PedalUp: "PedalUp",
    UserState: "UserState", // name, color, img, x, y, statustext
};

const ServerMessages = {
    PleaseIdentify: "PleaseIdentify",
    Welcome: "Welcome",// (your UserID & room state)
    UserEnter: "UserEnter",// (user data)
    UserLeave: "UserLeave",// UserID
    UserChatMessage: "UserChatMessage",// (fromUserID, toUserID_null, msg)
    Ping: "Ping", // data, { userid, pingMS }
    InstrumentOwnership: "InstrumentOwnership",// [InstrumentID, UserID_nullabl, idle]
    NoteOn: "NoteOn", // user, note, velocity
    NoteOff: "NoteOff", // user, note
    UserAllNotesOff: "UserAllNotesOff", // this is needed for example when you change MIDI device
    PedalDown: "PedalDown", // user
    PedalUp: "PedalUp", // user
    UserState: "UserState", // user, name, color, img, x, y, statustext
};

const ServerSettings = {
    PingIntervalMS: 1000,
    ChatHistoryMaxMS: (1000 * 60 * 60),
    InstrumentIdleTimeoutMS: (1000 * 60),
    UsernameLengthMax: 20,
    UsernameLengthMin: 1,
    UserColorLengthMax: 20,
    UserColorLengthMin: 1,
    UserStatusLengthMax: 20,
    UserStatusLengthMin: 0,

    ChatMessageLengthMax: 288,

    RoomUserCountMaximum: 100,
};

const ClientSettings = {
    ChatHistoryMaxMS: (1000 * 60 * 60),
};

class DigifuUser {
    constructor() {
        this.userID = null;
        this.pingMS = 0;
        this.lastActivity = null; // this allows us to display as idle or release instrument

        this.name = "";
        this.statusText = "";
        this.color = "";
        this.position = { x: 0, y: 0 }; // this is your TARGET position in the room/world. your position on screen will just be a client-side interpolation
        this.img = null;
        this.idle = null; // this gets set when a user's instrument ownership becomes idle
    }

    thaw() { /* no child objects to thaw. */ }
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
        this.gain = 1.0;
    }

    thaw() { /* no child objects to thaw. */ }
};

const ChatMessageType = {
    chat: "chat",
    part: "part",
    join: "join",
    nick: "nick",
};

class DigifuChatMessage {
    constructor() {
        this.messageID = null;

        this.messageType = null; // of ChatMessageType. "chat", "part", "join", "nick"

        this.message = null;
        this.fromUserID = null;
        this.fromUserColor = null; // required because we keep a chat history, so when a user is removed from the list this data would no longer be available. now a client has fallback fields.
        this.fromUserName = null;
        this.toUserID = null;
        this.toUserColor = null;
        this.toUserName = null;
        this.timestampUTC = null;
    }

    thaw() { /* no child objects to thaw. */ }
};

class DigifuRoomState {
    constructor() {
        this.instrumentCloset = []; // list of DigifuInstrument instances
        this.users = [];
        this.chatLog = []; // ordered by time asc
        this.internalMasterGain = 1.0;
        this.img = null;
        this.width = 16;
        this.height = 9;
        this.roomTitle = "";
    }

    // call after Object.assign() to this object, to handle child objects.
    thaw() {
        this.instrumentCloset = this.instrumentCloset.map(o => {
            let n = Object.assign(new DigifuInstrumentSpec(), o);
            n.thaw();
            return n;
        });
        this.chatLog = this.chatLog.map(o => {
            let n = Object.assign(new DigifuChatMessage(), o);
            n.thaw();
            return n;
        });
        this.users = this.users.map(o => {
            let n = Object.assign(new DigifuUser(), o);
            n.thaw();
            return n;
        });
    }

    // returns { user, index } or null.
    FindUserByID(userID) {
        let idx = this.users.findIndex(user => user.userID == userID);
        if (idx == -1) return null;
        return { user: this.users[idx], index: idx };
    };

    // returns { instrument, index } or null.
    FindInstrumentById(instrumentID) {
        let idx = this.instrumentCloset.findIndex(instrument => instrument.instrumentID == instrumentID);
        if (idx == -1) return null;
        return { instrument: this.instrumentCloset[idx], index: idx };
    };

    // returns { instrument, index } or null.
    FindInstrumentByUserID(userID) {
        let idx = this.instrumentCloset.findIndex(instrument => instrument.controlledByUserID == userID);
        if (idx == -1) return null;
        return { instrument: this.instrumentCloset[idx], index: idx };
    };

    static FromJSONData(data) {
        // thaw into live classes
        let ret = Object.assign(new DigifuRoomState(), data);
        ret.thaw();
        return ret;
    }
};



let routeToRoomName = function (r) {
    let requestedRoomName = r;
    if (requestedRoomName.length < 1) return "pub"; // for 0-length strings return a special valid name.
  
    // trim slashes
    if (requestedRoomName[0] == '/') requestedRoomName = requestedRoomName.substring(1);
    if (requestedRoomName[requestedRoomName.length - 1] == '/') requestedRoomName = requestedRoomName.substring(0, requestedRoomName.length - 1);
  
    return requestedRoomName.toUpperCase();
  };
  
  
// returns null if not a valid username.
let sanitizeUsername = function (n) {
    if (typeof(n) != 'string') return null;
    n = n.trim();
    if (n.length < ServerSettings.UsernameLengthMin) return null;
    if (n.length > ServerSettings.UsernameLengthMax) return null;
    return n;
};

// returns null if not a valid username.
let sanitizeUserColor = function (n) {
    if (typeof(n) != 'string') return null;
    n = n.trim();
    if (n.length < ServerSettings.UserColorLengthMin) return null;
    if (n.length > ServerSettings.UserColorLengthMax) return null;
    return n;
};

// returns null if not a valid username.
let sanitizeUserStatus = function (n) {
    if (typeof(n) != 'string') return null;
    n = n.trim();
    if (n.length < ServerSettings.UserStatusLengthMin) return null;
    if (n.length > ServerSettings.UserStatusLengthMax) return null;
    return n;
};

module.exports = {
    ClientMessages,
    ServerMessages,
    DigifuUser,
    DigifuInstrumentSpec,
    DigifuChatMessage,
    ChatMessageType,
    DigifuRoomState,
    ServerSettings,
    ClientSettings,
    routeToRoomName,
    sanitizeUsername,
    sanitizeUserColor,
    sanitizeUserStatus,
};
