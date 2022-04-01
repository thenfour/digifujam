const DF = require('../DFcommon/DFCommon');
const DFMusic = require("../DFcommon/DFMusic");
const {RoomSequencerPlayer} = require('./SequencerPlayer');
const DFU = require('../DFcommon/dfutil');
const { EmptyPersistentInfo, eUserGlobalRole } = require('../DFcommon/DFUser');
const Seq = require('../DFcommon/SequencerCore');
const { InstSeqSelection, RoomPreset } = require('../DFcommon/roomPresetsCore');

const log = (a) => { return console.log(a) };

////////////////////////////////////////////////////////////////////////////////////////////////
class RoomServer {

  constructor(server, data, serverStateObj) {
    this.server = server;
    this.io = this.server.io;

    // thaw into live classes
    this.roomState = DF.DigifuRoomState.FromJSONData(data, url => fs.readFileSync(url, "utf8"), url => JSON.parse(fs.readFileSync(url)));

    this.roomState.absoluteURL = this.server.config.host_prefix + this.roomState.route;
    if (!this.roomState.absoluteURL.endsWith('/')) {
      this.roomState.absoluteURL += '/';
    }
    console.log(`ROOM state URL ${this.roomState.absoluteURL }`);

    // do not do this stuff on the client side, because there it takes whatever the server gives. thaw() is enough there.
    let usedInstrumentIDs = [];
    this.roomState.instrumentCloset.forEach(i => {
      if (usedInstrumentIDs.some(x => x == i.instrumentID)) {
        log(`${i.name} warning: duplicate instrument ID '${i.instrumentID}' found.`);
      }
      if (!i.instrumentID) {
        log(`${i.name} warning: Instruments need a constant instrumentID.`);
        i.instrumentID = DFU.generateID();
      }
      usedInstrumentIDs.push(i.instrumentID);

      // make sure internal params are there.
      let paramsToAdd = [];
      DF.InternalInstrumentParams.forEach(ip => {
        if (!i.params.some(p => p.paramID == ip.paramID)) {
          let n = Object.assign(new DF.InstrumentParam(), ip);
          n.thaw();
          //log(`adding internal param ${n.name}`);
          paramsToAdd.push(n);
        }
      });
      i.params = paramsToAdd.concat(i.params);
    });

    // integrate the server state for this room
    if (serverStateObj) {
      const roomRestoreState = serverStateObj.find(r => r.roomID === this.roomState.roomID);
      if (roomRestoreState && roomRestoreState.dump) {
        this.roomState.adminImportRoomState(roomRestoreState.dump);
        console.log(`Imported room state for ${this.roomState.roomID}`);
      }
    }

    // do factory resets
    // this.roomState.instrumentCloset.forEach(i => {
    //   this.roomState.integrateRawParamChanges(i, this.roomState.GetInitPreset(i));
    // });

    // remember this stuff for our "reset to factory defaults" function.
    this.factorySettings = this.roomState.instrumentCloset.map(i => {
      return {
        instrumentID: i.instrumentID,
        presetsJSON: this.roomState.exportAllPresetsJSON(i)
      };
    });

    setTimeout(() => {
      this.OnPingInterval();
    }, DF.ServerSettings.PingIntervalMS);

    // set routines for metronome / quantization events
    this.roomState.metronome.setBeatRoutine(() => { this.OnRoomBeat(); });
    this.roomState.quantizer.setNoteEventsRoutine((noteOns, noteOffs) => { this.FlushQuantizedNoteEvents(noteOns, noteOffs); });

    this.sequencerPlayer = new RoomSequencerPlayer(this.roomState);
  }

  adminImportRoomState(data) {
    this.roomState.adminImportRoomState(data);
  }

  // returns { user, index } or null.
  FindUserFromSocket(clientSocket) {
    if (!clientSocket.DFUserID) {
      //throw new Error(`Socket ${clientSocket.id} has no DFUserID`);
      return null; // this is not exception-worthy; reconnection and refresh exchanges can cause these kinds of things.
    }
    return this.roomState.FindUserByID(clientSocket.DFUserID);
  };

