'use strict';

let gDigifujamVersion = 1;

Array.prototype.removeIf = function (callback) {
    var i = this.length;
    while (i--) {
        if (callback(this[i], i)) {
            this.splice(i, 1);
        }
    }
};

let FrequencyFromMidiNote = function (midiNote) {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
};


// linear mapping
let remap = function (value, low1, high1, low2, high2) {
    return low2 + (high2 - low2) * (value - low1) / (high1 - low1);
}

let remapWithPowCurve = (value, inpMin, inpMax, p, outpMin, outpMax) => {
    // map to 0-1
    value -= inpMin;
    value /= inpMax - inpMin;
    if (value < 0) value = 0;
    if (value > 1) value = 1;
    // curve
    value = Math.pow(value, p);
    // map to outpMin-outpMax
    value *= outpMax - outpMin;
    return value + outpMin;
};

// make sure IDDomain is set, this is needed to differentiate IDs generated on server versus client to make sure they don't collide.
let gNextID = 1;
let generateID = function () {
    console.assert(gIDDomain);
    let ret = gIDDomain + gNextID;
    gNextID++;
    return ret;
}

let gGlobalInstruments = [];

let SetGlobalInstrumentList = function (x) {
    gGlobalInstruments = x;
    console.log(`Global instrument closet now has ${x.length} instruments defined`);
}


const ClientMessages = {
    Identify: "Identify", // user info, and optional admin password
    InstrumentRequest: "InstrumentRequest", // instid
    InstrumentRelease: "InstrumentRelease",
    ChatMessage: "ChatMessage",// (to_userID_null, msg)
    Pong: "Pong", // token
    NoteOn: "NoteOn", // note, velocity
    NoteOff: "NoteOff", // note
    AllNotesOff: "AllNotesOff", // this is needed for example when you change MIDI device
    PedalDown: "PedalDown",
    PedalUp: "PedalUp",
    InstrumentParams: "InstParams",// {} object mapping paramID => newVal -- pitch bend is a special param called "pb"

    InstrumentPresetDelete: "InstrumentPresetDelete", // presetID
    InstrumentPresetSave: "InstrumentPresetSave", // {params} just like InstParams, except will be saved. the "presetID" param specifies preset to overwrite.
    InstrumentBankReplace: "InstrumentBankReplace", // [{preset},{preset...}]
    InstrumentFactoryReset: "InstrumentFactoryReset",
    DownloadServerState: "DownloadServerState",
    UploadServerState: "UploadServerState",

    UserState: "UserState", // name, color, img, x, y
    Cheer: "Cheer", // text, x, y
};

const ServerMessages = {
    PleaseIdentify: "PleaseIdentify",
    PleaseReconnect: "PleaseReconnect",
    Welcome: "Welcome",// (your UserID & room state, and whether you are an admin)
    UserEnter: "UserEnter",// (user data), <oldRoomName>
    UserLeave: "UserLeave",// UserID, <newRoomName>
    UserChatMessage: "UserChatMessage",// (fromUserID, toUserID_null, msg)
    Ping: "Ping", // token, users: [{ userid, pingMS, roomID, stats }], rooms: [{roomID, roomName, userCount, stats}]
    InstrumentOwnership: "InstrumentOwnership",// [InstrumentID, UserID_nullabl, idle]
    NoteOn: "NoteOn", // user, note, velocity
    NoteOff: "NoteOff", // user, note
    UserAllNotesOff: "UserAllNotesOff", // this is needed for example when you change MIDI device
    PedalDown: "PedalDown", // user
    PedalUp: "PedalUp", // user
    InstrumentParams: "InstParams",// { userID, instrumentID, patchObj:{object mapping paramID to newVal} } ] -- pitch bend is a special param called "pb"
    ServerStateDump: "ServerStateDump",

    InstrumentPresetDelete: "InstrumentPresetDelete", // instrumentID, presetID
    InstrumentPresetSave: "InstrumentPresetSave", // instrumentID, {params} just like InstParams, except will be saved. the "presetID" param specifies preset to overwrite. may be new.
    InstrumentBankReplace: "InstrumentBankReplace", // [{preset},{preset...}]
    InstrumentFactoryReset: "InstrumentFactoryReset", // instrumentID, [presets]

    UserState: "UserState", // user, name, color, img, x, y
    Cheer: "Cheer", // userID, text, x, y
};

