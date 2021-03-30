'use strict';

const DF = require("./DFCommon");

class DigifuNet {
    constructor() {
        this.serverUri = null;
        this.isConnected = false;
        this.socket = null;
        this.handler = null;

        this.stats = {
            paramTimersCreated: 0,
            paramsOptimized: 0,
            paramsSent: 0,
        };

        this.ResetQueuedParamChangeData();
    };

    ResetQueuedParamChangeData() {
        if (this.timerCookie) {
            clearTimeout(this.timerCookie);
        }
        this.paramChangeLastSent = new Date();
        this.timerCookie = null;
        this.queuedParamChangeData = {
            isWholePatch: false,
            patchObj: {}// map paramID to newVal corresponding to ClientSettings.InstrumentParams
        }; 
    }

    SendIdentify(data) {
        this.socket.emit(DF.ClientMessages.Identify, data);
    };

    SendRequestInstrument(instrumentID) {
        this.socket.emit(DF.ClientMessages.InstrumentRequest, instrumentID);
    };

    SendReleaseInstrument() {
        this.socket.emit(DF.ClientMessages.InstrumentRelease);
    };

    SendNoteOn(note, velocity, resetBeatPhase) {
        this.socket.emit(DF.ClientMessages.NoteOn, {
            note,
            velocity,
            resetBeatPhase
        });
    };

    SendNoteOff(note) {
        this.socket.emit(DF.ClientMessages.NoteOff, note);
    };

    SendAllNotesOff() {
        this.socket.emit(DF.ClientMessages.AllNotesOff);
    };

    SendPedalDown() {
        this.socket.emit(DF.ClientMessages.PedalDown);
    };

    SendPedalUp() {
        this.socket.emit(DF.ClientMessages.PedalUp);
    };

    OnParamChangeInterval() {
        this.timerCookie = null;
        let keys = Object.keys(this.queuedParamChangeData.patchObj);
        if (keys.length < 1) {
            return;
        }
        this.socket.emit(DF.ClientMessages.InstrumentParams, this.queuedParamChangeData);
        this.stats.paramsSent ++;
        this.queuedParamChangeData = {
            isWholePatch: false,
            patchObj: {}// map paramID to newVal corresponding to ClientSettings.InstrumentParams
        }; 
        this.ResetQueuedParamChangeData();
    };

    SendInstrumentParams(patchObj, isWholePatch) {
        // how to throttle?
        // - if we have a timer set, modify the packet it will send.
        // - if we're slow enough, and no timer set, then send live.
        // - if we're too fast, then set timer with this packet.

        // already have a timer pending; integrate this patch obj.
        if (this.timerCookie) {
            this.stats.paramsOptimized ++;
            if (isWholePatch) { // if you're changing "the whole patch", then wipe out any previous patch changes.
                this.queuedParamChangeData.patchObj = patchObj;
                this.queuedParamChangeData.isWholePatch = true;
                return;
            }
            this.queuedParamChangeData.isWholePatch = this.queuedParamChangeData.isWholePatch || isWholePatch; // once you change the whole patch, subsequent changes will always still have this flag.
            this.queuedParamChangeData.patchObj = Object.assign(this.queuedParamChangeData.patchObj, patchObj);
            return;
        }

        let now = new Date();
        let delta = now - this.paramChangeLastSent;
        if (delta >= DF.ClientSettings.InstrumentParamIntervalMS) {
            // we waited long enough between changes; send in real time.
            this.paramChangeLastSent = new Date();
            this.stats.paramsSent ++;
            this.socket.emit(DF.ClientMessages.InstrumentParams, {
                isWholePatch,
                patchObj
            });
            return;
        }

        // we need to set a timer.
        this.stats.paramTimersCreated ++;
        //console.log(`SendInstrumentParam setting timer; timeout=${DF.ClientSettings.InstrumentParamIntervalMS - delta}. timerscreated:${this.stats.paramTimersCreated}, paramsOptimized:${this.stats.paramsOptimized}, paramsSent:${this.stats.paramsSent}`);
        this.timerCookie = setTimeout(this.OnParamChangeInterval.bind(this), DF.ClientSettings.InstrumentParamIntervalMS - delta);
    };

    SendPong(token) {
        if (!this.socket) return; // ghost objects' timers can try to send this
        this.socket.emit(DF.ClientMessages.Pong, token);
    };

    SendChatMessage(msg/* as DigifuChatMessage */) {
        this.socket.emit(DF.ClientMessages.ChatMessage, msg);
    };

    SendUserState(data) {
        this.socket.emit(DF.ClientMessages.UserState, data);
    };

    SendUserQuantizationSpec(quantizeSpec) {
        this.socket.emit(DF.ClientMessages.Quantization, {
            quantizeSpec,
        });
    }

    // data = { text, x, y }
    SendCheer(text, x, y) {
        this.socket.emit(DF.ClientMessages.Cheer, { text, x, y });
    };

    SendDeletePreset(presetID) {
        this.socket.emit(DF.ClientMessages.InstrumentPresetDelete, { presetID });
    };
    SendInstrumentFactoryReset() {
        this.socket.emit(DF.ClientMessages.InstrumentFactoryReset, {});
    };
    SendInstrumentPresetSave(patchObj) {
        this.socket.emit(DF.ClientMessages.InstrumentPresetSave, patchObj);
    };
    SendInstrumentBankMerge(bankJSON) {
        let obj = JSON.parse(bankJSON);
        this.socket.emit(DF.ClientMessages.InstrumentBankMerge, obj);
    };
    
