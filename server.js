'use strict';

const WebSocket = require('ws')
const DF = require('./DFCommon')

// https://github.com/websockets/ws/blob/HEAD/doc/ws.md#event-message

var __gNextID = 1;
var GetUniqueID = function () {
    var ret = __gNextID;
    __gNextID++;
    return ret;
};

let gRoom = new DF.DigifuRoomState();

// populate initial room state
// https://gleitz.github.io/midi-js-soundfonts/MusyngKite/names.json
gRoom.instrumentCloset = [ // of type DigifuInstrumentSpec
    {
        name: "acoustic_grand_piano",
        color: "#808080",
        instrumentID: 6,
        controlledByUserID: null
    },
    {
        name: "marimba",
        color: "#884400",
        instrumentID: 69,
        controlledByUserID: null
    },
    {
        name: "tango_accordion",
        color: "#00ff00",
        instrumentID: 420,
        controlledByUserID: null
    },
    {
        name: "electric_bass_finger",
        color: "#0000ff",
        instrumentID: 11,
        controlledByUserID: null
    },
    
];


const wss = new WebSocket.Server({
    port: 8080,
    clientTracking: true // allow access to clients set
});

// returns { userobject, index } or null.
let FindUserFromSocket = function (clientSocket) {
    let ret = null;
    gRoom.users.forEach(function (user, index) {
        if (user.userID != clientSocket.DFClientID) return;
        ret = { user, index };
    });
    return ret;
};

// returns { instobject, index } or null.
let FindInstrumentById = function (instrumentID) {
    let ret = null;
    gRoom.instrumentCloset.forEach(function (instrument, index) {
        console.log(`  finding instrument; i ${index} = ${instrument.instrumentID} ; eq ${instrumentID} ? ${instrument.instrumentID == instrumentID}`);
        if (instrument.instrumentID != instrumentID) return;
        ret = { instrument, index };
    });
    return ret;
};

// returns { instobject, index } or null.
let FindInstrumentByUserID = function (userID) {
    let ret = null;
    gRoom.instrumentCloset.forEach(function (instrument, index) {
        if (instrument.controlledByUserID != userID) return;
        ret = { instrument, index };
    });
    return ret;
};

let OnClientIdentify = function (clientSocket, clientUserSpec) {
    // the data is actually a DigifuUser object. but for security it should be copied.
    let u = new DF.DigifuUser();
    // todo: validate client params
    u.name = clientUserSpec.name;
    u.color = clientUserSpec.color;
    u.userID = clientSocket.DFClientID;
    gRoom.users.push(u);

    console.log(`User identified ${clientSocket.DFClientID}. Send welcome package.`)

    // notify this 1 user of their user id & room state
    clientSocket.send(JSON.stringify({
        cmd: DF.ServerMessages.Welcome,
        data: {
            yourUserID: clientSocket.DFClientID,
            roomState: gRoom
        }
    }));

    // broadcast user enter to all clients except the user.
    let payload = JSON.stringify({
        cmd: DF.ServerMessages.UserEnter,
        data: u
    });
    wss.clients.forEach(c => {
        if (c.DFClientID == clientSocket.DFClientID) return;
        c.send(payload);
    });
};

let OnClientClose = function (ws, code, msg) {
    console.log(`close => ${ws.DFClientID} ${code} ${msg}`)

    // find the user object and remove it.
    let foundUser = FindUserFromSocket(ws);
    if (foundUser == null) {
        console.log(`client closing but is not a user...?`);
        return;
    }

    // remove references to this user.
    gRoom.instrumentCloset.forEach(inst => {
        if (inst.controlledByUserID == foundUser.user.userID) {
            inst.controlledByUserID = null;
            // broadcast this to clients.
            let payload = JSON.stringify({
                cmd: DF.ServerMessages.InstrumentOwnership,
                data: {
                    instrumentID: inst.instrumentID,
                    userID: null
                }
            });
            wss.clients.forEach(c => {
                c.send(payload);
            });
        }
    });

    // remove user from room.
    gRoom.users.splice(foundUser.index, 1);

    // broadcast user exit to all clients
    let payload = JSON.stringify({
        cmd: DF.ServerMessages.UserLeave,
        data: ws.DFClientID
    });
    wss.clients.forEach(c => {
        c.send(payload);
    });
};

let OnClientInstrumentRequest = function (ws, instrumentID) {
    console.log(`OnClientInstrumentRequest => ${ws.DFClientID} ${instrumentID}`)

    // find the user object.
    let foundUser = FindUserFromSocket(ws);
    if (foundUser === null) {
        console.log(`instrument request for unknown user`);
        return;
    }

    // find the instrument.
    let foundInstrument = FindInstrumentById(instrumentID);
    if (foundInstrument === null) {
        console.log(`instrument request for unknown instrument`);
        return;
    }

    foundInstrument.instrument.controlledByUserID = foundUser.user.userID;

    // broadcast instrument change to all clients
    let payload = JSON.stringify({
        cmd: DF.ServerMessages.InstrumentOwnership,
        data: {
            instrumentID: foundInstrument.instrument.instrumentID,
            userID: foundUser.user.userID
        }
    });
    wss.clients.forEach(c => {
        c.send(payload);
    });
};

