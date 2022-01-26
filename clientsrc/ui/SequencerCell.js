const React = require('react');
const DFU = require('../dfutil');
const DFMusic = require("../DFMusic");
const ClickAwayListener = require ('./3rdparty/react-click-away-listener');
const DF = require("../DFCommon");
const DFUtils = require("../util");
const SequencerPresetDialog = require("./SequencerPresetDialog");
const Seq = require('../SequencerCore');

// using drag / drop API is extremely slow. profiling shows that it's a lot of react plumbing getting in the way.
// basically a continuous stream of DragLeave events which take 20-30ms each.


function GetIDForCell(patternDivIndex, midiNoteValue) {
  return `seqcell_${patternDivIndex}_${midiNoteValue}`;
}

function GetSelectorForCell(patternDivIndex, midiNoteValue) {
  return document.getElementById(GetIDForCell(patternDivIndex, midiNoteValue));
}


/////////////////////////////////////////////////////////////////////////////////////////////////////////
class SequencerCell extends React.Component {
  constructor(props) {
     super(props);
     this.state = {};
  }


  isDragTarget(patternView, patternDivIndex, midiNoteValue) {
    if (!this.dragData) return false;
    if (this.dragData.dest.midiNoteValue !== midiNoteValue) return false;
    if (DFU.IsInPeriodicSegment(patternDivIndex, patternView.divs.length, this.dragData.dest.patternDivIndex, this.dragData.dest.patternDivLength)) {
      //console.log(`++ isDragTarget: ${patternDivIndex},${patternView.divs.length},${this.dragData.dest.patternDivIndex},${this.dragData.dest.patternDivLength}`);
      return true;
    }
    return false;
  }
  
  UpdateDragTargetStyles(patternView) {
    if (!this.dragData) {
        return;
    }
    const newStyledElements = [];
  
    this.dragData.styledElements.forEach(el => {
        if (this.isDragTarget(patternView, el.patternDivIndex, el.midiNoteValue)) {
            newStyledElements.push(el);
            // keep existing styling
        } else {
          //console.log(`removing styled element ${el.midiNoteValue}, ${el.patternDivIndex}`);
          const cell = GetSelectorForCell(el.patternDivIndex, el.midiNoteValue);
          cell.classList.remove('dragTarget');
          cell.classList.remove('dragTargetbeginnoteon');
          cell.classList.remove('dragTargetbegincontinue');
          cell.classList.remove('dragTargetendnoteoff');
          cell.classList.remove('dragTargetendcontinue');
          cell.classList.remove('dragSrc');
          cell.classList.remove('dragSrcbeginnoteon');
          cell.classList.remove('dragSrcbegincontinue');
          cell.classList.remove('dragSrcendnoteoff');
          cell.classList.remove('dragSrcendcontinue');
        }
    });
  
    patternView.divs.forEach(div => {

      // do DEST cells
        if (DFU.IsInPeriodicSegment(div.patternDivIndex, patternView.divs.length, this.dragData.dest.patternDivIndex, this.dragData.dest.patternDivLength)) {
          const cell = GetSelectorForCell(div.patternDivIndex, this.dragData.dest.midiNoteValue);
          const endDiv = (this.dragData.dest.patternDivIndex + this.dragData.dest.patternDivLength - 1) % this.props.context.patternViewData.divs.length;
          cell.classList.add('dragTarget');
          if (div.patternDivIndex === this.dragData.dest.patternDivIndex) {
            cell.classList.add('dragTargetbeginnoteon');
            cell.classList.remove('dragTargetbegincontinue');
            //console.log(`dragTargetbeginnoteon [${div.patternDivIndex} == ${this.dragData.dest.patternDivIndex}]`);
          } else {
            cell.classList.remove('dragTargetbeginnoteon');
            cell.classList.add('dragTargetbegincontinue');
            //console.log(`dragbegincontinue [${div.patternDivIndex} != ${this.dragData.dest.patternDivIndex}]`);
          }

          if (div.patternDivIndex === endDiv) {
            cell.classList.add('dragTargetendnoteoff');
            cell.classList.remove('dragTargetendcontinue');
            //console.log(`dragendnoteon [${div.patternDivIndex} == ${endDiv}]`);
          } else {
            cell.classList.add('dragTargetendcontinue');
            cell.classList.remove('dragTargetendnoteoff');
            //console.log(`dragendcontinue [${div.patternDivIndex} != ${endDiv}]`);
          }

          newStyledElements.push({
              patternDivIndex: div.patternDivIndex|0,
              midiNoteValue: this.dragData.dest.midiNoteValue|0,
          });
        }

        // do SOURCE cells
        if (DFU.IsInPeriodicSegment(div.patternDivIndex, patternView.divs.length, this.dragData.source.notePatternDivIndex, this.dragData.source.notePatternDivLength)) {
          const cell = GetSelectorForCell(div.patternDivIndex, this.dragData.source.midiNoteValue);
          const endDiv = (this.dragData.source.notePatternDivIndex + this.dragData.source.notePatternDivLength - 1) % this.props.context.patternViewData.divs.length;
          cell.classList.add('dragSrc');
          if (div.patternDivIndex === this.dragData.source.notePatternDivIndex) {
            cell.classList.add('dragSrcbeginnoteon');
            cell.classList.remove('dragSrcbegincontinue');
          } else {
            cell.classList.remove('dragSrcbeginnoteon');
            cell.classList.add('dragSrcbegincontinue');
          }

          if (div.patternDivIndex === endDiv) {
            cell.classList.add('dragSrcendnoteoff');
            cell.classList.remove('dragSrcendcontinue');
          } else {
            cell.classList.add('dragSrcendcontinue');
            cell.classList.remove('dragSrcendnoteoff');
          }

          newStyledElements.push({
              patternDivIndex: div.patternDivIndex|0,
              midiNoteValue: this.dragData.source.midiNoteValue|0,
          });
        }
    });
  
    this.dragData.styledElements = newStyledElements;
  }
  

