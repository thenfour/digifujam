const React = require('react');
const { RoomPresetSettings, RoomPreset, InstSeqSelection } = require('../../DFcommon/roomPresetsCore');
const { TextField } = require('./DFReactUtils');

// defines which ctrl panel is visible.
window.DFModalDialogContext = {
  op: null, // "roomPresets"
};

function DFInvokeModal(params) {
  window.DFModalDialogContext = params;
  window.DFStateChangeHandler.OnStateChange();
}


/////////////////////////////////////////////////////////////////////////////////////////////////////////
class DFModalDialog extends React.Component {
  render() {
    return (
      <div className={"dfmodal " + this.props.modalClassName}>
        <div className='topControls'>
          <span>{this.props.title}</span>
          <button className='close' onClick={() => DFInvokeModal({op:null})}><i className="material-icons">close</i></button>
        </div>
        <div className='body'>
          {this.props.children}
        </div>
      </div>
    );
  }
}


/////////////////////////////////////////////////////////////////////////////////////////////////////////
// app={this.props.app}
// instrumentID={}
// selectionObj={} // object to bind to
// valueSetter={} // routine to handle state changes
// displays a list of instruments and sequencers to include in either an import or export operation
class RoomPatchSelectionInstrumentTR extends React.Component {

  onClickInst(e) {
    const i = this.props.selectionObj.instrumentIDs.findIndex(iid => iid === this.props.instrumentID);
    if (i == -1) {
      this.props.selectionObj.instrumentIDs.push(this.props.instrumentID);
    } else {
      this.props.selectionObj.instrumentIDs.splice(i, 1);
    }
    this.props.valueSetter(this.props.selectionObj);
  }

  onClickSeq(e) {
    const i = this.props.selectionObj.sequencerInstrumentIDs.findIndex(iid => iid === this.props.instrumentID);
    if (i == -1) {
      this.props.selectionObj.sequencerInstrumentIDs.push(this.props.instrumentID);
    } else {
      this.props.selectionObj.sequencerInstrumentIDs.splice(i, 1);
    }
    this.props.valueSetter(this.props.selectionObj);
  }

  render() {
    const vars = {
      displayName: this.props.instrumentID,
      instrumentStyle: {},
      userStyle: {},
      isValid: false,
      takenByUser: null,
      isIdle: false,
      sequencerHasData: false,
      sequencerIsPlaying: false,
      isAutoSelected: false,
      isSelectedInstrument: false,
      isSelectedSequencer: false,
    };
    const app = this.props.app;
    const instrumentID = this.props.instrumentID;
    let instrument = app.roomState.FindInstrumentById(instrumentID);

    // is valid instrument ?
    if (instrument) {
      instrument = instrument.instrument; // ugh
      vars.displayName = instrument.getDisplayName();
      vars.instrumentStyle.color = instrument.color;
      vars.isValid = instrument.supportsPresets;
      vars.takenByUser = app.roomState.FindUserByID(instrument.controlledByUserID);
      if (vars.takenByUser) {
        vars.userStyle.color = vars.takenByUser.user.color;
        vars.takenByUser = vars.takenByUser.user.name;
      }
      vars.isIdle = vars.takenByUser && instrument.IsIdle(app.roomState);

      vars.sequencerHasData = instrument.allowSequencer && instrument.sequencerDevice.HasData();
      vars.sequencerIsPlaying = instrument.allowSequencer && instrument.sequencerDevice.IsPlaying();
    }
    vars.isSelectedInstrument = !!this.props.selectionObj.instrumentIDs.find(x => x === instrumentID);
    vars.isSelectedSequencer = !!this.props.selectionObj.sequencerInstrumentIDs.find(x => x === instrumentID);

    return (
    <tr className={(vars.isValid ? " valid" : " invalid") }>
      <td onClick={(e) => this.onClickInst(e)} title="Instrument/synth parameters. Click to select/deselect." className={"instSelection " + (vars.isSelectedInstrument ? " selected" : "")}>
        <div className='btn'>inst</div>
        </td>
      <td onClick={(e) => this.onClickSeq(e)} title="Sequencer patch. Click to select/deselect." className={" seqSelection " + (vars.isSelectedSequencer ? " selected" : "")}>
        <div className='btn'>seq</div>
      </td>
      <td title="Sequencer status" className='seqState'>
        <div className={'seqIndicator ' + (vars.sequencerHasData ? " hasData" : " empty") + (vars.sequencerIsPlaying ? " isPlaying" : " stopped")}>
        </div>
      </td>
      <td className='instName'>
        <span className='instName' style={vars.instrumentStyle}>{vars.displayName}</span>
      </td>
      <td className='username'>
        <span className='name' style={vars.userStyle}>{vars.takenByUser}</span>
        <span className='idle'>{vars.isIdle ? "(idle)" : ""}</span>
      </td>
    </tr>);
  }
}


