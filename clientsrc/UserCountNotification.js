const RangeWindowQuery = require("./RangeWindowQuery");
const DFU = require('./dfutil');

class UserCountNotification {
   get RequiresUserListSync() {
      return false;
   }
   constructor(subscription, integrationSpec, mgr) {
      this.lastSentTimeMS = 0;
      console.assert(!!integrationSpec.triggerOnUserCount, `UserCountNotification triggerOnUserCount is required`);
      console.assert(!!integrationSpec.conditionOnUserCount, `UserCountNotification conditionOnUserCount is required`);
      this.triggerQuery = new RangeWindowQuery.RangeDurationQuery(mgr.ReplaceQueryVariables(integrationSpec.triggerOnUserCount));
      this.conditionQuery = new RangeWindowQuery.RangeDurationQuery(mgr.ReplaceQueryVariables(integrationSpec.conditionOnUserCount));
      this.delayMS = 10 + RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(integrationSpec.delay)); // add  for a margin when we recheck the query.
      this.userCountDataSource = new RangeWindowQuery.SimpleValueArrayDataSource(0);
      this.groupRateLimitMS = RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(integrationSpec.groupRateLimitTime));
   }

   // treat both JOIN and PART the same because either way we just want to examine the absolute user count.
   On7jamUserPart(roomState, user, roomUserCount, isJustChangingRoom) {
      //console.log(`on user part ${roomState.roomTitle} id=${user.userID} count = ${roomUserCount}`);
      this.HandleRoomUserCountChange(roomState, roomUserCount, isJustChangingRoom);
   }

   On7jamUserJoin(roomState, user, roomUserCount, isJustChangingRoom) {
      //console.log(`on user join ${roomState.roomTitle} id=${user.userID} count = ${roomUserCount}`);
      this.HandleRoomUserCountChange(roomState, roomUserCount, isJustChangingRoom);
   }

   HandleRoomUserCountChange(roomState, roomUserCount, isJustChangingRoom) {
      // make sure to test the condition BEFORE registering the new event, when the user count will include the new user.
      let conditionMet = this.userCountDataSource.IsMatch(this.conditionQuery);
      // if (conditionMet) {
      //    console.log(`Condition IS met: ${this.integrationID} //  ${this.conditionQuery.spec}`);
      // }

      if (this.integrationSpec.userCountType == 'global') {
         roomUserCount = this.mgr._7jamAPI.GetGlobalOnlinePopulation();
      }

      this.userCountDataSource.AddEvent(roomUserCount);

      if (!conditionMet) {
         //console.log(`Condition NOT met: ${this.integrationID} //  ${this.conditionQuery.spec}`);
         return;
      }

      const minUptimeSec = this.mgr.gConfig.discord_integration_enable_after_uptime_sec;
      if (minUptimeSec && (this.mgr._7jamAPI.GetServerUptimeMS() < (minUptimeSec * 1000))) {
         //console.log(`Server uptime condition NOT met for ${this.integrationID}`);
         return;
      }

      const timerProc = () => {
         // check condition.
         if (!this.userCountDataSource.IsMatch(this.triggerQuery)) {
            //console.log(`No notification because trigger not satisfied: ${this.integrationID} // ${this.triggerQuery.spec}`);
            //this.userCountDataSource.Dump();
            return;
         }
         //console.log(`Trigger satisfied: ${this.integrationID} // ${this.triggerQuery.spec}`);
         //this.userCountDataSource.Dump();

         const rateLimitedDelayMS = this.subscription.RateLimitedTimeRemainingMS(
             this.integrationSpec.groupName, 0, this.groupRateLimitMS);

         if (rateLimitedDelayMS > 0) {
            //console.log(`Rate limit triggered: ${this.integrationID} // ${rateLimitedDelayMS}`);
            //const action = this.integrationSpec.rateLimitAction || "discard";
            console.log(`Rate limit; discarded notification before setting timer: ${this.integrationID} // ${rateLimitedDelayMS}`);
            return;
         }

         let messageContent = this.integrationSpec.messageContent;

         let substitutions = {};
         substitutions[`%roomName%`] = roomState.roomTitle;
         substitutions['%roomUserCount%'] = this.mgr._7jamAPI.Get7JamUserCountForRoom(roomState.roomID);
         substitutions['%roomNoteCount%'] = this.mgr._7jamAPI.Get7JamNoteCountForRoom(this.subscription.roomID).toLocaleString();

         //console.log(`SEND NOTIFICATION ${this.integrationID} // ${messageContent}`);
         this.subscription.RegisterNotificationSent(this.integrationSpec.groupName);

         this.mgr.bot.SendDiscordEmbedMessage(this.subscription.discordChannelID, roomState.absoluteURL,
            DFU.PerformSubstitutions(messageContent, substitutions),
            DFU.ProcessMessageFields(this.integrationSpec.messageFields, substitutions));
      };

      setTimeout(timerProc, this.delayMS);
   }
};

module.exports = {
   UserCountNotification,
};