  ClearDragTargetStyles() {
    if (!this.dragData) {
        return;
    }
  
    this.dragData.styledElements.forEach(el => {
      //GetSelectorForCell(el.patternDivIndex, el.midiNoteValue).removeClass('dragTarget');
      const cell = GetSelectorForCell(el.patternDivIndex, el.midiNoteValue);
      cell.classList.remove('dragTarget');
      cell.classList.remove('dragTargetbeginnoteon');
      cell.classList.remove('dragTargetbegincontinue');
      cell.classList.remove('dragTargetendnoteoff');
      cell.classList.remove('dragTargetendcontinue');
      cell.classList.remove('dragSrc');
      cell.classList.remove('dragSrcbeginnoteon');
      cell.classList.remove('dragSrcbegincontinue');
      cell.classList.remove('dragSrcendnoteoff');
      cell.classList.remove('dragSrcendcontinue');
    });
  
    this.dragData.styledElements = [];
  }
  
  

  onCellClick = (e, _, divInfo, note, __, patch, setLengthProc) => {
    if (this.props.context.isReadOnly) return;
    // toggle a 1-div-length 
    // convert this click to an ops struct
    let ops = null;
    let playingNotes = this.props.context.app.GetMyCurrentlyPlayingNotes();

    playingNotes = playingNotes.map(n => patch.PhysicalToPatternMidiNoteValue(n));

    if (!this.dragData) return; // dragging something we are not tracking... bail.

    const seq = this.props.context.instrument.sequencerDevice;
    const legend = seq.GetNoteLegend();
    const patternView = Seq.GetPatternView(seq.livePatch, legend);

    // sanitize playing notes. if you're playing notes which are out of range, then drop them.
    // we could be "smart" and basically if you try to play out of range, then attempt to bring them into frame using octave transp
    // but there are a lot of considerations so i'm going to avoid this.
    if (playingNotes.length) {
        playingNotes = playingNotes.filter(n => {
            return legend.some(l => l.midiNoteValue === n);
        });
    } else {
        playingNotes = [note.midiNoteValue];
    }
    if (e.shiftKey) {
        if (e.ctrlKey) {
            ops = patternView.GetPatternOpsForCellToggle(divInfo, note, playingNotes, 1); // CTRL+SHIFT = toggle vel1
        } else {
            return setLengthProc(); // SHIFT = set length
        }
    } else {
      if (e.ctrlKey) {
            ops = patternView.GetPatternOpsForCellRemove(divInfo, note, playingNotes); // CTRL = delete
            //ops = patternView.GetPatternOpsForCellToggle(divInfo, note, 0); // CTRL = toggle vel0
        } else {
            ops = patternView.GetPatternOpsForCellCycle(divInfo, note, playingNotes); // none = cycle
        }
    }

    if (!ops)
        return;

    const op = ops.find(o => o.type === Seq.eSeqPatternOp.AddNote);
    if (op) {
        let midiNoteValue = this.props.context.instrument.sequencerDevice.livePatch.AdjustMidiNoteValue(op.midiNoteValue);
        if (midiNoteValue) {
            const legendNote = legend.find(n => n.midiNoteValue === op.midiNoteValue);
            const velocityEntry = legendNote?.velocitySet[op.velocityIndex];
            const velocity = velocityEntry?.vel ?? 99;

            const patternLengthQuarters = patch.GetPatternLengthQuarters();
            const bpm = this.props.context.app.roomState.bpm;
            const lengthPatternFrac = divInfo.endPatternFrac - divInfo.beginPatternFrac;
            const lengthQuarters = lengthPatternFrac * patternLengthQuarters;
            const lengthMS = DFU.BeatsToMS(lengthQuarters, bpm);

            this.props.context.app.PreviewNoteOn(midiNoteValue, velocity);
            setTimeout(() => {
                this.props.context.app.PreviewNoteOff();
            }, lengthMS);
        }
    }

    this.props.context.app.SeqPatternOps(ops);
  }


