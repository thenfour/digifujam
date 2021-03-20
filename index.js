const express = require('express')
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const { nanoid } = require("nanoid");
const DF = require('./clientsrc/DFCommon');
const fs = require('fs');
const fsp = fs.promises;
const DFStats = require('./DFStats.js');
const serveIndex = require('serve-index')
const { google } = require('googleapis');
const DFDB = require('./DFDB');

let oldConsoleLog = console.log;
let log = (msg) => {
  if (!msg) return;
  oldConsoleLog(`${(new Date()).toISOString()} ${msg}`);
  if (msg.stack) {
    // assume error object.
    oldConsoleLog(`EXCEPTION stack: ${msg.stack}`);
  }
};
console.log = log;

gServerStartedDate = new Date();

gNanoid = nanoid;

gStoragePath = 'C:\\root\\Dropbox\\root\\Digifujam\\storage'; // todo: configure this kind of stuff in ENV at least...
gStatsDBPath = gStoragePath + '\\DFStatsDB.json';
gPathSeparator = "\\";
gGoogleRedirectURL = "http://localhost:8081";
if (process.env.DF_IS_OPENODE == 1) {
  gPathSeparator = "/";
  gStoragePath = '/var/www/storage';
  gStatsDBPath = gStoragePath + '/DFStatsDB.json';
  gGoogleRedirectURL = "https://7jam.io";
}
app.use("/DFStatsDB.json", express.static(gStatsDBPath));
const gPathLatestServerState = `${gStoragePath}${gPathSeparator}serverState_latest.json`;

let gServerStats = null;

let gDB = null;// new DFDB.DFDB();

// ----------------------------------------------------------------------------------------------------------------
// BEGIN: google login stuff...
const gHasGoogleAPI = () => process.env.DF_GOOGLE_CLIENT_ID && process.env.DF_GOOGLE_CLIENT_SECRET;
//const gHasGoogleAPI = () => false;

if (!gHasGoogleAPI()) {
  console.log(`DF_GOOGLE_CLIENT_ID or DF_GOOGLE_CLIENT_SECRET are not set; google login will not be available.`);
} else {
  console.log(`Google auth enabled with client ID ${process.env.DF_GOOGLE_CLIENT_ID}`);
}

// here's an endpoint you can call to get a URL for logging in with google.
app.get('/google_auth_url', (req, res) => {
  try {
    if (!gHasGoogleAPI()) {
      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify({ url: null }));
      return;
    }
    const oauth2Client = new google.auth.OAuth2(
      process.env.DF_GOOGLE_CLIENT_ID,
      process.env.DF_GOOGLE_CLIENT_SECRET,
      gGoogleRedirectURL
    );

    const scopes = [
      'https://www.googleapis.com/auth/userinfo.email',
    ];

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: scopes,
    });

    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({ url }));
  } catch (e) {
    console.log(`Exception in /google_auth_url`);
    console.log(e);
  }
});


app.get('/google_complete_authentication', (req, res) => {
  try {
    //console.log(`/google_complete_authentication invoked with code ${req.query.code}`);
    const code = req.query.code;
    const oauth2Client = new google.auth.OAuth2(
      process.env.DF_GOOGLE_CLIENT_ID,
      process.env.DF_GOOGLE_CLIENT_SECRET,
      gGoogleRedirectURL
    );

    oauth2Client.getToken(code).then(function (tokens) {
      //console.log(`  => tokens retrieved: ${JSON.stringify(tokens)}`);
      //console.log(`  => access token: ${tokens.tokens.access_token}`);
      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify({ google_access_token: tokens.tokens.access_token }));
    });
  } catch (e) {
    console.log(`Exception in /google_complete_authentication`);
    console.log(e);
  }
});
// END: google login stuff ----------------------------------------------------------------------------------------------------------------

// populate initial room state
// https://gleitz.github.io/midi-js-soundfonts/MusyngKite/names.json

let gRooms = {}; // map roomID to RoomServer


