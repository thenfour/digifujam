const React = require('react');
const DFU = require('../dfutil');
const DFMusic = require("../DFMusic");
const ClickAwayListener = require ('./3rdparty/react-click-away-listener');
const DF = require("../DFCommon");
const DFUtils = require("../util");
const SequencerPresetDialog = require("./SequencerPresetDialog");
const Seq = require('../SequencerCore');

const gPlayingUpdateInterval = 50;


const gTempoBPMStep = 5;

const gSpeeds = new DFUtils.FuzzySelector([
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
], (val, obj) => Math.abs(val - obj.speed));


// ok not really logical to use fuzzyselector here because we only accept exact matches but whatev
const gDivisionInfo = {
    /*Seq.eDivisionType.MajorBeat*/MajorBeat: { caption: "Major beat", cssClass:"div1"},
    /*Seq.eDivisionType.MinorBeat*/MinorBeat: { caption: "8th" , cssClass:"div2"},

    /*Seq.eDivisionType.MinorBeat_x2*/MinorBeat_x2: { caption: "16th" , cssClass:"div3"},
    /*Seq.eDivisionType.MinorBeat_x3*/MinorBeat_x3: { caption: "24th" , cssClass:"div4"},
    /*Seq.eDivisionType.MinorBeat_x4*/MinorBeat_x4: { caption: "32nd" , cssClass:"div5"},
};
const gDivisionSortedInfo = Object.keys(gDivisionInfo).map(divisionTypeKey => {
    const o = gDivisionInfo[divisionTypeKey];
    return {
        val: divisionTypeKey,
        caption: o.caption,
        cssClass: o.cssClass,
    };
});

const gDivisions = new DFUtils.FuzzySelector(gDivisionSortedInfo, (val, obj) => val === obj.val ? 0 : 1);