const ServerSettings = {
    PingIntervalMS: 5000,
    ChatHistoryMaxMS: (1000 * 60 * 60),

    InstrumentIdleTimeoutMS: (1000 * 60),
    InstrumentAutoReleaseTimeoutMS: (1000 * 60 * 5),

    UsernameLengthMax: 20,
    UsernameLengthMin: 1,
    UserColorLengthMax: 100,
    UserColorLengthMin: 1,

    ChatMessageLengthMax: 288,

    WorldUserCountMaximum: 100,
};

const ClientSettings = {
    ChatHistoryMaxMS: (1000 * 60 * 60),
    MinCheerIntervalMS: 200,
    InstrumentParamIntervalMS: 50,
    InstrumentFloatParamDiscreteValues: 64000,
};

const AccessLevels = {
    User: 0,
    Admin: 1,
};

class DigifuUser {
    constructor() {
        this.userID = null;
        this.pingMS = 0;
        this.lastActivity = null; // this allows us to display as idle or release instrument

        this.name = "";
        this.color = "";
        this.position = { x: 0, y: 0 }; // this is your TARGET position in the room/world. your position on screen will just be a client-side interpolation
        this.img = null;
        this.idle = null; // this gets set when a user's instrument ownership becomes idle

        this.stats = {
            noteOns: 0,
            cheers: 0,
            messages: 0,
        };
    }

    thaw() { /* no child objects to thaw. */ }
};

const InstrumentParamType = {
    intParam: "intParam",
    floatParam: "floatParam",
    textParam: "textParam",
    cbxParam: "cbxParam", // checkbox bool. you can also do enum-style params with intParam
};

const InternalInstrumentParams = [
    {
        "paramID": "patchName",
        "name": "Patch name",
        "parameterType": "textParam",
        "isInternal": true,
        "maxTextLength": 100
    },
    {
        "paramID": "presetID",
        "name": "Preset ID",
        "parameterType": "textParam",
        "isInternal": true,
        "maxTextLength": 100
    },
    {
        "paramID": "author",
        "name": "Author",
        "parameterType": "textParam",
        "isInternal": true,
        "maxTextLength": 100
    },
    {
        "paramID": "savedDate",
        "name": "Saved date",
        "parameterType": "textParam",
        "isInternal": true,
        "maxTextLength": 100
    },
    {
        "paramID": "tags",
        "name": "Tags",
        "parameterType": "textParam",
        "isInternal": true,
        "maxTextLength": 500
    },
    {
        "paramID": "isReadOnly",
        "name": "Tags",
        "parameterType": "intParam",
        "isInternal": true,
    },
];



class InstrumentParam {
    constructor() {
        this.paramID = "";
        this.name = "";
        this.parameterType = InstrumentParamType.intParam;
        this.hidden = false;
        this.groupName = "Params";
        this.tags = ""; // any extra strings to match filter text
        this.cssClassName = "";
        this.minValue = 0;// inclusive
        this.maxValue = 0;// inclusive
        this.valueCurve = 1; // 1 = linear slider, higher values = more concave curve. 10 would be very extreme, 2 is usable
        this.zeroPoint = null;// 0-1 of output range, when scaling to external range, when neg & pos ranges are different, it's a bit fuzzy to know where "0" is on the output range. We calculate it and put it here.

        this.currentValue = 0;
    }
    thaw() { /* no child objects to thaw. */ }

    // returns true if a zero point exists.
    ensureZeroPoint() {
        let doesInpRangeCrossZero = (this.minValue < 0 && this.maxValue > 0);
        if (!doesInpRangeCrossZero) return false;
        if (this.zeroPoint != null) return true;
        this.zeroPoint = 0.5;
        return true;
    }

