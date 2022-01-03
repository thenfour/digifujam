const DFU = require('./dfutil');
const RangeWindowQuery = require("./RangeWindowQuery");

class WelcomeMessageIntegration {
   get RequiresUserListSync() {
      return false;
   }

   constructor(subscription, integrationSpec, mgr, integrationID, backup) {
      this.mgr = mgr;
      this.subscription = subscription;
      this.integrationSpec = integrationSpec;
      this.integrationID = integrationID;

      // set defaults
      this.integrationSpec.delay ??= '10s';
      this.integrationSpec.delayPerMessage ??= '2s';
      this.integrationSpec.enabled ??= true;
      this.integrationSpec.roomUserCount ??= 1;

      // process
      this.delayMS = RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(this.integrationSpec.delay));
      this.delayPerMessageMS = RangeWindowQuery.DurationSpecToMS(mgr.ReplaceQueryVariables(this.integrationSpec.delayPerMessage));
      this.roomUserCountRange = new RangeWindowQuery.RangeSpec(this.integrationSpec.roomUserCount);
   }

   GetAdminHelp() {
      return [
         "WelcomeMessageIntegration: Send a notification to visitors with special 'welcome message' treatment.",
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
         adminLogFn("Incorrect args to WelcomeMessageIntegration");
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
         engine : "WelcomeMessageIntegration",
      };
   }

   On7jamUserJoin(roomState, user, roomUserCount, isJustChangingRoom) {
      if (!this.integrationSpec.enabled) {
         return;
      }
      let userID = user.userID;
      let userName = user.name;
      setTimeout(() => {
         // check room population condition
         const users = this.mgr._7jamAPI.Get7JamUsersForRoom(this.subscription.roomID);
         if (!this.roomUserCountRange.IsMatch(users.length)) {
            return;
         }

         // don't send users multiple welcome messages. due to notification timing settings and various flavors of welcome messages, it could attempt to.
         let u = this.mgr._7jamAPI.FindUserByID(userID);
         if (!u)
            return; // user left.
         if (u.hasReceivedWelcome)
            return;

         u.hasReceivedWelcome = true;

         let substitutions = {};
         substitutions[`%roomName%`] = roomState.roomTitle;
         substitutions['%userName%'] = userName;

         let messages = this.integrationSpec.messages.map((msg, idx) => {
            return {
               text : DFU.PerformSubstitutions(msg, substitutions),
               id : `${this.subscription.id}/${this.integrationID}/${idx}`
            };
         });

         let i = 0;

         const proc = () => {
            this.mgr._7jamAPI.SendWelcomeMessageToUser(userID, messages[i].text, messages[i].id);
            ++i;
            if (i < messages.length) {
               setTimeout(proc, this.delayPerMessageMS);
            }
         };

         proc();
      }, this.delayMS);
   }
};

module.exports = {
   WelcomeMessageIntegration,
};