  clickLengthHandlePrevious = (cell) => {
    const isReadOnly = this.props.context.isReadOnly;
    if (isReadOnly) return;
    const seq = this.props.context.instrument.sequencerDevice;
    const patch = seq.livePatch;
    const noteLegend = seq.GetNoteLegend();
    const patternViewData = Seq.GetPatternView(patch, noteLegend);
    const ops = patternViewData.GetPatternOpsForSetNoteLengthPrevious(cell);
    if (!ops) return;
    this.props.context.app.SeqPatternOps(ops);
  }

  clickLengthHandleCurrent = (cell) => {
    const isReadOnly = this.props.context.isReadOnly;
    if (isReadOnly) return;
    const seq = this.props.context.instrument.sequencerDevice;
    const patch = seq.livePatch;
    const noteLegend = seq.GetNoteLegend();
    const patternViewData = Seq.GetPatternView(patch, noteLegend);
    const ops = patternViewData.GetPatternOpsForSetNoteLengthCurrent(cell);
    if (!ops) return;
    this.props.context.app.SeqPatternOps(ops);
  }

  onPointerDown(e, dragType, hasNote, clickHandler) {
    const clickedPatternDivIndex = this.props.div.patternDivIndex;
    const midiNoteValue = this.props.note.midiNoteValue;

    const isReadOnly = this.props.context.isReadOnly;
    if (isReadOnly) return;
    const seq = this.props.context.instrument.sequencerDevice;
    const patternViewData = Seq.GetPatternView(seq.livePatch, seq.GetNoteLegend());

    const noteOnCell = hasNote && patternViewData.divs[clickedPatternDivIndex].rows[midiNoteValue]?.noteOnCell;
    const notePatternDivIndex = noteOnCell?.div?.patternDivIndex ?? clickedPatternDivIndex;
    const notePatternDivLength = noteOnCell?.thisNote?.divs?.length ?? 1;

    window.DFKeyTracker.events.on("keydown", this.onKeyDownWhileDragging);
    e.target.setPointerCapture(e.pointerId);
    e.target.onpointermove = (e) => this.onPointerMove(e);

    // could consider using e.dataTransfer.setData("7jamDragData", ); for this but why?
    // limiting the scope of this data limits our ability to do browser-level optimization of styling.

    const cancelProc = () => {
      e.target.releasePointerCapture(e.pointerId);
      window.DFKeyTracker.events.removeListener("keydown", this.onKeyDownWhileDragging);
      e.target.onpointermove = null;
      this.ClearDragTargetStyles();
      this.dragData = null;
    };

    this.dragData = {
        dragType,
        styledElements: [], // [{ patternDivIndex, midiNoteValue }]
        clickHandler,
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        adventure: false,
        cancelProc,
        source: {
            clickedPatternDivIndex,
            notePatternDivIndex,
            notePatternDivLength,
            midiNoteValue,
        },
        dest: {
            midiNoteValue,
            patternDivIndex : notePatternDivIndex,
            patternDivLength : notePatternDivLength,
        }
    };
  }

