const React = require('react');
const DFU = require('../../DFcommon/dfutil');
const DFMusic = require('../../DFcommon/DFMusic');
const ClickAwayListener = require ('./3rdparty/react-click-away-listener');
const DF = require('../../DFcommon/DFCommon');
const DFUtils = require("../util");
const SequencerPresetDialog = require("./SequencerPresetDialog");
const Seq = require('../../DFcommon/SequencerCore');
const { TapTempoButton } = require('./optionsDialog');
const { SequencerCell } = require('./SequencerCell');
const { SeqLegendKnob } = require('./knob');

const gMinTimerInterval = 35;


const gTempoBPMStep = 5;

// 𝅝𝅗𝅥𝅘𝅥𝅘𝅥𝅮𝅘𝅥𝅯→.
const gSpeeds = new DFUtils.FuzzySelector([
    { captionShort: "25%", captionLong: "25% (𝅘𝅥→𝅝)", speed: .25, cssClass:"altvalue" }, // quarter => whole
    { captionShort: "33%", captionLong: "33% (𝅘𝅥→𝅗𝅥.)", speed: 1.0/3.0, cssClass:"altvalue" }, // quarter => dotted half
    { captionShort: "50%", captionLong: "50% (𝅘𝅥→𝅗𝅥)", speed: .5, cssClass:"altvalue" }, // quarter => half
    { captionShort: "66%", captionLong: "66% (𝅘𝅥→𝅘𝅥.)", speed: 2.0/3.0, cssClass:"altvalue" }, // quarter => dotted quarter
    { captionShort: "75%", captionLong: "75% (𝅘𝅥→𝅗𝅥3)", speed: .75, cssClass:"altvalue" }, // quarter => triplet half
    { captionShort: "100%", captionLong: "100% (𝅘𝅥)", speed: 1, cssClass:"" },
    { captionShort: "133%", captionLong: "133% (𝅘𝅥→𝅘𝅥𝅮.)", speed: 4.0/3, cssClass:"altvalue" }, // quarter => dotted 8th
    { captionShort: "150%", captionLong: "150% (𝅘𝅥→𝅘𝅥3)", speed: 1.5, cssClass:"altvalue" }, // quarter => triplet quarter
    { captionShort: "200%", captionLong: "200% (𝅘𝅥→𝅘𝅥𝅮.)", speed: 2, cssClass:"altvalue" }, // quarter => 8th
    { captionShort: "300%", captionLong: "300% (𝅘𝅥→𝅘𝅥𝅮3)", speed: 3, cssClass:"altvalue" }, // quarter => triplet 8th
    { captionShort: "400%", captionLong: "400% (𝅘𝅥→𝅘𝅥𝅯)", speed: 4, cssClass:"altvalue" }, // quarter => 16th
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
    /*Seq.eDivisionType.MajorBeat*/MajorBeat: { caption: "Beat", cssClass:"div1"},
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

// plain list of numbers, evenly represented on the knob.
// value spec requires:
// - centerValue,
// - resetValue,
// - fineMouseSpeed,
// - mouseSpeed,
class ValueListValueSpec {
    constructor(list, centerValue, options) {
        Object.assign(this, options ?? {});
        this.mouseSpeed ??= 0.004;
        this.fineMouseSpeed ??= 0.0008;
        this.valueList = list;
        this.centerValue = this.resetValue = centerValue ?? 0;
        this.list = list;
    }
    value01ToValue = (v01) => {
        // 0-------------------1
        // |-0-|-1-|-2-|-3-|-4-| <-- 5 values in list
        // 0% 20% 40% 60% 80% 100% <-- sanity check that the values are equally represented.
        const ret = this.list[Math.floor(Math.min(this.list.length - 1, v01 * this.list.length))];
        return ret;
    }
    valueToValue01 = (v) => {
        const i = DFU.findNearestIndex(this.list, (e, i) => Math.abs(v - e));
        const ret = i / (this.list.length - 1);
        return ret;
    }
    value01ToString = (v01) => {
        return this.value01ToValue(v01).toString();
    }
};

// from -90 to 90, increments of 5.
const gStaccValueSpec = new ValueListValueSpec((() => {
    const ret = [];
    for (let i = -90; i <= 90; i += 5) {
        ret.push(i);
    }
    return ret;
})());


const gSwingValueSpec = new ValueListValueSpec([
    // -85,-75,-66,-58, -50,-42,-33,-20,-10,
    // 0,
    // 10, 20, 33, 42, 50, 58, 66, 75, 85

    66,55,44,33,22,11,0,
    -11,-22,-33,-44,-55,-66
].reverse());

// 20 to 33 is too big a gap.
// past 75 it's really not necessary.
// maybe between 0-66, and hit 33 along the way.

const gKnobFormatSpec = {
    fontSpec: (knob) => { return knob.isDragging ? "16px monospace" : null; },
    textColor: "#000",
    padding: 1,
    lineWidth: 10,
    valHighlightWidth: 10,
    offsetY: 2,
    trackColor: "#777",
    fgColor: (knob) => { return knob.value < 0 ? "#fa4" : "#fa4"; },
    valHighlightColor: (knob) => { return knob.value === knob.valueSpec.centerValue ? "#0cc" : "#0aa"; },
    radius: 15,
    valHighlightRadius: 15,
    valueRangeRadians: .75 * 2 * Math.PI,
    valueOffsetRadians: Math.PI * 1.5,
    valHighlightRangeRad: 0,
    valHighlightLineCap: 'round', // butt round
};






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
        const playheadAbsQuarter = this.app.getAbsoluteBeatFloat();
        const playhead = seq.GetAbsQuarterInfo(playheadAbsQuarter);
        const bpm = this.app.roomState.bpm;

        //const playheadPatternQuarter = playheadPatternFrac * patternLengthQuarters;

        const currentDiv = patternViewData.divs.find(divInfo => {
            // find the first one where end > this
            return divInfo.IncludesPatternFracWithSwing(playhead.patternQuarter);
        });

        // calc divlength MS
        const divRemainingQuarters = currentDiv.swingEndPatternQuarter - playhead.patternQuarter;//divRemainingPatterns * patternLengthQuarters;
        let delayMS = DFU.BeatsToMS(divRemainingQuarters, bpm) / patch.speed;

        let destDivIndex = currentDiv.patternDivIndex + 1;
        let destDiv = patternViewData.divs[destDivIndex % patternViewData.divs.length];
        console.assert((destDivIndex % patternViewData.divs.length) === destDiv.patternDivIndex);
        while (delayMS < gMinTimerInterval) {
            const divLenQuarters = destDiv.swingEndPatternQuarter - destDiv.swingBeginPatternQuarter;
            const divLenMS = DFU.BeatsToMS(divLenQuarters, bpm);
            delayMS += divLenMS / patch.speed;
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
            const id = GenerateRoomBeatID(mbi.minorBeatOfMeasure);
            if (isComplete) {
                document.getElementById(id).classList.add("complete");
            } else {
                document.getElementById(id).classList.remove("complete");
            }
        });

        nextDivInfo.patternViewData.divs.forEach(div => {
            const isPlaying = div.patternDivIndex === thisDiv.patternDivIndex;
            const id = GeneratePlayheadID(div.patternDivIndex);
            if (isPlaying) {
                document.getElementById(id).classList.add("playing");
            } else {
                document.getElementById(id).classList.remove("playing");
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
         this.staccSliderID = "seqStaccSlider";

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

        DFUtils.stylizeRangeInput(this.staccSliderID, {
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
        // https://github.com/thenfour/digifujam/issues/249
        // don't allow metronome for non-performers, for UI simplicity
        if (!this.props.app.roomState.UserCanPerform(this.props.app.myUser)) {
            this.props.app.metronome.isMuted = true;
        } else {
            this.props.app.metronome.isMuted = !this.props.app.metronome.isMuted;
        }
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

        onChangeSwing = (value, isUserAction) => {
            if (this.props.observerMode) return;
            if (!isUserAction) return; // changes not incurred by user actions don't send.
            //let v = gSwingSnapValues.GetClosestMatch(e.target.value, 0);
            let v = value / 100;
            this.props.app.SeqSetSwing(v);
        }


        onDoubleClickStaccSlider = (e) => {
            if (this.props.observerMode) return;
            this.props.app.SeqSetStacc(0);
            $("#" + this.staccSliderID).val(0);
            $("#" + this.staccSliderID).trigger("change");
        }

        onChangeStacc = (val, isUserAction) => {
            if (this.props.observerMode) return;
            if (!isUserAction) return; // changes not incurred by user actions don't send.
            //let v = gStaccSnapValues.GetClosestMatch(val, 0);
            val /= 100;
            this.props.app.SeqSetStacc(val);
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
                if (this.state.baseNoteListening) {
                    // you're listening for a base note and you click on the legend. that works!
                    this.BaseNoteNoteOnListener({note: midiNoteValue});
                    return;
                }
    
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


        onClickSwingBasisQuarters = (n) => {
            if (this.props.observerMode) return;
            this.props.app.SeqPresetOp({
                op: "SeqSetSwingBasisQuarters",// { op:"SeqSetSwingBasisQuarters", swingBasisQuarters: } // .25 or .5
                swingBasisQuarters: n,
            });
        }

        BaseNoteNoteOnListener = (e) => {
            this.props.app.midi.events.removeListener("noteOn", this.BaseNoteNoteOnListener);

            this.props.app.SeqPresetOp({
                op: "SeqSetBaseNote",
                note: e.note,
            });

            window.DFKeyTracker.events.removeListener("keydown", this.onKeyDownWhileBaseNoteListening);
            this.setState({ baseNoteListening: false });
        }

        onKeyDownWhileBaseNoteListening = (e) => {
            if (e.key === 'Escape') {
                window.DFKeyTracker.events.removeListener("keydown", this.onKeyDownWhileBaseNoteListening);
                this.setState({ baseNoteListening: false });
            }
        }

        onClickBaseNote = (e) => {
            if (this.props.observerMode) return;

            if (e.shiftKey) {
                const seq = this.props.instrument.sequencerDevice;
                const patch = seq.livePatch;
                const noteLegend = seq.GetNoteLegend();
                const patternViewData = Seq.GetPatternView(patch, noteLegend);
                if (!patternViewData.divsWithNoteOn.length) {
                    return; // no notes on in the pattern.
                }
                // find the lowest note on in the 1st div with note on.
                let note = 1e5;
                patternViewData.divsWithNoteOn[0].noteOns.forEach(cell => {
                    note = Math.min(note, cell.midiNoteValue);
                });

                this.props.app.SeqPresetOp({
                    op: "SeqSetBaseNote",
                    note,
                });
    
                return;
            }

            if (this.state.baseNoteListening) {
                window.DFKeyTracker.events.removeListener("keydown", this.onKeyDownWhileBaseNoteListening);
                this.setState({ baseNoteListening: false });
                return;
            }
            this.props.app.midi.events.addListener("noteOn", this.BaseNoteNoteOnListener);
            window.DFKeyTracker.events.on("keydown", this.onKeyDownWhileBaseNoteListening);
            this.setState({ baseNoteListening: true });
        }

        onClickArpMapping(mapping) {
            if (this.props.observerMode) return;
            this.props.app.SeqPresetOp({
                op: "SeqSetArpMapping",
                mapping,
            });
            this.setState({isArpMappingExpanded:false});
        }

        onClickListeningToInstrument(e) {
            if (this.props.observerMode) return;

            if (e.ctrlKey) {
                this.props.app.net.SeqSetListeningInstrumentID({
                    seqInstrumentID: this.props.instrument.instrumentID,
                    instrumentID: this.props.instrument.instrumentID,
                });
                return;
            }

            this.setState({showListenToInstrumentDropdown:true});
        }

        onClickListenToInstrument(inst) {
            if (this.props.observerMode) return;
            this.props.app.net.SeqSetListeningInstrumentID({
                seqInstrumentID: this.props.instrument.instrumentID,
                instrumentID: inst.instrumentID,
            });
            this.setState({showListenToInstrumentDropdown:false});
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
         const bankRef = bank.GetCompactPresetById(patch.presetID);
         const presetSaveEnabled = !!bankRef; // if this patch has been saved to the preset bank, it can be 1-click saved.

        const widthpx = Math.min(75, 20 + ((50 * this.state.zoom) / patternViewData.divs.length));
        const columnStyle = {width:`${widthpx}px`};
        const heightpx = 14 + 2.25 * this.state.zoom;
        const rowStyle = {height:`${heightpx}px`};

        const selectedTS = patch.timeSig;

        const context = {
            app: this.props.app,
            instrument: this.props.instrument,
            seq,
            patch,
            pattern,
            noteLegend,
            patternViewData,
            isReadOnly,
            widthpx,
            heightpx,
            rowStyle,
            timeSig: selectedTS,
        };

        const listenToInstrumentList = this.state.showListenToInstrumentDropdown &&
            this.props.app.roomState.instrumentCloset
                .filter(inst => inst.wantsMIDIInput)
                .map((inst, i) => {
                    const inUse = inst.IsInUse();
                    //const isYours = (i.controlledByUserID == app.myUser.userID);
                    let ownedBy = null;
                    if (inUse) {
                        let foundUser = this.props.app.roomState.FindUserByID(inst.controlledByUserID);
                        if (foundUser) {
                            ownedBy = (<span className="takenBy">(<span style={{ color: foundUser.user.color }}>{foundUser.user.name}</span>)</span>);
                        }
                    }
            
                    return (
                        <li
                            key={i}
                            onClick={() => this.onClickListenToInstrument(inst)}
                            className={(seq.listeningToInstrumentID === inst.instrumentID ? " selected" : "") + (inst.instrumentID === this.props.instrument.instrumentID ? " default" : "")}
                        >
                            <span className='instrumentName' style={{ color: i.color }}>{inst.getDisplayName()}</span>{ownedBy}
                        </li>);
                });

         const timeSigList = this.state.showTimeSigDropdown && DFMusic.CommonTimeSignatures.map(ts => {
             return (
                 <li
                    key={ts.id}
                    onClick={() => this.onClickTimeSig(ts)}
                    className={selectedTS.id == ts.id ? " selected" : ""}
                    >{ts.toString()}</li>
             );
         });

         const arpMappingList = this.state.isArpMappingExpanded && Seq.SequencerArpMapping.map(m => {
             return (
                 <li
                    key={m.id}
                    onClick={() => this.onClickArpMapping(m.id)}
                    className={seq.GetArpMapping().id === m.id ? " selected" : ""}
                >
                    <div className='caption'>{m.betterCaption}</div>
                    <div className='description'>{m.description}</div>
                </li>
             );
         });

         const speedObj = gSpeeds.GetClosestMatch(patch.speed, 0);
         const speedList = this.state.isSpeedExpanded && gSpeeds.sortedValues.map(s => {
            return (
               <li
                key={s.speed}
                onClick={() => this.onClickSpeed(s)}
                className={(s.speed == speedObj.speed ? " selected" : "") + " " + speedObj.cssClass}
                >{s.captionLong}</li>
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

        const pianoRollColumn = (divInfo) => noteLegend.map(note => (
            <SequencerCell
                key={`${divInfo.patternDivIndex}_${note.midiNoteValue}`}
                context={context}
                div={divInfo}
                note={note}
                />));

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

                                    </div>
                                </div>
                            </fieldset>
                        </div>
                    </div>
                    <div className='seqTopColumn'>
                    <div className="seqTopRow">







                    <fieldset>
                            <div className='paramGroup'>
                                <div className='legend'>BPM</div>
                                <div className='paramBlock'>
                                <div className='paramValue'>
                                    {this.props.app.roomState.bpm}
                                </div>
                                <div className='buttonArray vertical'>
                                    <button onClick={this.onClickHigherTempo} className={clickableIfEditable}><i className="material-icons">arrow_drop_up</i></button>
                                    <button onClick={this.onClickLowerTempo} className={clickableIfEditable}><i className="material-icons">arrow_drop_down</i></button>
                                </div>
                                <div className='buttonArray'>
                                    <TapTempoButton className="tapTempo" app={this.props.app} tapTempStyle="seq"/>

                                    <button title="Metronome" className={"clickable metronome" + (this.props.app.metronome.isMuted ? '' : ' active')} onClick={this.onClickToggleMetronome}>
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
                                    <button
                                        title="Save this preset (overwrite existing)"
                                        className={'altui' + (presetSaveEnabled && !isReadOnly ? ' clickable': " disabled")}
                                        onClick={()=>this.onClickSavePreset()}><i className="material-icons">save</i></button>
                                    <button title="Start with a new blank patch" className={'clearPattern initPreset' + clickableIfEditable} onClick={() => this.onClickInitPatch()}>INIT</button>
                                </div>
                            </div>
                        </div>
                        </fieldset>



                        <fieldset className='seqMode'>
                            <div className='paramGroup'>

                                {/* arpMapping */}
                                <div className='legend arpMapping'>Mode</div>
                                <div className='paramBlock arpMapping'>
                                    <div
                                        className={'paramValue ' + clickableIfEditable + (this.state.isArpMappingExpanded ? " active" : "")}
                                        onClick={isReadOnly ? ()=>{} : () => this.setState({isArpMappingExpanded:true})}
                                        >
                                        {seq.GetArpMapping().caption}
                                    </div>
                                    {this.state.isArpMappingExpanded && (
                                        <ClickAwayListener onClickAway={() => { this.setState({isArpMappingExpanded:false});}}>
                                        <div className='dialog'>
                                            <legend onClick={() => { this.setState({isArpMappingExpanded:false});}}>Select method of mapping notes, based on sequencer pattern and notes you are physically holding.</legend>
                                            <ul className='dropDownMenu'>
                                                {arpMappingList}
                                            </ul>
                                        </div>
                                        </ClickAwayListener>
                                        )
                                    }
                                </div>


                                {/* base note */}
                                <div className={'legend baseNote' + (seq.GetArpMapping().useBaseNote ? " enabled" : " disabled")}>@</div>
                                <div className='paramBlock baseNote'>
                                    <div
                                        className={'paramValue ' + clickableIfEditable + (this.state.baseNoteListening ? " active" : "") + (seq.GetArpMapping().useBaseNote ? " enabled" : " disabled")}
                                        onClick={seq.GetArpMapping().useBaseNote ? (e)=> this.onClickBaseNote(e) : ()=> {}}
                                        title={
                                            seq.GetArpMapping().useBaseNote ?
                                            (this.state.baseNoteListening ?
                                            `Play a note to set the base note. ESC or click here to cancel.`
                                            : `Click to set a new base note. Shift+Click to use the first note of the pattern as the base note.`)
                                            : `Base note (not used for ${seq.GetArpMapping().caption})`
                                        }
                                        >
                                        {DFMusic.GetMidiNoteInfo(seq.GetBaseNote()).name}
                                    </div>
                                </div>


                                {/* listening instrument */}
                                {seq.GetArpMapping().swallowNotes &&
                                <div
                                    className={'legend listeningToInstrument '+ clickableIfEditable + (seq.GetArpMapping().swallowNotes ? " enabled" : " disabled")}
                                    onClick={isReadOnly ? ()=>{} : (e) => this.onClickListeningToInstrument(e)}
                                    title="Arpeggiator input notes can be configured to listen to other instruments. Click to select an instrument. CTRL+Click to reset."
                                    >
                                        <div className="scButton">SC</div>
                                    </div>
                                }
                                {seq.GetArpMapping().swallowNotes && (this.state.showListenToInstrumentDropdown || (this.props.instrument.instrumentID !== seq.listeningToInstrumentID)) &&
                                <div className='paramBlock listeningToInstrument'>
                                    <div
                                        className={'paramValue ' + clickableIfEditable + (this.state.showListenToInstrumentDropdown ? " active" : "") + (this.props.instrument.instrumentID === seq.listeningToInstrumentID ? " default" : " notdefault")}
                                        onClick={isReadOnly ? ()=>{} : (e) => this.onClickListeningToInstrument(e)}
                                        title="Arpeggiator input notes can be configured to listen to other instruments. Click to select an instrument. CTRL+Click to reset."
                                        >
                                        {this.props.app.roomState.FindInstrumentById(seq.listeningToInstrumentID).instrument.GetShortDisplayName()}
                                    </div>
                                    {this.state.showListenToInstrumentDropdown && (
                                        <ClickAwayListener onClickAway={() => { this.setState({showListenToInstrumentDropdown:false});}}>
                                        <div className='dialog'>
                                            <legend onClick={() => { this.setState({showListenToInstrumentDropdown:false});}}>Select at instrument to use as input for arpeggiation.</legend>
                                            <ul className='dropDownMenu'>
                                                {listenToInstrumentList}
                                            </ul>
                                        </div>
                                        </ClickAwayListener>
                                        )
                                    }
                                </div>
                                }


                            </div>{/* paramGroup */}
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

                    </fieldset>
                    <fieldset>

                        <div className='paramGroup'>
                            <div className='legend'>Len</div>
                            <div className='paramBlock'>
                            <div className='paramValue'>{patch.GetLengthMajorBeats() / patch.timeSig.majorBeatsPerMeasure}</div>
                                <div className="buttonArray vertical">
                                    <button className={clickableIfEditable} onClick={()=>this.onClickLength(1)}><i className="material-icons">arrow_drop_up</i></button>
                                    <button className={clickableIfEditable} onClick={()=>this.onClickLength(-1)}><i className="material-icons">arrow_drop_down</i></button>
                                </div>
                            </div>
                        </div>

                        <div className='paramGroup'>
                            <div className='legend'>Speed</div>
                            <div className='paramBlock'>
                            <div className={'paramValue clickable ' + speedObj.cssClass} onClick={() => { this.setState({isSpeedExpanded:!this.state.isSpeedExpanded});}}>{speedObj.captionShort}</div>
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




                        </fieldset>
                    <fieldset>

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


                        <SeqLegendKnob
                            caption="Swing"
                            className="knob"
                            initialValue={patch.swing * 100}
                            valueSpec={gSwingValueSpec}
                            formatSpec={gKnobFormatSpec}
                            onChange={this.onChangeSwing}
                            >
                                <div className="buttonArray">
                                    <button title="Swing 8th notes" className={"unicodeNote " + clickableIfEditable + ((patch.GetSwingBasisQuarters() === .5) ? " active" : "")} onClick={() =>{this.onClickSwingBasisQuarters(.5)}}>𝅘𝅥𝅮</button>
                                    <button title="Swing 16th notes" className={"unicodeNote " + clickableIfEditable + ((patch.GetSwingBasisQuarters() === .25) ? " active" : "")} onClick={() =>{this.onClickSwingBasisQuarters(.25)}}>𝅘𝅥𝅯</button>
                                </div>

                            </SeqLegendKnob>



                        <SeqLegendKnob
                                    caption="Stacc"
                                    className="knob"
                                    initialValue={patch.noteLenAdjustDivs * 100}
                                    valueSpec={gStaccValueSpec}
                                    formatSpec={gKnobFormatSpec}
                                    onChange={this.onChangeStacc}
                                    >
                                    </SeqLegendKnob>

                    </fieldset>



                    <fieldset>

                        <div className='paramGroup'>
                            <div className='legend'>Oct</div>
                            <div className='paramBlock'>
                            <div className={'paramValue ' + (patch.GetOctave() === 0 ? "" : "altvalue") }>{patch.GetOctave()}</div>
                            <div className="buttonArray vertical">
                                <button className={clickableIfEditable} onClick={() => this.onClickOctaveAdj(1)}><i className="material-icons">arrow_drop_up</i></button>
                                <button className={clickableIfEditable} onClick={() => this.onClickOctaveAdj(-1)}><i className="material-icons">arrow_drop_down</i></button>
                            </div>
                            </div>
                        </div>


                        <div className='paramGroup'>
                            <div className='legend'>Transp</div>
                            <div className='paramBlock'>
                            <div className={'paramValue clickable ' + (patch.GetTranspose() === 0 ? "" : "altvalue")} onClick={() => { this.setState({isTransposeExpanded:!this.state.isTransposeExpanded});}}>
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





                    <fieldset className='editButtonFieldset'>

                    <div className='paramGroup' title="Edit menu">
                    <div className="buttonArray">
                                    <button
                                        className={"editButton " + clickableIfEditable}
                                        onClick={() => { this.setState({isEditExpanded:!this.state.isEditExpanded});}}
                                        >
                                            <i className="material-icons">edit</i>
                                            <i className="material-icons">{this.state.isEditExpanded ? "arrow_drop_down" : "arrow_right"}</i>
                                            {/* <i className="material-icons">edit</i> */}
                                    </button>
                    </div>
                    </div>

                    </fieldset>




                    <fieldset>

                        <div className='paramGroup' title="Zoom">
                            {/* <div className='legend'>Zoom</div> */}
                            <div className='paramBlock'>
                            <div className="buttonArray">
                                <button className='clickable' onClick={() => this.onClickZoomOut()}><i className="material-icons">zoom_out</i></button>
                                <button className='clickable' onClick={() => this.onClickZoomIn()}><i className="material-icons">zoom_in</i></button>
                            </div>
                            <div className='paramValue'>{this.state.zoom}</div>
                            </div>
                        </div>




                    </fieldset>


                    <fieldset>
                        <div className='paramGroup'>
                            <RoomBeat app={this.props.app} timeSig={patch.timeSig}></RoomBeat>
                        </div>
                    </fieldset>



                    </div>{/* seqTopRow */}

                    {this.state.isEditExpanded && (

                    <div className="seqTopRow editRow">

                        <fieldset>
                            <div className='legend left'>Move<br />Notes</div>
                            <div className='vertbuttons'>
                                <button className={clickableIfEditable}
                                    onClick={this.onClickEditShiftUp}>
                                        <i className="material-icons">arrow_drop_up</i></button>
                                <button className={clickableIfEditable}
                                    onClick={this.onClickEditShiftDown}>
                                        <i className="material-icons">arrow_drop_down</i></button>
                            </div>
                            <div className='horizbuttons'>
                                <button className={clickableIfEditable}
                                    onClick={this.onClickEditShiftLeft}>
                                        <i className="material-icons">arrow_left</i></button>
                                <button className={clickableIfEditable}
                                    onClick={this.onClickEditShiftRight}>
                                        <i className="material-icons">arrow_right</i></button>
                            </div>
                        </fieldset>
                        <fieldset>
                            <div className='legend left'>Contract<br />Pattern</div>
                            {/* <div className='description'>Keep # of notes while changing pattern length</div> */}
                            <div className='horizbuttons'>
                            <button className={pattern.CanContract(selectedTS) && !isReadOnly ? " clickable" : " disabled"}
                                onClick={this.onClickEditContract}>
                                    <i className="material-icons">arrow_left</i></button>
                            <button className={pattern.CanExpand(selectedTS) && !isReadOnly ? " clickable" : " disabled"}
                                onClick={this.onClickEditExpand}>
                                    <i className="material-icons">arrow_right</i>
                                    </button>
                            </div>
                            <div className='legend'>Stretch<br />Pattern</div>
                        </fieldset>
                        <fieldset>
                            <div className='legend left'>Chop<br />Pattern</div>
                            <div className='horizbuttons'>
                            <button className={pattern.CanHalf(selectedTS) && !isReadOnly ? " clickable" : " disabled"}
                                onClick={this.onClickEditHalf}>
                                    <i className="material-icons">arrow_left</i>
                                    </button>
                            <button className={pattern.CanDouble(selectedTS) && !isReadOnly ? " clickable" : " disabled"}
                                onClick={this.onClickEditDouble}>
                                    <i className="material-icons">arrow_right</i>
                                    </button>
                            </div>
                            <div className='legend'>Double<br />Pattern</div>
                        </fieldset>

                        <fieldset>
                            <div className='legend left'><span className='noteglyph'>&#9833;</span>×.5</div>
                            <div className='horizbuttons'>
                            <button className={clickableIfEditable}
                                onClick={() => this.onClickEditMultiplyDuration(.5)}>
                                    <i className="material-icons">arrow_left</i>
                                    </button>
                            <button className={clickableIfEditable}
                                onClick={() => this.onClickEditMultiplyDuration(2)}>
                                    <i className="material-icons">arrow_right</i>
                                    </button>
                            </div>
                            <div className='legend'>×2</div>
                        </fieldset>

                        <fieldset>
                            <div className='legend left'><span className='noteglyph'>&#9833;</span>-1</div>

                            <div className='horizbuttons'>
                            <button className={clickableIfEditable}
                                onClick={() => this.onClickEditAddDiv(-1)}>
                                    <i className="material-icons">arrow_left</i></button>
                            <button className={clickableIfEditable}
                                onClick={() => this.onClickEditAddDiv(1)}>
                                    <i className="material-icons">arrow_right</i></button>
                            </div>
                            <div className='legend'>+1</div>
                        </fieldset>


                        <fieldset className='editCloseFieldset'>
                            <button className={"editCloseButton" + clickableIfEditable}
                                        onClick={() => { this.setState({isEditExpanded:false});}}>
                                        <i className="material-icons">close</i></button>
                        </fieldset>


                        
                    </div>
                    ) }



                    </div> {/* topcolumn */}
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

