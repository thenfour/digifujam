const express = require('express')
const YAML = require('yaml')
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const { nanoid } = require("nanoid");
const DF = require('./clientsrc/DFCommon');
const fs = require('fs');
const fsp = fs.promises;
const DFStats = require('./DFStats');
const serveIndex = require('serve-index')
const DFDB = require('./DFDB');
const DFDiscordBot = require('./discordBot');
const DFU = require('./clientsrc/dfutil');
const {ServerAdminApp} = require('./server/serverAdminApp');
const {ServerGoogleOAuthSupport} = require('./server/serverGoogleOAuth');

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

// ----------------------------------------------------------------------------------------------------------------
// startup assertions
console.log(".");
console.log(`Checking preconditions ..`);
let preconditionsPass = true;

let gAdminApp = null;

let gConfig = {};

if (fs.existsSync("./config.yaml")) {
   console.log(`Loading from config.yaml`);
   const f = fs.readFileSync("./config.yaml", {encoding : 'utf8', flag : 'r'});
   gConfig = YAML.parse(f.toString());
} else {
   throw new Error(`config.yaml not found`);
}

// for server-specific and secret tokens, put in a separate config file which will override the base public one.
if (fs.existsSync("./config2.yaml")) {
   console.log(`Loading from config2.yaml`);
   const f = fs.readFileSync("./config2.yaml", {encoding : 'utf8', flag : 'r'});
   gConfig = Object.assign(gConfig, YAML.parse(f.toString()));
}


if (!gConfig.admin_key) {
  preconditionsPass = false;
  console.log(`!! YOU HAVE NOT SET AN ADMIN PASSWORD VIA admin_key. YOU SHOULD.`);
}
if (!gConfig.mongo_connection_string) {
  preconditionsPass = false;
  console.log(`!! YOU HAVE NOT SET mongo_connection_string. THINGS WILL DEFINITELY BREAK.`);
}

console.log(preconditionsPass ? `Preconditions OK` : `Preconditions FAILED. Expect chaos.`);
console.log(".");

const gStatsDBPath = `${gConfig.storage_path}${gConfig.path_separator}DFStatsDB.json`;
app.use("/DFStatsDB.json", express.static(gStatsDBPath));

const gActivityDatasetsPath = `${gConfig.storage_path}${gConfig.path_separator}ActivityDatasets.json`;
app.use("/ActivityDatasets.json", express.static(gActivityDatasetsPath));

const gPathLatestServerState = `${gConfig.storage_path}${gConfig.path_separator}serverState_latest.json`;

let gServerStats = null;
let gDB = null;
let gDiscordBot = null;
let gRooms = {}; // map roomID to RoomServer
let g7jamAPI = null;
let gDiscordIntegrationManager = null;
let gGoogleOAuth = null;

// to be run when db is initialized...
let gDBInitProc = () => {

  gGoogleOAuth = new ServerGoogleOAuthSupport(gConfig, app, gDB);

  const hooks = [
    new DFStats.StatsLogger(gStatsDBPath, gDB),
  ];
  g7jamAPI = new _7jamAPI();
  if (gConfig.discord_bot_token) {
    gDiscordBot = new DFDiscordBot.DiscordBot(gConfig);
    gDiscordIntegrationManager = new DFStats.DiscordIntegrationManager(gConfig, gDiscordBot, g7jamAPI, gActivityDatasetsPath);
    hooks.push(gDiscordIntegrationManager);
  }
  gServerStats = new DFStats.ActivityHook(hooks);

  app.get('/activityHookData.json', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        const startTime = Date.now();
        const payload = JSON.stringify(gDiscordIntegrationManager.GetDebugData(), null, 2);
        res.send(payload);
        console.log(`Served /activityHookData.json in ${(Date.now() - startTime)} ms; payload_size = ${payload.length}`);
  });

};

// ----------------------------------------------------------------------------------------------------------------
class _7jamAPI
{
  constructor() {
    this.serverStartTime = new Date();
  }

  GenerateDiscordUserID = (discordMemberID) => 'discord_' + discordMemberID;//.replace(/\W/g, '_');  <-- currently not necessary to sanitize.

  GetRoomCount() {
    return Object.keys(gRooms).length;
  }

  GetApproximateGlobalInstrumentCount() {
    const instrumentNames = new Set();
    Object.keys(gRooms).forEach(roomID => {
      gRooms[roomID].roomState.instrumentCloset.forEach(instrument => {
        instrumentNames.add(instrument.name);
      });
    });
    return instrumentNames.size;
  }

  GetServerUptimeMS()
  {
    return (new Date()) - this.serverStartTime;
  }