  onKeyDownWhileDragging = (e) => {
    if (e.key === 'Escape') {
      this.dragData.cancelProc();
    }
  }

  onPointerMove(e) {
    const elements = document.elementsFromPoint(e.clientX, e.clientY);
    let li = null;
    let midiNoteValue = null;
    let hoverDivIndex = null;
    elements.forEach(el => {
      if (el.dataset.note && el.dataset.div) {
        li = el;
        midiNoteValue = el.dataset.note|0;
        hoverDivIndex = el.dataset.div|0;
      }
    });
    if (!li) return li;
    if (!this.dragData) return; // dragging something we are not tracking... bail.
    const isReadOnly = this.props.context.isReadOnly;
    if (isReadOnly) return;

    const seq = this.props.context.instrument.sequencerDevice;
    const legend = seq.GetNoteLegend();
    const patternViewData = Seq.GetPatternView(seq.livePatch, legend);

    const src = this.dragData.source;
    const dest = this.dragData.dest;

    if (midiNoteValue !== src.midiNoteValue || hoverDivIndex !== src.clickedPatternDivIndex) {
      this.dragData.adventure = true;
    }

    switch (this.dragData.dragType) {
        case "noteMove":
            // move note
            this.dragData.dest.midiNoteValue = midiNoteValue;
            this.dragData.dest.patternDivIndex = DFU.modulo(this.dragData.source.notePatternDivIndex + (hoverDivIndex - this.dragData.source.clickedPatternDivIndex), patternViewData.divs.length);
            //console.log(`onDragOver moving from note ${this.dragData.source.midiNoteValue} @ [${this.dragData.source.notePatternDivIndex}, len ${this.dragData.source.notePatternDivLength}] ` +
            //    `to note ${this.dragData.dest.midiNoteValue} @ [${this.dragData.dest.patternDivIndex}, len ${this.dragData.dest.patternDivLength}]`);
            break;
        case "noteOn":
            //this.dragData.dest.midiNoteValue = midiNoteValue; // don't move note while changing lengths it's weird.
            this.dragData.dest.patternDivIndex = hoverDivIndex;
            const originalEndDiv = this.dragData.source.notePatternDivIndex + this.dragData.source.notePatternDivLength;
            this.dragData.dest.patternDivLength = DFU.modulo(originalEndDiv - hoverDivIndex, patternViewData.divs.length);

            if (this.dragData.dest.patternDivLength === 0) {
              this.dragData.dest.patternDivLength = patternViewData.divs.length;
            }
            break;
        case "noteOff":
            //this.dragData.dest.midiNoteValue = midiNoteValue; // don't move note while changing lengths it's weird.
            this.dragData.dest.patternDivLength = DFU.modulo(hoverDivIndex - this.dragData.source.notePatternDivIndex + 1, patternViewData.divs.length);
            if (this.dragData.dest.patternDivLength === 0) {
              this.dragData.dest.patternDivLength = patternViewData.divs.length;
            }
            break;
        case "newNote":
          // move note ON only.
          this.dragData.dest.midiNoteValue = midiNoteValue; // don't move note while changing lengths it's weird.

          this.dragData.dest.patternDivLength = DFU.modulo(hoverDivIndex - this.dragData.source.notePatternDivIndex + 1, patternViewData.divs.length);
          if (this.dragData.dest.patternDivLength === 0) {
            this.dragData.dest.patternDivLength = patternViewData.divs.length;
          }
          break;
      }

    this.UpdateDragTargetStyles(patternViewData);
  }

