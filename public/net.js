'use strict';

//const { ServerMessages } = require("./DFCommon");

function DigifuNet() {
    this.serverUri = null;
    this.isConnected = false;
    this.socket = null;
    this.handler = null;
};

DigifuNet.prototype.SendIdentify = function (data) {
    this.socket.emit(ClientMessages.Identify, data);
};

DigifuNet.prototype.SendRequestInstrument = function (instrumentID) {
    this.socket.emit(ClientMessages.InstrumentRequest, instrumentID);
};

DigifuNet.prototype.SendReleaseInstrument = function () {
    this.socket.emit(ClientMessages.InstrumentRelease);
};

DigifuNet.prototype.SendNoteOn = function (note, velocity) {
    this.socket.emit(ClientMessages.NoteOn,{
            note,
            velocity
        });
};

DigifuNet.prototype.SendNoteOff = function (note) {
    this.socket.emit(ClientMessages.NoteOff, note);
};

DigifuNet.prototype.SendPedalDown = function () {
    this.socket.emit(ClientMessages.PedalDown);
};

DigifuNet.prototype.SendPedalUp = function () {
    this.socket.emit(ClientMessages.PedalUp);
};

DigifuNet.prototype.SendPing = function (data) {
    if (!this.socket) return; // ghost objects' timers can try to send this
    this.socket.emit(ClientMessages.Ping, data);
};

DigifuNet.prototype.SendChatMessage = function (msg/* as DigifuChatMessage */) {
    this.socket.emit(ClientMessages.ChatMessage, msg);
};

DigifuNet.prototype.Disconnect = function () {
    this.socket.disconnect(true);
    this.socket = null;
};

DigifuNet.prototype.Connect = function (serverUri, handler) {
    this.handler = handler;
    this.socket = io();//new WebSocket(serverUri);

    this.socket.on(ServerMessages.PleaseIdentify, (data) => this.handler.NET_OnPleaseIdentify(data));
    this.socket.on(ServerMessages.Welcome, (data) => this.handler.NET_OnWelcome(data));
    this.socket.on(ServerMessages.UserEnter, (data) => this.handler.NET_OnUserEnter(data));
    this.socket.on(ServerMessages.UserLeave, data => this.handler.NET_OnUserLeave(data.userID));
    this.socket.on(ServerMessages.InstrumentOwnership, data => this.handler.NET_OnInstrumentOwnership(data.instrumentID, data.userID));
    
    this.socket.on(ServerMessages.NoteOn, data => this.handler.NET_OnNoteOn(data.userID, data.note, data.velocity));
    this.socket.on(ServerMessages.NoteOff, data => this.handler.NET_OnNoteOff(data.userID, data.note));
    this.socket.on(ServerMessages.PedalDown, data => this.handler.NET_OnPedalDown(data.userID));
    this.socket.on(ServerMessages.PedalUp, data => this.handler.NET_OnPedalUp(data.userID));

    this.socket.on(ServerMessages.Pong, (data) => this.handler.NET_OnPong(data));
    this.socket.on(ServerMessages.UserChatMessage, data => this.handler.NET_OnUserChatMessage(data));

    this.socket.on('disconnect', this.handler.NET_OnDisconnect);
};

