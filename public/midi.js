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
  var command = message.data[0];
  var note = message.data[1];
  var velocity = (message.data.length > 2) ? message.data[2] : 0; // a velocity value might not be included with a noteOff command
  //log(`midi msg ${command}`);

  switch (command) {
    case 144: // noteOn
      if (velocity > 0) {
        this.EventHandler.MIDI_NoteOn(note, velocity);
      } else {
        this.EventHandler.MIDI_NoteOff(note);
      }
      break;
    case 128: // noteOff
      this.EventHandler.MIDI_NoteOff(note);
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

