const https = require('https')
const DF = require('./clientsrc/DFCommon');
const fsp = require('fs').promises;
const fs = require('fs');
const DFDB = require('./DFDB');
const RangeWindowQuery = require("./clientsrc/RangeWindowQuery");
const {UserCountNotification} = require('./clientsrc/UserCountNotification');
const {ServerUpDiscordNotification} = require('./clientsrc/ServerUpDiscordNotification');
const {NoteCountNotification} = require('./clientsrc/NoteCountNotification');

// these various integration engines will get some properties added by the
// caller automatically: this.subscription (containing channel mappings)
// this.integrationSpec (containing the tweakable params for this engine)
// this.mgr (gateway to actually doing stuff with the app)

class ForwardMessageFrom7jamToDiscord {
   get RequiresUserListSync() {
      return false;
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

// accumulates stats during a detected jam period.
// it will act as an integration in order to hook events.
class JamTracker {
   constructor(gConfig, roomID, _7jamAPI) {
      this._7jamAPI = _7jamAPI;
      this.roomID = roomID;

      this.maxJamDurationMS = RangeWindowQuery.DurationSpecToMS(gConfig.jam_tracker_max_duration);

      this.jamOn = false;
      this.jamUserIDs = new Set();
      this.jamOnStartTimeMS = 0;
      this.jamOnNoteCount = 0;
   }

   IsJamRunning() {
      if (!this.jamOn)
         return false;
      const durationMS = Date.now() - this.jamOnStartTimeMS;
      if (durationMS > this.maxJamDurationMS)
         return false;
      return true;
   }

   RegisterJamStart(initialNoteOns) {
      this.jamOn = true;
      this.jamOnStartTimeMS = Date.now();
      this.jamOnNoteCount = this._7jamAPI.Get7JamNoteCountForRoom(this.roomID) - initialNoteOns;
      this.jamMinUserCount = this.jamMaxUserCount = this._7jamAPI.Get7JamUserCountForRoom(this.roomID);
      this.jamInstrumentChanges = 0;
      this.jamUserIDs = new Set(this._7jamAPI.GetRoomState(this.roomID).users.filter(u => u.source === DF.eUserSource.SevenJam).map(u => u.userID));
   }

   RegisterJamEnd() {
      this.jamOn = false;
   }

   On7jamUserJoin(roomState, user, roomUserCount, isJustChangingRoom) {
      if (roomState.roomID !== this.roomID)
         return;
      this.jamUserIDs.add(user.userID);
      this.jamMinUserCount = Math.min(this.jamMinUserCount, roomUserCount);
      this.jamMaxUserCount = Math.max(this.jamMaxUserCount, roomUserCount);
   }

   On7jamInstrumentAcquire(roomState, user, instrument) {
      if (roomState.roomID !== this.roomID)
         return;
      this.jamInstrumentChanges++;
   }

   // may return null if there's nothing to see here.
   GetJamStats() {
      if (!this.jamOn)
         return null;
      const durationMS = Date.now() - this.jamOnStartTimeMS
      if (durationMS > this.maxJamDurationMS)
      return null;
      const notesPlayed = this._7jamAPI.Get7JamNoteCountForRoom(this.roomID) - this.jamOnNoteCount;
      return {
         durationMS,
         notesPlayed,
         uniqueUsers: this.jamUserIDs.size,
         maxUserCount: this.jamMaxUserCount,
         minUserCount: this.jamMinUserCount,
         instrumentChanges: this.jamInstrumentChanges,
      };
   }
};

// replaces the discord_subscriptions config section with a class.
// a "subscription" really just represents a mapping between discord & 7jam channels.
class DiscordIntegrationSubscription {
   constructor(id, subscription, gConfig, mgr) {
      this.discordChannelID = subscription['discord_channel_id'];
      this.roomID = subscription['7jam_room_id'];
      this.description = subscription.description;
      this.gConfig = gConfig;
      this.id = id;
      this.mgr = mgr;
      this.groups = new Map(); // map group name to some info including time MS last sent
      this.jamTracker = new JamTracker(gConfig, this.roomID, this.mgr._7jamAPI);

      this.integrations = subscription.integrations.map(integrationID => this.CreateIntegration(integrationID));
      this.integrations.push(this.jamTracker);
   }

   CreateIntegration(integrationID) {
      const integrationSpec = this.gConfig.discord_integrations[integrationID];
      if (!integrationSpec) {
         throw new Error(`Integration ID is not found: ${integrationID}. Check your config.json.`);
      }
      let ret = null;
      if (integrationSpec.engine === 'UserCountNotification') {
         ret = new UserCountNotification(this, integrationSpec, this.mgr);
      } else if (integrationSpec.engine === 'ForwardMessageFrom7jamToDiscord') {
         ret = new ForwardMessageFrom7jamToDiscord(this, integrationSpec, this.mgr);
      } else if (integrationSpec.engine === 'ForwardMessageDiscordTo7jam') {
         ret = new ForwardMessageDiscordTo7jam(this, integrationSpec, this.mgr);
      } else if (integrationSpec.engine === 'ServerUpDiscordNotification') {
         ret = new ServerUpDiscordNotification(this, integrationSpec, this.mgr);
      } else if (integrationSpec.engine === 'NoteCountNotification') {
         ret = new NoteCountNotification(this, integrationSpec, this.mgr);
      } else {
         throw new Error(`Integration engine ${integrationSpec.engine} is unknown. Either config is bork or you forgot to register this engine in the clunky if/else block.`);
      }

      console.log(`Discord integration initialized: ${this.id} / ${integrationID} // ${this.description}`);
      ret.mgr = this.mgr;
      ret.subscription = this;
      ret.integrationSpec = integrationSpec;
      ret.integrationID = integrationID;

      return ret;
   }

   // in order to rate-limit between integration engines/instances
   RegisterNotificationSent(groupName) {
      if (!groupName) {
         throw new Error(`RegisterNotificationSent:You must specify a notification groupName`);
      }
      this.groups.set(groupName, Date.now());
   }

   // if positive, then the message should be rate-limited at least this # of MS.
   // if <= 0, no rate-limiting is necessary.
   RateLimitedTimeRemainingMS(groupName, msInFuture, rateLimitMS) {
      if (isNaN(rateLimitMS) || !rateLimitMS) {
         return 0; // 0 or undefined means we don't want to rate-limit this notification.
      }
      if (!groupName) {
         throw new Error(`RegisterNotificationSent:You must specify a notification groupName`);
      }
      if (!this.groups.has(groupName)) {
         return 0;
      }
      const lastMsgTimeMS = this.groups.get(groupName);
      const timeBoundaryMS = Date.now() - rateLimitMS + msInFuture;
      return lastMsgTimeMS - timeBoundaryMS;
   }
}

// this provides an API for all the various integrations/notification classes to
// use, wrapping our DiscordBot, and giving a way to access 7jam actions, events
class DiscordIntegrationManager {
   constructor(gConfig, gDiscordBot, _7jamAPI) {
      this.gConfig = gConfig;
      this.bot = gDiscordBot;
      gDiscordBot.EventHook = this;
      this._7jamAPI = _7jamAPI;

      this.subscriptions = [];

      if (!gConfig.discord_subscriptions) {
         console.log(`No Discord subscriptions are defined.`);
         return;
      }

      for (let i = 0; i < gConfig.discord_subscriptions.length; ++i) {
         this.subscriptions.push(new DiscordIntegrationSubscription(i, gConfig.discord_subscriptions[i], gConfig, this));
      }
   }

   ReplaceQueryVariables(str) {
      Object.keys(this.gConfig.queryVariables).forEach(k => {
         str = str.toString().replaceAll(`%${k}%`, this.gConfig.queryVariables[k]);
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
// https://github.com/typicode/lowdb
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
// https://github.com/typicode/lowdb
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
