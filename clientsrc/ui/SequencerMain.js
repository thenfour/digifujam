const React = require('react');
const DFU = require('../dfutil');
const DFMusic = require("../DFMusic");
const ClickAwayListener = require ('./3rdparty/react-click-away-listener');
const DF = require("../DFCommon");
const SequencerPresetDialog = require("./SequencerPresetDialog");

/////////////////////////////////////////////////////////////////////////////////////////////////////////
class RoomBeat extends React.Component {
   constructor(props) {
      super(props);
      this.state = {};
   }
   onTimer() {
      this.setState({});
   }
   componentDidMount() {
      this.timer = setInterval(() => { this.onTimer(); }, 50);
   }
   componentWillUnmount() {
      if (this.timer)
         clearTimeout(this.timer);
      this.timer = null;
   }

   render() {
      let beats = [];
      const absoluteBeatFloat = this.props.app.getAbsoluteBeatFloat();
      const ts = this.props.timeSig;
      const musicalTime = ts.getMusicalTime(absoluteBeatFloat);

      for (let i = 0; i < ts.num; ++i) {
         const complete = (i == musicalTime.measureBeatInt) ? " complete" : "";
         const isMajor = ts.isMajorBeat(i) ? " majorBeat" : " minorBeat";
        beats.push(<div key={i} className={"beat" + complete + isMajor}>{i + 1}</div>);
        }

        return <div className="liveRoomBeat">
            {beats}
        </div>
      }
};
/////////////////////////////////////////////////////////////////////////////////////////////////////////

const gTempoBPMStep = 5;
const gSpeeds = [ 8, 4, 3, 2, 1, .75, 2.0/3.0, .5, 1.0/3.0, .25];
const gDivisions = [ 1, 2, 3, 4, 5, 6, 7, 8];

class SequencerPatternView
{
}


/////////////////////////////////////////////////////////////////////////////////////////////////////////
class SequencerMain extends React.Component {
      constructor(props) {
         super(props);
         this.state = {
            measuresPerPattern : 4,
            beatsPerMeasure : 4,
            divisionsPerBeat : 2, // 16ths
            showTimeSigDropdown: false,
            isPresetsExpanded: false,
         };
      }

      onPowerButtonClick = () => {
          this.props.setSequencerShown(false);
      }

      onClickLowerTempo = () => {
        let bpm = this.props.app.roomState.bpm;
        bpm = Math.floor((bpm - 1) / gTempoBPMStep) * gTempoBPMStep;
      this.props.app.SendRoomBPM(bpm);
    }

      onClickHigherTempo = () => {
          let bpm = this.props.app.roomState.bpm;
          bpm = Math.ceil((bpm + 1) / gTempoBPMStep) * gTempoBPMStep;
        this.props.app.SendRoomBPM(bpm);
      }

      onClickToggleMetronome = () => {
        this.props.app.metronome.isMuted = !this.props.app.metronome.isMuted;
        this.setState({});
      }

      onClickTimeSig = (ts) => {
        this.props.app.SeqSetTimeSig(ts);
        this.setState({showTimeSigDropdown:false});
        }

    onClickPlayStop = () => {
        this.props.app.SeqPlayStop(!this.props.instrument.sequencerDevice.isPlaying);
    }

