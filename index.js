const express = require('express')
const app = express()
const http = require('http').Server(app);
const io = require('socket.io')(http);
const DF = require('./public/DFCommon')
const fsp = require('fs').promises;

// id-generation prefix
gIDDomain = "srv";

// populate initial room state
// https://gleitz.github.io/midi-js-soundfonts/MusyngKite/names.json

let gRooms = {}; // map roomID to RoomServer

////////////////////////////////////////////////////////////////////////////////////////////////
class RoomServer {

  constructor(data) {
    // thaw into live classes
    this.roomState = DF.DigifuRoomState.FromJSONData(data);

    // do not do this stuff on the client side, because there it takes whatever the server gives. thaw() is enough there.
    this.roomState.instrumentCloset.forEach(i => {
      i.instrumentID = DF.generateID();

      // make sure all params have a group name
      // i.params.forEach(p => {
      //   if (!p.groupName) p.groupName = "Params";
      // });

      // load a preset
      if (!i.presets.length) {
        console.assert(!i.params.length, `${i.name} ${i.presets.length} ${i.params.length} WARN: if you have any params, you must have a preset. ${JSON.stringify(i)}`);
        return;
      }
      i.loadPreset(i.presets[0]);

      // add special param values...
      i.params.push(Object.assign(new DF.InstrumentParam(), {
        paramID: "pb",
        name: "pb",
        hidden: true,
        parameterType: DF.InstrumentParamType.floatParam,
        minValue: -48,
        maxValue: 48,
        currentValue: 0,
      }));
    });

    setTimeout(() => {
      this.OnPingInterval();
    }, DF.ServerSettings.PingIntervalMS);
  }

  // returns { user, index } or null.
  FindUserFromSocket(clientSocket) {
    return this.roomState.FindUserByID(clientSocket.id);
  };

