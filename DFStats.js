const https = require('https')
const DF = require('./clientsrc/DFCommon');
const fsp = require('fs').promises;
const fs = require('fs');
const DFDB = require('./DFDB');
const RangeWindowQuery = require("./clientsrc/RangeWindowQuery");
const {UserCountNotification} = require('./clientsrc/UserCountNotification');
const {ServerUpDiscordNotification} = require('./clientsrc/ServerUpDiscordNotification');
const {JamStatusNotification} = require('./clientsrc/NoteCountNotification');
const {UserListSyncOnly} = require('./clientsrc/UserListSyncOnly');
const {WelcomeMessageIntegration} = require('./clientsrc/WelcomeMessage');
const {AllJoinsNotification} = require('./clientsrc/AllJoinsNotification');
const DFU = require('./clientsrc/dfutil');

class UserCountsDataSource {
   constructor(mgr, dataSourceSpec, id, ourBackup) {
      this.mgr = mgr;
      this.id = id;
      this.dataSourceSpec = dataSourceSpec;
      this.backup = null;
      this.maxAgeMS = RangeWindowQuery.DurationSpecToMS(dataSourceSpec.maxAge);

      const knownFilters = {
         '7jam' : (u) => u.source === DF.eUserSource.SevenJam,
         '7jamNonAdmins' : (u) => u.source === DF.eUserSource.SevenJam && !u.IsAdmin(),
      };
      dataSourceSpec.userFilter = dataSourceSpec.userFilter || '7jam'; // default filter.
      console.assert(dataSourceSpec.userFilter in knownFilters, `The specified user filter '${dataSourceSpec.userFilter}' is not known.`);
      this.userFilter = knownFilters[dataSourceSpec.userFilter];

      this.roomDataSets = new Map();

      // recreate datasets which are being restored from backup.
      if (ourBackup) {
         Object.keys(ourBackup).forEach(dataSetID => {
            if (dataSetID === '__global') {
               this.globalDataSet = new RangeWindowQuery.SampledSignalDataSource(0, this.maxAgeMS, null, ourBackup[dataSetID]);
               return;
            }
            this.roomDataSets.set(dataSetID, new RangeWindowQuery.SampledSignalDataSource(0, this.maxAgeMS, null, ourBackup[dataSetID]));
         });
      }

      if (!this.globalDataSet) {
         this.globalDataSet = new RangeWindowQuery.SampledSignalDataSource(0, this.maxAgeMS);
      }
   }

   // data sources: just return a map of underlying data sets
   Serialize() {
      let ret = {
         __global : this.globalDataSet.Serialize(),
      };
      this.roomDataSets.forEach((v, k) => {
         ret[k] = v.Serialize();
      });

      return ret;
   }

   PruneData() {
      this.globalDataSet.Prune();
      this.roomDataSets.forEach(v => v.Prune());
   }

   HasData() {
      return this.globalDataSet.HasData() || [...this.roomDataSets.values() ].some(v => v.HasData());
   }

   // treat both JOIN and PART the same because either way we just want to examine the absolute user count.
   On7jamUserPart(roomState, user, roomUserCount, isJustChangingRoom) {
      this.HandleRoomUserCountChange(roomState);
   }

   On7jamUserJoin(roomState, user, roomUserCount) {
      this.HandleRoomUserCountChange(roomState);
   }

   GetDataSourceForRoom(roomID) {
      if (!this.roomDataSets.has(roomID)) {
         this.roomDataSets.set(roomID, new RangeWindowQuery.SampledSignalDataSource(0, this.maxAgeMS));
      }
      return this.roomDataSets.get(roomID);
   }

   HandleRoomUserCountChange(roomState) {
      // we want the integrations to run their queries before this event gets added, so integrations can
      // check preconditions BEFORE this event is registered. simplest way is to just settimeout
      const roomID = roomState.roomID;
      setTimeout(() => {
         const globalRoomUserCount = this.mgr._7jamAPI.GetGlobalOnlinePopulation(this.userFilter);
         this.globalDataSet.AddEvent(globalRoomUserCount);
         const dsRoom = this.GetDataSourceForRoom(roomID);
         const roomUserCount = this.mgr._7jamAPI.Get7JamUserCountForRoom(roomID, this.userFilter);
         dsRoom.AddEvent(roomUserCount);
      }, 10);
   }
}

