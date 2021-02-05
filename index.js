const express = require('express')
const { nanoid } = require("nanoid");
const app = express()
const http = require('http').Server(app);
const io = require('socket.io')(http);
const DF = require('./public/DFCommon')
const fsp = require('fs').promises;

gNanoid = nanoid;


// id-generation prefix
gIDDomain = "srv";

// populate initial room state
// https://gleitz.github.io/midi-js-soundfonts/MusyngKite/names.json

let gRooms = {}; // map roomID to RoomServer

gIsServer = true;

gAdminUserIDs = [];

let IsAdminUser = (userID) => {
  return gAdminUserIDs.some(x => x == userID);
};

let log = (msg) => {
  if (!msg) return;
  console.log(`${(new Date()).toISOString()} ${msg}`);
  if (msg.stack) {
    // assume error object.
    console.log(`EXCEPTION stack: ${msg.stack}`);
  }
};


////////////////////////////////////////////////////////////////////////////////////////////////
class RoomServer {

  constructor(data, serverStateObj) {
    // thaw into live classes
    this.roomState = DF.DigifuRoomState.FromJSONData(data);

    // do not do this stuff on the client side, because there it takes whatever the server gives. thaw() is enough there.
    let usedInstrumentIDs = [];
    this.roomState.instrumentCloset.forEach(i => {
      if (usedInstrumentIDs.some(x => x == i.instrumentID)) {
        log(`${i.name} warning: duplicate instrument ID '${i.instrumentID}' found.`);
      }
      if (!i.instrumentID) {
        log(`${i.name} warning: Instruments need a constant instrumentID.`);
        i.instrumentID = DF.generateID();
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
    const roomRestoreState = serverStateObj.find(r => r.roomID === this.roomState.roomID);
    if (roomRestoreState && roomRestoreState.dump) {
      this.roomState.adminImportRoomState(roomRestoreState.dump);
      log(`Imported room state for ${this.roomState.roomID}`);
    }

    // do factory resets
    this.roomState.instrumentCloset.forEach(i => {
      i.integrateRawParamChanges(this.roomState.GetInitPreset(i));
    });

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
  }

  adminImportRoomState(data) {
    this.roomState.adminImportRoomState(data);
  }

  // returns { user, index } or null.
  FindUserFromSocket(clientSocket) {
    return this.roomState.FindUserByID(clientSocket.id);
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
          io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, {
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
        io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, {
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
        io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, {
          instrumentID: instrument.instrumentID,
          userID: user.userID,
          idle: false
        });
      }
    } catch (e) {
      log(`UnidleInstrument exception occurred`);
      log(e);
    }
  }

  OnClientIdentify(clientSocket, clientUserSpec) {
    try {
      // the data is actually a DigifuUser object. but for security it should be copied.
      let u = new DF.DigifuUser();

      u.name = DF.sanitizeUsername(clientUserSpec.name);
      if (u.name == null) {
        clientSocket.disconnect();
        log(`OnClientIdentify: Client had invalid username ${clientUserSpec.name}; disconnecting them.`);
        return;
      }
      u.color = DF.sanitizeUserColor(clientUserSpec.color);
      if (u.color == null) {
        clientSocket.disconnect();
        log(`OnClientIdentify: Client had invalid color ${clientUserSpec.color}; disconnecting them.`);
        return;
      }

      u.userID = clientSocket.id;
      u.lastActivity = new Date();
      u.position = { x: this.roomState.width / 2, y: this.roomState.height / 2 };
      if (clientSocket.DFPosition) {
        u.position = clientSocket.DFPosition; // if you're transitioning from a previous room, we store your neew position here across the workflow.
      }
      u.img = null;

      this.roomState.users.push(u);

      let chatMessageEntry = new DF.DigifuChatMessage();
      chatMessageEntry.messageID = DF.generateID();
      chatMessageEntry.messageType = DF.ChatMessageType.join; // of ChatMessageType. "chat", "part", "join", "nick"
      chatMessageEntry.fromUserID = u.userID;
      chatMessageEntry.fromUserColor = u.color;
      chatMessageEntry.fromUserName = u.name;
      chatMessageEntry.timestampUTC = new Date();
      chatMessageEntry.fromRoomName = clientSocket.DFFromRoomName;
      this.roomState.chatLog.push(chatMessageEntry);

      //log(`${JSON.stringify(clientSocket.handshake.query)}`);

      if (clientSocket.handshake.query.DF_ADMIN_PASSWORD === process.env.DF_ADMIN_PASSWORD) {
        log(`An admin has been identified id=${u.userID} name=${u.name}.`);
        gAdminUserIDs.push(u.userID);
      } else {
        log(`Welcoming user id=${u.userID} name=${u.name}.`);
      }

      // notify this 1 user of their user id & room state
      clientSocket.emit(DF.ServerMessages.Welcome, {
        yourUserID: clientSocket.id,
        accessLevel: IsAdminUser(clientSocket.id) ? DF.AccessLevels.Admin : DF.AccessLevels.User,
        roomState: this.roomState
      });

      // broadcast user enter to all clients except the user.
      clientSocket.to(this.roomState.roomID).broadcast.emit(DF.ServerMessages.UserEnter, { user: u, chatMessageEntry });
    } catch (e) {
      log(`OnClientIdentify exception occurred`);
      log(e);
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

        // broadcast instrument change to all clients
        io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, {
          instrumentID: existingInstrument.instrument.instrumentID,
          userID: null,
          idle: false,
        });
      }

      // find the new instrument.
      let foundInstrument = this.roomState.FindInstrumentById(instrumentID);
      if (foundInstrument === null) {
        log(`instrument request for unknown instrument ${instrumentID}`);
        return;
      }

      foundInstrument.instrument.controlledByUserID = foundUser.user.userID;
      foundUser.user.idle = false;
      foundUser.user.lastActivity = new Date();

      // broadcast instrument change to all clients
      io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, {
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

      foundInstrument.instrument.ReleaseOwnership();

      // broadcast instrument change to all clients
      io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, {
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

      foundUser.user.stats.noteOns++;
      this.roomState.stats.noteOns++;

      // broadcast to all clients except foundUser
      ws.to(this.roomState.roomID).broadcast.emit(DF.ServerMessages.NoteOn, {
        userID: foundUser.user.userID,
        note: data.note,
        velocity: data.velocity
      });
    } catch (e) {
      log(`OnClientNoteOn exception occurred`);
      log(e);
    }
  };


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

      // broadcast to all clients except foundUser
      ws.to(this.roomState.roomID).broadcast.emit(DF.ServerMessages.NoteOff, {
        userID: foundUser.user.userID,
        note: note
      });
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
      // broadcast to all clients except foundUser
      ws.to(this.roomState.roomID).broadcast.emit(DF.ServerMessages.PedalUp, {
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
      // broadcast to all clients except foundUser
      ws.to(this.roomState.roomID).broadcast.emit(DF.ServerMessages.PedalDown, {
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

      //log(`OnClientInstrumentParams ${JSON.stringify(data)}`);

      let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (foundInstrument == null) {
        log(`=> not controlling an instrument.`);
        return;
      }

      // set the value.
      foundInstrument.instrument.integrateRawParamChanges(data.patchObj, data.isWholePatch);

      // broadcast to all clients except foundUser
      ws.to(this.roomState.roomID).broadcast.emit(DF.ServerMessages.InstrumentParams, {
        userID: foundUser.user.userID,
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
      foundInstrument.instrument.integrateRawParamChanges(patchObj, false);

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
      if (IsAdminUser(foundUser.user.userID)) {
        if (foundp.isReadOnly) log(`An admin user ${foundUser.user.userID} | ${foundUser.user.name} is deleting a read-only preset ${data.presetID}`);
      } else {
        if (foundp.isReadOnly) throw new Error(`don't try to delete a read-only preset.`);
      }

      // delete
      bank.presets.removeIf(p => p.presetID == data.presetID);

      // broadcast
      io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentPresetDelete, {
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
      foundInstrument.instrument.integrateRawParamChanges(initPreset, true);

      const bank = this.roomState.GetPresetBankForInstrument(foundInstrument.instrument);

      io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentFactoryReset, {
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

      io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentBankMerge, {
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
      if (!patchObj.presetID) patchObj.presetID = DF.generateID();
      patchObj.isReadOnly = false;

      // if there's an existing preset with the same ID, then overwrite. otherwise push.
      const bank = this.roomState.GetPresetBankForInstrument(foundInstrument.instrument);

      let existing = bank.presets.find(p => p.presetID == patchObj.presetID);
      if (existing) {
        if (existing.isReadOnly) {
          if (IsAdminUser(foundUser.user.userID)) {
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

      io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentPresetSave, {
        instrumentID: foundInstrument.instrument.instrumentID,
        patchObj,
      });

    } catch (e) {
      log(`OnClientInstrumentPresetSave exception occurred`);
      log(e);
    }
  }



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

      // "TO" user?
      let foundToUser = this.roomState.FindUserByID(msg.toUserID);

      let nm = new DF.DigifuChatMessage();
      nm.messageID = DF.generateID();
      nm.messageType = DF.ChatMessageType.chat; // of ChatMessageType. "chat", "part", "join", "nick"
      nm.message = msg.message;
      nm.fromUserID = foundUser.user.userID;
      nm.fromUserColor = foundUser.user.color;
      nm.fromUserName = foundUser.user.name;
      nm.timestampUTC = new Date();
      if (foundToUser != null) {
        nm.toUserID = foundToUser.user.userID;
        nm.toUserColor = foundToUser.user.color;
        nm.toUserName = foundToUser.user.name;
        return;
      }

      foundUser.user.stats.messages++;
      this.roomState.stats.messages++;

      this.roomState.chatLog.push(nm);

      // broadcast to all clients. even though it can feel more responsive and effiicent for the sender to just handle their own,
      // this allows simpler handling of incorporating the messageID.
      io.to(this.roomState.roomID).emit(DF.ServerMessages.UserChatMessage, nm);
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
    let newRoom = gRooms[params.roomID];
    //log(`ROOM CHANGE => ${params.roomID} user ${user.name}`);
    // send user part to everyone else in old room
    this.ClientLeaveRoom(ws, user.userID, newRoom.roomState.roomTitle);
    // enter the new room
    ws.DFPosition = {
      x: params.x,
      y: params.y
    };
    newRoom.ClientJoin(ws, this.roomState.roomTitle);
  }

  DoUserItemInteraction(ws, user, item, interactionType) {
    let interactionSpec = item[interactionType];
    if (!interactionSpec) {
      //log(`Item ${item.itemID} has no interaction type ${interactionType}`);
      return;
    }
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
        nm.messageID = DF.generateID();
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

      foundUser.user.name = data.name;
      foundUser.user.color = data.color;

      foundUser.user.img = data.img;
      foundUser.user.position.x = data.position.x;
      foundUser.user.position.y = data.position.y;

      data.userID = foundUser.user.userID; // adapt the data packet for sending to all clients.

      io.to(this.roomState.roomID).emit(DF.ServerMessages.UserState, { state: data, chatMessageEntry: nm });

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

  // text, x, y
  OnClientCheer(ws, data) {
    //log(`OnClientCheer => ${JSON.stringify(data)} ${data.text.length}`);
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnClientCheer => unknown user`);
        return;
      }

      let txt = DF.sanitizeCheerText(data.text);
      if (txt == null) {
        log(`OnClientCheer: invalid cheer ${data.text}.`);
        return;
      }

      foundUser.user.stats.cheers++;
      this.roomState.stats.cheers++;

      io.to(this.roomState.roomID).emit(DF.ServerMessages.Cheer, { userID: foundUser.user.userID, text: txt, x: data.x, y: data.y });
    } catch (e) {
      log(`OnClientCheer exception occurred`);
      log(e);
    }
  }

  OnAdminChangeRoomState(ws, data) {
    try {
      if (!IsAdminUser(ws.id)) throw new Error(`User isn't an admin.`);

      switch (data.cmd) {
        case "setAnnouncementHTML":
          this.roomState.announcementHTML = data.params;
          io.to(this.roomState.roomID).emit(DF.ServerMessages.ChangeRoomState, data);
          break;
        case "setRoomImg":
          this.roomState.img = data.params;
          io.to(this.roomState.roomID).emit(DF.ServerMessages.ChangeRoomState, data);
          break;
      }

    } catch (e) {
      log(`OnAdminChangeRoomState exception occurred`);
      log(e);
    }
  }

  // every X seconds, this is called. here we can just do a generic push to clients and they're expected
  // to return a pong. for now used for timing, and reporting user ping.
  OnPingInterval() {
    try {
      setTimeout(() => {
        this.OnPingInterval();
      }, DF.ServerSettings.PingIntervalMS);

      this.CleanUpChatLog();

      // check users who are ghosts. i didn't bother trying to figure out why this happens but suffice it to say that I don't always get
      // the disconnect event to remove the user.
      // clients should do the same kind of cleanup: remove any users not appearing in the returned list, as if they've been disconnected.
      let deletedUsers = [];
      this.roomState.users.removeIf(u => {
        let ws = io.of('/').sockets.get(u.userID);
        let shouldDelete = !ws;
        if (shouldDelete) {
          log(`PING USER CLEANUP removing userid ${u.userID}`);
          deletedUsers.push(u);
        }
        return shouldDelete;
      });

      // for the users that deleted, gracefully kill them off.
      deletedUsers.forEach(u => { this.ClientLeaveRoom(null, u.userID) });

      this.Idle_CheckIdlenessAndEmit();

      // token, rooms: [{roomID, roomName, users [{ userid, name, pingMS }], stats}]
      var payload = {
        token: (new Date()).toISOString(),
        rooms: [],
      };
      payload.rooms = Object.keys(gRooms).map(k => {
        let room = gRooms[k];
        return {
          roomID: room.roomState.roomID,
          roomName: room.roomState.roomTitle,
          users: room.roomState.users.map(u => { return { userID: u.userID, name: u.name, color: u.color, pingMS: u.pingMS }; }),
          stats: room.roomState.stats
        };
      });

      // ping ALL clients on the room
      io.to(this.roomState.roomID).emit(DF.ServerMessages.Ping, payload);
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

      log(`ClientLeaveRoom => ${userID} ${foundUser.user.name} after ${foundUser.user.stats.noteOns++} notes and ${foundUser.user.stats.messages} msgs`);

      // remove references to this user.
      this.roomState.instrumentCloset.forEach(inst => {
        if (inst.controlledByUserID != foundUser.user.userID) return;
        inst.ReleaseOwnership();
        // broadcast this to clients
        io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, { instrumentID: inst.instrumentID, userID: null, idle: false });
      });

      let chatMessageEntry = new DF.DigifuChatMessage();
      chatMessageEntry.messageID = DF.generateID();
      chatMessageEntry.messageType = DF.ChatMessageType.part; // of ChatMessageType. "chat", "part", "join", "nick"
      chatMessageEntry.timestampUTC = new Date();
      chatMessageEntry.fromUserID = foundUser.user.userID;
      chatMessageEntry.fromUserColor = foundUser.user.color;
      chatMessageEntry.fromUserName = foundUser.user.name;
      chatMessageEntry.toRoomName = newRoomName;
      this.roomState.chatLog.push(chatMessageEntry);

      // remove user from room.
      this.roomState.users.splice(foundUser.index, 1);

      if (ws) {
        ws.leave(this.roomState.roomID);
      }
      io.to(this.roomState.roomID).emit(DF.ServerMessages.UserLeave, { userID, chatMessageEntry });
    } catch (e) {
      log(`ClientLeaveRoom exception occurred`);
      log(e);
    }
  };

  // call this to join this socket to this room and initiate welcome.
  ClientJoin(ws, fromRoomName) {
    // NB! Client may already be connected but just joining this room.
    try {
      //log(`CLIENT JOINING ${this.roomState.roomID}`);
      ws.DFFromRoomName = fromRoomName; // convenience so you can persist through the room change workflow.
      ws.join(this.roomState.roomID);
      ws.emit(DF.ServerMessages.PleaseIdentify); // ask user to identify
    } catch (e) {
      log(`OnClientConnect exception occurred`);
      log(e);
    }
  }

};
////////////////////////////////////////////////////////////////////////////////////////////////

let ForwardToRoom = function (ws, fn) {
  let roomArray = [...ws.rooms];
  //log(`ROOMS=${roomArray} FN=${fn.toString()}`);
  fn(gRooms[roomArray[1]]); // room[0] is always your socket id.
};

let OnDisconnect = function (ws) {
  // remove from all rooms.
  Object.keys(gRooms).forEach(roomID => {
    gRooms[roomID].ClientLeaveRoom(ws, ws.id);
  });
};


let OnClientDownloadServerState = (ws) => {
  try {
    if (!IsAdminUser(ws.id)) throw new Error(`User isn't an admin.`);

    // the server state dump is really just everything except users.
    let allRooms = [];
    Object.keys(gRooms).forEach(roomID => {
      allRooms.push({
        roomID: roomID,
        dump: gRooms[roomID].roomState.adminExportRoomState()
      });
    });
    ws.emit(DF.ServerMessages.ServerStateDump, allRooms);

  } catch (e) {
    log(`OnClientDownloadServerState exception occurred`);
    log(e);
  }
}


let OnClientUploadServerState = (ws, data) => {
  try {
    if (!IsAdminUser(ws.id)) throw new Error(`User isn't an admin.`);

    log(`uploaded server state with len=${JSON.stringify(data).length}`);
    data.forEach(rs => {
      if (!rs.roomID) throw new Error(`no room ID. maybe you're importing some bad format?`);
      let room = gRooms[rs.roomID];//.find(r => r.roomState.roomID == rs.roomID);
      if (!room) throw new Error(`unable to find a room during import. odd.`);
      room.adminImportRoomState(rs.dump);
    });

    io.of('/').sockets.forEach(ws => {
      ws.emit(DF.ServerMessages.PleaseReconnect); // much safer to just force them out.
      // tell client to rejoin the room.
      // let roomID = Object.keys(gRooms).find(roomID => {
      //   let foundUser = gRooms[roomID].FindUserFromSocket(ws);
      //   return !!foundUser;
      // });
      // if (roomID) {
      //   log(`Re-welcoming user with id ${ws.id} to ${roomState.roomTitle}`);
      //   //newRoom.ClientJoin(ws, gRooms[roomID].roomState.roomTitle);
      // }

    });

  } catch (e) {
    log(`OnClientUploadServerState exception occurred`);
    log(e);
  }
}




// load configs
let roomsAreLoaded = function () {
  // serve the rooms
  io.on('connection', ws => {
    try {
      let worldUserCount = 0;
      Object.keys(gRooms).forEach(k => {
        worldUserCount += gRooms[k].roomState.users.length;
      });
      if (worldUserCount >= DF.ServerSettings.WorldUserCountMaximum) {
        ws.disconnect();
        return;
      }
      let requestedRoomID = DF.routeToRoomID(ws.handshake.query["jamroom"]);
      let room = gRooms[requestedRoomID];
      if (!room) {
        throw new Error(`user trying to connect to nonexistent roomID ${requestedRoomID}`);
      }

      ws.on('disconnect', data => OnDisconnect(ws, data));
      ws.on(DF.ClientMessages.Identify, data => ForwardToRoom(ws, room => room.OnClientIdentify(ws, data)));
      ws.on(DF.ClientMessages.InstrumentRequest, data => ForwardToRoom(ws, room => room.OnClientInstrumentRequest(ws, data)));
      ws.on(DF.ClientMessages.InstrumentRelease, () => ForwardToRoom(ws, room => room.OnClientInstrumentRelease(ws)));
      ws.on(DF.ClientMessages.NoteOn, data => ForwardToRoom(ws, room => room.OnClientNoteOn(ws, data)));
      ws.on(DF.ClientMessages.NoteOff, data => ForwardToRoom(ws, room => room.OnClientNoteOff(ws, data)));
      ws.on(DF.ClientMessages.AllNotesOff, data => ForwardToRoom(ws, room => room.OnClientAllNotesOff(ws, data)));
      ws.on(DF.ClientMessages.PedalDown, data => ForwardToRoom(ws, room => room.OnClientPedalDown(ws, data)));
      ws.on(DF.ClientMessages.PedalUp, data => ForwardToRoom(ws, room => room.OnClientPedalUp(ws, data)));
      ws.on(DF.ClientMessages.InstrumentParams, data => ForwardToRoom(ws, room => room.OnClientInstrumentParams(ws, data)));
      ws.on(DF.ClientMessages.CreateParamMapping, data => ForwardToRoom(ws, room => room.OnClientCreateParamMapping(ws, data)));
      ws.on(DF.ClientMessages.RemoveParamMapping, data => ForwardToRoom(ws, room => room.OnClientRemoveParamMapping(ws, data)));

      ws.on(DF.ClientMessages.InstrumentPresetDelete, data => ForwardToRoom(ws, room => room.OnClientInstrumentPresetDelete(ws, data)));
      ws.on(DF.ClientMessages.InstrumentFactoryReset, data => ForwardToRoom(ws, room => room.OnClientInstrumentFactoryReset(ws, data)));
      ws.on(DF.ClientMessages.InstrumentPresetSave, data => ForwardToRoom(ws, room => room.OnClientInstrumentPresetSave(ws, data)));
      ws.on(DF.ClientMessages.InstrumentBankMerge, data => ForwardToRoom(ws, room => room.OnClientInstrumentBankMerge(ws, data)));

      ws.on(DF.ClientMessages.ChatMessage, data => ForwardToRoom(ws, room => room.OnClientChatMessage(ws, data)));
      ws.on(DF.ClientMessages.Pong, data => ForwardToRoom(ws, room => room.OnClientPong(ws, data)));
      ws.on(DF.ClientMessages.UserState, data => ForwardToRoom(ws, room => room.OnClientUserState(ws, data)));
      ws.on(DF.ClientMessages.Cheer, data => ForwardToRoom(ws, room => room.OnClientCheer(ws, data)));

      ws.on(DF.ClientMessages.AdminChangeRoomState, data => ForwardToRoom(ws, room => room.OnAdminChangeRoomState(ws, data)));

      ws.on(DF.ClientMessages.DownloadServerState, data => OnClientDownloadServerState(ws, data));
      ws.on(DF.ClientMessages.UploadServerState, data => OnClientUploadServerState(ws, data));

      room.ClientJoin(ws);

    } catch (e) {
      log("Exception on connection: " + e);
    }
  });

  let port = process.env.PORT || 8081;
  http.listen(port, () => {
    log(`listening on *:${port}`);
  });
};

let loadRoom = function (jsonTxt, serverRestoreState) {
  roomState = JSON.parse(jsonTxt);
  gRooms[roomState.roomID] = new RoomServer(roomState, serverRestoreState);
  log(`serving room ${roomState.roomID} on route ${roomState.route}`);
  app.use(roomState.route, express.static('public'));
}



fsp.readFile("global_instruments.json")
  .then(globalInstruments => {
    DF.SetGlobalInstrumentList(JSON.parse(globalInstruments).globalInstruments);
    fsp.readFile("server_state.json")
      .then(serverRestoreState => {
        serverRestoreState = JSON.parse(serverRestoreState);
        fsp.readFile("pub.json")
          .then(data2 => loadRoom(data2, serverRestoreState))
          .then(() => fsp.readFile("maj7.json"))
          .then(data3 => loadRoom(data3, serverRestoreState))
          .then(() => fsp.readFile("hall.json"))
          .then(data4 => loadRoom(data4, serverRestoreState))
          .then(() => roomsAreLoaded());
      });
  });
