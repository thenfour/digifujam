const React = require('react');

let keyNote = function (midiNoteValue, name, cssClass) {
    return { midiNoteValue, name, cssClass };
};

const gNotes = [
    keyNote(21, "A0", "white a"),
    keyNote(22, "A#0", "black as"),
    keyNote(23, "B0", "white b"),
    keyNote(24, "C1", "white c"),
    keyNote(25, "C#1", "black cs"),
    keyNote(26, "D1", "white d"),
    keyNote(27, "D#1", "black ds"),
    keyNote(28, "E1", "white e"),
    keyNote(29, "F1", "white f"),
    keyNote(30, "F#1", "black fs"),
    keyNote(31, "G1", "white g"),
    keyNote(32, "G#1", "black gs"),

    keyNote(33, "A1", "white a"),
    keyNote(34, "A#1", "black as"),
    keyNote(35, "B1", "white b"),
    keyNote(36, "C2", "white c"),
    keyNote(37, "C#2", "black cs"),
    keyNote(38, "D2", "white d"),
    keyNote(39, "D#2", "black ds"),
    keyNote(40, "E2", "white e"),
    keyNote(41, "F2", "white f"),
    keyNote(42, "F#2", "black fs"),
    keyNote(43, "G2", "white g"),
    keyNote(44, "G#2", "black gs"),

    keyNote(45, "A2", "white a"),
    keyNote(46, "A#2", "black as"),
    keyNote(47, "B2", "white b"),
    keyNote(48, "C3", "white c"),
    keyNote(49, "C#3", "black cs"),
    keyNote(50, "D3", "white d"),
    keyNote(51, "D#3", "black ds"),
    keyNote(52, "E3", "white e"),
    keyNote(53, "F3", "white f"),
    keyNote(54, "F#3", "black fs"),
    keyNote(55, "G3", "white g"),
    keyNote(56, "G#3", "black gs"),

    keyNote(57, "A3", "white a"),
    keyNote(58, "A#3", "black as"),
    keyNote(59, "B3", "white b"),
    keyNote(60, "C4", "white c"),
    keyNote(61, "C#4", "black cs"),
    keyNote(62, "D4", "white d"),
    keyNote(63, "D#4", "black ds"),
    keyNote(64, "E4", "white e"),
    keyNote(65, "F4", "white f"),
    keyNote(66, "F#4", "black fs"),
    keyNote(67, "G4", "white g"),
    keyNote(68, "G#4", "black gs"),

    keyNote(69, "A4", "white a"),
    keyNote(70, "A#4", "black as"),
    keyNote(71, "B4", "white b"),
    keyNote(72, "C5", "white c"),
    keyNote(73, "C#5", "black cs"),
    keyNote(74, "D5", "white d"),
    keyNote(75, "D#5", "black ds"),
    keyNote(76, "E5", "white e"),
    keyNote(77, "F5", "white f"),
    keyNote(78, "F#5", "black fs"),
    keyNote(79, "G5", "white g"),
    keyNote(80, "G#5", "black gs"),

    keyNote(81, "A5", "white a"),
    keyNote(82, "A#5", "black as"),
    keyNote(83, "B5", "white b"),
    keyNote(84, "C6", "white c"),
    keyNote(85, "C#6", "black cs"),
    keyNote(86, "D6", "white d"),
    keyNote(87, "D#6", "black ds"),
    keyNote(88, "E6", "white e"),
    keyNote(89, "F6", "white f"),
    keyNote(90, "F#6", "black fs"),
    keyNote(91, "G6", "white g"),
    keyNote(92, "G#6", "black gs"),

    keyNote(93, "A6", "white a"),
    keyNote(94, "A#6", "black as"),
    keyNote(95, "B6", "white b"),
    keyNote(96, "C7", "white c"),
    keyNote(97, "C#7", "black cs"),
    keyNote(98, "D7", "white d"),
    keyNote(99, "D#7", "black ds"),
    keyNote(100, "E7", "white e"),
    keyNote(101, "F7", "white f"),
    keyNote(102, "F#7", "black fs"),
    keyNote(103, "G7", "white g"),
    keyNote(104, "G#7", "black gs"),

    keyNote(105, "A7", "white a"),
    keyNote(106, "A#7", "black as"),
    keyNote(107, "B7", "white b"),
    keyNote(108, "C8", "white c"),
    // keyNote(109, "C#8", "black cs"),
    // keyNote(110, "D8", "white d"),
    // keyNote(111, "D#8", "black ds"),
    // keyNote(112, "E8", "white e"),
    // keyNote(113, "F8", "white f"),
    // keyNote(114, "F#8", "black fs"),
    // keyNote(115, "G8", "white g"),
    // keyNote(116, "G#8", "black gs"),

    // keyNote(117, "A8", "white a"),
    // keyNote(118, "A#8", "black as"),
    // keyNote(119, "B8", "white b"),
    // keyNote(120, "C9", "white c"),
    // keyNote(121, "C#9", "black cs"),
    // keyNote(122, "D9", "white d"),
    // keyNote(123, "D#9", "black ds"),
    // keyNote(124, "E9", "white e"),
    // keyNote(125, "F9", "white f"),
    // keyNote(126, "F#9", "black fs"),
    // keyNote(127, "G9", "white g"),
];

class PianoArea extends React.Component {
    render() {
        if (!this.props.app) return null;
        const keys = gNotes.map(k => (
            <li key={k.midiNoteValue} id={"key_" + k.midiNoteValue} className={k.cssClass}><span className="drum" id={"drum_" + k.midiNoteValue}></span></li>
        ));
        return (
            <div id="pianoArea" style={{ gridArea: "pianoArea" }}>
                    <ul className="keyboard">
                        {keys}
                    </ul>
            </div>
        );
    }
}


module.exports= {
    PianoArea,
    gNotes,
};