// data sources: just return a map of underlying data sets
class NoteCountDataSource {
   constructor(mgr, dataSourceSpec, id, ourBackup) {
      this.mgr = mgr;
      this.id = id;
      this.dataSourceSpec = dataSourceSpec;
      this.binDurationMS = RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(this.dataSourceSpec.binDuration), 5000);
      this.maxAgeMS = RangeWindowQuery.DurationSpecToMS(dataSourceSpec.maxAge);
      this.fireTimer = null;  // we don't want to set a timer every single note on. instead accumulate
      this.queuedNoteOns = 0; // every time we set the fire timer, reset this. each timer process these.
      this.roomDataSets = new Map();

      // recreate datasets which are being restored from backup.
      if (ourBackup) {
         Object.keys(ourBackup).forEach(dataSetID => {
            const dataSetBackup = ourBackup[dataSetID];
            if (dataSetBackup.binSizeMS != this.binDurationMS) {
               console.log(`Looks like bin size changed; can't use backup.`);
               return;
            }
            this.roomDataSets.set(dataSetID, new RangeWindowQuery.HistogramDataSource(this.binDurationMS, this.maxAgeMS, null, dataSetBackup));
         });
      }
   }

   Serialize() {
      const roomDataDmp = {};
      this.roomDataSets.forEach((v, k) => {
         roomDataDmp[k] = v.Serialize();
      });
      return roomDataDmp;
   }

   PruneData() {
      this.roomDataSets.forEach(v => v.Prune());
   }

   HasData() {
      return [...this.roomDataSets.values() ].some(v => v.HasData());
   }

   On7jamNoteOn(roomState) {
      if (this.fireTimer) {
         this.queuedNoteOns++;
         return;
      }
      this.queuedNoteOns = 1;
      const roomID = roomState.roomID;
      this.fireTimer = setTimeout(() => {
         const noteOnsToProcess = this.queuedNoteOns;
         this.queuedNoteOns = 0;
         this.fireTimer = null;
         this.ProcessNoteOns(roomID, noteOnsToProcess);
      }, this.binDurationMS); // it's not 100% certain if this is the theoretically correct time to use, but i think it's practical and simple.
   }

   GetDataSourceForRoom(roomID) {
      if (!this.roomDataSets.has(roomID)) {
         this.roomDataSets.set(roomID, new RangeWindowQuery.HistogramDataSource(this.binDurationMS, this.maxAgeMS));
      }
      return this.roomDataSets.get(roomID);
   }

   ProcessNoteOns(roomID, noteOnsToProcess) {
      // we want the integrations to run their queries before this event gets added, so integrations can
      // check preconditions BEFORE this event is registered. simplest way is to just settimeout
      setTimeout(() => {
         const dsRoom = this.GetDataSourceForRoom(roomID);
         dsRoom.AddEvent(noteOnsToProcess);
      }, 10);
   }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class ForwardMessageFrom7jamToDiscord {
   get RequiresUserListSync() {
      return false;
   }
   constructor(subscription, integrationSpec, mgr, integrationID) {
      this.mgr = mgr;
      this.subscription = subscription;
      this.integrationSpec = integrationSpec;
      this.integrationID = integrationID;

      // set defaults
      this.integrationSpec.enabled ??= true;
      this.integrationSpec.sevenJamRoomUserCount ??= '*';

      // process some args
      this.roomUserCountRange = new RangeWindowQuery.RangeSpec(this.integrationSpec.sevenJamRoomUserCount);
   }

   GetAdminHelp() {
      return [
         "ForwardMessageFrom7jamToDiscord: Relay messages from 7jam rooms to discord channels.",
         "Commands:",
         "  enable [0,1]               Enables/disables this integration (no processing)",
         "  roomUserCount [rangeSpec]  Sets the room usercount requirement",
      ];
   }

   GetAdminStatus() {
      return [
         `Enabled          : ${this.integrationSpec.enabled ? "yes" : "no"}`,
         `roomUserCount    : ${this.integrationSpec.sevenJamRoomUserCount}`,
      ];
   }

   DoAdminCmd(args, adminLogFn) {
      args = DFU.GrabArgs(args, 2);
      if (args.length != 2) {
         adminLogFn("Incorrect args to UserCountNotification");
         return;
      }
      if (args[0] == 'enable') {
         this.integrationSpec.enabled = !!parseInt(args[1]);
         adminLogFn(`Now:  ${this.integrationSpec.enabled ? "enabled" : "disabled"}`);
         return;
      }
      if (args[0] == 'roomUserCount') {
         //this.integrationSpec.sevenJamRoomUserCount = args[1];
         adminLogFn(`not implemented yet.`);
         return;
      }
      adminLogFn(`Unknown arg ${args[0]}`);
   }

   GetDebugData() {
      return {
         integrationID : this.integrationID,
         engine : "ForwardMessageFrom7jamToDiscord",
         roomUserCountSpec: this.integrationSpec.sevenJamRoomUserCount,
      };
   }
   On7jamMessage(roomState, user, msg) {
      if (!this.integrationSpec.enabled) {
         return;
      }

      const roomUserCount = this.mgr._7jamAPI.Get7JamUserCountForRoom(this.subscription.roomID);
      if (!this.roomUserCountRange.IsMatch(roomUserCount)) {
         return;
      }
      this.mgr.bot.SendDiscordChatMessage(
          this.subscription.discordChannelID, user.name, msg.message,
          roomState.absoluteURL, roomState.roomTitle);
   }
};

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class ForwardMessageDiscordTo7jam {
   get RequiresUserListSync() {
      return true;
   }
   constructor(subscription, integrationSpec, mgr, integrationID) {
      this.mgr = mgr;
      this.subscription = subscription;
      this.integrationSpec = integrationSpec;
      this.integrationID = integrationID;

      // set defaults
      this.integrationSpec.enabled = !!(this.integrationSpec.enabled ?? true);
   }
   GetAdminHelp() {
      return [
         "ForwardMessageDiscordTo7jam: Relay messages from discord channels to 7jam rooms.",
         "Commands:",
         "  enable [0,1]   Enables/disables this integration (no processing)",
      ];
   }

   GetAdminStatus() {
      return [
         `Enabled        : ${this.integrationSpec.enabled ? "yes" : "no"}`,
      ];
   }

   DoAdminCmd(args, adminLogFn) {
      args = DFU.GrabArgs(args, 2);
      if (args.length != 2) {
         adminLogFn("Incorrect args to UserCountNotification");
         return;
      }
      if (args[0] == 'enable') {
         this.integrationSpec.enabled = !!parseInt(args[1]);
         adminLogFn(`Now:  ${this.integrationSpec.enabled ? "enabled" : "disabled"}`);
         return;
      }
      adminLogFn(`Unknown arg ${args[0]}`);
   }

   GetDebugData() {
      return {
         integrationID : this.integrationID,
         engine : "ForwardMessageDiscordTo7jam",
      };
   }
   OnDiscordMessage(message) {
      if (!this.integrationSpec.enabled) {
         return;
      }
      if (!this.mgr.bot.IsMemberValidForIntegration(message.member))
         return;
      const messageText = this.mgr.bot.DiscordMessageToString(message);
      console.log(`ForwardMessageDiscordTo7jam.OnDiscordMessage to room ${
          this.subscription.roomID} content=${messageText}`);
      this.mgr._7jamAPI.SendDiscordMessageToRoom(
          this.subscription.roomID, message.member.id, messageText);
   }
};