  GetRoomState(roomID) {
    if (!(roomID in gRooms)){
      throw new Error(`GetRoomState: nonexistent 7jam room ${roomID}`);
    }
    const room = gRooms[roomID];
    return room.roomState;
  }

  Get7JamNoteCountForRoom(roomID) {
    if (!(roomID in gRooms)){
      throw new Error(`Get7JamNoteCountForRoom: A discord mapping is pointing to nonexistent 7jam room ${roomID}`);
    }
    const room = gRooms[roomID];
    return room.roomState.stats.noteOns;
  }

  GetServerNoteCount() {
    let ret = 0;
    Object.keys(gRooms).forEach(roomID => {
      ret += this.Get7JamNoteCountForRoom(roomID);
    });
    return ret;
  }

  Get7JamUsersForRoom(roomID, userFilter) {
    if (!(roomID in gRooms)){
      throw new Error(`Get7JamUserCountForRoom: A discord mapping is pointing to nonexistent 7jam room ${roomID}`);
    }
    userFilter = userFilter || ((u) => u.source === DF.eUserSource.SevenJam);
    const room = gRooms[roomID];
    return room.roomState.users.filter(userFilter);
  }

  Get7JamUserCountForRoom(roomID, userFilter) {
    return this.Get7JamUsersForRoom(roomID, userFilter).length;
  }

  GetGlobalOnlinePopulation(userFilter) {
    let ret = 0;
    Object.keys(gRooms).forEach(roomID => {
      ret += this.Get7JamUserCountForRoom(roomID, userFilter);
    });
    return ret;
  }

  UpdateDiscordUserInRoom(roomID, userName, color, discordMemberID) {
    if (!(roomID in gRooms)){
      throw new Error(`UpdateDiscordUserInRoom: A discord mapping is pointing to nonexistent 7jam room ${roomID}`);
    }

    // hack; discord's default color is black which just looks bad. simple workaround: replace ugle colors with better colors
    color = color === '#000000' ? '#008888' : color;

    const room = gRooms[roomID];
    let u = room.AddOrUpdateExternalUser(DF.eUserSource.Discord, DF.eUserPresence.Offline, userName, color, this.GenerateDiscordUserID(discordMemberID));
    if (u)
      u.discordMemberID = discordMemberID;
  }

  RemoveDiscordUserInRoom(roomID, discordMemberID) {
    if (!(roomID in gRooms)){
      throw new Error(`RemoveDiscordUserInRoom: A discord mapping is pointing to nonexistent 7jam room ${roomID}`);
    }
    const room = gRooms[roomID];
    room.RemoveExternalUser(this.GenerateDiscordUserID(discordMemberID));
  }

  SendDiscordMessageToRoom(roomID, discordMemberID, msgText) {
    if (!(roomID in gRooms)){
      throw new Error(`SendDiscordMessageToRoom: A discord mapping is pointing to nonexistent 7jam room ${roomID}`);
    }
    const room = gRooms[roomID];
    let u = room.roomState.FindUserByPersistentID(this.GenerateDiscordUserID(discordMemberID));
    if (!u) {
      console.log(`SendDiscordMessageToRoom: Unable to forward this message because the user was not found.`);
      console.log(`   -> your discord integrations/subscriptions might need to require user list sync?`);
      console.log(`   -> roomID ${roomID} ${discordMemberID} ${msgText}`);
      throw new Error(`SendDiscordMessageToRoom: Unable to forward this message because the user was not found.`);
    }

    room.HandleUserChatMessage(u.user, msgText, DF.eMessageSource.Discord);
  }

  SendWelcomeMessageToUser(userID, msgText) {
    let nm = new DF.DigifuChatMessage();
    nm.messageID = DF.generateID();
    nm.source = DF.eMessageSource.Server;
    nm.messageType = DF.ChatMessageType.chat;
    nm.message = msgText;
    nm.timestampUTC = new Date();
    const ws = this.SocketFromUserID(userID);
    if (!ws) return; // user left
    ws.emit(DF.ServerMessages.UserChatMessage, nm);
  }

  FindUserByID(userID) {
    let u = null;
    Object.values(gRooms).find(room => {
      u = room.roomState.FindUserByID(userID);
      if (!u) return false;
      u = u.user;
      return true;
    });
    return u;
  }

  SocketFromUserID(userID) {
    for (let ws of io.of('/').sockets.values()) {
      if (ws.DFUserID === userID)
        return ws;
    }
    //console.log(`SocketFromUserID(${userID}) => socket not found.`); <-- not necessarily an error; let callers treat it such
    return null;
  }

};


