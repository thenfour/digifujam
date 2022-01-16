const React = require('react');
const DFU = require('../dfutil');
const DFMusic = require("../DFMusic");
const ClickAwayListener = require ('./3rdparty/react-click-away-listener');
const DF = require("../DFCommon");
const DFUtils = require("../util");
const SequencerPresetDialog = require("./SequencerPresetDialog");
const Seq = require('../SequencerCore');

const gMinTimerInterval = 35;


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

const gTransposeValues = [-12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5,6, 7, 8, 9, 10, 11, 12].reverse();
const gTransposeCaptions = [
    "-12 (down octave)",
    "-11 (down ♮ 7th)",
    "-10 (down ♭ 7th)",
    "-9 (down ♮ 6th)",
    "-8 (down ♭ 6th)",
    "-7 (down 5th)",
    "-6 (down ♯ 4th)",
    "-5 (down 4th)",
    "-4 (down maj 3rd)",
    "-3 (down ♭ 3rd)",
    "-2 (down ♮ 2nd)",
    "-1",
    "0",
    "1",
    "2 (up ♮ 2nd)",
    "3 (up ♭ 3rd)",
    "4 (up maj 3rd)",
    "5 (up 4th)",
    "6 (up ♯ 4th)",
    "7 (up 5th)",
    "8 (up ♭ 6th)",
    "9 (up ♮ 6th)",
    "10 (up ♭ 7th)",
    "11 (up ♮ 7th)",
    "12 (up octave)",
].reverse();

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



function GenerateRoomBeatID(minorBeatOfMeasure) {
    return `seq_roomBeat_${minorBeatOfMeasure}`;
}
function GeneratePlayheadID(div) {
    return `seq_playhead_${div}`;
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
// a timer which is optimized for sequencer usage.
// every impulse we:
// - set CSS class of correct room beat to "complete"
// - set CSS class of correct playhead row to "playing"
// - invoke animation of instrument seq note indicator
// - set the next interval on the next div position.
class SeqTimer
{
    constructor(app) {
        this.app = app;
        this.instrument = null; // while instrument is null we don't do any processing.
        this.timer = null;
        this.#cueTimer();
    }

    SetInstrument(instrument) {
        this.instrument = instrument;
        this.#cueTimer();
    }
    Stop() {
        this.SetInstrument(null);
    }

    #cueTimer() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (!this.instrument)
            return;

        const nextDivInfo = this.#GetNextDivInfo();
        this.timer = setTimeout(() => this.#timerProc(nextDivInfo), nextDivInfo.delayMS);
    }

    // return {divInfo of next div, delayMS}
    #GetNextDivInfo() {
        const seq = this.instrument.sequencerDevice;
        const patch = seq.livePatch;
        const noteLegend = seq.GetNoteLegend();
        const patternViewData = Seq.GetPatternView(patch, noteLegend);
        //const ts = patch.timeSig;
        const playheadAbsQuarter = this.app.getAbsoluteBeatFloat();
        const playheadPatternFrac = seq.GetPatternFracAtAbsQuarter(playheadAbsQuarter);
        const patternLengthQuarters = patch.GetPatternLengthQuarters();
        const bpm = this.app.roomState.bpm;

        const currentDiv = patternViewData.divs.find(divInfo => divInfo.IncludesPatternFrac(playheadPatternFrac));

        // calc divlength MS
        const divRemainingPatterns = currentDiv.endPatternFrac - playheadPatternFrac;
        const divRemainingQuarters = divRemainingPatterns * patternLengthQuarters;
        let delayMS = DFU.BeatsToMS(divRemainingQuarters, bpm);

        let destDivIndex = currentDiv.patternDivIndex + 1;
        let destDiv = patternViewData.divs[destDivIndex % patternViewData.divs.length];
        console.assert((destDivIndex % patternViewData.divs.length) === destDiv.patternDivIndex);
        while (delayMS < gMinTimerInterval) {
            const divLenPatterns = destDiv.endPatternFrac - destDiv.beginPatternFrac;
            const divLenQuarters = divLenPatterns * patternLengthQuarters;
            const divLenMS = DFU.BeatsToMS(divLenQuarters, bpm);
            delayMS += divLenMS;
            destDivIndex ++;
            destDiv = patternViewData.divs[destDivIndex % patternViewData.divs.length];
            console.assert((destDivIndex % patternViewData.divs.length) === destDiv.patternDivIndex);
        }

        return {
            delayMS,
            currentDiv,
            destDiv,
            patternViewData, // send this as well for coherence with other properties.
        };
    }

    #timerProc(nextDivInfo) {
        const seq = this.instrument.sequencerDevice;
        const patch = seq.livePatch;
        const ts = patch.timeSig;
        const playheadAbsQuarter = this.app.getAbsoluteBeatFloat();
        this.#cueTimer();

        // we don't need to recalc live playhead position stuff for sequencer. this timer *represents* what's given in nextDivInfo.destDiv; just use it.
        const thisDiv = nextDivInfo.destDiv;

        //const playheadMeasureFrac = thisDiv.beginMeasureFrac;
        let playheadMeasureFrac = ts.getMeasureFracForAbsQuarter(playheadAbsQuarter);

        // ROOM BEAT should use live data (not the cached sequencer calcs) because it doesn't use seq speed settings.
        // and i want it to show original tempo. this means they can get slightly out of sync though.
        // and that means becasue of random jitter in timer firing, it's random whether we will set "complete"
        // - just after the beat
        // - or just before the beat.
        // but it's always going to be really close, and we're dealing with pretty big margins. so just nudge it into the right slot.
        // there's probably a more technically correct way (something like divs per measure / 2 or so), but this is practical and simple.
        playheadMeasureFrac += 0.01;

        ts.minorBeatInfo.forEach(mbi => {
            const isComplete = playheadMeasureFrac >= mbi.beginMeasureFrac && playheadMeasureFrac < mbi.endMeasureFrac;
            const id = "#" + GenerateRoomBeatID(mbi.minorBeatOfMeasure);
            if (isComplete) {
                $(id).addClass("complete");
            } else {
                $(id).removeClass("complete");
            }
        });

        nextDivInfo.patternViewData.divs.forEach(div => {
            const isPlaying = div.patternDivIndex === thisDiv.patternDivIndex;
            const id = "#" + GeneratePlayheadID(div.patternDivIndex);
            if (isPlaying) {
                $(id).addClass("playing");
            } else {
                $(id).removeClass("playing");
            }
        });
    }
}