  Idle_CheckIdlenessAndEmit() {
    //console.log("Idle_CheckIdlenessAndEmit");
    // check idleness of users holding instruments.
    let now = new Date();
    this.roomState.instrumentCloset.forEach(i => {
      if (!i.controlledByUserID) return;
      let u = this.roomState.FindUserByID(i.controlledByUserID);
      if (!u) return;

      // check auto-release instrument timeout
      if (u.user.idle) {
        if ((now - u.user.lastActivity) > DF.ServerSettings.InstrumentAutoReleaseTimeoutMS) {
          //console.log(`User on instrument is idle: ${u.user.userID} INST ${i.instrumentID} ==> AUTO RELEASE`);
          io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, {
            instrumentID: i.instrumentID,
            userID: null,
            idle: false
          });
        }
        return; // user is already idle, but not auto-release. nothing to do.
      }

      if ((now - u.user.lastActivity) > DF.ServerSettings.InstrumentIdleTimeoutMS) {
        u.user.idle = true;
        // user is considered idle on their instrument.
        //console.log(`User on instrument is idle: ${u.user.userID} INST ${i.instrumentID}`);
        io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, {
          instrumentID: i.instrumentID,
          userID: u.user.userID,
          idle: true
        });
      }
    });
  }

  UnidleInstrument(user, instrument) {
    try {
      user.lastActivity = new Date();
      if (user.idle) {
        user.idle = false;
        io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, {
          instrumentID: instrument.instrumentID,
          userID: user.userID,
          idle: false
        });
      }
    } catch (e) {
      console.log(`UnidleInstrument exception occurred`);
      console.log(e);
    }
  }

  OnClientIdentify(clientSocket, clientUserSpec) {
    try {
      // the data is actually a DigifuUser object. but for security it should be copied.
      let u = new DF.DigifuUser();

      u.name = DF.sanitizeUsername(clientUserSpec.name);
      if (u.name == null) {
        clientSocket.disconnect();
        console.log(`OnClientIdentify: Client had invalid username ${clientUserSpec.name}; disconnecting them.`);
        return;
      }
      u.color = DF.sanitizeUserColor(clientUserSpec.color);
      if (u.color == null) {
        clientSocket.disconnect();
        console.log(`OnClientIdentify: Client had invalid color ${clientUserSpec.color}; disconnecting them.`);
        return;
      }

      u.userID = clientSocket.id;
      u.lastActivity = new Date();
      u.position = { x: this.roomState.width / 2, y: this.roomState.height / 2 };
      if (clientSocket.DFPosition) {
        u.position = clientSocket.DFPosition; // if you're transitioning from a previous room, we store your neew position here across the workflow.
      }
      u.img = null;

      this.roomState.users.push(u);

      let chatMessageEntry = new DF.DigifuChatMessage();
      chatMessageEntry.messageID = DF.generateID();
      chatMessageEntry.messageType = DF.ChatMessageType.join; // of ChatMessageType. "chat", "part", "join", "nick"
      chatMessageEntry.fromUserID = u.userID;
      chatMessageEntry.fromUserColor = u.color;
      chatMessageEntry.fromUserName = u.name;
      chatMessageEntry.timestampUTC = new Date();
      chatMessageEntry.fromRoomName = clientSocket.DFFromRoomName;
      this.roomState.chatLog.push(chatMessageEntry);
      //console.log(`chatLog.push => joined from room ${clientSocket.DFFromRoomName}`);

      //console.log(`User identified id=${u.userID} name=${u.name}. Send welcome package.`)

      // notify this 1 user of their user id & room state
      clientSocket.emit(DF.ServerMessages.Welcome, {
        yourUserID: clientSocket.id,
        roomState: this.roomState
      });

      // broadcast user enter to all clients except the user.
      clientSocket.to(this.roomState.roomID).broadcast.emit(DF.ServerMessages.UserEnter, { user: u, chatMessageEntry });
    } catch (e) {
      console.log(`OnClientIdentify exception occurred`);
      console.log(e);
    }
  };

  OnClientInstrumentRequest(ws, instrumentID) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser === null) {
        console.log(`instrument request for unknown user`);
        return;
      }

      // TODO: validate if the current instrument is available or its controlling user is considered idle.

      // release existing instrument.
      // find their instrument.
      let existingInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (existingInstrument != null) {
        existingInstrument.instrument.controlledByUserID = null;

        // broadcast instrument change to all clients
        io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, {
          instrumentID: existingInstrument.instrument.instrumentID,
          userID: null,
          idle: false,
        });
      }

      // find the new instrument.
      let foundInstrument = this.roomState.FindInstrumentById(instrumentID);
      if (foundInstrument === null) {
        console.log(`instrument request for unknown instrument ${instrumentID}`);
        return;
      }

      foundInstrument.instrument.controlledByUserID = foundUser.user.userID;
      foundUser.user.idle = false;
      foundUser.user.lastActivity = new Date();

      // broadcast instrument change to all clients
      io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, {
        instrumentID: foundInstrument.instrument.instrumentID,
        userID: foundUser.user.userID,
        idle: false
      });
    } catch (e) {
      console.log(`OnClientInstrumentRequest exception occurred`);
      console.log(e);
    }
  };

  OnClientInstrumentRelease(ws) {
    try {
      console.log(`OnClientInstrumentRelease => ${ws.id}`)

      // find the user object.
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        console.log(`=> unknown user`);
        return;
      }

      // find their instrument.
      let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (foundInstrument == null) {
        console.log(`=> not controlling an instrument.`);
        return;
      }

      foundInstrument.instrument.controlledByUserID = null;

      // broadcast instrument change to all clients
      io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, {
        instrumentID: foundInstrument.instrument.instrumentID,
        userID: null,
        idle: false
      });
    } catch (e) {
      console.log(`OnClientInstrumentRelease exception occurred`);
      console.log(e);
    }
  };

  OnClientNoteOn(ws, data) {
    try {
      // find the user object.
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        console.log(`=> unknown user`);
        return;
      }

      // find user's instrument; if we have broadcast an IDLE for this instrument, now revoke it.
      let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (foundInstrument == null) {
        console.log(`=> not controlling an instrument.`);
        return;
      }

      this.UnidleInstrument(foundUser.user, foundInstrument.instrument);

      foundUser.user.stats.noteOns++;
      this.roomState.stats.noteOns++;

      // broadcast to all clients except foundUser
      ws.to(this.roomState.roomID).broadcast.emit(DF.ServerMessages.NoteOn, {
        userID: foundUser.user.userID,
        note: data.note,
        velocity: data.velocity
      });
    } catch (e) {
      console.log(`OnClientNoteOn exception occurred`);
      console.log(e);
    }
  };


  OnClientNoteOff(ws, note) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        console.log(`OnClientNoteOff => unknown user`);
        return;
      }

      let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (foundInstrument == null) {
        console.log(`=> not controlling an instrument.`);
        return;
      }

      this.UnidleInstrument(foundUser.user, foundInstrument.instrument);

      // broadcast to all clients except foundUser
      ws.to(this.roomState.roomID).broadcast.emit(DF.ServerMessages.NoteOff, {
        userID: foundUser.user.userID,
        note: note
      });
    } catch (e) {
      console.log(`OnClientNoteOff exception occurred`);
      console.log(e);
    }
  };

  OnClientAllNotesOff(ws) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        console.log(`OnClientAllNotesOff => unknown user`);
        return;
      }

      let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (foundInstrument == null) {
        console.log(`=> not controlling an instrument.`);
        return;
      }

      this.UnidleInstrument(foundUser.user, foundInstrument.instrument);

      // broadcast to all clients except foundUser
      ws.to(this.roomState.roomID).broadcast.emit(DF.ServerMessages.UserAllNotesOff, foundUser.user.userID);
    } catch (e) {
      console.log(`OnClientAllNotesOff exception occurred`);
      console.log(e);
    }
  };


  OnClientPedalUp(ws) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        console.log(`OnClientPedalUp => unknown user`);
        return;
      }
      // broadcast to all clients except foundUser
      ws.to(this.roomState.roomID).broadcast.emit(DF.ServerMessages.PedalUp, {
        userID: foundUser.user.userID
      });
    } catch (e) {
      console.log(`OnClientPedalUp exception occurred`);
      console.log(e);
    }
  };


  OnClientPedalDown(ws) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        console.log(`OnClientPedalDown => unknown user`);
        return;
      }
      // broadcast to all clients except foundUser
      ws.to(this.roomState.roomID).broadcast.emit(DF.ServerMessages.PedalDown, {
        userID: foundUser.user.userID
      });
    } catch (e) {
      console.log(`OnClientPedalDown exception occurred`);
      console.log(e);
    }
  };


  OnClientInstrumentParams(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        console.log(`OnClientInstrumentParams => unknown user`);
        return;
      }

      //console.log(`OnClientInstrumentParams ${JSON.stringify(data)}`);

      let foundInstrument = this.roomState.FindInstrumentByUserID(foundUser.user.userID);
      if (foundInstrument == null) {
        console.log(`=> not controlling an instrument.`);
        return;
      }

      // set the value.
      let ret = {
        userID: foundUser.user.userID,
        instrumentID: foundInstrument.instrument.instrumentID,
        patchObj: {}
      };
      Object.keys(data).forEach(paramID => {
        //data.forEach(x => {
        if (paramID == "pb") {
          // special case: pitch bend is not a real param on an instrument but it's very convenient to use the param system for it.
          // no need to store this locally.
          ret.patchObj[paramID] = data[paramID];
        } else {
          let p = foundInstrument.instrument.params.find(o => o.paramID == paramID);
          if (!p) {
            console.log(`=> param ${x.paramID} not found.`);
            return;
          }

          p.currentValue = DF.sanitizeInstrumentParamVal(p, data[paramID]);
          //console.log(`OnClientInstrumentParams ${p.name} => ${x.newVal} => ${p.currentValue}`);
          ret.patchObj[paramID] = p.currentValue;
        }
      });

      // broadcast to all clients except foundUser
      ws.to(this.roomState.roomID).broadcast.emit(DF.ServerMessages.InstrumentParams, ret);
    } catch (e) {
      console.log(`OnClientInstrumentParams exception occurred`);
      console.log(e);
    }
  };

  OnClientChatMessage(ws, msg) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        console.log(`OnClientChatMessage => unknown user`);
        return;
      }

      // sanitize msg
      if (typeof (msg.message) != 'string') return;
      if (msg.message.length < 1) return;
      msg.message = msg.message.substring(0, DF.ServerSettings.ChatMessageLengthMax);

      // "TO" user?
      let foundToUser = this.roomState.FindUserByID(msg.toUserID);

      let nm = new DF.DigifuChatMessage();
      nm.messageID = DF.generateID();
      nm.messageType = DF.ChatMessageType.chat; // of ChatMessageType. "chat", "part", "join", "nick"
      nm.message = msg.message;
      nm.fromUserID = foundUser.user.userID;
      nm.fromUserColor = foundUser.user.color;
      nm.fromUserName = foundUser.user.name;
      nm.timestampUTC = new Date();
      if (foundToUser != null) {
        nm.toUserID = foundToUser.user.userID;
        nm.toUserColor = foundToUser.user.color;
        nm.toUserName = foundToUser.user.name;
        return;
      }

      foundUser.user.stats.messages++;
      this.roomState.stats.messages++;

      this.roomState.chatLog.push(nm);

      // broadcast to all clients. even though it can feel more responsive and effiicent for the sender to just handle their own,
      // this allows simpler handling of incorporating the messageID.
      io.to(this.roomState.roomID).emit(DF.ServerMessages.UserChatMessage, nm);
    } catch (e) {
      console.log(`OnClientChatMessage exception occurred`);
      console.log(e);
    }
  };

  CleanUpChatLog() {
    try {
      let now = new Date();
      this.roomState.chatLog = this.roomState.chatLog.filter(msg => {
        return ((now - new Date(msg.timestampUTC)) < DF.ServerSettings.ChatHistoryMaxMS);
      });
    } catch (e) {
      console.log(`CleanUpChatLog exception occurred`);
      console.log(e);
    }
  }

  DoUserRoomChange(ws, user, params) {
    let newRoom = gRooms[params.roomID];
    console.log(`ROOM CHANGE => ${params.roomID} user ${user.name}`);
    // send user part to everyone else in old room
    this.ClientLeaveRoom(ws, user.userID, newRoom.roomState.roomTitle);
    // enter the new room
    ws.DFPosition = {
      x: params.x,
      y: params.y
    };
    newRoom.ClientJoin(ws, this.roomState.roomTitle);
  }

  DoUserItemInteraction(ws, user, item, interactionType) {
    let interactionSpec = item[interactionType];
    if (!interactionSpec) {
      console.log(`Item ${item.itemID} has no interaction type ${interactionType}`);
      return;
    }
    if (interactionSpec.processor != "server") {
      return;
    }
    switch (interactionSpec.fn) {
      case DF.RoomFns.roomChange:
        this.DoUserRoomChange(ws, user, interactionSpec.params);
        break;
      default:
        console.log(`Item ${item.itemID} / interaction type ${interactionType} has unknown interaction FN ${interactionSpec.fn}`);
        break;
    }
  };

  OnClientUserState(ws, data) {
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        console.log(`OnClientUserState => unknown user`);
        return;
      }

      // validate & integrate state. validation errors will result in just ignoring the request.
      let origPayload = JSON.stringify(data);
      data.name = DF.sanitizeUsername(data.name);
      if (data.name == null) {
        console.log(`OnClientUserState: invalid username ${origPayload.name}.`);
        return;
      }
      data.color = DF.sanitizeUserColor(data.color);
      if (data.color == null) {
        console.log(`OnClientUserState: invalid color ${origPayload.color}.`);
        return;
      }

      let nm = null;
      if (foundUser.user.name != data.name) { // new chat message entry for this event
        nm = new DF.DigifuChatMessage();
        nm.messageID = DF.generateID();
        nm.messageType = DF.ChatMessageType.nick; // of ChatMessageType. "chat", "part", "join", "nick"
        nm.message = "";
        nm.fromUserID = foundUser.user.userID;
        nm.fromUserColor = foundUser.user.color;
        nm.fromUserName = foundUser.user.name;
        nm.timestampUTC = new Date();
        nm.toUserID = foundUser.user.userID;
        nm.toUserColor = foundUser.user.color;
        nm.toUserName = data.name;
        this.roomState.chatLog.push(nm);
        //console.log(`chatLog.push => nick`);
      }

      foundUser.user.name = data.name;
      foundUser.user.color = data.color;

      foundUser.user.img = data.img;
      foundUser.user.position.x = data.position.x;
      foundUser.user.position.y = data.position.y;

      data.userID = foundUser.user.userID; // adapt the data packet for sending to all clients.

      io.to(this.roomState.roomID).emit(DF.ServerMessages.UserState, { state: data, chatMessageEntry: nm });

      // room interaction based on intersection.
      this.roomState.roomItems.forEach(item => {
        if (item.rect.PointIntersects(foundUser.user.position)) {
          this.DoUserItemInteraction(ws, foundUser.user, item, "onAvatarEnter");
        }
      });

    } catch (e) {
      console.log(`OnClientUserState exception occurred`);
      console.log(e);
    }
  };

  // text, x, y
  OnClientCheer(ws, data) {
    //console.log(`OnClientCheer => ${JSON.stringify(data)} ${data.text.length}`);
    try {
      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        console.log(`OnClientCheer => unknown user`);
        return;
      }

      let txt = DF.sanitizeCheerText(data.text);
      if (txt == null) {
        console.log(`OnClientCheer: invalid cheer ${data.text}.`);
        return;
      }

      foundUser.user.stats.cheers++;
      this.roomState.stats.cheers++;

      io.to(this.roomState.roomID).emit(DF.ServerMessages.Cheer, { userID: foundUser.user.userID, text: txt, x: data.x, y: data.y });
    } catch (e) {
      console.log(`OnClientCheer exception occurred`);
      console.log(e);
    }
  }


  // every X seconds, this is called. here we can just do a generic push to clients and they're expected
  // to return a pong. for now used for timing, and reporting user ping.
  OnPingInterval() {
    try {
      setTimeout(() => {
        this.OnPingInterval();
      }, DF.ServerSettings.PingIntervalMS);

      this.CleanUpChatLog();

      // check users who are ghosts. i didn't bother trying to figure out why this happens but suffice it to say that I don't always get
      // the disconnect event to remove the user.
      // clients should do the same kind of cleanup: remove any users not appearing in the returned list, as if they've been disconnected.
      let deletedUsers = [];
      this.roomState.users.removeIf(u => {
        let ws = io.of('/').sockets.get(u.userID);
        let shouldDelete = !ws;
        if (shouldDelete) {
          console.log(`PING USER CLEANUP removing userid ${u.userID}`);
          deletedUsers.push(u);
        }
        return shouldDelete;
      });

      // for the users that deleted, gracefully kill them off.
      deletedUsers.forEach(u => { this.ClientLeaveRoom(null, u.userID) });

      this.Idle_CheckIdlenessAndEmit();

      // token, rooms: [{roomID, roomName, users [{ userid, name, pingMS }], stats}]
      var payload = {
        token: (new Date()).toISOString(),
        rooms: [],
      };
      payload.rooms = Object.keys(gRooms).map(k => {
        let room = gRooms[k];
        return {
          roomID: room.roomState.roomID,
          roomName: room.roomState.roomTitle,
          users: room.roomState.users.map(u => { return { userID: u.userID, name: u.name, color: u.color, pingMS: u.pingMS }; }),
          stats: room.roomState.stats
        };
      });

      // ping ALL clients on the room
      io.to(this.roomState.roomID).emit(DF.ServerMessages.Ping, payload);
    } catch (e) {
      console.log(`OnPingInterval exception occurred`);
      console.log(e);
    }
  };

  OnClientPong(ws, data) {
    try {
      // data is the token we sent, a date iso string.
      //console.log(`OnClientPong data=${data}`);
      let a = new Date(data);
      let b = new Date();

      let foundUser = this.FindUserFromSocket(ws);
      if (foundUser == null) {
        console.log(`OnClientPong => unknown user`);
        return;
      }

      foundUser.user.pingMS = (b - a);
    } catch (e) {
      console.log(`OnClientPong exception occurred`);
      console.log(e);
    }
  };

  // call this to leave the socket from this room.
  ClientLeaveRoom(ws/* may be null */, userID, newRoomName) {
    try {
      //console.log(`ClientLeaveRoom => ${userID}`)

      // find the user object and remove it.
      let foundUser = this.roomState.FindUserByID(userID);
      if (foundUser == null) {
        // this is normal
        return;
      }

      // remove references to this user.
      this.roomState.instrumentCloset.forEach(inst => {
        if (inst.controlledByUserID != foundUser.user.userID) return;
        inst.controlledByUserID = null;
        // broadcast this to clients
        io.to(this.roomState.roomID).emit(DF.ServerMessages.InstrumentOwnership, { instrumentID: inst.instrumentID, userID: null, idle: false });
      });

      let chatMessageEntry = new DF.DigifuChatMessage();
      chatMessageEntry.messageID = DF.generateID();
      chatMessageEntry.messageType = DF.ChatMessageType.part; // of ChatMessageType. "chat", "part", "join", "nick"
      chatMessageEntry.timestampUTC = new Date();
      chatMessageEntry.fromUserID = foundUser.user.userID;
      chatMessageEntry.fromUserColor = foundUser.user.color;
      chatMessageEntry.fromUserName = foundUser.user.name;
      chatMessageEntry.toRoomName = newRoomName;
      this.roomState.chatLog.push(chatMessageEntry);

      // remove user from room.
      this.roomState.users.splice(foundUser.index, 1);

      if (ws) {
        ws.leave(this.roomState.roomID);
      }
      io.to(this.roomState.roomID).emit(DF.ServerMessages.UserLeave, { userID, chatMessageEntry });
    } catch (e) {
      console.log(`ClientLeaveRoom exception occurred`);
      console.log(e);
    }
  };

  // call this to join this socket to this room and initiate welcome.
  ClientJoin(ws, fromRoomName) {
    // NB! Client may already be connected but just joining this room.
    try {
      //console.log(`CLIENT JOINING ${this.roomState.roomID}`);
      ws.DFFromRoomName = fromRoomName; // convenience so you can persist through the room change workflow.
      ws.join(this.roomState.roomID);
      ws.emit(DF.ServerMessages.PleaseIdentify); // ask user to identify
    } catch (e) {
      console.log(`OnClientConnect exception occurred`);
      console.log(e);
    }
  }

};
////////////////////////////////////////////////////////////////////////////////////////////////