// replaces the discord_subscriptions config section with a class.
// a "subscription" really just represents a mapping between discord & 7jam channels.
class DiscordIntegrationSubscription {
   constructor(id, subscription, gConfig, mgr, backup) {
      this.discordChannelID = subscription['discord_channel_id'];
      this.roomID = subscription['7jam_room_id'];
      this.discordChannelDesc = subscription.discord_channel_desc || this.discordChannelID;
      this.title = `7jam:${this.roomID} => ${this.discordChannelDesc}`;
      this.gConfig = gConfig;
      this.id = id;
      this.mgr = mgr;

      this.integrations = subscription.integrations?.map(integrationID => this.CreateIntegration(integrationID, backup?.integrations?.[integrationID]));
   }

   Serialize() {
      const integrationDmp = {};
      this.integrations?.forEach(i => {
         integrationDmp[i.integrationID] = i.Serialize?.() || i.integrationID;
      });
      return {
         title : this.title,
         discordChannelDesc : this.discordChannelDesc,
         discordChannelID : this.discordChannelID,
         sevenJamRoomID : this.roomID,
         integrations : integrationDmp,
      };
   }

   CreateIntegration(integrationID, intBackup) {
      if (!integrationID) {
         throw new Error(`Integration ID is required.`);
      }
      const integrationSpec = this.gConfig.discord_integrations[integrationID];
      if (!integrationSpec) {
         throw new Error(`Integration ID is not found: ${integrationID}. Check your config.json.`);
      }

      const factory = {
         'UserCountNotification' : () => new UserCountNotification(this, integrationSpec, this.mgr, integrationID, intBackup),
         'JamStatusNotification' : () => new JamStatusNotification(this, integrationSpec, this.mgr, integrationID, intBackup),
         'ForwardMessageFrom7jamToDiscord' : () => new ForwardMessageFrom7jamToDiscord(this, integrationSpec, this.mgr, integrationID, intBackup),
         'ForwardMessageDiscordTo7jam' : () => new ForwardMessageDiscordTo7jam(this, integrationSpec, this.mgr, integrationID, intBackup),
         'ServerUpDiscordNotification' : () => new ServerUpDiscordNotification(this, integrationSpec, this.mgr, integrationID, intBackup),
         'UserListSyncOnly' : () => new UserListSyncOnly(this, integrationSpec, this.mgr, integrationID, intBackup),
         'WelcomeMessage' : () => new WelcomeMessageIntegration(this, integrationSpec, this.mgr, integrationID, intBackup),
         'AllJoinsNotification' : () => new AllJoinsNotification(this, integrationSpec, this.mgr, integrationID, intBackup),
      };

      let ret = null;
      if (!(integrationSpec.engine in factory)) {
         throw new Error(`Integration engine ${integrationSpec.engine} is unknown. Either config is bork or you forgot to register this engine in the clunky if/else block.`);
      }

      ret = factory[integrationSpec.engine]();

      console.log(`Discord integration initialized: ${this.id} / ${integrationID}`);

      return ret;
   }
}

