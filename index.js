const express = require('express')
const app = express()
const http = require('http').Server(app);
const io = require('socket.io')(http);
const DF = require('./public/DFCommon')
const fsp = require('fs').promises;

let gNextID = 1;
let generateID = function () {
  let ret = gNextID;
  gNextID++;
  return ret;
}

// populate initial room state
// https://gleitz.github.io/midi-js-soundfonts/MusyngKite/names.json

////////////////////////////////////////////////////////////////////////////////////////////////
class RoomServer {

  constructor(route, data) {
    this.route = route;
    this.roomName = DF.routeToRoomName(route);

    // thaw into live classes
    this.roomState = DF.DigifuRoomState.FromJSONData(JSON.parse(data));
    this.roomState.instrumentCloset.forEach(i => {
      i.instrumentID = generateID();
      i.controlledByUserID = null;
    });

    setTimeout(() => {
      this.OnPingInterval();
    }, DF.ServerSettings.PingIntervalMS);
  }

  // returns { user, index } or null.
  FindUserFromSocket(clientSocket) {
    return this.roomState.FindUserByID(clientSocket.id);
  };

  OnClientIdentify(clientSocket, clientUserSpec) {
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
    u.statusText = DF.sanitizeUserStatus(clientUserSpec.statusText);
    if (u.statusText == null) {
      clientSocket.disconnect();
      console.log(`OnClientIdentify: Client had invalid status ${clientUserSpec.statusText}; disconnecting them.`);
      return;
    }

    u.userID = clientSocket.id;
    u.lastActivity = new Date();
    u.position = { x: this.roomState.width / 2, y: this.roomState.height / 2 };
    u.img = null;

    this.roomState.users.push(u);

    console.log(`User identified ${u.userID}. Send welcome package.`)

    // notify this 1 user of their user id & room state
    clientSocket.emit(DF.ServerMessages.Welcome, {
      yourUserID: clientSocket.id,
      roomState: this.roomState
    });

    // broadcast user enter to all clients except the user.
    clientSocket.to(this.roomName).broadcast.emit(DF.ServerMessages.UserEnter, u);
  };

  OnClientClose(userID) {
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

    // remove user from room.
    this.roomState.users.splice(foundUser.index, 1);

    io.to(this.roomName).emit(DF.ServerMessages.UserLeave, userID);
  };

  OnClientInstrumentRequest(ws, instrumentID) {
    let foundUser = this.FindUserFromSocket(ws);
    if (foundUser === null) {
      console.log(`instrument request for unknown user`);
      return;
    }

    // TODO: check if the current instrument is available or its controlling user is considered idle.
    // etc etc

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
      console.log(`instrument request for unknown instrument`);
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
  };

  OnClientInstrumentRelease(ws) {
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
  };

  UnidleInstrument(user, instrument) {
    user.lastActivity = new Date();
    if (instrument.idle) {
      instrument.idle = false;
      io.to(this.roomName).emit(DF.ServerMessages.InstrumentOwnership, {
        instrumentID: instrument.instrumentID,
        userID: user.userID,
        idle: false
      });
    }
  }

  OnClientNoteOn(ws, note, velocity) {
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
  };


  OnClientNoteOff(ws, note) {
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
  };

  OnClientAllNotesOff(ws) {
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
  };


  OnClientPedalUp(ws) {
    let foundUser = this.FindUserFromSocket(ws);
    if (foundUser == null) {
      console.log(`OnClientPedalUp => unknown user`);
      return;
    }
    // broadcast to all clients except foundUser
    ws.to(this.roomName).broadcast.emit(DF.ServerMessages.PedalUp, {
      userID: foundUser.user.userID
    });
  };


  OnClientPedalDown(ws) {
    let foundUser = this.FindUserFromSocket(ws);
    if (foundUser == null) {
      console.log(`OnClientPedalDown => unknown user`);
      return;
    }
    // broadcast to all clients except foundUser
    ws.to(this.roomName).broadcast.emit(DF.ServerMessages.PedalDown, {
      userID: foundUser.user.userID
    });
  };


