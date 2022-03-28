const express = require('express')
const fileUpload = require('express-fileupload');
const YAML = require('yaml')
const fs = require('fs');
const fsp = fs.promises;
const serveIndex = require('serve-index')
const DF = require('../DFcommon/DFCommon');
const DFStats = require('./DFStats');
const DFDB = require('./DFDB');
const DFDiscordBot = require('./discordBot');
const DFU = require('../DFcommon/dfutil');
const Seq = require('../DFcommon/SequencerCore');
const {ServerAdminApp} = require('./serverAdminApp');
const {ServerGoogleOAuthSupport} = require('./serverGoogleOAuth');
const {RoomServer} = require('./roomserver');
const {_7jamAPI} = require('./7jamapi');
const { eUserGlobalRole } = require('../DFcommon/DFUser');

const log = (a) => { return console.log(a) };

class _7jamServer {

  get config() { return this.mConfig; }

  constructor(io, expressApp, http) {

    this.mServerStartedDate = new Date();
    this.expressApp = expressApp;
    this.io = io;

    // LOAD CONFIG ----------------------------------------------------------------
    this.mConfig = {};

    if (fs.existsSync("./config.yaml")) {
      console.log(`Loading from config.yaml`);
      const f = fs.readFileSync("./config.yaml", {encoding : 'utf8', flag : 'r'});
      this.mConfig = YAML.parse(f.toString());
    } else {
      throw new Error(`config.yaml not found`);
    }

    // for server-specific and secret tokens, put in a separate config file which will override the base public one.
    if (fs.existsSync("./config2.yaml")) {
      console.log(`Loading from config2.yaml`);
      const f = fs.readFileSync("./config2.yaml", {encoding : 'utf8', flag : 'r'});
      this.mConfig = Object.assign(this.mConfig, YAML.parse(f.toString()));
    }

    this.mConfig.gitRevision = require('child_process')
      .execSync('git rev-parse origin') // origin, HEAD, ...
      .toString().trim();

    this.mConfig.StaticHostPrefix = this.mConfig.StaticHostPrefix.replaceAll("{GitRevision}", this.mConfig.gitRevision);
    this.mConfig.LocalStaticHostPrefix = this.mConfig.LocalStaticHostPrefix.replaceAll("{GitRevision}", this.mConfig.gitRevision);

    // ------------------------------------------

    this.mStatsDBPath = `${this.mConfig.storage_path}${this.mConfig.path_separator}DFStatsDB.json`;
    this.mActivityDatasetsPath = `${this.mConfig.storage_path}${this.mConfig.path_separator}ActivityDatasets.json`;
    this.mPathLatestServerState = `${this.mConfig.storage_path}${this.mConfig.path_separator}serverState_latest.json`;

    this.mLogReportsPath = `${this.mConfig.storage_path}${this.mConfig.path_separator}logreports.json`;

    // -- Configure HTTP routes ------------------------------------
    this.expressApp.use(express.json());
    this.expressApp.use(express.urlencoded({ extended: false }));

    this.expressApp.use("/DFStatsDB.json", express.static(this.mStatsDBPath));
    this.expressApp.use("/ActivityDatasets.json", express.static(this.mActivityDatasetsPath));
    this.expressApp.use("/storage", express.static(this.mConfig.storage_path), serveIndex(this.mConfig.storage_path, {'icons' : true}));
    this.expressApp.use("/uploads", express.static(this.mConfig.UploadsDirectory), serveIndex(this.mConfig.UploadsDirectory, {'icons' : true}));

    this.expressApp.use(fileUpload({
      limits : {
        fileSize : 10 /* MB */ * 1024 * 1024,
      },
    }));

    this.expressApp.post('/uploadGraffiti', this.OnGraffiti);

    this.expressApp.post("/reportlog", this.OnReportLog);

    this.expressApp.get('/activityHookData.json', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      const startTime = Date.now();
      const payload = JSON.stringify(this.mDiscordIntegrationManager.GetDebugData(), null, 2);
      res.send(payload);
      console.log(`Served /activityHookData.json in ${(Date.now() - startTime)} ms; payload_size = ${payload.length}`);
    });