/////////////////////////////////////////////////////////////////////////////////////////////////////////
// app={this.props.app}
// instrumentListType={} // "loadingPatch" or "live"
// loadingPatch={} // optional: if specified, the user is loading a patch. changes behavior regarding selection etc.
// valueSetter={} // routine to handle state changes
// displays a list of instruments and sequencers to include in either an import or export operation
class RoomPatchSelection extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      value: new InstSeqSelection(props.app.roomState, props.loadingPatch)
    }

    if (this.props.instrumentListType === 'loadingPatch') {
      this.instrumentIDList = new Set(Object.keys(props.loadingPatch.instPatches));
      Object.keys(props.loadingPatch.seqPatches).forEach(i => {
        this.instrumentIDList.add(i);
      });
      this.instrumentIDList = [...this.instrumentIDList]; // set to array.
    } else {
      this.instrumentIDList = props.app.roomState.instrumentCloset.filter(i => i.supportsPresets).map(i => i.instrumentID);
    }

    this.props.valueSetter(this.state.value);
  }

  onClickAll() {
    this.state.value.SelectAll();
    this.props.valueSetter(this.state.value);
  }

  onClickNone() {
    this.state.value.SelectNone();
    this.props.valueSetter(this.state.value);
  }

  onClickAuto() {
    this.state.value.SelectAuto();
    this.props.valueSetter(this.state.value);
  }

  render() {
    return (
      <div className={'roomPatchSelection ' + this.props.instrumentListType}>
        <div className='topControls'>
          <button onClick={() => this.onClickAll()}>All</button>
          <button onClick={() => this.onClickNone()}>None</button>
          {(this.props.instrumentListType !== 'loadingPatch') && <button onClick={() => this.onClickAuto()}>Auto</button>}
        </div>
        <table>
          <tbody>
            {
              this.instrumentIDList.map((instrumentID, i) =>
                <RoomPatchSelectionInstrumentTR
                  key={i}
                  app={this.props.app}
                  instrumentID={instrumentID}
                  selectionObj={this.state.value}
                  valueSetter={this.props.valueSetter}
                />)
            }
          </tbody>
        </table>
      </div>
    );
  }

}






/////////////////////////////////////////////////////////////////////////////////////////////////////////
// key={preset.presetID}
// app={this.props.app}
// preset={preset} // a compact preset!
// isReadOnly
class RoomPresetLI extends React.Component {
  constructor(props) {
     super(props);
     this.state = {
        deleteConfirmShowing: false,
        loadingObj: null,
        loadingSelection: null,
     };
  }

  onChangeLoadingSelection(sel) {
    this.setState({loadingSelection: sel});
  }

  componentDidMount() {
    this.props.app.events.addListener("RoomPatchRead", this.onRoomPatchFetched);
  }

  componentWillUnmount() {
    this.props.app.events.removeListener("RoomPatchRead", this.onRoomPatchFetched);
  }

  onRoomPatchFetched = (e) => {
    if (e.data.presetID === this.props.preset.presetID) {
      this.setState({
        loadingObj: new RoomPreset(e.data),
      });
    } else {
      this.setState({
        loadingObj: null, // for OTHER rows, abandon the loading confirmation otherwise it gets spammy
      });
    }
  }

  onClickLoad = (e) => {
     const isReadOnly = this.props.isReadOnly;
     if (isReadOnly) return;
     this.props.app.net.SendRoomPatchOp({
        op: "ReadPatch",
        id: this.props.preset.presetID,
     });
     // nothing happens yet. wait for server to eventually result in RoomPatchRead event.
  }