    // I KNOW THE CORRECT THING TO DO is to tailor each curve perfectly with a log scale to the specific ranges at hand.
    // HOWEVER using pow() i find it more flexible for tweaking the UI regardless of mathematical perfection,
    // --> and simpler to manage for my non-mathematical pea brain.

    nativeToForeignValue(v, outpMin, outpMax) {
        if (!this.ensureZeroPoint()) {
            // only 1 pole; simple mapping with curve.
            return remapWithPowCurve(v, this.minValue, this.maxValue, 1.0 / this.valueCurve, outpMin, outpMax);
        }
        // we know zero point is valid from here.

        let outpZero = this.zeroPoint * (outpMax - outpMin) + outpMin; // this is the output VALUE which represents inp of 0.
        if (v == 0) return outpZero; // eliminate div0 with a shortcut
        if (v > 0) {
            // positive
            return remapWithPowCurve(v, 0, this.maxValue, 1.0 / this.valueCurve, outpZero, outpMax);
        }
        return remapWithPowCurve(v, 0, this.minValue, 1.0 / this.valueCurve, outpZero, outpMin);
    }

    foreignToNativeValue(v, inpMin, inpMax) {
        if (!this.ensureZeroPoint()) {
            // only 1 pole; simple mapping with curve.
            return remapWithPowCurve(v, inpMin, inpMax, this.valueCurve, this.minValue, this.maxValue);
        }
        // we know zero point is valid from here.
        let inpZero = this.zeroPoint * (inpMax - inpMin) + inpMin; // foreign value represting native zero.
        if (v == inpZero) return 0;
        if (v > inpZero) {
            return remapWithPowCurve(v, inpZero, inpMax, this.valueCurve, 0, this.maxValue);
        }
        return remapWithPowCurve(v, inpZero, inpMin, this.valueCurve, 0, this.minValue);
    }

};

class DigifuInstrumentSpec {
    constructor() {
        this.name = "";
        this.sfinstrumentName = "";
        this.img = "";
        this.color = "rgb(138, 224, 153)";
        this.instrumentID = null;
        this.controlledByUserID = null;
        this.engine = null; // soundfont, minisynth, megasynth
        this.activityDisplay = "none"; // keyboard, drums, none
        this.gain = 1.0;
        this.maxPolyphony = 10;
        this.params = [];// instrument parameter value map
        this.presets = []; // a preset is just a param:value pair
        this.namePrefix = "";// when forming names based on patch name, this is the prefix
        this.supportsPresets = true;
        this.maxTextLength = 100;
    }

    getDisplayName() {
        switch (this.engine) {
            case "soundfont":
                return this.name;
            case "minisynth":
            case "minifm":
                // fall through to calculate the name.
                break;
        }
        let pn = this.GetParamByID("patchName");
        if (!pn) return this.name;

        if (pn.currentValue && pn.currentValue.length > 0 && this.namePrefix && this.namePrefix.length > 0) {
            return this.namePrefix + pn.currentValue;
        }
        return this.name;
    }

    GetParamByID(paramID) {
        return this.params.find(p => p.paramID == paramID);
    }

    // tries hard to find a "default" or "safe" value (used for ctrl+click a param)
    GetDefaultValueForParam(param) {
        if (param.defaultValue) return param.defaultValue;
        let preset = this.GetInitPreset();
        if (preset) {
            if (preset[param.paramID]) return preset[param.paramID];
        }
        if (param.minValue <= 0 && param.maxValue >= 0) return 0;
        return param.minValue;
    }

    // can return null!
    GetInitPreset() {
        let ret = this.presets.find(p => p.name == "init");
        if (!ret && this.presets.length > 0) ret = this.presets[0];
        return ret;
    }

    loadPatchObj(presetObj) {
        if (!presetObj) return;
        Object.keys(presetObj).forEach(k => {
            let param = this.params.find(p => p.paramID == k);
            if (!param) {
                console.log(`loadPatchObj: "${k}" was not found, its value will be ignored.`);
                return;
            }
            param.currentValue = presetObj[k];
        });
    }

