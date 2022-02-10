const RangeWindowQuery = require("./RangeWindowQuery");
const DFU = require('../DFcommon/dfutil');

// instantiated once per subscription.
class UserCountNotificationIntegrationState {
   constructor(integrationSpec, mgr, integrationID) {
      this.mgr = mgr;
      this.integrationSpec = integrationSpec;
      this.integrationID = integrationID;

      this.subscriptions = [];

      this.uniqueMessages = new Map(); // map messagekey to time when first sent
      this.joinTimer = null;
      this.partTimer = null;

      // set defaults & validate spec
      this.integrationSpec.enabled ??= true;
      this.integrationSpec.messageKey ??= '';
      this.integrationSpec.messageKey = this.integrationSpec.messageKey.toString(); // avoid numeric types etc.
      this.integrationSpec.uniqueMessageAge ??= '4h';
      this.uniqueMessageAgeMS = RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(this.integrationSpec.uniqueMessageAge));

      this.joinDelayMS = RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(integrationSpec.join.delay));
      this.joinQuery = new RangeWindowQuery.RangeDurationQuery(mgr.ReplaceQueryVariables(integrationSpec.join.query));
      console.assert(integrationSpec.join.messageContent);

      this.partIntevalMS = RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(integrationSpec.part.interval));
      this.partQuery = new RangeWindowQuery.RangeDurationQuery(mgr.ReplaceQueryVariables(integrationSpec.part.query));
      console.assert(integrationSpec.part.messageContent);

      // warm up data source
      this.GetDataSource();

      // similar to jam tracker, the "join query" will put us in "joined state", then we move to the "part" stage. this variable tracks that state.
      this.joinedState = false;
   }

   RegisterSubscription(subscription) {
      this.subscriptions.push(subscription);
   }

   GetDataSource() {
      const ds = this.mgr.GetDataSource(this.integrationSpec.dataSourceID);
      return ds.globalDataSet;
   }

   PruneMessageKeys() {
      const boundary = Date.now() - this.uniqueMessageAgeMS;
      const keysToDelete = [];
      this.uniqueMessages.forEach((v, k) => {
         if (v <= boundary)
            keysToDelete.push(k);
      });
      if (keysToDelete.length) {
         if (this.integrationSpec.verboseDebugLogging) {
            console.log(`${this.integrationID} Deleting ${keysToDelete.length} message keys:`);
            keysToDelete.forEach(k => { console.log(`  - ${k}`); });
         }
      }
      keysToDelete.forEach(k => this.uniqueMessages.delete(k));
   }

   Log(msg) {
      this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${msg}`);
   }

   SendMessage(mustBeUnique, eventState, messageContent, messageFields) {
      const subscription = this.subscriptions.find(s => s.roomID === eventState.roomID);
      console.assert(subscription, `How can we be catch join/parts to a room, but the subscription hasn't been registered to global state?`);

      let substitutions = {};
      substitutions[`%roomName%`] = eventState.roomTitle;
      substitutions[`%userName%`] = eventState.userName;
      substitutions['%roomUserCount%'] = this.mgr._7jamAPI.Get7JamUserCountForRoom(subscription.roomID);
      substitutions['%roomNoteCount%'] = this.mgr._7jamAPI.Get7JamNoteCountForRoom(subscription.roomID).toLocaleString();

      let messageText = DFU.PerformSubstitutions(messageContent, substitutions);

      if (mustBeUnique && this.integrationSpec.messageKey.length) {
         let messageKey = DFU.PerformSubstitutions(this.integrationSpec.messageKey, substitutions);
         this.PruneMessageKeys();
         if (this.uniqueMessages.has(messageKey)) {
            this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} Suppressing notification because we already sent it.`);
            return false;
         }

         this.uniqueMessages.set(messageKey, Date.now());
      }

      console.log(`${this.integrationID} ** sending discord notification: ${messageText}`);

      this.mgr.bot.SendDiscordEmbedMessage(subscription.discordChannelID, eventState.absoluteURL,
                                           messageText,
                                           DFU.ProcessMessageFields(messageFields, substitutions));
      return true;
   }

   On7jamUserPart(roomState, user) {
      this.lastPartEventState = {
         roomID:roomState.roomID,
         roomTitle: roomState.roomTitle,
         absoluteURL: roomState.absoluteURL,
         userName: user.name,
      };
   }

   On7jamUserJoin(roomState, user) {
      if (this.joinedState)
         return; // once joined state, we operate on an interval timer so no processing needed.

      if (!this.integrationSpec.enabled) {
         this.Log(`Suppressing HandleRoomUserCountChange because disabled.`);
         return;
      }

      if (this.joinTimer) {
         this.Log(`Replacing existing join timer`);
         clearTimeout(this.joinTimer);
      }
      this.Log(`Setting join timer for ${this.joinDelayMS} ms`);

      const eventState = {
         roomID:roomState.roomID,
         roomTitle: roomState.roomTitle,
         absoluteURL: roomState.absoluteURL,
         userName: user.name,
      };

      this.joinTimer = setTimeout(() => this.JoinDelayTimerProc(eventState), this.joinDelayMS);
   }

   JoinDelayTimerProc(eventState) {
      this.joinTimer = null;
      const joinQueryPass = this.GetDataSource().IsMatch(this.joinQuery, this.integrationID, this.integrationSpec.verboseDebugLogging);
      if (!joinQueryPass) {
         this.Log(`join query NOT met: ${this.joinQuery.spec}`);
         return;
      }
      this.Log(`Join query PASSes.`);

      // don't enter joined state if we don't send the notification. the whole point of doing this is to make sure notification
      // messages are correllated so...
      if (!this.SendMessage(true, eventState, this.integrationSpec.join.messageContent, this.integrationSpec.join.messageFields)) {
         this.Log(`Message did not send; don't enter joined state.`);
         return;
      }

      this.Log(`Entering joined state and setting part interval timer for ${this.partIntevalMS} ms`);
      this.joinedState = true;
      this.partTimer = setTimeout(() => this.PartIntervalTimerProc(), this.partIntevalMS);
   }

   PartIntervalTimerProc() {
      this.partTimer = null;

      const queryPass = this.GetDataSource().IsMatch(this.partQuery, this.integrationID, this.integrationSpec.verboseDebugLogging);
      if (!queryPass) {
         this.Log(`part query NOT met: ${this.partQuery.spec}, resetting part interval ${this.partIntevalMS} ms`);
         this.partTimer = setTimeout(() => this.PartIntervalTimerProc(), this.partIntevalMS);
         return;
      }

      this.Log(`Part query PASSes; exiting joined state.`);
      this.joinedState = false;

      this.SendMessage(false, this.lastPartEventState, this.integrationSpec.part.messageContent, this.integrationSpec.part.messageFields);
   }
};