const gSwingSnapValues = new DFUtils.FuzzySelector([
    -90, -85,-80,-75,-66,-63,-60,-55,-50,-45,-40,-36,-33,-30,-25,-20,-15,-10,-5,
    0,5,10,15,20,25,30,33,36,40,45,50,55,60,63,66,70,75,80,85,90
], (val, obj) => Math.abs(val - obj));


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
    const ts = this.props.timeSig;
    const playheadQuarter = this.props.app.getAbsoluteBeatFloat();
    const playheadMeasureFrac = ts.getMeasureFracForAbsQuarter(playheadQuarter);

      const beats = ts.minorBeatInfo.map(mbi => {
        const isComplete = playheadMeasureFrac >= mbi.beginMeasureFrac && playheadMeasureFrac < mbi.endMeasureFrac;  // does mbi contain the playhead cursor
        return (<div key={mbi.minorBeatOfMeasure} className={"beat " + (isComplete ? " complete" : "") + (mbi.isMajorBeatBoundary ? " majorBeat" : " minorBeat")}>{mbi.minorBeatOfMeasure + 1}</div>);
      });

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
        if (this.props.observerMode) return; // even though you DO have access to this, it would just feel weird to allow it on the observer-mode sequencer.
        let bpm = this.props.app.roomState.bpm;
        bpm = Math.floor((bpm - 1) / gTempoBPMStep) * gTempoBPMStep;
      this.props.app.SendRoomBPM(bpm);
    }

      onClickHigherTempo = () => {
        if (this.props.observerMode) return; // even though you DO have access to this, it would just feel weird to allow it on the observer-mode sequencer.
          let bpm = this.props.app.roomState.bpm;
          bpm = Math.ceil((bpm + 1) / gTempoBPMStep) * gTempoBPMStep;
        this.props.app.SendRoomBPM(bpm);
      }

      onClickToggleMetronome = () => {
        this.props.app.metronome.isMuted = !this.props.app.metronome.isMuted;
        this.setState({});
      }

      onClickTimeSig = (ts) => {
        if (this.props.observerMode) return;
        this.props.app.SeqSetTimeSig(ts);
        this.setState({showTimeSigDropdown:false});
        }

        onClickDivision = (d) => {
            if (this.props.observerMode) return;
            this.props.app.SeqSetDiv(d);
            this.setState({isDivExpanded:false});
        }

        onClickDivAdj = (delta) => {
            if (this.props.observerMode) return;
            const patch = this.props.instrument.sequencerDevice.livePatch;
            const newDivisions = gDivisions.GetClosestMatch(patch.GetDivisionType(), delta);
            this.props.app.SeqSetDiv(newDivisions.val);
        }

        onClickPlayStop = () => {
            if (this.props.observerMode) return;
            this.props.app.SeqPlayStop(!this.props.instrument.sequencerDevice.isPlaying, this.props.instrument.instrumentID);
        }


        onClickSwingSlider = (e) => {
            //
        }
        onDoubleClickSwingSlider = (e) => {
            if (this.props.observerMode) return;
            this.props.app.SeqSetSwing(0);
            $("#" + this.swingSliderID).val(0);
            $("#" + this.swingSliderID).trigger("change");
        }
        onChangeSwing = (e) => {
            if (this.props.observerMode) return;
            let v = gSwingSnapValues.GetClosestMatch(e.target.value, 0);
            v /= 100;
            this.props.app.SeqSetSwing(v);
        }

        onClickSwingAdj = (delta) => {
            if (this.props.observerMode) return;
            const patch = this.props.instrument.sequencerDevice.livePatch;
            let v = gSwingSnapValues.GetClosestMatch(patch.swing * 100, delta);
            v /= 100;
            this.props.app.SeqSetSwing(v);
        }
        
        onClickPattern = (pattern, index) => {
            if (this.props.observerMode) return;
            this.props.app.SeqSelectPattern(index);
        }

        onClickMuteNote = (noteInfo, isMuted) => {
            if (this.props.observerMode) return;
            this.props.app.SetSetNoteMuted(noteInfo.midiNoteValue, isMuted);
        }

        onClickLength = (deltaMeasures) => {
            if (this.props.observerMode) return;
            const patch = this.props.instrument.sequencerDevice.livePatch;
            let len = patch.GetLengthMajorBeats();
            let meas = len / patch.timeSig.majorBeatsPerMeasure;
            if (deltaMeasures > 0) {
                meas = Math.ceil(meas+0.1);
            }
            if (deltaMeasures < 0) {
                meas = Math.floor(meas - .1);
            }
            len = meas * patch.timeSig.majorBeatsPerMeasure;
            if (!Seq.IsValidSequencerLengthMajorBeats(len)) return;
            this.props.app.SeqSetLength(len);
        }
        
        onClickSpeed = (s) => {
            if (this.props.observerMode) return;
            this.props.app.SeqSetSpeed(s.speed);
            this.setState({isSpeedExpanded:false});
        }

        onClickSpeedAdj = (delta) => {
            if (this.props.observerMode) return;
            const patch = this.props.instrument.sequencerDevice.livePatch;
            const newSpeed = gSpeeds.GetClosestMatch(patch.speed, delta).speed;
            this.props.app.SeqSetSpeed(newSpeed);
        }

        onCellClick = (patternView, divInfo, note) => {
            if (this.props.observerMode) return;
            // toggle a 1-div-length 
            //console.log(`clicked note ${note.midiNoteValue} @ pattern major beat ${divInfo.beginPatternMajorBeat}, div major beat length = ${divInfo.endPatternMajorBeat - divInfo.beginPatternMajorBeat}`);
            // convert this click to an ops struct
            //const seq = this.props.instrument.sequencerDevice;
            const ops = patternView.GetPatternOpsForCellCycle(divInfo, note);
            this.props.app.SeqPatternOps(ops);
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
          if (!this.props.instrument.allowSequencer)
            return null;
         const seq = this.props.instrument.sequencerDevice;
         const patch = seq.livePatch;
         const noteLegend = seq.GetNoteLegend();
         const patternViewData = new Seq.SequencerPatternView(patch, noteLegend);
         const playheadAbsBeat = this.props.app.getAbsoluteBeatFloat();
         const playheadPatternFrac = patch.GetPatternFracAtAbsQuarter(playheadAbsBeat);
         //console.log(`playhead pattern div = ${playheadInfo.patternDiv.toFixed(2)}, absLoop=${playheadInfo.absLoop.toFixed(2)} patternBeat=${playheadInfo.patternBeat.toFixed(2)} patternLengthBeats=${playheadInfo.patternLengthBeats}`);
         //console.log(`division count = ${patch.GetPatternDivisionCount()}`);
         //console.log(`playheadPatternFrac = ${playheadPatternFrac.toFixed(2)}`);
         //console.log(patternViewData.divInfo);

         const isReadOnly = this.props.observerMode;
         const clickableIfEditable = isReadOnly ? "" : " clickable";

         const speedObj = gSpeeds.GetClosestMatch(patch.speed, 0);

         
        const widthpx = Math.min(75, 20 + (400 / patternViewData.divs.length));
        const columnStyle = {width:`${widthpx}px`};
        const heightpx = 50;
        const rowStyle = {height:`${heightpx}px`};

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

         const speedList = this.state.isSpeedExpanded && gSpeeds.sortedValues.map(s => {
            return (
               <li key={s.caption} onClick={() => this.onClickSpeed(s)}>{s.caption}</li>
           );
        });

        const divisionsList = this.state.isDivExpanded && gDivisions.sortedValues.map(s => {
            return (
               <li key={s.val} onClick={() => this.onClickDivision(s.val)}>{s.caption}</li>
           );
        });

        const keys = noteLegend.map(note => {
            const isMuted = patch.IsNoteMuted(note.midiNoteValue);
            return (
                <li key={note.midiNoteValue} id={"key_" + note.midiNoteValue} style={rowStyle} className={note.cssClass}>
                    <div className='rowName'>{note.name}</div>
                    <div
                        className={(isMuted ? 'muteRow muted' : 'muteRow') + clickableIfEditable}
                        onClick={()=>this.onClickMuteNote(note, !isMuted)}
                    >M</div>
                </li>
                );
        });

        const patternButtons = patch.patterns.map((pattern, index) => {
            return (<button
                key={index}
                onClick={() => this.onClickPattern(pattern, index)}
                className={("patternSelect") + (pattern.HasData() ? "" : " disabled") + (index === patch.selectedPatternIdx ? " active" : "") + clickableIfEditable}>
                    {"ABCDEFGHIJKLMNOPQRSTUV"[index]}
                </button>);
        });

        const pianoRollColumn = (divInfo) => noteLegend.map(note => {
            let cssClass = note.cssClass ?? "";
            if (patch.IsNoteMuted(note.midiNoteValue))
                cssClass += ' muted';
            
            if ((note.midiNoteValue in divInfo.noteMap) && divInfo.noteMap[note.midiNoteValue].hasNote) {
                cssClass += divInfo.noteMap[note.midiNoteValue].cssClass + " note";
            }

            return (
                <li key={divInfo.patternDivIndex + "_" + note.midiNoteValue} style={rowStyle} className={cssClass}>
                    <div className='noteBase' onClick={()=>this.onCellClick(patternViewData, divInfo, note)}>
                    <div className='noteOL'>
                        <div className='muteOL'>
                        {/* <div className='hoverOL'></div> */}
                        </div>
                    </div>
                    </div>
                </li>
            )
        });

        const pianoRoll = patternViewData.divs.map(divInfo => {
            const isPlaying = seq.isPlaying && (playheadPatternFrac >= divInfo.beginPatternFrac) && (playheadPatternFrac < divInfo.endPatternFrac);

            const className = `${gDivisionInfo[patch.GetDivisionType()].cssClass} pianoRollColumn` +
                (divInfo.isMeasureBoundary ? " beginMeasure" : "") +
                (divInfo.isMajorBeatBoundary ? " majorBeat" : "") +
                (divInfo.isMinorBeatBoundary ? " minorBeat" : "") +
                (isPlaying ? " playing" : "");
            
            return (
                <ul key={divInfo.patternDivIndex} style={columnStyle} className={className}>
                    {pianoRollColumn(divInfo)}
                </ul>
                );
        });

        const topIndicators = patternViewData.divs.map(divInfo => {
            const isPlaying = seq.isPlaying && (playheadPatternFrac >= divInfo.beginPatternFrac) && (playheadPatternFrac < divInfo.endPatternFrac);

            const className = `${gDivisionInfo[patch.GetDivisionType()].cssClass} pianoRollColumn` +
                (divInfo.isMeasureBoundary ? " beginMeasure" : "") +
                (divInfo.isMajorBeatBoundary ? " majorBeat" : "") +
                (divInfo.isMinorBeatBoundary ? " minorBeat" : "") +
                (isPlaying ? " playing" : "");
            
            return (
                <ul key={divInfo.patternDivIndex} style={columnStyle} className={className}>
                    <li className='playhead'>{divInfo.patternDivIndex + 1}</li>
                </ul>
                );
        });

        return (
            <div className="sequencerFrame">
                <div className="sequencerMain">
                    <div className='overlay'>
                    <div className='powerButton'>
                        <button className='powerButton' onClick={this.onPowerButtonClick}><i className="material-icons">remove</i></button>
                    </div>
                    </div>

                    <div className='notOverlay'>
                    <div className='seqTop'>
                    <div className='seqTopColumn playButton'>
                        <div className="seqTopRow">
                            <fieldset>
                                <div className='paramGroup'>
                                    <div className='paramBlock'>
                                            <button className={(seq.isPlaying ? 'playButton active' : "playButton") + clickableIfEditable} onClick={this.onClickPlayStop}>
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
                                    <button onClick={this.onClickHigherTempo} className={clickableIfEditable}><i className="material-icons">arrow_drop_up</i></button>
                                    <button onClick={this.onClickLowerTempo} className={clickableIfEditable}><i className="material-icons">arrow_drop_down</i></button>
                                </div>
                                <div className='buttonArray'>
                                    <button className={"clickable metronome" + (this.props.app.metronome.isMuted ? '' : ' active')} onClick={this.onClickToggleMetronome}>
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
                                    <button className={'altui disabled' + clickableIfEditable}><i className="material-icons">save</i></button>
                                    <button title="Reset sequencer settings" className={'clearPattern initPreset' + clickableIfEditable}>INIT</button>
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
                                <button title="Copy pattern" className={'altui clickable'}><i className="material-icons">content_copy</i></button>
                                <button title="Paste pattern" className={'altui' + clickableIfEditable}><i className="material-icons">content_paste</i></button>
                                </div>
                                <div className="buttonArray">
                                <button title="Clear pattern" className={'clearPattern' + clickableIfEditable}><i className="material-icons">clear</i></button>
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
                                    <button className={clickableIfEditable} onClick={() => this.onClickSpeedAdj(1)}><i className="material-icons">arrow_drop_up</i></button>
                                    <button className={clickableIfEditable} onClick={() => this.onClickSpeedAdj(-1)}><i className="material-icons">arrow_drop_down</i></button>
                                </div>
                            </div>
                        </div>
                        <div className='paramGroup'>
                            <div className='legend'>Div</div>
                            <div className='paramBlock'>
                            <div className='paramValue clickable' onClick={() => { this.setState({isDivExpanded:!this.state.isDivExpanded});}}>
                                {gDivisionInfo[patch.GetDivisionType()].caption}
                            </div>
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
                                    <button className={clickableIfEditable} onClick={() =>{this.onClickDivAdj(1)}}><i className="material-icons">arrow_drop_up</i></button>
                                    <button className={clickableIfEditable} onClick={() =>{this.onClickDivAdj(-1)}}><i className="material-icons">arrow_drop_down</i></button>
                                </div>
                            </div>
                        </div>


                        {/* <div className='paramGroup'>
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
                                    min={gSwingSnapValues.min} max={gSwingSnapValues.max}
                                    onClick={this.onClickSwingSlider}
                                    onDoubleClick={this.onDoubleClickSwingSlider}
                                    onChange={this.onChangeSwing}
                                    value={patch.swing * 100}
                                />
                                </div>
                            </div>
                        </div> */}



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
                            <div className='paramValue'>{patch.GetLengthMajorBeats()}</div>
                                <div className="buttonArray vertical">
                                    <button className={clickableIfEditable} onClick={()=>this.onClickLength(1)}><i className="material-icons">arrow_drop_up</i></button>
                                    <button className={clickableIfEditable} onClick={()=>this.onClickLength(-1)}><i className="material-icons">arrow_drop_down</i></button>
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



                    <div className="pianoRollTopIndicators">
                        <div className="pianoRollLegendCont">
                            <ul className="pianoRollLegend">
                                <li>
                                    {/* <div className='muteRow muted'>M</div> */}
                                </li>
                            </ul>
                        </div>
                        <div className='pianoRollContainer'>
                            {topIndicators}
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