    exportAllPresetsJSON() {
        return JSON.stringify(this.presets);
    }

    // return true/false success
    importAllPresetsArray(a) {
        if (!Array.isArray(a)) return false;
        // TODO: other validation.
        // do a cursory check of all require params existing.
        const requiredParamKeys = ["presetID", "patchName"];
        a.forEach(p => {
            // does p contain ALL paramIDs in 
            let count = 0;
            requiredParamKeys.forEach(requiredKey => {
                if (Object.keys(p).some(k => k == requiredKey)) {
                    count++;
                }
            });
            if (count < requiredParamKeys.length) {
                console.log(`Trying to import a preset with too few required params (${count} < ${requiredParamKeys.length})`);
                return false;
            }
        });
        this.presets = a;
        return true;
    }

    // return true/false success
    importAllPresetsJSON(js) {
        try {
            this.importAllPresetsArray(JSON.parse(js));
            return true;
        } catch (e) {
            return false;
        }
    }

    // exports LIVE params as a patch
    exportPatchObj() {
        let ret = {};
        this.params.forEach(param => {
            if (param.paramID == "pb") { return; } // pitch bend is not something we want to store in presets
            ret[param.paramID] = param.currentValue;
        });
        return ret;
    }

    thaw() {
        this.params = this.params.map(o => {
            let n = Object.assign(new InstrumentParam(), o);
            n.thaw();
            return n;
        });
    }

    GetDefaultShownGroupsForInstrument() {
        return ["master"];
    }

    // return { cssClassName, annotation }
    getGroupInfo(groupName) {
        let ret = { cssClassName: "", annotation: "" };
        switch (this.engine) {
            case "soundfont":
                return ret;
            case "minifm":
                // fall through to calculate the name.
                break;
        }
        let isModulation = groupName.toLowerCase().startsWith("mod ");
        if (isModulation) {
            ret.cssClassName = "modulation";
        } else {
            switch (groupName) {
                case "Saturation":
                    const satIsEnabled = !!this.GetParamByID("waveShape_enabled").currentValue;
                    console.log(`satIsEnabled: ${satIsEnabled}`);
                    ret.annotation = satIsEnabled ? "(On)" : "(Off)";
                    ret.cssClassName = satIsEnabled ? "" : "disabled";
                    break;
                case "Filter":
                    const filtIsEnabled = !!this.GetParamByID("filterType").currentValue;
                    ret.annotation = filtIsEnabled ? "(On)" : "(Off)";
                    ret.cssClassName = filtIsEnabled ? "" : "disabled";
                    break;
            }
        }

        return ret;
    }

