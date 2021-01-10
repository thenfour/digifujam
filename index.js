const express = require('express')
const app = express()
const http = require('http').Server(app);
const io = require('socket.io')(http);
const DF = require('./public/DFCommon')

app.use(express.static('public'))

let gNextID = 1;
let generateID = function () {
  let ret = gNextID;
  gNextID++;
  return ret;
}

let gRoom = new DF.DigifuRoomState();

gRoom.img = "./room.png";
gRoom.width = 1000;
gRoom.height = 741;
gRoom.internalMasterGain = 2.0;

gRoom.flair = [
  {
    name: "jammin",
    flairID: 1,
    img: null,
    text: "🎹",
  },
  {
    name: "drinkin",
    flairID: 2,
    img: null,
    text: "🍺",
  },
];

// populate initial room state
// https://gleitz.github.io/midi-js-soundfonts/MusyngKite/names.json
gRoom.instrumentCloset = [ // of type DigifuInstrumentSpec
  {
    name: "Piano",
    sfinstrumentName: "acoustic_grand_piano",
    img: "",
    color: "rgb(73, 137, 255)",
    gain: 2.0,
    engine: "soundfont",
    activityDisplay: "keyboard",
  },
  {
    sfinstrumentName: "electric_piano_1",
    gain: 1,
    name: "Rhodes",
    img: "",
    color: "rgb(121, 255, 255)",
    engine: "soundfont",
    activityDisplay: "keyboard",
  },
  {
    sfinstrumentName: "electric_piano_2",
    gain: 1,
    name: "FM Keys",
    img: "",
    color: "rgb(131, 145, 255)",
    engine: "soundfont",
    activityDisplay: "keyboard",
  },
  {
    sfinstrumentName: "acoustic_guitar_steel",
    gain: 1,
    name: "Acoustic Guitar",
    img: "",
    color: "rgb(208, 144, 0)",
    engine: "soundfont",
    activityDisplay: "keyboard",
  },
  {
    name: "Marimba",
    sfinstrumentName: "marimba",
    img: "",
    color: "rgb(136, 68, 0)",
    gain: 1.0,
    engine: "soundfont",
    activityDisplay: "keyboard",
  },
  {
    sfinstrumentName: "",
    name: "Casio vibraphone",
    gain: 1.0,
    img: "",
    color: "rgb(138, 224, 153)",
    engine: "synth",
    activityDisplay: "keyboard",
  },


  {
    sfinstrumentName: "tango_accordion",
    name: "Accordion",
    img: "",
    color: "rgb(220, 0, 152)",
    gain: .8,
    engine: "soundfont",
    activityDisplay: "keyboard",
  },
  {
    sfinstrumentName: "string_ensemble_1",
    gain: .8,
    name: "Strings",
    img: "",
    color: "rgb(255, 0, 0)",
    engine: "soundfont",
    activityDisplay: "keyboard",
  },

  {
    sfinstrumentName: "synth_brass_1",
    gain: 1,
    name: "Synth Brass",
    img: "",
    color: "rgb(255, 228, 153)",
    engine: "soundfont",
    activityDisplay: "keyboard",
  },

  {
    sfinstrumentName: "alto_sax",
    gain: 1,
    name: "Alto sax",
    img: "",
    color: "rgb(212, 0, 0)",
    engine: "soundfont",
    activityDisplay: "keyboard",
  },

  {
    sfinstrumentName: "pan_flute",
    gain: 1,
    name: "Pan flute",
    img: "",
    color: "rgb(251, 255, 0)",
    engine: "soundfont",
    activityDisplay: "keyboard",
  },

  {
    sfinstrumentName: "muted_trumpet",
    gain: 1,
    name: "Mt. Trumpet",
    img: "",
    color: "rgb(36, 152, 50)",
    engine: "soundfont",
    activityDisplay: "keyboard",
  },


  {
    sfinstrumentName: "electric_bass_finger",
    name: "Bass guitar",
    gain: .8,
    img: "",
    color: "rgb(80, 80, 173)",
    engine: "soundfont",
    activityDisplay: "keyboard",
  },
  {
    sfinstrumentName: "acoustic_bass",
    gain: 1,
    name: "Double Bass",
    img: "",
    color: "rgb(109, 107, 36)",
    engine: "soundfont",
    activityDisplay: "keyboard",
  },

  {
    sfinstrumentName: "slap_bass_2",
    gain: 1,
    name: "Slap Bass",
    img: "",
    color: "rgb(111, 111, 111)",
    engine: "soundfont",
    activityDisplay: "keyboard",
  },
];

gRoom.instrumentCloset.forEach(i => {
  i.instrumentID = generateID();
  i.controlledByUserID = null;
});

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
  u.lastActivity = new Date();
  u.flairID = 0;
  u.statusText = clientUserSpec.statusText;
  u.position = { x: gRoom.width / 2, y: gRoom.height / 2 };
  u.img = null;

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
    io.emit(DF.ServerMessages.InstrumentOwnership, { instrumentID: inst.instrumentID, userID: null, idle: false });
  });

  // remove user from room.
  gRoom.users.splice(foundUser.index, 1);

  // broadcast user exit to all clients except this one
  io.emit(DF.ServerMessages.UserLeave, userID);
};

