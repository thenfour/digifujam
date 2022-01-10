
const gDefaultColor = "#888";
const gDefaultUserID = "seq";

class KeybDisplayState {
    constructor(generateDOMIDProc) {
        this.generateDOMIDProc = generateDOMIDProc; // (midiNote) => { ... }
        this.notesOn = []; // not part of state because it's pure jquery

        // notes on keeps a list of references to a note, since multiple people can have the same note playing it's important for tracking the note offs correctly.
        for (let i = 0; i < 128; ++i) {
            this.notesOn.push([]); // empty initially.
        }
    }

    PushNoteOn(user, midiNote) {
        const userID = (user?.userID) ?? gDefaultUserID;
        const color = (user?.color) ?? gDefaultColor;
        this.notesOn[midiNote].push({ userID, color });
        let k = $(this.generateDOMIDProc(midiNote));
        if (!k.hasClass('active')) {
            k.addClass("active");
        }
        k.css("background-color", color);
    }

    RemoveUserNoteRef(userID, midiNote) {
        userID ??= gDefaultUserID;
        let refs = this.notesOn[midiNote];
        if (refs.length < 1) return; // 
        refs.removeIf(r => (r.userID == userID));

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

    AllUserNotesOff(userID) {
        userID ??= gDefaultUserID;
        for (let midiNote = 0; midiNote < 128; ++midiNote) {
            this.RemoveUserNoteRef(userID, midiNote);
        }
    }
};



module.exports = KeybDisplayState;

