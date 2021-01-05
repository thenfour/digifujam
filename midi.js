// https://www.smashingmagazine.com/2018/03/web-midi-api/

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


DigifuMidi.prototype.Init = function (handler) {
  this.EventHandler = handler;

  navigator.requestMIDIAccess()
    .then((function (midiAccess) {
      for (var input of midiAccess.inputs.values()) {
        log(`attaching to device ${input.name}`);
        input.onmidimessage = this.OnMIDIMessage.bind(this);
      }
    }).bind(this), function () {
      log('Could not access your MIDI devices.');
    });
};