  onClickLoadOK = (e) => {
    const isReadOnly = this.props.isReadOnly;
    if (isReadOnly) return;
    const patch = this.state.loadingObj;
    patch.KeepOnlySelected(this.state.loadingSelection);
    this.props.app.net.SendRoomPatchOp({
      op: "Paste",
      data: patch,
    });
    this.setState({
      loadingObj:null,
      loadingSelection:null,
    });
  }

  onClickDelete = (e) => {
     const isReadOnly = this.props.isReadOnly;
     if (isReadOnly) return;
     this.props.app.net.SendRoomPatchOp({
        op: "DeletePatch",
        id: this.props.preset.presetID,
     });
     this.setState({deleteConfirmShowing:false});
     alert(`Deleted patch '${this.props.preset.presetName}'`);
  }

  render() {
     const isReadOnly = this.props.isReadOnly;
     const mgr = this.props.app.roomState.roomPresets;
     return (
        <li className={'presetItem' + (mgr.livePresetID === this.props.preset.presetID ? " selected" : "")}>
           <div className="buttonContainer">
              {!isReadOnly && <button className='clickable' onClick={() => this.onClickLoad()}><i className="material-icons">file_open</i>Load</button>}
              {!isReadOnly && <button className='clickable' onClick={() => this.setState({deleteConfirmShowing:true})}><i className="material-icons">delete</i>Delete</button>}
           </div>
           <span className="presetName">{this.props.preset.name}</span>
           {this.props.app.myUser.IsAdmin() && 
              <div>presetID: {this.props.preset.presetID}</div>
           }
           <span className="bpm">{this.props.preset.bpm} BPM</span>
           <span className="description">{this.props.preset.description}</span>
           <span className="tags">{this.props.preset.tags}</span>
           <div className="authorAndDateBox">
              <span className="author">by {this.props.preset.author}</span>
              <span className="savedDate">{this.props.preset.date.toLocaleString()}</span>
           </div>

          {this.state.loadingObj &&
            <div className="confirmationBox">
              Select which elements to import for "{this.props.preset.name}"
              <RoomPatchSelection app={this.props.app}
                instrumentListType="loadingPatch"
                loadingPatch={this.state.loadingObj}
                valueSetter={(sel) => this.onChangeLoadingSelection(sel)}
                />
              <button className="OK clickable" onClick={() => this.onClickLoadOK()}>OK</button>
              <button className="Cancel clickable" onClick={() => this.setState({loadingObj:null})}>Cancel</button>
           </div>
           }

           {this.state.deleteConfirmShowing && <div className="confirmationBox">
              Click 'OK' to delete "{this.props.preset.name}"
              <br />
              <button className="OK clickable" onClick={() => this.onClickDelete()}>OK</button>
              <button className="Cancel clickable" onClick={() => this.setState({deleteConfirmShowing:false})}>Cancel</button>
           </div>}

        </li>
     );
  }

}


