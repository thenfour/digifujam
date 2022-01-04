const RangeWindowQuery = require("./RangeWindowQuery");
const DFU = require('./dfutil');

let gInitMessageSent = false;

class AllJoinsNotification {
   get RequiresUserListSync() {
      return false;
   }

   constructor(subscription, integrationSpec, mgr, integrationID) {
      this.mgr = mgr;
      this.subscription = subscription;
      this.integrationSpec = integrationSpec;
      this.integrationID = integrationID;
   }

   OnDiscordInitialized() {
      if (gInitMessageSent) return;
      gInitMessageSent = true;
      this.SendMessage({
         roomTitle : '!global',
         userName : '!system',
      },
                       this.integrationSpec.startupMessageContent);
   }

   On7jamUserPart(roomState, user, roomUserCount, isJustChangingRoom) {
      if (isJustChangingRoom)
         return;
      this.SendMessage({
         roomTitle : roomState.roomTitle,
         userName : user.name,
         absoluteURL : roomState.absoluteURL,
      },
                       this.integrationSpec.partMessageContent);
   }

   On7jamUserJoin(roomState, user, roomUserCount, isJustChangingRoom) {
      if (isJustChangingRoom)
         return;
      this.SendMessage({
         roomTitle : roomState.roomTitle,
         userName : user.name,
         absoluteURL : roomState.absoluteURL,
      },
                       this.integrationSpec.joinMessageContent);
   }

   SendMessage(eventState, messageContent) {
      if (!messageContent)
         return;
      let substitutions = {};
      substitutions[`%roomName%`] = eventState.roomTitle;
      substitutions[`%userName%`] = eventState.userName;
      substitutions['%roomUserCount%'] = this.mgr._7jamAPI.Get7JamUserCountForRoom(this.subscription.roomID);
      substitutions['%roomNoteCount%'] = this.mgr._7jamAPI.Get7JamNoteCountForRoom(this.subscription.roomID).toLocaleString();
      substitutions['%globalPopulation%'] = this.mgr._7jamAPI.GetGlobalOnlinePopulation().toLocaleString();

      let messageText = DFU.PerformSubstitutions(messageContent, substitutions);

      this.mgr.bot.SendDiscordChatMessage(this.subscription.discordChannelID, eventState.userName, messageText, eventState.absoluteURL,
                                          eventState.roomTitle);
   }
}

module.exports = {
   AllJoinsNotification,
};