  Idle_CheckIdlenessAndEmit() {
    //log("Idle_CheckIdlenessAndEmit");
    // check idleness of users holding instruments.
    let now = new Date();
    this.roomState.instrumentCloset.forEach(i => {
      if (!i.controlledByUserID) return;
      let u = this.roomState.FindUserByID(i.controlledByUserID);
      if (!u) return;

      // check auto-release instrument timeout
      if (u.user.idle) {
        if ((now - u.user.lastActivity) > DF.ServerSettings.InstrumentAutoReleaseTimeoutMS) {
          //log(`User on instrument is idle: ${u.user.userID} INST ${i.instrumentID} ==> AUTO RELEASE`);
          this.sequencerPlayer.AllNotesOff(i);
          this.io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, {
            instrumentID: i.instrumentID,
            userID: null,
            idle: false
          });
        }
        return; // user is already idle, but not auto-release. nothing to do.
      }

      if ((now - u.user.lastActivity) > DF.ServerSettings.InstrumentIdleTimeoutMS) {
        u.user.idle = true;
        // user is considered idle on their instrument.
        //log(`User on instrument is idle: ${u.user.userID} INST ${i.instrumentID}`);
        this.io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, {
          instrumentID: i.instrumentID,
          userID: u.user.userID,
          idle: true
        });
      }
    });
  }

  UnidleInstrument(user, instrument) {
    try {
      user.lastActivity = new Date();
      if (user.idle) {
        user.idle = false;
        this.io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, {
          instrumentID: instrument.instrumentID,
          userID: user.userID,
          idle: false
        });
      }
    } catch (e) {
      console.log(`UnidleInstrument exception occurred`);
      console.log(e);
    }
  }

  async OnClientIdentify(clientSocket, clientUserSpec) {
    // handler
    const rejectUserEntry = () => {
      try {
        clientSocket.emit(DF.ServerMessages.PleaseReconnect);
      } catch (e) {
        console.log(`rejectUserEntry exception occurred`);
        console.log(e);
      }
    };

    try {
      // the data is actually a DigifuUser object. but for security it should be copied.
      let u = new DF.DigifuUser();

      u.SetName(DF.EnsureValidUsername(clientUserSpec.name));
      u.SetColor(DF.EnsureValidUserColor(clientUserSpec.color));

      // try to reuse existing user ID, so we can track this user through the world instead of considering
      // room changes totally new users.
      let userID = clientSocket.DFUserID || DFU.generateUserID();

      // handler
      const completeUserEntry = (hasPersistentIdentity, persistentInfo, persistentID) => {
        clientSocket.DFexistingUserObj = null; // release reference
        u.userID = userID.toString(); // this could be a mongo Objectid
        u.persistentID = persistentID?.toString();
        u.hasPersistentIdentity = hasPersistentIdentity;
        clientSocket.DFUserID = userID;
        console.log(`Setting DFUserID for socket ${clientSocket.id} to ${userID}`);
        u.persistentInfo = persistentInfo;
        u.lastActivity = new Date();
        u.position = { x: this.roomState.width / 2, y: this.roomState.height / 2 };
        if (clientSocket.DFPosition) {
          u.position = clientSocket.DFPosition; // if you're transitioning from a previous room, we store your neew position here across the workflow.
        }

        if (clientSocket.handshake.query.DF_ADMIN_PASSWORD === this.server.config.admin_key) {
          log(`An admin has been identified id=${u.userID} name=${u.name}.`);
          u.addGlobalRole(eUserGlobalRole.sysadmin.name);
        } else {
          log(`Welcoming user id=${u.userID} name=${u.name}`);//, persistentInfo:${JSON.stringify(persistentInfo)}`);
        }

        this.roomState.users.push(u);

        let chatMessageEntry = new DF.DigifuChatMessage();
        chatMessageEntry.messageID = DFU.generateID();
        chatMessageEntry.messageType = DF.ChatMessageType.join; // of ChatMessageType. "chat", "part", "join", "nick"
        chatMessageEntry.fromUserID = u.userID;
        chatMessageEntry.fromUserColor = u.color;
        chatMessageEntry.fromUserName = u.name;
        chatMessageEntry.timestampUTC = new Date();
        chatMessageEntry.fromRoomName = clientSocket.DFFromRoomName;
        this.roomState.chatLog.push(chatMessageEntry);

        this.server.mServerStats.OnUserWelcome(this.roomState, u, this.roomState.users.filter(u => u.source === DF.eUserSource.SevenJam).length,
          clientSocket.DFIsDoingRoomChange);
        clientSocket.DFIsDoingRoomChange = false;

        let adminKey = null;
        if (u.IsAdmin()) {
          adminKey = this.server.config.admin_key;
        }

        // notify this 1 user of their user id & room state
        clientSocket.emit(DF.ServerMessages.Welcome, {
          yourUserID: userID,
          roomState: JSON.parse(this.roomState.asWelcomeJSON()), // filter out stuff that shouldn't be sent to clients
          adminKey,
          globalSequencerConfig: Seq.GetGlobalSequencerConfig(),
        });

        // broadcast user enter to all clients except the user.
        clientSocket.to(this.roomState.roomID).broadcast.emit(DF.ServerMessages.UserEnter, { user: u, chatMessageEntry });
      }; // completeUserEntry

      if (!await this.server.mGoogleOAuth.TryProcessHandshake(u, clientSocket, completeUserEntry, rejectUserEntry, clientUserSpec.google_refresh_token)) {
        const persistentInfo = clientSocket.DFexistingUserObj?.persistentInfo ?? EmptyPersistentInfo();
        completeUserEntry(false, persistentInfo, null);
      }

    } catch (e) {
      log(`OnClientIdentify exception occurred`);
      log(e);
      rejectUserEntry();
    }
  };

  OnClientInstrumentRequest(ws, instrumentID) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser === null) {
        log(`instrument request for unknown user`);
        return;
      }

      // TODO: validate if the current instrument is available or its controlling user is considered idle.

      // release existing instrument.
      // find their instrument.
      let existingInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (existingInstrument != null) {
        existingInstrument.instrument.ReleaseOwnership();
        this.sequencerPlayer.AllNotesOff(existingInstrument.instrument);

        // broadcast instrument change to all clients
        this.io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, {
          instrumentID: existingInstrument.instrument.instrumentID,
          userID: null,
          idle: false,
        });
      }

      if (!this.roomState.UserCanPerform(foundUser.user)) {
        console.log(`user ${foundUser.user.toString()} does not have permission to perform.`);
        return;
      }

      // find the new instrument.
      let foundInstrument = this.roomState.FindInstrumentById(instrumentID);
      if (foundInstrument === null) {
        log(`instrument request for unknown instrument ${instrumentID}`);
        return;
      }

      this.roomState.quantizer.clearUser(foundUser.user.userID);
      this.roomState.quantizer.clearInstrument(foundInstrument.instrument.instrumentID);

      foundInstrument.instrument.controlledByUserID = foundUser.user.userID;
      foundUser.user.idle = false;
      foundUser.user.lastActivity = new Date();

      // broadcast instrument change to all clients
      this.sequencerPlayer.AllNotesOff(foundInstrument.instrument);
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, {
        instrumentID: foundInstrument.instrument.instrumentID,
        userID: foundUser.user.userID,
        idle: false
      });
    } catch (e) {
      log(`OnClientInstrumentRequest exception occurred`);
      log(e);
    }
  };

  OnClientInstrumentRelease(ws) {
    try {
      //log(`OnClientInstrumentRelease => ${ws.id}`)

      // find the user object.
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`=> unknown user`);
        return;
      }

      // find their instrument.
      let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (foundInstrument == null) {
        log(`=> not controlling an instrument.`);
        return;
      }

      this.roomState.quantizer.clearUser(foundUser.user.userID);
      this.roomState.quantizer.clearInstrument(foundInstrument.instrument.instrumentID);

      foundInstrument.instrument.ReleaseOwnership();
      this.sequencerPlayer.AllNotesOff(foundInstrument.instrument);

      // broadcast instrument change to all clients
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, {
        instrumentID: foundInstrument.instrument.instrumentID,
        userID: null,
        idle: false
      });
    } catch (e) {
      log(`OnClientInstrumentRelease exception occurred`);
      log(e);
    }
  };

  OnClientNoteOn(ws, data) {
    try {
      // find the user object.
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`=> unknown user`);
        return;
      }

      // find user's instrument; if we have broadcast an IDLE for this instrument, now revoke it.
      let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (foundInstrument == null) {
        log(`=> not controlling an instrument.`);
        return;
      }

      this.UnidleInstrument(foundUser.user, foundInstrument.instrument);

      // if sequencer is in arp, don't play the note. rather feed the sequencer player with info.
      if (this.sequencerPlayer.NoteOn(foundInstrument.instrument, data.note, data.velocity)) {
        return;
      }

      foundUser.user.IncNoteOns();
      this.server.mServerStats.OnNoteOn(this.roomState, foundUser.user);
      this.roomState.stats.noteOns++;

      if (data.resetBeatPhase) {
        this.roomState.metronome.resetBeatPhase();
      }

      this.roomState.quantizer.onLiveNoteOn(foundUser.user.userID, foundUser.user.pingMS, foundInstrument.instrument.instrumentID, data.note, data.velocity, foundUser.user.quantizeSpec);

    } catch (e) {
      log(`OnClientNoteOn exception occurred`);
      log(e);
    }
  };

  FlushQuantizedNoteEvents(noteOns, noteOffs) {
    try {

      // for sequencer events, give stats to the user who controls the instrument
      noteOns.forEach(note => {
        if (note.seqInstrumentID && note.note) { // check midinotevalue because there are other commands (op: "startPlaying",) which should not count.
          const foundInstrument = this.roomState.FindInstrumentById(note.seqInstrumentID);
          console.assert(foundInstrument);
          const foundUser = this.roomState.FindUserByID(foundInstrument.instrument.controlledByUserID);
          if (foundUser) {
            foundUser.user.IncNoteOns();
            this.server.mServerStats.OnNoteOn(this.roomState, foundUser.user);
            this.roomState.stats.noteOns++; // <-- correct. don't add sequencer notes to the room stats if nobody's controlling it. would just sorta blow out of control.
          }
        }
      });

      // process scheduled sequencer ops,which are buried in noteOns
      noteOns.forEach(note => {
        if (note.seqInstrumentID) {
          const foundInstrument = this.roomState.FindInstrumentById(note.seqInstrumentID);
          if (note.op === "startPlaying") {
            foundInstrument.instrument.sequencerDevice.StartPlaying();
            //console.log(`start playing due to cue`);
          }
        }
      });

      // broadcast to all clients
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.NoteEvents, {
        noteOns,
        noteOffs,
      });
    } catch (e) {
      log(`OnClientNoteOn exception occurred`);
      log(e);
    }
  }

  OnClientNoteOff(ws, note) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnClientNoteOff => unknown user`);
        return;
      }

      let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (foundInstrument == null) {
        log(`=> not controlling an instrument.`);
        return;
      }

      this.UnidleInstrument(foundUser.user, foundInstrument.instrument);

      if (this.sequencerPlayer.NoteOff(foundInstrument.instrument, note)) {
        return;
      }

      // broadcast to all clients except foundUser
      this.roomState.quantizer.onLiveNoteOff(foundUser.user.userID, foundUser.user.pingMS, foundInstrument.instrument.instrumentID, note, foundUser.user.quantizeSpec);
    } catch (e) {
      log(`OnClientNoteOff exception occurred`);
      log(e);
    }
  };

  OnClientAllNotesOff(ws) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnClientAllNotesOff => unknown user`);
        return;
      }

      let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (foundInstrument == null) {
        log(`=> not controlling an instrument.`);
        return;
      }

      this.UnidleInstrument(foundUser.user, foundInstrument.instrument);
      this.roomState.quantizer.clearUser(foundUser.user.userID);
      this.roomState.quantizer.clearInstrument(foundInstrument.instrument.instrumentID);
      this.sequencerPlayer.AllNotesOff(foundInstrument.instrument);

      // broadcast to all clients except foundUser
      ws.to(this.roomState.roomID).broadcast.emit(DF.ServerMessages.UserAllNotesOff, foundUser.user.userID);
    } catch (e) {
      log(`OnClientAllNotesOff exception occurred`);
      log(e);
    }
  };


  OnClientPedalUp(ws) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnClientPedalUp => unknown user`);
        return;
      }
      let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (foundInstrument == null) {
        log(`=> not controlling an instrument.`);
        return;
      }
      this.sequencerPlayer.PedalUp(foundInstrument.instrument);
      // broadcast to all clients except foundUser
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.PedalUp, {
        userID: foundUser.user.userID
      });
    } catch (e) {
      log(`OnClientPedalUp exception occurred`);
      log(e);
    }
  };


  OnClientPedalDown(ws) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnClientPedalDown => unknown user`);
        return;
      }
      let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (foundInstrument == null) {
        log(`=> not controlling an instrument.`);
        return;
      }
      this.sequencerPlayer.PedalDown(foundInstrument.instrument);
      // broadcast to all clients
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.PedalDown, {
        userID: foundUser.user.userID
      });
    } catch (e) {
      log(`OnClientPedalDown exception occurred`);
      log(e);
    }
  };


  OnClientInstrumentParams(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnClientInstrumentParams => unknown user`);
        return;
      }

      let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (foundInstrument == null) {
        log(`=> not controlling an instrument.`);
        return;
      }

      if (foundInstrument.instrument.paramChangeRenewal) {
        this.UnidleInstrument(foundUser.user, foundInstrument.instrument);
      }

      // set the value.
      this.roomState.integrateRawParamChanges(foundInstrument.instrument, data.patchObj, data.isWholePatch);
      this.server.mServerStats.OnParamChange(this.roomState, foundUser.user, Object.keys(data.patchObj).length);

      // broadcast to all clients
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentParams, {
        //userID: foundUser.user.userID,
        instrumentID: foundInstrument.instrument.instrumentID,
        patchObj: data.patchObj,
        isWholePatch: data.isWholePatch,
      });
    } catch (e) {
      log(`OnClientInstrumentParams exception occurred`);
      log(e);
    }
  };


  OnClientCreateParamMapping(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnClientCreateParamMapping => unknown user`);
        return;
      }
      let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (foundInstrument == null) {
        log(`=> not controlling an instrument.`);
        return;
      }

      // paramID: param.paramID, srcVal });
      // todo: validate paramID & srcValue.
      const mapSpec = foundInstrument.instrument.ensureParamMappingParams(foundInstrument.instrument.GetParamByID(data.paramID), data.srcVal);

      // "srcVal":1
      //log(`CreateParamMapping ${foundInstrument.instrument.name}, data=${JSON.stringify(data)}, mappingSrc value = ${mapSpec.mappingSrc.currentValue}}`);

      // broadcast to all clients except foundUser
      ws.to(this.roomState.roomID).broadcast.emit(DF.ServerMessages.CreateParamMapping, {
        instrumentID: foundInstrument.instrument.instrumentID,
        paramID: data.paramID,
        srcVal: data.srcVal,
      });
    } catch (e) {
      log(`OnClientCreateParamMapping exception occurred`);
      log(e);
    }
  };



  OnClientRemoveParamMapping(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnClientRemoveParamMapping => unknown user`);
        return;
      }
      let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (foundInstrument == null) {
        log(`=> not controlling an instrument.`);
        return;
      }

      // paramID: param.paramID
      // todo: validate paramID.
      const patchObj = foundInstrument.instrument.removeParamMapping(foundInstrument.instrument.GetParamByID(data.paramID));
      //log(`RemoveParamMapping inst ${foundInstrument.instrument.name}, paramID ${data.paramID}`);
      //log(`  -> and must recalc ${JSON.stringify(patchObj)}`);
      this.roomState.integrateRawParamChanges(foundInstrument.instrument, patchObj, false);

      // broadcast to all clients except foundUser
      ws.to(this.roomState.roomID).broadcast.emit(DF.ServerMessages.RemoveParamMapping, {
        instrumentID: foundInstrument.instrument.instrumentID,
        paramID: data.paramID,
      });
    } catch (e) {
      log(`OnClientRemoveParamMapping exception occurred`);
      log(e);
    }
  };




  OnClientInstrumentPresetDelete(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) throw new Error(`unknown user`);
      let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (foundInstrument == null) throw (`user not controlling an instrument.`);
      if (!data.presetID) throw new Error(`no presetID`);
      const bank = this.roomState.GetPresetBankForInstrument(foundInstrument.instrument);
      let foundp = bank.presets.find(p => p.presetID == data.presetID);
      if (!foundp) throw new Error(`unable to find the preset ${data.presetID}`);
      if (foundUser.user.IsAdmin()) {
        if (foundp.isReadOnly) log(`An admin user ${foundUser.user.userID} | ${foundUser.user.name} is deleting a read-only preset ${data.presetID}`);
      } else {
        if (foundp.isReadOnly) throw new Error(`don't try to delete a read-only preset.`);
      }

      // delete
      bank.presets.removeIf(p => p.presetID == data.presetID);

      // broadcast
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentPresetDelete, {
        instrumentID: foundInstrument.instrument.instrumentID,
        presetID: data.presetID
      });

    } catch (e) {
      log(`OnClientInstrumentPresetDelete exception occurred`);
      log(e);
    }
  }

  OnClientInstrumentFactoryReset(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) throw new Error(`unknown user`);
      let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (foundInstrument == null) throw (`user not controlling an instrument.`);

      let factorySettings = this.factorySettings.find(o => o.instrumentID == foundInstrument.instrument.instrumentID);
      if (!factorySettings) throw new Error(`no factory settings found for instrument ${foundInstrument.instrument.instrumentID}`);

      // a factory reset means importing the factory presets list and loading an init preset.
      if (!this.roomState.importAllPresetsJSON(foundInstrument.instrument, factorySettings.presetsJSON, true)) {
        throw new Error(`error importing factory settings for instrument ${foundInstrument.instrument.instrumentID}`);
      }
      let initPreset = this.roomState.GetInitPreset(foundInstrument.instrument);
      this.roomState.integrateRawParamChanges(foundInstrument.instrument, initPreset, true);

      const bank = this.roomState.GetPresetBankForInstrument(foundInstrument.instrument);

      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentFactoryReset, {
        instrumentID: foundInstrument.instrument.instrumentID,
        presets: bank.presets,
      });

    } catch (e) {
      log(`OnClientInstrumentFactoryReset exception occurred`);
      log(e);
    }
  }

  OnClientInstrumentBankMerge(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) throw new Error(`unknown user`);
      let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (foundInstrument == null) throw (`user not controlling an instrument.`);

      // TODO: we don't really verify this at any stage. from the clipboard straight to the server's memory is a bit iffy, despite not really having any consequence.
      log(`OnClientInstrumentBankMerge ${data.length}`);
      if (!this.roomState.importAllPresetsArray(foundInstrument.instrument, data, false)) {
        throw new Error(`data was not in the correct format probably.`);
      }

      const bank = this.roomState.GetPresetBankForInstrument(foundInstrument.instrument);

      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentBankMerge, {
        instrumentID: foundInstrument.instrument.instrumentID,
        presets: bank.presets,
      });

    } catch (e) {
      log(`OnClientInstrumentBankMerge exception occurred`);
      log(e);
    }
  }

  OnClientInstrumentPresetSave(ws, patchObj) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) throw new Error(`unknown user`);
      let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (foundInstrument == null) throw (`user not controlling an instrument.`);

      // fix some things up.
      patchObj.author = foundUser.user.name;
      patchObj.savedDate = new Date();
      if (!patchObj.presetID) patchObj.presetID = DFU.generateID();
      patchObj.isReadOnly = false;

      // if there's an existing preset with the same ID, then overwrite. otherwise push.
      const bank = this.roomState.GetPresetBankForInstrument(foundInstrument.instrument);

      let existing = bank.presets.find(p => p.presetID == patchObj.presetID);
      if (existing) {
        if (existing.isReadOnly) {
          if (foundUser.user.IsAdmin()) {
            // if you're an admin user, overwriting a READ-ONLY preset, then keep it read-only.
            patchObj.isReadOnly = true;
            log(`An admin user ${foundUser.user.userID} ${foundUser.user.name} is overwriting read-only preset ${patchObj.presetID}. Keeping it read-only.`);
          } else {
            throw new Error(`Don't try to overwrite readonly presets U:${foundUser.user.userID} ${foundUser.user.name}, presetID ${patchObj.presetID}`);
          }
        }
        Object.assign(existing, patchObj);
      } else {
        bank.presets.push(patchObj);
      }

      this.server.mServerStats.OnPresetSave(this.roomState, foundUser.user, foundInstrument.instrument.getDisplayName(), patchObj.patchName);

      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentPresetSave, {
        instrumentID: foundInstrument.instrument.instrumentID,
        patchObj,
      });

    } catch (e) {
      log(`OnClientInstrumentPresetSave exception occurred`);
      log(e);
    }
  }

  // chat msgs can come from discord or 7jam itself so this logic is shared.
  HandleUserChatMessage(fromUser, msgText, source) {
    let nm = new DF.DigifuChatMessage();
    nm.messageID = DFU.generateID();
    nm.source = source;
    nm.messageType = DF.ChatMessageType.chat; // of ChatMessageType. "chat", "part", "join", "nick"
    nm.message = msgText;
    nm.fromUserID = fromUser.userID;
    nm.fromUserColor = fromUser.color;
    nm.fromUserName = fromUser.name;
    nm.timestampUTC = new Date();

    this.server.mServerStats.OnMessage(this.roomState, fromUser, nm);
    fromUser.persistentInfo.stats.messages++;
    this.roomState.stats.messages++;

    this.roomState.chatLog.push(nm);

    // broadcast to all clients. even though it can feel more responsive and effiicent for the sender to just handle their own,
    // this allows simpler handling of incorporating the messageID.
    this.io.to(this.roomState.roomID).emit(DF.ServerMessages.UserChatMessage, nm);
  };  

  OnClientChatMessage(ws, msg) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnClientChatMessage => unknown user`);
        return;
      }

      // sanitize msg
      if (typeof (msg.message) != 'string') return;
      if (msg.message.length < 1) return;
      msg.message = msg.message.substring(0, DF.ServerSettings.ChatMessageLengthMax);

      this.HandleUserChatMessage(foundUser.user, msg.message, DF.eMessageSource.SevenJam);

    } catch (e) {
      log(`OnClientChatMessage exception occurred`);
      log(e);
    }
  };

  CleanUpChatLog() {
    try {
      let now = new Date();
      this.roomState.chatLog = this.roomState.chatLog.filter(msg => {
        return ((now - new Date(msg.timestampUTC)) < DF.ServerSettings.ChatHistoryMaxMS);
      });
    } catch (e) {
      log(`CleanUpChatLog exception occurred`);
      log(e);
    }
  }

  DoUserRoomChange(ws, user, params) {
    if (!params.roomID) {
      log(`Error: no room ID specified for change.`);
      return;
    }
    if (!(params.roomID in this.server.mRooms)) {
      log(`Error: User ${user.userID} is attempting to join a nonexistent room ${params.roomID}`);
      return;
    }
    let newRoom = this.server.mRooms[params.roomID];
    //log(`ROOM CHANGE => ${params.roomID} user ${user.name}`);
    // send user part to everyone else in old room
    ws.DFIsDoingRoomChange = true;  // gets unset in welcome
    this.ClientLeaveRoom(ws, user.userID, newRoom.roomState.roomTitle);

    if (!('x' in params)) {
      params.x = newRoom.roomState.width / 2;
    }
    if (!('y' in params)) {
      params.y = newRoom.roomState.height / 2;
    }

    // enter the new room
    ws.DFPosition = {
      x: params.x,
      y: params.y
    };
    newRoom.ClientJoin(ws, this.roomState, user);
  }

  DoUserItemInteraction(ws, user, item, interactionType) {
    let interactionSpec = item[interactionType];
    if (!interactionSpec) {
      //log(`Item ${item.itemID} has no interaction type ${interactionType}`);
      return;
    }
    if (user.presence !== DF.eUserPresence.Online) // sanity
      return;
    if (interactionSpec.processor != "server") {
      return;
    }
    switch (interactionSpec.fn) {
      case DF.RoomFns.roomChange:
        this.DoUserRoomChange(ws, user, interactionSpec.params);
        break;
      default:
        log(`Item ${item.itemID} / interaction type ${interactionType} has unknown interaction FN ${interactionSpec.fn}`);
        break;
    }
  };

  OnClientJoinRoom(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnClientJoinRoom => unknown user`);
        return;
      }

      this.DoUserRoomChange(ws, foundUser.user, { roomID: data.roomID});

    } catch (e) {
      log(`OnClientJoinRoom exception occurred`);
      log(e);
    }
  };

  OnClientUserState(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnClientUserState => unknown user`);
        return;
      }

      // validate & integrate state. validation errors will result in just ignoring the request.
      let origPayload = JSON.stringify(data);
      data.name = DF.sanitizeUsername(data.name);
      if (data.name == null) {
        log(`OnClientUserState: invalid username ${origPayload.name}.`);
        return;
      }
      data.color = DF.sanitizeUserColor(data.color);
      if (data.color == null) {
        log(`OnClientUserState: invalid color ${origPayload.color}.`);
        return;
      }

      let nm = null;
      if (foundUser.user.name != data.name) { // new chat message entry for this event
        nm = new DF.DigifuChatMessage();
        nm.messageID = DFU.generateID();
        nm.messageType = DF.ChatMessageType.nick; // of ChatMessageType. "chat", "part", "join", "nick"
        nm.message = "";
        nm.fromUserID = foundUser.user.userID;
        nm.fromUserColor = foundUser.user.color;
        nm.fromUserName = foundUser.user.name;
        nm.timestampUTC = new Date();
        nm.toUserID = foundUser.user.userID;
        nm.toUserColor = foundUser.user.color;
        nm.toUserName = data.name;
        this.roomState.chatLog.push(nm);
        //log(`chatLog.push => nick`);
      }

      foundUser.user.SetName(data.name);
      foundUser.user.SetColor(data.color);

      foundUser.user.position.x = data.position.x;
      foundUser.user.position.y = data.position.y;

      data.userID = foundUser.user.userID; // adapt the data packet for sending to all clients.

      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.UserState, { state: data, chatMessageEntry: nm });

      // room interaction based on intersection.
      this.roomState.roomItems.forEach(item => {
        if (item.rect.PointIntersects(foundUser.user.position)) {
          this.DoUserItemInteraction(ws, foundUser.user, item, "onAvatarEnter");
        }
      });

    } catch (e) {
      log(`OnClientUserState exception occurred`);
      log(e);
    }
  };

  OnClientQuantization(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnClientQuantization => unknown user`);
        return;
      }

      this.roomState.quantizer.clearUser(foundUser.user.userID);

      foundUser.user.quantizeSpec = data.quantizeSpec;
    } catch (e) {
      log(`OnClientQuantization exception occurred`);
      log(e);
    }
  };


  // text, x, y
  OnClientCheer(ws, data) {
    //log(`OnClientCheer => ${JSON.stringify(data)} ${data.text.length}`);
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnClientCheer => unknown user`);
        return;
      }

      const now = new Date();
      if ((now - foundUser.user.lastCheerSentDate) < DF.ClientSettings.MinCheerIntervalMS) {
        return;
      }
      foundUser.user.lastCheerSentDate = now;

      let txt = DF.sanitizeCheerText(data.text);
      if (txt == null) {
        log(`OnClientCheer: invalid cheer ${data.text}.`);
        return;
      }

      this.server.mServerStats.OnCheer(this.roomState, foundUser.user);
      this.roomState.stats.cheers++;

      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.Cheer, { userID: foundUser.user.userID, text: txt, x: data.x, y: data.y });
    } catch (e) {
      log(`OnClientCheer exception occurred`);
      log(e);
    }
  }

  // needs its own function because it's also called from an Express endpoint when a user uploads graffiti.
  DoGraffitiOpsForUser(user, data) {
    if (!Array.isArray(data)) throw new Error(`DoGraffitiOpsForUser: data is not valid; should be array`);
    data.forEach(op => {
      switch (op.op) {
        case "place": // { op:"place", content, lifetimeMS }
          {
            const removalOps = this.roomState.removeGraffitiSoUserCanPlace(user.userID, user.persistentID).map(id => ({
              op: "remove",
              id,
            }));
            const graffiti = this.roomState.placeGraffiti(user.userID, op.content, op.lifetimeMS);
            if (!graffiti) {
              // no big deal; probably a validation error.
              return;
            }
            //console.log(`** created graffiti @ ${JSON.stringify(graffiti.position)} - ID ${graffiti.id}, userID ${user.userID}`);
            if (!graffiti) return; // no need to throw; assume validation failed.
            this.io.to(this.roomState.roomID).emit(DF.ServerMessages.GraffitiOps, removalOps.concat([{
              op:"place",
              graffiti,
            }]));
            break;
          }
        case "remove": // { op:"remove", id }
          {
            const g = this.roomState.graffiti.find(g => g.id === op.id);
            if (!g) return; // something out of sync.
            if (!this.roomState.UserCanManageGraffiti(user, g)) {
              console.log(`!! user ${user.name} ${user.userID} has no permission to delete graffiti ${op.id}`);
              return;
            }
            if (!this.roomState.removeGraffiti(op.id)) return;// client out of sync; throw new Error(`Failed to remove graffiti`);
            this.io.to(this.roomState.roomID).emit(DF.ServerMessages.GraffitiOps, [{ op:"remove", id: op.id }]);
            //console.log(`** deleting graffiti ID ${op.id}, userID ${user.userID} because server was told to.`);
            break;
          }
        case "pin": // { op:"pin", id, pin: true/false }
          {
            const g = this.roomState.graffiti.find(g => g.id === op.id);
            if (!g) return; // something out of sync.
            if (!this.roomState.UserCanManageGraffiti(user, g)) {
              console.log(`!! user ${user.name} ${user.userID} has no permission to pin/unpin graffiti ${op.id}`);
              return;
            }
            g.pinned = !!op.pin;
            this.io.to(this.roomState.roomID).emit(DF.ServerMessages.GraffitiOps, [{ op:"pin", id: op.id, pin:g.pinned }]);
            //console.log(`** ${g.pinned ? "pinned" : "unpinned"} graffiti ID ${op.id}`);
          }
          break;
        case "setExpiration": // { op:"setExpiration", id, expiration }
          {
            const g = this.roomState.graffiti.find(g => g.id === op.id);
            if (!g) return; // something out of sync.
            if (!this.roomState.UserCanManageGraffiti(user, g)) {
              console.log(`!! user ${user.name} ${user.userID} has no permission to set expiration on graffiti ${op.id}`);
              return;
            }
            g.expires = parseInt(op.expiration);
            this.io.to(this.roomState.roomID).emit(DF.ServerMessages.GraffitiOps, [{ op:"setExpiration", id: op.id, expiration:g.expires }]);
            //console.log(`** set expiration of graffiti ID ${op.id}`);
          }
          break;
        case "setColor": // { op:"setColor", id, color }
        {
          const g = this.roomState.graffiti.find(g => g.id === op.id);
          if (!g) return; // something out of sync.
          if (!this.roomState.UserCanManageGraffiti(user, g)) {
            console.log(`!! user ${user.name} ${user.userID} has no permission to set color on graffiti ${op.id}`);
            return;
          }
          g.color = op.color;
          this.io.to(this.roomState.roomID).emit(DF.ServerMessages.GraffitiOps, [{ op:"setColor", id: op.id, color:g.color }]);
        }
        break;

        case "setSize": // { op:"setSize", id, size }
        {
          const g = this.roomState.graffiti.find(g => g.id === op.id);
          if (!g) return; // something out of sync.
          if (!this.roomState.UserCanManageGraffiti(user, g)) {
            console.log(`!! user ${user.name} ${user.userID} has no permission to setSize on graffiti ${op.id}`);
            return;
          }
          g.size = op.size;
          this.io.to(this.roomState.roomID).emit(DF.ServerMessages.GraffitiOps, [{ op:"setSize", id: op.id, size:g.size }]);
        }
        break;

        case "setPosition": // { op:"setPosition", id, x, y }
        {
          const g = this.roomState.graffiti.find(g => g.id === op.id);
          if (!g) return; // something out of sync.
          if (!this.roomState.UserCanManageGraffiti(user, g)) {
            console.log(`!! user ${user.name} ${user.userID} has no permission to setPosition on graffiti ${op.id}`);
            return;
          }
          if (!this.roomState.SetGraffitiPosition(g, parseFloat(op.x), parseFloat(op.y))) {
            console.log(`!! user ${user.name} ${user.userID} setPosition(${op.x},${op.y}) on graffiti ${op.id}: failed; probably out of region.`);
            return;
          }
          this.io.to(this.roomState.roomID).emit(DF.ServerMessages.GraffitiOps, [{ op:"setPosition", id: op.id, x:op.x, y:op.y }]);
        }
        break;



      }
    });
  }

  OnGraffitiOps(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnGraffitiOps => unknown user`);
        return;
      }
      this.DoGraffitiOpsForUser(foundUser.user, data);
    } catch (e) {
      log(`OnGraffitiOps exception occurred`);
      log(e);
    }
  }

  OnUserDance(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnUserDance => unknown user`);
        return;
      }
      if (!Number.isInteger(data.danceID)) {
        log(`OnUserDance => dance ID ${data.danceID} invalid`);
        return;
      }

      foundUser.user.danceID = data.danceID;
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.UserDance, {
        userID: foundUser.user.userID,
        danceID: data.danceID,
      });
    } catch (e) {
      log(`OnUserDance exception occurred`);
      log(e);
    }
  }

  OnChatMessageOp(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnChatMessageOp => unknown user`);
        return;
      }

      switch (data.op) {
        case "delete":
          // find chat message
          const msg = this.roomState.chatLog.find(m => m.messageID === data.messageID);
          if (!msg) {
            console.log(`! delete message: unknown message ID ${data.messageID} <user ${foundUser.user.name} uid ${foundUser.user.userID} upid ${foundUser.user.persistentID}>`);
            return;
          }
          // does user have permissions
          if (!this.roomState.HasPermissionsToDeleteChatMessage(foundUser.user, msg)) {
            console.log(`! delete message: no permissions to delete message. message ID ${data.messageID} <user ${foundUser.user.name} uid ${foundUser.user.userID} upid ${foundUser.user.persistentID}>`);
            return;
          }
          this.roomState.DeleteMessage(msg.messageID);
          this.io.to(this.roomState.roomID).emit(DF.ServerMessages.ChatMessageOp, data);
      }
    } catch (e) {
      log(`OnChatMessageOp exception occurred`);
      log(e);
    }
  }

  // bpm
  OnClientRoomBPMUpdate(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        console.log(`OnClientRoomBPMUpdate => unknown user`);
        return;
      }
      if (!this.roomState.UserCanPerform(foundUser.user)) throw new Error(`OnClientRoomBPMUpdate: User does not have permissions.`);

      data.bpm = DFU.baseClamp(data.bpm, DF.ServerSettings.MinBPM, DF.ServerSettings.MaxBPM);
      this.roomState.setBPM(data.bpm);
      if (data.phaseRelativeMS) {
        this.roomState.metronome.AdjustPhase(data.phaseRelativeMS);
      }
      this.sequencerPlayer.BPMChanged(data.bpm);
      this.sequencerPlayer.onChanged_General();

      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.RoomBPMUpdate, { bpm: this.roomState.metronome.getBPM() }); //update bpm for ALL clients
    } catch (e) {
      log(`OnClientRoomBPMUpdate exception occured`);
      log(e);
    }
  }

  OnClientAdjustBeatPhase(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        console.log(`OnClientAdjustBeatPhase => unknown user`);
        return;
      }
      if (!this.roomState.UserCanPerform(foundUser.user)) throw new Error(`OnClientAdjustBeatPhase: User does not have permissions.`);

      this.roomState.metronome.AdjustPhase(data.relativeMS);
      this.sequencerPlayer.onChanged_General();
      // no need to emit this to clients because the metronome is executed by the server.
    } catch (e) {
      log(`OnClientAdjustBeatPhase exception occured`);
      log(e);
    }
  }

  OnClientAdjustBeatOffset(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        console.log(`OnClientAdjustBeatOffset => unknown user`);
        return;
      }
      if (!this.roomState.UserCanPerform(foundUser.user)) throw new Error(`OnClientAdjustBeatOffset: User does not have permissions.`);

      this.roomState.OffsetBeats(data.relativeBeats);
      this.sequencerPlayer.onChanged_General();
      // no need to emit this to clients because the metronome is executed by the server.
    } catch (e) {
      log(`OnClientAdjustBeatOffset exception occured`);
      log(e);
    }
  }

  // called per every beat, BPM is defined in roomState
  OnRoomBeat() {
    try {
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.RoomBeat, { bpm: this.roomState.metronome.getBPM(), beat: Math.round(this.roomState.metronome.getAbsoluteBeat()) }); //send bpm in order to synchronize
    } catch (e) {
      log(`OnRoomBeat exception occured`);
      log(e);
    }
  }

  OnAdminChangeRoomState(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnAdminChangeRoomState => unknown user`);
        return;
      }

      switch (data.cmd) {
        case "setAnnouncementHTML":
          if (!foundUser.user.IsAdmin()) throw new Error(`User isn't an admin.`);
          this.roomState.announcementHTML = data.params;
          this.io.to(this.roomState.roomID).emit(DF.ServerMessages.ChangeRoomState, data);
          break;
        case "setRoomImg":
          if (!foundUser.user.IsModerator()) throw new Error(`User isn't a moderator.`);
          this.roomState.img = data.params;
          this.io.to(this.roomState.roomID).emit(DF.ServerMessages.ChangeRoomState, data);
          break;
        case "setRadioChannel":
          if (!foundUser.user.IsModerator()) throw new Error(`User isn't a moderator.`);
          this.roomState.radio.channelID = data.params.channelID;
          this.io.to(this.roomState.roomID).emit(DF.ServerMessages.ChangeRoomState, data);
          break;
        case "setRadioFX":
          // todo: validate?
          if (!foundUser.user.IsModerator()) throw new Error(`User isn't a moderator.`);
          this.roomState.radio.fxEnabled = data.params.fxEnabled;
          this.roomState.radio.reverbGain = data.params.reverbGain;
          this.roomState.radio.filterType = data.params.filterType;
          this.roomState.radio.filterFrequency = data.params.filterFrequency;
          this.roomState.radio.filterQ = data.params.filterQ;
          this.io.to(this.roomState.roomID).emit(DF.ServerMessages.ChangeRoomState, data);
          break;
        case "backupServerState":
          if (!foundUser.user.IsAdmin()) throw new Error(`User isn't an admin.`);
          this.server.OnBackupServerState();
          break;
        case "setWhoCanPerform":
          if (!foundUser.user.IsModerator()) throw new Error(`User isn't a moderator.`);
          this.roomState.whoCanPerform = data.params.whoCanPerform;
          this.io.to(this.roomState.roomID).emit(DF.ServerMessages.ChangeRoomState, data);
          break;
      }

    } catch (e) {
      log(`OnAdminChangeRoomState exception occurred`);
      log(e);
    }
  }


  OnUserRoleOp(ws, data) {
    try {
      let caller = this.FindUserFromSocket(ws);
      if (caller == null) {
        log(`OnUserRoleOp => unknown caller`);
        return;
      }

      if (!caller.user.HasRequiredRoleToManageRole(data.role)) throw new Error(`caller doesn't have permissions to ${data.op}.`);

      let foundUser = this.roomState.FindUserByID(data.userID);
      if (!foundUser) {
        console.log(`user ${data.userID} not found but maybe they just left in the meantime. considering normal.`);
        return;
      }

      switch (data.op) {
        case "addGlobalRole": {
          foundUser.user.addGlobalRole(data.role);
          break;
        }
        case "removeGlobalRole": {
          foundUser.user.removeGlobalRole(data.role);
          // when you no longer have permission to perform, release instrument.
          const inst = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
          if (inst) {
            if (!this.roomState.UserCanPerform(foundUser.user)) {
              console.log(`Releasing instrument for user because they lost performance permissions.`);
              this.roomState.quantizer.clearUser(foundUser.user.userID);
              this.roomState.quantizer.clearInstrument(inst.instrument.instrumentID);
              inst.instrument.ReleaseOwnership();
              this.sequencerPlayer.AllNotesOff(inst.instrument);
              this.io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, { instrumentID: inst.instrument.instrumentID, userID: null, idle: false });
            }
          }
          break;
        }
        case "InstrumentRelease": {
          // find their instrument.
          let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
          if (foundInstrument == null) {
            log(`=> not controlling an instrument.`);
            return;
          }

          this.roomState.quantizer.clearUser(foundUser.user.userID);
          this.roomState.quantizer.clearInstrument(foundInstrument.instrument.instrumentID);
          foundInstrument.instrument.ReleaseOwnership();
          this.sequencerPlayer.AllNotesOff(foundInstrument.instrument);
          break;
        }
        default:
          throw new Error(`unknown user role op '${data.op}'`);
      }

      this.server.mDB.UpdateUserPersistentInfo(foundUser.user);

      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.UserRoleOp, data);

    } catch (e) {
      log(`OnUserRoleOp exception occurred`);
      log(e);
    }
  }

  // BEGIN: SEQUENCER
  OnSeqPlayStop(ws, data) {
    try {
      const foundUser = this.FindUserFromSocket(ws);
      if (!foundUser)
        throw new Error(`OnSeqPlayStop => unknown user`);

      const foundInstrument = this.roomState.FindInstrumentById(data.instrumentID);
      if (foundInstrument === null)
        throw new Error(`OnSeqPlayStop => unknown instrument ${data.instrumentID}`);

      if (!foundInstrument.instrument.CanSequencerBeStartStoppedByUser(this.roomState, foundUser.user))
        throw new Error(`OnSeqPlayStop => Instrument's sequencer cannot be controlled by this user. ${data.instrumentID}, userid ${foundUser.user.userID}`);

      foundInstrument.instrument.sequencerDevice.SetPlaying(data.isPlaying);

      // broadcast to room.
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.SeqPlayStop, {
        instrumentID: foundInstrument.instrument.instrumentID,
        isPlaying: data.isPlaying
      });

      this.sequencerPlayer.onChanged_PlayStop(foundInstrument.instrument, data);

      if (foundInstrument.instrument.controlledByUserID === foundUser.user.userID) {
        this.UnidleInstrument(foundUser.user, foundInstrument.instrument);
      }

    } catch (e) {
      console.log(`OnSeqPlayStop exception occurred`);
      console.log(e);
    }
  }


  OnSeqSetTimeSig(ws, data) {
    try {
      const foundUser = this.FindUserFromSocket(ws);
      if (!foundUser) throw new Error(`OnSeqPlayStop => unknown user`);
      const foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (!foundInstrument) throw new Error(`user not controlling an instrument.`);

      foundInstrument.instrument.sequencerDevice.livePatch.SetTimeSig(DFMusic.GetTimeSigById(data.timeSigID));

      // broadcast to room.
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.SeqSetTimeSig, {
        instrumentID: foundInstrument.instrument.instrumentID,
        timeSigID: data.timeSigID
      });

      this.sequencerPlayer.onChanged_TimeSig(foundInstrument.instrument, data);

      if (foundInstrument.instrument.controlledByUserID === foundUser.user.userID) {
        this.UnidleInstrument(foundUser.user, foundInstrument.instrument);
      }

    } catch (e) {
      console.log(`OnSeqSetTimeSig exception occurred`);
      console.log(e);
    }
  }

  SetSetNoteMuted(ws, data) {
    try {
      const foundUser = this.FindUserFromSocket(ws);
      if (!foundUser) throw new Error(`SetSetNoteMuted => unknown user`);
      const foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (!foundInstrument) throw new Error(`user not controlling an instrument.`);
      if (!DFMusic.isValidNoteValue(data.midiNoteValue)) throw new Error(`invalid midi note value sent`);

      data.isMuted = !!data.isMuted; // force bool

      foundInstrument.instrument.sequencerDevice.livePatch.SetNoteMuted(data.midiNoteValue, data.isMuted);

      // broadcast to room.
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.SetSetNoteMuted, {
        instrumentID: foundInstrument.instrument.instrumentID,
        midiNoteValue: data.midiNoteValue,
        isMuted: data.isMuted,
      });

      this.sequencerPlayer.onChanged_SetNoteMuted(foundInstrument.instrument, data);

      if (foundInstrument.instrument.controlledByUserID === foundUser.user.userID) {
        this.UnidleInstrument(foundUser.user, foundInstrument.instrument);
      }

    } catch (e) {
      console.log(`SetSetNoteMuted exception occurred`);
      console.log(e);
    }
  }

  SeqSelectPattern(ws, data) {
    try {
      const foundUser = this.FindUserFromSocket(ws);
      if (!foundUser) throw new Error(`SeqSelectPattern => unknown user`);
      const foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (!foundInstrument) throw new Error(`user not controlling an instrument.`);
      if (!Seq.IsValidSequencerPatternIndex(data.selectedPatternIdx)) throw new Error(`invalid pattern index.`);

      foundInstrument.instrument.sequencerDevice.livePatch.SelectPatternIndex(data.selectedPatternIdx);

      // broadcast to room.
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.SeqSelectPattern, {
        instrumentID: foundInstrument.instrument.instrumentID,
        selectedPatternIdx: data.selectedPatternIdx,
      });

      this.sequencerPlayer.onChanged_SelectPattern(foundInstrument.instrument, data);

      if (foundInstrument.instrument.controlledByUserID === foundUser.user.userID) {
        this.UnidleInstrument(foundUser.user, foundInstrument.instrument);
      }

    } catch (e) {
      console.log(`SeqSelectPattern exception occurred`);
      console.log(e);
    }
  }

  SeqSetSpeed(ws, data) {
    try {
      const foundUser = this.FindUserFromSocket(ws);
      if (!foundUser) throw new Error(`SeqSetSpeed => unknown user`);
      const foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (!foundInstrument) throw new Error(`user not controlling an instrument.`);
      if (!Seq.IsValidSequencerSpeed(data.speed)) throw new Error(`invalid sequencer speed.`);

      foundInstrument.instrument.sequencerDevice.livePatch.SetSpeed(data.speed);

      // broadcast to room.
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.SeqSetSpeed, {
        instrumentID: foundInstrument.instrument.instrumentID,
        speed: data.speed,
      });

      this.sequencerPlayer.onChanged_SetSpeed(foundInstrument.instrument, data);

      if (foundInstrument.instrument.controlledByUserID === foundUser.user.userID) {
        this.UnidleInstrument(foundUser.user, foundInstrument.instrument);
      }

    } catch (e) {
      console.log(`SeqSetSpeed exception occurred`);
      console.log(e);
    }
  }

  SeqSetSwing(ws, data) {
    try {
      const foundUser = this.FindUserFromSocket(ws);
      if (!foundUser) throw new Error(`SeqSetSwing => unknown user`);
      const foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (!foundInstrument) throw new Error(`user not controlling an instrument.`);
      if (!Seq.IsValidSequencerSwing(data.swing)) throw new Error(`invalid sequencer swing ${data.swing}.`);

      foundInstrument.instrument.sequencerDevice.livePatch.SetSwing(data.swing);

      // broadcast to room.
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.SeqSetSwing, {
        instrumentID: foundInstrument.instrument.instrumentID,
        swing: data.swing,
      });

      this.sequencerPlayer.onChanged_SetSwing(foundInstrument.instrument, data);

      if (foundInstrument.instrument.controlledByUserID === foundUser.user.userID) {
        this.UnidleInstrument(foundUser.user, foundInstrument.instrument);
      }

    } catch (e) {
      console.log(`SeqSetSwing exception occurred`);
      console.log(e);
    }
  }

  SeqSetDiv(ws, data) {
    try {
      const foundUser = this.FindUserFromSocket(ws);
      if (!foundUser) throw new Error(`SeqSetDiv => unknown user`);
      const foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (!foundInstrument) throw new Error(`user not controlling an instrument.`);
      if (!Seq.IsValidSequencerDivisionType(data.divisionType)) throw new Error(`invalid sequencer divisionType.`);

      foundInstrument.instrument.sequencerDevice.livePatch.SetDivisionType(data.divisionType);
      const newDivType = foundInstrument.instrument.sequencerDevice.livePatch.GetDivisionType();

      // broadcast to room.
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.SeqSetDiv, {
        instrumentID: foundInstrument.instrument.instrumentID,
        divisionType: newDivType,
      });

      this.sequencerPlayer.onChanged_Instrument(foundInstrument.instrument);

      if (foundInstrument.instrument.controlledByUserID === foundUser.user.userID) {
        this.UnidleInstrument(foundUser.user, foundInstrument.instrument);
      }

    } catch (e) {
      console.log(`SeqSetDiv exception occurred`);
      console.log(e);
    }
  }

  SeqSetOct(ws, data) {
    try {
      const foundUser = this.FindUserFromSocket(ws);
      if (!foundUser) throw new Error(`SeqSetOct => unknown user`);
      const foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (!foundInstrument) throw new Error(`user not controlling an instrument.`);
      if (!Seq.IsValidSequencerOctave(data.oct)) throw new Error(`invalid sequencer octave ${data.oct}.`);

      foundInstrument.instrument.sequencerDevice.livePatch.SetOctave(data.oct);
      const newOct = foundInstrument.instrument.sequencerDevice.livePatch.GetOctave();

      // broadcast to room.
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.SeqSetOct, {
        instrumentID: foundInstrument.instrument.instrumentID,
        oct: newOct,
      });

      this.sequencerPlayer.onChanged_Instrument(foundInstrument.instrument);

      if (foundInstrument.instrument.controlledByUserID === foundUser.user.userID) {
        this.UnidleInstrument(foundUser.user, foundInstrument.instrument);
      }

    } catch (e) {
      console.log(`SeqSetOct exception occurred`);
      console.log(e);
    }
  }

  SeqSetLength(ws, data) {
    try {
      const foundUser = this.FindUserFromSocket(ws);
      if (!foundUser) throw new Error(`SeqSetLength => unknown user`);
      const foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (!foundInstrument) throw new Error(`user not controlling an instrument.`);
      if (!Seq.IsValidSequencerLengthMajorBeats(data.lengthMajorBeats)) throw new Error(`invalid sequencer lengthMajorBeats.`);

      foundInstrument.instrument.sequencerDevice.livePatch.SetLengthMajorBeats(data.lengthMajorBeats);
      const newLen = foundInstrument.instrument.sequencerDevice.livePatch.GetLengthMajorBeats();

      // broadcast to room.
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.SeqSetLength, {
        instrumentID: foundInstrument.instrument.instrumentID,
        lengthMajorBeats: newLen,
      });

      this.sequencerPlayer.onChanged_Instrument(foundInstrument.instrument);

      if (foundInstrument.instrument.controlledByUserID === foundUser.user.userID) {
        this.UnidleInstrument(foundUser.user, foundInstrument.instrument);
      }

    } catch (e) {
      console.log(`SeqSetLength exception occurred`);
      console.log(e);
    }
  }


  SeqPatternOps(ws, data) {
    try {
      const foundUser = this.FindUserFromSocket(ws);
      if (!foundUser) throw new Error(`SeqPatternOps => unknown user`);
      const foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (!foundInstrument) throw new Error(`user not controlling an instrument.`);

      foundInstrument.instrument.sequencerDevice.livePatch.GetSelectedPattern().ProcessOps(data.ops, foundInstrument.instrument.sequencerDevice.livePatch);

      // broadcast to room.
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.SeqPatternOps, {
        instrumentID: foundInstrument.instrument.instrumentID,
        ops: data.ops,
      });

      this.sequencerPlayer.onChanged_PatternOps(foundInstrument.instrument, data);

      if (foundInstrument.instrument.controlledByUserID === foundUser.user.userID) {
        this.UnidleInstrument(foundUser.user, foundInstrument.instrument);
      }

    } catch (e) {
      console.log(`SeqPatternOps exception occurred`);
      console.log(e);
    }
  }

  SeqPatchInit(ws, data) {
    try {
      const foundUser = this.FindUserFromSocket(ws);
      if (!foundUser) throw new Error(`SeqPatchInit => unknown user`);
      const foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (!foundInstrument) throw new Error(`user not controlling an instrument.`);

      foundInstrument.instrument.sequencerDevice.InitPatch();

      // broadcast to room.
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.SeqPatchInit, {
        instrumentID: foundInstrument.instrument.instrumentID,
        presetID: foundInstrument.instrument.sequencerDevice.livePatch.presetID,
      });

      this.sequencerPlayer.onChanged_General();

      if (foundInstrument.instrument.controlledByUserID === foundUser.user.userID) {
        this.UnidleInstrument(foundUser.user, foundInstrument.instrument);
      }

    } catch (e) {
      console.log(`SeqPatchInit exception occurred`);
      console.log(e);
    }
  }

  // to save as NEW, make sure presetID is null or a newly generated ID.
  SeqPreset_Save(user, instrument, data) {
    const presetID = data.presetID ?? DFU.generateID();
    data.presetID = presetID;
    data.author = user.name;
    data.savedDate = new Date();
    const bank = this.roomState.GetSeqPresetBankForInstrument(instrument);
    bank.Save(presetID, data.author, data.savedDate, instrument.sequencerDevice.livePatch);
    return true;
  }

  SeqPreset_Load(user, instrument, data) {
    const presetID = data.presetID;
    const bank = this.roomState.GetSeqPresetBankForInstrument(instrument);
    const preset = bank.GetPresetById(presetID);
    if (!preset)
      return false;
    instrument.sequencerDevice.LoadPatch(preset);
    return true;
  }

  SeqPreset_Delete(user, instrument, data) {
    const presetID = data.presetID;
    const bank = this.roomState.GetSeqPresetBankForInstrument(instrument);
    return bank.DeletePresetById(presetID);
  }

  // user pasting some external pattern.
  // { pattern: }
  SeqPreset_PastePattern(user, instrument, data) {
    return instrument.sequencerDevice.LoadPattern(data.pattern);
  }

  // user pasting some external patch.
  // { patch: }
  SeqPreset_PastePatch(user, instrument, data) {
    return instrument.sequencerDevice.LoadPatch(data.patch);
  }

  // user pasting some external patch.
  // { bank: }
  SeqPreset_PasteBank(user, instrument, data) {
    if (!user.IsAdmin())
      return false;
    return this.roomState.GetSeqPresetBankForInstrument(instrument).ReplaceBank(data.bank);
  }

  SeqPreset_Transpose(user, instrument, data) {
    return instrument.sequencerDevice.livePatch.SetTranspose(data.transpose);
  }

  //case "SeqSetSwingBasisQuarters": // { op:"SeqSetSwingBasisQuarters", swingBasisQuarters: } // .25 or .5
  SeqPreset_SeqSetSwingBasisQuarters(user, instrument, data) {
    return instrument.sequencerDevice.livePatch.SetSwingBasisQuarters(data.swingBasisQuarters);
  }


  SeqPreset_AdjustNoteLenDivs(user, instrument, data) {
    return instrument.sequencerDevice.livePatch.SetNoteLenAdjustDivs(data.divs);
  }

  SeqPresetOp(ws, data) {
    try {
      const foundUser = this.FindUserFromSocket(ws);
      if (!foundUser) throw new Error(`SeqPresetOp => unknown user`);
      const foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (!foundInstrument) throw new Error(`user not controlling an instrument.`);

      // perform the operation; if it succeeds then forward to clients to perform themselves.
      switch (data.op) {
        case "load":
          if (!this.SeqPreset_Load(foundUser.user, foundInstrument.instrument, data)) return;
          break;
        case "save":
          if (!this.SeqPreset_Save(foundUser.user, foundInstrument.instrument, data)) return;
          break;
        case "delete":
          if (!this.SeqPreset_Delete(foundUser.user, foundInstrument.instrument, data)) return;
          break;
        case "pastePattern":
          if (!this.SeqPreset_PastePattern(foundUser.user, foundInstrument.instrument, data)) return;
          break;
        case "pastePatch":
          if (!this.SeqPreset_PastePatch(foundUser.user, foundInstrument.instrument, data)) return;
          break;
        case "pasteBank":
          if (!this.SeqPreset_PasteBank(foundUser.user, foundInstrument.instrument, data)) return;
          break;
        case "SeqSetTranspose":
          if (!this.SeqPreset_Transpose(foundUser.user, foundInstrument.instrument, data)) return;
          break;
        case "SeqAdjustNoteLenDivs":
          if (!this.SeqPreset_AdjustNoteLenDivs(foundUser.user, foundInstrument.instrument, data)) return;
          break;
        case "SeqSetSwingBasisQuarters": // { op:"SeqSetSwingBasisQuarters", swingBasisQuarters: } // .25 or .5
          if (!this.SeqPreset_SeqSetSwingBasisQuarters(foundUser.user, foundInstrument.instrument, data)) return;
          break;
        case "SeqSetBaseNote":
          foundInstrument.instrument.sequencerDevice.SetBaseNote(data.note);
          break;
        case "SeqSetArpMapping":
          foundInstrument.instrument.sequencerDevice.SetArpMapping(data.mapping);
          break;
        default:
          console.log(`client sent us a bad seq preset op ${data.op}`);
          return;
      }

      // forward to room.
      data.instrumentID = foundInstrument.instrument.instrumentID;
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.SeqPresetOp, data);

      this.sequencerPlayer.onChanged_Instrument(foundInstrument.instrument);

      if (foundInstrument.instrument.controlledByUserID === foundUser.user.userID) {
        this.UnidleInstrument(foundUser.user, foundInstrument.instrument);
      }

    } catch (e) {
      console.log(`SeqPresetOp exception occurred`);
      console.log(e);
    }
  }



  SeqMetadata(ws, data) {
    try {
      const foundUser = this.FindUserFromSocket(ws);
      if (!foundUser) throw new Error(`SeqMetadata => unknown user`);
      const foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (!foundInstrument) throw new Error(`user not controlling an instrument.`);

      if (!foundInstrument.instrument.sequencerDevice.livePatch.SetMetadata(data)) {
        console(`rejected metadata change for inst ${foundInstrument.instrument.instrumentID}`);
        return false;
      }

      data.instrumentID = foundInstrument.instrument.instrumentID;

      // broadcast to room.
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.SeqMetadata, data);

      if (foundInstrument.instrument.controlledByUserID === foundUser.user.userID) {
        this.UnidleInstrument(foundUser.user, foundInstrument.instrument);
      }

    } catch (e) {
      console.log(`SeqMetadata exception occurred`);
      console.log(e);
    }
  }


  SeqSetListeningInstrumentID(ws, data) {
    try {
      const foundUser = this.FindUserFromSocket(ws);
      if (!foundUser) throw new Error(`SeqSetListeningInstrumentID => unknown user`);

      const seqInstrument = this.roomState.FindInstrumentById(data.seqInstrumentID);
      if (!seqInstrument) throw new Error(`Sequencer device ${data.seqInstrumentID} not found.`);

      const otherInstrument = this.roomState.FindInstrumentById(data.instrumentID);
      if (!otherInstrument) throw new Error(`Instrument ${data.instrumentID} not found.`);

      if (!seqInstrument.instrument.CanUserSetSequencerListeningInstrument(this.roomState, foundUser.user)) {
        throw new Error(`user ${foundUser.user} has no permission to set the listening instrument of ${seqInstrument.instrumentID}`);
      }

      seqInstrument.instrument.sequencerDevice.listeningToInstrumentID = data.instrumentID;

      this.sequencerPlayer.onChanged_Instrument(seqInstrument.instrument);

      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.SeqSetListeningInstrumentID, data);

    } catch (e) {
      console.log(`SeqSetListeningInstrumentID exception occurred`);
      console.log(e);
    }
  }

  
  
  // END: SEQUENCER

  RoomPatchOp(ws, data) {
    try {
      const foundUser = this.FindUserFromSocket(ws);
      if (!foundUser) throw new Error(`RoomPatchOp => unknown user`);

      //console.log(`room patch op: ${JSON.stringify(data)}`);

      switch (data.op) {
        case "SetMetadata": {
          if (!this.roomState.UserCanEditRoomPatches(foundUser.user)) {
            console.log(`Rejecting room metadata edit bc permissions; for user ${foundUser.user}, data=${JSON.stringify(data)}`);
            return;
          }
          if (!this.roomState.roomPresets.SetMetadata(data.metadata)) {
            console.log(`Rejecting room metadata edit bc validation; for user ${foundUser.user}, data=${JSON.stringify(data)}`);
            return;
          }
          // forward to room. format is the same.
          this.io.to(this.roomState.roomID).emit(DF.ServerMessages.RoomPatchOp, data);
          return;
        }
        case "Paste": {
          if (!this.roomState.UserCanEditRoomPatches(foundUser.user)) {
            console.log(`Rejecting room patch paste bc permissions; for user ${foundUser.user}, data=${JSON.stringify(data)}`);
            return;
          }

          const successes = new InstSeqSelection(this.roomState);
          successes.SelectNone();

          const failures = new InstSeqSelection(this.roomState);
          failures.SelectNone();

          const roomPreset = new RoomPreset(data.data);

          const r = this.roomState.roomPresets.Paste(roomPreset,
            (instrument, presetObj) => {
              if (!this.roomState.UserCanSetRoomPatchForInstrument(foundUser.user, instrument)) {
                failures.instrumentIDs.push(instrument.instrumentID);
                return false;
              }
              this.roomState.integrateRawParamChanges(instrument, presetObj, true);
              successes.instrumentIDs.push(instrument.instrumentID);
              return true;
            },
            (instrument, seqPatch, isPlaying) => {
              if (!this.roomState.UserCanSetRoomPatchForSequencer(foundUser.user, instrument)) {
                failures.sequencerInstrumentIDs.push(instrument.instrumentID);
                return false;
              }
              instrument.sequencerDevice.LoadPatch(seqPatch);
              instrument.sequencerDevice.SetPlaying(isPlaying);
              successes.sequencerInstrumentIDs.push(instrument.instrumentID);
              return true;
            },
            (bpm) => {
              this.roomState.setBPM(bpm);
            }
            );

          // notify user of result
          ws.emit(DF.ServerMessages.RoomPresetLoadResult, {
            successes,
            failures,
          });

          // filter out anything that we rejected, before sending to clients.
          roomPreset.KeepOnlySelected(successes);
  
          this.io.to(this.roomState.roomID).emit(DF.ServerMessages.RoomPatchOp, {
            op: "Paste",
            data: roomPreset,
          });
          return;
        }
        case "Save": {
          if (!this.roomState.UserCanEditRoomPatches(foundUser.user)) {
            console.log(`Rejecting room patch save bc permissions; for user ${foundUser.user}, data=${JSON.stringify(data)}`);
            return;
          }

          let preset = this.roomState.roomPresets.SaveCompletePreset(data.data, foundUser.user);

          // forward to room. format is different this time; we only send the compact version to clients.
          this.io.to(this.roomState.roomID).emit(DF.ServerMessages.RoomPatchOp, {
            op: "Save",
            compactData: preset.ToCompactObj()
          });
          break;
        }
        case "ReadPatch": {
          const patch = this.roomState.roomPresets.GetFullPresetById(data.id);
          ws.emit(DF.ServerMessages.RoomPatchOp, {
            op: "ReadPatch",
            data: patch,
          });
          break;
        }
        case "DeletePatch": {
          if (!this.roomState.UserCanEditRoomPatches(foundUser.user)) {
            console.log(`Rejecting room patch delete bc permissions; for user ${foundUser.user}, data=${JSON.stringify(data)}`);
            return;
          }

          const r = this.roomState.roomPresets.DeletePresetByID(data.id);
          if (!r) {
            console.log(`Rejecting room patch delete bc ... it did'nt exist probably. for user ${foundUser.user}, data=${JSON.stringify(data)}`);
            return;
          }

          // forward to room. format is the same.
          this.io.to(this.roomState.roomID).emit(DF.ServerMessages.RoomPatchOp, data);
          break;
        }
      }

    } catch (e) {
      console.log(`RoomPatchOp exception occurred`);
      console.log(e);
    }
  }


  // every X seconds, this is called. here we can just do a generic push to clients and they're expected
  // to return a pong. for now used for timing, and reporting user ping.
  OnPingInterval() {
    try {
      const startMS = Date.now();
      setTimeout(() => {
        this.OnPingInterval();
      }, DF.ServerSettings.PingIntervalMS);

      if (!this.server.m7jamAPI) return; // <-- how could this happen? assuming it's here for a reason.

      this.CleanUpChatLog();

      // check users who are ghosts. i didn't bother trying to figure out why this happens but suffice it to say that I don't always get
      // the disconnect event to remove the user.
      // clients should do the same kind of cleanup: remove any users not appearing in the returned list, as if they've been disconnected.
      let deletedUsers = [];

      let knownConnectedUserIDs = new Set();
      this.io.of('/').sockets.forEach(s => {
        if (!s.DFUserID) return;
        knownConnectedUserIDs.add(s.DFUserID);
      });

      this.roomState.users.removeIf(u => {
        let socketExists = knownConnectedUserIDs.has(u.userID);

        // ONLY sevenjam native users are expected to have a websocket.
        let shouldDelete = !socketExists && u.source === DF.eUserSource.SevenJam;
        if (shouldDelete) {
          log(`PING USER CLEANUP removing userid ${u.userID}`);
          deletedUsers.push(u);
        }
        return shouldDelete;
      });

      // for the users that deleted, gracefully kill them off.
      deletedUsers.forEach(u => {
        this.ClientLeaveRoom(null, u.userID);
      });

      this.Idle_CheckIdlenessAndEmit();

      const userExistsInWorld = (userID/*, persistentID*/) => {
        // persistentID can be null
        return Object.values(this.server.mRooms).some(room => {
          if (room.roomState.FindUserByID(userID)) return true;
          //if (persistentID && room.roomState.FindUserByPersistentID(persistentID)) return true;
          return false;
        });
      };

      let expiredGraffitiIDs = [];
      const now = Date.now();
      this.roomState.graffiti.forEach(g => {
        if (g.pinned) return;
        const expired = g.expires <= now;
        const userLeft = !g.persistentID && !userExistsInWorld(g.userID);
        if (expired) {
          //console.log(`** delete graffiti ${g.id} because expired.`);
        }
        if (expired) {
          //console.log(`** delete graffiti ${g.id} because user ${g.userID} doesn't exist.`);
        }
        if (expired || userLeft) {
          expiredGraffitiIDs.push(g.id);
        }
      });

      if (expiredGraffitiIDs.length) {
        setTimeout(() => {
          //console.log(`Removing expired graffitis: ${JSON.stringify(expiredGraffitiIDs)}`);
          expiredGraffitiIDs.forEach(id => this.roomState.removeGraffiti(id));
          this.io.to(this.roomState.roomID).emit(DF.ServerMessages.GraffitiOps, expiredGraffitiIDs.map(id => ({
            op: "remove",
            id,
          })));
        }, 100);
      }

      // world population is not the sum of room population, because some users may represent identities which are in multiple rooms
      // e.g. sync'd discord users.
      const worldPopulation = this.server.m7jamAPI.GetGlobalUniqueIdentities();

      var payload = {
        token: (new Date()).toISOString(),
        worldPopulation,
        serverUptimeSec: ((new Date()) - this.server.mServerStartedDate) / 1000,
        node_env: this.server.NODE_ENV,
        rooms: [],
      };

      payload.rooms = Object.keys(this.server.mRooms).map(k => {
        let room = this.server.mRooms[k];
        return {
          roomID: room.roomState.roomID,
          isPrivate: !!room.roomState.isPrivate,
          roomName: room.roomState.roomTitle,
          users: room.roomState.users.map(u => u.ExportPing(k === this.roomState.roomID)),
          stats: room.roomState.stats
        };
      });

      // ping ALL clients on the room
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.Ping, payload);
      //log(`ping processed in ${Date.now() - startMS} ms`);
    } catch (e) {
      log(`OnPingInterval exception occurred`);
      log(e);
    }
  };

  OnClientPong(ws, data) {
    try {
      // data is the token we sent, a date iso string.
      //log(`OnClientPong data=${data}`);
      let a = new Date(data);
      let b = new Date();

      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnClientPong => unknown user`);
        return;
      }

      foundUser.user.pingMS = (b - a);
    } catch (e) {
      log(`OnClientPong exception occurred`);
      log(e);
    }
  };

  // call this to leave the socket from this room.
  ClientLeaveRoom(ws/* may be null */, userID, newRoomName) {
    try {
      // find the user object and remove it.
      let foundUser = this.roomState.FindUserByID(userID);
      if (foundUser == null) {
        // this is normal
        return;
      }

      log(`ClientLeaveRoom => ${userID} ${foundUser.user.name}`);

      // remove references to this user.
      this.roomState.instrumentCloset.forEach(inst => {
        if (inst.controlledByUserID != foundUser.user.userID) return;
        inst.ReleaseOwnership();
        this.sequencerPlayer.AllNotesOff(inst);
        // broadcast this to clients
        this.io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, { instrumentID: inst.instrumentID, userID: null, idle: false });
      });

      let chatMessageEntry = new DF.DigifuChatMessage();
      chatMessageEntry.messageID = DFU.generateID();
      chatMessageEntry.messageType = DF.ChatMessageType.part; // of ChatMessageType. "chat", "part", "join", "nick"
      chatMessageEntry.timestampUTC = new Date();
      chatMessageEntry.fromUserID = foundUser.user.userID;
      chatMessageEntry.fromUserColor = foundUser.user.color;
      chatMessageEntry.fromUserName = foundUser.user.name;
      chatMessageEntry.toRoomName = newRoomName;
      this.roomState.chatLog.push(chatMessageEntry);

      // remove user from room.
      this.roomState.users.splice(foundUser.index, 1);

      // important to put this AFTER the splice, so the new user count is correct.
      this.server.mServerStats.OnUserLeave(this.roomState, foundUser.user, this.roomState.users.filter(u => u.source === DF.eUserSource.SevenJam).length,
        ws.DFIsDoingRoomChange);

      if (ws) {
        ws.leave(this.roomState.roomID);
      }
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.UserLeave, { userID, chatMessageEntry });
    } catch (e) {
      log(`ClientLeaveRoom exception occurred`);
      log(e);
    }
  };

  UpdateExternalUser(userObj, presence, userName, color) {
      let newName = DF.sanitizeUsername(userName);
      if (newName == null) {
        log(`UpdateExternalUser: invalid username ${userName}.`);
        return;
      }
      let newColor = DF.sanitizeUserColor(color);
      if (newColor == null) {
        log(`UpdateExternalUser: invalid color ${color}.`);
        return;
      }

      userObj.SetName(userName);
      userObj.SetColor(color);
      userObj.SetPresence(presence);

      const data = {
        userID: userObj.userID,
        name: userObj.name,
        color: userObj.color,
        position: userObj.position,
        presence,
      };

      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.UserState, { state: data });
  };

  // returns the user object, or null
  AddOrUpdateExternalUser(source, presence, userName, color, persistentID) {

    let foundUser = this.roomState.FindUserByPersistentID(persistentID);
    if (foundUser) {
      return this.UpdateExternalUser(foundUser.user, presence, userName, color);
    }

    // create
    let u = new DF.DigifuUser();

    u.name = DF.sanitizeUsername(userName);
    if (u.name == null) {
      log(`AddOrUpdateExternalUser: invalid username ${userName}.`);
      return null;
    }
    u.color = DF.sanitizeUserColor(color);
    if (u.color == null) {
      log(`AddOrUpdateExternalUser: invalid color ${color}.`);
      return null;
    }

    u.userID = DFU.generateUserID();
    u.persistentID = persistentID?.toString();
    u.source = source;
    u.presence = presence;
    u.hasPersistentIdentity = false;
    u.persistentInfo = EmptyPersistentInfo();
    u.lastActivity = new Date();
    u.position = { x: this.roomState.width / 2, y: this.roomState.height / 2 };

    this.roomState.users.push(u);

    this.io.to(this.roomState.roomID).emit(DF.ServerMessages.UserEnter, { user: u });
    return u;
  };

  // call this to leave the socket from this room.
  RemoveExternalUser(persistentID) {
    // find the user object and remove it.
    let foundUser = this.roomState.FindUserByPersistentID(persistentID);
    if (foundUser == null) {
      log(`Error: Removing unknown external persistentID ${persistentID}`);
      return;
    }

    log(`RemoveExternalUser => ${persistentID} = ${foundUser.user.name}`);

    // remove references to this user.
    this.roomState.instrumentCloset.forEach(inst => {
      if (inst.controlledByUserID != foundUser.user.userID) return;
      inst.ReleaseOwnership();
      this.sequencerPlayer.AllNotesOff(inst);
      // broadcast this to clients
      this.io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, { instrumentID: inst.instrumentID, userID: null, idle: false });
    });

    // remove user from room.
    this.roomState.users.splice(foundUser.index, 1);

    this.io.to(this.roomState.roomID).emit(DF.ServerMessages.UserLeave, { userID: foundUser.user.userID });
  };


  // call this to join this socket to this room and initiate welcome.
  // called when new socket connects
  // called when user changes rooms.
  ClientJoin(ws, fromRoom, existingUserObj) {
    // NB! Client may already be connected but just joining this room.
    try {
      ws.DFexistingUserObj = existingUserObj;
      ws.join(this.roomState.roomID);
      ws.emit(DF.ServerMessages.PleaseIdentify); // ask user to identify
    } catch (e) {
      log(`OnClientConnect exception occurred`);
      log(e);
    }
  }

};
////////////////////////////////////////////////////////////////////////////////////////////////


module.exports = {
  RoomServer,
}