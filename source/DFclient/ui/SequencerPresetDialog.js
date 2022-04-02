const React = require('react');
const DFU = require('../../DFcommon/dfutil');
const ClickAwayListener = require ('./3rdparty/react-click-away-listener');
const DF = require("../../DFcommon/DFCommon");
const Seq = require('../../DFcommon/SequencerCore');
const { TextField } = require('./DFReactUtils');

/////////////////////////////////////////////////////////////////////////////////////////////////////////
// key={preset.presetID}
// app={this.props.app}
// instrument={this.props.instrument}
// preset={preset}
// isReadOnly
class SequencerPresetItem extends React.Component {
   constructor(props) {
      super(props);
      this.state = {
         overwriteConfirmShowing: false,
         deleteConfirmShowing: false,
      };
   }

   onClickLoad = (e) => {
      const isReadOnly = this.props.isReadOnly;
      if (isReadOnly) return;
      this.props.app.SeqPresetOp({
         op: "load",
         presetID: this.props.preset.presetID,
      });
   }

   onClickOverwrite = (e) => {
      const isReadOnly = this.props.isReadOnly;
      if (isReadOnly) return;
      this.props.app.SeqPresetOp({
         op: "save",
         presetID: this.props.preset.presetID,
      });
      alert(`Saved preset '${this.props.preset.presetName}'`);
      this.setState({overwriteConfirmShowing:false});
   }

   onClickDelete = (e) => {
      const isReadOnly = this.props.isReadOnly;
      if (isReadOnly) return;
      this.props.app.SeqPresetOp({
         op: "delete",
         presetID: this.props.preset.presetID,
      });
      this.setState({deleteConfirmShowing:false});
      alert(`Deleted patch '${this.props.preset.presetName}'`);
   }

   render() {
      const isReadOnly = this.props.isReadOnly;
      //const clickableIfEditable = isReadOnly ? "" : " clickable";
      return (
         <li className={'presetItem' + (this.props.livePatch.presetID === this.props.preset.presetID ? " selected" : "")}>
            <div className="buttonContainer">
               {!isReadOnly && <button className='clickable' onClick={() => this.onClickLoad()}><i className="material-icons">file_open</i>Load</button>}
               {!isReadOnly && <button className='clickable' onClick={() => this.setState({deleteConfirmShowing:true})}><i className="material-icons">delete</i>Delete</button>}
            </div>
            <span className="presetName">{this.props.preset.presetName}</span>
            {window.DFModerationControlsVisible && 
               <div>presetID: {this.props.preset.presetID}</div>
            }
            <span className="description">{this.props.preset.presetDescription}</span>
            <span className="tags">{this.props.preset.presetTags}</span>
            <div className="authorAndDateBox">
               <span className="author">by {this.props.preset.presetAuthor}</span>
               <span className="savedDate">{this.props.preset.presetSavedDate.toLocaleString()}</span>
            </div>
            {
               this.props.preset.includeInstrumentPatch &&
               <div className="includeInstrumentPatch">
                  * includes instrument parameters
               </div>
            }

            {this.state.overwriteConfirmShowing && <div className="confirmationBox">
               Click 'OK' to load this preset
               <br />
               <button className="OK clickable" onClick={() => this.onClickOverwrite()}>OK</button>
               <button className="Cancel clickable" onClick={() => this.setState({overwriteConfirmShowing:false})}>Cancel</button>
            </div>}

            {this.state.deleteConfirmShowing && <div className="confirmationBox">
               Click 'OK' to delete "{this.props.preset.presetName}"
               <br />
               <button className="OK clickable" onClick={() => this.onClickDelete()}>OK</button>
               <button className="Cancel clickable" onClick={() => this.setState({deleteConfirmShowing:false})}>Cancel</button>
            </div>}

         </li>
      );
   }
 
}




