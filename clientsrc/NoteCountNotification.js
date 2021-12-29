const RangeWindowQuery = require("./RangeWindowQuery");
const DFU = require('./dfutil');
const DF = require('./DFCommon');

// ---------------------------------------------------------------------------------------
// accumulates stats during a detected jam period.
// it will act as an integration in order to hook events.
class JamTracker {
   constructor(gConfig, roomID, _7jamAPI, backup) {
      this._7jamAPI = _7jamAPI;
      this.roomID = roomID;

      this.maxJamDurationMS = RangeWindowQuery.DurationSpecToMS(gConfig.jam_tracker_max_duration);

      this.jamOn = backup?.jamOn || false;
      this.jamUserIDs = new Set(backup?.jamUserIDs || []);
      this.jamOnStartTimeMS = backup?.jamOnStartTimeMS || 0;
      this.jamOnNoteCount = backup?.jamOnNoteCount || 0;
      this.jamInstrumentChanges = backup?.instrumentChanges || 0;
      this.jamMinUserCount = backup?.minUserCount || 0;
      this.jamMaxUserCount = backup?.maxUserCount || 0;
   }

   Serialize() {
      const durationMS = Date.now() - this.jamOnStartTimeMS
      const notesPlayed = this._7jamAPI.Get7JamNoteCountForRoom(this.roomID) - this.jamOnNoteCount;
      return {
         durationMS,
         notesPlayed,
         uniqueUsers : this.jamUserIDs.size,
         maxUserCount : this.jamMaxUserCount,
         minUserCount : this.jamMinUserCount,
         instrumentChanges : this.jamInstrumentChanges,
         jamOnNoteCount : this.jamOnNoteCount,
         jamOn : this.jamOn,
         jamOnStartTimeMS : this.jamOnStartTimeMS,
         jamOnNoteCount : this.jamOnNoteCount,
         jamUserIDs : [...this.jamUserIDs ],
      };
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
      const durationMS = Date.now() - this.jamOnStartTimeMS;
      if (durationMS > this.maxJamDurationMS)
         return null;
      const notesPlayed = this._7jamAPI.Get7JamNoteCountForRoom(this.roomID) - this.jamOnNoteCount;
      return {
         durationMS,
         now : Date.now(),
         nowIsoString : (new Date()).toISOString(),
         notesPlayed,
         uniqueUsers : this.jamUserIDs.size,
         maxUserCount : this.jamMaxUserCount,
         minUserCount : this.jamMinUserCount,
         instrumentChanges : this.jamInstrumentChanges,
      };
   }
};

// ---------------------------------------------------------------------------------------
/*
   only 1 timer should be active at a time, otherwise parallelism will make the queries misleadingly frequent.
   but how to deal with missed queries then?

   first, ignoring the query if there's an active timer:
            
   condition >100 notes played over 2 bins
   delay 2 bins
   trigger: <100 notes played over 2 bins

   [51][51][51][51][ 0][ 0]
         ^ precond
         |   ^ ignore
         +-------^ check trigger. does not trigger

   here, a precondition passes, sets a timer.
   that condition's trigger will not fire; it was'nt close enough to the end of the jam.
   the subsequent preconditions are skipped, and those WOULD trigger the end of teh jam.
   in fact now that there are no more note-ons, the jam will be left in a stuck state.

   how about pushing back the timer when the precondition is satisfied, instead of ignoring?

   [51][51][51][51][ 0][ 1]
         ^ precond
         |   ^ push timer back
         |        ^ push timer back
         |            ^no note on = no query is performed.
         |                ^ this note-on invokes a precond query which is not satisfied. timer not pushed back.
         +---+----+------^ check trigger. now triggers.

   this only works for jam start and jam end.

   Here's jam start:

   condition <100 notes played over 2 bins
   delay 2 bins
   trigger: >100 notes played over 2 bins

   [ 0][ 0][ 0][51][51][51]
               ^ precond
               |   ^ push timer back
               |        ^ don't push timer back; cond not true anymore
               +---+-------^ trigger satisfied

   for jam status it will not work because the conditions are not mutually-exclusive, and thus
   once the precondition is satisfied, it will always be pushed back and never fire.

   condition >100 notes played over 2 bins
   delay 2 bins
   trigger: >100 notes played over 2 bins

   [51][51][51][51][ 0][ 0][ 0]
   ^ precond
   |   ^ push back
   |       ^ push back
   |           ^ push back
   +---+---+---+--------+ trigger will never be satisfied

   So for status messages, they can be missed and are periodic so just ignore them when there's an existing timer.

*/
class JamStatusNotification {
   get RequiresUserListSync() {
      return false;
   }

