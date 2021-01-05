

const ClientMessages = {
    Identify: "Identify", // user info
    // move. like to the couch, bar, dance floor, stage
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
    // move. like to the couch, bar, dance floor, stage
    InstrumentOwnership: "InstrumentOwnership",// [InstrumentID, UserID]
    UserPlay: "UserPlay", // user, msg...]
};

function DigifuNet() {
    this.serverUri = null;
    this.isConnected = false;
    this.socket = null;
    this.handler = null;
};

DigifuNet.prototype.OnSocketMessage = function (e) {
    this.isConnected = true;
    log(`mESSAGE FROM SERVER ${e.data}`);
    var msg = JSON.parse(e.data);
    var cmd = msg.cmd;
    var data = cmd.data;
    switch (cmd) {
        case ServerMessages.PleaseIdentify:
            this.handler.NET_OnPleaseIdentify();
            break;
        case ServerMessages.Welcome:
            this.handler.NET_OnWelcome(data);
            break;
        case ServerMessages.UserEnter:
            this.handler.NET_OnUserEnter(data);
            break;
        case ServerMessages.UserLeave:
            this.handler.NET_OnUserLeave(data.UserID);
            break;
        case ServerMessages.InstrumentOwnership:
            this.handler.NET_OnInstrumentOwnership(data.InstrumentID, data.UserID);
            break;
        case ServerMessages.UserPlay:
            this.handler.NET_OnUserPlay();
            break;
    }
};

DigifuNet.prototype.SendIdentify = function (data) {
    this.socket.send(JSON.stringify({
        cmd: ClientMessages.Identify,
        data: data
    }));
};

DigifuNet.prototype.SendRequestInstrument = function (instrumentID) {
    this.socket.send(JSON.stringify({
        cmd: ClientMessages.InstrumentRequest,
        data: instrumentID
    }));
};

DigifuNet.prototype.SendReleaseInstrument = function () {
    this.socket.send(JSON.stringify({
        cmd: ClientMessages.InstrumentRelease,
        data: ""
    }));
};

DigifuNet.prototype.Connect = function (serverUri, handler) {
    this.handler = handler;
    this.socket = new WebSocket(serverUri);
    this.socket.onmessage = this.OnSocketMessage.bind(this);
    this.socket.onerror = function (e) { log("socket error: " + e); }
    this.socket.onclose = function (e) { log("socket closed: " + e); }
};