  #doDragOp(keepSrc) {
    const seq = this.props.context.instrument.sequencerDevice;
    const legend = seq.GetNoteLegend();
    const patternView = Seq.GetPatternView(seq.livePatch, legend);
    const ops = patternView.GetPatternOpsForNoteDrag(
      keepSrc,
      this.dragData.source.midiNoteValue,
      this.dragData.source.notePatternDivIndex,
      this.dragData.dest.midiNoteValue,
      this.dragData.dest.patternDivIndex,
      this.dragData.dest.patternDivLength,
      );
    this.props.context.app.SeqPatternOps(ops);
  }

  onPointerUp(e, hasNote, clickHandler) {
    if (!this.dragData) {
      return;
    }
    //console.log(`onpointerup ${e.target.id}`);
    e.target.releasePointerCapture(e.pointerId);
    window.DFKeyTracker.events.removeListener("keydown", this.onKeyDownWhileDragging);
    e.target.onpointermove = null;
    this.ClearDragTargetStyles();

    if (!this.dragData.adventure) {
      clickHandler(e);
    } else {
      switch (this.dragData.dragType) {
        case "noteMove":
          this.#doDragOp(e.ctrlKey);
          break;
        case "noteOn":
          this.#doDragOp();
            break;
        case "noteOff":
          this.#doDragOp();
            break;
        case "newNote":
          this.#doDragOp();
          break;
      }
    }

    this.dragData = null;
  }

  noteBodyRef(r, hasNote, clickHandler) {
    if (!r) return;
    if (!hasNote) {
      r.onpointerdown = (e) => this.onPointerDown(e, "newNote", hasNote, clickHandler);
    } else {
      r.onpointerdown = (e) => this.onPointerDown(e, "noteMove", hasNote, clickHandler);
    }
    r.onpointerup = (e) => this.onPointerUp(e, hasNote, clickHandler);
  }

  noteOnHandleRef(r, hasNote, clickHandler) {
    if (!r) return;
    r.onpointerdown = (e) => this.onPointerDown(e, "noteOn", hasNote, clickHandler);
    r.onpointerup = (e) => this.onPointerUp(e, hasNote, clickHandler);
  }

  noteOffHandleRef(r, hasNote, clickHandler) {
    if (!r) return;
    r.onpointerdown = (e) => this.onPointerDown(e, "noteOff", hasNote, clickHandler);
    r.onpointerup = (e) => this.onPointerUp(e, hasNote, clickHandler);
  }

  render() {
    const patch = this.props.context.patch;
    const patternViewData = this.props.context.patternViewData;
    const noteLegend = this.props.context.noteLegend;
    const note = this.props.note;
    const divInfo = this.props.div;

    const cssClasses = new Set();

    if (patch.IsNoteMuted(note.midiNoteValue)) {
      cssClasses.add('muted');
    }

    let setLengthProc = ()=>{};
    let cellClickHandler = (e)=>this.onCellClick(e, patternViewData, divInfo, note, noteLegend, patch, setLengthProc);
    let cell = null;
    if ((note.midiNoteValue in divInfo.rows)) {
        cell = divInfo.rows[note.midiNoteValue];
        cssClasses.add(cell.cssClass);
        if (!cell.thisNote && cell.previousNote) { // no note + there is a previous note. it means you can set the length of the previous note.
            setLengthProc = () => this.clickLengthHandlePrevious(cell);
        }

        if (cell.thisNote) { // this cell has a note in it
            cssClasses.add("note");
            setLengthProc = () => this.clickLengthHandleCurrent(cell)
        }

        if (cell.beginBorderType === Seq.eBorderType.NoteOn) {
          cssClasses.add("beginnoteon");
        }
        else if (cell.beginBorderType === Seq.eBorderType.Continue) {
          cssClasses.add("begincontinue");
        }

        if (cell.endBorderType === Seq.eBorderType.Continue) {
          cssClasses.add("endcontinue");
        }
        else if (cell.endBorderType === Seq.eBorderType.NoteOff) {
          cssClasses.add("endnoteoff");
        }
    }

    return (
        <li
          id={GetIDForCell(divInfo.patternDivIndex, note.midiNoteValue)}
          key={divInfo.patternDivIndex + "_" + note.midiNoteValue}
          style={this.props.context.rowStyle}
          className={note.cssClass + " " + Array.from(cssClasses).join(" ")}
          data-div={divInfo.patternDivIndex}
          data-note={note.midiNoteValue}
          >
            <div className='noteBase'>
              <div className='noteOL'>
                  <div className='muteOL'>
                    <div
                      className='noteOnHandle'
                      ref={r => this.noteOnHandleRef(r, !!cell?.thisNote, cellClickHandler)}
                      >
                    </div>
                    <div
                        className='cellBody'
                        ref={r => this.noteBodyRef(r, !!cell?.thisNote, cellClickHandler)}
                        >
                    </div>
                    <div
                      className='noteOffHandle'
                      ref={r => this.noteOffHandleRef(r, !!cell?.thisNote, cellClickHandler)}
                      >
                    </div>
                  </div>
              </div>
            </div>
        </li>
    )
  }
};



module.exports = {
  SequencerCell,
}