   constructor(subscription, integrationSpec, mgr, integrationID, backup) {
      this.mgr = mgr;
      this.subscription = subscription;
      this.integrationSpec = integrationSpec;
      this.integrationID = integrationID;

      this.jamTracker = new JamTracker(this.mgr.gConfig, this.subscription.roomID, this.mgr._7jamAPI, backup?.jamTracker);

      const populateQueries = (spec, specialHandling) => {
         if (spec.preCondition) {
            spec.conditionQuery = new RangeWindowQuery.RangeDurationQuery(mgr.ReplaceQueryVariables(spec.preCondition));
         }
         spec.delayMS = 10 + RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(spec.delay));
         if (spec.trigger) {
            spec.triggerQuery = new RangeWindowQuery.RangeDurationQuery(mgr.ReplaceQueryVariables(spec.trigger));
         }
         spec.specialHandling = specialHandling;
         spec.timer = null;
      };

      populateQueries(integrationSpec.jamStart, 'jamStart');
      populateQueries(integrationSpec.jamOngoing, 'jamOngoing');
      populateQueries(integrationSpec.jamEnd, 'jamEnd');

      const ds = mgr.GetDataSource(this.integrationSpec.dataSourceID);
      this.binDurationMS = ds.binDurationMS;

      this.fireTimer = null; // we don't want to set a timer every single note on. queue noteons.
   }

   Serialize() {
      const specToObj = (spec) => {
         return {
            preCondition : spec.conditionQuery?.spec,
            delayMS : spec.delayMS,
            trigger : spec.triggerQuery.spec,
         };
      };
      return {
         integrationID : this.integrationID,
         jamStart : specToObj(this.integrationSpec.jamStart),
         jamOngoing : specToObj(this.integrationSpec.jamOngoing),
         jamEnd : specToObj(this.integrationSpec.jamEnd),
         jamTracker : this.jamTracker.Serialize(),
      };
   }

   GetDebugData() {
      return this.Serialize();
   }

   GetDataSource() {
      const ds = this.mgr.GetDataSource(this.integrationSpec.dataSourceID);
      return ds.GetDataSourceForRoom(this.subscription.roomID);
   }

   On7jamUserJoin(roomState, user, roomUserCount, isJustChangingRoom) {
      this.jamTracker.On7jamUserJoin(roomState, user, roomUserCount, isJustChangingRoom);
   }

   On7jamInstrumentAcquire(roomState, user, instrument) {
      this.jamTracker.On7jamInstrumentAcquire(roomState, user, instrument);
   }

   // treat both JOIN and PART the same because either way we just want to examine the absolute user count.
   On7jamNoteOn(roomState) {
      if (this.fireTimer) {
         return;
      }
      this.fireTimer = setTimeout(() => {
         this.fireTimer = null;
         this.ProcessNoteOns();
      }, this.binDurationMS); // it's not 100% certain if this is the theoretically correct time to use, but i think it's practical and simple.
   }

   HandlePreCondition(spec, existingTimerAction, proc) {
      //const spec = this.integrationSpec.jamStart;
      if (!spec.conditionQuery) {
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${spec.specialHandling} no precondition; pass by default.`);
      } else {
         const conditionMet = this.GetDataSource().IsMatch(spec.conditionQuery, `${this.integrationID} ${spec.specialHandling} PRECOND`, this.integrationSpec.verboseDebugLogging);
         if (!conditionMet) {
            return false;
         }
      }

      if (spec.timer) {
         if (existingTimerAction === 'ignore') {
            this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${spec.specialHandling} ignoring existing timer`);
            return;
         }
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${spec.specialHandling} clearing existing timer`);
         clearTimeout(spec.timer);
      }

      spec.timer = setTimeout(proc, spec.delayMS);
      this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${spec.specialHandling} setting timer for ${spec.delayMS} ms`);
      return true;
   }

   ProcessNoteOns() {

      // check for jam starting.
      if (!this.jamTracker.IsJamRunning()) {
         this.HandlePreCondition(this.integrationSpec.jamStart, 'replace', () => {this.CheckStartTimerProc()});
         return;
      }

      // have to do ongoing jam & ending jam in parallel, and just short-circuit in their own procs.
      // they have different delay times, and different conditions, so can't share the same proc.
      // they just need to be associated in that a jam END should cancel a jam STATUS notification.
      this.HandlePreCondition(this.integrationSpec.jamOngoing, 'ignore', () => {this.CheckOngoingTimerProc()});
      this.HandlePreCondition(this.integrationSpec.jamEnd, 'replace', () => {this.CheckEndTimerProc()});
   }

   CheckStartTimerProc() {
      const spec = this.integrationSpec.jamStart;
      spec.timer = null;
      const dataSource = this.GetDataSource();

      if (!dataSource.IsMatch(spec.triggerQuery, `${this.integrationID} ${spec.specialHandling} TRIG`, this.integrationSpec.verboseDebugLogging)) {
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${spec.specialHandling} TrigCondition not met: ${spec.triggerQuery.spec}`);
         return;
      }

      if (spec.triggerMinRoomUsers) {
         // get current room user count.
         const roomPop = this.mgr._7jamAPI.Get7JamUserCountForRoom(this.subscription.roomID);
         if (roomPop < spec.triggerMinRoomUsers) {
            this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${spec.specialHandling} min room pop (${roomPop}) too low.`);
            return;
         }
      }

      if (this.jamTracker.IsJamRunning()) {
         // if a jam is running and you get this, it's because the ongoing/end notifications slipped out of our hands.
         // no worries. just assume the previous jam is still running.
         console.log(`${this.integrationID} ${spec.specialHandling} bailing because a jam is already running? I think config needs tweaking so the jam ending registers correctly next time, or so we don't detect this precondition as a jam start.`);
         return;
      }

      const backtrackMS = RangeWindowQuery.DurationSpecToMS(this.integrationSpec.noteCountBacktrack);
      this.jamTracker.RegisterJamStart(dataSource.GetSumForDurationMS(backtrackMS));

      this.HandlePassedTrigger(spec, this.jamTracker.GetJamStats());
   }

   CheckOngoingTimerProc() {
      const spec = this.integrationSpec.jamOngoing;
      spec.timer = null;

      // this is how, when ending & ongoing timers are running parallel, the ending one will prevent ongoing from continuing.
      if (!this.jamTracker.IsJamRunning()) {
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${spec.specialHandling} // jam is not running; bailing.`);
         return;
      }
      const dataSource = this.GetDataSource();
      if (!dataSource.IsMatch(spec.triggerQuery, `${this.integrationID} ${spec.specialHandling} TRIG`, this.integrationSpec.verboseDebugLogging)) {
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${spec.specialHandling} TrigCondition not met: ${spec.triggerQuery.spec}`);
         return;
      }

      this.HandlePassedTrigger(spec, this.jamTracker.GetJamStats());
   }

   CheckEndTimerProc() {
      const spec = this.integrationSpec.jamEnd;
      spec.timer = null;
      console.assert(this.jamTracker.IsJamRunning());
      const dataSource = this.GetDataSource();
      if (!dataSource.IsMatch(spec.triggerQuery, `${this.integrationID} ${spec.specialHandling} TRIG`, this.integrationSpec.verboseDebugLogging)) {
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${spec.specialHandling} TrigCondition not met: ${spec.triggerQuery.spec}`);
         return;
      }

      // we have detected the end of a jam session.
      let jamInfo = this.jamTracker.GetJamStats(); // DO this before ending the jam (which would reset the stats)

      this.jamTracker.RegisterJamEnd();

      this.HandlePassedTrigger(spec, jamInfo);
   }

   HandlePassedTrigger(spec, jamInfo) {
      let messageContent = spec.messageContent;

      let substitutions = {};
      const roomState = this.mgr._7jamAPI.GetRoomState(this.subscription.roomID);
      substitutions[`%roomName%`] = roomState.roomTitle;
      substitutions['%roomUserCount%'] = this.mgr._7jamAPI.Get7JamUserCountForRoom(this.subscription.roomID);
      substitutions['%roomNoteCount%'] = this.mgr._7jamAPI.Get7JamNoteCountForRoom(this.subscription.roomID).toLocaleString();
      substitutions['%jamDuration%'] = jamInfo ? DFU.FormatTimeMS(jamInfo.durationMS) : "";
      substitutions['%jamNotes%'] = jamInfo ? jamInfo.notesPlayed.toLocaleString() : "";
      substitutions['%jamNotesPerSecond%'] = jamInfo ? (jamInfo.notesPlayed / (jamInfo.durationMS / 1000)).toLocaleString() : "";

      substitutions['%jamUniqueUsers%'] = jamInfo ? jamInfo.uniqueUsers.toLocaleString() : "";
      substitutions['%jamMaxUserCount%'] = jamInfo ? jamInfo.maxUserCount.toLocaleString() : "";
      substitutions['%jamMinUserCount%'] = jamInfo ? jamInfo.minUserCount.toLocaleString() : "";
      substitutions['%jamInstrumentChanges%'] = jamInfo ? jamInfo.instrumentChanges.toLocaleString() : "";

      //this.subscription.RegisterNotificationSent(this.integrationSpec.groupName);

      const messageText = DFU.PerformSubstitutions(messageContent, substitutions);

      console.log(`${this.integrationID} ** sending discord notification: ${messageText}`);
      this.mgr.bot.SendDiscordEmbedMessage(this.subscription.discordChannelID, roomState.absoluteURL,
                                           messageText,
                                           DFU.ProcessMessageFields(spec.messageFields, substitutions));
   };
};

