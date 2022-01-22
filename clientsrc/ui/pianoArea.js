const React = require('react');
const DFMusic = require("../DFMusic");

class PianoArea extends React.Component {
    render() {
        const showNoteValues = window.DFShowDebugInfo;
        if (!this.props.app) return null;
        const keys = DFMusic.MidiNoteInfo.map(k => (
            <li key={k.midiNoteValue} id={"key_" + k.midiNoteValue} className={k.cssClass}>
                {showNoteValues && <span className="noteName">{k.name} {k.midiNoteValue}</span>}
                <span className="drum" id={"drum_" + k.midiNoteValue}></span>
            </li>
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
};