const RangeWindowQuery = require("./RangeWindowQuery");
const DFU = require('./dfutil');

// similar logic to UserCountNotification, however we use a partitioned data source tracking note ons.

class NoteCountNotification {
   get RequiresUserListSync() {
      return false;
   }
   constructor(subscription, integrationSpec, mgr) {
      this.mgr = mgr;
      this.lastSentTimeMS = 0;
      this.triggerQuery = new RangeWindowQuery.RangeDurationQuery(mgr.ReplaceQueryVariables(integrationSpec.triggerOnNoteCount));
      this.conditionQuery = new RangeWindowQuery.RangeDurationQuery(mgr.ReplaceQueryVariables(integrationSpec.conditionOnNoteCount));
      this.delayMS = 10 + RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(integrationSpec.delay)); // add  for a margin when we recheck the query.
      this.partitionDurationMS = RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(integrationSpec.partitionDuration), 5000);
      this.noteCountDataSource =
          new RangeWindowQuery.HistogramDataSource(this.partitionDurationMS, null, null);

      this.fireTimer = null;  // we don't want to set a timer every single note on. instead accumulate
      this.queuedNoteOns = 0; // every time we set the fire timer, reset this. each timer process these.
      this.groupRateLimitMS = RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(integrationSpec.groupRateLimitTime));
   }

   // treat both JOIN and PART the same because either way we just want to examine the absolute user count.
   On7jamNoteOn() {
      if (this.fireTimer) {
         this.queuedNoteOns++;
         return;
      }
      this.queuedNoteOns = 1;
      this.fireTimer = setTimeout(() => {
         const noteOnsToProcess = this.queuedNoteOns;
         this.queuedNoteOns = 0;
         this.fireTimer = null;
         this.ProcessNoteOns(noteOnsToProcess);
      }, this.partitionDurationMS); // it's not 100% certain if this is the theoretically correct time to use, but i think it's practical and simple.
   }

   ProcessNoteOns(noteOnsToProcess) {
      //console.log(`${this.integrationID}: notification processing ${noteOnsToProcess} notes.`);

      let conditionMet = this.noteCountDataSource.IsMatch(this.conditionQuery, `${this.integrationID} PRECOND`, this.integrationSpec.verboseDebugLogging);
      if (conditionMet) {
         //console.log(`${this.integrationID}: PreCondition met: ${this.conditionQuery.spec}`);
      }

      this.noteCountDataSource.AddEvent(noteOnsToProcess);

      if (!conditionMet) {
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} PreCondition not met:  ${this.conditionQuery.spec}`);
         return;
      }

      const timerProc = () => {

         // REMEMBER that the datasource will only be updated on note-on. It means the latest partition will ALWAYS have
         // notes in it, because there's never a case where we register a partition of 0 notes.
         // one way to force this is to just register an event of 0 notes. It could also be accounted for
         // in the data source itself, but ... i am not sure it makes perfect sense to do it that way.
         this.noteCountDataSource.AddEvent(0);

         if (!this.noteCountDataSource.IsMatch(this.triggerQuery, `${this.integrationID} TIMER TRIG`, this.integrationSpec.verboseDebugLogging)) {
            this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} TrigCondition not met: ${this.triggerQuery.spec}`);
            return;
         }

         if (this.integrationSpec.specialHandling == 'jamStart') {
            // execute this before rate-limiting; no reason to rate-limit this
            if (this.subscription.jamTracker.IsJamRunning()) {
               this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} Not firing because jam is already running.`);
               return;
            }

            const backtrackMS = RangeWindowQuery.DurationSpecToMS(this.integrationSpec.noteCountBacktrack);
            this.subscription.jamTracker.RegisterJamStart(this.noteCountDataSource.GetSumForDurationMS(backtrackMS));
         }

         if (this.integrationSpec.specialHandling == 'jamStatus') {
            // execute this before rate-limiting; no reason to rate-limit this
            if (!this.subscription.jamTracker.IsJamRunning()) {
               this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} Not firing because jam isn't running.`);
               return;
            }
         }

         let jamInfo = this.subscription.jamTracker.GetJamStats(); // DO this before ending the jam (which would reset the stats)

         if (this.integrationSpec.specialHandling == 'jamEnd') {
            // execute this before rate-limiting; no reason to rate-limit this
            if (!this.subscription.jamTracker.IsJamRunning()) {
               this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} Not firing because jam is not running.`);
               return;
            }
            this.subscription.jamTracker.RegisterJamEnd();
         }

         const rateLimitedDelayMS = this.subscription.RateLimitedTimeRemainingMS(
             this.integrationSpec.groupName, 0, this.groupRateLimitMS);

         if (rateLimitedDelayMS > 0) {
            this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} notification rate limit; discarded notification before setting timer: ${rateLimitedDelayMS}`);
            return;
         }

         let messageContent = this.integrationSpec.messageContent;

         let substitutions = {};
         substitutions[`%roomName%`] = this.mgr._7jamAPI.GetRoomState(this.subscription.roomID).roomTitle;
         substitutions['%roomUserCount%'] = this.mgr._7jamAPI.Get7JamUserCountForRoom(this.subscription.roomID);
         substitutions['%roomNoteCount%'] = this.mgr._7jamAPI.Get7JamNoteCountForRoom(this.subscription.roomID).toLocaleString();
         substitutions['%jamDuration%'] = jamInfo ? DFU.FormatTimeMS(jamInfo.durationMS) : "";
         substitutions['%jamNotes%'] = jamInfo ? jamInfo.notesPlayed.toLocaleString() : "";

         substitutions['%jamUniqueUsers%'] = jamInfo ? jamInfo.uniqueUsers.toLocaleString() : "";
         substitutions['%jamMaxUserCount%'] = jamInfo ? jamInfo.maxUserCount.toLocaleString() : "";
         substitutions['%jamMinUserCount%'] = jamInfo ? jamInfo.minUserCount.toLocaleString() : "";
         substitutions['%jamInstrumentChanges%'] = jamInfo ? jamInfo.instrumentChanges.toLocaleString() : "";

         this.subscription.RegisterNotificationSent(this.integrationSpec.groupName);

         const messageText = DFU.PerformSubstitutions(messageContent, substitutions);

         console.log(`${this.integrationID} ** sending discord notification: ${messageText}`);
         this.mgr.bot.SendDiscordEmbedMessage(this.subscription.discordChannelID, roomState.absoluteURL,
            messageText,
                                              DFU.ProcessMessageFields(this.integrationSpec.messageFields, substitutions));
      };

      //console.log(`${this.integrationID} setting timer for ${this.delayMS}`);
      setTimeout(timerProc, this.delayMS);
   }
};

module.exports = {
   NoteCountNotification,
};