// this provides an API for all the various integrations/notification classes to
// use, wrapping our DiscordBot, and giving a way to access 7jam actions, events
class DiscordIntegrationManager {
   constructor(gConfig, gDiscordBot, _7jamAPI, activityDatasourcesPath) {
      this.activityDatasourcesPath = activityDatasourcesPath;
      this.gConfig = gConfig;
      this.bot = gDiscordBot;
      gDiscordBot.EventHook = this;
      this._7jamAPI = _7jamAPI;

      this.dataSources = new Map(); // lazy-create, so we don't create more than we need.

      this.subscriptions = new Map();

      this.backedupDatasources = null;
      try {
         this.backedupDatasources = JSON.parse(fs.readFileSync(this.activityDatasourcesPath));
         console.log(`Read backed up activity datasources from ${this.activityDatasourcesPath}`);
      } catch (e) {
      }
      setTimeout(() => this.OnBackupDatasources(), RangeWindowQuery.DurationSpecToMS(gConfig.ActivityDatasourcesBackupInterval));

      if (!gConfig.discord_subscriptions) {
         console.log(`No Discord subscriptions are defined.`);
         return;
      }

      Object.keys(gConfig.discord_subscriptions).forEach(id => {
         const bu = this.backedupDatasources?.subscriptions?.[id];
         this.subscriptions.set(id, new DiscordIntegrationSubscription(id, gConfig.discord_subscriptions[id], gConfig, this, bu));
      });
   }