    SendRoomBPM (bpm) {
        this.socket.emit(DF.ClientMessages.RoomBPMUpdate, { bpm });
    };

    SendAdjustBeatPhase(relativeMS) {
        this.socket.emit(DF.ClientMessages.AdjustBeatPhase, { relativeMS });
    }
    
    SendCreateParamMapping(param, srcVal) {
        this.socket.emit(DF.ClientMessages.CreateParamMapping, { paramID: param.paramID, srcVal });
    }

    SendRemoveParamMapping(param)
    {
        this.socket.emit(DF.ClientMessages.RemoveParamMapping, { paramID: param.paramID });
    }

    SendAdminChangeRoomState(cmd, params) {
        this.socket.emit(DF.ClientMessages.AdminChangeRoomState, { cmd, params });
    }

    downloadServerState(responseHandler) {
        this.serverDumpHandler = responseHandler;
        this.socket.emit(DF.ClientMessages.DownloadServerState);
    };

    uploadServerState(data) {
        this.socket.emit(DF.ClientMessages.UploadServerState, data);
    };


    Disconnect() {
        this.ResetQueuedParamChangeData();
        this.socket.disconnect(true);
        this.socket = null;
    };

    Connect(handler, roomKey, google_access_token) {
        this.handler = handler;
        this.ResetQueuedParamChangeData();
        let query = Object.assign({
            jamroom: window.location.pathname,
            roomKey,
        }, Object.fromEntries(new URLSearchParams(location.search)));

        if (google_access_token) {
            query.google_access_token = google_access_token;
        }

        //query.google_access_token = "test_not_an_actual_token";

        this.socket = io({
            query,
        });

        this.socket.on(DF.ServerMessages.PleaseIdentify, (data) => this.handler.NET_OnPleaseIdentify(data));
        this.socket.on(DF.ServerMessages.Welcome, (data) => this.handler.NET_OnWelcome(data));
        this.socket.on(DF.ServerMessages.UserEnter, (data) => this.handler.NET_OnUserEnter(data));
        this.socket.on(DF.ServerMessages.UserLeave, data => this.handler.NET_OnUserLeave(data));
        this.socket.on(DF.ServerMessages.UserState, data => this.handler.NET_OnUserState(data));
        this.socket.on(DF.ServerMessages.UserChatMessage, data => this.handler.NET_OnUserChatMessage(data));
        this.socket.on(DF.ServerMessages.Cheer, data => this.handler.NET_OnUserCheer(data));

        this.socket.on(DF.ServerMessages.InstrumentOwnership, data => this.handler.NET_OnInstrumentOwnership(data.instrumentID, data.userID, data.idle));
        this.socket.on(DF.ServerMessages.NoteEvents, data => this.handler.NET_OnNoteEvents(data.noteOns, data.noteOffs));
        //this.socket.on(DF.ServerMessages.NoteOff, data => this.handler.NET_OnNoteOff(data.userID, data.note));
        this.socket.on(DF.ServerMessages.UserAllNotesOff, data => this.handler.NET_OnUserAllNotesOff(data));
        this.socket.on(DF.ServerMessages.PedalDown, data => this.handler.NET_OnPedalDown(data.userID));
        this.socket.on(DF.ServerMessages.PedalUp, data => this.handler.NET_OnPedalUp(data.userID));
        this.socket.on(DF.ServerMessages.InstrumentParams, data => this.handler.NET_OnInstrumentParams(data));

        this.socket.on(DF.ServerMessages.CreateParamMapping, data => this.handler.NET_OnCreateParamMapping(data));
        this.socket.on(DF.ServerMessages.RemoveParamMapping, data => this.handler.NET_OnRemoveParamMapping(data));

        this.socket.on(DF.ServerMessages.InstrumentPresetDelete, data => this.handler.NET_OnInstrumentPresetDelete(data));
        this.socket.on(DF.ServerMessages.InstrumentFactoryReset, data => this.handler.NET_OnInstrumentFactoryReset(data));
        this.socket.on(DF.ServerMessages.InstrumentPresetSave, data => this.handler.NET_OnInstrumentPresetSave(data));
        this.socket.on(DF.ServerMessages.InstrumentBankMerge, data => this.handler.NET_OnInstrumentBankMerge(data));

        this.socket.on(DF.ServerMessages.Ping, (data) => this.handler.NET_OnPing(data));
        this.socket.on(DF.ServerMessages.ServerStateDump, (data) => this.serverDumpHandler(data));
        this.socket.on(DF.ServerMessages.PleaseReconnect, (data) => this.handler.NET_pleaseReconnectHandler());
        this.socket.on(DF.ServerMessages.ChangeRoomState, (data) => this.handler.NET_ChangeRoomState(data));
        
        this.socket.on(DF.ServerMessages.RoomBeat, (data) => this.handler.NET_OnRoomBeat(data)); //TODO: changeroomstate
        this.socket.on(DF.ServerMessages.RoomBPMUpdate, (data) => this.handler.NET_OnRoomBPMUpdate(data))
        this.socket.on('disconnect', () => { this.ResetQueuedParamChangeData(); this.handler.NET_OnDisconnect(); });
    };
};


module.exports = {
    DigifuNet,
};