////////////////////////////////////////////////////////////////////////////////////////////////
class RoomServer {

  constructor(data, serverStateObj) {
    // thaw into live classes
    this.roomState = DF.DigifuRoomState.FromJSONData(data, url => fs.readFileSync(url, "utf8"), url => JSON.parse(fs.readFileSync(url)));

    this.roomState.absoluteURL = gConfig.host_prefix + this.roomState.route;
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
    if (serverStateObj) {
      const roomRestoreState = serverStateObj.find(r => r.roomID === this.roomState.roomID);
      if (roomRestoreState && roomRestoreState.dump) {
        this.roomState.adminImportRoomState(roomRestoreState.dump);
        log(`Imported room state for ${this.roomState.roomID}`);
      }
    }

    // do factory resets
    this.roomState.instrumentCloset.forEach(i => {
      this.roomState.integrateRawParamChanges(i, this.roomState.GetInitPreset(i));
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
    // handler
    const rejectUserEntry = () => {
      try {
        clientSocket.emit(DF.ServerMessages.PleaseReconnect);
      } catch (e) {
        log(`rejectUserEntry exception occurred`);
        log(e);
      }
    };

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

      // try to reuse existing user ID, so we can track this user through the world instead of considering
      // room changes totally new users.
      let userID = clientSocket.DFUserID || DF.generateUserID();

      // handler
      const completeUserEntry = (hasPersistentIdentity, persistentInfo, persistentID) => {
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
        u.img = null;

        if (clientSocket.handshake.query.DF_ADMIN_PASSWORD === gConfig.admin_key) {
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

        gServerStats.OnUserWelcome(this.roomState, u, this.roomState.users.filter(u => u.source === DF.eUserSource.SevenJam).length,
          clientSocket.DFIsDoingRoomChange);
        clientSocket.DFIsDoingRoomChange = false;

        // notify this 1 user of their user id & room state
        clientSocket.emit(DF.ServerMessages.Welcome, {
          yourUserID: userID,
          roomState: JSON.parse(this.roomState.asFilteredJSON()) // filter out stuff that shouldn't be sent to clients
        });

        // broadcast user enter to all clients except the user.
        clientSocket.to(this.roomState.roomID).broadcast.emit(DF.ServerMessages.UserEnter, { user: u, chatMessageEntry });
      }; // completeUserEntry

      if (!gGoogleOAuth.TryProcessHandshake(u, clientSocket, completeUserEntry, rejectUserEntry)) {
        completeUserEntry(false, DF.EmptyDFUserToPersistentInfo(), null);
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
      gServerStats.OnNoteOn(this.roomState, foundUser.user);
      this.roomState.stats.noteOns++;

      // broadcast to all clients except foundUser
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

      if (foundInstrument.instrument.paramChangeRenewal) {
        this.UnidleInstrument(foundUser.user, foundInstrument.instrument);
      }

      // set the value.
      this.roomState.integrateRawParamChanges(foundInstrument.instrument, data.patchObj, data.isWholePatch);
      gServerStats.OnParamChange(this.roomState, foundUser.user, Object.keys(data.patchObj).length);

      // broadcast to all clients
      io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentParams, {
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
      this.roomState.integrateRawParamChanges(foundInstrument.instrument, initPreset, true);

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

      gServerStats.OnPresetSave(this.roomState, foundUser.user, foundInstrument.instrument.getDisplayName(), patchObj.patchName);

      io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentPresetSave, {
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
    nm.messageID = DF.generateID();
    nm.source = source;
    nm.messageType = DF.ChatMessageType.chat; // of ChatMessageType. "chat", "part", "join", "nick"
    nm.message = msgText;
    nm.fromUserID = fromUser.userID;
    nm.fromUserColor = fromUser.color;
    nm.fromUserName = fromUser.name;
    nm.timestampUTC = new Date();

    gServerStats.OnMessage(this.roomState, fromUser, nm);
    fromUser.persistentInfo.stats.messages++;
    this.roomState.stats.messages++;

    this.roomState.chatLog.push(nm);

    // broadcast to all clients. even though it can feel more responsive and effiicent for the sender to just handle their own,
    // this allows simpler handling of incorporating the messageID.
    io.to(this.roomState.roomID).emit(DF.ServerMessages.UserChatMessage, nm);
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
    if (!(params.roomID in gRooms)) {
      log(`Error: User ${user.userID} is attempting to join a nonexistent room ${params.roomID}`);
      return;
    }
    let newRoom = gRooms[params.roomID];
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
    newRoom.ClientJoin(ws, this.roomState.roomTitle);
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

      gServerStats.OnCheer(this.roomState, foundUser.user);
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
    this.roomState.setBPM(data.bpm, data.timeSig);
    if (data.phaseRelativeMS) {
      this.roomState.metronome.AdjustPhase(data.phaseRelativeMS);
    }
    io.to(this.roomState.roomID).emit(DF.ServerMessages.RoomBPMUpdate, { bpm: this.roomState.metronome.getBPM(), timeSig: this.roomState.timeSig }); //update bpm for ALL clients
  }

  OnClientAdjustBeatPhase(ws, data) {
    this.roomState.metronome.AdjustPhase(data.relativeMS);
  }

  OnClientAdjustBeatOffset(ws, data) {
    this.roomState.OffsetBeats(data.relativeBeats);
  }

  // called per every beat, BPM is defined in roomState
  OnRoomBeat() {
    try {
      io.to(this.roomState.roomID).emit(DF.ServerMessages.RoomBeat, { bpm: this.roomState.metronome.getBPM(), beat: Math.round(this.roomState.metronome.getAbsoluteBeat()) }); //send bpm in order to synchronize
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

      // token, rooms: [{roomID, roomName, users [{ userid, name, pingMS }], stats}]
      var payload = {
        token: (new Date()).toISOString(),
        serverUptimeSec: ((new Date()) - gServerStartedDate) / 1000,
        rooms: [],
      };

      const transformUser = (u) => {
        return {
          userID: u.userID,
          pingMS: u.pingMS,
          name: u.name,
          persistentInfo: u.persistentInfo,
          color: u.color,
          source: u.source,
          presence: u.presence,
        };
      };

      payload.rooms = Object.keys(gRooms).map(k => {
        let room = gRooms[k];
        return {
          roomID: room.roomState.roomID,
          isPrivate: !!room.roomState.isPrivate,
          roomName: room.roomState.roomTitle,
          users: room.roomState.users.map(u => transformUser(u)),
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

      // important to put this AFTER the splice, so the new user count is correct.
      gServerStats.OnUserLeave(this.roomState, foundUser.user, this.roomState.users.filter(u => u.source === DF.eUserSource.SevenJam).length,
        ws.DFIsDoingRoomChange);

      if (ws) {
        ws.leave(this.roomState.roomID);
      }
      io.to(this.roomState.roomID).emit(DF.ServerMessages.UserLeave, { userID, chatMessageEntry });
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

      userObj.name = userName;
      userObj.color = color;
      userObj.presence = presence;

      const data = {
        userID: userObj.userID,
        name: userObj.name,
        color: userObj.color,
        img: userObj.img,
        position: userObj.position,
        presence,
      };

      io.to(this.roomState.roomID).emit(DF.ServerMessages.UserState, { state: data });
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

    u.userID = DF.generateUserID();
    u.persistentID = persistentID?.toString();
    u.source = source;
    u.presence = presence;
    u.hasPersistentIdentity = false;
    u.persistentInfo = DF.EmptyDFUserToPersistentInfo();
    u.lastActivity = new Date();
    u.position = { x: this.roomState.width / 2, y: this.roomState.height / 2 };
    u.img = null;

    this.roomState.users.push(u);

    io.to(this.roomState.roomID).emit(DF.ServerMessages.UserEnter, { user: u });
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
      // broadcast this to clients
      io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, { instrumentID: inst.instrumentID, userID: null, idle: false });
    });

    // remove user from room.
    this.roomState.users.splice(foundUser.index, 1);

    io.to(this.roomState.roomID).emit(DF.ServerMessages.UserLeave, { userID: foundUser.user.userID });
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


function OnPersistentSignOut(ws, data) {
  try {
    let foundUser = gFindUserFromSocket(ws);
    if (foundUser == null) {
      log(`OnPersistentSignOut => unknown user`);
      return;
    }

    foundUser.PersistentSignOut();
    
    ws.emit(DF.ServerMessages.PersistentSignOutComplete);

  } catch (e) {
    log(`OnPersistentSignOut exception occurred`);
    log(e);
  }
}


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
    const path = `${gConfig.storage_path}${gConfig.path_separator}serverState_` +
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
    fs.readdir(gConfig.storage_path, (err, files) => {
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
            filesToDelete.push(gConfig.storage_path + gConfig.path_separator + file);
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


function listUnusedSFZInstruments() {
  const usedSFZ = new Set();
  Object.keys(gRooms).forEach(k => {
    gRooms[k].roomState.instrumentCloset.forEach(i => {
      if (i.engine !== "sfz") return;
      if (i.sfzURL) usedSFZ.add(i.sfzURL);
      if (i.sfzArray) {
        i.sfzArray.forEach(s => {
          usedSFZ.add(s.sfzURL);
        });
      }
    });
  });

  console.log(`-------------------------------------------------`);
  console.log(` SFZ PATHS USED`);
  console.log(`-------------------------------------------------`);
  usedSFZ.forEach(s => {
    console.log(`  ${s}`);
  });
  console.log(`-------------------------------------------------`);
};

// load configs
let roomsAreLoaded = function () {
  // serve the rooms
  io.on('connection', ws => {
    try {
      if (!ws.handshake.query['7jamRealm']) {
        console.log(`A websocket connected with no realm requested.`);
        ws.disconnect();
        return;
      }
      if (ws.handshake.query['7jamRealm'] == 'admin') {
        gAdminApp.OnClientConnect(ws);
        return;
      }

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
        console.log(`user trying to connect to nonexistent roomID ${requestedRoomID}`);
        ws.disconnect();
        return;
      }

      if ('roomKey' in room.roomState) {
        if (ws.handshake.query["roomKey"] != room.roomState.roomKey) {
          console.log(`user is connecting with incorrect roomkey to ${room.roomState.roomID}.`);
          ws.disconnect();
          return;
        }
      }

      ws.on('disconnect', data => OnDisconnect(ws, data));
      ws.on(DF.ClientMessages.PersistentSignOut, data => OnPersistentSignOut(ws, data));
      ws.on(DF.ClientMessages.Identify, data => ForwardToRoom(ws, room => room.OnClientIdentify(ws, data)));
      ws.on(DF.ClientMessages.JoinRoom, data => ForwardToRoom(ws, room => room.OnClientJoinRoom(ws, data)));
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
      ws.on(DF.ClientMessages.AdjustBeatOffset, data => ForwardToRoom(ws, room => room.OnClientAdjustBeatOffset(ws, data)));

      ws.on(DF.ClientMessages.AdminChangeRoomState, data => ForwardToRoom(ws, room => room.OnAdminChangeRoomState(ws, data)));

      ws.on(DF.ClientMessages.DownloadServerState, data => OnClientDownloadServerState(ws, data));
      ws.on(DF.ClientMessages.UploadServerState, data => OnClientUploadServerState(ws, data));

      room.ClientJoin(ws);

    } catch (e) {
      log("Exception on connection: " + e);
    }
  }); // io.on(connection)

  listUnusedSFZInstruments();

  setTimeout(OnBackupServerStateInterval, DF.ServerSettings.ServerStateBackupIntervalMS);

  setTimeout(OnPruneServerStateInterval, DF.ServerSettings.ServerStatePruneIntervalMS);

  gServerStats.OnRoomsLoaded(gRooms);

  gAdminApp = new ServerAdminApp(gConfig, gRooms, g7jamAPI, gServerStats, gDiscordBot, gDiscordIntegrationManager);

  let port = gConfig.port || 8081;
  http.listen(port, () => {
    log(`listening on *:${port}`);
  });
}; // roomsAreLoaded

let loadRoom = function (jsonTxt, serverRestoreState) {
  roomState = JSON.parse(jsonTxt);
  gRooms[roomState.roomID] = new RoomServer(roomState, serverRestoreState);
  log(`serving room ${roomState.roomID} on route ${roomState.route}`);

  app.use(roomState.route, express.static('public', {
    index: ('roomKey' in roomState) ? "index-key.html" : "index.html"
  }));
}


app.use("/storage", express.static(gConfig.storage_path), serveIndex(gConfig.storage_path, { 'icons': true }));

// webpack compiler outputs to non-public dist; make it accessible as /dist.
app.use("/dist", express.static("./dist"));


const globalInstruments = fs.readFileSync("global_instruments.json");
DF.SetGlobalInstrumentList(JSON.parse(globalInstruments).globalInstruments);

let serverRestoreState = fs.readFileSync("server_state.json");
if (fs.existsSync(gPathLatestServerState)) {
  console.log(`Using latest backup of server state @ ${gPathLatestServerState}`);
  serverRestoreState = fs.readFileSync(gPathLatestServerState);
} else {
  console.log(`Using hard-coded server state @ server_state.json`);
}
try {
  serverRestoreState = JSON.parse(serverRestoreState);
} catch (e) {
  console.log(`error loading server state:`);
  console.log(e);
  serverRestoreState = null;
}

gConfig.room_json.forEach(path => {
  loadRoom(fs.readFileSync(path), serverRestoreState);
});

gDB = new DFDB.DFDB(gConfig, () => {
  gDBInitProc();
  roomsAreLoaded();
}, () => {
  // error
});