      render() {
         //const notes = DFMusic.MidiNoteInfo.filter(k => k.midiNoteValue >= 74 && k.midiNoteValue <= 88).reverse();

         const seq = this.props.instrument.sequencerDevice;
         const patch = seq.livePatch;
         const notes = seq.GetNoteLegend();

         const timeSigList = this.state.showTimeSigDropdown && DFMusic.CommonTimeSignatures.map(ts => {
             return (
                 <li key={ts.id} onClick={() => this.onClickTimeSig(ts)}>{ts.toString()}</li>
             );
         });

        const keys = notes.map(k => (
            <li key={k.midiNoteValue} id={"key_" + k.midiNoteValue} className={k.cssClass}>
                <div className='rowName'>{k.name}</div>
                <div className={k.midiNoteValue%7 ? 'muteRow' : 'muteRow muted'}></div>
            </li>
        ));

        const pianoRollRows = (divisionKey, iDivision, iBeat) => notes.map(k => {
            return (
                <li key={divisionKey + "_" + k.midiNoteValue} className={k.cssClass}><div></div></li>
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
                    <div className='overlay'>
                    <div className='powerButton'>
                        <button className='powerButton' onClick={this.onPowerButtonClick}><i className="material-icons">visibility_off</i></button>
                    </div>
                    </div>

                    <div className='notOverlay'>
                    <div className='seqTop'>
                    <div className='seqTopColumn playButton'>
                        <div className="seqTopRow">
                            <fieldset>
                                <div className='paramGroup'>
                                    <div className='paramBlock'>
                                            <button className={seq.isPlaying ? 'playButton active' : "playButton"} onClick={this.onClickPlayStop}>
                                                <i className="material-icons">{seq.isPlaying ? 'pause' : 'play_arrow'}</i>
                                            </button>
                                    </div>
                                </div>
                            </fieldset>
                        </div>
                    </div>
                    <div className='seqTopColumn'>
                    <div className="seqTopRow">



                    <fieldset>
                            <div className='paramGroup'>
                                <div className='legend'>Room BPM</div>
                                <div className='paramBlock'>
                                <div className='paramValue'>
                                    {this.props.app.roomState.bpm}
                                </div>
                                <div className='buttonArray vertical'>
                                    <button onClick={this.onClickHigherTempo}><i className="material-icons">arrow_drop_up</i></button>
                                    <button onClick={this.onClickLowerTempo}><i className="material-icons">arrow_drop_down</i></button>
                                </div>
                                <div className='buttonArray'>
                                    <button className={this.props.app.metronome.isMuted ? 'metronome' : 'metronome active'} onClick={this.onClickToggleMetronome}>
                                    {(this.props.app.metronome.isMuted || this.props.app.IsMuted()) ? 
                                        (<i className="material-icons">volume_off</i>)
                                        : (<i className="material-icons">volume_up</i>)}
                                    </button>
                                </div>
                                </div>
                            </div>
                        </fieldset>



                        <fieldset>
                        <div className='paramGroup'>
                            <div className='legend'>Preset</div>
                            <div className='paramBlock'>
                            <div className='paramValue presetName clickable' onClick={() => { this.setState({isPresetsExpanded:!this.state.isPresetsExpanded});}}>Funker2</div>
                            { this.state.isPresetsExpanded &&
                                    <ClickAwayListener onClickAway={() => { this.setState({isPresetsExpanded:false});}}>
                                      <div className='dialog'>
                                        <SequencerPresetDialog app={this.props.app} onClose={() => { this.setState({isPresetsExpanded:false});}}></SequencerPresetDialog>
                                        </div>
                                    </ClickAwayListener>
                                    }



                                <div className="buttonArray">
                                    {/* <button onClick={() => { this.setState({isPresetsExpanded:!this.state.isPresetsExpanded});}}>Presets</button> */}
                                    <button className='altui disabled'><i className="material-icons">save</i></button>
                                    <button className='clearPattern initPreset'>INIT</button>
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
                                <div className="buttonArray">
                                <button className='clearPattern'><i className="material-icons">clear</i></button>
                                </div>
                            </div>
                            </div>
                        </fieldset>

                        <fieldset>
                        <div className='paramGroup'>
                            <div className='legend'>Speed</div>
                            <div className='paramBlock'>
                            <div className='paramValue'>0.5x</div>
                                <div className="buttonArray vertical">
                                    <button><i className="material-icons">arrow_drop_up</i></button>
                                    <button><i className="material-icons">arrow_drop_down</i></button>
                                </div>
                            </div>
                        </div>
                        <div className='paramGroup'>
                            <div className='legend'>Div</div>
                            <div className='paramBlock'>
                            <div className='paramValue'>8</div>
                                <div className="buttonArray vertical">
                                    <button><i className="material-icons">arrow_drop_up</i></button>
                                    <button><i className="material-icons">arrow_drop_down</i></button>
                                </div>
                            </div>
                        </div>
                        <div className='paramGroup'>
                            <div className='legend'>Swing</div>
                            <div className='paramBlock'>
                                <div className='paramValue'>33%</div>
                                <div className="buttonArray">
                                </div>
                                <input type='range' style={{width:"50px"}}></input>
                            </div>
                        </div>
                    </fieldset>


                    <fieldset>
                            <div className='paramGroup'>
                                <div className='legend'>Timesig</div>
                                <div className='paramBlock'>
                                    <div className='paramValue clickable' onClick={()=> {this.setState({showTimeSigDropdown:!this.state.showTimeSigDropdown});}}>
                                        {patch.timeSig.toString()}
                                    </div>
                                    {this.state.showTimeSigDropdown && (
                                        <ClickAwayListener onClickAway={() => { this.setState({showTimeSigDropdown:false});}}>
                                        <div className='dialog'>
                                            <legend onClick={() => { this.setState({showTimeSigDropdown:false});}}>Select a time signature</legend>
                                            <ul className='dropDownMenu'>
                                                {timeSigList}
                                            </ul>
                                        </div>
                                        </ClickAwayListener>
                                        )
                                        }
                                </div>
                            </div>
                        <div className='paramGroup'>
                            <div className='legend'>Length</div>
                            <div className='paramBlock'>
                            <div className='paramValue'>6</div>
                                <div className="buttonArray vertical">
                                <button><i className="material-icons">arrow_drop_up</i></button>
                                <button><i className="material-icons">arrow_drop_down</i></button>
                                </div>
                            </div>
                        </div>
                        </fieldset>



                    <fieldset>
                        <div className='paramGroup'>
                            <RoomBeat app={this.props.app} timeSig={patch.timeSig}></RoomBeat>
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
            </div>
        </div>
        );
    }
};

module.exports = SequencerMain;