    // filters the list of presets to include only ones which are useful.
    // for example if OSC B is disabled, don't show any settings from OSC B.
    GetDisplayablePresetList(filterTxt) {
        if (this.engine != "minifm") {
            let ret = this.params.filter(p => {
                // internal params which aren't part of the normal param editing zone.
                if (p.paramID === "presetID") return false;
                if (p.paramID === "isReadOnly") return false;
                if (p.paramID === "author") return false;
                if (p.paramID === "savedDate") return false;
                if (p.paramID === "tags") return false;
                if (p.paramID === "patchName") return false;

                if (p.groupName.toLowerCase().includes(filterTxt)) return true;
                if (p.name.toLowerCase().includes(filterTxt)) return true;
                if (p.tags.toLowerCase().includes(filterTxt)) return true;

                return false;
            });
            return ret;
        }
        let osc0_enabled = !!this.GetParamByID("enable_osc0").currentValue;
        let osc1_enabled = !!this.GetParamByID("enable_osc1").currentValue;
        let osc2_enabled = !!this.GetParamByID("enable_osc2").currentValue;
        let osc3_enabled = !!this.GetParamByID("enable_osc3").currentValue;
        let osc_enabled = [osc0_enabled, osc1_enabled, osc2_enabled, osc3_enabled];
        let algo = this.GetParamByID("algo").currentValue;
        // "[1🡄2🡄3🡄4]",
        //     "[1🡄2🡄3][4]",
        //     "[1🡄2][3🡄4]",
        //     "[1🡄2][3][4]",
        //     "[1][2][3][4]"
        let oscGroups = [
            [[0, 1, 2, 3]],
            [[0, 1, 2], [3]],
            [[0, 1], [2, 3]],
            [[0, 1], [2], [3]],
            [[0], [1], [2], [3]]
        ];
        oscGroups = oscGroups[algo];
        // now remove oscillators not in use.
        oscGroups = oscGroups.filter(grp => {
            return grp.some(osc => osc_enabled[osc]); // at least 1 oscillator in the group is enabled? then keep it.
        });

        let oscIsPWM = [
            this.GetParamByID("osc0_wave").currentValue == 4,
            this.GetParamByID("osc1_wave").currentValue == 4,
            this.GetParamByID("osc2_wave").currentValue == 4,
            this.GetParamByID("osc3_wave").currentValue == 4,
        ];

        let ret = this.params.filter(p => {

            // internal params which aren't part of the normal param editing zone.
            if (p.paramID === "presetID") return false;
            if (p.paramID === "isReadOnly") return false;
            if (p.paramID === "author") return false;
            if (p.paramID === "savedDate") return false;
            if (p.paramID === "tags") return false;
            if (p.paramID === "patchName") return false;

            if (p.groupName === "∿ Osc A" && !osc0_enabled) return false;
            if (p.groupName === "∿ Osc B" && !osc1_enabled) return false;
            if (p.groupName === "∿ Osc C" && !osc2_enabled) return false;
            if (p.groupName === "∿ Osc D" && !osc3_enabled) return false;

            // detune is not relevant for a single osc or osc group.
            if (oscGroups.length < 2 && p.groupName === "Detune") return false;

            //duty cycle is pretty intrusive if you're not using PWM
            if (p.paramID.startsWith("osc0_pwm")) return oscIsPWM[0];
            if (p.paramID.startsWith("osc1_pwm")) return oscIsPWM[1];
            if (p.paramID.startsWith("osc2_pwm")) return oscIsPWM[2];
            if (p.paramID.startsWith("osc3_pwm")) return oscIsPWM[3];

            if (p.groupName.toLowerCase().includes(filterTxt)) return true;
            if (p.name.toLowerCase().includes(filterTxt)) return true;
            if (p.tags.toLowerCase().includes(filterTxt)) return true;

            return false;
        });
        return ret;
    }
};

const ChatMessageType = {
    chat: "chat",
    nick: "nick",
    part: "part",
    join: "join",
    changeInstrument: "changeInstrument", // change
    aggregate: "aggregate",
};

class DigifuChatMessage {
    constructor() {
        this.messageID = null;
        this.timestampUTC = null;
        this.messageType = null; // of ChatMessageType. if aggregate then expect the below properties

        //this.aggregateMessages = []; // list of DigifuChatMessages
        //this.messages = [];// - the latest version of messages for the above events

        this.message = null;

        this.fromUserID = null;
        this.fromUserColor = null; // required because we keep a chat history, so when a user is removed from the list this data would no longer be available. now a client has fallback fields.
        this.fromUserName = null;

        this.toUserID = null;
        this.toUserColor = null;
        this.toUserName = null;

        this.fromRoomName = null;
        this.toRoomName = null;
    }

    thaw() { /* no child objects to thaw. */ }

    // aggregate integration
    integrate(rhs) {
        console.assert(this.messageType == ChatMessageType.aggregate);
        this.aggregateMessages.push(rhs);
        this.rebuildAggregateMessages();
    };

    toAggregate() {
        let ret = new DigifuChatMessage();
        ret.messageID = generateID();
        ret.messageType = ChatMessageType.aggregate;
        ret.aggregateMessages = [this];
        ret.timestampUTC = this.timestampUTC;
        ret.rebuildAggregateMessages();
        return ret;
    }

