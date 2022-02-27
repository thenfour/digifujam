const React = require('react');
const DFMusic = require('../../DFcommon/DFMusic');
const {RadioControls} = require('./radioControls')

class Keyboard extends React.Component {
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
                    <ul className="keyboard">
                        {keys}
                    </ul>
        );
    }
}

class PianoArea extends React.Component {
    render() {
        if (!this.props.app) return null;
        return (
            <div id="pianoArea" style={{ gridArea: "pianoArea" }}>
                {this.props.app.radio && <RadioControls app={this.props.app}></RadioControls>}
                {!this.props.app.radio && <Keyboard app={this.props.app}></Keyboard>}
            </div>
        );
    }
}


module.exports= {
    PianoArea,
};