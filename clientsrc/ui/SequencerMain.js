const React = require('react');
const DFU = require('../dfutil');
const DFMusic = require("../DFMusic");
const ClickAwayListener = require ('./3rdparty/react-click-away-listener');
const DF = require("../DFCommon");
const DFUtils = require("../util");
const SequencerPresetDialog = require("./SequencerPresetDialog");
const Seq = require('../SequencerCore');

const gPlayingUpdateInterval = 100;

// a timer that attempts to update things at metronomic intervals
class MetronomeTimer {
    //
}


const gTempoBPMStep = 5;
const gSpeeds = [//[ 8, 4, 3, 2, 1, .75, 2.0/3.0, .5, 1.0/3.0, .25];
    { caption: ".25x", speed: .25 },
    { caption: ".33x", speed: 1.0/3.0 },
    { caption: ".5x", speed: .5 },
    { caption: ".66x", speed: 2.0/3.0 },
    { caption: ".75x", speed: .75 },
    { caption: "1x", speed: 1 },
    { caption: "2x", speed: 2 },
    { caption: "3x", speed: 3 },
    { caption: "4x", speed: 4 },
    { caption: "8x", speed: 8 },
];

function GetNearestSpeedMatch(speed, indexDelta) {
    let minDist = Math.abs(gSpeeds[0].speed - speed);
    let minObjIndex = 0;
    for (let i = 1; i < gSpeeds.length; ++ i) {
        let dist = Math.abs(gSpeeds[i].speed - speed);
        if (dist >= minDist) continue;
        minDist = dist;
        minObjIndex = i;
    }
    minObjIndex += indexDelta ?? 0;
    if (minObjIndex < 0) minObjIndex = 0;
    if (minObjIndex >= gSpeeds.length - 1) minObjIndex = gSpeeds.length - 1;
    return gSpeeds[minObjIndex];
}

const gDivisionsMin = 1;
const gDivisionsMax = 8;
const gDivisions = [...new Array(gDivisionsMax - gDivisionsMin + 1)].map((_, i) => i);

const gSwingMax = 90;
const gSwingMin = -gSwingMax;
const gSwingSnapValues = [
    gSwingMin, -85,-80,-75,-66,-63,-60,-55,-50,-45,-40,-36,-33,-30,-25,-20,-15,-10,-5,
    0,5,10,15,20,25,30,33,36,40,45,50,55,60,63,66,70,75,80,85,gSwingMax/*,95,100*/];

// accepts values -100,100, returns the same.
function SnapSwingValue(v, delta) {
    delta ??= 0;

    // find nearest snap value.
    let minDist = 20000;
    let closestSnapIndex = 0;
    gSwingSnapValues.forEach((snapVal, idx) => {
        const dist = Math.abs(snapVal - v);
        if (dist >= minDist) return;
        minDist = dist;
        closestSnapIndex = idx;
    });

    closestSnapIndex += delta;
    if (closestSnapIndex < 0) closestSnapIndex = 0;
    if (closestSnapIndex >= gSwingSnapValues.length - 1) closestSnapIndex = gSwingSnapValues.length - 1;

    v = gSwingSnapValues[closestSnapIndex];
    return v;
}

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
      const musicalTime = ts.getMusicalTimeForBeat(absoluteBeatFloat);

      for (let subdiv = 0; subdiv < ts.subdivCount; ++subdiv) {
         const complete = (subdiv == musicalTime.subdivInfo.measureSubdivIndex) ? " complete" : "";
         const isMajor = ts.isMajorSubdiv(subdiv) ? " majorBeat" : " minorBeat";
        beats.push(<div key={subdiv} className={"beat" + complete + isMajor}>{subdiv + 1}</div>);
        }

        return <div className="liveRoomBeat">
            {beats}
        </div>
      }
};

