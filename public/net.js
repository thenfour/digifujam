'use strict';

class DigifuNet {
    constructor() {
        this.serverUri = null;
        this.isConnected = false;
        this.socket = null;
        this.handler = null;

        this.queuedParamChangeData = {}; // map paramID to newVal corresponding to ClientSettings.InstrumentParams
        this.paramChangeLastSent = new Date();
        this.timerCookie = null;
    };

    ResetInternalState() {
        if (this.timerCookie) {
            clearTimeout(this.timerCookie);
        }
        this.queuedParamChangeData = {}; // map paramID to newVal corresponding to ClientSettings.InstrumentParams
        this.paramChangeLastSent = new Date();
        this.timerCookie = null;
    };

    SendIdentify(data) {
        this.socket.emit(ClientMessages.Identify, data);
    };

    SendRequestInstrument(instrumentID) {
        this.socket.emit(ClientMessages.InstrumentRequest, instrumentID);
    };

    SendReleaseInstrument() {
        this.socket.emit(ClientMessages.InstrumentRelease);
    };

    SendNoteOn(note, velocity) {
        this.socket.emit(ClientMessages.NoteOn, {
            note,
            velocity
        });
    };

    SendNoteOff(note) {
        this.socket.emit(ClientMessages.NoteOff, note);
    };

    SendAllNotesOff() {
        this.socket.emit(ClientMessages.AllNotesOff);
    };

    SendPedalDown() {
        this.socket.emit(ClientMessages.PedalDown);
    };

    SendPedalUp() {
        this.socket.emit(ClientMessages.PedalUp);
    };

    OnParamChangeInterval() {
        this.timerCookie = null;
        this.paramChangeLastSent = new Date();
        //console.log(`OnParamChangeInterval QUEUED ${JSON.stringify(this.queuedParamChangeData)} `);
        let keys = Object.keys(this.queuedParamChangeData);
        if (keys.length < 1) {
            return;
        }
        this.socket.emit(ClientMessages.InstrumentParams, this.queuedParamChangeData);
        this.queuedParamChangeData = {}; // map paramID to newVal corresponding to ClientSettings.InstrumentParams
    };

    SendInstrumentParams(presetObj) {
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

    SendPong(token) {
        if (!this.socket) return; // ghost objects' timers can try to send this
        this.socket.emit(ClientMessages.Pong, token);
    };

    SendChatMessage(msg/* as DigifuChatMessage */) {
        this.socket.emit(ClientMessages.ChatMessage, msg);
    };

    SendUserState(data) {
        this.socket.emit(ClientMessages.UserState, data);
    };

    // data = { text, x, y }
    SendCheer(text, x, y) {
        this.socket.emit(ClientMessages.Cheer, { text, x, y });
    };

    SendDeletePreset(presetID) {
        this.socket.emit(ClientMessages.InstrumentPresetDelete, { presetID });
    };
    SendInstrumentFactoryReset() {
        this.socket.emit(ClientMessages.InstrumentFactoryReset, {});
    };
    SendInstrumentPresetSave(patchObj) {
        this.socket.emit(ClientMessages.InstrumentPresetSave, patchObj);
    };
    SendInstrumentBankReplace(bankJSON) {
        let obj = JSON.parse(bankJSON);
        this.socket.emit(ClientMessages.InstrumentBankReplace, obj);
    };

    SendCreateParamMapping(param, srcVal) {
        this.socket.emit(ClientMessages.CreateParamMapping, { paramID: param.paramID, srcVal });
    }

    SendRemoveParamMapping(param)
    {
        this.socket.emit(ClientMessages.RemoveParamMapping, { paramID: param.paramID });
    }

    downloadServerState(responseHandler) {
        this.serverDumpHandler = responseHandler;
        this.socket.emit(ClientMessages.DownloadServerState);
    };

    uploadServerState(data) {
        this.socket.emit(ClientMessages.UploadServerState, data);
    };


    Disconnect() {
        this.ResetInternalState();
        this.socket.disconnect(true);
        this.socket = null;
    };

    Connect(handler) {
        this.handler = handler;
        this.ResetInternalState();
        let query = Object.assign({ jamroom: window.location.pathname }, Object.fromEntries(new URLSearchParams(location.search)));
        this.socket = io({
            query
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

        this.socket.on(ServerMessages.CreateParamMapping, data => this.handler.NET_OnCreateParamMapping(data));
        this.socket.on(ServerMessages.RemoveParamMapping, data => this.handler.NET_OnRemoveParamMapping(data));

        this.socket.on(ServerMessages.InstrumentPresetDelete, data => this.handler.NET_OnInstrumentPresetDelete(data));
        this.socket.on(ServerMessages.InstrumentFactoryReset, data => this.handler.NET_OnInstrumentFactoryReset(data));
        this.socket.on(ServerMessages.InstrumentPresetSave, data => this.handler.NET_OnInstrumentPresetSave(data));
        this.socket.on(ServerMessages.InstrumentBankReplace, data => this.handler.NET_OnInstrumentBankReplace(data));

        this.socket.on(ServerMessages.Ping, (data) => this.handler.NET_OnPing(data));
        this.socket.on(ServerMessages.ServerStateDump, (data) => this.serverDumpHandler(data));
        this.socket.on(ServerMessages.PleaseReconnect, (data) => this.handler.NET_pleaseReconnectHandler());

        this.socket.on('disconnect', () => { this.ResetInternalState(); this.handler.NET_OnDisconnect(); });
    };
};


