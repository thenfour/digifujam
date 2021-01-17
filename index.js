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


////////////////////////////////////////////////////////////////////////////////////////////////
class RoomServer {

  constructor(route, data) {
    this.route = route;
    this.roomName = DF.routeToRoomName(route);

    // thaw into live classes
    this.roomState = DF.DigifuRoomState.FromJSONData(JSON.parse(data));
    //console.log(`${JSON.stringify(this.roomState.instrumentCloset[0])}`);

    // do not do this stuff on the client side, because there it takes whatever the server gives. thaw() is enough there.
    this.roomState.instrumentCloset.forEach(i => {
      i.instrumentID = DF.generateID();

      // load a preset
      if (!Object.keys(i.presets).length) {
        console.assert(!i.params.length, `${i.name} ${Object.keys(i.presets).length} ${i.params.length} WARN: if you have any params, you must have a preset. ${JSON.stringify(i)}`);
        return;
      }
      i.loadPreset(i.presets[Object.keys(i.presets)[0]]);
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
          io.to(this.roomName).emit(DF.ServerMessages.InstrumentOwnership, {
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
        io.to(this.roomName).emit(DF.ServerMessages.InstrumentOwnership, {
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
        io.to(this.roomName).emit(DF.ServerMessages.InstrumentOwnership, {
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
      u.img = null;

      this.roomState.users.push(u);

      let chatMessageEntry = new DF.DigifuChatMessage();
      chatMessageEntry.messageID = DF.generateID();
      chatMessageEntry.messageType = DF.ChatMessageType.join; // of ChatMessageType. "chat", "part", "join", "nick"
      chatMessageEntry.fromUserID = u.userID;
      chatMessageEntry.fromUserColor = u.color;
      chatMessageEntry.fromUserName = u.name;
      chatMessageEntry.timestampUTC = new Date();
      this.roomState.chatLog.push(chatMessageEntry);
      //console.log(`chatLog.push => joined`);

      console.log(`User identified id=${u.userID} name=${u.name}. Send welcome package.`)

      // notify this 1 user of their user id & room state
      clientSocket.emit(DF.ServerMessages.Welcome, {
        yourUserID: clientSocket.id,
        roomState: this.roomState
      });

      // broadcast user enter to all clients except the user.
      clientSocket.to(this.roomName).broadcast.emit(DF.ServerMessages.UserEnter, { user: u, chatMessageEntry });
    } catch (e) {
      console.log(`OnClientIdentify exception occurred`);
      console.log(e);
    }
  };

  OnClientClose(userID) {
    try {
      console.log(`close => ${userID}`)

      // find the user object and remove it.
      let foundUser = this.roomState.FindUserByID(userID);
      if (foundUser == null) {
        console.log(`client closing but is not a user...?`);
        return;
      }

      // remove references to this user.
      this.roomState.instrumentCloset.forEach(inst => {
        if (inst.controlledByUserID != foundUser.user.userID) return;
        inst.controlledByUserID = null;
        // broadcast this to clients
        io.to(this.roomName).emit(DF.ServerMessages.InstrumentOwnership, { instrumentID: inst.instrumentID, userID: null, idle: false });
      });

      let chatMessageEntry = new DF.DigifuChatMessage();
      chatMessageEntry.messageID = DF.generateID();
      chatMessageEntry.messageType = DF.ChatMessageType.part; // of ChatMessageType. "chat", "part", "join", "nick"
      chatMessageEntry.fromUserID = foundUser.user.userID;
      chatMessageEntry.fromUserColor = foundUser.user.color;
      chatMessageEntry.fromUserName = foundUser.user.name;
      chatMessageEntry.timestampUTC = new Date();
      this.roomState.chatLog.push(chatMessageEntry);
      //console.log(`chatLog.push => part`);

      // remove user from room.
      this.roomState.users.splice(foundUser.index, 1);

      io.to(this.roomName).emit(DF.ServerMessages.UserLeave, { userID, chatMessageEntry });
    } catch (e) {
      console.log(`OnClientClose exception occurred`);
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
        io.to(this.roomName).emit(DF.ServerMessages.InstrumentOwnership, {
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
      io.to(this.roomName).emit(DF.ServerMessages.InstrumentOwnership, {
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
      io.to(this.roomName).emit(DF.ServerMessages.InstrumentOwnership, {
        instrumentID: foundInstrument.instrument.instrumentID,
        userID: null,
        idle: false
      });
    } catch (e) {
      console.log(`OnClientInstrumentRelease exception occurred`);
      console.log(e);
    }
  };

  OnClientNoteOn(ws, note, velocity) {
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

      // broadcast to all clients except foundUser
      ws.to(this.roomName).broadcast.emit(DF.ServerMessages.NoteOn, {
        userID: foundUser.user.userID,
        note: note,
        velocity: velocity
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
      ws.to(this.roomName).broadcast.emit(DF.ServerMessages.NoteOff, {
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
      ws.to(this.roomName).broadcast.emit(DF.ServerMessages.UserAllNotesOff, foundUser.user.userID);
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
      ws.to(this.roomName).broadcast.emit(DF.ServerMessages.PedalUp, {
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
      ws.to(this.roomName).broadcast.emit(DF.ServerMessages.PedalDown, {
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
      ws.to(this.roomName).broadcast.emit(DF.ServerMessages.InstrumentParams, ret);
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

      this.roomState.chatLog.push(nm);
      ////console.log(`chatLog.push => ${msg.message}`);

      // broadcast to all clients. even though it can feel more responsive and effiicent for the sender to just handle their own,
      // this allows simpler handling of incorporating the messageID.
      io.to(this.roomName).emit(DF.ServerMessages.UserChatMessage, nm);
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

      io.to(this.roomName).emit(DF.ServerMessages.UserState, { state: data, chatMessageEntry: nm });
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

      io.to(this.roomName).emit(DF.ServerMessages.Cheer, { userID: foundUser.user.userID, text: txt, x: data.x, y: data.y });
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
      deletedUsers.forEach(u => { OnClientClose(u.userID) });

      this.Idle_CheckIdlenessAndEmit();

      var payload = {
        token: (new Date()).toISOString(),
        users: []
      };
      this.roomState.users.forEach(u => {
        payload.users.push({ userID: u.userID, pingMS: u.pingMS });
      });

      // ping ALL clients on the server
      io.emit(DF.ServerMessages.Ping, payload);
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


  OnClientConnect(ws) {
    try {
      if (this.roomState.users.length >= DF.ServerSettings.RoomUserCountMaximum) {
        ws.disconnect();
        return;
      }
      ws.join(this.roomName);
      ws.on(DF.ClientMessages.Identify, data => this.OnClientIdentify(ws, data));
      ws.on('disconnect', () => this.OnClientClose(ws.id));
      ws.on(DF.ClientMessages.InstrumentRequest, data => this.OnClientInstrumentRequest(ws, data));
      ws.on(DF.ClientMessages.InstrumentRelease, () => this.OnClientInstrumentRelease(ws));
      ws.on(DF.ClientMessages.NoteOn, data => this.OnClientNoteOn(ws, data.note, data.velocity));
      ws.on(DF.ClientMessages.NoteOff, data => this.OnClientNoteOff(ws, data));
      ws.on(DF.ClientMessages.AllNotesOff, () => this.OnClientAllNotesOff(ws));
      ws.on(DF.ClientMessages.PedalDown, data => this.OnClientPedalDown(ws, data));
      ws.on(DF.ClientMessages.PedalUp, data => this.OnClientPedalUp(ws, data));
      ws.on(DF.ClientMessages.InstrumentParams, data => this.OnClientInstrumentParams(ws, data));

      ws.on(DF.ClientMessages.ChatMessage, data => this.OnClientChatMessage(ws, data));
      ws.on(DF.ClientMessages.Pong, data => this.OnClientPong(ws, data));
      ws.on(DF.ClientMessages.UserState, data => this.OnClientUserState(ws, data));
      ws.on(DF.ClientMessages.Cheer, data => this.OnClientCheer(ws, data));


      // send the "please identify yourself" msg
      ws.emit(DF.ServerMessages.PleaseIdentify);
    } catch (e) {
      console.log(`OnClientConnect exception occurred`);
      console.log(e);
    }
  }

};
////////////////////////////////////////////////////////////////////////////////////////////////

// load configs
let gRooms = [];

let roomIsLoaded = function () {
  // serve the rooms
  gRooms.forEach(r => {
    app.use(r.route, express.static('public'))
  });

  io.on('connection', ws => {
    try {
      let requestedRoomName = DF.routeToRoomName(ws.handshake.query["jamroom"]);
      let room = gRooms.find(r => r.roomName.toLowerCase() === requestedRoomName);
      if (!room) {
        throw `user trying to connect to nonexistent room ${requestedRoomName}`
      }
      room.OnClientConnect(ws);
    } catch (e) {
      console.log("Exception on connection: " + e);
    }
  });

  let port = process.env.PORT || 8081;
  http.listen(port, () => {
    console.log(`listening on *:${port}`);
  });
};

fsp.readFile("pub.json").then(data => {
  gRooms.push(new RoomServer("/", data));
  fsp.readFile("maj7.json").then(data => {
    gRooms.push(new RoomServer("/maj7", data));
    roomIsLoaded();
  });
});

