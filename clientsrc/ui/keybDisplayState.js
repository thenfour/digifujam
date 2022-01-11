
class KeybDisplayState {
    constructor(generateDOMIDProc) {
        this.generateDOMIDProc = generateDOMIDProc; // (midiNote) => { ... }
        this.notesOn = []; // not part of state because it's pure jquery

        // notes on keeps a list of references to a note, since multiple people can have the same note playing it's important for tracking the note offs correctly.
        for (let i = 0; i < 128; ++i) {
            this.notesOn.push([]); // empty initially.
        }
    }

    PushNoteOn(id, color, midiNote) {
        //const userID = (user?.userID) ?? gDefaultUserID;
        //const color = (user?.color) ?? gDefaultColor;
        if (!(midiNote in this.notesOn)) return;
        this.notesOn[midiNote].push({ id, color });
        let k = $(this.generateDOMIDProc(midiNote));
        if (!k.hasClass('active')) {
            k.addClass("active");
        }
        k.css("background-color", color);
    }

    RemoveUserNoteRef(id, midiNote) {
        //userID ??= gDefaultUserID;
        if (!(midiNote in this.notesOn)) return;
        let refs = this.notesOn[midiNote];
        if (refs.length < 1) return; // 
        refs.removeIf(r => (r.id == id));

        let k = $(this.generateDOMIDProc(midiNote));
        if (refs.length < 1) {
            k.removeClass("active");
            k.css("background-color", "");
            return;
        }
        k.css("background-color", refs[refs.length - 1].color);
    }


    AllNotesOff() {
        // set all notes CSS
        for (let midiNote = 0; midiNote < 128; ++midiNote) {
            let k = $(this.generateDOMIDProc(midiNote));
            k.removeClass("active");
            k.css("background-color", "");
        }

        this.notesOn = []; // not part of state because it's pure jquery
        // notes on keeps a list of references to a note, since multiple people can have the same note playing it's important for tracking the note offs correctly.
        for (let i = 0; i < 128; ++i) {
            this.notesOn.push([]); // empty initially.
        }
    }

    AllUserNotesOff(id) {
        //userID ??= gDefaultUserID;
        for (let midiNote = 0; midiNote < 128; ++midiNote) {
            this.RemoveUserNoteRef(id, midiNote);
        }
    }
};



module.exports = KeybDisplayState;