    this.mRooms = {}; // map roomID to RoomServer
    this.NODE_ENV = expressApp.get('env');

    const globalInstruments = fs.readFileSync("global_instruments.json");
    DF.SetGlobalInstrumentList(JSON.parse(globalInstruments).globalInstruments);

    // load sequencer global configuration files. instrument JSON can refer to these configs.
    const seqConfigPath = `.${this.mConfig.path_separator}sequencer_configs`;
    const seqConfigs = fs.readdirSync(seqConfigPath);
    seqConfigs.forEach(leaf => {
      const path = `${seqConfigPath + this.mConfig.path_separator + leaf}`;
      console.log(`reading sequencer config file: ${path}`);
      const configStr = fs.readFileSync(path, {encoding : 'utf8', flag : 'r'});
      const config = YAML.parse(configStr);
      Seq.IntegrateSequencerConfig(config);
    });
    Seq.ResolveSequencerConfig();

    let serverRestoreState = fs.readFileSync("server_state.json");
    if (fs.existsSync(this.mPathLatestServerState)) {
      console.log(`Using latest backup of server state @ ${this.mPathLatestServerState}`);
      serverRestoreState = fs.readFileSync(this.mPathLatestServerState);
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

    this.mDB = new DFDB.DFDB(this.mConfig);

    let indexTemplate = fs.readFileSync("public/indexTemplate.html").toString();
    indexTemplate = indexTemplate.replaceAll("{StaticHostPrefix}", this.mConfig.StaticHostPrefix);
    indexTemplate = indexTemplate.replaceAll("{LocalStaticHostPrefix}", this.mConfig.LocalStaticHostPrefix);

    this.mConfig.room_json.forEach(path => {
      const jsonTxt = fs.readFileSync(path);
      const roomState = JSON.parse(jsonTxt);
      this.mRooms[roomState.roomID] = new RoomServer(this, roomState, serverRestoreState);
      log(`serving room ${roomState.roomID} on route ${roomState.route}`);

      this.expressApp.use(roomState.route, (req, res, next) => {
        if (req.path.endsWith("/")) { // landing pages. yea i know how ugly this is.
          res.send(indexTemplate);
          res.end();
        } else {
          next(); // fall through to static middleware
        }
      })
    });

    this.expressApp.use("/", express.static('public'));

    this.mGoogleOAuth = new ServerGoogleOAuthSupport(this.mConfig, this.expressApp, this.mDB);

    const hooks = [
      new DFStats.StatsLogger(this.mStatsDBPath, this.mDB),
    ];
    this.m7jamAPI = new _7jamAPI(this, this.mRooms, this.mConfig, this.io);
    if (this.mConfig.discord_bot_token) {
      this.mDiscordBot = new DFDiscordBot.DiscordBot(this.mConfig, () => this.onDiscordInitialized());
      this.mDiscordIntegrationManager = new DFStats.DiscordIntegrationManager(this.mConfig, this.mDiscordBot, this.m7jamAPI, this.mActivityDatasetsPath);
      hooks.push(this.mDiscordIntegrationManager);
    }
    this.mServerStats = new DFStats.ActivityHook(hooks);

    // serve the rooms
    io.on('connection', (ws) => this.OnConnection(ws));

    setTimeout(() => this.OnBackupServerStateInterval(), DF.ServerSettings.ServerStateBackupIntervalMS);

    setTimeout(() => this.OnPruneServerStateInterval(), DF.ServerSettings.ServerStatePruneIntervalMS);

    this.mServerStats.OnRoomsLoaded(this.mRooms);

    this.mAdminApp = new ServerAdminApp(this.mConfig, this.mRooms, this.m7jamAPI, this.mServerStats, this.mDiscordBot, this.mDiscordIntegrationManager);

    let port = this.mConfig.port || 8081;
    http.listen(port, () => {
      log(`listening on *:${port}`);
    });

  } // ctor

