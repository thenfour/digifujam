const DF = require('../DFcommon/DFCommon');



// ----------------------------------------------------------------------------------------------------------------
class _7jamAPI
{
  constructor(allRooms, gConfig) {
    this.gConfig = gConfig;
    this.allRooms = allRooms;
    this.serverStartTime = new Date();
  }

  GenerateDiscordUserID = (discordMemberID) => 'discord_' + discordMemberID;//.replace(/\W/g, '_');  <-- currently not necessary to sanitize.

  GetRoomCount() {
    return Object.keys(this.allRooms).length;
  }

  GetApproximateGlobalInstrumentCount() {
    const instrumentNames = new Set();
    Object.keys(this.allRooms).forEach(roomID => {
      this.allRooms[roomID].roomState.instrumentCloset.forEach(instrument => {
        instrumentNames.add(instrument.name);
      });
    });
    return instrumentNames.size;
  }

  GetServerUptimeMS()
  {
    return (new Date()) - this.serverStartTime;
  }

  GetRoomState(roomID) {
    if (!(roomID in this.allRooms)){
      throw new Error(`GetRoomState: nonexistent 7jam room ${roomID}`);
    }
    const room = this.allRooms[roomID];
    return room.roomState;
  }

  Get7JamNoteCountForRoom(roomID) {
    if (!(roomID in this.allRooms)){
      throw new Error(`Get7JamNoteCountForRoom: A discord mapping is pointing to nonexistent 7jam room ${roomID}`);
    }
    const room = this.allRooms[roomID];
    return room.roomState.stats.noteOns;
  }

  GetServerNoteCount() {
    let ret = 0;
    Object.keys(this.allRooms).forEach(roomID => {
      ret += this.Get7JamNoteCountForRoom(roomID);
    });
    return ret;
  }

  Get7JamUsersForRoom(roomID, userFilter) {
    if (!(roomID in this.allRooms)){
      throw new Error(`Get7JamUserCountForRoom: A discord mapping is pointing to nonexistent 7jam room ${roomID}`);
    }
    userFilter = userFilter ?? ((u) => u.source === DF.eUserSource.SevenJam);
    const room = this.allRooms[roomID];
    return room.roomState.users.filter(userFilter);
  }

  Get7JamUserCountForRoom(roomID, userFilter) {
    return this.Get7JamUsersForRoom(roomID, userFilter).length;
  }

  GetGlobalUniqueIdentities() {
    return this.GetGlobalOnlinePopulation((u) => true);
  }

  GetGlobalOnlinePopulation(userFilter) {
    // by default, return only 7jam users.
    userFilter ??= ((u) => u.source === DF.eUserSource.SevenJam);

    let userIdentities = new Set();
    Object.values(this.allRooms).forEach(rs => {
      rs.roomState.users.forEach(u => {
        if (!userFilter(u)) return;
        userIdentities.add(u.persistentID ?? u.userID);
      });
    });

    return userIdentities.size;
  }

  UpdateDiscordUserInRoom(roomID, userName, color, discordMemberID) {
    if (!(roomID in this.allRooms)){
      throw new Error(`UpdateDiscordUserInRoom: A discord mapping is pointing to nonexistent 7jam room ${roomID}`);
    }

    // hack; discord's default color is black which just looks bad. simple workaround: replace ugle colors with better colors
    color = color === '#000000' ? '#008888' : color;

    const room = this.allRooms[roomID];
    let u = room.AddOrUpdateExternalUser(DF.eUserSource.Discord, DF.eUserPresence.Offline, userName, color, this.GenerateDiscordUserID(discordMemberID));
    if (u)
      u.discordMemberID = discordMemberID;
  }

  RemoveDiscordUserInRoom(roomID, discordMemberID) {
    if (!(roomID in this.allRooms)){
      throw new Error(`RemoveDiscordUserInRoom: A discord mapping is pointing to nonexistent 7jam room ${roomID}`);
    }
    const room = this.allRooms[roomID];
    room.RemoveExternalUser(this.GenerateDiscordUserID(discordMemberID));
  }

  SendDiscordMessageToRoom(roomID, discordMemberID, msgText) {
    if (!(roomID in this.allRooms)){
      throw new Error(`SendDiscordMessageToRoom: A discord mapping is pointing to nonexistent 7jam room ${roomID}`);
    }
    const room = this.allRooms[roomID];
    let u = room.roomState.FindUserByPersistentID(this.GenerateDiscordUserID(discordMemberID));
    if (!u) {
      console.log(`SendDiscordMessageToRoom: Unable to forward this message because the user was not found.`);
      console.log(`   -> your discord integrations/subscriptions might need to require user list sync?`);
      console.log(`   -> roomID ${roomID} ${discordMemberID} ${msgText}`);
      throw new Error(`SendDiscordMessageToRoom: Unable to forward this message because the user was not found.`);
    }

    room.HandleUserChatMessage(u.user, msgText, DF.eMessageSource.Discord);
  }

  SendWelcomeMessageToUser(userID, msgText, welcomeMsgID) {
    let nm = new DF.DigifuChatMessage();
    nm.messageID = DFU.generateID();
    nm.source = DF.eMessageSource.Server;
    nm.welcomeMsgID = welcomeMsgID;
    nm.messageType = DF.ChatMessageType.chat;
    nm.message = msgText;
    nm.timestampUTC = new Date();
    const ws = this.SocketFromUserID(userID);
    if (!ws) return; // user left
    ws.emit(DF.ServerMessages.UserChatMessage, nm);
  }

  FindUserByID(userID) {
    return this.GetRoomAndUserByUserID(userID)?.user ?? null;
  }

  // return { room, user }
  GetRoomAndUserByUserID(userID) {
    let user = null;
    let room = null;
    Object.values(this.allRooms).find(r => {
      user = r.roomState.FindUserByID(userID);
      if (!user) return false;
      user = user.user;
      room = r;
      return true;
    });
    return { room, user };
  }

  SocketFromUserID(userID) {
    for (let ws of io.of('/').sockets.values()) {
      if (ws.DFUserID === userID)
        return ws;
    }
    //console.log(`SocketFromUserID(${userID}) => socket not found.`); <-- not necessarily an error; let callers treat it such
    return null;
  }

};


module.exports = {
  _7jamAPI,
}