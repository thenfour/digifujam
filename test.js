const express = require('express')
const YAML = require('yaml')
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const {customAlphabet} = require("nanoid");
const DF = require('./clientsrc/DFCommon');
const fs = require('fs');
const fsp = fs.promises;
const DFStats = require('./DFStats');
const serveIndex = require('serve-index')
const DFDB = require('./DFDB');
const DFDiscordBot = require('./discordBot');
const DFU = require('./clientsrc/dfutil');
const DFMusic = require("./clientsrc/DFMusic");
const Seq = require('./clientsrc/SequencerCore');
const {ServerAdminApp} = require('./server/serverAdminApp');
const {ServerGoogleOAuthSupport} = require('./server/serverGoogleOAuth');
const {RoomSequencerPlayer} = require('./server/SequencerPlayer.js');

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz', 2);

// load sequencer global configuration files. instrument JSON can refer to these configs.
const seqConfigPath = `.\\sequencer_configs`;
const seqConfigs = fs.readdirSync(seqConfigPath);
seqConfigs.forEach(leaf => {
  const path = `${seqConfigPath + "\\" + leaf}`;
  console.log(`reading sequencer config file: ${path}`);
  const configStr = fs.readFileSync(path, {encoding : 'utf8', flag : 'r'});
  const config = YAML.parse(configStr);
  Seq.IntegrateSequencerConfig(config);
});
Seq.ResolveSequencerConfig();
//const legend = Seq.GetGlobalSequencerConfig().legends["GeneralNotes"];//"DrumsA"];
const legend = Seq.GetGlobalSequencerConfig().legends["DrumsA"];

const dev = new Seq.SequencerDevice();
// dev.LoadPattern({
//   "lengthMajorBeats": 8,
//   "divisionType": "MajorBeat",
//   "notes": [
//     {
//       "midiNoteValue": 78,
//       "id": "aa",
//       "velocityIndex": 0,
//       "patternMajorBeat": 0,
//       "lengthMajorBeats": 8,
//       "timestamp": 1642288010460
//     },
//     {
//       "midiNoteValue": 78,
//       "id": "bb",
//       "velocityIndex": 0,
//       "patternMajorBeat": 1,
//       "lengthMajorBeats": 1,
//       "timestamp": 1642288016776
//     }
//   ]
// });
const patch = dev.livePatch;
const pattern = dev.livePatch.GetSelectedPattern();
//patch.SetDivisionType(Seq.eDivisionType.MinorBeat);
patch.SetLengthMajorBeats(8);

const addNote = (midiNoteValue, patternMajorBeat, lengthMajorBeats) => {
  pattern.ProcessOps([
    {
      type : Seq.eSeqPatternOp.AddNote,
      midiNoteValue,
      id : nanoid(),
      velocityIndex : 0,
      patternMajorBeat,
      lengthMajorBeats,
    }
  ],
                     patch);
}


// addNote(54, 0, 8);
// addNote(54, 1, 1);

// addNote(47, 1, 1);

// addNote(45, 6, 4);
// addNote(45, 1, 1);

// addNote(43, 6, 4);
// addNote(43, 1, 2);

//addNote(56, 0, 1);

//addNote(54, 0, 1);
//addNote(54, 0, 2);

// addNote(47, 1, 1);
// addNote(47, 1, 2);

// addNote(45, 0, 1);
// addNote(45, 1, 2);

// addNote(43, 0, 1);
// addNote(43, 2, 10);

// addNote(41, 3, 10);

// addNote(51, 10, 10);

// addNote(49, 3, 10);
// addNote(49, 0, 10);

// addNote(46, 0, 4);

// addNote(42, .5, .5);
// addNote(42, 1.5, 1);
// addNote(42, 3.5, 1);

// addNote(38, .5, 1);
// addNote(38, 1.5, 1);
// addNote(38, 3.5, 1.5);
// addNote(38, 4, 1);

// addNote(37, 3.5, .5);
// addNote(37, 4, 1);

// addNote(36, 0, 8);
// addNote(36, 2, 2);

const dumpPattern = (p) => {
  console.log(`{ Pattern`);
  p.notes.forEach(n => {
    console.log(`  id ${n.id}, note ${n.midiNoteValue}, begin ${n.patternMajorBeat}, len ${n.lengthMajorBeats}, end ${n.lengthMajorBeats}`);
  });
  console.log(`} Pattern`);
}



dumpPattern(pattern);

const iter = 1;
let v;
let start = Date.now();
for (let i = 0; i < iter; ++ i) {
  v = new Seq.SequencerPatternView(patch, legend);
}
console.log(`${iter} iterations took ${(Date.now() - start).toLocaleString()} ms`);

let a = 0;

v.dump();