// // ---------------------------------------------------------------------------------------
// class NoteCountNotification {
//    get RequiresUserListSync() {
//       return false;
//    }
//    constructor(subscription, integrationSpec, mgr, integrationID) {
//       this.mgr = mgr;
//       this.subscription = subscription;
//       this.integrationSpec = integrationSpec;
//       this.integrationID = integrationID;

//       this.lastSentTimeMS = 0;
//       this.triggerQuery = new RangeWindowQuery.RangeDurationQuery(mgr.ReplaceQueryVariables(integrationSpec.triggerOnNoteCount));
//       this.conditionQuery = new RangeWindowQuery.RangeDurationQuery(mgr.ReplaceQueryVariables(integrationSpec.conditionOnNoteCount));
//       this.delayMS = 10 + RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(integrationSpec.delay)); // add  for a margin when we recheck the query.

//       const ds = mgr.GetDataSource(this.integrationSpec.dataSourceID);
//       this.binDurationMS = ds.binDurationMS;

//       this.fireTimer = null;  // we don't want to set a timer every single note on. instead accumulate
//       this.groupRateLimitMS = RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(integrationSpec.groupRateLimitTime));
//       this.triggerTimer = null;
//    }

//    GetDebugData() {
//       return {
//          integrationID: this.integrationID,
//          preCondition: this.conditionQuery.spec,
//          delayMS: this.delayMS,
//          triggerQuery: this.triggerQuery.spec,
//          groupName: this.integrationSpec.groupName,
//          groupRateLimitMS: this.groupRateLimitMS,
//          groupRateLimitRemainingMS: this.subscription.RateLimitedTimeRemainingMS(this.integrationSpec.groupName, 0, this.groupRateLimitMS),
//       };
//    }

