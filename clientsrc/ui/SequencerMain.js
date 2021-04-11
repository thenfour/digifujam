const React = require('react');
const PianoArea = require('./pianoArea');

class SequencerMain extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            measuresPerPattern: 4,
            beatsPerMeasure: 4,
            divisionsPerBeat: 2, // 16ths
        };
    }

    render() {
        const notes = PianoArea.gNotes.filter(k => k.midiNoteValue >= 24 && k.midiNoteValue <= 88).reverse();

        const keys = notes.map(k => (
            <li key={k.midiNoteValue} id={"key_" + k.midiNoteValue} className={k.cssClass}>{k.name}</li>
        ));

        const pianoRollRows = (divisionKey, iDivision, iBeat) => notes.map(k => {
            let extraClass = k.midiNoteValue == 60 && iDivision == 0 ? "note" : null;
            if (k.midiNoteValue == 63) {
                extraClass = iBeat == 0 ? "note" : null;
            }
            if (k.midiNoteValue == 69) {
                extraClass = iBeat > 0 ? "note" : null;
            }
            if (k.midiNoteValue == 72) {
                extraClass = iBeat > 0 ? "note" : null;
                extraClass += iDivision == 0 ? " noteOn" : " noteOff";
            }
            if (k.midiNoteValue == 74) {
                extraClass = "note noteOn noteOff";
            }
            return (
            <li key={divisionKey + "_" + k.midiNoteValue} className={extraClass + " " + k.cssClass}><div></div></li>
        )}
        );

        const divisions = [];

        for (let iMeasure = 0; iMeasure < this.state.measuresPerPattern; ++iMeasure) {
            for (let iBeat = 0; iBeat < this.state.beatsPerMeasure; ++iBeat) {
                for (let iDivision = 0; iDivision < this.state.divisionsPerBeat; ++iDivision) {
                    const key = iDivision + "_" + iBeat + "_" + iMeasure;
                    const beatBoundary = !iDivision;
                    const measureBoundary = beatBoundary && !iBeat;
                    const className = "pianoRollRows" + (measureBoundary ? " beginMeasure" : ((beatBoundary && !measureBoundary) ? " beginBeat" : ""));
                    divisions.push(
                        <ul key={key} className={className}>
                            {pianoRollRows(key, iDivision, iBeat)}
                        </ul>);
                }
            }
        }


        return (
            <div className="sequencerFrame">
                <div className="sequencerMain">
                    <div className="seqTop">
                        <fieldset>
                            <h2>Transport</h2>
                            {this.props.app.getMusicalTime().toString()}
                            <div className="buttonArray">
                                <button>record</button>
                                <button>play/stop</button>
                            </div>
                        </fieldset>
                        <fieldset>
                            <h2>Offset</h2>
                            <div className="buttonArray">
                                <button>-</button>
                                <button>+</button>
                            </div>
                        </fieldset>
                        <fieldset>
                            <h2>Pattern length</h2>
                            <div className="buttonArray">
                                <button>+</button>
                                <button>-</button>
                            </div>
                        </fieldset>
                        <fieldset>
                            <h2>Grid</h2>
                            <div className="buttonArray">
                                <button>+</button>
                                <button>-</button>
                            </div>
                        </fieldset>
                        <fieldset>
                            <input type="range"></input>
                            90 : velocity
                        </fieldset>
                        <fieldset>
                            <h2>Patterns</h2>
                            <div className="buttonArray">
                                <button>A</button>
                                <button>B</button>
                                <button>C</button>
                                <button>D</button>
                            </div>
                            <div className="buttonArray">
                                <button>E</button>
                                <button>F</button>
                                <button>G</button>
                                <button>H</button>
                            </div>
                        </fieldset>

                        {/* 
                        <fieldset>
                            <h2>Selection</h2>
                            <div className="buttonArray">
                                <button>rotate+</button>
                                <button>rotate-</button>
                                <button>transp+</button>
                                <button>transp-</button>
                                <button>quantize</button>
                                <button>delete</button>
                            </div>
                        </fieldset>
                        <fieldset>
                            <h2>Clipboard</h2>
                            <div className="buttonArray">
                                <button>Copy var</button>
                                <button>Paste var</button>
                                <button>Copy all</button>
                                <button>Paste all</button>
                            </div>
                        </fieldset> */}


                    </div>
                    <div className="pianoRollScrollCont">
                        <div className="pianoRollLegendCont">
                            <ul className="pianoRollLegend">
                                {keys}
                            </ul>
                        </div>
                        {divisions}
                    </div>
                </div>
            </div>);
    }
};

module.exports = SequencerMain;

