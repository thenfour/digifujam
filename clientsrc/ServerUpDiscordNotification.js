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

   GetDebugData() {
      return {
         integrationID: this.integrationID,
         engine: "ServerUpDiscordNotification",
      };
   }

   On7jamRoomsLoaded(_rooms) {
      const timerProc = () => {
         let messageContent = this.integrationSpec.messageContent;
         let rooms = _rooms;

         let substitutions = {};
         substitutions[`%instrumentCount%`] = this.mgr._7jamAPI.GetApproximateGlobalInstrumentCount(rooms);
         substitutions[`%roomCount%`] = Object.keys(rooms).length;
         substitutions['%homeURL%'] = this.mgr.gConfig.host_prefix;
         substitutions['%serverNoteCount%'] = this.mgr._7jamAPI.GetServerNoteCount().toLocaleString();

         this.mgr.bot.SendDiscordEmbedMessage(this.subscription.discordChannelID, this.mgr.gConfig.host_prefix,
            DFU.PerformSubstitutions(messageContent, substitutions),
            DFU.ProcessMessageFields(this.integrationSpec.messageFields, substitutions));
      };

      let delayMS = this.integrationSpec.delaySec * 1000;
      setTimeout(timerProc, delayMS);
   }

};

module.exports = {
   ServerUpDiscordNotification,
};



