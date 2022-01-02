const DFU = require('./dfutil');

class ServerUpDiscordNotification {
   get RequiresUserListSync() {
      return false;
   }

   constructor(subscription, integrationSpec, mgr, integrationID) {
      this.mgr = mgr;
      this.subscription = subscription;
      this.integrationSpec = integrationSpec;
      this.integrationID = integrationID;
   }

   GetAdminHelp() {
      return [
         "ServerUpDiscordNotification: This integration intends to just send a message that the server is now running.",
         "Commands:",
         "  send     Manually sends the message",
      ];
   }

   DoAdminCmd(args, adminLogFn) {
      if (!args.length) {
         adminLogFn("No args");
         return;
      }
      if (args[0] == 'send') {
         adminLogFn(`Sending manually...`);
         this.ManualSend();
         adminLogFn(`Done.`);
         return;
      }
      adminLogFn(`Unknown arg ${args[0]}`);
   }

   GetDebugData() {
      return {
         integrationID : this.integrationID,
         engine : "ServerUpDiscordNotification",
      };
   }

   ManualSend() {
      let messageContent = this.integrationSpec.messageContent;

      let substitutions = {};
      substitutions[`%instrumentCount%`] = this.mgr._7jamAPI.GetApproximateGlobalInstrumentCount();
      substitutions[`%roomCount%`] = this.mgr._7jamAPI.GetRoomCount();
      substitutions['%homeURL%'] = this.mgr.gConfig.host_prefix;
      substitutions['%serverNoteCount%'] = this.mgr._7jamAPI.GetServerNoteCount().toLocaleString();

      this.mgr.bot.SendDiscordEmbedMessage(this.subscription.discordChannelID, this.mgr.gConfig.host_prefix,
                                           DFU.PerformSubstitutions(messageContent, substitutions),
                                           DFU.ProcessMessageFields(this.integrationSpec.messageFields, substitutions));
   }

   On7jamRoomsLoaded(_rooms) {
      if (this.integrationSpec.manualSend) {
         return;
      }

      let delayMS = this.integrationSpec.delaySec * 1000;
      setTimeout(() => { this.ManualSend(); }, delayMS);
   }
};

module.exports = {
   ServerUpDiscordNotification,
};