  ForwardToRoom(ws, fn) {
    let roomArray = [...ws.rooms ];
    //log(`ROOMS=${roomArray} FN=${fn.toString()}`);
    fn(this.mRooms[roomArray[1]]); // room[0] is always your socket id.
  };

  OnDisconnect(ws) {
    // remove from all rooms.
    Object.keys(this.mRooms).forEach(roomID => {
      if (!ws.DFUserID) {
        console.log(`! OnDisconnect / websocket doesn't have a user ID.`);
      }
      this.mRooms[roomID].ClientLeaveRoom(ws, ws.DFUserID);
    });
  };

  FindUserFromSocket = (ws) => {
    let ret = null;
    Object.values(this.mRooms).find(room => {
      let u = room.FindUserFromSocket(ws);
      if (u) {
        ret = u.user;
        return true;
      }
      return false;
    });
    return ret;
  };

  OnPersistentSignOut(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnPersistentSignOut => unknown user`);
        return;
      }

      foundUser.PersistentSignOut();

      // restore admin role if specified in query params
      // todo: synchronize with completeUserEntry processing
      if (ws.handshake.query.DF_ADMIN_PASSWORD === this.mConfig.admin_key) {
        u.addGlobalRole(eUserGlobalRole.sysadmin.name);
      }

      ws.emit(DF.ServerMessages.PersistentSignOutComplete);

    } catch (e) {
      log(`OnPersistentSignOut exception occurred`);
      log(e);
    }
  }

  OnGoogleSignIn(ws, data) {
    try {
      const google_access_token = data.google_access_token;

      const complete = (hasPersistentIdentity, persistentInfo, persistentID) => {
        let foundUser = this.FindUserFromSocket(ws);
        if (foundUser == null) {
          log(`OnGoogleSignIn => google sign in suceeded but user disappeared.`);
          return;
        }

        foundUser.PersistentSignIn(hasPersistentIdentity, persistentID, persistentInfo);

        if (ws.handshake.query.DF_ADMIN_PASSWORD === this.mConfig.admin_key) {
          foundUser.addGlobalRole(eUserGlobalRole.sysadmin.name);
        }

        let adminKey = null;
        if (foundUser.IsAdmin()) {
          adminKey = this.mConfig.admin_key;
        }

        // notify this 1 user of their user id & room state
        ws.emit(DF.ServerMessages.GoogleSignInComplete, {
          hasPersistentIdentity,
          persistentInfo,
          persistentID,
          adminKey,
        });
      }; // completeUserEntry

      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnGoogleSignIn => google sign in suceeded but user disappeared.`);
        return;
      }
      this.mGoogleOAuth.DoGoogleSignIn(ws, google_access_token, foundUser, complete, () => {
        console.log(`google sign in failed`);
      });

    } catch (e) {
      log(`OnGoogleSignIn exception occurred`);
      log(e);
    }
  }

  OnClientDownloadServerState = (ws) => {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnClientDownloadServerState => unknown user`);
        return;
      }

      if (!foundUser.IsAdmin())
        throw new Error(`User isn't an admin.`);

      // the server state dump is really just everything except users.
      let allRooms = [];
      Object.keys(this.mRooms).forEach(roomID => {
        allRooms.push({
          roomID : roomID,
          dump : this.mRooms[roomID].roomState.adminExportRoomState()
        });
      });
      ws.emit(DF.ServerMessages.ServerStateDump, allRooms);

    } catch (e) {
      log(`OnClientDownloadServerState exception occurred`);
      log(e);
    }
  }

  OnClientUploadServerState = (ws, data) => {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        log(`OnClientUploadServerState => unknown user`);
        return;
      }

      if (!foundUser.IsAdmin())
        throw new Error(`User isn't an admin.`);

      log(`uploaded server state with len=${JSON.stringify(data).length}`);
      data.forEach(rs => {
        if (!rs.roomID)
          throw new Error(`no room ID. maybe you're importing some bad format?`);
        let room = this.mRooms[rs.roomID]; //.find(r => r.roomState.roomID == rs.roomID);
        if (!room)
          throw new Error(`unable to find a room during import. odd.`);
        room.adminImportRoomState(rs.dump);
      });

      this.mDiscordBot?.ReannounceUserMapTo7jam();

      this.io.of('/').sockets.forEach(ws => {
        ws.emit(DF.ServerMessages.PleaseReconnect);
      });

    } catch (e) {
      log(`OnClientUploadServerState exception occurred`);
      log(e);
    }
  }

  OnBackupServerState = () => {
    try {
      const m1 = new Date();
      let allRooms = [];
      Object.keys(this.mRooms).forEach(roomID => {
        allRooms.push({
          roomID : roomID,
          dump : this.mRooms[roomID].roomState.adminExportRoomState()
        });
      });

      const allRoomsJSON = JSON.stringify(allRooms);

      const d = new Date();
      const path = `${this.mConfig.storage_path}${this.mConfig.path_separator}serverState_` +
                   `${d.getUTCFullYear()}${(d.getUTCMonth() + 1).toString().padStart(2, '0')}${d.getUTCDate().toString().padStart(2, '0')}` +
                   `_${d.getUTCHours().toString().padStart(2, '0')}_${d.getUTCMinutes().toString().padStart(2, '0')}_${d.getUTCSeconds().toString().padStart(2, '0')}.json`;

      fsp.writeFile(path, allRoomsJSON, 'utf8');
      fsp.writeFile(this.mPathLatestServerState, allRoomsJSON, 'utf8');
      console.log(`Backing up server state to ${path}; took ${((new Date() - m1) / 1000).toFixed(3)} sec`);
    } catch (e) {
      console.log(`OnBackupServerState exception occurred`);
      console.log(e);
    }
  };

  OnBackupServerStateInterval = () => {
    setTimeout(() => {this.OnBackupServerStateInterval()}, DF.ServerSettings.ServerStateBackupIntervalMS);
    this.OnBackupServerState();
  };

  OnPruneServerStateInterval = () => {
    try {
      setTimeout(() => {this.OnPruneServerStateInterval}, DF.ServerSettings.ServerStatePruneIntervalMS);

      let filesToDelete = [];
      fs.readdir(this.mConfig.storage_path, (err, files) => {
        const m1 = new Date();
        files.forEach(file => {
          try {
            // serverState_20210207_16_59_06.json
            if (!file.startsWith("serverState_"))
              return;
            let fileParts = file.split('.')[0]; // remove extension
            fileParts = fileParts.split("_");
            // 2019-01-06T14:00:00.000Z
            let fileDate = `${fileParts[1].substring(0, 4)}-${fileParts[1].substring(4, 6)}-${fileParts[1].substring(6)}T${fileParts[2]}:${fileParts[3]}:${fileParts[4]}.000Z`;
            let age = m1 - new Date(fileDate);

            if (age > DF.ServerSettings.ServerStateMaxAgeMS) {
              filesToDelete.push(this.mConfig.storage_path + this.mConfig.path_separator + file);
            }

          } catch (ex) {
            console.log(`OnPruneServerStateInterval; file caused exception: ${file}`);
            console.log(ex);
          }
        });

        console.log(`OnPruneServerStateInterval; filesToDelete: ${JSON.stringify(filesToDelete)}`);

        filesToDelete.forEach(f => fs.unlink(f, () => {}));
        //console.log(`OnPruneServerStateInterval; took ${((new Date() - m1) / 1000).toFixed(3)} sec`);
      });

    } catch (e) {
      console.log(`OnPruneServerStateInterval exception occurred`);
      console.log(e);
    }
  };

  OnConnection(ws) {
    try {
      if (!ws.handshake.query['7jamRealm']) {
        console.log(`A websocket connected with no realm requested.`);
        ws.disconnect();
        return;
      }
      if (ws.handshake.query['7jamRealm'] == 'admin') {
        this.mAdminApp.OnClientConnect(ws);
        return;
      }

      let worldUserCount = this.m7jamAPI.GetGlobalOnlinePopulation();
      if (worldUserCount >= DF.ServerSettings.WorldUserCountMaximum) {
        console.log(`Too many users ${worldUserCount}; disconnecting.`);
        ws.disconnect();
        return;
      }
      let requestedRoomID = DF.routeToRoomID(ws.handshake.query["jamroom"]);
      let room = this.mRooms[requestedRoomID];
      if (!room) {
        console.log(`user trying to connect to nonexistent roomID ${requestedRoomID}`);
        ws.disconnect();
        return;
      }

      ws.on('disconnect', data => this.OnDisconnect(ws, data));
      ws.on(DF.ClientMessages.PersistentSignOut, data => this.OnPersistentSignOut(ws, data));
      ws.on(DF.ClientMessages.GoogleSignIn, data => this.OnGoogleSignIn(ws, data));
      ws.on(DF.ClientMessages.Identify, data => this.ForwardToRoom(ws, room => room.OnClientIdentify(ws, data)));
      ws.on(DF.ClientMessages.JoinRoom, data => this.ForwardToRoom(ws, room => room.OnClientJoinRoom(ws, data)));
      ws.on(DF.ClientMessages.InstrumentRequest, data => this.ForwardToRoom(ws, room => room.OnClientInstrumentRequest(ws, data)));
      ws.on(DF.ClientMessages.InstrumentRelease, () => this.ForwardToRoom(ws, room => room.OnClientInstrumentRelease(ws)));
      ws.on(DF.ClientMessages.NoteOn, data => this.ForwardToRoom(ws, room => room.OnClientNoteOn(ws, data)));
      ws.on(DF.ClientMessages.NoteOff, data => this.ForwardToRoom(ws, room => room.OnClientNoteOff(ws, data)));
      ws.on(DF.ClientMessages.AllNotesOff, data => this.ForwardToRoom(ws, room => room.OnClientAllNotesOff(ws, data)));
      ws.on(DF.ClientMessages.PedalDown, data => this.ForwardToRoom(ws, room => room.OnClientPedalDown(ws, data)));
      ws.on(DF.ClientMessages.PedalUp, data => this.ForwardToRoom(ws, room => room.OnClientPedalUp(ws, data)));
      ws.on(DF.ClientMessages.InstrumentParams, data => this.ForwardToRoom(ws, room => room.OnClientInstrumentParams(ws, data)));
      ws.on(DF.ClientMessages.CreateParamMapping, data => this.ForwardToRoom(ws, room => room.OnClientCreateParamMapping(ws, data)));
      ws.on(DF.ClientMessages.RemoveParamMapping, data => this.ForwardToRoom(ws, room => room.OnClientRemoveParamMapping(ws, data)));

      ws.on(DF.ClientMessages.InstrumentPresetDelete, data => this.ForwardToRoom(ws, room => room.OnClientInstrumentPresetDelete(ws, data)));
      ws.on(DF.ClientMessages.InstrumentFactoryReset, data => this.ForwardToRoom(ws, room => room.OnClientInstrumentFactoryReset(ws, data)));
      ws.on(DF.ClientMessages.InstrumentPresetSave, data => this.ForwardToRoom(ws, room => room.OnClientInstrumentPresetSave(ws, data)));
      ws.on(DF.ClientMessages.InstrumentBankMerge, data => this.ForwardToRoom(ws, room => room.OnClientInstrumentBankMerge(ws, data)));

      ws.on(DF.ClientMessages.ChatMessage, data => this.ForwardToRoom(ws, room => room.OnClientChatMessage(ws, data)));
      ws.on(DF.ClientMessages.Pong, data => this.ForwardToRoom(ws, room => room.OnClientPong(ws, data)));
      ws.on(DF.ClientMessages.UserState, data => this.ForwardToRoom(ws, room => room.OnClientUserState(ws, data)));
      ws.on(DF.ClientMessages.Quantization, data => this.ForwardToRoom(ws, room => room.OnClientQuantization(ws, data)));
      ws.on(DF.ClientMessages.Cheer, data => this.ForwardToRoom(ws, room => room.OnClientCheer(ws, data)));
      ws.on(DF.ClientMessages.RoomBPMUpdate, data => this.ForwardToRoom(ws, room => room.OnClientRoomBPMUpdate(ws, data)));
      ws.on(DF.ClientMessages.AdjustBeatPhase, data => this.ForwardToRoom(ws, room => room.OnClientAdjustBeatPhase(ws, data)));
      ws.on(DF.ClientMessages.AdjustBeatOffset, data => this.ForwardToRoom(ws, room => room.OnClientAdjustBeatOffset(ws, data)));
      ws.on(DF.ClientMessages.GraffitiOps, data => this.ForwardToRoom(ws, room => room.OnGraffitiOps(ws, data)));
      ws.on(DF.ClientMessages.UserDance, data => this.ForwardToRoom(ws, room => room.OnUserDance(ws, data)));
      ws.on(DF.ClientMessages.ChatMessageOp, data => this.ForwardToRoom(ws, room => room.OnChatMessageOp(ws, data)));

      ws.on(DF.ClientMessages.AdminChangeRoomState, data => this.ForwardToRoom(ws, room => room.OnAdminChangeRoomState(ws, data)));
      ws.on(DF.ClientMessages.UserRoleOp, data => this.ForwardToRoom(ws, room => room.OnUserRoleOp(ws, data)));

      // SEQ
      ws.on(DF.ClientMessages.SeqPlayStop, data => this.ForwardToRoom(ws, room => room.OnSeqPlayStop(ws, data)));
      ws.on(DF.ClientMessages.SeqSetTimeSig, data => this.ForwardToRoom(ws, room => room.OnSeqSetTimeSig(ws, data)));
      ws.on(DF.ClientMessages.SetSetNoteMuted, data => this.ForwardToRoom(ws, room => room.SetSetNoteMuted(ws, data)));
      ws.on(DF.ClientMessages.SeqSelectPattern, data => this.ForwardToRoom(ws, room => room.SeqSelectPattern(ws, data)));
      ws.on(DF.ClientMessages.SeqSetSpeed, data => this.ForwardToRoom(ws, room => room.SeqSetSpeed(ws, data)));
      ws.on(DF.ClientMessages.SeqSetSwing, data => this.ForwardToRoom(ws, room => room.SeqSetSwing(ws, data)));
      ws.on(DF.ClientMessages.SeqSetDiv, data => this.ForwardToRoom(ws, room => room.SeqSetDiv(ws, data)));
      ws.on(DF.ClientMessages.SeqSetOct, data => this.ForwardToRoom(ws, room => room.SeqSetOct(ws, data)));
      ws.on(DF.ClientMessages.SeqSetLength, data => this.ForwardToRoom(ws, room => room.SeqSetLength(ws, data)));
      ws.on(DF.ClientMessages.SeqPatternOps, data => this.ForwardToRoom(ws, room => room.SeqPatternOps(ws, data)));
      ws.on(DF.ClientMessages.SeqPatchInit, data => this.ForwardToRoom(ws, room => room.SeqPatchInit(ws, data)));
      ws.on(DF.ClientMessages.SeqPresetOp, data => this.ForwardToRoom(ws, room => room.SeqPresetOp(ws, data)));
      ws.on(DF.ClientMessages.SeqMetadata, data => this.ForwardToRoom(ws, room => room.SeqMetadata(ws, data)));
      ws.on(DF.ClientMessages.SeqSetListeningInstrumentID, data => this.ForwardToRoom(ws, room => room.SeqSetListeningInstrumentID(ws, data)));
      
      //ws.on(DF.ClientMessages.SeqCue, data => this.ForwardToRoom(ws, room => room.SeqCue(ws, data)));
      // ---

      ws.on(DF.ClientMessages.DownloadServerState, data => this.OnClientDownloadServerState(ws, data));
      ws.on(DF.ClientMessages.UploadServerState, data => this.OnClientUploadServerState(ws, data));

      room.ClientJoin(ws);

    } catch (e) {
      console.log("Exception on connection");
      console.log(e);
    }
  } // on connection

  OnGraffiti = (req, res) => {
    try {
      const userID = req.body.userID;
      if (!userID) {
        res.end("nok");
        return;
      }
      if (!req.files) {
        res.end("nok");
        return;
      }
      const es = Object.entries(req.files);
      if (!es.length) {
        res.end("nok");
        return;
      }
      const file = es[0][1];

      // validate extensions
      if (!DFU.IsImageFilename(file.name)) {
        console.log(`Rejecting ${file.name} / ${file.size} due to not being an image.`);
        res.end("nok");
        return;
      }

      // generate a filename and move
      const ext = file.name.substring(file.name.lastIndexOf("."));
      const filename = DFU.generateID() + ext;
      const destPath = this.mConfig.UploadsDirectory + "/" + filename;
      const url = this.mConfig.LocalStaticHostPrefix + "/uploads/" + filename;

      file.mv(destPath, (e) => {
        try {
          console.log(`uploaded: ${file.name} to ${destPath}`); // the uploaded file object
          // get room & user objects
          const {room, user} = this.m7jamAPI.GetRoomAndUserByUserID(userID);
          if (!user) {
            res.end("nok");
            return;
          }
          room.DoGraffitiOpsForUser(user, [ {
                                      op : "place",
                                      content : url,
                                    } ]);
          res.end("ok");
        } catch (e) {
          log(`Exception while processing uploaded file ${file.name}`);
          log(e)
        }
      });
    } catch (e) {
      console.log("OnGraffiti exception");
      console.log(e);
    }
  } // on graffiti

  GetLogReportsSync() {
    try {
      return JSON.parse(fs.readFileSync(this.mLogReportsPath));
    } catch (e) {
      console.log(`Exception while parsing log reports file ${this.mLogReportsPath}`);
      console.log(`Probably just starting a new file...`);
    }
    return { reports: [] }; // default empty obj.
  }

  async WriteLogReports(bigobj) {
    try {
      await fsp.writeFile(this.mLogReportsPath, JSON.stringify(bigobj, null, 2), 'utf8');
      console.log(`Log entries (${bigobj.reports.length}) reported to ${this.mLogReportsPath}`);
    } catch (e) {
      console.log("WriteLogReports exception");
      console.log(e);
    }
  }

  OnReportLog = async (req, res) => {
    try {
      console.log(`onreportlog entrypoint`);
      if (!Array.isArray(req.body)) {
        res.end("nok");
        return;
      }
      if (req.body.length < 1) {
        res.end("nok");
        return;
      }
      
      const bigobj = this.GetLogReportsSync();

      bigobj.reports.push({
        date: Date.now(),
        payload: Object.assign({}, req.body),
      });

      this.WriteLogReports(bigobj);
      res.end("ok");
    } catch (e) {
      console.log("OnReportLog exception");
      console.log(e);
    }
  }

  onDiscordInitialized() {
    this.mServerStats.OnDiscordInitialized();
  }
}

module.exports = {
  _7jamServer,
}

