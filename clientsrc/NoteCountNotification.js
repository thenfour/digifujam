const RangeWindowQuery = require("./RangeWindowQuery");
const DFU = require('./dfutil');
const DF = require('./DFCommon');

// ---------------------------------------------------------------------------------------
// accumulates stats during a detected jam period.
// it will act as an integration in order to hook events.
// caller must explicitly start / end tracking.
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

      // set defaults
      this.integrationSpec.enabled ??= true;
      this.integrationSpec.silent ??= false;
      this.integrationSpec.timerInterval ??= "20s";

      this.jamTracker = new JamTracker(this.mgr.gConfig, this.subscription.roomID, this.mgr._7jamAPI, backup?.jamTracker);

      const populateQueries = (spec, specialHandling) => {
         if (spec.notePreCondition) {
            spec.noteConditionQuery = new RangeWindowQuery.RangeDurationQuery(mgr.ReplaceQueryVariables(spec.notePreCondition));
         }
         spec.delay ??= "0";
         spec.delayMS = 10 + RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(spec.delay));
         spec.interval ??= "0";
         spec.intervalMS = RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(spec.interval));
         if (spec.noteTrigger) {
            spec.noteTriggerQuery = new RangeWindowQuery.RangeDurationQuery(mgr.ReplaceQueryVariables(spec.noteTrigger));
         }
         if (spec.userCountTrigger) {
            spec.userCountTriggerQuery = new RangeWindowQuery.RangeDurationQuery(mgr.ReplaceQueryVariables(spec.userCountTrigger));
         }
         spec.specialHandling = specialHandling;
         spec.timer = null;
      };

      populateQueries(integrationSpec.jamStart, 'jamStart');
      populateQueries(integrationSpec.jamOngoing, 'jamOngoing');
      populateQueries(integrationSpec.jamEnd, 'jamEnd');

      // warm up data source
      this.GetNoteDataSource();

      const ds = mgr.GetDataSource(this.integrationSpec.noteDataSourceID);
      this.binDurationMS = ds.binDurationMS;

      this.fireTimer = null; // we don't want to set a timer every single note on. queue noteons.
   }

   GetAdminHelp() {
      return [
         "JamStatusNotification: Sending fuzzy notifications based off user counts and note count.",
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
         adminLogFn("Incorrect args to JamStatusNotification");
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

   Serialize() {
      const specToObj = (spec) => {
         return {
            notePreCondition : spec.noteConditionQuery?.spec,
            delayMS : spec.delayMS,
            noteTrigger : spec.noteTriggerQuery.spec,
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

   GetNoteDataSource() {
      const ds = this.mgr.GetDataSource(this.integrationSpec.noteDataSourceID);
      return ds.GetDataSourceForRoom(this.subscription.roomID);
   }

   GetUserCountDataSource() {
      const ds = this.mgr.GetDataSource(this.integrationSpec.userCountDataSourceID);
      if (this.integrationSpec.userCountType === 'global') {
         return ds.globalDataSet;
      }
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
      if (!this.integrationSpec.enabled) {
         return;
      }
      this.fireTimer = setTimeout(() => {
         this.fireTimer = null;
         this.ProcessNoteOns();
      }, this.binDurationMS); // it's not 100% certain if this is the theoretically correct time to use, but i think it's practical and simple.
   }

   HandlePreConditionForJamStart(spec, proc) {
      if (spec.timer) {
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${spec.specialHandling} ignoring existing timer`);
         return;
      }

      spec.timer = setTimeout(proc, spec.delayMS);
      this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${spec.specialHandling} setting timer for ${spec.delayMS} ms`);
   }

   ProcessNoteOns() {
      if (!this.integrationSpec.enabled) { // could have been disabled in meantime.
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${spec.specialHandling} Suppressing ProcessNoteOns because disabled.`);
         return;
      }

      // check for jam starting.
      if (!this.jamTracker.IsJamRunning()) {
         this.HandlePreConditionForJamStart(this.integrationSpec.jamStart, () => {this.CheckStartTimerProc()});
         return;
      }
   }

   CheckStartTimerProc() {
      if (!this.integrationSpec.enabled) { // could have been disabled in meantime.
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${spec.specialHandling} Suppressing CheckStartTimerProc because disabled.`);
         return;
      }

      if (this.jamTracker.IsJamRunning()) {
         // if a jam is running and you get this, it's because the ongoing/end notifications slipped out of our hands.
         // no worries. just assume the previous jam is still running.
         console.log(`${this.integrationID} ${spec.specialHandling} bailing because a jam is already running? I think config needs tweaking so the jam ending registers correctly next time, or so we don't detect this precondition as a jam start.`);
         return;
      }

      const spec = this.integrationSpec.jamStart;
      spec.timer = null;
      const noteDataSource = this.GetNoteDataSource();

      if (!noteDataSource.IsMatch(spec.noteTriggerQuery, `${this.integrationID} ${spec.specialHandling} NOTE TRIG`, this.integrationSpec.verboseDebugLogging)) {
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${spec.specialHandling} Note TrigCondition not met: ${spec.noteTriggerQuery.spec}`);
         return;
      }

      const userCountDataSource = this.GetUserCountDataSource();
      if (!userCountDataSource.IsMatch(spec.userCountTriggerQuery, `${this.integrationID} ${spec.specialHandling} USERCOUNT TRIG`, this.integrationSpec.verboseDebugLogging)) {
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${spec.specialHandling} Usercount TrigCondition not met: ${spec.userCountTriggerQuery.spec}`);
         return;
      }

      const backtrackMS = RangeWindowQuery.DurationSpecToMS(this.integrationSpec.noteCountBacktrack);
      this.jamTracker.RegisterJamStart(noteDataSource.GetSumForDurationMS(backtrackMS));

      this.BeginOngoingInterval();

      this.HandlePassedTrigger(spec, this.jamTracker.GetJamStats());
   }

   BeginOngoingInterval() {
      const ongoingSpec = this.integrationSpec.jamOngoing;
      ongoingSpec.timer = setTimeout(() => this.CheckOngoingTimerProc(), ongoingSpec.intervalMS);
   }

   CheckOngoingTimerProc() {
      const ongoingSpec = this.integrationSpec.jamOngoing;
      ongoingSpec.timer = null;

      if (!this.integrationSpec.enabled) { // could have been disabled in meantime.
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${ongoingSpec.specialHandling} Suppressing CheckOngoingTimerProc because disabled.`);
         return;
      }

      if (!this.jamTracker.IsJamRunning()) {
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${ongoingSpec.specialHandling} // jam is not running; bailing.`);
         return;
      }

      // is the jam ended?
      const endSpec = this.integrationSpec.jamEnd;
      const noteDataSource = this.GetNoteDataSource();
      if (noteDataSource.IsMatch(endSpec.noteTriggerQuery, `${this.integrationID} ${endSpec.specialHandling} TRIG`, this.integrationSpec.verboseDebugLogging)) {
         // we have detected the end of a jam session.
         let jamInfo = this.jamTracker.GetJamStats(); // DO this before ending the jam (which would reset the stats)
         this.jamTracker.RegisterJamEnd();
         this.HandlePassedTrigger(endSpec, jamInfo);
         return;
      }

      this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} so the jam has not ended.`);

      // at this point the timer should be reinstated because it's ongoing.
      // but only send the notification if the trigger passes.
      this.BeginOngoingInterval();

      if (!noteDataSource.IsMatch(ongoingSpec.noteTriggerQuery, `${this.integrationID} ${ongoingSpec.specialHandling} TRIG`, this.integrationSpec.verboseDebugLogging)) {
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${ongoingSpec.specialHandling} TrigCondition not met: ${ongoingSpec.noteTriggerQuery.spec}`);
         return;
      }

      this.HandlePassedTrigger(ongoingSpec, this.jamTracker.GetJamStats());
   }

   HandlePassedTrigger(spec, jamInfo) {
      if (this.integrationSpec.silent) {
         this.integrationSpec.verboseDebugLogging && console.log(`${this.integrationID} ${spec.specialHandling} Suppressing notification because of silent mode.`);
         return;
      }

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

      const messageText = DFU.PerformSubstitutions(messageContent, substitutions);

      console.log(`${this.integrationID} ** sending discord notification: ${messageText}`);
      this.mgr.bot.SendDiscordEmbedMessage(this.subscription.discordChannelID, roomState.absoluteURL,
                                           messageText,
                                           DFU.ProcessMessageFields(spec.messageFields, substitutions));
   };
};

module.exports = {
   JamStatusNotification,
};