let OnClientInstrumentRequest = function (ws, instrumentID) {
  console.log(`OnClientInstrumentRequest => ${ws.id} ${instrumentID}`)

  let foundUser = FindUserFromSocket(ws);
  if (foundUser === null) {
    console.log(`instrument request for unknown user`);
    return;
  }

  // TODO: check if the current instrument is available or its controlling user is considered idle.
  // etc etc

  // release existing instrument.
  // find their instrument.
  let existingInstrument = FindInstrumentByUserID(foundUser.user.userID);
  if (existingInstrument != null) {
    existingInstrument.instrument.controlledByUserID = null;

    // broadcast instrument change to all clients
    io.emit(DF.ServerMessages.InstrumentOwnership, {
      instrumentID: existingInstrument.instrument.instrumentID,
      userID: null,
      idle: false,
    });
  }

  // find the new instrument.
  let foundInstrument = FindInstrumentById(instrumentID);
  if (foundInstrument === null) {
    console.log(`instrument request for unknown instrument`);
    return;
  }

  foundInstrument.instrument.controlledByUserID = foundUser.user.userID;
  foundUser.user.idle = false;
  foundUser.user.lastActivity = new Date();

  // broadcast instrument change to all clients
  io.emit(DF.ServerMessages.InstrumentOwnership, {
    instrumentID: foundInstrument.instrument.instrumentID,
    userID: foundUser.user.userID,
    idle: false
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
    userID: null,
    idle: false
  });
};

let UnidleInstrument = function(user, instrument) {
  user.lastActivity = new Date();
  if (instrument.idle) {
    instrument.idle = false;
    io.emit(DF.ServerMessages.InstrumentOwnership, {
      instrumentID: instrument.instrumentID,
      userID: user.userID,
      idle: false
    });
  }
}

let OnClientNoteOn = function (ws, note, velocity) {
  // find the user object.
  let foundUser = FindUserFromSocket(ws);
  if (foundUser == null) {
    console.log(`=> unknown user`);
    return;
  }

  // find user's instrument; if we have broadcast an IDLE for this instrument, now revoke it.
  let foundInstrument = FindInstrumentByUserID(foundUser.user.userID);
  if (foundInstrument == null) {
    console.log(`=> not controlling an instrument.`);
    return;
  }

  UnidleInstrument(foundUser.user, foundInstrument.instrument);

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

  let foundInstrument = FindInstrumentByUserID(foundUser.user.userID);
  if (foundInstrument == null) {
    console.log(`=> not controlling an instrument.`);
    return;
  }

  UnidleInstrument(foundUser.user, foundInstrument.instrument);

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
  let foundUser = FindUserFromSocket(ws);
  if (foundUser == null) {
    console.log(`OnClientChatMessage => unknown user`);
    return;
  }

  foundUser.user.lastActivity = new Date();

  // "TO" user?
  let foundToUser = FindUserByID(msg.toUserID);
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

  gRoom.chatLog.push(msg);

  let now = new Date();
  gRoom.chatLog = gRoom.chatLog.filter(msg => {
    return ((now - new Date(msg.timestampUTC)) < DF.ServerSettings.ChatHistoryMaxMS);
  });

  // broadcast to all clients. even though it can feel more responsive and effiicent for the sender to just handle their own,
  // this allows simpler handling of incorporating the messageID.
  io.emit(DF.ServerMessages.UserChatMessage, msg);
};


let OnClientUserState = function (ws, data) {
  let foundUser = FindUserFromSocket(ws);
  if (foundUser == null) {
    console.log(`OnClientUserState => unknown user`);
    return;
  }

  console.log(`OnClientUserState: ${JSON.stringify(data)}`);

  // validate & integrate state.
  foundUser.user.name = data.name;
  foundUser.user.color = data.color;
  foundUser.user.img = data.img;
  foundUser.user.flairID = data.flairID;
  foundUser.user.statusText = data.statusText;
  foundUser.user.position.x = data.position.x;
  foundUser.user.position.y = data.position.y;

  data.userID = foundUser.user.userID; // adapt the data packet for sending to all clients.

  io.emit(DF.ServerMessages.UserState, data);
};


// every X seconds, this is called. here we can just do a generic push to clients and they're expected
// to return a pong. for now used for timing, and reporting user ping.
let OnPingInterval = function () {

  // check idleness of users holding instruments.
  let now = new Date();
  gRoom.instrumentCloset.forEach(i => {
    if (!i.controlledByUserID) return;
    let u = FindUserByID(i.controlledByUserID);
    if (!u) return;
    if (u.user.idle) return; // it's already been sent.
    if ((now - u.user.lastActivity) > DF.ServerSettings.InstrumentIdleTimeoutMS) {
      u.user.idle = true;
      // user is considered idle on their instrument.
      console.log(`User on instrument is idle: ${u.user.userID} INST ${i.instrumentID}`);
      io.emit(DF.ServerMessages.InstrumentOwnership, {
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
  gRoom.users.forEach(u => {
    payload.users.push({ userID: u.userID, pingMS: u.pingMS });
  });

  io.emit(DF.ServerMessages.Ping, payload);
};

let OnClientPong = function (ws, data) {
  // data is the token we sent, a date iso string.
  //console.log(`OnClientPong data=${data}`);
  let a = new Date(data);
  let b = new Date();

  let foundUser = FindUserFromSocket(ws);
  if (foundUser == null) {
    console.log(`OnClientPong => unknown user`);
    return;
  }

  foundUser.user.pingMS = (b - a);
};

let OnClientConnect = function (ws) {
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

  ws.on(DF.ClientMessages.ChatMessage, data => {
    OnClientChatMessage(ws, data);
  });

  ws.on(DF.ClientMessages.Pong, data => {
    OnClientPong(ws, data);
  });

  ws.on(DF.ClientMessages.UserState, data => {
    OnClientUserState(ws, data);
  });

  // send the "please identify yourself" msg
  ws.emit(DF.ServerMessages.PleaseIdentify);
}

io.on('connection', OnClientConnect);

let port = process.env.PORT || 8081;
http.listen(port, () => {
  console.log(`listening on *:${port}`);
});


setInterval(() => {
  OnPingInterval();
}, DF.ServerSettings.PingIntervalMS);