/////////////////////////////////////////////////////////////////////////////////////////////////////////
class SequencerMain extends React.Component {
      constructor(props) {
         super(props);
         this.state = {
            showTimeSigDropdown: false,
            isPresetsExpanded: false,
            isSpeedExpanded: false,
            isDivExpanded :  false,
         };

         this.swingSliderID = "seqSwingSlider";
         this.timer = null;
      }

      
    componentDidMount() {
        DFUtils.stylizeRangeInput(this.swingSliderID, {
                bgNegColorSpec: "#444",
                negColorSpec: "#666",
                posColorSpec: "#666",
                bgPosColorSpec: "#444",
                zeroVal: 0,
            });
    }
    componentWillUnmount() {
        if (this.timer)
           clearTimeout(this.timer);
        this.timer = null;
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

        onClickDivision = (d) => {
            this.props.app.SeqSetDiv(d);
            this.setState({isDivExpanded:false});
        }

        onClickDivAdj = (delta) => {
            const patch = this.props.instrument.sequencerDevice.livePatch;
            let newDivisions = patch.GetDivisions() + delta;
            if (newDivisions < gDivisionsMin) return;
            if (newDivisions > gDivisionsMax) return;
            this.props.app.SeqSetDiv(newDivisions);
        }

        onClickPlayStop = () => {
            this.props.app.SeqPlayStop(!this.props.instrument.sequencerDevice.isPlaying);
        }


        onClickSwingSlider = (e) => {
            //
        }
        onDoubleClickSwingSlider = (e) => {
            console.log(`reset swing slide`);
            this.props.app.SeqSetSwing(0);
            $("#" + this.swingSliderID).val(0);
            $("#" + this.swingSliderID).trigger("change");
        }
        onChangeSwing = (e) => {
            let v = SnapSwingValue(e.target.value);
            v /= 100;
            this.props.app.SeqSetSwing(v);
        }

        onClickSwingAdj = (delta) => {
            const patch = this.props.instrument.sequencerDevice.livePatch;
            let v = SnapSwingValue(patch.swing * 100, delta);
            v /= 100;
            this.props.app.SeqSetSwing(v);
        }
        
        onClickPattern = (pattern, index) => {
            this.props.app.SeqSelectPattern(index);
        }

        onClickMuteNote = (noteInfo, isMuted) => {
            this.props.app.SetSetNoteMuted(noteInfo.midiNoteValue, isMuted);
        }

        onClickLength = (deltaMeasures) => {
            const patch = this.props.instrument.sequencerDevice.livePatch;
            let len = patch.GetLengthSubdivs();
            let meas = len / patch.timeSig.subdivCount;
            if (deltaMeasures > 0) {
                meas = Math.ceil(meas+0.1);
            }
            if (deltaMeasures < 0) {
                meas = Math.floor(meas - .1);
            }
            len = meas * patch.timeSig.subdivCount;
            if (!Seq.IsValidSequencerLengthSubdivs(len)) return;
            this.props.app.SeqSetLength(len);
        }
        
        onClickSpeed = (s) => {
            this.props.app.SeqSetSpeed(s.speed);
            this.setState({isSpeedExpanded:false});
        }

        onClickSpeedAdj = (delta) => {
            const patch = this.props.instrument.sequencerDevice.livePatch;
            const newSpeed = GetNearestSpeedMatch(patch.speed, delta).speed;
            this.props.app.SeqSetSpeed(newSpeed);
        }

        timerProc() {
            this.timer = null;
            const seq = this.props.instrument.sequencerDevice;
            if (seq.isPlaying) {
                this.timer = setTimeout(() => this.timerProc(), gPlayingUpdateInterval);
            }
            this.setState({});
        }

      render() {
         const seq = this.props.instrument.sequencerDevice;
         const patch = seq.livePatch;
         const notes = seq.GetNoteLegend();
         const playheadAbsBeat = this.props.app.getAbsoluteBeatFloat();
         const playheadInfo = patch.GetInfoAtAbsBeat(playheadAbsBeat);
         //console.log(`playhead pattern div = ${playheadInfo.patternDiv.toFixed(2)}, absLoop=${playheadInfo.absLoop.toFixed(2)} patternBeat=${playheadInfo.patternBeat.toFixed(2)} patternLengthBeats=${playheadInfo.patternLengthBeats}`);

         const isReadOnly = this.props.observerMode;

         const speedObj = GetNearestSpeedMatch(patch.speed, 0);

         if (seq.isPlaying && !this.timer) {
             this.timer = setTimeout(() => this.timerProc(), gPlayingUpdateInterval);
         }
         if (!seq.isPlaying && this.timer) {
             clearTimeout(this.timer);
             this.timer = null;
         }

         const timeSigList = this.state.showTimeSigDropdown && DFMusic.CommonTimeSignatures.map(ts => {
             return (
                 <li key={ts.id} onClick={() => this.onClickTimeSig(ts)}>{ts.toString()}</li>
             );
         });

         const speedList = this.state.isSpeedExpanded && gSpeeds.map(s => {
            return (
               <li key={s.caption} onClick={() => this.onClickSpeed(s)}>{s.caption}</li>
           );
        });

        const divisionsList = this.state.isDivExpanded && gDivisions.map(s => {
            return (
               <li key={s} onClick={() => this.onClickDivision(s)}>{s}</li>
           );
        });

        const keys = notes.map(k => {
            const isMuted = patch.IsNoteMuted(k.midiNoteValue);
            return (
                <li key={k.midiNoteValue} id={"key_" + k.midiNoteValue} className={k.cssClass}>
                    <div className='rowName'>{k.name}</div>
                    <div
                        className={isMuted ? 'muteRow muted' : 'muteRow'}
                        onClick={()=>this.onClickMuteNote(k, !isMuted)}
                    >M</div>
                </li>
                );
        });

        const patternButtons = patch.patterns.map((pattern, index) => {
            return (<button
                key={index}
                onClick={() => this.onClickPattern(pattern, index)}
                className={("patternSelect") + (pattern.hasData() ? "" : " disabled") + (index === patch.selectedPatternIdx ? " active" : "")}>
                    {"ABCDEFGHIJKLMNOPQRSTUV"[index]}
                </button>);
        });

        const pianoRollColumn = (divisionKey, beginPatternBeat, endPatternBeat) => notes.map(k => {
            let cssClass = k.cssClass;
            if (patch.IsNoteMuted(k.midiNoteValue))
                cssClass += ' muted';
            // if note touches range, note
            // playhead indicator
            // hover
            // note color
            // mute
            return (
                <li key={divisionKey + "_" + k.midiNoteValue} className={cssClass}>
                    <div className='noteBase'>
                    <div className='noteOL'>
                    <div className='playheadOL'>
                        <div className='muteOL'>
                        <div className='hoverOL'></div>
                        </div>
                    </div>
                    </div>
                    </div>
                </li>
            )
        });

        const pianoRoll = [];

        const divisionCount = patch.GetDivisions();
        let patternDiv = 0; // index of the div across the whole pattern
        for (let patternSubdiv = 0; patternSubdiv < patch.GetLengthSubdivs(); ++ patternSubdiv) {
            let subdivMusicalTime = patch.timeSig.getMusicalTimeForSubdiv(patternSubdiv);
            for (let iDivision = 0; iDivision < divisionCount; ++ iDivision, ++ patternDiv) {
                const key = iDivision + "_" + patternSubdiv;
                const measureBoundary = iDivision === 0 && subdivMusicalTime.subdivInfo.measureSubdivIndex === 0; // beatBoundary && !iBeat;
                const majorSubdiv = iDivision === 0 && subdivMusicalTime.subdivInfo.isMajorSubdiv;

                const isPlaying = seq.isPlaying && Math.floor(playheadInfo.patternDiv) === patternDiv;

                const className = `div${divisionCount} pianoRollColumn` +
                    (measureBoundary ? " beginMeasure" : "") +
                    (majorSubdiv ? " majorSubdiv" : "") +
                    (isPlaying ? " playing" : "");
                pianoRoll.push(
                         <ul key={key} className={className}>
                             {pianoRollColumn(key)}
                         </ul>);
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
                                    {patternButtons}
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
                            <div className='paramValue clickable' onClick={() => { this.setState({isSpeedExpanded:!this.state.isSpeedExpanded});}}>{speedObj.caption}</div>
                                { this.state.isSpeedExpanded &&
                                    <ClickAwayListener onClickAway={() => { this.setState({isSpeedExpanded:false});}}>
                                        <div className='dialog'>
                                            <legend onClick={() => { this.setState({isSpeedExpanded:false});}}>Select a speed</legend>
                                            <ul className='dropDownMenu'>
                                                {speedList}
                                            </ul>
                                        </div>
                                    </ClickAwayListener>
                                }
                                <div className="buttonArray vertical">
                                    <button onClick={() => this.onClickSpeedAdj(1)}><i className="material-icons">arrow_drop_up</i></button>
                                    <button onClick={() => this.onClickSpeedAdj(-1)}><i className="material-icons">arrow_drop_down</i></button>
                                </div>
                            </div>
                        </div>
                        <div className='paramGroup'>
                            <div className='legend'>Div</div>
                            <div className='paramBlock'>
                            <div className='paramValue clickable' onClick={() => { this.setState({isDivExpanded:!this.state.isDivExpanded});}}>{patch.GetDivisions()}</div>
                                { this.state.isDivExpanded &&
                                    <ClickAwayListener onClickAway={() => { this.setState({isDivExpanded:false});}}>
                                        <div className='dialog'>
                                            <legend onClick={() => { this.setState({isDivExpanded:false});}}>Select a subdivision count</legend>
                                            <ul className='dropDownMenu'>
                                                {divisionsList}
                                            </ul>
                                        </div>
                                    </ClickAwayListener>
                                }
                                <div className="buttonArray vertical">
                                    <button onClick={() =>{this.onClickDivAdj(1)}}><i className="material-icons">arrow_drop_up</i></button>
                                    <button onClick={() =>{this.onClickDivAdj(-1)}}><i className="material-icons">arrow_drop_down</i></button>
                                </div>
                            </div>
                        </div>
                        <div className='paramGroup'>
                            <div className='legend'>Swing</div>
                            <div className='paramBlock'>
                                <div className='paramValue'>{Math.floor(patch.swing * 100)}%</div>
                                <div className="buttonArray vertical">
                                    <button onClick={() =>{this.onClickSwingAdj(1)}}><i className="material-icons">arrow_drop_up</i></button>
                                    <button onClick={() =>{this.onClickSwingAdj(-1)}}><i className="material-icons">arrow_drop_down</i></button>
                                </div>
                                <div className="buttonArray">
                                <input id={this.swingSliderID} disabled={isReadOnly} style={{width:"60px"}} type="range"
                                    className='stylizedRange'
                                    min={gSwingMin} max={gSwingMax}
                                    onClick={this.onClickSwingSlider}
                                    onDoubleClick={this.onDoubleClickSwingSlider}
                                    onChange={this.onChangeSwing}
                                    value={patch.swing * 100}
                                />
                                </div>
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
                            <div className='paramValue'>{patch.GetLengthSubdivs()}</div>
                                <div className="buttonArray vertical">
                                    <button onClick={()=>this.onClickLength(1)}><i className="material-icons">arrow_drop_up</i></button>
                                    <button onClick={()=>this.onClickLength(-1)}><i className="material-icons">arrow_drop_down</i></button>
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
                        <div className='pianoRollContainer'>
                        {pianoRoll}
                        </div>
                    </div>
                </div>
            </div>
        </div>
        );
    }
};

module.exports = SequencerMain;