    isAggregatable() {
        if (this.messageType == ChatMessageType.part) return true;
        if (this.messageType == ChatMessageType.join) return true;
        return false;
    }

    rebuildAggregateMessages() {
        console.assert(this.messageType == ChatMessageType.aggregate);
        // we need to actually group things by user, so multiple events from the same user get collapsed.
        let joins = {}; // maps userid to { name, color }
        let parts = {}; // maps userid to { name, color }
        this.aggregateMessages.forEach(msg => {
            switch (msg.messageType) {
                case ChatMessageType.join:
                    joins[msg.fromUserName] = { name: msg.fromUserName, color: msg.fromUserColor }; // TODO: a real user id to group by.
                    break;
                case ChatMessageType.part:
                    parts[msg.fromUserName] = { name: msg.fromUserName, color: msg.fromUserColor }; // TODO: a real user id to group by.
                    break;
                default:
                    console.assert(false, "non-aggregatable msg found in an aggregate message...");
                    break;
            }
        });

        this.messages = [];

        // todo: group by userID not name, but it depends on having consistent userIDs across joins/parts which for the moment is not happening.
        let msgText = [];
        if (Object.keys(joins).length > 0) msgText.push(`Joined: ${Object.keys(joins).map(k => joins[k].name).join(', ')}`);
        if (Object.keys(parts).length > 0) msgText.push(`Left: ${Object.keys(parts).map(k => parts[k].name).join(', ')}`);
        if (msgText.length) {
            this.messages.push(msgText.join(", "));
        }
    }
};

class DFRect {
    constructor() {
        this.x = 0;
        this.y = 0;
        this.w = 0;
        this.h = 0;
    }
    thaw() { }

    PointIntersects(pt) {
        if (pt.x < this.x) return false;
        if (pt.y < this.y) return false;
        if (pt.x >= this.x + this.w) return false;
        if (pt.y >= this.y + this.h) return false;
        return true;
    }
};

const RoomFns = {
    roomChange: "roomChange",
    toggleSign: "toggleSign",
};
const DFRoomItemType = {
    door: "door",
    sign: "sign",
    audioVisualization: "audioVisualization",
};

// a function that can be invoked by room items.
class RoomFn {
    constructor() {
        this.fn = null; // of RoomFns
        this.params = null; // anything.
    }
    thaw() { }
};

class RoomItem {
    constructor() {
        this.name = "";
        this.rect = null; // x, y, w, h
        this.itemType = null; // DFRoomItemType
        this.style = null; // CSS
        this.interactions = {};
        this.params = {};
    }
    thaw() {
        Object.keys(this.interactions).forEach(k => {
            this.interactions[k] = Object.assign(new RoomFn(), this.interactions[k]);
            this.interactions[k].thaw();
        });
        if (this.rect) {
            this.rect = Object.assign(new DFRect(), this.rect);
            this.rect.thaw();
        }
    }
};

class DigifuRoomState {
    constructor() {
        this.instrumentCloset = []; // list of DigifuInstrument instances
        this.users = [];
        this.chatLog = []; // ordered by time asc
        this.roomItems = [];
        this.internalMasterGain = 1.0;
        this.img = null;
        this.width = 16;
        this.height = 9;
        this.roomTitle = "";
        this.softwareVersion = gDigifujamVersion;

        this.stats = {
            noteOns: 0,
            cheers: 0,
            messages: 0,
        };
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
        this.roomItems = this.roomItems.map(o => {
            let n = Object.assign(new RoomItem(), o);
            n.thaw();
            return n;
        });
    }

    adminExportRoomState() {
        return {
            instrumentPresets: this.instrumentCloset.map(i => { return { instrumentID: i.instrumentID, presets: i.presets } }),
            chatLog: this.chatLog,
            stats: this.stats,
        };
    }