/////////////////////////////////////////////////////////////////////////////////////////////////////////
class RoomPresetsDialog extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      filterTxt:"",
      pastingObj:"",
      copyingSelection:null,
      pastingSelection:null,
      savingSelection:null,
    };
  }

  onChangeSavingSelection(sel) {
    this.setState({savingSelection:sel});
  }

  onChangePastingSelection(sel) {
    this.setState({pastingSelection:sel});
  }

  onChangeCopyingSelection(sel) {
    this.setState({copyingSelection:sel});
  }

  IsReadOnly() {
    return !!this.props.observerMode || !this.props.app.roomState.UserCanPerform(this.props.app.myUser);
  }

  onClickCopy = (e) => {
    this.setState({copyConfirmationShown:true});
  }

  OnClickCopyOK = (e) => {
    const obj = this.props.app.roomState.roomPresets.GetLivePatchObj(this.state.copyingSelection);
    const txt = JSON.stringify(obj);
    navigator.clipboard.writeText(txt).then(() => {
        alert('Copied to the clipboard!')
        this.setState({copyConfirmationShown:false});
      }, (e) => {
        console.log(e);
        alert('Unable to copy.')
    });
  }

  onClickPaste = (e) => {
    if (this.IsReadOnly()) return;
    try {
      navigator.clipboard.readText()
        .then(text => {
          let pastingObj = JSON.parse(text);
          pastingObj = new RoomPreset(pastingObj);
          this.setState({pastingObj});
        })
        .catch(e => {
          console.log(e);
          alert('There was a problem importing the patch.');
        });
    } catch (e) {
      console.log(e);
      alert('There was some problem importing the patch.');
    }
  }

  OnClickPasteOK = () => {
    if (this.IsReadOnly()) return;

    this.state.pastingObj.KeepOnlySelected(this.state.pastingSelection);

    this.props.app.net.SendRoomPatchOp({
      op: "Paste",
      data: this.state.pastingObj,
    });
    this.setState({pastingObj:null});
    alert('Ok, should be good to go.');
  }



  onClickSaveNew = (e) => {
    if (this.IsReadOnly()) return;
    this.setState({
      saveConfirmationShown:true,
      isSaveNew:true,
    });
  }
 
  onClickSaveExisting = (e) => {
    // it's the same as Save New except without generating a new ID.
    if (this.IsReadOnly()) return;
    this.setState({
      saveConfirmationShown:true,
      isSaveNew:false,
    });
  }

  OnClickSaveOK() {
    if (this.IsReadOnly()) return;
    const data = this.props.app.roomState.roomPresets.GetLivePatchObj(this.state.savingSelection);
    if (this.state.isSaveNew) {
      data.GenerateUniquePatchID();// give it a new ID to ensure saving new.
    }
    this.props.app.net.SendRoomPatchOp({
      op: "Save",
      data,
    });
    this.setState({
      saveConfirmationShown:false,
      isSaveNew:false,
    });
    alert("Saved!");
  }


  onFilterChange = (txt) => {
    this.setState({ filterTxt: txt });
  };

  SetPatchName = (val) => {
    if (this.IsReadOnly()) return;
    const metadata = Object.assign({}, this.props.app.roomState.roomPresets.liveMetadata);
    metadata.name = val;
    this.props.app.net.SendRoomPatchOp({
      op: "SetMetadata",
      metadata,
    });
  }

  SetPatchDescription = (val) => {
    if (this.IsReadOnly()) return;
    const metadata = Object.assign({}, this.props.app.roomState.roomPresets.liveMetadata);
    metadata.description = val;
    this.props.app.net.SendRoomPatchOp({
      op: "SetMetadata",
      metadata,
    });
  }

  SetPatchTags = (val) => {
    if (this.IsReadOnly()) return;
    const metadata = Object.assign({}, this.props.app.roomState.roomPresets.liveMetadata);
    metadata.tags = val;
    this.props.app.net.SendRoomPatchOp({
      op: "SetMetadata",
      metadata,
    });
  }

  patchMatches(preset, txt) {
    let keys = txt.toLowerCase().split(" ");
    keys = keys.map(k => k.trim());
    keys = keys.filter(k => k.length > 0);
    if (keys.length < 1) return true;
    let ret = false;
    if (keys.some(k => preset.name.toLowerCase().includes(k))) return true;
    if (keys.some(k => preset.description.toLowerCase().includes(k))) return true;
    if (keys.some(k => preset.author.toLowerCase().includes(k))) return true;
    return keys.some(k => preset.tags.toLowerCase().includes(k));
  }

  render() {
    const app = this.props.app;
    if (!app.myInstrument?.showRoomPresetsButton) {
      setTimeout(() => DFInvokeModal({op:null}), 10);
      return null;
    }

    const mgr = this.props.app.roomState.roomPresets;

    const isReadOnly = this.IsReadOnly();
    const clickableIfEditable = isReadOnly ? "" : " clickable";

    const bankRef = mgr.GetCompactPresetById(mgr.livePresetID);

    const presetList = mgr.compactPresets.filter(preset => this.patchMatches(preset, this.state.filterTxt)).map((preset, i) => <RoomPresetLI
      key={i}
      app={app}
      preset={preset}
      isReadOnly={isReadOnly}
      />);

    return (
      <DFModalDialog title="Room presets" modalClassName="presets roomPresets">
          <div className='subtext'>
            Room presets are like a mega preset, or a DAW project. They bundle up many instrument settings and sequencer settings into one package.
            This is a way to save the whole room's settings as a "song" you can recall in the future.
          </div>
         <fieldset>
            <div className="legend">Live settings</div>
            <ul className='liveSettings'>
               <li><TextField
                  fieldID="name"
                  valueSetter={(val) => this.SetPatchName(val)}
                  valueGetter={() => mgr.liveMetadata.name}
                  readOnly={isReadOnly}
                  maxLength={RoomPresetSettings.NameMaxLen}
                  ></TextField><span className='caption'>preset name</span></li>

                <li className='bpm'><span className='value'>{this.props.app.roomState.bpm}</span><span className='caption'>BPM</span></li>

               <li><TextField
                  fieldID="description"
                  valueSetter={(val) => this.SetPatchDescription(val)}
                  valueGetter={() => mgr.liveMetadata.description}
                  readOnly={isReadOnly}
                  maxLength={RoomPresetSettings.DescriptionMaxLen}
                  ></TextField><span className='caption'>description</span></li>

               <li><TextField
                  fieldID="tags"
                  valueSetter={(val) => this.SetPatchTags(val)}
                  valueGetter={() => mgr.liveMetadata.tags}
                  readOnly={isReadOnly}
                  maxLength={RoomPresetSettings.TagsMaxLen}
                  ></TextField><span className='caption'>tags</span></li>

               {this.props.app.myUser.IsAdmin() && <li>live presetID: {mgr.livePresetID}</li>}

            </ul>
            <ul className='buttonPatchOps'>


               <li>
                  {bankRef &&
                     <button title="Save and Overwrite" className={clickableIfEditable} onClick={(e)=>this.onClickSaveExisting(e)}><i className="material-icons">save</i>Save existing (update "{bankRef.name}")</button>
                  }
                  <button title="Save as new preset" className={clickableIfEditable} onClick={(e)=>this.onClickSaveNew(e)}><i className="material-icons">save</i>Save as new</button>
               </li>

               {this.state.saveConfirmationShown &&
                  <li>
                  <div className='confirmation'>
                    Select which elements you want to include.
                    <RoomPatchSelection app={app} instrumentListType="live" valueSetter={(sel) => this.onChangeSavingSelection(sel)} />
                    <button className='ok' onClick={() => this.OnClickSaveOK()}>OK</button>
                    <button className='cancel' onClick={() => this.setState({saveConfirmationShown:false})}>Cancel</button>
                  </div>
                  </li>
                  }  



               <li>
                  <button className='clickable' title="Copy patch to clipboard" onClick={(e)=>this.onClickCopy(e)}><i className="material-icons">content_copy</i>Copy patch to clipboard</button>
               </li>
               {this.state.copyConfirmationShown &&
                  <li>
                  <div className='confirmation'>
                    Select which elements you want to export.
                    <RoomPatchSelection app={app} instrumentListType="live" valueSetter={(sel) => this.onChangeCopyingSelection(sel)} />
                    <button className='ok' onClick={() => this.OnClickCopyOK()}>OK</button>
                    <button className='cancel' onClick={() => this.setState({copyConfirmationShown:false})}>Cancel</button>
                  </div>
                  </li>
                  }  


                <li>
                  <button title="Paste patch" className={clickableIfEditable} onClick={(e)=>this.onClickPaste(e)}><i className="material-icons">content_paste</i>Paste patch from clipboard</button>
                </li>
                {this.state.pastingObj &&
                  <li>
                  <div className='confirmation'>
                    Select which elements you want to import. NOTE! If someone else is controlling an instrument, that instrument will not be updated.
                    {/* <RoomPatchObjDesc patch={this.state.pastingObj} app={app} /> */}
                    <RoomPatchSelection app={app} loadingPatch={this.state.pastingObj} instrumentListType="loadingPatch" valueSetter={(sel) => this.onChangePastingSelection(sel)} />
                    <button className='ok' onClick={() => this.OnClickPasteOK()}>OK</button>
                    <button className='cancel' onClick={() => this.setState({pastingObj:null})}>Cancel</button>
                  </div>
                  </li>
                  }

            </ul>
         </fieldset>
         <fieldset>
            <div className="legend">
               <span>Presets library</span>
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
      </DFModalDialog>
    );
  }
}


/////////////////////////////////////////////////////////////////////////////////////////////////////////
class ModalDialogController extends React.Component {
  render() {
    if (this.props.app && (window.DFModalDialogContext.op === "roomPresets")) {
      return <RoomPresetsDialog app={this.props.app} />
    }
    return null;
  }
}

module.exports = {
  ModalDialogController,
  DFInvokeModal
}