  OnClientChatMessage(ws, msg) {
    let foundUser = this.FindUserFromSocket(ws);
    if (foundUser == null) {
      console.log(`OnClientChatMessage => unknown user`);
      return;
    }

    if (typeof(msg) != 'string') return;
    if (msg.length < 1) return;
    msg = msg.substring(0, DF.ServerSettings.ChatMessageLengthMax);

    // "TO" user?
    let foundToUser = this.roomState.FindUserByID(msg.toUserID);
    if (foundToUser != null) {
      msg.toUserID = foundToUser.user.userID;
      msg.toUserColor = foundToUser.user.color;
      msg.toUserName = foundToUser.user.name;
      return;
    }

    // correct stuff.
    msg.fromUserID = foundUser.user.userID;
    msg.fromUserColor = foundUser.user.color;
    msg.fromUserName = foundUser.user.name;

    msg.messageID = generateID();
    // validate to user id
    msg.timestampUTC = new Date();

    this.roomState.chatLog.push(msg);

    this.CleanUpChatLog();

    // broadcast to all clients. even though it can feel more responsive and effiicent for the sender to just handle their own,
    // this allows simpler handling of incorporating the messageID.
    io.to(this.roomName).emit(DF.ServerMessages.UserChatMessage, msg);
  };

  CleanUpChatLog() {
    let now = new Date();
    this.roomState.chatLog = this.roomState.chatLog.filter(msg => {
      return ((now - new Date(msg.timestampUTC)) < DF.ServerSettings.ChatHistoryMaxMS);
    });
  }

  OnClientUserState(ws, data) {
    let foundUser = this.FindUserFromSocket(ws);
    if (foundUser == null) {
      console.log(`OnClientUserState => unknown user`);
      return;
    }

    // validate & integrate state. validation errors will result in just ignoring the request.
    let origPayload = JSON.stringify(data);
    data.name = DF.sanitizeUsername(data.name);
    if (data.name == null) {
      console.log(`OnClientUserState: invalid username ${origPayload.name}; disconnecting them.`);
      return;
    }
    data.color = DF.sanitizeUserColor(data.color);
    if (data.color == null) {
      console.log(`OnClientUserState: invalid color ${origPayload.color}; disconnecting them.`);
      return;
    }
    data.statusText = DF.sanitizeUserStatus(data.statusText);
    if (data.statusText == null) {
      console.log(`OnClientUserState: invalid status ${origPayload.statusText}; disconnecting them.`);
      return;
    }

    foundUser.user.name = data.name;
    foundUser.user.color = data.color;
    foundUser.user.statusText = data.statusText;

    foundUser.user.img = data.img;
    foundUser.user.position.x = data.position.x;
    foundUser.user.position.y = data.position.y;

    data.userID = foundUser.user.userID; // adapt the data packet for sending to all clients.

    io.to(this.roomName).emit(DF.ServerMessages.UserState, data);
  };


  // every X seconds, this is called. here we can just do a generic push to clients and they're expected
  // to return a pong. for now used for timing, and reporting user ping.
  OnPingInterval() {
    setTimeout(() => {
      this.OnPingInterval();
    }, DF.ServerSettings.PingIntervalMS);

    // check idleness of users holding instruments.
    let now = new Date();
    this.roomState.instrumentCloset.forEach(i => {
      if (!i.controlledByUserID) return;
      let u = this.roomState.FindUserByID(i.controlledByUserID);
      if (!u) return;
      if (u.user.idle) return; // it's already been sent.
      if ((now - u.user.lastActivity) > DF.ServerSettings.InstrumentIdleTimeoutMS) {
        u.user.idle = true;
        // user is considered idle on their instrument.
        console.log(`User on instrument is idle: ${u.user.userID} INST ${i.instrumentID}`);
        io.to(this.roomName).emit(DF.ServerMessages.InstrumentOwnership, {
          instrumentID: i.instrumentID,
          userID: u.user.userID,
          idle: true
        });
      }
    });

    var payload = {
      token: (new Date()).toISOString(),
      users: []
    };
    this.roomState.users.forEach(u => {
      payload.users.push({ userID: u.userID, pingMS: u.pingMS });
    });

    // ping ALL clients on the server
    io.emit(DF.ServerMessages.Ping, payload);
  };

  OnClientPong(ws, data) {
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
  };


  OnClientConnect(ws) {
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
    ws.on(DF.ClientMessages.ChatMessage, data => this.OnClientChatMessage(ws, data));
    ws.on(DF.ClientMessages.Pong, data => this.OnClientPong(ws, data));
    ws.on(DF.ClientMessages.UserState, data => this.OnClientUserState(ws, data));

    // send the "please identify yourself" msg
    ws.emit(DF.ServerMessages.PleaseIdentify);
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
      let room = gRooms.find(r => r.roomName.toUpperCase() === requestedRoomName);
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