   // return an object which is HTTP served
   GetDebugData() {
      const dataSourcesDmp = {};
      this.dataSources.forEach((v, k) => {
         dataSourcesDmp[k] = v.Serialize();
      });

      const subsDmp = {};
      this.subscriptions.forEach((v, k) => {
         subsDmp[k] = v.Serialize();
      });

      return {
         dataSources : dataSourcesDmp,
         subscriptions : subsDmp, //this.subscriptions.map(subscription => subscription.GetDebugData()),
         discordInfo : this.bot.GetDebugData()
      };
   }

   GetAdminDumpObject() {
      return this.GetDebugData();
   }

   OnBackupDatasources() {
      try {
         setTimeout(() => this.OnBackupDatasources(), RangeWindowQuery.DurationSpecToMS(this.gConfig.ActivityDatasourcesBackupInterval));

         const dataSourcesDmp = {
            dataSources : {},
            subscriptions : {},
         };

         this.dataSources.forEach((v, k) => {
            // rooms to track may change between running instances; it means if the backup
            // contains like an obsolete room's data, we're going to create a dataset for an obselete room.
            // pruning means the data can be purged over time, but it implies that i should avoid serializing empty datasources/datasets.
            v.PruneData();
            if (v.HasData()) {
               dataSourcesDmp.dataSources[k] = v.Serialize();
            }
         });

         this.subscriptions.forEach((v, k) => {
            dataSourcesDmp.subscriptions[k] = v.Serialize();
         });

         const payload = JSON.stringify(dataSourcesDmp, null, 2);
         fsp.writeFile(this.activityDatasourcesPath, payload, 'utf8');
         console.log(`Backed up activity data sources to ${this.activityDatasourcesPath} (${payload.length} len)`);

      } catch (e) {
         console.log(`DiscordIntegrationManager.OnBackupDatasources exception occurred`);
         console.log(e);
      }
   }

   GetDataSource(id) {
      if (!this.dataSources.has(id)) {
         console.assert(id in this.gConfig.activity_hook_data_sources, `a subscription is referencing a datasource '${id}' which is not a known data source id`);
         const spec = this.gConfig.activity_hook_data_sources[id];

         const dataSourceEngineFactory = {
            'UserCounts' : (mgr, spec) => new UserCountsDataSource(mgr, spec, id, this.backedupDatasources?.dataSources?.[id]),
            'NoteCount' : (mgr, spec) => new NoteCountDataSource(mgr, spec, id, this.backedupDatasources?.dataSources?.[id]),
         };
         console.assert(spec.engine in dataSourceEngineFactory, `data source id ${id} references non-existent engine ${spec.engine}`);

         this.dataSources.set(id, dataSourceEngineFactory[spec.engine](this, spec));
      }

      return this.dataSources.get(id);
   }

   ReplaceQueryVariables(str) {
      Object.keys(this.gConfig.variables).forEach(k => {
         str = str.toString().replaceAll(`%${k}%`, this.gConfig.variables[k]);
      });
      return str;
   }

   // gDiscordBot.EventHook
   OnDiscordMessage(message) {
      this.DelegateIntegrationsFromDiscord(
          message.channelId, (integrationObject) => {
             // console.log(`forwarding OnDiscordMessage to an integration
             // ${integrationID}`);
             integrationObject.OnDiscordMessage?.(message);
          });
   }

   // gDiscordBot.EventHook
   OnDiscordMemberJoin(channel, member) {
      this.Get7JamRoomsIDsForDiscordMemberSync(channel.id).forEach(roomID => {
         console.log(`OnDiscordMemberJoin ${channel.id} <--> 7jam room ${roomID} += ${member.displayName} color=${member.displayHexColor}`);
         this._7jamAPI.UpdateDiscordUserInRoom(roomID, member.displayName, member.displayHexColor, member.id);
      });
   }

