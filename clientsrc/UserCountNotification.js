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

      this.lastSentTimeMS = 0;
      console.assert(!!integrationSpec.triggerOnUserCount, `UserCountNotification triggerOnUserCount is required`);
      console.assert(!!integrationSpec.conditionOnUserCount, `UserCountNotification conditionOnUserCount is required`);
      this.triggerQuery = new RangeWindowQuery.RangeDurationQuery(mgr.ReplaceQueryVariables(integrationSpec.triggerOnUserCount));
      this.conditionQuery = new RangeWindowQuery.RangeDurationQuery(mgr.ReplaceQueryVariables(integrationSpec.conditionOnUserCount));
      this.delayMS = 10 + RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(integrationSpec.delay)); // add  for a margin when we recheck the query.

      this.timer = null;
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

   // treat both JOIN and PART the same because either way we just want to examine the absolute user count.
   On7jamUserPart(roomState, user, roomUserCount, isJustChangingRoom) {
      this.HandleRoomUserCountChange(roomState, roomUserCount, isJustChangingRoom);
   }

   On7jamUserJoin(roomState, user, roomUserCount, isJustChangingRoom) {
      this.HandleRoomUserCountChange(roomState, roomUserCount, isJustChangingRoom);
   }

   HandleRoomUserCountChange(roomState, roomUserCount, isJustChangingRoom) {
      // make sure to test the condition BEFORE registering the new event, when the user count will include the new user.
      let conditionMet = this.GetDataSource().IsMatch(this.conditionQuery, this.integrationID, this.integrationSpec.verboseDebugLogging);

      if (!conditionMet) {
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} PreCondition NOT met: ${this.conditionQuery.spec}`);
         return;
      }

      this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} PreCondition MET: ${this.conditionQuery.spec}`);

      const minUptimeSec = this.mgr.gConfig.discord_integration_enable_after_uptime_sec;
      if (minUptimeSec && (this.mgr._7jamAPI.GetServerUptimeMS() < (minUptimeSec * 1000))) {
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} Server uptime condition NOT met`);
         return;
      }

      const timerProc = () => {
         this.timer = null;

         // check condition.
         if (!this.GetDataSource().IsMatch(this.triggerQuery, this.integrationID, this.integrationSpec.verboseDebugLogging)) {
            this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} Trigger NOT met: ${this.triggerQuery.spec}`);
            return;
         }

         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} Trigger MET: ${this.triggerQuery.spec}`);

         let messageContent = this.integrationSpec.messageContent;

         let substitutions = {};
         substitutions[`%roomName%`] = roomState.roomTitle;
         substitutions['%roomUserCount%'] = this.mgr._7jamAPI.Get7JamUserCountForRoom(this.subscription.roomID);
         substitutions['%roomNoteCount%'] = this.mgr._7jamAPI.Get7JamNoteCountForRoom(this.subscription.roomID).toLocaleString();

         let messageText = DFU.PerformSubstitutions(messageContent, substitutions);

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