/////////////////////////////////////////////////////////////////////////////////////////////////////////
class RoomBeat extends React.Component {
   constructor(props) {
      super(props);
      this.state = {};
   }

   render() {
    const ts = this.props.timeSig;

      const beats = ts.minorBeatInfo.map(mbi => {
        return (<div
            key={mbi.minorBeatOfMeasure}
            className={"beat " + (mbi.isMajorBeatBoundary ? " majorBeat" : " minorBeat")}
            id={GenerateRoomBeatID(mbi.minorBeatOfMeasure)}
            >{mbi.minorBeatOfMeasure + 1}</div>);
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
            isTransposeExpanded: false,
            isEditExpanded: false,
            zoom: 10,
         };

         this.swingSliderID = "seqSwingSlider";
         this.timer = null;
      }

      
    componentDidMount() {
        this.timer = new SeqTimer(this.props.app);
        this.timer.SetInstrument(this.props.instrument);

        DFUtils.stylizeRangeInput(this.swingSliderID, {
                bgNegColorSpec: "#444",
                negColorSpec: "#666",
                posColorSpec: "#666",
                bgPosColorSpec: "#444",
                zeroVal: 0,
            });
    }
    componentWillUnmount() {
        this.timer.Stop();
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

        onClickTranspose = (d) => {
            if (this.props.observerMode) return;
            this.props.app.SeqSetTranspose(d);
            this.setState({isTransposeExpanded:false});
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

        onClickLength = (delta) => {
            if (this.props.observerMode) return;
            const patch = this.props.instrument.sequencerDevice.livePatch;
            let len = patch.GetLengthMajorBeats() + delta;
            let meas = len / patch.timeSig.majorBeatsPerMeasure;
            if (delta > 0) {
                meas = Math.ceil(meas+0.1);
            }
            if (delta < 0) {
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

        onClickOctaveAdj = (delta) => {
            if (this.props.observerMode) return;
            const patch = this.props.instrument.sequencerDevice.livePatch;
            const newOct = patch.GetOctave() + delta;
            if (!Seq.IsValidSequencerOctave(newOct)) return;
            this.props.app.SeqSetOct(newOct);
        }

        onClickTransposeAdj = (delta) => {
            if (this.props.observerMode) return;
            const patch = this.props.instrument.sequencerDevice.livePatch;
            const n = patch.GetTranspose() + delta;
            if (!Seq.IsValidSequencerTranspose(n)) return;
            this.props.app.SeqSetTranspose(n);
        }

        onCellClick = (patternView, divInfo, note, legend, patch) => {
            if (this.props.observerMode) return;
            // toggle a 1-div-length 
            // convert this click to an ops struct
            let ops = null;
            if (window.DFModifierKeyTracker.ShiftKey) {
                if (window.DFModifierKeyTracker.CtrlKey) {
                    ops = patternView.GetPatternOpsForCellToggle(divInfo, note, 1); // CTRL+SHIFT = toggle vel1
                } else {
                    ops = patternView.GetPatternOpsForCellRemove(divInfo, note); // SHIFT = delete
                }
            } else {
                if (window.DFModifierKeyTracker.CtrlKey) {
                    ops = patternView.GetPatternOpsForCellToggle(divInfo, note, 0); // CTRL = toggle vel0
                } else {
                    ops = patternView.GetPatternOpsForCellCycle(divInfo, note); // none = cycle
                }
            }

            if (!ops)
                return;

            const op = ops.find(o => o.type === Seq.eSeqPatternOp.AddNote);
            if (op) {
                let midiNoteValue = this.props.instrument.sequencerDevice.livePatch.AdjustMidiNoteValue(op.midiNoteValue);
                if (midiNoteValue) {
                    const legendNote = legend.find(n => n.midiNoteValue === op.midiNoteValue);
                    const velocityEntry = legendNote?.velocitySet[op.velocityIndex];
                    const velocity = velocityEntry?.vel ?? 99;

                    const patternLengthQuarters = patch.GetPatternLengthQuarters();
                    const bpm = this.props.app.roomState.bpm;
                    const lengthPatternFrac = divInfo.endPatternFrac - divInfo.beginPatternFrac;
                    const lengthQuarters = lengthPatternFrac * patternLengthQuarters;
                    const lengthMS = DFU.BeatsToMS(lengthQuarters, bpm);

                    this.props.app.PreviewNoteOn(midiNoteValue, velocity);
                    setTimeout(() => {
                        this.props.app.PreviewNoteOff();
                    }, lengthMS);
                }
            }

            this.props.app.SeqPatternOps(ops);
        }

        onClickInitPatch = () => {
            if (this.props.observerMode) return;
            this.props.app.SeqPatchInit();
        }

        onClickCopyPattern = () => {
            const seq = this.props.instrument.sequencerDevice;
            const txt = seq.SerializePattern();
            navigator.clipboard.writeText(txt).then(() => {
                alert('Pattern was copied to the clipboard.')
            }, () => {
                alert('Unable to copy.')
            });
        }
        onClickPastePattern = () => {
            if (this.props.observerMode) return;
            navigator.clipboard.readText().then(text => {
                const seq = this.props.instrument.sequencerDevice;
                const ops = seq.GetPatchOpsForPastePatternJSON(text);
                if (!ops) {
                    alert('There was some problem importing the pattern.')
                } else {
                    this.props.app.SeqPresetOp(ops);
                }
            });
        }
        onClickClearPattern = () => {
            if (this.props.observerMode) return;
            const seq = this.props.instrument.sequencerDevice;
            const ops = seq.GetPatternOpsForClearPattern();
            this.props.app.SeqPatternOps(ops);
        }

        onClickNotePreviewOn = (note, legend, e) => {
            if (!e.target.dataset.allowPreview) return;
            let vel = legend.find(l => l.midiNoteValue === note.midiNoteValue)?.velocitySet[0]?.vel;
            vel ??= 99;
            let midiNoteValue = this.props.instrument.sequencerDevice.livePatch.AdjustMidiNoteValue(note.midiNoteValue);
            if (midiNoteValue) {
                this.props.app.PreviewNoteOn(midiNoteValue, vel);
            }
        }

        onClickNotePreviewOff = (note) => {
            this.props.app.PreviewNoteOff();
        }

        onClickZoomOut = () => {
            if (this.state.zoom > 4)
                this.setState({zoom:this.state.zoom - 2});
        }

        onClickZoomIn = () => {
            if (this.state.zoom < 20)
                this.setState({zoom:this.state.zoom + 2});
        }

        onClickSavePreset = () => {
            const isReadOnly = this.props.observerMode;
            if (isReadOnly) return;
            const patch = this.props.instrument.sequencerDevice.livePatch;
            this.props.app.SeqPresetOp({
               op: "save",
               presetID: patch.presetID,
            });
        };

        onClickCueDiv = () => {
            const isReadOnly = this.props.observerMode;
            if (isReadOnly) return;

            this.props.app.SeqCue(this.props.instrument.instrumentID, this.props.instrument.sequencerDevice.IsCueued());
        }

        onClickBigCue = () => {
            this.onClickCueDiv();
        }

        onClickEditShiftUp = () => {
            const isReadOnly = this.props.observerMode;
            if (isReadOnly) return;
            const seq = this.props.instrument.sequencerDevice;
            const patch = seq.livePatch;
            const pattern = patch.GetSelectedPattern();
            const noteLegend = seq.GetNoteLegend();
            const timeSig = patch.timeSig;
            const newPattern = pattern.GetShiftedPatternVert(timeSig, -1, noteLegend);
            this.props.app.SeqPresetOp({
                op: "pastePattern",
                pattern: newPattern,
            });

        }

        onClickEditShiftDown = () => {
            const isReadOnly = this.props.observerMode;
            if (isReadOnly) return;
            const seq = this.props.instrument.sequencerDevice;
            const patch = seq.livePatch;
            const pattern = patch.GetSelectedPattern();
            const noteLegend = seq.GetNoteLegend();
            const timeSig = patch.timeSig;
            const newPattern = pattern.GetShiftedPatternVert(timeSig, 1, noteLegend);
            this.props.app.SeqPresetOp({
                op: "pastePattern",
                pattern: newPattern,
            });
        }

        onClickEditShiftLeft = () => {
            const isReadOnly = this.props.observerMode;
            if (isReadOnly) return;
            const seq = this.props.instrument.sequencerDevice;
            const patch = seq.livePatch;
            const pattern = patch.GetSelectedPattern();
            const noteLegend = seq.GetNoteLegend();
            const patternViewData = Seq.GetPatternView(patch, noteLegend);
            const timeSig = patch.timeSig;
            const newPattern = pattern.GetShiftedPatternHoriz(timeSig, -1, patternViewData);
            this.props.app.SeqPresetOp({
                op: "pastePattern",
                pattern: newPattern,
            });
        }

        onClickEditShiftRight = () => {
            const isReadOnly = this.props.observerMode;
            if (isReadOnly) return;
            const seq = this.props.instrument.sequencerDevice;
            const patch = seq.livePatch;
            const pattern = patch.GetSelectedPattern();
            const noteLegend = seq.GetNoteLegend();
            const patternViewData = Seq.GetPatternView(patch, noteLegend);
            const timeSig = patch.timeSig;
            const newPattern = pattern.GetShiftedPatternHoriz(timeSig, 1, patternViewData);
            this.props.app.SeqPresetOp({
                op: "pastePattern",
                pattern: newPattern,
            });
        }

        onClickEditExpand = () => {
            const isReadOnly = this.props.observerMode;
            if (isReadOnly) return;
            const pattern = this.props.instrument.sequencerDevice.livePatch.GetSelectedPattern();
            const timeSig = this.props.instrument.sequencerDevice.livePatch.timeSig;
            const newPattern = pattern.GetExpandedPattern(timeSig);
            this.props.app.SeqPresetOp({
                op: "pastePattern",
                pattern: newPattern,
            });
        }

        onClickEditContract = () => {
            const isReadOnly = this.props.observerMode;
            if (isReadOnly) return;
            const pattern = this.props.instrument.sequencerDevice.livePatch.GetSelectedPattern();
            const timeSig = this.props.instrument.sequencerDevice.livePatch.timeSig;
            const newPattern = pattern.GetContractedPattern(timeSig);
            this.props.app.SeqPresetOp({
                op: "pastePattern",
                pattern: newPattern,
            });
        }

        onClickEditDouble = () => {
            const isReadOnly = this.props.observerMode;
            if (isReadOnly) return;
            const pattern = this.props.instrument.sequencerDevice.livePatch.GetSelectedPattern();
            const timeSig = this.props.instrument.sequencerDevice.livePatch.timeSig;
            const newPattern = pattern.GetDoubledPattern(timeSig);
            this.props.app.SeqPresetOp({
                op: "pastePattern",
                pattern: newPattern,
            });
        }

        onClickEditHalf = () => {
            const isReadOnly = this.props.observerMode;
            if (isReadOnly) return;
            const pattern = this.props.instrument.sequencerDevice.livePatch.GetSelectedPattern();
            const timeSig = this.props.instrument.sequencerDevice.livePatch.timeSig;
            const newPattern = pattern.GetHalvedPattern(timeSig);
            this.props.app.SeqPresetOp({
                op: "pastePattern",
                pattern: newPattern,
            });
        }

        onClickEditMultiplyDuration = (factor) => {
            factor ??= 2;
            const isReadOnly = this.props.observerMode;
            if (isReadOnly) return;
            const seq = this.props.instrument.sequencerDevice;
            const patch = seq.livePatch;
            const noteLegend = seq.GetNoteLegend();
            const patternViewData = Seq.GetPatternView(patch, noteLegend);
            const newPattern = patternViewData.GetPatternWithDurationsMultiplied(factor);
            this.props.app.SeqPresetOp({
                op: "pastePattern",
                pattern: newPattern,
            });
        }

        onClickEditAddDiv = (n) => {
            n ??= 1;
            const isReadOnly = this.props.observerMode;
            if (isReadOnly) return;
            const seq = this.props.instrument.sequencerDevice;
            const patch = seq.livePatch;
            const noteLegend = seq.GetNoteLegend();
            const patternViewData = Seq.GetPatternView(patch, noteLegend);
            const newPattern = patternViewData.GetPatternWithDurationDivsAdded(n);
            this.props.app.SeqPresetOp({
                op: "pastePattern",
                pattern: newPattern,
            });
        }

        clickLengthHandlePrevious = (cell) => {
            const isReadOnly = this.props.observerMode;
            if (isReadOnly) return;
            const seq = this.props.instrument.sequencerDevice;
            const patch = seq.livePatch;
            const noteLegend = seq.GetNoteLegend();
            const patternViewData = Seq.GetPatternView(patch, noteLegend);
            const ops = patternViewData.GetPatternOpsForSetNoteLengthPrevious(cell);
            if (!ops) return;
            this.props.app.SeqPatternOps(ops);
        }

        clickLengthHandleCurrent = (cell) => {
            const isReadOnly = this.props.observerMode;
            if (isReadOnly) return;
            const seq = this.props.instrument.sequencerDevice;
            const patch = seq.livePatch;
            const noteLegend = seq.GetNoteLegend();
            const patternViewData = Seq.GetPatternView(patch, noteLegend);
            const ops = patternViewData.GetPatternOpsForSetNoteLengthCurrent(cell);
            if (!ops) return;
            this.props.app.SeqPatternOps(ops);
        }

      render() {
          if (!this.props.instrument.allowSequencer)
            return null;
        if (this.timer) {
            this.timer.SetInstrument(this.props.instrument);
        }

         const seq = this.props.instrument.sequencerDevice;
         const patch = seq.livePatch;
         const pattern = patch.GetSelectedPattern();
         const noteLegend = seq.GetNoteLegend();
         const patternViewData = Seq.GetPatternView(patch, noteLegend);

         const isReadOnly = this.props.observerMode;
         const clickableIfEditable = isReadOnly ? "" : " clickable";

         const bank = this.props.app.roomState.GetSeqPresetBankForInstrument(this.props.instrument);
         const bankRef = bank.GetPresetById(patch.presetID);
         const presetSaveEnabled = !!bankRef; // if this patch has been saved to the preset bank, it can be 1-click saved.

        const widthpx = Math.min(75, 20 + ((50 * this.state.zoom) / patternViewData.divs.length));
        const columnStyle = {width:`${widthpx}px`};
        const heightpx = 15 + 2.5 * this.state.zoom;
        const rowStyle = {height:`${heightpx}px`};

        const selectedTS = patch.timeSig;
         const timeSigList = this.state.showTimeSigDropdown && DFMusic.CommonTimeSignatures.map(ts => {
             return (
                 <li
                    key={ts.id}
                    onClick={() => this.onClickTimeSig(ts)}
                    className={selectedTS.id == ts.id ? " selected" : ""}
                    >{ts.toString()}</li>
             );
         });

         const speedObj = gSpeeds.GetClosestMatch(patch.speed, 0);
         const speedList = this.state.isSpeedExpanded && gSpeeds.sortedValues.map(s => {
            return (
               <li
                key={s.caption}
                onClick={() => this.onClickSpeed(s)}
                className={s.speed == speedObj.speed ? " selected" : ""}
                >{s.caption}</li>
           );
        });

        const divisionsVal = patch.GetDivisionType();
        const divisionsList = this.state.isDivExpanded && gDivisions.sortedValues.map(s => {
            return (
               <li
                key={s.val}
                onClick={() => this.onClickDivision(s.val)}
                className={divisionsVal == s.val ? " selected" : ""}
               >{s.caption}</li>
           );
        });

        const transposeVal = patch.GetTranspose();
        const transposeList = this.state.isTransposeExpanded && gTransposeValues.map((s,i) => {
            return (
               <li
                key={s}
                onClick={() => this.onClickTranspose(s)}
                className={transposeVal == s ? " selected" : ""}
                >{gTransposeCaptions[i]}</li>
           );
        });

        const keys = noteLegend.map(note => {
            const isMuted = patch.IsNoteMuted(note.midiNoteValue);
            return (
                <li key={note.midiNoteValue}
                    style={rowStyle}
                    title='Click to hear preview. Only you will hear it.'
                    className={"clickable " + note.cssClass}
                    onMouseDown={(e) => this.onClickNotePreviewOn(note, noteLegend, e)}
                    onMouseUp={(e) => this.onClickNotePreviewOff(note, e)}
                    onMouseLeave={(e) => this.onClickNotePreviewOff(note, e)}
                    data-allow-preview="1"
                    >
                    <div className='rowName' data-allow-preview="1">{note.name}</div>
                    <div
                        className={(isMuted ? 'muteRow muted ' : 'muteRow') + clickableIfEditable}
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
                cssClass += ' muted ';

            let lengthHandle = null;
            let noteOnHandle = null;
            let noteOffHandle = null;
            let cellClickHandler = ()=>this.onCellClick(patternViewData, divInfo, note, noteLegend, patch);
            if ((note.midiNoteValue in divInfo.rows)) {
                const cell = divInfo.rows[note.midiNoteValue];
                cssClass += " " + cell.cssClass;
                if (!cell.thisNote && cell.previousNote) {
                    lengthHandle = (<div
                        className='lengthHandle'
                        onClick={() => this.clickLengthHandlePrevious(cell)}
                        ></div>);
                }
                if (cell.thisNote && cell.beginBorderType === Seq.eBorderType.Continue && cell.endBorderType === Seq.eBorderType.Continue) {
                    lengthHandle = (<div
                        className='lengthHandle'
                        onClick={() => this.clickLengthHandleCurrent(cell)}
                        ></div>);
                }
                if (cell.beginBorderType === Seq.eBorderType.NoteOn) {
                    cssClass += " beginnoteon note";
                    noteOnHandle = (<div
                        className='noteOnHandle'
                        onClick={cellClickHandler}
                        ></div>);
                }
                else if (cell.beginBorderType === Seq.eBorderType.Continue) {
                    cssClass += " begincontinue note";
                }
                if (cell.endBorderType === Seq.eBorderType.Continue) {
                    cssClass += " endcontinue";
                }
                else if (cell.endBorderType === Seq.eBorderType.NoteOff) {
                    cssClass += " endnoteoff";
                    noteOffHandle = (<div
                        className='noteOffHandle'
                        onClick={cellClickHandler}
                        ></div>);
                }
            }

            return (
                <li key={divInfo.patternDivIndex + "_" + note.midiNoteValue} style={rowStyle} className={cssClass}>
                    <div className='noteBase'>
                    <div className='noteOL'>
                        <div className='muteOL'>
                            {noteOnHandle}
                            <div className='cellBody' onClick={cellClickHandler}>
                            </div>
                            {lengthHandle}
                            {noteOffHandle}
                        </div>
                    </div>
                    </div>
                </li>
            )
        });

        const pianoRoll = patternViewData.divs.map(divInfo => {

            const className = `${gDivisionInfo[patch.GetDivisionType()].cssClass} pianoRollColumn` +
                (divInfo.isMeasureBoundary ? " beginMeasure" : "") +
                (divInfo.isMajorBeatBoundary ? " majorBeat" : "") +
                (divInfo.isMinorBeatBoundary ? " minorBeat" : "");
            
            //const playheadClick = divInfo.isMeasureBoundary ? () => this.onClickCueDiv(divInfo.patternDivIndex) : () => {};
            
            return (
                <ul key={divInfo.patternDivIndex} style={columnStyle} id={GeneratePlayheadID(divInfo.patternDivIndex)} className={className}>
                    <li className={className + ' playhead'}>
                        {divInfo.patternDivIndex + 1}
                        {/* {divInfo.isMeasureBoundary && <div className='divControls'>click to cue this measure</div>} */}
                    </li>
                    {pianoRollColumn(divInfo)}
                </ul>
                );
        });

        return (
            <div className="sequencerFrame">
                <div className="sequencerMain">
                    <div className='overlay'>
                    <div className='powerButton'>
                        <button className='powerButton' title='Hide sequencer' onClick={this.onPowerButtonClick}><i className="material-icons">close</i></button>
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
                                            <button
                                                className={'cueButton' + (seq.IsCueued() ? ' active' : "") + clickableIfEditable}
                                                title="Begin playing this pattern on next measure"
                                                onClick={isReadOnly ? ()=>{} : this.onClickBigCue}
                                            >
                                                Cue
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
                            <div className='paramValue presetName clickable' onClick={() => { this.setState({isPresetsExpanded:!this.state.isPresetsExpanded});}}>{patch.presetName}</div>
                            { this.state.isPresetsExpanded &&
                                    <ClickAwayListener onClickAway={() => { this.setState({isPresetsExpanded:false});}}>
                                      <div className='dialog presetDialog'>
                                        <SequencerPresetDialog
                                            onClose={() => { this.setState({isPresetsExpanded:false});}}
                                            app={this.props.app}
                                            instrument={this.props.instrument}
                                            observerMode={this.props.observerMode}
                                            ></SequencerPresetDialog>
                                        </div>
                                    </ClickAwayListener>
                            }
                                <div className="buttonArray">
                                    {/* <button onClick={() => { this.setState({isPresetsExpanded:!this.state.isPresetsExpanded});}}>Presets</button> */}
                                    <button className={'altui' + (presetSaveEnabled && !isReadOnly ? ' clickable': " disabled")} onClick={()=>this.onClickSavePreset()}><i className="material-icons">save</i></button>
                                    <button title="Reset sequencer settings" className={'clearPattern initPreset' + clickableIfEditable} onClick={() => this.onClickInitPatch()}>INIT</button>
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
                                <button title="Copy pattern" className={'altui clickable'} onClick={() => this.onClickCopyPattern()}><i className="material-icons">content_copy</i></button>
                                <button title="Paste pattern" className={'altui' + clickableIfEditable} onClick={() => this.onClickPastePattern()}><i className="material-icons">content_paste</i></button>
                                </div>
                                <div className="buttonArray">
                                <button title="Clear pattern" className={'clearPattern' + clickableIfEditable} onClick={() => this.onClickClearPattern()}><i className="material-icons">playlist_remove</i></button>
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
                            <div className='legend'>Oct</div>
                            <div className='paramBlock'>
                            <div className='paramValue'>{patch.GetOctave()}</div>
                            <div className="buttonArray vertical">
                                <button className={clickableIfEditable} onClick={() => this.onClickOctaveAdj(1)}><i className="material-icons">arrow_drop_up</i></button>
                                <button className={clickableIfEditable} onClick={() => this.onClickOctaveAdj(-1)}><i className="material-icons">arrow_drop_down</i></button>
                            </div>
                            </div>
                        </div>


                        <div className='paramGroup'>
                            <div className='legend'>Transp</div>
                            <div className='paramBlock'>
                            <div className='paramValue clickable' onClick={() => { this.setState({isTransposeExpanded:!this.state.isTransposeExpanded});}}>
                                {patch.GetTranspose()}
                            </div>
                            { this.state.isTransposeExpanded &&
                                    <ClickAwayListener onClickAway={() => { this.setState({isTransposeExpanded:false});}}>
                                        <div className='dialog'>
                                            <legend onClick={() => { this.setState({isTransposeExpanded:false});}}>Select a transposition</legend>
                                            <ul className='dropDownMenu'>
                                                {transposeList}
                                            </ul>
                                        </div>
                                    </ClickAwayListener>
                            }

                            <div className="buttonArray vertical">
                                <button className={clickableIfEditable} onClick={() => this.onClickTransposeAdj(1)}><i className="material-icons">arrow_drop_up</i></button>
                                <button className={clickableIfEditable} onClick={() => this.onClickTransposeAdj(-1)}><i className="material-icons">arrow_drop_down</i></button>
                            </div>
                            </div>
                        </div>

                    </fieldset>





                    <fieldset>

                        <div className='paramGroup'>
                            <div className='legend'>Measures</div>
                            <div className='paramBlock'>
                            <div className='paramValue'>{patch.GetLengthMajorBeats() / patch.timeSig.majorBeatsPerMeasure}</div>
                                <div className="buttonArray vertical">
                                    <button className={clickableIfEditable} onClick={()=>this.onClickLength(1)}><i className="material-icons">arrow_drop_up</i></button>
                                    <button className={clickableIfEditable} onClick={()=>this.onClickLength(-1)}><i className="material-icons">arrow_drop_down</i></button>
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


                        <div className='paramGroup'>
                            <div className='paramBlock'>
                                { this.state.isEditExpanded &&
                                    <ClickAwayListener onClickAway={() => { this.setState({isEditExpanded:false});}}>
                                        <div className='dialog editPatternDialog'>
                                            <legend onClick={() => { this.setState({isEditExpanded:false});}}>
                                                Edit pattern
                                            </legend>
                                            <fieldset>
                                                <legend>Shift (wrapping)</legend>
                                                <div className='wasdContainer'>
                                                    <div className='row'>
                                                        <button className={clickableIfEditable}
                                                            onClick={this.onClickEditShiftUp}>
                                                                <i className="material-icons">arrow_drop_up</i></button>
                                                    </div>
                                                    <div className='row'>
                                                        <button className={clickableIfEditable}
                                                            onClick={this.onClickEditShiftLeft}>
                                                                <i className="material-icons">arrow_left</i></button>
                                                        <button className={clickableIfEditable}
                                                            onClick={this.onClickEditShiftRight}>
                                                                <i className="material-icons">arrow_right</i></button>
                                                    </div>
                                                    <div className='row'>
                                                        <button className={clickableIfEditable}
                                                            onClick={this.onClickEditShiftDown}>
                                                                <i className="material-icons">arrow_drop_down</i></button>
                                                    </div>
                                                </div>
                                            </fieldset>
                                            <fieldset>
                                                <legend>Rhythms</legend>
                                                <div className='description'>Keep # of notes while changing pattern length</div>
                                                <button className={pattern.CanExpand(selectedTS) && !isReadOnly ? " clickable" : " disabled"}
                                                    onClick={this.onClickEditExpand}>
                                                        Expand notes (×2) &gt;&gt;</button>
                                                <button className={pattern.CanContract(selectedTS) && !isReadOnly ? " clickable" : " disabled"}
                                                    onClick={this.onClickEditContract}>
                                                        Contract (×.5) &lt;&lt;</button>
                                            </fieldset>
                                            <fieldset>
                                                <legend>Pattern Length</legend>
                                                <div className='description'>Change pattern length, duplicating notes</div>
                                                <button className={pattern.CanDouble(selectedTS) && !isReadOnly ? " clickable" : " disabled"}
                                                    onClick={this.onClickEditDouble}>
                                                        Double length (×2) &gt;&gt;</button>
                                                <button className={pattern.CanHalf(selectedTS) && !isReadOnly ? " clickable" : " disabled"}
                                                    onClick={this.onClickEditHalf}>
                                                        Half length (×.5) &lt;&lt;</button>
                                            </fieldset>

                                            <fieldset>
                                                <legend>Note lengths</legend>
                                                <button className={clickableIfEditable}
                                                    onClick={() => this.onClickEditMultiplyDuration(2)}>
                                                        Double (×2) &gt;&gt;</button>
                                                <button className={clickableIfEditable}
                                                    onClick={() => this.onClickEditMultiplyDuration(.5)}>
                                                        Half (×.5) &lt;&lt;</button>
                                                <button className={clickableIfEditable}
                                                    onClick={() => this.onClickEditAddDiv(1)}>
                                                        Add 1 cell (+1) &lt;&lt;</button>
                                                <button className={clickableIfEditable}
                                                    onClick={() => this.onClickEditAddDiv(-1)}>
                                                        Remove 1 cell (-1) &lt;&lt;</button>
                                            </fieldset>

                                        </div>
                                    </ClickAwayListener>
                                }


                                <div className="buttonArray">
                                    <button
                                        className={"editButton " + clickableIfEditable}
                                        onClick={() => { this.setState({isEditExpanded:!this.state.isEditExpanded});}}
                                        >
                                            EDIT
                                            <i className="material-icons">edit</i>
                                        </button>
                                </div>
                            </div>
                        </div>



                    </fieldset>





                    <fieldset>

                        <div className='paramGroup'>
                            <div className='legend'>Zoom</div>
                            <div className='paramBlock'>
                            <div className='paramValue'>{this.state.zoom}</div>
                            <div className="buttonArray">
                                <button className='clickable' onClick={() => this.onClickZoomOut()}><i className="material-icons">zoom_out</i></button>
                                <button className='clickable' onClick={() => this.onClickZoomIn()}><i className="material-icons">zoom_in</i></button>
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
                                <li className='topIndicator'></li>
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

module.exports = {
    SequencerMain,
}