    adminImportRoomState(data) {
        // don't import all instrument DEFINITIONS. just the presets.
        data.instrumentPresets.forEach(ip => {
            const f = this.FindInstrumentById(ip.instrumentID);
            if (!f) {
                console.log(`instrument ${ip.instrumentID} was not found; couldn't import its presets. Make sure instruments all have constant IDs set.`);
                return;
            }
            f.instrument.importAllPresetsArray(ip.presets);
        });

        this.chatLog = data.chatLog.map(o => {
            let n = Object.assign(new DigifuChatMessage(), o);
            n.thaw();
            return n;
        });
        this.stats = data.stats;

        // remove "live" references to users.
        this.users = [];
        this.instrumentCloset.forEach(i => { i.controlledByUserID = null; });
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

        // deal with instruments which are copies of instrumentns. expand them.
        for (let idx = 0; idx < ret.instrumentCloset.length; ++idx) {
            let i = ret.instrumentCloset[idx];
            if (!i.copyOfInstrumentID) continue;

            let base = ret.instrumentCloset.find(o => o.instrumentID == i.copyOfInstrumentID);

            if (!base) {
                // fallback: load from global instrument list
                base = gGlobalInstruments.find(o => o.instrumentID == i.copyOfInstrumentID);
            }

            console.assert(!!base, `Instrument is based on nonexistent instrument ${i.copyOfInstrumentID}`);
            // create a clone of the base
            let n = JSON.parse(JSON.stringify(base));
            // apply modifications
            i.copyOfInstrumentID = null;
            ret.instrumentCloset[idx] = Object.assign(n, i);
        }

        ret.thaw();

        return ret;
    }
};



let routeToRoomID = function (r) {
    let requestedRoomID = r;
    if (requestedRoomID.length < 1) return "pub"; // for 0-length strings return a special valid name.

    // trim slashes
    if (requestedRoomID[0] == '/') requestedRoomID = requestedRoomID.substring(1);
    if (requestedRoomID[requestedRoomID.length - 1] == '/') requestedRoomID = requestedRoomID.substring(0, requestedRoomID.length - 1);

    if (requestedRoomID.length < 1) return "pub"; // for 0-length strings return a special valid name.

    return requestedRoomID.toLowerCase();
};


// returns null if not a valid username.
let sanitizeUsername = function (n) {
    if (typeof (n) != 'string') return null;
    n = n.trim();
    if (n.length < ServerSettings.UsernameLengthMin) return null;
    if (n.length > ServerSettings.UsernameLengthMax) return null;
    return n;
};

// returns null if not a valid username.
let sanitizeUserColor = function (n) {
    if (typeof (n) != 'string') return null;
    n = n.trim();
    if (n.length < ServerSettings.UserColorLengthMin) return null;
    if (n.length > ServerSettings.UserColorLengthMax) return null;
    return n;
};

let sanitizeCheerText = function (n) {
    if (typeof (n) != 'string') return null;
    n = n.trim();
    if (n.length == 0) return null;
    return String.fromCodePoint(n.codePointAt(0));
}

let sanitizeInstrumentParamVal = function (param, newVal) {
    if (param.parameterType == InstrumentParamType.textParam) {
        if (typeof (newVal) != 'string') return "";
        let ret = newVal.trim();
        return ret.substring(0, param.maxTextLength);
    }
    if (param.parameterType == InstrumentParamType.cbxParam) {
        return !!newVal;
    }
    // numeric types...
    // just clamp to the range.
    if (newVal < param.minValue) return param.minValue;
    if (newVal > param.maxValue) return param.maxValue;
    return newVal;
};

module.exports = {
    ClientMessages,
    ServerMessages,
    DigifuUser,
    InstrumentParamType,
    InstrumentParam,
    DigifuInstrumentSpec,
    DigifuChatMessage,
    ChatMessageType,
    DigifuRoomState,
    ServerSettings,
    ClientSettings,
    routeToRoomID,
    sanitizeUsername,
    sanitizeUserColor,
    sanitizeCheerText,
    generateID,
    sanitizeInstrumentParamVal,
    RoomItem,
    RoomFn,
    RoomFns,
    DFRoomItemType,
    AccessLevels,
    SetGlobalInstrumentList,
    InternalInstrumentParams,
};