/////////////////////////////////////////////////////////////////////////////////////////////////////////
class SequencerPresetDialog extends React.Component {
   constructor(props) {
      super(props);
      this.state = {
         filterTxt:"",
         includeInstrumentPatch:true,
      };
   }
   // onClickCopyBank = (e) => {
   //    if (!this.props.app.myUser.IsAdmin()) return;
   //    const bank = this.props.app.roomState.GetSeqPresetBankForInstrument(this.props.instrument);
   //    const txt = bank.ExportBankAsJSON();
   //    navigator.clipboard.writeText(txt).then(() => {
   //        alert('Bank was copied to the clipboard.')
   //    }, () => {
   //        alert('Unable to copy.')
   //    });
   // }
   // onClickPasteBank = (e) => {
   //    if (this.props.observerMode) return;
   //    navigator.clipboard.readText().then(text => {
   //       try {
   //          const newBankInp = JSON.parse(text);
   //          this.props.app.SeqPresetOp({
   //             op: "pasteBank",
   //             bank: newBankInp,
   //          });
   //          alert("Import bank successful");
   //       } catch (e) 
   //       {
   //          console.log(e);
   //          alert('There was some problem importing the bank.')
   //       }
   //    });
   // }
   onClickCopyPatch = (e) => {
      const patch = this.props.instrument.sequencerDevice.livePatch;
      const txt = JSON.stringify(patch);
      navigator.clipboard.writeText(txt).then(() => {
          alert('Live patch was copied to the clipboard.')
      }, () => {
          alert('Unable to copy.')
      });
   }
   onClickPastePatch = (e) => {
      if (this.props.observerMode) return;
      navigator.clipboard.readText().then(text => {
         try {
            const newPatchInp = JSON.parse(text);
            const newPatch = new Seq.SequencerPatch(newPatchInp);
            this.props.app.SeqPresetOp({
               op: "pastePatch",
               patch: newPatch,
            });
            alert("Import patch successful");
         } catch (e) 
         {
            console.log(e);
            alert('There was some problem importing the patch.')
         }
      });
   }
   onClickSaveNew = (e) => {
      const isReadOnly = this.props.observerMode;
      if (isReadOnly) return;
      this.props.app.SeqPresetOp({
         op: "save",
         includeInstrumentPatch: this.state.includeInstrumentPatch,
         presetID: null,
      });
      alert("Saved");
   }
   onClickSaveExisting = (e) => {
      const isReadOnly = this.props.observerMode;
      if (isReadOnly) return;
      const patch = this.props.instrument.sequencerDevice.livePatch;
      this.props.app.SeqPresetOp({
         op: "save",
         includeInstrumentPatch: this.state.includeInstrumentPatch,
         presetID: patch.presetID,
      });
      alert("Saved");
   }
   onFilterChange = (txt) => {
      this.setState({ filterTxt: txt });
   };

   SetPatchName = (val) => {
      const isReadOnly = this.props.observerMode;
      if (isReadOnly) return;
      let metadata = this.props.instrument.sequencerDevice.livePatch.GetMetadata();
      metadata.title = val;
      this.props.app.SeqMetadata(metadata);
   }

   SetPatchDescription = (val) => {
      const isReadOnly = this.props.observerMode;
      if (isReadOnly) return;
      let metadata = this.props.instrument.sequencerDevice.livePatch.GetMetadata();
      metadata.description = val;
      this.props.app.SeqMetadata(metadata);
   }

   SetPatchTags = (val) => {
      const isReadOnly = this.props.observerMode;
      if (isReadOnly) return;
      let metadata = this.props.instrument.sequencerDevice.livePatch.GetMetadata();
      metadata.tags = val;
      this.props.app.SeqMetadata(metadata);
   }

   presetMatches(preset, txt) {
      let keys = txt.toLowerCase().split(" ");
      keys = keys.map(k => k.trim());
      keys = keys.filter(k => k.length > 0);
      if (keys.length < 1) return true;
      let ret = false;
      if (keys.some(k => preset.presetName.toLowerCase().includes(k))) return true;
      if (keys.some(k => preset.presetDescription.toLowerCase().includes(k))) return true;
      if (keys.some(k => preset.presetAuthor.toLowerCase().includes(k))) return true;
      if (!preset.presetTags) return false;
      return keys.some(k => preset.presetTags.toLowerCase().includes(k));
  }

  onClickToggleIncludeInstrumentParams = (e) => {
     this.setState({includeInstrumentPatch:!this.state.includeInstrumentPatch});
  }

