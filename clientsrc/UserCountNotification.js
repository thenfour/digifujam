const RangeWindowQuery = require("./RangeWindowQuery");
const DFU = require('./dfutil');

class UserCountNotification {
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
      this.integrationSpec.silent ??= false;
      this.integrationSpec.messageKey ??= '';
      this.integrationSpec.uniqueMessageAge ??= '4h';

      this.lastSentTimeMS = 0;
      console.assert(!!integrationSpec.triggerOnUserCount, `UserCountNotification triggerOnUserCount is required`);
      console.assert(!!integrationSpec.conditionOnUserCount, `UserCountNotification conditionOnUserCount is required`);
      this.triggerQuery = new RangeWindowQuery.RangeDurationQuery(mgr.ReplaceQueryVariables(integrationSpec.triggerOnUserCount));
      this.conditionQuery = new RangeWindowQuery.RangeDurationQuery(mgr.ReplaceQueryVariables(integrationSpec.conditionOnUserCount));
      this.delayMS = 10 + RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(integrationSpec.delay)); // add  for a margin when we recheck the query.
      this.uniqueMessageAgeMS = RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(this.integrationSpec.uniqueMessageAge));

      this.uniqueMessages = new Map(); // map messagekey to time when first sent

      this.timer = null;

      // warm up data source
      this.GetDataSource();
   }

   GetAdminHelp() {
      return [
         "UserCountNotification: Sending notifications based off user counts.",
         "Commands:",
         "  log [0,1]      Enable verbose logging",
         "  enable [0,1]   Enables/disables this integration (no processing)",
         "  silent [0,1]   Suppress the notification sent",
      ];
   }

   GetAdminStatus() {
      return [
         `Verbose logging: ${this.integrationSpec.verboseDebugLogging ? "on" : "off"}`,
         `Enabled        : ${this.integrationSpec.enabled ? "yes" : "no"}`,
         `Silent         : ${this.integrationSpec.silent ? "yes" : "no"}`,
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
      if (args[0] == 'silent') {
         this.integrationSpec.silent = !!parseInt(args[1]);
         adminLogFn(`${this.integrationSpec.silent ? "Notifications will now be suppressed" : "Notifications will be allowed to be sent."}`);
         return;
      }
      adminLogFn(`Unknown arg ${args[0]}`);
   }

   GetDebugData() {
      return {
         integrationID : this.integrationID,
         preCondition : this.conditionQuery.spec,
         delayMS : this.delayMS,
         triggerQuery : this.triggerQuery.spec,
      };
   }

   GetDataSource() {
      const ds = this.mgr.GetDataSource(this.integrationSpec.dataSourceID);
      if (this.integrationSpec.userCountType === 'global') {
         return ds.globalDataSet;
      }
      return ds.GetDataSourceForRoom(this.subscription.roomID);
   }

   PruneMessageKeys() {
      //this.uniqueMessages = new Map(); // map messagekey to time when first sent
      const boundary = Date.now() - this.uniqueMessageAgeMS;
      const keysToDelete = [];
      this.uniqueMessages.forEach((v, k) => {
         if (v <= boundary) keysToDelete.push(k);
      });
      if (keysToDelete.length) {
         if (this.integrationSpec.verboseDebugLogging) {
            console.log(`${this.integrationID} Deleting ${keysToDelete.length} message keys:`);
            keysToDelete.forEach(k => { console.log(`  - ${k}`); });
         }
      }
      keysToDelete.forEach(k => this.uniqueMessages.delete(k));
   }


   // treat both JOIN and PART the same because either way we just want to examine the absolute user count.
   On7jamUserPart(roomState, user, roomUserCount, isJustChangingRoom) {
      this.HandleRoomUserCountChange(roomState, user, roomUserCount, isJustChangingRoom);
   }

   On7jamUserJoin(roomState, user, roomUserCount, isJustChangingRoom) {
      this.HandleRoomUserCountChange(roomState, user, roomUserCount, isJustChangingRoom);
   }

   HandleRoomUserCountChange(roomState, user, roomUserCount, isJustChangingRoom) {
      if (!this.integrationSpec.enabled) {
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} Suppressing HandleRoomUserCountChange because disabled.`);
         return;
      }

      let conditionMet = this.GetDataSource().IsMatch(this.conditionQuery, this.integrationID, this.integrationSpec.verboseDebugLogging);

      if (!conditionMet) {
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} PreCondition NOT met: ${this.conditionQuery.spec}`);
         return;
      }

      this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} PreCondition MET: ${this.conditionQuery.spec}`);

      const timerProc = () => {
         if (!this.integrationSpec.enabled) {
            this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} Suppressing timerProc because disabled.`);
            return;
         }

         this.timer = null;

         // check condition.
         if (!this.GetDataSource().IsMatch(this.triggerQuery, this.integrationID, this.integrationSpec.verboseDebugLogging)) {
            this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} Trigger NOT met: ${this.triggerQuery.spec}`);
            return;
         }

         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} Trigger MET: ${this.triggerQuery.spec}`);

         if (this.integrationSpec.silent) {
            this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} Suppressing notification because of silent mode.`);
            return;
         }

         let substitutions = {};
         substitutions[`%roomName%`] = roomState.roomTitle;
         substitutions[`%userName%`] = user.name;
         substitutions['%roomUserCount%'] = this.mgr._7jamAPI.Get7JamUserCountForRoom(this.subscription.roomID);
         substitutions['%roomNoteCount%'] = this.mgr._7jamAPI.Get7JamNoteCountForRoom(this.subscription.roomID).toLocaleString();

         let messageText = DFU.PerformSubstitutions(this.integrationSpec.messageContent, substitutions);
         let messageKey = DFU.PerformSubstitutions(this.integrationSpec.messageKey, substitutions);

         this.PruneMessageKeys();
         if (this.uniqueMessages.has(messageKey)) {
            this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} Suppressing notification because we already sent it.`);
            return;
         }

         this.uniqueMessages.set(messageKey, Date.now());

         console.log(`${this.integrationID} ** sending discord notification: ${messageText}`);
         //this.subscription.RegisterNotificationSent(this.integrationSpec.groupName);

         this.mgr.bot.SendDiscordEmbedMessage(this.subscription.discordChannelID, roomState.absoluteURL,
                                              messageText,
                                              DFU.ProcessMessageFields(this.integrationSpec.messageFields, substitutions));
      };

      if (this.timer) {
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} clearing existing timer`);
         clearTimeout(this.timer);
      }

      this.timer = setTimeout(timerProc, this.delayMS);
   }
};

module.exports = {
   UserCountNotification,
};
