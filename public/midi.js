'use strict';

//const { resolve } = require("path");

// prototype for handler:
// MIDI_NoteOn(note, velocity)
// MIDI_NoteOff(note)
// .. pedal?
// pitch bend
// expression
// mod

function DigifuMidi() {
  this.EventHandler = null;
};

DigifuMidi.prototype.OnMIDIMessage = function (message) {

  // https://www.midi.org/specifications-old/item/table-1-summary-of-midi-message

  let statusHi = message.data[0] >> 4;
  let statusLo = message.data[0] & 0x0f;
  let d1 = message.data[1];
  let d2 = (message.data.length > 2) ? message.data[2] : 0; // a velocity value might not be included with a noteOff command

  if (statusHi != 15) { // pitch bend
    log(`midi msg ${statusHi} ${statusLo} ${d1} ${d2}`);
  }

  switch (statusHi) {
    case 9: // noteOn
      if (d2 > 0) {
        //log ("self note on");
        this.EventHandler.MIDI_NoteOn(d1, d2);
      } else {
        //log ("self note off");
        this.EventHandler.MIDI_NoteOff(d1);
      }
      break;
    case 8: // noteOff
      //log ("self note off");
      this.EventHandler.MIDI_NoteOff(d1);
      break;
    // pitch
    // exp
    // mod
    // breath
    case 11: // cc
      switch (d1) {
        case 64:
          if (d2 > 64) {
            this.EventHandler.MIDI_PedalDown();
          } else {
            this.EventHandler.MIDI_PedalUp();
          }
          break;
      }
      break;
  }
};


DigifuMidi.prototype.Init = function (midiInputDeviceName, handler) {
  this.EventHandler = handler;

  navigator.requestMIDIAccess()
    .then((function (midiAccess) {
      for (var input of midiAccess.inputs.values()) {
        if (input.name == midiInputDeviceName) {
          log(`attaching to device ${input.name}`);
          input.onmidimessage = this.OnMIDIMessage.bind(this);
        }
      }
    }).bind(this), function () {
      log('Could not access your MIDI devices.');
    });
};

// returns a promise(array of names)
let GetMidiInputDeviceList = function () {
  return new Promise((resolve, reject) => {
    navigator.requestMIDIAccess()
      .then(midiAccess => {
        let arr = [];
        for (var input of midiAccess.inputs.values()) {
          arr.push(input.name);
        };
        log(JSON.stringify(arr));
        resolve(arr);
      }, () => {
        log('Could not access your MIDI devices.');
        reject();
      });
  });

};

