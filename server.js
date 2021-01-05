const WebSocket = require('ws')

const ClientMessages = {
    Identify: "Identify", // user info
    // move. like to the couch, dance floor, stage
    InstrumentRequest: "InstrumentRequest", // instid
    InstrumentRelease: "InstrumentRelease",
    InstrumentControl: "InstrumentControl", //  (note on, note off, param change, ...)
    ReactToUser: "ReactToUser",// (userID, emoji)    
};
const ServerMessages = {
    PleaseIdentify: "PleaseIdentify",
    Welcome: "Welcome",// (your UserID & room state)
    UserEnter: "UserEnter",// (user data)
    UserLeave: "UserLeave",// UserID
    // move. like to the couch, dance floor, stage
    InstrumentOwnership: "InstrumentOwnership",// [InstrumentID, UserID]
    UserPlay: "UserPlay", // user, msg...]
};



// https://github.com/websockets/ws/blob/HEAD/doc/ws.md#event-message

const wss = new WebSocket.Server({
    port: 8080,
    clientTracking: true // allow access to clients set
});

var __gNextID = 1;
var GetUniqueID = function () {
    var ret = __gNextID;
    __gNextID++;
    return ret;
};

// we need to keep a whole room state on the server.
var DFRoom = {
    Users: [],
    Instrumens: []
}

var OnClientMessage = function (ws, text) {
    console.log(`Received message => ${text}`)
    var msg = JSON.parse(text);
    var cmd = msg.cmd;
    var data = cmd.data;
    switch (cmd) {
        case ClientMessages.Identify:
            // update state
            console.log(`User identified ${ws.DFClientID}. Send welcome.`)
            break;
        case ClientMessages.InstrumentRequest:
            // update state
            break;
        case ClientMessages.InstrumentRelease:
            // update state
            break;
        case ClientMessages.InstrumentControl:
            // update state
            break;
        case ClientMessages.ReactToUser:
            // update state
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
    ws.on('close', (code, msg) => { console.log(`close => ${code} ${msg}`) });

    // send the "please identify yourself" msg
    ws.send(JSON.stringify({
        cmd: ServerMessages.PleaseIdentify,
        data: ""
    }));
}

wss.on('listening', function () { console.log("now listening..."); });
wss.on('connection', OnClientConnect);