   // gDiscordBot.EventHook
   OnDiscordMemberUpdate(oldMember, newMember) {
      this.Get7JamRoomsIDsForDiscordMemberSync(channel.id).forEach(roomID => {
         this._7jamAPI.UpdateDiscordUserInRoom(roomID, newMember.displayName, member.displayHexColor, newMember.id);
      });
   }

   // gDiscordBot.EventHook
   OnDiscordMemberPart(channel, memberID) {
      this.Get7JamRoomsIDsForDiscordMemberSync(channel.id).forEach(roomID => {
         this._7jamAPI.RemoveDiscordUserInRoom(roomID, memberID);
      });
   }

   // Notifications from 7jam
   OnRoomsLoaded(rooms) {
      this.subscriptions.forEach(subscription => {
         subscription.integrations?.forEach(integration => {
            integration.On7jamRoomsLoaded?.(rooms);
         });
      });
   }

   OnDiscordInitialized() {
      this.subscriptions.forEach(subscription => {
         subscription.integrations?.forEach(integration => {
            integration.OnDiscordInitialized?.();
         });
      });
   }

   OnUserWelcome(roomState, user, roomUserCount, isJustChangingRoom) {
      this.DelegateIntegrationsFrom7jam(roomState.roomID, (integrationObject) => {
         integrationObject.On7jamUserJoin?.(roomState, user, roomUserCount, isJustChangingRoom);
      });
   }

   OnUserLeave(roomState, user, roomUserCount, isJustChangingRoom) {
      this.DelegateIntegrationsFrom7jam(roomState.roomID, (integrationObject) => {
         integrationObject.On7jamUserPart?.(roomState, user, roomUserCount, isJustChangingRoom);
      });
   }

   OnInstrumentAcquire(roomState, user, instrument) {
      this.DelegateIntegrationsFrom7jam(roomState.roomID, (integrationObject) => {
         integrationObject.On7jamInstrumentAcquire?.(roomState, user, instrument);
      });
   }

   OnNoteOn(roomState) {
      this.DelegateIntegrationsFrom7jam(roomState.roomID, (integrationObject) => {
         integrationObject.On7jamNoteOn?.(roomState);
      });
   }

   OnCheer(roomState) {
      this.DelegateIntegrationsFrom7jam(roomState.roomID, (integrationObject) => {
         integrationObject.On7jamCheer?.(roomState);
      });
   }

   // on 7jam message
   OnMessage(roomState, user, msg) {
      this.DelegateIntegrationsFrom7jam(roomState.roomID, (integrationObject) => {
         integrationObject.On7jamMessage?.(roomState, user, msg);
      });
   }

   DelegateIntegrationsFrom7jam(sevenJamRoomID, fn) {
      this.dataSources.forEach(ds => {
         fn(ds);
      });
      this.subscriptions.forEach(subscription => {
         if (subscription.roomID !== sevenJamRoomID)
            return;
         subscription.integrations?.forEach(integration => {
            fn(integration);
         });
      });
   }

   DelegateIntegrationsFromDiscord(channelId, fn) {
      this.subscriptions.forEach(subscription => {
         if (subscription.discordChannelID !== channelId)
            return;
         subscription.integrations?.forEach(integration => {
            fn(integration);
         });
      });
   }

