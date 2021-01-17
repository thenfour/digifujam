'use strict';

//const { ServerMessages } = require("./DFCommon");

function DigifuNet() {
    this.serverUri = null;
    this.isConnected = false;
    this.socket = null;
    this.handler = null;

    this.queuedParamChangeData = {}; // map paramID to newVal corresponding to ClientSettings.InstrumentParams
    this.paramChangeLastSent = new Date();
    this.timerCookie = null;
};

DigifuNet.prototype.ResetInternalState = function() {
    if (this.timerCookie) {
        clearTimeout(this.timerCookie);
    }
    this.queuedParamChangeData = {}; // map paramID to newVal corresponding to ClientSettings.InstrumentParams
    this.paramChangeLastSent = new Date();
    this.timerCookie = null;
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
    this.socket.emit(ClientMessages.NoteOn, {
        note,
        velocity
    });
};

DigifuNet.prototype.SendNoteOff = function (note) {
    this.socket.emit(ClientMessages.NoteOff, note);
};

DigifuNet.prototype.SendAllNotesOff = function () {
    this.socket.emit(ClientMessages.AllNotesOff);
};

DigifuNet.prototype.SendPedalDown = function () {
    this.socket.emit(ClientMessages.PedalDown);
};

DigifuNet.prototype.SendPedalUp = function () {
    this.socket.emit(ClientMessages.PedalUp);
};

DigifuNet.prototype.OnParamChangeInterval = function () {
    this.timerCookie = null;
    this.paramChangeLastSent = new Date();
    //console.log(`OnParamChangeInterval QUEUED ${JSON.stringify(this.queuedParamChangeData)} `);
    this.socket.emit(ClientMessages.InstrumentParams, this.queuedParamChangeData);
    this.queuedParamChangeData = {}; // map paramID to newVal corresponding to ClientSettings.InstrumentParams
};

DigifuNet.prototype.SendInstrumentParams = function (presetObj) {
    // how to throttle?
    // - if we have a timer set, modify the packet it will send.
    // - if we're slow enough, and no timer set, then send live.
    // - if we're too fast, then set timer with this packet.

    if (this.timerCookie) {
        this.queuedParamChangeData = Object.assign(this.queuedParamChangeData, presetObj);
        return;
    }

    let now = new Date();
    let delta = now - this.paramChangeLastSent;
    if (delta >= ClientSettings.InstrumentParamIntervalMS) {
        // we waited long enough between changes; send in real time.
        this.paramChangeLastSent = new Date();
        //console.log(`SendInstrumentParam LIVE delta=${delta} ${JSON.stringify([{ paramID, newVal }])} `);
        this.socket.emit(ClientMessages.InstrumentParams, presetObj);
        return;
    }

    // we need to set a timer.
    //console.log(`SendInstrumentParam setting timer; delta=${delta}`);
    this.timerCookie = setTimeout(this.OnParamChangeInterval.bind(this), ClientSettings.InstrumentParamIntervalMS - delta);
};

DigifuNet.prototype.SendPong = function (token) {
    if (!this.socket) return; // ghost objects' timers can try to send this
    this.socket.emit(ClientMessages.Pong, token);
};

DigifuNet.prototype.SendChatMessage = function (msg/* as DigifuChatMessage */) {
    this.socket.emit(ClientMessages.ChatMessage, msg);
};

DigifuNet.prototype.SendUserState = function (data) {
    this.socket.emit(ClientMessages.UserState, data);
};

// data = { text, x, y }
DigifuNet.prototype.SendCheer = function (text, x, y) {
    this.socket.emit(ClientMessages.Cheer, { text, x, y });
};

DigifuNet.prototype.Disconnect = function () {
    this.ResetInternalState();
    this.socket.disconnect(true);
    this.socket = null;
};

DigifuNet.prototype.Connect = function (handler) {
    this.handler = handler;
    this.ResetInternalState();
    this.socket = io({
        query: {
            jamroom: window.location.pathname
        }
    });

    this.socket.on(ServerMessages.PleaseIdentify, (data) => this.handler.NET_OnPleaseIdentify(data));
    this.socket.on(ServerMessages.Welcome, (data) => this.handler.NET_OnWelcome(data));
    this.socket.on(ServerMessages.UserEnter, (data) => this.handler.NET_OnUserEnter(data));
    this.socket.on(ServerMessages.UserLeave, data => this.handler.NET_OnUserLeave(data));
    this.socket.on(ServerMessages.UserState, data => this.handler.NET_OnUserState(data));
    this.socket.on(ServerMessages.UserChatMessage, data => this.handler.NET_OnUserChatMessage(data));
    this.socket.on(ServerMessages.Cheer, data => this.handler.NET_OnUserCheer(data));

    this.socket.on(ServerMessages.InstrumentOwnership, data => this.handler.NET_OnInstrumentOwnership(data.instrumentID, data.userID, data.idle));
    this.socket.on(ServerMessages.NoteOn, data => this.handler.NET_OnNoteOn(data.userID, data.note, data.velocity));
    this.socket.on(ServerMessages.NoteOff, data => this.handler.NET_OnNoteOff(data.userID, data.note));
    this.socket.on(ServerMessages.UserAllNotesOff, data => this.handler.NET_OnUserAllNotesOff(data));
    this.socket.on(ServerMessages.PedalDown, data => this.handler.NET_OnPedalDown(data.userID));
    this.socket.on(ServerMessages.PedalUp, data => this.handler.NET_OnPedalUp(data.userID));
    this.socket.on(ServerMessages.InstrumentParams, data => this.handler.NET_OnInstrumentParams(data));

    this.socket.on(ServerMessages.Ping, (data) => this.handler.NET_OnPing(data.token, data.users));

    this.socket.on('disconnect', () => { this.ResetInternalState(); this.handler.NET_OnDisconnect(); });
};