let OnClientInstrumentRelease = function (ws) {
    console.log(`OnClientInstrumentRelease => ${ws.DFClientID}`)

    // find the user object.
    let foundUser = FindUserFromSocket(ws);
    if (foundUser == null) {
        console.log(`=> unknown user`);
        return;
    }

    // find their instrument.
    let foundInstrument = FindInstrumentByUserID(foundUser.user.userID);
    if (foundInstrument == null) {
        console.log(`=> not controlling an instrument.`);
        console.log(`${JSON.stringify(gRoom)}`);
        return;
    }

    foundInstrument.instrument.controlledByUserID = null;

    // broadcast instrument change to all clients
    let payload = JSON.stringify({
        cmd: DF.ServerMessages.InstrumentOwnership,
        data: {
            instrumentID: foundInstrument.instrument.instrumentID,
            userID: null
        }
    });
    wss.clients.forEach(c => {
        c.send(payload);
    });
};


let OnClientNoteOn = function (ws, note, velocity) {
    //console.log(`OnClientNoteOn => ${ws.DFClientID}`)

    // find the user object.
    let foundUser = FindUserFromSocket(ws);
    if (foundUser == null) {
        console.log(`=> unknown user`);
        return;
    }

    // broadcast to all clients except foundUser
    let payload = JSON.stringify({
        cmd: DF.ServerMessages.NoteOn,
        data: {
            userID: foundUser.user.userID,
            note: note,
            velocity: velocity
        }
    });
    wss.clients.forEach(c => {
        if (c.DFClientID == foundUser.user.userID) return;
        c.send(payload);
    });
};


let OnClientNoteOff = function (ws, note) {
    //console.log(`OnClientNoteOff => ${ws.DFClientID}`)

    // find the user object.
    let foundUser = FindUserFromSocket(ws);
    if (foundUser == null) {
        console.log(`=> unknown user`);
        return;
    }

    // broadcast to all clients except foundUser
    let payload = JSON.stringify({
        cmd: DF.ServerMessages.NoteOff,
        data: {
            userID: foundUser.user.userID,
            note: note
        }
    });
    //console.log(`broadcasting payload ${payload}`);
    wss.clients.forEach(c => {
        if (c.DFClientID == foundUser.user.userID) return;
        c.send(payload);
    });
};


let OnClientChatMessage = function (ws, msg) {
    // find the user object.
    let foundUser = FindUserFromSocket(ws);
    if (foundUser == null) {
        console.log(`=> unknown user`);
        return;
    }

    // correct stuff.
    msg.fromUserID = foundUser.user.userID;
    // validate to user id
    msg.timestampUTC = new Date();

    gRoom.chatLog.push(msg);

    // broadcast to all clients
    let payload = JSON.stringify({
        cmd: DF.ServerMessages.UserChatMessage,
        data: msg
    });
    wss.clients.forEach(c => {
        c.send(payload);
    });
};




let OnClientMessage = function (ws, text) {
    console.log(`Received message => ${text}`)
    let msg = JSON.parse(text);
    let cmd = msg.cmd;
    let data = msg.data;
    switch (cmd) {
        case DF.ClientMessages.Identify:
            OnClientIdentify(ws, data);
            break;
        case DF.ClientMessages.InstrumentRequest:
            OnClientInstrumentRequest(ws, data);
            break;
        case DF.ClientMessages.InstrumentRelease:
            OnClientInstrumentRelease(ws);
            break;
        case DF.ClientMessages.NoteOn:
            OnClientNoteOn(ws, data.note, data.velocity);
            break;
        case DF.ClientMessages.NoteOff:
            OnClientNoteOff(ws, data);
            break;
        case DF.ClientMessages.Ping:
            ws.send(JSON.stringify({
                cmd: DF.ServerMessages.Pong,
                data
            }));
            break;
        case DF.ClientMessages.ChatMessage:
            OnClientChatMessage(ws, data);
            break;
    }
};

var OnClientConnect = function (ws) {
    ws.DFClientID = GetUniqueID(); // associate the connection with an ID which will be used as a user id
    console.log(`Connection received; ID=${ws.DFClientID}`)
    ws.on('message', message => {
        OnClientMessage(ws, message);
    });
    ws.on('error', msg => { console.log(`error => ${msg}`) });
    ws.on('close', (code, msg) => { OnClientClose(ws, code, msg); });

    // send the "please identify yourself" msg
    ws.send(JSON.stringify({
        cmd: DF.ServerMessages.PleaseIdentify,
        data: ""
    }));
}

wss.on('listening', function () { console.log("now listening..."); });
wss.on('connection', OnClientConnect);

