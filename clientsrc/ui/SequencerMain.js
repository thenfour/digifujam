const React = require('react');
const PianoArea = require('./pianoArea');

class RoomBeat extends React.Component {
   constructor(props) {
      super(props);
      this.state = {};
   }
   onTimer() {
      //this.setState({});
   }
   componentDidMount() {
      this.timer = setInterval(() => { this.onTimer(); }, 100);
   }
   componentWillUnmount() {
      if (this.timer)
         clearTimeout(this.timer);
      this.timer = null;
   }

   render() {
      let beats = [];
      const musicalTime = this.props.app.getMusicalTime();
      const beatPercent = Math.trunc(musicalTime.measureBeatFrac * 100);

      //completeBeat = musicalTime.measureBeatInt % this.props.app.roomState.timeSig.num;

      for (let i = 0; i < this.props.app.roomState.timeSig.num; ++i) {
         const complete = (i < musicalTime.measureBeatInt) || ((i === this.props.app.roomState.timeSig.num - 1) && (musicalTime.measureBeatInt === 0)) ? " complete" : "";
         const inProgress = musicalTime.measureBeatInt === i ? " inProgress" : "";
        beats.push(<div key={i} className={"beat" + complete + inProgress}>{i + 1}</div>);
        }

        return <div className="liveRoomBeat">
            {beats}
        </div>
      }
   };

   class SequencerMain extends React.Component {
      constructor(props) {
         super(props);
         this.state = {
            measuresPerPattern : 4,
            beatsPerMeasure : 4,
            divisionsPerBeat : 2, // 16ths
         };
      }

      render() {
         const notes = PianoArea.gNotes.filter(k => k.midiNoteValue >= 64 && k.midiNoteValue <= 88).reverse();

        const keys = notes.map(k => (
            <li key={k.midiNoteValue} id={"key_" + k.midiNoteValue} className={k.cssClass}>
                <div className='rowName'>{k.name}</div>
                <div className={k.midiNoteValue%7 ? 'muteRow' : 'muteRow muted'}></div>
            </li>
        ));

        const pianoRollRows = (divisionKey, iDivision, iBeat) => notes.map(k => {
            //let extraClass = k.midiNoteValue == 60 && iDivision == 0 ? "note" : null;
            // if (k.midiNoteValue == 63) {
            //     extraClass = iBeat == 0 ? "note" : null;
            // }
            // if (k.midiNoteValue == 69) {
            //     extraClass = iBeat > 0 ? "note" : null;
            // }
            // if (k.midiNoteValue == 72) {
            //     extraClass = iBeat > 0 ? "note" : null;
            //     extraClass += iDivision == 0 ? " noteOn" : " noteOff";
            // }
            // if (k.midiNoteValue == 74) {
            //     extraClass = "note noteOn noteOff";
            // }
            // if (k.midiNoteValue == 79) {
            //     extraClass = "note noteOn noteOff";
            // }

            const extraClass = '';

            return (
                <li key={divisionKey + "_" + k.midiNoteValue} className={extraClass + " " + k.cssClass}><div></div></li>
            )
      });

      const divisions = [];

      for(let iMeasure = 0; iMeasure < this.state.measuresPerPattern; ++iMeasure) {
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

                    <div className='powerButton'>
                        <button className='powerButton'><i className="material-icons">power_settings_new</i></button>
                    </div>

                    <div className='seqTop'>
                    <div className='seqTopColumn playButton'>
                        <div className="seqTopRow">
                            <fieldset>
                                <div className='paramGroup'>
                                    <div className='paramBlock'>
                                            <button className='playButton'><i className="material-icons">play_arrow</i></button>
                                    </div>
                                </div>
                            </fieldset>
                        </div>
                    </div>
                    <div className='seqTopColumn'>
                    <div className="seqTopRow">
                        <fieldset>
                            <div className='paramGroup'>
                                <div className='legend'>Timesig</div>
                                <div className='paramBlock'>
                                    <div className='paramValue'>12/8</div>
                                </div>
                            </div>
                            <div className='paramGroup'>
                                <div className='legend'>BPM</div>
                                <div className='paramBlock'>
                                <div className='paramValue'>
                                    <input type="text"></input>
                                </div>
                                <div className='buttonArray'>
                                    <button><i className="material-icons">remove</i></button>
                                    <button><i className="material-icons">add</i></button>
                                    </div>
                                </div>
                            </div>
                        </fieldset>
                        <fieldset>
                        <div className='paramGroup'>
                            <div className='legend'>Beat offset</div>
                            <div className='paramBlock'>
                            <div className='paramValue'>+3</div>
                                <div className="buttonArray">
                                    <button><i className="material-icons">remove</i></button>
                                    <button><i className="material-icons">add</i></button>
                                </div>
                            </div>
                        </div>
                    </fieldset>

                    <fieldset>
                            <div className='paramGroup'>
                                <div className='legend'>Pattern</div>
                                <div className='paramBlock'>
                                <div className="buttonArray">
                                    <button>A</button>
                                    <button>B</button>
                                    <button className='active'>C</button>
                                    <button>D</button>
                                </div>
                                <div className="buttonArray">
                                <button className='altui'><i className="material-icons">content_copy</i></button>
                                <button className='altui'><i className="material-icons">content_paste</i></button>
                                </div>
                            </div>
                            </div>
                        </fieldset>

                    <fieldset>
                        <div className='paramGroup'>
                            <RoomBeat app={this.props.app}></RoomBeat>
                        </div>
                    </fieldset>


                    <fieldset>
                        <div className='paramGroup'>
                            <div className='legend'>Length</div>
                            <div className='paramBlock'>
                            <div className='paramValue'>6</div>
                                <div className="buttonArray">
                                <button><i className="material-icons">remove</i></button>
                                <button><i className="material-icons">add</i></button>
                                </div>
                            </div>
                        </div>
                        <div className='paramGroup'>
                            <div className='legend'>Subdivide</div>
                            <div className='paramBlock'>
                            <div className='paramValue'>8</div>
                                <div className="buttonArray">
                                    <button><i className="material-icons">remove</i></button>
                                    <button><i className="material-icons">add</i></button>
                                </div>
                            </div>
                        </div>
                        </fieldset>


                        <fieldset>
                        <div className='paramGroup'>
                            <div className='legend'>Speed</div>
                            <div className='paramBlock'>
                            <div className='paramValue'>0.5x</div>
                                <div className="buttonArray">
                                    <button><i className="material-icons">remove</i></button>
                                    <button><i className="material-icons">add</i></button>
                                </div>
                            </div>
                        </div>
                        <div className='paramGroup'>
                            <div className='legend'>Swing</div>
                            <div className='paramBlock'>
                                <div className='paramValue'>33%</div>
                                <div className="buttonArray">
                                </div>
                                <input type='range'></input>
                            </div>
                        </div>
                    </fieldset>

                    </div>
                    </div>
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

