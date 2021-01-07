const express = require('express')
const app = express()
const http = require('http').Server(app);
const io = require('socket.io')(http);
const DF = require('./public/DFCommon')

app.use(express.static('public'))

let gRoom = new DF.DigifuRoomState();

// populate initial room state
// https://gleitz.github.io/midi-js-soundfonts/MusyngKite/names.json
gRoom.instrumentCloset = [ // of type DigifuInstrumentSpec
  {
    name: "acoustic_grand_piano",
    color: "#808080",
    instrumentID: 6,
    controlledByUserID: null
  },
  {
    name: "marimba",
    color: "#884400",
    instrumentID: 69,
    controlledByUserID: null
  },
  {
    name: "tango_accordion",
    color: "#00ff00",
    instrumentID: 420,
    controlledByUserID: null
  },
  {
    name: "electric_bass_finger",
    color: "#0000ff",
    instrumentID: 11,
    controlledByUserID: null
  },

];


// returns { user, index } or null.
let FindUserByID = function (userID) {
  let idx = gRoom.users.findIndex(user => user.userID == userID);
  if (idx == -1) return null;
  return { user: gRoom.users[idx], index: idx };
};

// returns { user, index } or null.
let FindUserFromSocket = function (clientSocket) {
  return FindUserByID(clientSocket.id);
};

// returns { instrument, index } or null.
let FindInstrumentById = function (instrumentID) {
  let idx = gRoom.instrumentCloset.findIndex(instrument => instrument.instrumentID == instrumentID);
  if (idx == -1) return null;
  return { instrument: gRoom.instrumentCloset[idx], index: idx };
};

// returns { instrument, index } or null.
let FindInstrumentByUserID = function (userID) {
  let idx = gRoom.instrumentCloset.findIndex(instrument => instrument.controlledByUserID == userID);
  if (idx == -1) return null;
  return { instrument: gRoom.instrumentCloset[idx], index: idx };
};

let OnClientIdentify = function (clientSocket, clientUserSpec) {
  // the data is actually a DigifuUser object. but for security it should be copied.
  let u = new DF.DigifuUser();
  // todo: validate client params
  u.name = clientUserSpec.name;
  u.color = clientUserSpec.color;
  u.userID = clientSocket.id;
  gRoom.users.push(u);

  console.log(`User identified ${u.userID}. Send welcome package.`)

  // notify this 1 user of their user id & room state
  clientSocket.emit(DF.ServerMessages.Welcome, {
    yourUserID: clientSocket.id,
    roomState: gRoom
  });

  // broadcast user enter to all clients except the user.
  clientSocket.broadcast.emit(DF.ServerMessages.UserEnter, u);
};

let OnClientClose = function (userID) {
  console.log(`close => ${userID}`)

  // find the user object and remove it.
  let foundUser = FindUserByID(userID);
  if (foundUser == null) {
    console.log(`client closing but is not a user...?`);
    return;
  }

  // remove references to this user.
  gRoom.instrumentCloset.forEach(inst => {
    if (inst.controlledByUserID != foundUser.user.userID) return;
    inst.controlledByUserID = null;
    // broadcast this to clients
    io.emit(DF.ServerMessages.InstrumentOwnership, { instrumentID: inst.instrumentID, userID: null });
  });

  // remove user from room.
  gRoom.users.splice(foundUser.index, 1);

  // broadcast user exit to all clients except this one
  io.emit(DF.ServerMessages.UserLeave, userID);
};

let OnClientInstrumentRequest = function (ws, instrumentID) {
  console.log(`OnClientInstrumentRequest => ${ws.id} ${instrumentID}`)

  // find the user object.
  let foundUser = FindUserFromSocket(ws);
  if (foundUser === null) {
    console.log(`instrument request for unknown user`);
    return;
  }

  // release existing instrument.
  // find their instrument.
  let existingInstrument = FindInstrumentByUserID(foundUser.user.userID);
  if (existingInstrument != null) {
    existingInstrument.instrument.controlledByUserID = null;

    // broadcast instrument change to all clients
    io.emit(DF.ServerMessages.InstrumentOwnership, {
      instrumentID: existingInstrument.instrument.instrumentID,
      userID: null
    });
  }

  // find the new instrument.
  let foundInstrument = FindInstrumentById(instrumentID);
  if (foundInstrument === null) {
    console.log(`instrument request for unknown instrument`);
    return;
  }

  foundInstrument.instrument.controlledByUserID = foundUser.user.userID;

  // broadcast instrument change to all clients
  io.emit(DF.ServerMessages.InstrumentOwnership, {
    instrumentID: foundInstrument.instrument.instrumentID,
    userID: foundUser.user.userID
  });
};