////////////////////////////////////////////////////////////////////////////////////////////////
// convert a db model DFUser to a struct usable in DigifuUser.persistentInfo
// see models/DFUser.js for the src format
const DFUserToPersistentInfo = (doc, followersCount) => {
  return {
    global_roles: doc.global_roles,
    bands: doc.bands,
    room_roles: doc.room_roles,
    stats: doc.stats,
    followingUsersCount: doc.following_users.length,
    followersCount,
  };
};
const EmptyDFUserToPersistentInfo = () => {
  return {
    global_roles: [],
    bands: [],
    room_roles: [],
    stats: DF.DigifuUser.emptyStatsObj(),
    followingUsersCount: 0,
    followersCount: 0,
  };
};


////////////////////////////////////////////////////////////////////////////////////////////////
class RoomServer {

  constructor(data, serverStateObj) {
    // thaw into live classes
    this.roomState = DF.DigifuRoomState.FromJSONData(data, (url) => JSON.parse(fs.readFileSync(url)));

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

    // set routines for metronome / quantization events
    this.roomState.metronome.setBeatRoutine(() => { this.OnRoomBeat(); });
    this.roomState.quantizer.setNoteEventsRoutine((noteOns, noteOffs) => { this.FlushQuantizedNoteEvents(noteOns, noteOffs); });
  }

  adminImportRoomState(data) {
    this.roomState.adminImportRoomState(data);
  }