const gStateMap = new Map(); // map integrationID to state object

class UserCountNotification {
   get RequiresUserListSync() {
      return false;
   }

   constructor(subscription, integrationSpec, mgr, integrationID) {
      this.mgr = mgr;
      this.subscription = subscription;
      this.integrationSpec = integrationSpec;
      this.integrationID = integrationID;

      if (!gStateMap.has(integrationID)) {
         gStateMap.set(integrationID, new UserCountNotificationIntegrationState(integrationSpec, mgr, integrationID));
      }
      gStateMap.get(integrationID).RegisterSubscription(subscription);
   }

   GetState() {
      return gStateMap.get(this.integrationID);
   }

   GetAdminHelp() {
      return [
         "UserCountNotification: Sending notifications based off user counts.",
         "Commands:",
         "  log [0,1]      Enable verbose logging",
         "  enable [0,1]   Enables/disables this integration (no processing)",
      ];
   }

   GetAdminStatus() {
      return [
         `Verbose logging: ${this.integrationSpec.verboseDebugLogging ? "on" : "off"}`,
         `Enabled        : ${this.integrationSpec.enabled ? "yes" : "no"}`,
      ];
   }

   DoAdminCmd(args, adminLogFn) {
      args = DFU.GrabArgs(args, 2);
      if (args.length != 2) {
         adminLogFn("Incorrect args to UserCountNotification");
         return;
      }
      if (args[0] == 'log') {
         this.integrationSpec.verboseDebugLogging = !!parseInt(args[1]);
         adminLogFn(`Verbose logging is now: ${this.integrationSpec.verboseDebugLogging ? "on" : "off"}`);
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
      const state = this.GetState();
      return {
         integrationID : this.integrationID,
         joinDelayMS : state.joinDelayMS,
         joinQuery : state.joinQuery.spec,
         partIntervalMS : state.partIntevalMS,
         partQuery : state.partQuery.spec,
         joinedState : state.joinedState,
      };
   }

   On7jamUserPart(roomState, user, roomUserCount, isJustChangingRoom) {
      this.GetState().On7jamUserPart(roomState, user);
   }

   On7jamUserJoin(roomState, user, roomUserCount, isJustChangingRoom) {
      this.GetState().On7jamUserJoin(roomState, user);
   }

}

module.exports = {
   UserCountNotification,
};
