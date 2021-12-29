const https = require('https')
const DF = require('./clientsrc/DFCommon');
const fsp = require('fs').promises;
const fs = require('fs');
const DFDB = require('./DFDB');
const RangeWindowQuery = require("./clientsrc/RangeWindowQuery");
const {UserCountNotification} = require('./clientsrc/UserCountNotification');
const {ServerUpDiscordNotification} = require('./clientsrc/ServerUpDiscordNotification');
const {JamStatusNotification} = require('./clientsrc/NoteCountNotification');

class UserCountsDataSource {
   constructor(mgr, dataSourceSpec) {
      this.mgr = mgr;
      this.dataSourceSpec = dataSourceSpec;
      this.globalDataSource = new RangeWindowQuery.SampledSignalDataSource(0);
      this.roomDataSources = new Map();
   }

   // data sources: just return a map of underlying data sets
   GetDebugData() {
      let ret = {
         __global : this.globalDataSource.GetDebugData(),
      };
      //const roomDataDmp = {};
      this.roomDataSources.forEach((v, k) => {
         ret[`# ${k}`] = v.GetDebugData();
      });

      return ret;
   }

   // treat both JOIN and PART the same because either way we just want to examine the absolute user count.
   On7jamUserPart(roomState, user, roomUserCount, isJustChangingRoom) {
      this.HandleRoomUserCountChange(roomState, roomUserCount, isJustChangingRoom);
   }

   On7jamUserJoin(roomState, user, roomUserCount, isJustChangingRoom) {
      this.HandleRoomUserCountChange(roomState, roomUserCount, isJustChangingRoom);
   }

   GetDataSourceForRoom(roomID) {
      if (!this.roomDataSources.has(roomID)) {
         this.roomDataSources.set(roomID, new RangeWindowQuery.SampledSignalDataSource(0));
      }
      return this.roomDataSources.get(roomID);
   }

   HandleRoomUserCountChange(roomState, roomUserCount, isJustChangingRoom) {
      // we want the integrations to run their queries before this event gets added, so integrations can
      // check preconditions BEFORE this event is registered. simplest way is to just settimeout
      const roomID = roomState.roomID;
      setTimeout(() => {
         const globalRoomUserCount = this.mgr._7jamAPI.GetGlobalOnlinePopulation();
         this.globalDataSource.AddEvent(globalRoomUserCount);
         const dsRoom = this.GetDataSourceForRoom(roomID);
         dsRoom.AddEvent(roomUserCount);
      }, 10);
   }
}