  // returns { user, index } or null.
  FindUserFromSocket(clientSocket) {
    if (!clientSocket.DFUserID) {
      throw new Error(`Socket ${clientSocket.id} has no DFUserID`);
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

      // handler
      const rejectUserEntry = () => {
        try {
          clientSocket.emit(DF.ServerMessages.PleaseReconnect);
        } catch (e) {
          log(`rejectUserEntry exception occurred`);
          log(e);
        }
      };

      // handler
      const completeUserEntry = (userID, hasPersistentIdentity, persistentInfo) => {
        u.userID = userID.toString(); // this could be a mongo Objectid
        u.hasPersistentIdentity = hasPersistentIdentity;
        clientSocket.DFUserID = userID;
        console.log(`Setting DFUserID for socket ${clientSocket.id} to ${userID}`);
        u.persistentInfo = persistentInfo;
        u.lastActivity = new Date();
        u.position = { x: this.roomState.width / 2, y: this.roomState.height / 2 };
        if (clientSocket.DFPosition) {
          u.position = clientSocket.DFPosition; // if you're transitioning from a previous room, we store your neew position here across the workflow.
        }
        u.img = null;

        if (clientSocket.handshake.query.DF_ADMIN_PASSWORD === process.env.DF_ADMIN_PASSWORD) {
          log(`An admin has been identified id=${u.userID} name=${u.name}.`);
          u.addGlobalRole("sysadmin");
        } else {
          log(`Welcoming user id=${u.userID} name=${u.name}, persistentInfo:${JSON.stringify(persistentInfo)}`);
        }

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

        gServerStats.OnUserWelcome(this.roomState.roomID, u, this.roomState.users.length);

        // notify this 1 user of their user id & room state
        clientSocket.emit(DF.ServerMessages.Welcome, {
          yourUserID: userID,
          roomState: JSON.parse(this.roomState.asJSON()) // filter out stuff that shouldn't be sent to clients
        });

        // broadcast user enter to all clients except the user.
        clientSocket.to(this.roomState.roomID).broadcast.emit(DF.ServerMessages.UserEnter, { user: u, chatMessageEntry });
      }; // completeUserEntry

      const token = clientSocket.handshake.query.google_access_token;
      if (token) {
        // use google auth token to get a google user id.
        var oaclient = new google.auth.OAuth2();
        oaclient.setCredentials({ access_token: token });
        var googleUser = google.oauth2({
          auth: oaclient,
          version: 'v2'
        });

        googleUser.userinfo.get(
          (err, res) => {
            if (err) {
              console.log(`google_access_token validation failed for token ${token}`);
              console.log(JSON.stringify(err.errors));
              rejectUserEntry();
            } else {
              // <email scope>
              //     "id": "1234567789345783495",
              //     "email": "email@something.com",
              //     "verified_email": true,
              gDB.GetOrCreateGoogleUser(u.name, u.color, res.data.id).then(userDoc => {
                gDB.GetFollowerCount(userDoc._id).then(followersCount => {
                  //console.log(`OK i have this user doc: ${JSON.stringify(userDoc, null, 2)}`);
                  completeUserEntry(userDoc._id, true, DFUserToPersistentInfo(userDoc, followersCount));
                });
              });
            }
          });
      } else { // token.
        completeUserEntry("guest_" + DF.generateID(), false, EmptyDFUserToPersistentInfo());
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

      this.roomState.quantizer.clearUser(foundUser.user.userID);
      this.roomState.quantizer.clearInstrument(foundInstrument.instrument.instrumentID);

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

      this.roomState.quantizer.clearUser(foundUser.user.userID);
      this.roomState.quantizer.clearInstrument(foundInstrument.instrument.instrumentID);

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

      foundUser.user.persistentInfo.stats.noteOns++;
      gServerStats.OnNoteOn(this.roomState.roomID, foundUser.user);
      this.roomState.stats.noteOns++;

      // broadcast to all clients except foundUser
      if (data.resetBeatPhase) {
        this.roomState.metronome.resetBeatPhase();
      }
      this.roomState.quantizer.onLiveNoteOn(foundUser.user.userID, foundUser.user.pingMS, foundInstrument.instrument.instrumentID, data.note, data.velocity, foundUser.user.quantizeBeatDivision);
    } catch (e) {
      log(`OnClientNoteOn exception occurred`);
      log(e);
    }
  };

  FlushQuantizedNoteEvents(noteOns, noteOffs) {
    try {
      // broadcast to all clients
      io.to(this.roomState.roomID).emit(DF.ServerMessages.NoteEvents, {
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

      // broadcast to all clients except foundUser
      this.roomState.quantizer.onLiveNoteOff(foundUser.user.userID, foundUser.user.pingMS, foundInstrument.instrument.instrumentID, note, foundUser.user.quantizeBeatDivision);
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
      io.to(this.roomState.roomID).emit(DF.ServerMessages.PedalUp, {
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
      // broadcast to all clients
      io.to(this.roomState.roomID).emit(DF.ServerMessages.PedalDown, {
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

      // set the value.
      foundInstrument.instrument.integrateRawParamChanges(data.patchObj, data.isWholePatch);
      gServerStats.OnParamChange(this.roomState.roomID, foundUser.user, Object.keys(data.patchObj).length);

      // broadcast to all clients
      io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentParams, {
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
      if (foundUser.user.IsAdmin()) {
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

      gServerStats.OnPresetSave(this.roomState.roomID, foundUser.user);

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

      gServerStats.OnMessage(this.roomState.roomID, foundUser.user);
      foundUser.user.persistentInfo.stats.messages++;
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

  OnClientQuantization(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnClientQuantization => unknown user`);
        return;
      }

      this.roomState.quantizer.clearUser(foundUser.user.userID);

      foundUser.user.quantizeBeatDivision = data.beatDivision;
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

      gServerStats.OnCheer(this.roomState.roomID, foundUser.user);
      foundUser.user.persistentInfo.stats.cheers++;
      this.roomState.stats.cheers++;

      io.to(this.roomState.roomID).emit(DF.ServerMessages.Cheer, { userID: foundUser.user.userID, text: txt, x: data.x, y: data.y });
    } catch (e) {
      log(`OnClientCheer exception occurred`);
      log(e);
    }
  }

  // bpm
  OnClientRoomBPMUpdate(ws, data) {
    this.roomState.setBPM(data.bpm);
    io.to(this.roomState.roomID).emit(DF.ServerMessages.RoomBPMUpdate, { bpm: data.bpm }); //update bpm for ALL clients
  }

  OnClientAdjustBeatPhase(ws, data) {
    this.roomState.metronome.AdjustPhase(data.relativeMS);
  }

  // called per every beat, BPM is defined in roomState
  OnRoomBeat() {
    try {
      io.to(this.roomState.roomID).emit(DF.ServerMessages.RoomBeat, { bpm: this.roomState.metronome.getBPM() }); //send bpm in order to synchronize
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

      if (!foundUser.user.IsAdmin()) throw new Error(`User isn't an admin.`);

      switch (data.cmd) {
        case "setAnnouncementHTML":
          this.roomState.announcementHTML = data.params;
          io.to(this.roomState.roomID).emit(DF.ServerMessages.ChangeRoomState, data);
          break;
        case "setRoomImg":
          this.roomState.img = data.params;
          io.to(this.roomState.roomID).emit(DF.ServerMessages.ChangeRoomState, data);
          break;
        case "backupServerState":
          OnBackupServerState();
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

      let knownConnectedUserIDs = [];
      io.of('/').sockets.forEach(s => {
        if (!s.DFUserID) return;
        knownConnectedUserIDs.push(s.DFUserID);
      });

      this.roomState.users.removeIf(u => {
        let socketExists = knownConnectedUserIDs.some(id => id == u.userID);

        let shouldDelete = !socketExists;
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
        serverUptimeSec: ((new Date()) - gServerStartedDate) / 1000,
        rooms: [],
      };
      payload.rooms = Object.keys(gRooms).map(k => {
        let room = gRooms[k];
        return {
          roomID: room.roomState.roomID,
          isPrivate: !!room.roomState.isPrivate,
          roomName: room.roomState.roomTitle,
          users: room.roomState.users,//.map(u => { return { userID: u.userID, name: u.name, color: u.color, pingMS: u.pingMS }; }),
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

      log(`ClientLeaveRoom => ${userID} ${foundUser.user.name}`);

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
    if (!ws.DFUserID) {
      console.log(`! OnDisconnect / websocket doesn't have a user ID.`);
    }
    gRooms[roomID].ClientLeaveRoom(ws, ws.DFUserID);
  });
};

let gFindUserFromSocket = (ws) => {
  let ret = null;
  Object.values(gRooms).find(room => {
    let u = room.FindUserFromSocket(ws);
    if (u) {
      ret = u.user;
      return true;
    }
    return false;
  });
  return ret;
};


let OnClientDownloadServerState = (ws) => {
  try {
    let foundUser = gFindUserFromSocket(ws);
    if (foundUser == null) {
      log(`OnClientDownloadServerState => unknown user`);
      return;
    }

    if (!foundUser.IsAdmin()) throw new Error(`User isn't an admin.`);

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
    let foundUser = gFindUserFromSocket(ws);
    if (foundUser == null) {
      log(`OnClientUploadServerState => unknown user`);
      return;
    }

    if (!foundUser.IsAdmin()) throw new Error(`User isn't an admin.`);

    log(`uploaded server state with len=${JSON.stringify(data).length}`);
    data.forEach(rs => {
      if (!rs.roomID) throw new Error(`no room ID. maybe you're importing some bad format?`);
      let room = gRooms[rs.roomID];//.find(r => r.roomState.roomID == rs.roomID);
      if (!room) throw new Error(`unable to find a room during import. odd.`);
      room.adminImportRoomState(rs.dump);
    });

    io.of('/').sockets.forEach(ws => {
      ws.emit(DF.ServerMessages.PleaseReconnect);
    });

  } catch (e) {
    log(`OnClientUploadServerState exception occurred`);
    log(e);
  }
}

let OnBackupServerState = () => {
  try {
    const m1 = new Date();
    let allRooms = [];
    Object.keys(gRooms).forEach(roomID => {
      allRooms.push({
        roomID: roomID,
        dump: gRooms[roomID].roomState.adminExportRoomState()
      });
    });

    const allRoomsJSON = JSON.stringify(allRooms);

    const d = new Date();
    const path = `${gStoragePath}${gPathSeparator}serverState_` +
      `${d.getUTCFullYear()}${(d.getUTCMonth() + 1).toString().padStart(2, '0')}${d.getUTCDate().toString().padStart(2, '0')}` +
      `_${d.getUTCHours().toString().padStart(2, '0')}_${d.getUTCMinutes().toString().padStart(2, '0')}_${d.getUTCSeconds().toString().padStart(2, '0')}.json`;

    fsp.writeFile(path, allRoomsJSON, 'utf8');
    fsp.writeFile(gPathLatestServerState, allRoomsJSON, 'utf8');
    console.log(`Backing up server state to ${path}; took ${((new Date() - m1) / 1000).toFixed(3)} sec`);
  } catch (e) {
    console.log(`OnBackupServerState exception occurred`);
    console.log(e);
  }
};

let OnBackupServerStateInterval = () => {
  setTimeout(OnBackupServerStateInterval, DF.ServerSettings.ServerStateBackupIntervalMS);
  OnBackupServerState();
};


let OnPruneServerStateInterval = () => {
  try {
    setTimeout(OnPruneServerStateInterval, DF.ServerSettings.ServerStatePruneIntervalMS);

    let filesToDelete = [];
    fs.readdir(gStoragePath, (err, files) => {
      const m1 = new Date();
      files.forEach(file => {
        try {
          // serverState_20210207_16_59_06.json        
          if (!file.startsWith("serverState_")) return;
          let fileParts = file.split('.')[0]; // remove extension
          fileParts = fileParts.split("_");
          // 2019-01-06T14:00:00.000Z
          let fileDate = `${fileParts[1].substring(0, 4)}-${fileParts[1].substring(4, 6)}-${fileParts[1].substring(6)}T${fileParts[2]}:${fileParts[3]}:${fileParts[4]}.000Z`;
          let age = m1 - new Date(fileDate);

          if (age > DF.ServerSettings.ServerStateMaxAgeMS) {
            //console.log(`${file} age ${age} maxage=${DF.ServerSettings.ServerStateMaxAgeMS} file=${gStoragePath + gPathSeparator + file}`);
            filesToDelete.push(gStoragePath + gPathSeparator + file);
          }

        } catch (ex) {
          console.log(`OnPruneServerStateInterval; file caused exception: ${file}`);
          console.log(ex);
        }
      });

      console.log(`OnPruneServerStateInterval; filesToDelete: ${JSON.stringify(filesToDelete)}`);

      filesToDelete.forEach(f => fs.unlink(f, () => { }));
      //console.log(`OnPruneServerStateInterval; took ${((new Date() - m1) / 1000).toFixed(3)} sec`);
    });

  } catch (e) {
    console.log(`OnPruneServerStateInterval exception occurred`);
    console.log(e);
  }
};


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
      ws.on(DF.ClientMessages.Quantization, data => ForwardToRoom(ws, room => room.OnClientQuantization(ws, data)));
      ws.on(DF.ClientMessages.Cheer, data => ForwardToRoom(ws, room => room.OnClientCheer(ws, data)));
      ws.on(DF.ClientMessages.RoomBPMUpdate, data => ForwardToRoom(ws, room => room.OnClientRoomBPMUpdate(ws, data)));
      ws.on(DF.ClientMessages.AdjustBeatPhase, data => ForwardToRoom(ws, room => room.OnClientAdjustBeatPhase(ws, data)));
      

      ws.on(DF.ClientMessages.AdminChangeRoomState, data => ForwardToRoom(ws, room => room.OnAdminChangeRoomState(ws, data)));

      ws.on(DF.ClientMessages.DownloadServerState, data => OnClientDownloadServerState(ws, data));
      ws.on(DF.ClientMessages.UploadServerState, data => OnClientUploadServerState(ws, data));

      room.ClientJoin(ws);

    } catch (e) {
      log("Exception on connection: " + e);
    }
  }); // io.on(connection)

  setTimeout(OnBackupServerStateInterval, DF.ServerSettings.ServerStateBackupIntervalMS);

  setTimeout(OnPruneServerStateInterval, DF.ServerSettings.ServerStatePruneIntervalMS);

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



app.use("/storage", express.static(gStoragePath), serveIndex(gStoragePath, { 'icons': true }))



const globalInstruments = fs.readFileSync("global_instruments.json");
DF.SetGlobalInstrumentList(JSON.parse(globalInstruments).globalInstruments);

let serverRestoreState = fs.readFileSync("server_state.json");
if (fs.existsSync(gPathLatestServerState)) {
  console.log(`Using latest backup of server state @ ${gPathLatestServerState}`);
  serverRestoreState = fs.readFileSync(gPathLatestServerState);
} else {
  console.log(`Using hard-coded server state @ server_state.json`);
}
serverRestoreState = JSON.parse(serverRestoreState);
loadRoom(fs.readFileSync("pub.json"), serverRestoreState);
loadRoom(fs.readFileSync("maj7.json"), serverRestoreState);
loadRoom(fs.readFileSync("revisionMainStage.json"), serverRestoreState);
loadRoom(fs.readFileSync("hall.json"), serverRestoreState);

gDB = new DFDB.DFDB(() => {
  gServerStats = new DFStats.DFStats(gStatsDBPath, gDB);
  roomsAreLoaded();
}, () => {
  // error
});

