'use strict';

function DigifuNet() {
    this.serverUri = null;
    this.isConnected = false;
    this.socket = null;
    this.handler = null;
};

DigifuNet.prototype.OnSocketMessage = function (e) {
    this.isConnected = true;
    var msg = JSON.parse(e.data);
    var cmd = msg.cmd;
    var data = msg.data;
    log(`Msg from server cmd=${cmd}`);
    log(`  data=${JSON.stringify(data)}`);
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
            this.handler.NET_OnUserLeave(data.userID);
            break;
        case ServerMessages.InstrumentOwnership:
            this.handler.NET_OnInstrumentOwnership(data.instrumentID, data.userID);
            break;
        case ServerMessages.NoteOn:
            this.handler.NET_OnNoteOn(data.userID, data.note, data.velocity);
            break;
        case ServerMessages.NoteOff:
            this.handler.NET_OnNoteOff(data.userID, data.note);
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
    log(`sending request for instrument ${instrumentID}`);
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

DigifuNet.prototype.SendNoteOn = function (note, velocity) {
    this.socket.send(JSON.stringify({
        cmd: ClientMessages.NoteOn,
        data: {
            note,
            velocity
        }
    }));
};

DigifuNet.prototype.SendNoteOff = function (note) {
    this.socket.send(JSON.stringify({
        cmd: ClientMessages.NoteOff,
        data: note
    }));
};

DigifuNet.prototype.Disconnect = function () {
    this.socket.close();
    this.socket = null;
};

DigifuNet.prototype.Connect = function (serverUri, handler) {
    this.handler = handler;
    this.socket = new WebSocket(serverUri);
    this.socket.onmessage = this.OnSocketMessage.bind(this);
    this.socket.onerror = function (e) { log("socket error: " + e); }
    this.socket.onclose = function (e) { log("socket closed: " + e); }
};