// data sources: just return a map of underlying data sets
class NoteCountDataSource {
   constructor(mgr, dataSourceSpec) {
      this.mgr = mgr;
      this.dataSourceSpec = dataSourceSpec;
      this.binDurationMS = RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(this.dataSourceSpec.binDuration), 5000);
      //this.dataSource = new RangeWindowQuery.HistogramDataSource(this.binDurationMS, null, null);
      this.roomDataSources = new Map();
      this.fireTimer = null;  // we don't want to set a timer every single note on. instead accumulate
      this.queuedNoteOns = 0; // every time we set the fire timer, reset this. each timer process these.
   }

   GetDebugData() {
      const roomDataDmp = {};
      this.roomDataSources.forEach((v, k) => {
         roomDataDmp[k] = v.GetDebugData();
      });

      return roomDataDmp;
      //{
      //    queuedNoteOns : this.queuedNoteOns,
      //    binDurationMS : this.binDurationMS,
      //    roomData : roomDataDmp,
      // };
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
      if (!this.roomDataSources.has(roomID)) {
         this.roomDataSources.set(roomID, new RangeWindowQuery.HistogramDataSource(this.binDurationMS, null, null));
      }
      return this.roomDataSources.get(roomID);
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

class ForwardMessageFrom7jamToDiscord {
   get RequiresUserListSync() {
      return false;
   }
   constructor(subscription, integrationSpec, mgr, integrationID) {
      this.mgr = mgr;
      this.subscription = subscription;
      this.integrationSpec = integrationSpec;
      this.integrationID = integrationID;
   }
   GetDebugData() {
      return {
         integrationID : this.integrationID,
         engine : "ForwardMessageFrom7jamToDiscord",
      };
   }
   On7jamMessage(roomState, user, msg) {
      this.mgr.bot.SendDiscordChatMessage(
          this.subscription.discordChannelID, user.name, msg.message,
          roomState.absoluteURL, roomState.roomTitle);
   }
};

class ForwardMessageDiscordTo7jam {
   get RequiresUserListSync() {
      return true;
   }
   constructor(subscription, integrationSpec, mgr, integrationID) {
      this.mgr = mgr;
      this.subscription = subscription;
      this.integrationSpec = integrationSpec;
      this.integrationID = integrationID;
   }

   GetDebugData() {
      return {
         integrationID : this.integrationID,
         engine : "ForwardMessageDiscordTo7jam",
      };
   }
   OnDiscordMessage(message) {
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
   constructor(id, subscription, gConfig, mgr) {
      this.discordChannelID = subscription['discord_channel_id'];
      this.roomID = subscription['7jam_room_id'];
      this.discordChannelDesc = subscription.discord_channel_desc || this.discordChannelID;
      this.title = `7jam:${this.roomID} => ${this.discordChannelDesc}`;
      this.gConfig = gConfig;
      this.id = id;
      this.mgr = mgr;
      this.groups = new Map(); // map group name to time MS last sent
      //this.jamTracker = new JamTracker(gConfig, this.roomID, this.mgr._7jamAPI);

      this.integrations = subscription.integrations.map(integrationID => this.CreateIntegration(integrationID));
      //this.integrations.push(this.jamTracker);
   }

   GetDebugData() {
      const groupInfo = {};
      return {
         id : this.id,
         title : this.title,
         discordChannelDesc : this.discordChannelDesc,
         discordChannelID : this.discordChannelID,
         sevenJamRoomID : this.roomID,
         groups : groupInfo,
         //jamTracker : this.jamTracker.GetDebugData(),
         integrations : this.integrations.map(i => i.GetDebugData()),
      };
   }

   CreateIntegration(integrationID) {
      if (!integrationID) {
         throw new Error(`Integration ID is required.`);
      }
      const integrationSpec = this.gConfig.discord_integrations[integrationID];
      if (!integrationSpec) {
         throw new Error(`Integration ID is not found: ${integrationID}. Check your config.json.`);
      }

      const factory = {
         'UserCountNotification' : () => new UserCountNotification(this, integrationSpec, this.mgr, integrationID),
         //'NoteCountNotification' : () => new NoteCountNotification(this, integrationSpec, this.mgr, integrationID),
         'JamStatusNotification' : () => new JamStatusNotification(this, integrationSpec, this.mgr, integrationID),
         'ForwardMessageFrom7jamToDiscord' : () => new ForwardMessageFrom7jamToDiscord(this, integrationSpec, this.mgr, integrationID),
         'ForwardMessageDiscordTo7jam' : () => new ForwardMessageDiscordTo7jam(this, integrationSpec, this.mgr, integrationID),
         'ServerUpDiscordNotification' : () => new ServerUpDiscordNotification(this, integrationSpec, this.mgr, integrationID),
      };

      let ret = null;
      if (!(integrationSpec.engine in factory)) {
         throw new Error(`Integration engine ${integrationSpec.engine} is unknown. Either config is bork or you forgot to register this engine in the clunky if/else block.`);
      }

      ret = factory[integrationSpec.engine]();

      console.log(`Discord integration initialized: ${this.id} / ${integrationID}`);
      // ret.mgr = this.mgr;
      // ret.subscription = this;
      // ret.integrationSpec = integrationSpec;
      // ret.integrationID = integrationID;

      return ret;
   }

   // // in order to rate-limit between integration engines/instances
   // RegisterNotificationSent(groupName) {
   //    if (!groupName) {
   //       throw new Error(`RegisterNotificationSent:You must specify a notification groupName`);
   //    }
   //    this.groups.set(groupName, Date.now());
   // }

   // // if positive, then the message should be rate-limited at least this # of MS.
   // // if <= 0, no rate-limiting is necessary.
   // RateLimitedTimeRemainingMS(groupName, msInFuture, rateLimitMS) {
   //    if (isNaN(rateLimitMS) || !rateLimitMS) {
   //       return 0; // 0 or undefined means we don't want to rate-limit this notification.
   //    }
   //    if (!groupName) {
   //       throw new Error(`RegisterNotificationSent:You must specify a notification groupName`);
   //    }
   //    if (!this.groups.has(groupName)) {
   //       return 0;
   //    }
   //    const lastMsgTimeMS = this.groups.get(groupName);
   //    const timeBoundaryMS = Date.now() - rateLimitMS + msInFuture;
   //    return lastMsgTimeMS - timeBoundaryMS;
   // }
}

// this provides an API for all the various integrations/notification classes to
// use, wrapping our DiscordBot, and giving a way to access 7jam actions, events
class DiscordIntegrationManager {
   constructor(gConfig, gDiscordBot, _7jamAPI) {
      this.gConfig = gConfig;
      this.bot = gDiscordBot;
      gDiscordBot.EventHook = this;
      this._7jamAPI = _7jamAPI;

      this.dataSources = new Map(); // lazy-create, so we don't create more than we need.

      this.subscriptions = [];

      if (!gConfig.discord_subscriptions) {
         console.log(`No Discord subscriptions are defined.`);
         return;
      }

      for (let i = 0; i < gConfig.discord_subscriptions.length; ++i) {
         this.subscriptions.push(new DiscordIntegrationSubscription(i, gConfig.discord_subscriptions[i], gConfig, this));
      }
   }

   // return an object which is HTTP served
   GetDebugData() {
      const dataSourcesDmp = {};
      this.dataSources.forEach((v, k) => {
         dataSourcesDmp[k] = v.GetDebugData();
      });

      return {
         dataSources : dataSourcesDmp,
         subscriptions : this.subscriptions.map(subscription => subscription.GetDebugData()),
         discordInfo : this.bot.GetDebugData()
      };
   }

   GetDataSource(id) {
      if (!this.dataSources.has(id)) {
         console.assert(id in this.gConfig.activity_hook_data_sources, `a subscription is referencing a datasource '${id}' which is not a known data source id`);
         //Object.keys(gConfig.activity_hook_data_sources).forEach(dsID => {
         const spec = this.gConfig.activity_hook_data_sources[id];

         const dataSourceEngineFactory = {
            'UserCounts' : (mgr, spec) => new UserCountsDataSource(mgr, spec),
            'NoteCount' : (mgr, spec) => new NoteCountDataSource(mgr, spec),
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
         subscription.integrations.forEach(integration => {
            integration.On7jamRoomsLoaded?.(rooms);
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
         subscription.integrations.forEach(integration => {
            fn(integration);
         });
      });
   }

   DelegateIntegrationsFromDiscord(channelId, fn) {
      this.subscriptions.forEach(subscription => {
         if (subscription.discordChannelID !== channelId)
            return;
         subscription.integrations.forEach(integration => {
            fn(integration);
         });
      });
   }

   Get7JamRoomsIDsForDiscordMemberSync(channelId) {
      const ret = new Set();
      this.subscriptions.forEach(subscription => {
         if (subscription.discordChannelID !== channelId)
            return;
         if (!subscription.integrations.some(integration => integration.RequiresUserListSync))
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
         this.queuedUserStats[user.userID] = updateUserStatsCallback(
             this.queuedUserStats[user.userID] || DF.DigifuUser.emptyStatsObj());
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