let ForwardToRoom = function (ws, fn) {
  let roomArray = [...ws.rooms];
  //console.log(`ROOMS=${roomArray} FN=${fn.toString()}`);
  fn(gRooms[roomArray[1]]); // room[0] is always your socket id.
};

let OnDisconnect = function (ws) {
  // remove from all rooms.
  Object.keys(gRooms).forEach(roomID => {
    gRooms[roomID].ClientLeaveRoom(ws, ws.id);
  });
};

// load configs
let roomsAreLoaded = function () {
  // serve the rooms
  io.on('connection', ws => {
    try {
      let worldUserCount = 0;
      Object.keys(gRooms).forEach(k => {
        worldUserCount += gRooms[k].roomState.users.length;
      });
      if (worldUserCount >= DF.ServerSettings.WorldUserCountMaximum) {
        ws.disconnect();
        return;
      }
      let requestedRoomID = DF.routeToRoomID(ws.handshake.query["jamroom"]);
      let room = gRooms[requestedRoomID];
      if (!room) {
        throw `user trying to connect to nonexistent roomID ${requestedRoomID}`
      }

      ws.on('disconnect', data => OnDisconnect(ws, data));
      ws.on(DF.ClientMessages.Identify, data => ForwardToRoom(ws, room => room.OnClientIdentify(ws, data)));
      ws.on(DF.ClientMessages.InstrumentRequest, data => ForwardToRoom(ws, room => room.OnClientInstrumentRequest(ws, data)));
      ws.on(DF.ClientMessages.InstrumentRelease, () => ForwardToRoom(ws, room => room.OnClientInstrumentRelease(ws)));
      ws.on(DF.ClientMessages.NoteOn, data => ForwardToRoom(ws, room => room.OnClientNoteOn(ws, data)));
      ws.on(DF.ClientMessages.NoteOff, data => ForwardToRoom(ws, room => room.OnClientNoteOff(ws, data)));
      ws.on(DF.ClientMessages.AllNotesOff, data => ForwardToRoom(ws, room => room.OnClientAllNotesOff(ws, data)));
      ws.on(DF.ClientMessages.PedalDown, data => ForwardToRoom(ws, room => room.OnClientPedalDown(ws, data)));
      ws.on(DF.ClientMessages.PedalUp, data => ForwardToRoom(ws, room => room.OnClientPedalUp(ws, data)));
      ws.on(DF.ClientMessages.InstrumentParams, data => ForwardToRoom(ws, room => room.OnClientInstrumentParams(ws, data)));

      ws.on(DF.ClientMessages.ChatMessage, data => ForwardToRoom(ws, room => room.OnClientChatMessage(ws, data)));
      ws.on(DF.ClientMessages.Pong, data => ForwardToRoom(ws, room => room.OnClientPong(ws, data)));
      ws.on(DF.ClientMessages.UserState, data => ForwardToRoom(ws, room => room.OnClientUserState(ws, data)));
      ws.on(DF.ClientMessages.Cheer, data => ForwardToRoom(ws, room => room.OnClientCheer(ws, data)));

      room.ClientJoin(ws);

    } catch (e) {
      console.log("Exception on connection: " + e);
    }
  });

  let port = process.env.PORT || 8081;
  http.listen(port, () => {
    console.log(`listening on *:${port}`);
  });
};

let loadRoom = function (jsonTxt) {
  roomState = JSON.parse(jsonTxt);
  gRooms[roomState.roomID] = new RoomServer(roomState);
  console.log(`serving room ${roomState.roomID} on route ${roomState.route}`);
  app.use(roomState.route, express.static('public'));
}

fsp.readFile("global_instruments.json")
  .then(data1 => {
    let i = JSON.parse(data1);
    DF.SetGlobalInstrumentList(i.globalInstruments);
    fsp.readFile("pub.json")
      .then(data2 => loadRoom(data2))
      .then(() => fsp.readFile("maj7.json"))
      .then(data3 => loadRoom(data3))
      .then(() => fsp.readFile("hall.json"))
      .then(data4 => loadRoom(data4))
      .then(() => roomsAreLoaded());
  });
