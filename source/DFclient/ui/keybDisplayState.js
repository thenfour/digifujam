
class KeybDisplayState {
  constructor(generateDOMIDProc) {
    this.generateDOMIDProc = generateDOMIDProc; // (midiNote) => { ... }
    this.notesOn = [];                          // not part of state because it's pure jquery

    // notes on keeps a list of references to a note, since multiple people can have the same note playing it's important for tracking the note offs correctly.
    for (let i = 0; i < 128; ++i) {
      this.notesOn.push([]); // empty initially.
    }
  }

  PushNoteOn(id, color, midiNote) {
    if (!(midiNote in this.notesOn))
      return;
    this.notesOn[midiNote].push({id, color});
    let k = document.getElementById(this.generateDOMIDProc(midiNote));
    if (k) {
      k.classList.add("active");
      k.style.backgroundColor = color;
    }
  }

  RemoveUserNoteRef(id, midiNote) {
    if (!(midiNote in this.notesOn))
      return;
    let refs = this.notesOn[midiNote];
    if (refs.length < 1)
      return; //
    refs.removeIf(r => (r.id == id));

    const el = document.getElementById(this.generateDOMIDProc(midiNote));
    if (!el)
      return;
    if (refs.length < 1) {
      el.classList.remove("active");
      el.style.backgroundColor = "";
      return;
    }
    el.style.backgroundColor = refs[refs.length - 1].color;
  }

  AllNotesOff() {
    // set all notes CSS
    for (let midiNote = 0; midiNote < 128; ++midiNote) {
      const el = document.getElementById(this.generateDOMIDProc(midiNote));
      if (el) {
        el.classList.remove("active");
        el.style.backgroundColor = "";
      }
    }

    this.notesOn = []; // not part of state because it's pure jquery
    // notes on keeps a list of references to a note, since multiple people can have the same note playing it's important for tracking the note offs correctly.
    for (let i = 0; i < 128; ++i) {
      this.notesOn.push([]); // empty initially.
    }
  }

  AllUserNotesOff(id) {
    for (let midiNote = 0; midiNote < 128; ++midiNote) {
      this.RemoveUserNoteRef(id, midiNote);
    }
  }
};

module.exports = KeybDisplayState;