let OnClientInstrumentRelease = function (ws) {
  console.log(`OnClientInstrumentRelease => ${ws.id}`)

  // find the user object.
  let foundUser = FindUserFromSocket(ws);
  if (foundUser == null) {
    console.log(`=> unknown user`);
    return;
  }

  // find their instrument.
  let foundInstrument = FindInstrumentByUserID(foundUser.user.userID);
  if (foundInstrument == null) {
    console.log(`=> not controlling an instrument.`);
    return;
  }

  foundInstrument.instrument.controlledByUserID = null;

  // broadcast instrument change to all clients
  io.emit(DF.ServerMessages.InstrumentOwnership, {
    instrumentID: foundInstrument.instrument.instrumentID,
    userID: null
  });
};


let OnClientNoteOn = function (ws, note, velocity) {
  // find the user object.
  let foundUser = FindUserFromSocket(ws);
  if (foundUser == null) {
    console.log(`=> unknown user`);
    return;
  }

  // broadcast to all clients except foundUser
  ws.broadcast.emit(DF.ServerMessages.NoteOn, {
    userID: foundUser.user.userID,
    note: note,
    velocity: velocity
  });
};


let OnClientNoteOff = function (ws, note) {
  let foundUser = FindUserFromSocket(ws);
  if (foundUser == null) {
    console.log(`OnClientNoteOff => unknown user`);
    return;
  }

  // broadcast to all clients except foundUser
  ws.broadcast.emit(DF.ServerMessages.NoteOff, {
    userID: foundUser.user.userID,
    note: note
  });
};


let OnClientPedalUp = function (ws) {
  let foundUser = FindUserFromSocket(ws);
  if (foundUser == null) {
    console.log(`OnClientPedalUp => unknown user`);
    return;
  }
  // broadcast to all clients except foundUser
  ws.broadcast.emit(DF.ServerMessages.PedalUp, {
    userID: foundUser.user.userID
  });
};


let OnClientPedalDown = function (ws) {
  let foundUser = FindUserFromSocket(ws);
  if (foundUser == null) {
    console.log(`OnClientPedalDown => unknown user`);
    return;
  }
  // broadcast to all clients except foundUser
  ws.broadcast.emit(DF.ServerMessages.PedalDown, {
    userID: foundUser.user.userID
  });
};


let OnClientChatMessage = function (ws, msg) {
  // find the user object.
  let foundUser = FindUserFromSocket(ws);
  if (foundUser == null) {
    console.log(`OnClientChatMessage => unknown user`);
    return;
  }

  // correct stuff.
  msg.fromUserID = foundUser.user.userID;
  // validate to user id
  msg.timestampUTC = new Date();

  gRoom.chatLog.push(msg);
  // todo: prune old?

  // broadcast to all clients except sender
  io.emit(DF.ServerMessages.UserChatMessage, msg); // except for now do, just to make it easier to test using only 1 client
  //ws.broadcast.emit(DF.ServerMessages.UserChatMessage, msg);
};


var OnClientConnect = function (ws) {
  console.log(`Connection received; ID=${ws.id}`)

  ws.on('disconnect', () => {
    OnClientClose(ws.id);
  });

  ws.on(DF.ClientMessages.Identify, data => {
    OnClientIdentify(ws, data);
  });

  ws.on(DF.ClientMessages.InstrumentRequest, data => {
    OnClientInstrumentRequest(ws, data);
  });

  ws.on(DF.ClientMessages.InstrumentRelease, () => {
    OnClientInstrumentRelease(ws);
  });

  ws.on(DF.ClientMessages.NoteOn, data => {
    OnClientNoteOn(ws, data.note, data.velocity);
  });

  ws.on(DF.ClientMessages.NoteOff, data => {
    OnClientNoteOff(ws, data);
  });

  ws.on(DF.ClientMessages.PedalDown, data => {
    OnClientPedalDown(ws, data);
  });

  ws.on(DF.ClientMessages.PedalUp, data => {
    OnClientPedalUp(ws, data);
  });

  ws.on(DF.ClientMessages.Ping, data => {
    ws.emit(DF.ServerMessages.Pong, data);
  });

  ws.on(DF.ClientMessages.ChatMessage, data => {
    OnClientChatMessage(ws, data);
  });

  // send the "please identify yourself" msg
  ws.emit(DF.ServerMessages.PleaseIdentify);
}

io.on('connection', OnClientConnect);

let port = process.env.PORT || 8081;
http.listen(port, () => {
  console.log(`listening on *:${port}`);
});

