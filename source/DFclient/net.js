const DF = require("../DFcommon/DFCommon");

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
        this.stats.paramsSent++;
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
            if (isWholePatch) { // if you're changing "the whole patch", then wipe out any previous patch changes.
                this.queuedParamChangeData.patchObj = patchObj;
                this.queuedParamChangeData.isWholePatch = true;
            } else {
                this.queuedParamChangeData.isWholePatch = this.queuedParamChangeData.isWholePatch || isWholePatch; // once you change the whole patch, subsequent changes will always still have this flag.
                this.queuedParamChangeData.patchObj = Object.assign(this.queuedParamChangeData.patchObj, patchObj);
            }
            return;
        }

        let now = new Date();
        let delta = now - this.paramChangeLastSent;
        if (delta >= DF.ClientSettings.InstrumentParamIntervalMS) {
            // we waited long enough between changes; send in real time.
            this.paramChangeLastSent = new Date();
            this.stats.paramsSent++;

            this.socket.emit(DF.ClientMessages.InstrumentParams, {
                isWholePatch,
                patchObj
            });
            return;
        }

        // we need to set a timer.
        this.stats.paramTimersCreated++;
        this.queuedParamChangeData = {
            isWholePatch,
            patchObj
        };

        this.timerCookie = setTimeout(() => {
            this.OnParamChangeInterval();
        }, DF.ClientSettings.InstrumentParamIntervalMS - delta);
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

    SendRoomBPM(bpm, phaseRelativeMS) {
        this.socket.emit(DF.ClientMessages.RoomBPMUpdate, { bpm, phaseRelativeMS });
    };

    SendAdjustBeatPhase(relativeMS) {
        this.socket.emit(DF.ClientMessages.AdjustBeatPhase, { relativeMS });
    }

    SendAdjustBeatOffset(relativeBeats) {
        this.socket.emit(DF.ClientMessages.AdjustBeatOffset, { relativeBeats });
    }

    SendCreateParamMapping(param, srcVal) {
        this.socket.emit(DF.ClientMessages.CreateParamMapping, { paramID: param.paramID, srcVal });
    }

    SendRemoveParamMapping(param) {
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

    JoinRoom(roomID) {
        this.socket.emit(DF.ClientMessages.JoinRoom, { roomID });
    }

    PersistentSignOut() {
        this.socket.emit(DF.ClientMessages.PersistentSignOut);
    }
    GoogleSignIn(google_access_token) {
        this.socket.emit(DF.ClientMessages.GoogleSignIn, {google_access_token});
    }

    SendDance(danceID) {
        this.socket.emit(DF.ClientMessages.UserDance, { danceID });
    }

    SendChatMessageOp(ops) {
        this.socket.emit(DF.ClientMessages.ChatMessageOp, ops);
    }

    // GRAFFITI
    SendGraffitiOps(ops) {
        this.socket.emit(DF.ClientMessages.GraffitiOps, ops);
    }
    // --------------

    // SEQUENCER

    SeqSetTimeSig(timeSig) {
        this.socket.emit(DF.ClientMessages.SeqSetTimeSig, {timeSigID: timeSig.id});
    }

    SeqPlayStop(isPlaying, instrumentID) {
        this.socket.emit(DF.ClientMessages.SeqPlayStop, {isPlaying, instrumentID});
    }

    SetSetNoteMuted(midiNoteValue, isMuted) {
        this.socket.emit(DF.ClientMessages.SetSetNoteMuted, {midiNoteValue, isMuted});
    }
    SeqSelectPattern(selectedPatternIdx) {
        this.socket.emit(DF.ClientMessages.SeqSelectPattern, {selectedPatternIdx});
    }
    SeqSetSpeed(speed) {
        this.socket.emit(DF.ClientMessages.SeqSetSpeed, {speed});
    }
    SeqSetSwing(swing) {
        this.socket.emit(DF.ClientMessages.SeqSetSwing, {swing});
    }
    SeqSetDiv(divisionType) {
        this.socket.emit(DF.ClientMessages.SeqSetDiv, {divisionType});
    }
    SeqSetOct(oct) {
        this.socket.emit(DF.ClientMessages.SeqSetOct, {oct});
    }
    SeqSetLength(lengthMajorBeats) {
        this.socket.emit(DF.ClientMessages.SeqSetLength, {lengthMajorBeats});
    }
    SeqPatternOps(ops) {
        if (!ops) return;
        if (!ops.length) return;
        this.socket.emit(DF.ClientMessages.SeqPatternOps, {ops});
    }
    SeqPatchInit() {
        this.socket.emit(DF.ClientMessages.SeqPatchInit, {});
    }
    SeqPresetOp(data) {
        this.socket.emit(DF.ClientMessages.SeqPresetOp, data);
    }
    SeqMetadata(params) {// { title, description, tags }
        this.socket.emit(DF.ClientMessages.SeqMetadata, params);
    }
    SeqSetListeningInstrumentID(params) {// { seqInstrumentID, instrumentID: }
        this.socket.emit(DF.ClientMessages.SeqSetListeningInstrumentID, params);
    }

    SendUserRoleOp(payload) {
        this.socket.emit(DF.ClientMessages.UserRoleOp, payload);
    }
    SendRoomPatchOp(data) {
        this.socket.emit(DF.ClientMessages.RoomPatchOp, data);
    }

    SendRequestWorldState() {
        this.socket.emit(DF.ClientMessages.RequestWorldState);
    }

    SendRequestUserPings() {
        this.socket.emit(DF.ClientMessages.RequestRoomUserPings);
    }

    SendUserStateOp(data) {
        this.socket.emit(DF.ClientMessages.UserStateOp, data);
    }

    // --------------

    IsConnected() {
        return !!(this.socket?.connected);
    }

    Disconnect() {
        this.ResetQueuedParamChangeData();
        this.socket.disconnect(true);
        this.socket = null;
    };

    Connect(handler, google_access_token) {
        this.handler = handler;
        this.ResetQueuedParamChangeData();
        let query = Object.assign({
            '7jamRealm': 'main',
            roomID: window.DFRoomID,
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
        this.socket.on(DF.ServerMessages.PersistentSignOutComplete, (data) => this.handler.NET_OnPersistentSignOutComplete(data));
        this.socket.on(DF.ServerMessages.GoogleSignInComplete, (data) => this.handler.NET_OnGoogleSignInComplete(data));
        
        this.socket.on(DF.ServerMessages.ServerStateDump, (data) => this.serverDumpHandler(data));
        this.socket.on(DF.ServerMessages.PleaseReconnect, (data) => this.handler.NET_pleaseReconnectHandler());
        this.socket.on(DF.ServerMessages.ChangeRoomState, (data) => this.handler.NET_ChangeRoomState(data));

        this.socket.on(DF.ServerMessages.RoomBeat, (data) => this.handler.NET_OnRoomBeat(data));
        this.socket.on(DF.ServerMessages.RoomBPMUpdate, (data) => this.handler.NET_OnRoomBPMUpdate(data))
        this.socket.on(DF.ServerMessages.GraffitiOps, (data) => this.handler.NET_OnGraffitiOps(data))
        this.socket.on(DF.ServerMessages.UserDance, (data) => this.handler.NET_OnUserDance(data))

        this.socket.on(DF.ServerMessages.UserRoleOp, (data) => this.handler.NET_OnUserRoleOp(data))
        this.socket.on(DF.ServerMessages.ChatMessageOp, (data) => this.handler.NET_OnChatMessageOp(data))

        this.socket.on(DF.ServerMessages.WorldState, (data) => this.handler.NET_OnWorldState(data));
        this.socket.on(DF.ServerMessages.RoomUserPings, (data) => this.handler.NET_OnRoomUserPings(data));

        // SEQ ----
        this.socket.on(DF.ServerMessages.SeqPlayStop, (data) => this.handler.NET_SeqPlayStop(data));
        this.socket.on(DF.ServerMessages.SeqSetTimeSig, (data) => this.handler.NET_SeqSetTimeSig(data));

        this.socket.on(DF.ServerMessages.SetSetNoteMuted, (data) => this.handler.NET_SetSetNoteMuted(data));
        this.socket.on(DF.ServerMessages.SeqSelectPattern, (data) => this.handler.NET_SeqSelectPattern(data));
        this.socket.on(DF.ServerMessages.SeqSetSpeed, (data) => this.handler.NET_SeqSetSpeed(data));
        this.socket.on(DF.ServerMessages.SeqSetSwing, (data) => this.handler.NET_SeqSetSwing(data));
        this.socket.on(DF.ServerMessages.SeqSetDiv, (data) => this.handler.NET_SeqSetDiv(data));
        this.socket.on(DF.ServerMessages.SeqSetOct, (data) => this.handler.NET_SeqSetOct(data));
        this.socket.on(DF.ServerMessages.SeqSetLength, (data) => this.handler.NET_SeqSetLength(data));
        this.socket.on(DF.ServerMessages.SeqPatternOps, (data) => this.handler.NET_SeqPatternOps(data));
        this.socket.on(DF.ServerMessages.SeqPatchInit, (data) => this.handler.NET_SeqPatchInit(data));
        this.socket.on(DF.ServerMessages.SeqPresetOp, (data) => this.handler.NET_SeqPresetOp(data));
        this.socket.on(DF.ServerMessages.SeqMetadata, (data) => this.handler.NET_SeqMetadata(data));
        this.socket.on(DF.ServerMessages.SeqSetListeningInstrumentID, (data) => this.handler.NET_SeqSetListeningInstrumentID(data));
        // ---- SEQ

        this.socket.on(DF.ServerMessages.RoomPatchOp, (data) => this.handler.NET_RoomPatchOp(data));
        this.socket.on(DF.ServerMessages.RoomPresetLoadResult, (data) => this.handler.NET_RoomPresetLoadResult(data));        
        this.socket.on(DF.ServerMessages.UserStateOp, (data) => this.handler.NET_UserStateOp(data));        

        this.socket.on('disconnect', () => { this.ResetQueuedParamChangeData(); this.handler.NET_OnDisconnect(); });
    };
};


module.exports = {
    DigifuNet,
};