   render() {

      const bank = this.props.app.roomState.GetSeqPresetBankForInstrument(this.props.instrument);
      const patch = this.props.instrument.sequencerDevice.livePatch;
      const isReadOnly = this.props.observerMode;
      const clickableIfEditable = isReadOnly ? "" : " clickable";

      const bankRef = bank.GetCompactPresetById(patch.presetID);

      const presetList = bank.compactPresets.filter(preset => this.presetMatches(preset, this.state.filterTxt)).map(preset => (
         <SequencerPresetItem
            key={preset.presetID}
            app={this.props.app}
            instrument={this.props.instrument}
            preset={preset}
            livePatch={patch}
            isReadOnly={isReadOnly}
            ></SequencerPresetItem>
         ));

     return (
      <div className="dialogContainer seqPresets">
         <legend onClick={this.props.onClose}>Presets</legend>
         <fieldset>
            <div className="legend">Current preset</div>
            <ul>
               <li><TextField
                  fieldID="name"
                  valueSetter={(val) => this.SetPatchName(val)}
                  valueGetter={() => this.props.instrument.sequencerDevice.livePatch.GetMetadata().title}
                  readOnly={isReadOnly}
                  maxLength={25}
                  ></TextField>preset name</li>

               <li><TextField
                  fieldID="description"
                  valueSetter={(val) => this.SetPatchDescription(val)}
                  valueGetter={() => this.props.instrument.sequencerDevice.livePatch.GetMetadata().description}
                  readOnly={isReadOnly}
                  maxLength={300}
                  ></TextField>description</li>

               <li><TextField
                  fieldID="tags"
                  valueSetter={(val) => this.SetPatchTags(val)}
                  valueGetter={() => this.props.instrument.sequencerDevice.livePatch.GetMetadata().tags}
                  readOnly={isReadOnly}
                  maxLength={25}
                  ></TextField>tags</li>

               {window.DFModerationControlsVisible && <li>presetID: {patch.presetID}</li>}

            </ul>
            <ul className='buttonPatchOps'>
               <li>
                  {bankRef &&
                     <button title="Save and Overwrite" className={clickableIfEditable} onClick={(e)=>this.onClickSaveExisting(e)}>
                        <i className="material-icons">save</i>Save existing (overwrite "{bankRef.presetName}")
                     </button>
                  }
                  <button title="Save as new preset" className={clickableIfEditable} onClick={(e)=>this.onClickSaveNew(e)}>
                     <i className="material-icons">save</i>Save as new preset
                  </button>
                  <button className={"radio " + clickableIfEditable + (this.state.includeInstrumentPatch ? " active" : " inactive")}
                  onClick={(e)=>this.onClickToggleIncludeInstrumentParams()}>
                     {this.state.includeInstrumentPatch ? "will include instrument params" : "will not include instrument parameters"}
                  </button>
               </li>
               <li>
                  <button className='clickable' title="Copy patch" onClick={(e)=>this.onClickCopyPatch(e)}>
                     <i className="material-icons">content_copy</i>Copy patch to clipboard</button>
               </li>
               <li>
                  <button title="Paste patch" className={clickableIfEditable} onClick={(e)=>this.onClickPastePatch(e)}>
                     <i className="material-icons">content_paste</i>Paste patch from clipboard
                  </button>
               </li>
               {/* {this.props.app.myUser.IsAdmin() &&
               <li>
                  <button className='clickable' title="Copy bank" onClick={(e)=>this.onClickCopyBank(e)}><i className="material-icons">content_copy</i>Copy bank</button>
               </li>}
               {this.props.app.myUser.IsAdmin() &&
               <li>
                  <button className='clickable' title="Paste bank" onClick={(e)=>this.onClickPasteBank(e)}><i className="material-icons">content_paste</i>Paste bank</button>
               </li>} */}
            </ul>
         </fieldset>
         <fieldset>
            <div className="legend">
               <span>Presets</span>
               <div className="presetFilter">
                  <i className="material-icons">search</i>

                  <TextField
                     fieldID="presetFilter"
                     valueSetter={(val) => this.onFilterChange(val)}
                     valueGetter={() => this.state.filterTxt}
                     readOnly={false}
                     maxLength={25}
                  ></TextField>

               </div>
            </div>
            <ul className='dropDownMenu presetsList'>
               {presetList}
            </ul>
         </fieldset>
      </div>

     );
 }
};

module.exports = SequencerPresetDialog;

