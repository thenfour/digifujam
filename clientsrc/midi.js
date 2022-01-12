'use strict';

//const { resolve } = require("path");

// prototype for handler:
// MIDI_NoteOn(note, velocity)
// MIDI_NoteOff(note)
// .. pedal?
// pitch bend
// expression
// mod
let gMidiAccess = null; // yea global...
let gMidiDevicesAvailable = false;

class DigifuMidi {
  constructor() {
    this.EventHandler = null;
    this.currentlyListeningOn = [];// list of device names we're attached to.
    this.learningCompletionHandlers = [];
  }

  learnMIDICC(completion) {
    this.learningCompletionHandlers.push(completion);
  }

  OnMIDIMessage(message, deviceName) {

    if (!this.IsListeningOnDevice(deviceName)) {
        return; // guarantee caller won't get any messages they are not expecting, due to timing
    }

    // https://www.midi.org/specifications-old/item/table-1-summary-of-midi-message

    let statusHi = message.data[0] >> 4;
    let statusLo = message.data[0] & 0x0f;
    let d1 = message.data[1];
    let d2 = (message.data.length > 2) ? message.data[2] : 0; // a velocity value might not be included with a noteOff command

    // if (statusHi != 15) {
    //   console.log(`MIDI message on device ${deviceName} - ${statusHi} ${statusLo} ${d1} ${d2}`);
    // }

    switch (statusHi) {
      case 9: // noteOn
        if (d2 > 0) {
          //console.log (`note on @ ${Date.now()}`);
          this.EventHandler.MIDI_NoteOn(d1, d2, deviceName);
        } else {
          //log ("self note off");
          this.EventHandler.MIDI_NoteOff(d1, deviceName);
        }
        break;
      case 8: // noteOff
        //log ("self note off");
        this.EventHandler.MIDI_NoteOff(d1, deviceName);
        break;
      // pitch
      // exp
      // mod
      // breath
      case 14: {
        // d1:7 | d2:7
        let v = ((d2 & 0x7f) << 7) | (d1 & 0x7f);
        //console.log(`PB: ${v & 0x3fff}`);
        v = ((v / 0x3fff) * 2) - 1; // -1 to 1
        if (v < -1) v = -1;
        if (v > 1) v = 1;

        this.EventHandler.MIDI_PitchBend(v, deviceName);
        break;
      }
      case 11: // cc

        this.learningCompletionHandlers.forEach((handler, index) => {
          if (handler(d1)) { // let the caller validate whether this counts.
            this.learningCompletionHandlers[index] = null; // mark for deletion.
          }
        });
        this.learningCompletionHandlers.removeIf(c => !c);

        switch (d1) {
          case 64:
            if (d2 > 64) {
              this.EventHandler.MIDI_PedalDown(deviceName);
            } else {
              this.EventHandler.MIDI_PedalUp(deviceName);
            }
            break;
          default:
            // todo: combine MSB & LSB.
            this.EventHandler.MIDI_CC(d1, d2, deviceName);
            break;
        }
        break;
    }
  };

  ListenOnDevice(midiInputDeviceName) {
    if (this.IsListeningOnDevice(midiInputDeviceName))
      return;
    for (var input of gMidiAccess.inputs.values()) {
      if (input.name == midiInputDeviceName) {
        //console.log(`MIDI listening on device ${input.name}`);
        this.currentlyListeningOn.push(midiInputDeviceName);
        input.onmidimessage = (msg) => {
          this.OnMIDIMessage(msg, midiInputDeviceName);
        }
        this.EventHandler.MIDI_AllNotesOff(); // abrupt changes to possible state mean we should just restart state.
      }
    }
  };

  StopListeningOnDevice(midiInputDeviceName) {
    if (!this.IsListeningOnDevice(midiInputDeviceName))
      return;
    for (var input of gMidiAccess.inputs.values()) {
      if (input.name == midiInputDeviceName) {
        //console.log(`MIDI disconnecting form device ${input.name}`);
        input.onmidimessage = null;
        this.currentlyListeningOn.removeIf(o => o == midiInputDeviceName);
        this.EventHandler.MIDI_AllNotesOff(); // abrupt changes to possible state mean we should just restart state.
      }
    }
  }

  IsListeningOnAnyDevice() {
    return this.currentlyListeningOn.length > 0;
  }

  IsListeningOnDevice(midiInputDeviceName) {
    return -1 != this.currentlyListeningOn.findIndex(o => o == midiInputDeviceName);
  };

  AnyMidiDevicesAvailable() {
    return gMidiDevicesAvailable;
  };

  Init(handler) {
    this.EventHandler = handler;
    this.currentlyListeningOn = [];
  };

};



// returns a promise(array of names)
let GetMidiInputDeviceList = () => {
  if (!navigator.requestMIDIAccess) return new Promise((resolve) => {
    resolve([]);
  });
  let formResult = () => {
    let arr = [];
    for (var input of gMidiAccess.inputs.values()) {
      arr.push(input.name);
    };
    return arr;
  };

  if (gMidiAccess) {
    return new Promise(resolve => {
      resolve(formResult());
    });
  }

  return new Promise(resolve => {
    navigator.requestMIDIAccess()
      .then(midiAccess => {
        gMidiAccess = midiAccess;
        gMidiDevicesAvailable = gMidiAccess.inputs.size > 0;
        resolve(formResult());
      }, () => {
        console.log('Could not access your MIDI devices.');
        resolve([]);
      });
  });

};

// simulate no devices
// GetMidiInputDeviceList = () => {
//   return new Promise((resolve) => {
//     resolve([]);
//   });
// }


module.exports = {
  GetMidiInputDeviceList,
  DigifuMidi
};