//    GetDataSource() {
//       const ds = this.mgr.GetDataSource(this.integrationSpec.dataSourceID);
//       return ds.GetDataSourceForRoom(this.subscription.roomID);
//    }

//    // treat both JOIN and PART the same because either way we just want to examine the absolute user count.
//    On7jamNoteOn(roomState) {
//       if (this.fireTimer) {
//          return;
//       }
//       this.fireTimer = setTimeout(() => {
//          this.fireTimer = null;
//          this.ProcessNoteOns();
//       }, this.binDurationMS); // it's not 100% certain if this is the theoretically correct time to use, but i think it's practical and simple.
//    }

//    ProcessNoteOns() {

//       if (this.triggerTimer) {
//          // avoid parallel processing; it messes with timings.
//          this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ignoring due to existing trigger`);
//          return;
//       }

//       let conditionMet = this.GetDataSource().IsMatch(this.conditionQuery, `${this.integrationID} PRECOND`, this.integrationSpec.verboseDebugLogging);
//       // if (conditionMet) {
//       //    //console.log(`${this.integrationID}: PreCondition met: ${this.conditionQuery.spec}`);
//       // }

//       if (!conditionMet) {
//          this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} PreCondition not met:  ${this.conditionQuery.spec}`);
//          return;
//       }