   Get7JamRoomsIDsForDiscordMemberSync(channelId) {
      const ret = new Set();
      this.subscriptions.forEach(subscription => {
         if (subscription.discordChannelID !== channelId)
            return;
         if (!subscription.integrations?.some(integration => integration.RequiresUserListSync))
            return;
         ret.add(subscription.roomID);
      });

      return [...ret ];
   }
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class StatsLogger {
   static getHourID(roomID) {
      // YYYYMMDD_HH__roomid
      let d = new Date();
      return `${d.getUTCFullYear()}${
          (d.getUTCMonth() + 1).toString().padStart(2, '0')}${
          d.getUTCDate().toString().padStart(
              2, '0')}_${d.getUTCHours().toString().padStart(2, '0')}__${roomID}`;
   }

   // see stats.html for a more complete version
   static parseHourID = id => {
      // 20210106_15__pub
      // "2021-01-06T14:01:01.000Z"
      //  YYYY-MM-DDTHH:mm:ss.sssZ
      let u1 = id.indexOf('_');
      let u2 = id.indexOf('__');
      let roomID = id.substring(u2 + 2);
      let hourOfDay = parseInt(id.substring(u1 + 1, u2));
      let yyyy = (id.substring(0, 4));
      let mm = (id.substring(4, 6));
      let dd = (id.substring(6, 8));
      return {
         hourID : id,
         hourOfDay,
         roomID,
         // dayID: `${yyyy}-${mm}-${dd}`,
         // dayDate: (new Date(`${yyyy}-${mm}-${dd}T01:01:01.000Z`)),
         date : (new Date(`${yyyy}-${mm}-${dd}T${hourOfDay.toString().padStart(2, '0')}:01:01.000Z`)),
      };
   };

   static emptyStatsObj() {
      return {
         joins : 0,
         notes : 0,
         cheers : 0,
         messages : 0,
         paramChanges : 0,
         maxUsers : 0,
         presetsSaved : 0,
      };
   }

   constructor(path, mongoDB) {
      console.log(`Initializing stats file logger @ ${path}`);
      this.path = path;
      this.mongoDB = mongoDB;

      this.queuedByHourObj = {};

      try {
         this.serverStats = JSON.parse(fs.readFileSync(path));
      } catch (e) {
         console.log(`Starting a new statistics obj.`);
         this.serverStats = {byHour : {}};
      }

      // to track user stats, map user => stats obj. stats obj is the same as in
      // DigifuUser
      this.queuedUserStats = {};

      setTimeout(() => this.OnFlushTimer(), DF.ServerSettings.StatsFlushMS);
      setTimeout(
          () => this.OnStatsPruneInterval(),
          DF.ServerSettings.StatsPruneIntervalMS);
   }

   // removes old server statistics
   OnStatsPruneInterval() {
      try {
         const m1 = new Date();

         setTimeout(
             () => this.OnStatsPruneInterval(),
             DF.ServerSettings.StatsPruneIntervalMS);

         const keysToRemove = [];
         const now = new Date();
         const byHour = this.serverStats.byHour;
         Object.keys(byHour).forEach(k => {
            const x = StatsLogger.parseHourID(k);
            if ((now - x.date) > DF.ServerSettings.StatsMaxAgeMS) {
               keysToRemove.push(k);
            }
         });

         keysToRemove.forEach(k => {
            delete byHour[k];
         });

         console.log(`OnStatsPruneInterval took ${
             ((new Date() - m1) / 1000).toFixed(3)} sec`);
      } catch (e) {
         console.log(`OnStatsPruneInterval exception occurred`);
         console.log(e);
      }
   }

   // update stats file and database
   OnFlushTimer() {
      try {
         setTimeout(() => this.OnFlushTimer(), DF.ServerSettings.StatsFlushMS);
         fsp.writeFile(
             this.path, JSON.stringify(this.serverStats, null, 2), 'utf8');

         // TODO: write queued server stats to mongodb

         // write queued user stats to mongodb
         this.mongoDB.UpdateUserStats(this.queuedUserStats);
         this.queuedUserStats = {};

      } catch (e) {
         console.log(`OnFlushTimer exception occurred`);
         console.log(e);
      }
   }

   updateQueuedStats(
       roomID, user, updateRoomStatsCallback, updateUserStatsCallback) {
      let hourID = StatsLogger.getHourID(roomID);
      this.serverStats.byHour[hourID] = updateRoomStatsCallback(
          this.serverStats.byHour[hourID] || StatsLogger.emptyStatsObj());
      if (user.hasPersistentIdentity) {
         this.queuedUserStats[user.persistentID] = updateUserStatsCallback(
             this.queuedUserStats[user.persistentID] || DF.DigifuUser.emptyStatsObj());
      }
   }

   OnUserWelcome(roomState, user, roomUserCount, isJustChangingRoom) {
      this.updateQueuedStats(
          roomState.roomID, user,
          h => {
             h.joins++;
             h.maxUsers = Math.max(roomUserCount, h.maxUsers);
             return h;
          },
          us => {
             us.joins++;
             return us;
          });
   }

   OnNoteOn(roomState, user) {
      this.updateQueuedStats(
          roomState.roomID, user,
          h => {
             h.notes++;
             return h;
          },
          us => {
             us.noteOns++;
             return us;
          });
   }

   OnCheer(roomState, user) {
      this.updateQueuedStats(
          roomState.roomID, user,
          h => {
             h.cheers++;
             return h;
          },
          us => {
             us.cheers++;
             return us;
          });
   }

   OnMessage(roomState, user, msg) {
      this.updateQueuedStats(
          roomState.roomID, user,
          h => {
             h.messages++;
             return h;
          },
          us => {
             us.messages++;
             return us;
          });
   }

   OnPresetSave(roomState, user, instrumentName, presetName) {
      this.updateQueuedStats(
          roomState.roomID, user,
          h => {
             h.presetsSaved++;
             return h;
          },
          us => {
             us.presetsSaved++;
             return us;
          });
   }
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class ActivityHook {
   constructor(hooks) {
      this.Hooks = hooks;
   }

   OnRoomsLoaded(rooms) {
      setTimeout(() => {
         this.Hooks.forEach(o => {
            o?.OnRoomsLoaded?.(rooms);
         });
      }, 0);
   }

   OnDiscordInitialized() {
      setTimeout(() => {
         this.Hooks.forEach(o => {
            o?.OnDiscordInitialized?.();
         });
      }, 0);
   }

   OnUserWelcome(roomState, user, roomUserCount, isJustChangingRoom) {
      setTimeout(() => {
         this.Hooks.forEach(o => {
            o?.OnUserWelcome?.(roomState, user, roomUserCount, isJustChangingRoom);
         });
      }, 0);
   }

   OnUserLeave(roomState, user, roomUserCount, isJustChangingRoom) {
      setTimeout(() => {
         this.Hooks.forEach(o => {
            if (!o.OnUserLeave)
               return;
            o.OnUserLeave?.(roomState, user, roomUserCount, isJustChangingRoom);
         });
      }, 0);
   }

   OnInstrumentAcquire(roomState, user, instrument) {
      setTimeout(() => {
         this.Hooks.forEach(o => {
            o?.OnInstrumentAcquire?.(roomState, user, instrument);
         });
      }, 0);
   }

   OnNoteOn(roomState, user) {
      setTimeout(() => {
         this.Hooks.forEach(o => {
            if (!o.OnNoteOn)
               return;
            o.OnNoteOn?.(roomState, user);
         });
      }, 0);
   }

   OnCheer(roomState, user) {
      setTimeout(() => {
         this.Hooks.forEach(o => {
            if (!o.OnCheer)
               return;
            o.OnCheer?.(roomState, user);
         });
      }, 0);
   }

   OnMessage(roomState, user, msg) {
      setTimeout(() => {
         // if a message did not originate  from 7jam (discord messages which have
         // been forwarded to 7jam e.g.) then ignore.
         if (msg.source !== DF.eMessageSource.SevenJam) {
            // console.log(`message source ${msg.source} should not be tracked.`);
            return;
         }
         this.Hooks.forEach(o => {
            if (!o.OnMessage)
               return;
            o.OnMessage?.(roomState, user, msg);
         });
      }, 0);
   }

   OnParamChange(roomState, user, paramCount) {
      // not currently important.
   }

   OnPresetSave(roomState, user, instrumentName, presetName) {
      setTimeout(() => {
         this.Hooks.forEach(o => {
            if (!o.OnPresetSave)
               return;
            o.OnPresetSave?.(roomState, user, instrumentName, presetName);
         });
      }, 0);
   }
};

module.exports = {
   ActivityHook,
   StatsLogger,
   DiscordIntegrationManager,
};