//       const timerProc = () => {
//          this.triggerTimer = null;
//          const dataSource = this.GetDataSource();

//          if (!dataSource.IsMatch(this.triggerQuery, `${this.integrationID} TIMER TRIG`, this.integrationSpec.verboseDebugLogging)) {
//             this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} TrigCondition not met: ${this.triggerQuery.spec}`);
//             return;
//          }

//          if (this.integrationSpec.specialHandling == 'jamStart') {
//             // execute this before rate-limiting; no reason to rate-limit this
//             if (this.subscription.jamTracker.IsJamRunning()) {
//                this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} Not firing because jam is already running.`);
//                return;
//             }

//             const backtrackMS = RangeWindowQuery.DurationSpecToMS(this.integrationSpec.noteCountBacktrack);
//             this.subscription.jamTracker.RegisterJamStart(dataSource.GetSumForDurationMS(backtrackMS));
//          }

//          if (this.integrationSpec.specialHandling == 'jamStatus') {
//             // execute this before rate-limiting; no reason to rate-limit this
//             if (!this.subscription.jamTracker.IsJamRunning()) {
//                this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} Not firing because jam isn't running.`);
//                return;
//             }
//          }

//          let jamInfo = this.subscription.jamTracker.GetJamStats(); // DO this before ending the jam (which would reset the stats)

//          if (this.integrationSpec.specialHandling == 'jamEnd') {
//             // execute this before rate-limiting; no reason to rate-limit this
//             if (!this.subscription.jamTracker.IsJamRunning()) {
//                this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} Not firing because jam is not running.`);
//                return;
//             }
//             this.subscription.jamTracker.RegisterJamEnd();
//          }

//          const rateLimitedDelayMS = this.subscription.RateLimitedTimeRemainingMS(
//              this.integrationSpec.groupName, 0, this.groupRateLimitMS);

//          if (rateLimitedDelayMS > 0) {
//             this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} notification rate limit; discarded notification before setting timer: ${rateLimitedDelayMS}`);
//             return;
//          }

//          let messageContent = this.integrationSpec.messageContent;

//          let substitutions = {};
//          substitutions[`%roomName%`] = this.mgr._7jamAPI.GetRoomState(this.subscription.roomID).roomTitle;
//          substitutions['%roomUserCount%'] = this.mgr._7jamAPI.Get7JamUserCountForRoom(this.subscription.roomID);
//          substitutions['%roomNoteCount%'] = this.mgr._7jamAPI.Get7JamNoteCountForRoom(this.subscription.roomID).toLocaleString();
//          substitutions['%jamDuration%'] = jamInfo ? DFU.FormatTimeMS(jamInfo.durationMS) : "";
//          substitutions['%jamNotes%'] = jamInfo ? jamInfo.notesPlayed.toLocaleString() : "";

//          substitutions['%jamUniqueUsers%'] = jamInfo ? jamInfo.uniqueUsers.toLocaleString() : "";
//          substitutions['%jamMaxUserCount%'] = jamInfo ? jamInfo.maxUserCount.toLocaleString() : "";
//          substitutions['%jamMinUserCount%'] = jamInfo ? jamInfo.minUserCount.toLocaleString() : "";
//          substitutions['%jamInstrumentChanges%'] = jamInfo ? jamInfo.instrumentChanges.toLocaleString() : "";

//          this.subscription.RegisterNotificationSent(this.integrationSpec.groupName);

//          const messageText = DFU.PerformSubstitutions(messageContent, substitutions);

//          console.log(`${this.integrationID} ** sending discord notification: ${messageText}`);
//          this.mgr.bot.SendDiscordEmbedMessage(this.subscription.discordChannelID, roomState.absoluteURL,
//             messageText,
//                                               DFU.ProcessMessageFields(this.integrationSpec.messageFields, substitutions));
//       };

//       //console.log(`${this.integrationID} setting timer for ${this.delayMS}`);
//       this.triggerTimer = setTimeout(timerProc, this.delayMS);
//    }
// };

module.exports = {
   //NoteCountNotification,
   JamStatusNotification,
};
