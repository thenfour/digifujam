const React = require('react');
const DFPiano = require("./pianoArea");
const DF = require("../DFCommon");
const DFApp = require("../app");
const DFUtils = require("../util");
const DFSignIn = require("./DFSignIn");
const DFReactUtils = require("./DFReactUtils");
const {AdminControlsButton} = require("./adminControls");
const UIUser = require("./UIUser");
const DFU = require('../dfutil');
const DFOptionsDialog = require('./optionsDialog');
const KeybDisplayState = require("./keybDisplayState");
const CreditsButton = require("./CreditsButton");
const SequencerMain = require("./SequencerMain");
const {InlinePitchBendCtrl, InlineMasterGainCtrl} = require('./InlinePitchBendCtrl');
const {UserSettingsButton} = require("./userSettings");
const {GoogleOAuthModule} = require('../googleSignIn');
const {GestureSplash} = require('./splash');
const {SequencerParamGroup} = require('./SequencerParamGroup');

const md = require('markdown-it')({
    html:         false,        // Enable HTML tags in source
    xhtmlOut:     false,        // Use '/' to close single tags (<br />).
    breaks:       false,        // Convert '\n' in paragraphs into <br>
    linkify:      true,        // Autoconvert URL-like text to links
    typographer:  false,
  });
 
// https://github.com/markdown-it/markdown-it/blob/master/docs/architecture.md#renderer
// this adds attribute target=_blank so links open in new tab.
// Remember old renderer, if overridden, or proxy to default renderer
var defaultRender = md.renderer.rules.link_open || function(tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };
  
  md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
    // If you are sure other plugins can't add `target` - drop check below
    var aIndex = tokens[idx].attrIndex('target');
  
    if (aIndex < 0) {
      tokens[idx].attrPush(['target', '_blank']); // add new attribute
    } else {
      tokens[idx].attrs[aIndex][1] = '_blank';    // replace value of existing attr
    }
  
    // pass token to default renderer.
    return defaultRender(tokens, idx, options, env, self);
  };
 


const gModifierKeyTracker = new DFUtils.ModifierKeyTracker();

let gStateChangeHandler = null;

let gInstActivityHandlers = {}; // key=some ID, value=a handler (instrument, note) => {}

class InstTextParam extends React.Component {
    constructor(props) {
        super(props);
        this.inpID = "textParam_" + this.props.instrument.instrumentID + "_" + this.props.param.paramID;
        this.renderedValue = "";
    }
    onChange = (e) => {
        let val = e.target.value;
        this.renderedValue = val;
        this.props.app.SetInstrumentParam(this.props.instrument, this.props.param, val);
        gStateChangeHandler.OnStateChange();
    }
    componentDidMount() {
        // set initial values.
        let val = this.props.param.rawValue;
        $("#" + this.inpID).val(val);
        this.renderedValue = val;
    }
    render() {
        if (this.renderedValue != this.props.param.rawValue) {
            //has been externally modified. update ui.
            let val = this.props.param.rawValue;
            this.renderedValue = val;
            $("#" + this.inpID).val(val);
        }

        return (
            <li className={this.props.param.cssClassName}>
                <input readOnly={this.props.observerMode} id={this.inpID} type="text" maxLength={this.props.param.maxTextLength} onChange={this.onChange} />
                <label>{this.props.param.name}</label>
            </li>
        );
    }
}


// int parameter, but rendered as buttons using enum titles
// props.instrument
class InstButtonsParam extends React.Component {
    constructor(props) {
        super(props);
        this.inputID = "buttonsparam_" + this.props.instrument.instrumentID + "_" + this.props.param.paramID;
        this.renderedValue = 0;
    }
    onClickButton = (val) => {
        if (this.props.observerMode) return;
        this.props.app.SetInstrumentParam(this.props.instrument, this.props.param, val);
        gStateChangeHandler.OnStateChange();
    };
    render() {

        if (this.props.param.enumNames.length < 1) return null;

        const buttons = (this.props.param.enumNames.map((e, val) => (
            <button className={"buttonParam " + ((this.props.param.rawValue == val) ? "active" : "")} key={val} onClick={() => this.onClickButton(val)}>{e}</button>
        )));

        return this.props.param.labelFirst ? (
            <li className={"buttonsParam " + this.props.param.cssClassName}>
                <label>{this.props.param.name}</label>
                {buttons}
            </li>

        ) : (
            <li className={"buttonsParam " + this.props.param.cssClassName}>
                {buttons}
                <label>{this.props.param.name}</label>
            </li>
        );
    }
}



// int parameter, but rendered as buttons using enum titles
// props.instrument
class InstDropdownParam extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            listShown: false
        };
    }
    onClickShown = () => {
        this.setState({ listShown: !this.state.listShown });
    }
    onClickButton = (val) => {
        if (this.props.observerMode) return;
        this.props.app.SetInstrumentParam(this.props.instrument, this.props.param, val);
        gStateChangeHandler.OnStateChange();
    };
    render() {
        const buttons = (this.props.param.enumNames.map((e, val) => (
            <li className={"item " + ((this.props.param.rawValue == val) ? "active" : "")} key={val} onClick={() => this.onClickButton(val)}>{e}</li>
        )));

        return (
            <li className={"dropdownParam " + this.props.param.cssClassName}>
                <div className="mainButton" onClick={this.onClickShown}>
                    <span className="arrow">{DFU.getArrowText(this.state.listShown)}</span>
                    <span className="currentValue">{this.props.param.enumNames[this.props.param.rawValue]}</span>
                    <label>{this.props.param.name}</label>
                </div>
                {this.state.listShown && (
                    <ul className="dropdown">
                        {buttons}
                    </ul>
                )}
            </li>
        );
    }
}








// CHECKBOX instrument
// props.instrument
class InstCbxParam extends React.Component {
    onClick = () => {
        if (this.props.observerMode) return;
        let val = !!this.props.param.rawValue;
        this.props.app.SetInstrumentParam(this.props.instrument, this.props.param, !val);
        gStateChangeHandler.OnStateChange();
    }
    render() {
        let val = !!this.props.param.rawValue;
        let className = "cbxparam " + (val ? "on " : "off ") + this.props.param.cssClassName;

        return (
            <li className={className}>
                <button onClick={this.onClick}>{this.props.param.name}</button>
            </li>
        );
    }
}






// props.instrument
class InstIntParam extends React.Component {
    constructor(props) {
        super(props);
        this.valueTextID = "val_" + this.props.instrument.instrumentID + "_" + this.props.param.paramID;
        this.sliderID = "slider_" + this.props.instrument.instrumentID + "_" + this.props.param.paramID;
        this.renderedValue = -420.69;
    }
    setCaption() {
        let cap = null;
        const p = this.props.param;
        if (p.enumNames) {
            cap = p.enumNames[this.props.param.rawValue];
        } else {
            cap = this.props.param.rawValue;
        }
        $("#" + this.valueTextID).text(cap);
    }
    onChange = (e) => {
        //this.setState(this.state);
        let val = parseInt(e.target.value);
        if (isNaN(val)) return;
        this.renderedValue = val;
        this.props.app.SetInstrumentParam(this.props.instrument, this.props.param, val);
        this.setCaption();
        gStateChangeHandler.OnStateChange();
    }
    componentDidMount() {
        // set initial values.
        let val = this.props.param.rawValue;
        $("#" + this.sliderID).val(val);
        this.setCaption();
        this.renderedValue = val;
        DFUtils.stylizeRangeInput(this.sliderID, {
            bgNegColorSpec: "#044",
            negColorSpec: "#044",
            posColorSpec: "#044",
            bgPosColorSpec: "#044",
            zeroVal: 0,
        });
    }
    render() {
        if (this.renderedValue != this.props.param.rawValue) {
            //has been externally modified. update ui.
            let val = this.props.param.rawValue;
            this.renderedValue = val;
            $("#" + this.sliderID).val(val);
            this.setCaption();
        }

        return (
            <li className={this.props.param.cssClassName}>
                <input disabled={this.props.observerMode} id={this.sliderID} className="intParam" type="range" min={this.props.param.minValue} max={this.props.param.maxValue} onChange={this.onChange}
                //value={this.props.param.rawValue} <-- setting values like this causes massive slowness
                />
                <label>{this.props.param.name}: <span id={this.valueTextID}></span></label>
            </li>
        );
    }
}

// <ParamMappingBox app={this.props.app} instrument={this.props.instrument} param={this.props.param} observerMode></ParamMappingBox>
class ParamMappingBox extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            isLearning: false,
        };
    }

    clickMidiLearn = () => {
        this.props.app.midi.learnMIDICC(cc => {
            if (cc < 0) return false;
            if (cc > 31) return false;
            // set up the mapping.
            //console.log(`setting up mapping for MIDI CC ${cc}`);
            this.props.app.createParamMappingFromSrcVal(this.props.param, cc);
            this.setState({ isLearning: false });
            gStateChangeHandler.OnStateChange();
            return true;
        });
        this.setState({ isLearning: true });
    }
    clickCancelLearning = () => {
        this.setState({ isLearning: false });
    };
    clickClearMapping = () => {
        //console.log(`clearing mapping.`);
        this.props.app.removeParamMapping(this.props.param);
        gStateChangeHandler.OnStateChange();
    }
    clickMacro = (macroIndex) => {
        this.props.app.createParamMappingFromMacro(this.props.param, macroIndex);
        this.setState({ isLearning: false });
        gStateChangeHandler.OnStateChange();
        return true;
    }
    render() {
        // is the param already mapped?
        const mappingSpec = this.props.instrument.getParamMappingSpec(this.props.param);
        const allowMacros = this.props.instrument.hasMacros();
        const createMappingBtns = !this.state.isLearning && !mappingSpec && (
            <div>
                Map to
                <button onClick={this.clickMidiLearn}>MIDI learn</button>
                {(!this.props.param.isMacro || this.props.param.macroIdx != 0) && allowMacros && <button onClick={() => this.clickMacro(0)}>{this.props.instrument.getMacroDisplayName(0)}</button>}
                {(!this.props.param.isMacro || this.props.param.macroIdx != 1) && allowMacros && <button onClick={() => this.clickMacro(1)}>{this.props.instrument.getMacroDisplayName(1)}</button>}
                {(!this.props.param.isMacro || this.props.param.macroIdx != 2) && allowMacros && <button onClick={() => this.clickMacro(2)}>{this.props.instrument.getMacroDisplayName(2)}</button>}
                {(!this.props.param.isMacro || this.props.param.macroIdx != 3) && allowMacros && <button onClick={() => this.clickMacro(3)}>{this.props.instrument.getMacroDisplayName(3)}</button>}
            </div>
        );
        const learningIndicator = this.state.isLearning && (
            <div className="learningIndicator">
                Listening for MIDI CC changes...
                <button onClick={this.clickCancelLearning}>Cancel</button>
            </div>
        );

        const effectiveRange = mappingSpec && this.props.instrument.getEffectiveMappingRange(mappingSpec);

        const activeMappingBody = !!mappingSpec && (
            <div>
                Mapped to {this.props.instrument.getMappingSrcDisplayName(mappingSpec)}
                <button onClick={this.clickClearMapping}>Clear</button>
                <ul>
                    <InstFloatParam app={this.props.app} instrument={this.props.instrument} observerMode={this.props.observerMode} param={mappingSpec.mappingRange}></InstFloatParam>
                </ul>
                Effective range: {effectiveRange[0].toFixed(3)} to {effectiveRange[1].toFixed(3)}
            </div>
        );

        return (
            <div className="paramMappingBox">
                {createMappingBtns}
                {learningIndicator}
                {activeMappingBody}
            </div>
        );
    };
}


// props.instrument
class InstFloatParam extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            isExpanded: false,
            inputTextValue: this.GetRawValue().toFixed(4),
        };
        this.valueTextInputID = "i_" + this.props.instrument.instrumentID + "_" + this.props.param.paramID;
        this.valueTextDivID = "idiv_" + this.props.instrument.instrumentID + "_" + this.props.param.paramID;
        this.valueTextID = "val_" + this.props.instrument.instrumentID + "_" + this.props.param.paramID;
        this.sliderID = "slider_" + this.props.instrument.instrumentID + "_" + this.props.param.paramID;
        this.renderedValue = -420.69;

        // create throttlers for toggling class
        this.activityThrottlers = {};
        this.props.app.roomState.instrumentCloset.forEach(i => {
            const th = new DFU.Throttler();
            th.interval = 1000.0 / 30; // fps
            const instrumentID = i.instrumentID;
            th.proc = () => {
                $('#mixerActivity_' + instrumentID).toggleClass('alt1').toggleClass('alt2');
            };
            this.activityThrottlers[i.instrumentID] = th;
        });


    }
    onChange = (e) => {
        let realVal = this.props.param.foreignToNativeValue(e.target.value, 0, DF.ClientSettings.InstrumentFloatParamDiscreteValues);

        this.renderedValue = realVal;
        this.props.app.SetInstrumentParam(null, this.props.param, realVal);
        this.setCaption(this.GetRawValue());
        this.setInputTextVal(this.GetRawValue());
        //this.setState(this.state);
        gStateChangeHandler.OnStateChange();
    }

    OnInstrumentActivity = (instrumentSpec, note) => {
        this.activityThrottlers[instrumentSpec.instrumentID].InvokeThrottled();
    };

    componentDidMount() {
        gInstActivityHandlers[this.props.instrument.instrumentID] = this.OnInstrumentActivity;
        // set initial values.
        const p = this.props.param;
        const rawValue = this.GetRawValue();
        this.renderedValue = rawValue;
        this.setSliderVal(rawValue);
        this.setCaption(rawValue);
        this.setInputTextVal(rawValue);
        if (p.cssClassName.includes("modAmtParam")) {
            DFUtils.stylizeRangeInput(this.sliderID, {
                bgNegColorSpec: "#444",
                negColorSpec: "#66c",
                posColorSpec: "#66c",
                bgPosColorSpec: "#444",
                zeroVal: this._realValToSliderVal(0),
            });
        } else {
            DFUtils.stylizeRangeInput(this.sliderID, {
                bgNegColorSpec: "#044",
                negColorSpec: "#088",
                posColorSpec: "#088",
                bgPosColorSpec: "#044",
                zeroVal: this._realValToSliderVal(0),
            });
        }
    }
    componentWillUnmount() {
        delete gInstActivityHandlers[this.props.instrument.instrumentID];
    }

    _realValToSliderVal(rv) {
        return this.props.param.nativeToForeignValue(rv, 0, DF.ClientSettings.InstrumentFloatParamDiscreteValues);
    }

    setInputTextVal(val) {
        this.setState({ inputTextValue: this.GetRawValue().toFixed(4) });
    }
    setCaption(val) {
        $("#" + this.valueTextID).text(this.GetRawValue().toFixed(3));
    }
    setSliderVal(val) {
        //const p = this.props.param;
        let currentSliderValue = this._realValToSliderVal(val);
        $("#" + this.sliderID).val(currentSliderValue);
        $("#" + this.sliderID).trigger("change");
    }

    toggleShowTxt = () => {
        if (this.props.observerMode) return;

        if (!this.state.isExpanded) {
            let q = $("#" + this.valueTextInputID);
            q.focus();
            q.select();
        }

        this.setState({ isExpanded: !this.state.isExpanded });
    }

    onChangeValInput = (e) => {
        if (this.props.observerMode) return;
        this.setState({ inputTextValue: e.target.value });
    }

    handleTextInputKeyDown = (e) => {
        if (this.props.observerMode) return;
        if (e.key != 'Enter') return;
        this.setState(this.state);
        let realVal = parseFloat(e.target.value);
        if (isNaN(realVal)) return;

        this.props.app.SetInstrumentParam(null, this.props.param, realVal);

        this.setCaption(realVal);
        this.setSliderVal(realVal);
    }

    onClickSlider = (e) => {
        if (this.props.observerMode) return;
        let a = 0;
        if (gModifierKeyTracker.CtrlKey) {
            let realVal = this.props.app.roomState.GetDefaultValueForParam(this.props.instrument, this.props.param);

            this.setState(this.state);
            this.renderedValue = realVal;
            this.props.app.SetInstrumentParam(null, this.props.param, realVal);
            this.setCaption(realVal);
            this.setInputTextVal(realVal);
            this.setSliderVal(realVal);
        }
    };

    onDoubleClickSlider = (e) => {
        if (this.props.observerMode) return;
        let realVal = this.props.app.roomState.GetDefaultValueForParam(this.props.instrument, this.props.param);

        this.setState(this.state);
        this.renderedValue = realVal;
        this.props.app.SetInstrumentParam(null, this.props.param, realVal);
        this.setCaption(realVal);
        this.setInputTextVal(realVal);
        this.setSliderVal(realVal);
    };

    GetParamDisplayName() {
        return this.props.instrument.getParamDisplayName(this.props.param);
    }

    onMacroNameTextChanged = (txt) => {
        this.props.app.setMacroDisplayName(this.props.param.macroIdx, txt);
        this.setState({});
    }

    GetRawValue() {
        const p =this.GetLinkedParam();
        return isNaN(p.rawValue) ? 0 : p.rawValue; // coalesce to avoid crashes in case of bad state
    }

    GetLinkedParam() {
        return this.props.app.roomState.GetLinkedParam(this.props.instrument, this.props.param);
    }

    render() {
        const rawValue = this.GetRawValue();
        if (this.renderedValue != rawValue) {
            //has been externally modified. update ui.
            let val = rawValue;
            this.renderedValue = val;
            this.setSliderVal(val);//$("#" + this.sliderID).val(val);
            this.setCaption(val);
        }

        const mappingSpec = this.props.instrument.getParamMappingSpec(this.props.param);
        let cssclass = "floatParam ";
        if (!!mappingSpec) cssclass += "hasMapping ";
        if (this.state.isExpanded) cssclass += "expanded ";

        let macroMappingList = null;
        if (/*this.state.isExpanded &&*/ this.props.param.isMacro) {
            const mappedParams = this.props.instrument.getMappingSpecsForMacro(this.props.param.macroIdx);
            macroMappingList = (<ul className="macroMappingList">
                {mappedParams.map(spec => {
                    const effectiveRange = this.props.instrument.getEffectiveMappingRange(spec);
                    return (
                        <li key={spec.param.paramID}>
                            {this.props.instrument.getParamDisplayName(spec.param)} ({effectiveRange[0].toFixed(2)} to {effectiveRange[1].toFixed(2)})
                            <div className="mappedLiveValue">{spec.param.currentValue.toFixed(2)}</div>
                        </li>
                    )
                }
                )}
            </ul>);
        }

        let isReadOnly = this.props.observerMode;

        let instActivity = null; // who is controlling the inst
        let instLiveActivity = null; // animated activity
        if (this.props.param.showLinkedInstrumentActivity) {
            if (this.props.param.sourceInstrumentID) {
                let sourceInst = this.props.app.roomState.FindInstrumentById(this.props.param.sourceInstrumentID).instrument;
                let inUse = !!sourceInst.controlledByUserID;
                //let idle = false;
                if (inUse) {
                    let foundUser = this.props.app.roomState.FindUserByID(sourceInst.controlledByUserID);
                    if (foundUser) {
                        instActivity = (<span className="instControlledBy"><span style={{ color: foundUser.user.color }}>{foundUser.user.name}</span></span>);
                        instLiveActivity = (<span className="instActivity alt1" id={"mixerActivity_" + sourceInst.instrumentID}></span>);
                    }
                }
            }
            if (!instActivity) {
                instActivity = (<span className="instControlledBy empty"></span>);
            }
            if (!instLiveActivity) {
                instLiveActivity = (<span className="instActivity empty"></span>);
            }
        }


        return (
            <li className={cssclass + this.props.param.cssClassName}>
                <input id={this.sliderID} disabled={isReadOnly} className="floatParam" type="range" onClick={this.onClickSlider}
                    onDoubleClick={this.onDoubleClickSlider} min={0} max={DF.ClientSettings.InstrumentFloatParamDiscreteValues}
                    onChange={this.onChange}
                    ref={i => { this.sliderRef = i; }}
                //value={Math.trunc(rawValue)} <-- setting values like this causes massive slowness
                />
                <label onClick={this.toggleShowTxt}>
                    <div className="paramValueName">
                        <span className={"paramValueName " + (isReadOnly ? "readonly" : "")}>{this.GetParamDisplayName()}:</span>
                        {instLiveActivity}
                    </div>
                    <div className="paramValueLabel">
                        <span id={this.valueTextID}></span>
                        {mappingSpec && (
                            <div className="mappedLiveValue">{this.GetLinkedParam().currentValue.toFixed(2)}</div>
                        )}
                        {instActivity}
                    </div>
                </label>

                {macroMappingList}
                { this.state.isExpanded && <div id={this.valueTextDivID}>
                    <input type="text" id={this.valueTextInputID} readOnly={isReadOnly} value={this.state.inputTextValue} onChange={this.onChangeValInput} onKeyDown={this.handleTextInputKeyDown} />
                    <label>Value</label>
                    {this.props.param.isMacro &&
                        <div className="macroNameInput">
                            <DFReactUtils.TextInputFieldExternalState onChange={this.onMacroNameTextChanged} value={this.props.instrument.getMacroDisplayName(this.props.param.macroIdx)}></DFReactUtils.TextInputFieldExternalState>
                            <label>Macro name</label>
                        </div>
                    }
                    {!this.props.observerMode && this.props.param.supportsMapping &&
                        <ParamMappingBox app={this.props.app} instrument={this.props.instrument} param={this.props.param} observerMode={this.props.observerMode}></ParamMappingBox>
                    }
                </div>
                }
            </li>
        );
    }
}






class InstrumentPreset extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            showingOverwriteConfirmation: false,
            showingDeleteConfirmation: false,
        };
    }
    onClickLoad = () => {
        this.props.app.loadPatchObj(this.props.presetObj, true);
        gStateChangeHandler.OnStateChange();
    }
    onClickOverwrite = () => {
        this.props.app.saveOverwriteExistingPreset(this.props.presetObj.presetID);
        this.setState({ showingOverwriteConfirmation: false });
    }
    onBeginOverwrite = () => {
        this.setState({ showingOverwriteConfirmation: true });
    };
    onCancelOverwrite = () => {
        this.setState({ showingOverwriteConfirmation: false });
    }

    onClickDelete = () => {
        this.props.app.deletePreset(this.props.presetObj);
        this.setState({ showingDeleteConfirmation: false });
    }
    onBeginDelete = () => {
        this.setState({ showingDeleteConfirmation: true });
    }
    onCancelDelete = () => {
        this.setState({ showingDeleteConfirmation: false });
    }


    render() {
        const canWrite = !this.props.observerMode && (!this.props.presetObj.isReadOnly || this.props.app.myUser.IsAdmin());

        let dt = this.props.presetObj.savedDate;
        if (dt) {
            dt = new Date(dt);
        }
        let tags = null;
        if (this.props.presetObj.tags && this.props.presetObj.tags.length > 0) {
            tags = this.props.presetObj.tags;
        }
        let description = null;
        if (this.props.presetObj.description && this.props.presetObj.description.length > 0) {
            description = this.props.presetObj.description;
        }
        return (
            <li key={this.props.presetObj.patchName}>
                <div className="buttonContainer">
                    {!this.props.observerMode && <button onClick={() => this.onClickLoad()}><i className="material-icons">file_open</i>Load</button>}
                    {canWrite && <button onClick={this.onBeginOverwrite}><i className="material-icons">save</i>Save</button>}
                    {canWrite && <button onClick={this.onBeginDelete}><i className="material-icons">delete</i>Delete</button>}
                </div>
                <span className="presetName">{this.props.presetObj.patchName}</span>
                {
                    description &&
                    <span className="description">{description}</span>
                }
                <div className="authorAndDateBox">
                    <span className="author">by {this.props.presetObj.author}</span>
                    {
                        false && tags &&
                        <span className="tags">tags: {tags}</span>
                    }
                    {
                        dt &&
                        <span className="savedDate">{dt.toLocaleString()}</span>
                    }
                </div>
                {this.state.showingOverwriteConfirmation &&
                    <div className="confirmationBox">
                        Click 'OK' to overwrite "{this.props.presetObj.patchName}" with the live patch
                    <br />
                        <button className="OK" onClick={this.onClickOverwrite}>OK</button>
                        <button className="Cancel" onClick={this.onCancelOverwrite}>Cancel</button>
                    </div>
                }
                {this.state.showingDeleteConfirmation &&
                    <div className="confirmationBox">
                        Click 'OK' to delete "{this.props.presetObj.patchName}".
                    <br />
                        <button className="OK" onClick={this.onClickDelete}>OK</button>
                        <button className="Cancel" onClick={this.onCancelDelete}>Cancel</button>
                    </div>
                }

            </li>
        );
    }
};




class InstrumentPresetList extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            filterTxt: "",
        };
    }

    onFilterChange = (txt) => {
        this.setState({ filterTxt: txt });
    };

    presetMatches(p, txt) {
        let keys = txt.toLowerCase().split(" ");
        keys = keys.map(k => k.trim());
        keys = keys.filter(k => k.length > 0);
        if (keys.length < 1) return true;
        let ret = false;
        if (keys.some(k => p.patchName.toLowerCase().includes(k))) return true;
        if (!p.tags) return false;
        return keys.some(k => p.tags.toLowerCase().includes(k));
    }

    onClickInitPreset = () => {
        this.props.app.loadInitPatch();
        gStateChangeHandler.OnStateChange();
    }

    render() {
        const bank = this.props.app.roomState.GetPresetBankForInstrument(this.props.instrument);
        const lis = bank.presets.filter(p => this.presetMatches(p, this.state.filterTxt)).map(preset => (
            <InstrumentPreset observerMode={this.props.observerMode} key={preset.presetID} app={this.props.app} presetObj={preset}></InstrumentPreset>
        ));
        return (
            <div className="presetList">
                Presets
                <div className="presetFilter"><i className="material-icons">search</i><DFReactUtils.TextInputFieldExternalState onChange={this.onFilterChange} value={this.state.filterTxt}></DFReactUtils.TextInputFieldExternalState></div>
                <ul>


                    <li>
                        <div className="buttonContainer">
                            {!this.props.observerMode && <button onClick={this.onClickInitPreset}><i className="material-icons">file_open</i>Load</button>}
                        </div>
                        <span className="presetName">init</span>
                    </li>



                    {lis}
                </ul>
            </div>
        );
    }
};

// key={cc} app={this.props.app} instrument={this.props.instrument} observerMode={this.props.observerMode} cc={cc} />
class MidiCCMappingInfo extends React.Component {
    render() {
        let mappingList = null;
        const mappedParams = this.props.instrument.getMappingSpecsForMidiCC(this.props.cc);
        mappingList = (<ul className="midiCCmappingList">
            {mappedParams.map(spec => {
                const effectiveRange = this.props.instrument.getEffectiveMappingRange(spec);
                return (
                    <li key={spec.param.paramID}>
                        → {this.props.instrument.getParamDisplayName(spec.param)} ({effectiveRange[0].toFixed(2)} to {effectiveRange[1].toFixed(2)})
                        ↠ <div className="mappedLiveValue">{spec.param.currentValue.toFixed(2)}</div>
                    </li>
                )
            }
            )}
        </ul>);

        return (
            <li>
                MIDI CC #{this.props.cc}
                {mappingList}
            </li>);
    }
};

// props.groupSpec
// props.app
// props.filteredParams
class InstrumentParamGroup extends React.Component {

    clickCopyToOsc(destOscIndex) {
        const patchObj = this.props.instrument.getPatchObjectToCopyOscillatorParams(this.props.groupSpec.oscillatorSource, destOscIndex);
        this.props.app.loadPatchObj(patchObj, false);
        gStateChangeHandler.OnStateChange();
    };

    render() {
        const arrowText = DFU.getArrowText(this.props.isShown)

        let createParam = (p) => {
            if (p.hidden) return null;

            switch (p.parameterType) {
                case DF.InstrumentParamType.intParam:
                    if (p.renderAs == "buttons") {
                        return (<InstButtonsParam key={p.paramID} app={this.props.app} instrument={this.props.instrument} observerMode={this.props.observerMode} param={p}></InstButtonsParam>);
                    } else if (p.renderAs == "dropdown") {
                        return (<InstDropdownParam key={p.paramID} app={this.props.app} instrument={this.props.instrument} observerMode={this.props.observerMode} param={p}></InstDropdownParam>);
                    } else {
                        return (<InstIntParam key={p.paramID} app={this.props.app} instrument={this.props.instrument} observerMode={this.props.observerMode} param={p}></InstIntParam>);
                    }
                case DF.InstrumentParamType.floatParam:
                    return (<InstFloatParam key={p.paramID} app={this.props.app} instrument={this.props.instrument} observerMode={this.props.observerMode} param={p}></InstFloatParam>);
                case DF.InstrumentParamType.textParam:
                    return (<InstTextParam key={p.paramID} app={this.props.app} instrument={this.props.instrument} observerMode={this.props.observerMode} param={p}></InstTextParam>);
                case DF.InstrumentParamType.cbxParam:
                    return (<InstCbxParam key={p.paramID} app={this.props.app} instrument={this.props.instrument} observerMode={this.props.observerMode} param={p}></InstCbxParam>);
                case DF.InstrumentParamType.inlineLabel:
                    return (<li key={p.paramID} className="inlineLabel">{p.inlineLabel}</li>);
            }
        };

        if (!this.props.groupSpec.shown) return null;
        let className = "instParamGroup " + this.props.groupSpec.cssClassName;

        let groupControls = this.props.groupSpec.groupControls === "osc" && !this.props.observerMode && (
            <div className="groupControls">
                {this.props.groupSpec.oscillatorDestinations.map(destOscIndex => (
                    <button key={destOscIndex} onClick={() => this.clickCopyToOsc(destOscIndex)}>Copy to OSC {["A", "B", "C", "D"][destOscIndex]}</button>
                ))}
            </div>
        );

        let midiCClist = null;
        if (this.props.isShown && this.props.groupSpec.isMacroGroup) {
            // show a list of mapped midi CCs.
            const ccs = this.props.instrument.getMappedMidiCCs();
            midiCClist = (<ul className="midiCCList">
                {ccs.map(cc => (
                    <MidiCCMappingInfo key={"cc" + cc} app={this.props.app} instrument={this.props.instrument} observerMode={this.props.observerMode} cc={cc} />
                ))}
            </ul>)
        }

        return (
            <fieldset key={this.props.groupSpec.displayName} className={className}>
                <legend onClick={() => this.props.onToggleShown()}>{arrowText} {this.props.groupSpec.displayName} <span className="instParamGroupNameAnnotation">{this.props.groupSpec.annotation}</span></legend>
                {this.props.isShown &&
                    <ul className="instParamList">
                        {groupControls}
                        {this.props.filteredParams.filter(p => p.groupName == this.props.groupSpec.internalName).map(p => createParam(p))}
                    </ul>
                }
                {midiCClist}
            </fieldset>
        );
    }
};


class InstrumentParams extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            presetListShown: false,
            filterTxt: "",
            isShown: true,
            shownGroupNames: [],
            showingAllGroups: false,
            showingFactoryResetConfirmation: false,
            showingClipboardControls: false,
            showingOverwriteConfirmation: false,
        };
        this.state.shownGroupNames = this.props.instrument.GetDefaultShownGroupsForInstrument();
    }


    onOpenClicked = () => {
        this.setState({ presetListShown: !this.state.presetListShown });
    };

    onExportClicked = () => {
        let presetObj = this.props.instrument.exportPatchObj();
        let txt = JSON.stringify(presetObj, null, 2);
        navigator.clipboard.writeText(txt).then(() => {
            alert('Patch was copied to the clipboard.')
        }, () => {
            alert('Unable to copy patch.')
        });
    };

    onImportClicked = () => {
        navigator.clipboard.readText().then(text => {
            try {
                let presetObj = JSON.parse(text);
                this.props.app.loadPatchObj(presetObj, true);
                gStateChangeHandler.OnStateChange();
            } catch (e) {
                alert(`Unable to import; probably badly formatted text... Exception: ${e}`);
            }
        })
            .catch(err => {
                alert('Unable to read clipboard');
            });
    };

    onReleaseClick = () => {
        this.props.app.ReleaseInstrument();
    };

    onFilterChange = (txt) => {
        this.setState({ filterTxt: txt });
        this.showAllGroups();
    };

    showAllGroups = () => {
        this.setState({ showingAllGroups: true });
    };

    onToggleShownClick = (e) => {
        if (e.target.id != "showInstrumentPanel") {
            return; // ignore clicks on children; only accept direct clicks.
        }
        this.setState({ isShown: !this.state.isShown });
    };

    clickFocusGroupName(groupName) {
        if (!this.state.showingAllGroups && this.isGroupNameShown(groupName) && this.state.shownGroupNames.length == 1) {
            // if you click on a showing group name and there are others shown, focus it.
            // if you click on a showing group name it's the only one shown, then hide all.
            this.setState({ shownGroupNames: [], showingAllGroups: false });
            return;
        }
        this.setState({ shownGroupNames: [groupName], showingAllGroups: false });
    };

    clickPresetFocusButton = () => {
        this.setState({ presetListShown: !this.state.presetListShown });
    };


    onToggleGroupShown(groupName) {
        if (this.isGroupNameShown(groupName)) {
            let x = this.state.shownGroupNames.filter(gn => gn != groupName);
            this.setState({ shownGroupNames: x, showingAllGroups: false });
            return;
        }

        this.state.shownGroupNames.push(groupName);
        this.setState({ shownGroupNames: this.state.shownGroupNames, showingAllGroups: false });
        return;
    };

    clickAllGroup = () => {
        if (this.state.showingAllGroups) {
            // then show NONE.
            this.setState({ shownGroupNames: [] });
        }
        this.setState({ showingAllGroups: !this.state.showingAllGroups });
    }

    isGroupNameShown(groupName) {
        return this.state.showingAllGroups || this.state.shownGroupNames.some(gn => gn == groupName);
    }

    onPanicClick = () => {
        this.props.app.MIDI_AllNotesOff();
    };

    onExportBankClicked = () => {
        let txt = this.props.app.roomState.exportAllPresetsJSON(this.props.instrument);
        navigator.clipboard.writeText(txt).then(() => {
            alert('Bank was copied to the clipboard.')
        }, () => {
            alert('Unable to copy bank.')
        });
    };

    onSaveNewPreset = () => {
        this.props.app.savePatchAsNewPreset();
    }

    onFactoryReset = () => {
        this.props.app.factoryResetInstrument();
        this.setState({ showingFactoryResetConfirmation: false });
    }
    onBeginFactoryReset = () => {
        this.setState({ showingFactoryResetConfirmation: true });
    }
    cancelFactoryReset = () => {
        this.setState({ showingFactoryResetConfirmation: false });
    }

    onSaveAsExistingPreset = () => {
        this.props.app.saveLoadedPreset();
        this.setState({ showingOverwriteConfirmation: false });
    }
    onBeginOverwrite = () => {
        this.setState({ showingOverwriteConfirmation: true });
    };
    onCancelOverwrite = () => {
        this.setState({ showingOverwriteConfirmation: false });
    }



    onImportBankClicked = () => {
        navigator.clipboard.readText().then(text => {
            //console.log('Pasted content: ', text);
            try {
                this.props.app.mergePresetBankJSON(text);
                gStateChangeHandler.OnStateChange();
            } catch (e) {
                alert(`Unable to import; probably badly formatted text... Exception: ${e}`);
            }
        })
            .catch(err => {
                alert('Unable to read clipboard');
            });
    };

    onClipboardShownClick = () => {
        this.setState({ showingClipboardControls: !this.state.showingClipboardControls });
    }

    render() {
        const arrowText = this.state.presetListShown ? '⯆' : '⯈';

        let presetList = this.state.presetListShown && (
            <InstrumentPresetList observerMode={this.props.observerMode} instrument={this.props.instrument} app={this.props.app}></InstrumentPresetList>
        );

        let filterTxt = this.state.filterTxt.toLowerCase();
        let filteredParams = this.props.instrument.GetDisplayableParamList(filterTxt);

        // unique group names.
        let _groupNames = [...new Set(filteredParams.map(p => p.groupName))];
        _groupNames = _groupNames.filter(gn => filteredParams.find(p => p.groupName == gn && !p.hidden));

        let groupSpecs = _groupNames.map(gn => this.props.instrument.getGroupInfo(gn));
        groupSpecs = groupSpecs.filter(gs => gs.shown);

        const instrumentSupportsPresets = this.props.instrument.supportsPresets;

        const presetsFocusButton = instrumentSupportsPresets && (
            <button className={this.state.presetListShown ? "active paramGroupFocusBtn" : "paramGroupFocusBtn"} onClick={this.clickPresetFocusButton}>Presets</button>
        );

        const groupFocusButtons = groupSpecs.map(gs => (
            <button key={gs.internalName} className={this.isGroupNameShown(gs.internalName) ? "active paramGroupFocusBtn" : "paramGroupFocusBtn"} onClick={() => this.clickFocusGroupName(gs.internalName)}>{gs.displayName}</button>
        ));

        let groups = groupSpecs.map(gs => (<InstrumentParamGroup
            key={gs.internalName}
            groupSpec={gs}
            app={this.props.app}
            instrument={this.props.instrument}
            observerMode={this.props.observerMode}
            isShown={this.isGroupNameShown(gs.internalName)}
            onToggleShown={() => this.onToggleGroupShown(gs.internalName)}
            filteredParams={filteredParams}
        />));

        const shownStyle = this.state.isShown ? { display: 'block' } : { display: "none" };
        const mainArrowText = this.state.isShown ? '⯆' : '⯈';

        let presetID = this.props.instrument.GetParamByID("presetID").rawValue;
        let writableExistingPreset = null;
        if (presetID) {
            const bank = this.props.app.roomState.GetPresetBankForInstrument(this.props.instrument);

            writableExistingPreset = bank.presets.find(p => {
                const canWrite = this.props.app.myUser.IsAdmin() || !p.isReadOnly;
                return canWrite && p.presetID == presetID
            });
        }


        const groupFocusButtonStuff = this.state.isShown && ((groupSpecs.length > 1) || (this.state.filterTxt.length > 0)) && (
            <div className="paramGroupCtrl">
                <fieldset className="groupFocusButtons">
                    <legend>Param groups</legend>
                    <button className={this.state.showingAllGroups ? "active paramGroupFocusBtn" : "paramGroupFocusBtn"} onClick={() => this.clickAllGroup()}>All</button>
                    {presetsFocusButton}
                    {groupFocusButtons}
                    <div className="paramFilter">Param filter<i className="material-icons">search</i><DFReactUtils.TextInputFieldExternalState onChange={this.onFilterChange} value={this.state.filterTxt}></DFReactUtils.TextInputFieldExternalState></div>
                </fieldset>
            </div>
        );

        const allowFactoryReset = this.props.app.myUser.IsAdmin();

        //let progPercent = Math.trunc(this.props.instrument.loadProgress * 100);
        const progPercent = !!this.props.instrument.loadProgress ? this.props.instrument.loadProgress.ProgressPercent() : 0;
        //progPercent = 82;
        const loadingIndicator = (
            <div className={"instrumentLoadingIndicator " + ((progPercent <= 0 || progPercent >= 100) ? "hidden" : "")}>
                <div className="doneSegment" style={{ width: `${progPercent}%` }}>
                    {progPercent}%
                    </div>
            </div>);

        return (
            <div className="component">
                <h2 id="showInstrumentPanel" style={{ cursor: 'pointer' }} onClick={this.onToggleShownClick}>
                    {mainArrowText}
                    {this.props.instrument.getDisplayName()}
                    <div className="buttonContainer">
                        <button onClick={this.props.toggleWideMode}>{this.props.isWideMode ? "⯈ Narrow" : "⯇ Wide"}</button>
                        {/* {!this.props.observerMode && <button onClick={this.onPanicClick}>Panic</button>} */}
                        {!this.props.observerMode && <button onClick={this.onReleaseClick}>Release</button>}
                        {!!this.props.observerMode && <button onClick={() => { gStateChangeHandler.observingInstrument = null; }}>Stop Observing</button>}
                    </div>
                </h2>
                <div style={shownStyle}>
                    {groupFocusButtonStuff}

                    {loadingIndicator}

                    {instrumentSupportsPresets &&
                        <fieldset className="instParamGroup presetsGroup">
                            <legend onClick={this.onOpenClicked}>{arrowText} Presets</legend>
                            {this.state.presetListShown && (
                                <ul className="instParamList">
                                    <InstTextParam key="patchName" observerMode={this.props.observerMode} app={this.props.app} instrument={this.props.instrument} param={this.props.instrument.GetParamByID("patchName")}></InstTextParam>
                                    <InstTextParam key="patchDescription" observerMode={this.props.observerMode} app={this.props.app} instrument={this.props.instrument} param={this.props.instrument.GetParamByID("description")}></InstTextParam>
                                    <InstTextParam key="patchTags" observerMode={this.props.observerMode} app={this.props.app} instrument={this.props.instrument} param={this.props.instrument.GetParamByID("tags")}></InstTextParam>
                                    {!this.props.observerMode && <li className="instPresetButtons">
                                        {writableExistingPreset && <button onClick={this.onBeginOverwrite}><i className="material-icons">save</i> Overwrite "{writableExistingPreset.patchName}"</button>}

                                        {this.state.showingOverwriteConfirmation &&
                                            <div className="confirmationBox">
                                                Click 'OK' to overwrite "{writableExistingPreset.patchName}" with a patch named "{this.props.instrument.GetParamByID("patchName").currentValue}"<br />
                                                <button className="OK" onClick={this.onSaveAsExistingPreset}>OK</button>
                                                <button className="Cancel" onClick={this.onCancelOverwrite}>Cancel</button>
                                            </div>
                                        }


                                        <button onClick={this.onSaveNewPreset}><i className="material-icons">save</i> Save as new preset "{this.props.instrument.GetParamByID("patchName").currentValue}"</button>
                                        {allowFactoryReset && <button onClick={this.onBeginFactoryReset}><i className="material-icons">dangerous</i> Factory reset</button>}
                                        {this.state.showingFactoryResetConfirmation &&
                                            <div className="confirmationBox">
                                                Click OK to reset all presets to factory defaults. It applies only to this instrument.
                                        <br />
                                                <button className="ok" onClick={this.onFactoryReset}>OK</button>
                                                <button className="cancel" onClick={this.cancelFactoryReset}>Cancel</button>
                                            </div>
                                        }
                                    </li>}

                                    <li className="instPresetButtons">
                                        <fieldset className="clipboardControls">
                                            <legend onClick={this.onClipboardShownClick}>{DFU.getArrowText(this.state.showingClipboardControls)} Clipboard</legend>
                                            {this.state.showingClipboardControls && (
                                                <div>
                                                    <button onClick={this.onExportClicked}><i className="material-icons">content_copy</i>Copy current patch to clipboard</button>
                                                    { !this.props.observerMode && <button onClick={this.onImportClicked}><i className="material-icons">content_paste</i>Paste current patch from clipboard</button>}<br />
                                                    {/* <button onClick={this.onExportBankClicked}>Export preset bank to clipboard</button> */}
                                                    {/* !this.props.observerMode && <button onClick={this.onImportBankClicked}>Import preset bank from clipboard</button>*/}<br />
                                                </div>
                                            )}
                                        </fieldset>
                                    </li>

                                    {presetList}

                                </ul>)}

                        </fieldset>
                    /* instrumentSupportsPresets */}
                    <SequencerParamGroup app={this.props.app} sequencerShown={this.props.sequencerShown} setSequencerShown={this.props.setSequencerShown} instrument={this.props.instrument} observerMode={this.props.observerMode}></SequencerParamGroup>
                    {groups}
                </div>
            </div>
        );
    }
}









// props
// - app
// - displayhelper
class CheerControls extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            text: '✨'
        };
        if (window.localStorage.getItem(DFReactUtils.getRoomID(this.props.app) + "_cheerText")) {
            this.state.text = window.localStorage.getItem(DFReactUtils.getRoomID(this.props.app) + "_cheerText");
        }
        this.mouseIn = false;
        this.mouseDown = false;
        this.timerRunning = false;
        //this.mousePos = { x: 0, y: 0 }; // track this on mouse move.
        console.assert(this.props.displayHelper);
    }

    // there are really 2 mouse states we have to track:
    // - mouse inside the element? this is done with mouseenter and mouseleave
    // - mouse button pressed? this is done with mousedown, mouseup, but you can for example mousedown, leave the element, and re-enter, and we need to know whether you released the button or not.
    //   so this also needs help from mouseenter/leave.

    // the timer continues to fire when both mouse button is down and mouse is inside.

    onTimeout = () => {
        if (!this.props.app || !this.props.app.roomState) {
            this.timerRunning = false;
            return null;
        }

        // perform cheer
        this.props.app.SendCheer(this.state.text, this.props.app.myUser.position.x, this.props.app.myUser.position.y);

        // while allowing, continue timer
        if (this.mouseIn && this.mouseDown) {
            setTimeout(() => { this.onTimeout() }, DF.ClientSettings.MinCheerIntervalMS);
        } else {
            this.timerRunning = false;
        }
    };

    onMouseDown = (e) => {
        this.mouseIn = true;
        this.mouseDown = true; // any time you enter, just assume mouse is released.

        // do initial cheer,
        this.props.app.SendCheer(this.state.text, this.props.app.myUser.position.x, this.props.app.myUser.position.y);

        if (!this.timerRunning) {
            setTimeout(() => { this.onTimeout() }, DF.ClientSettings.MinCheerIntervalMS);
        }
    };

    onMouseUp = (e) => {
        this.mouseDown = false; // this will stop the timer, if it was started.
    };

    onMouseEnter = (e) => {
        this.mouseIn = true;
        this.mouseDown = false; // any time you enter, just assume mouse is released.
    };

    onMouseLeave = (e) => {
        this.mouseIn = false;
        this.mouseDown = false;
    };

    render() {
        // onClick={() => this.props.handleCheerClick(this.state.text)}
        if (!this.props.app || !this.props.app.roomState) return null;
        return (
            <div id="cheerControl">
                <div id="cheerButton" className="cheerButton" onMouseDown={this.onMouseDown} onMouseUp={this.onMouseUp} onMouseEnter={this.onMouseEnter} onMouseLeave={this.onMouseLeave} >cheer</div>
                <DFReactUtils.TextInputFieldExternalState
                    value={this.state.text}
                    onChange={(val) => {
                        window.localStorage.setItem(DFReactUtils.getRoomID(this.props.app) + "_cheerText", val);
                        this.setState({ text: val });
                    }}
                />
            </div>
        );
    }
}




class UserList extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            showingAllOfflineUsers: false,
        };
    }
    render() {
        if (!this.props.app || !this.props.app.roomState) {
            return null;
        }

        const room = this.props.app?.rooms?.find(r => r.roomID == this.props.app.roomState.roomID);

        const onlineUsers = room?.users?.filter(u => u.presence === DF.eUserPresence.Online);
        const offlineUsers = room?.users?.filter(u => u.presence !== DF.eUserPresence.Online);

        const onlineUsersR = onlineUsers?.map(u => (
                <li className='userRow' key={u.userID}>
                    <span className='presenceIndicator'>•</span>
                    <UIUser.UIUserName user={u} />
                    <span className="userPing"> ({u.pingMS}ms ping)</span>
                </li>
            ));

        let offlineUsersR = offlineUsers;
        let totalOfflineUserCount = offlineUsersR?.length || 0;
        let areThereManyOfflineUsers = totalOfflineUserCount > DF.ClientSettings.OfflineUserListLimit;
        if (DF.ClientSettings.OfflineUserListLimit && !this.state.showingAllOfflineUsers) {
            offlineUsersR = offlineUsersR?.slice(0, DF.ClientSettings.OfflineUserListLimit);
        }
        offlineUsersR = offlineUsersR?.map(u => (
                <li className='userRow' key={u.userID}>
                    <span className='presenceIndicator'>•</span>
                    <UIUser.UIUserName user={u} />
                </li>
            ));
        let shownOfflineUserCount = offlineUsersR?.length || 0;

        return (
            <div className="component userList">
                <h2><span className="roomName">{this.props.app.roomState.roomTitle}</span>
                    {room &&
                        <span className="roomHeaderStats">
                            [
                            <span className="userCount">{onlineUsers?.length}</span>/
                            <span className="userCount">{room.users?.length}</span>
                            ] ♫<span className="noteOns">{room?.stats.noteOns}</span></span>
                    }
                </h2>
                <ul className="userList onlineUserList">
                {onlineUsersR}
                </ul>
                <ul className="userList offlineUserList">
                {offlineUsersR}
                {!this.state.showingAllOfflineUsers && (totalOfflineUserCount > shownOfflineUserCount) &&
                                <li><span onClick={() => { this.setState({showingAllOfflineUsers : true}) }} className="moreOfflineUserIndicator">(... {totalOfflineUserCount - shownOfflineUserCount} more)</span></li>
                }
                {this.state.showingAllOfflineUsers && areThereManyOfflineUsers &&
                                <li><span onClick={() => { this.setState({showingAllOfflineUsers : false}) }} className="lessOfflineUserIndicator">(show fewer)</span></li>
                }
                </ul>
            </div>
        );
    }
}

class WorldStatus extends React.Component {
    render() {
        if (!this.props.app || !this.props.app.roomState || !this.props.app.rooms) {
            return null;
        }

        const rooms = this.props.app.rooms.filter(r => r.roomID != this.props.app.roomState.roomID && !r.isPrivate);

        let userList = (room) => room.users
            .filter(u => u.source === DF.eUserSource.SevenJam) // there's really not much use in showing external users here.
            .map(u => (
                <li key={u.userID}><span className='presenceIndicator'>•</span><span className="userName" style={{ color: u.color }}>{u.name}</span><span className="userPing"> ({u.pingMS}ms ping)</span></li>
            ));

        const roomsMarkup = rooms.map(room => (
            <dl className="room" key={room.roomName}>
                {/* <dt className="roomStats"> */}
                <dt><span className="roomName">{room.roomName}</span> [<span className="userCount">{room.users.filter(u=>u.presence === DF.eUserPresence.Online).length}</span>/<span className="userCount">{room.users.length}</span>] ♫<span className="noteOns">{room.stats.noteOns}</span></dt>
                {room.users.length > 0 &&
                    <dd>
                        <ul className="otherRoomUserList">{userList(room)}</ul>
                    </dd>}
            </dl>
        ));

        return (
            <div className="component worldStatus">
                <h2>Other rooms</h2>
                {roomsMarkup}
            </div>
        );
    }
}


class Instrument extends  React.Component {
    constructor(props) {
        super(props);
        this.state = {
        };
    }

    observeInstrument(instrument) {
        this.props.app.ReleaseInstrument();
        gStateChangeHandler.observingInstrument = instrument;
    }

    stopObserving() {
        gStateChangeHandler.observingInstrument = null;
    }

    OnBigClickPlay() {
        this.stopObserving();
        this.props.app.RequestInstrument(this.props.instrument.instrumentID);
        this.setState({});
    }

    OnBigClickRelease() {
        this.props.app.ReleaseInstrument();
    }

    clickSequencerIndicator() {
        const app = this.props.app;
        const i = this.props.instrument;
        const hasMIDIDevices = app.midi.AnyMidiDevicesAvailable();
        if (!i.CanSequencerBeStartStoppedByUser(app.roomState, app.myUser, hasMIDIDevices))
            return;
        this.props.app.SeqPlayStop(!i.sequencerDevice.isPlaying, i.instrumentID);
    }

    render() {
        const app = this.props.app;
        const i = this.props.instrument;

        const inUse = i.IsInUse();
        const isYours = (i.controlledByUserID == app.myUser.userID);
        const hasMIDIDevices = app.midi.AnyMidiDevicesAvailable();
        const takeable = i.IsTakeable(app.roomState, hasMIDIDevices);

        let ownedBy = null;
        if (inUse) {
            let foundUser = this.props.app.roomState.FindUserByID(i.controlledByUserID);
            if (foundUser) {
                ownedBy = (<span className="takenBy">(<span style={{ color: foundUser.user.color }}>{foundUser.user.name}</span>)</span>);
                //idle = foundUser.user.idle;// user is taken, but considered idle. so we can show it.
            }
        }

        let loadIndicator = null;
        if (i.loadProgress > 0 && i.loadProgress < 1) {
            loadIndicator = (<span className="instrumentLoadingIndicator">{Math.trunc(i.loadProgress * 100)}%</span>);
        }

        let playBtn = takeable && (
            <button onClick={() => this.OnClickInstrument(i)}>play</button>
        );

        let releaseBtn = isYours && (
            <button className="release" onClick={() => this.props.app.ReleaseInstrument()}>release</button>
        );

        const isYourObserving = gStateChangeHandler.observingInstrument && gStateChangeHandler.observingInstrument.instrumentID == i.instrumentID;

        const isSequencerOn = i.sequencerDevice.isPlaying;
        const canCtrlSequencer = i.CanSequencerBeStartStoppedByUser(app.roomState, app.myUser, hasMIDIDevices);
        const sequencerHasData = i.sequencerDevice.HasData();
        const sequencerCtrl = (
            <div className={"seqCtrlContainer" + (isSequencerOn ? " on" : (sequencerHasData ? " off" : " empty")) + (canCtrlSequencer ? " clickable" : "")}
                title={"Sequencer activity"}
                onClick={() => this.clickSequencerIndicator()}
                >
                <div className='seqIndicator'></div>
            </div>
        );

        const observeBtn = !isYourObserving && !isYours && i.supportsObservation && inUse && (
            <button className="observe" onClick={() => this.observeInstrument(i)}>observe</button>
        );

        const stopObservingBtn = isYourObserving && (<button className="stopObserving" onClick={() => this.stopObserving()}>stop obs</button>);

        const idle = i.IsIdle(app.roomState) && (<span className="idleIndicator">(Idle)</span>);

        // several buttons are possible
        // - take or release
        // - observe or stop observing
        //
        // when only take is available, allow clicking.
        let bigClickHandler = () => {};
        let allowBigClick = false;

        if (playBtn && !releaseBtn && !observeBtn && !stopObservingBtn) {
            playBtn = (<span>click to play</span>);
            allowBigClick = true;
            bigClickHandler = () => { this.OnBigClickPlay(); };
        }

        if (!playBtn && releaseBtn && !observeBtn && !stopObservingBtn) {
            releaseBtn = (<span>click to release</span>);
            allowBigClick = true;
            bigClickHandler = () => { this.OnBigClickRelease(); };
        }

        return (
            <li>
                <div className={"instrument" + (allowBigClick ? " bigClick" : "") + (isYours ? " selected" : "")} onClick={bigClickHandler} style={{ color: i.color }}>
                    <div className="buttonContainer">{playBtn}{releaseBtn}{observeBtn}{stopObservingBtn}</div>
                    {idle}
                    {i.getDisplayName()}
                    {loadIndicator}
                    {ownedBy}
                </div>
                {sequencerCtrl}
            </li>
        );
    }
}


class InstrumentList extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            isShowing: true
        };
    }

    onClickHeader = () => {
        this.setState({ isShowing: !this.state.isShowing });
    }

    render() {
        if (!this.props.app || !this.props.app.roomState || (this.props.app.roomState.instrumentCloset.length < 1)) {
            return null;
        }
        const instruments = this.props.app.roomState.instrumentCloset.map(i => (<Instrument instrument={i} key={i.instrumentID} app={this.props.app}></Instrument>));
        return (
            <div className="component instrumentCloset" style={{ whiteSpace: "nowrap" }}>
                <h2 style={{ cursor: "pointer" }} onClick={this.onClickHeader}>{DFU.getArrowText(this.state.isShowing)} Instrument Closet</h2>
                {this.state.isShowing &&
                    <ul>
                        {instruments}
                    </ul>
                }
            </div>
        );
    }
}

class RightArea extends React.Component {

    render() {
        let myInstrument = null;
        let instParams = null;
        if (this.props.app && this.props.app.roomState) {
            myInstrument = this.props.app.roomState.FindInstrumentByUserID(this.props.app.myUser.userID);
            if (myInstrument) myInstrument = myInstrument.instrument;
        }
        if (myInstrument && myInstrument.params.length > 0) {
            instParams = (<InstrumentParams app={this.props.app} sequencerShown={this.props.sequencerShown} setSequencerShown={this.props.setSequencerShown} observerMode={false} instrument={myInstrument} toggleWideMode={this.props.toggleWideMode} isWideMode={this.props.isWideMode}></InstrumentParams>);
        } else {
            if (gStateChangeHandler.observingInstrument) {
                instParams = (<InstrumentParams app={this.props.app} sequencerShown={this.props.sequencerShown} setSequencerShown={this.props.setSequencerShown} observerMode={true} instrument={gStateChangeHandler.observingInstrument} toggleWideMode={this.props.toggleWideMode} isWideMode={this.props.isWideMode}></InstrumentParams>);
            }
        }

        return (
            <div id="rightArea" style={{ gridArea: "rightArea" }}>
                {instParams}
            </div>
        );
    }
}

class LeftArea extends React.Component {

    render() {
        const isDisconnected = !this.props.app?.IsConnected();
        return (
            <div id="leftArea" style={{ gridArea: "leftArea" }} className={isDisconnected ? "disconnectedGrayscale" : ""}>
                <InstrumentList app={this.props.app} />
                <UserList app={this.props.app} />
                <WorldStatus app={this.props.app} />
            </div>
        );
    }
}



class UserAvatar extends React.Component {

    onReleaseInstrument = () => {
        if (!this.props.app) return null;
        this.props.app.ReleaseInstrument();
    };

    render() {
        if (!this.props.app) return null;
        if (!this.props.app.roomState) return null;
        console.assert(this.props.displayHelper);
        const isMe = (this.props.app.myUser.userID == this.props.user.userID);

        const inst = this.props.app.roomState.FindInstrumentByUserID(this.props.user.userID);
        let instMarkup = null;
        if (inst) {
            const instStyle = {
                color: inst.instrument.color,
            };
            let releaseButton = isMe ? (
                <button onClick={this.onReleaseInstrument}>Release</button>
            ) : null;

            instMarkup = (
                <div style={instStyle} className="userAvatarInstrument">
                    playing {inst.instrument.getDisplayName()}
                    <br />
                    {releaseButton}
                </div>
            );
        }

        const pos = this.props.displayHelper().roomToScreenPosition(this.props.user.position);

        const style = {
            left: pos.x,
            top: pos.y,
            color: this.props.user.color,
            borderColor: this.props.user.color
        };

        const className = "userAvatar userAvatarActivityBump1" + (isMe ? " me" : "");

        return (
            <div className={className} id={'userAvatar' + this.props.user.userID} style={style}>
                <div>
                    {/* <span className="userName">{this.props.user.name}</span> */}
                    <UIUser.UIUserName user={this.props.user} />
                </div>
                {instMarkup}
            </div>
        );
    }
};


class UIAudioVisualizationRoomItem extends React.Component {
    constructor(props) {
        super(props);
        this.state = {};
        this.canvID = "canv_" + this.props.item.itemID;
    }

    componentDidMount() {
        //this.audioVis = new AudioVis(document.getElementById(this.canvID), this.props.app.synth.analysisNode);
    }
    componentWillUnmount() {
        if (this.audioVis) {
            this.audioVis.stop();
            this.audioVis = null;
        }
    }

    render() {
        return null; // for the moment don't show vis. it needs refinement and i don't want to refine until we use WebGL more.
        const pos = this.props.displayHelper().roomToScreenPosition(this.props.item.rect);

        let style = Object.assign({
            left: pos.x,
            top: pos.y,
            width: this.props.item.rect.w,
            height: this.props.item.rect.h,
        }, this.props.item.style);

        return (
            <canvas className="roomItem" style={style} id={this.canvID}></canvas>
        );
    }
};



class UIRoomItem extends React.Component {
    constructor(props) {
        super(props);
        this.state = {};
    }
    onClickSign = () => {
        this.props.item.params.isShown = !this.props.item.params.isShown;
        this.setState({});
    }
    render() {
        const pos = this.props.displayHelper().roomToScreenPosition(this.props.item.rect);

        let style = Object.assign({
            left: pos.x,
            top: pos.y,
            width: this.props.item.rect.w,
            height: this.props.item.rect.h,
        }, this.props.item.style);

        let signMarkup = null;
        if (this.props.item.itemType == DF.DFRoomItemType.sign) {
            let signStyle = Object.assign({
                left: pos.x,
                top: pos.y,
                opacity: this.props.item.params.isShown ? "100%" : "0",
            }, this.props.item.params.style);

            signMarkup = (<div className="roomSign" onClick={this.onClickSign} style={signStyle}
                dangerouslySetInnerHTML={{ __html: this.props.item.params.message }}></div>
            );
        } else if (this.props.item.itemType == DF.DFRoomItemType.audioVisualization) {
            return (<UIAudioVisualizationRoomItem item={this.props.item} displayHelper={this.props.displayHelper} app={this.props.app} />);
        }

        return (
            <div>
                <div className="roomItem" style={style}>{this.props.item.name}</div>
                {signMarkup}
            </div>
        );
    }
};





class ShortChatLog extends React.Component {
    render() {
        if (!this.props.app) return null;

        const lis = this.props.app.shortChatLog.map(msg => {

            const dt = new Date(msg.timestampUTC);
            const timestamp = dt.toLocaleTimeString();// `${dt.getHours()}:${dt.getMinutes()}:${dt.getSeconds()}`;

            switch (msg.messageType) {
                case DF.ChatMessageType.aggregate:
                    {
                        return msg.messages.map(aggMsg => (
                            <div className="chatLogEntryAggregate" key={msg.messageID}>{timestamp} {aggMsg}</div>
                        ));
                    }
                case DF.ChatMessageType.join:
                    let fromRoomTxt = msg.fromRoomName && `(from ${msg.fromRoomName})`;
                    return (
                        <div className="chatLogEntryJoin" key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>{msg.fromUserName} has joined the {this.props.app.roomState.roomTitle} jam {fromRoomTxt}</span></div>
                    );
                case DF.ChatMessageType.part:
                    let toRoomTxt = msg.toRoomName && `(to ${msg.toRoomName})`;
                    return (
                        <div className="chatLogEntryJoin" key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>{msg.fromUserName} has left the {this.props.app.roomState.roomTitle} jam {toRoomTxt}</span></div>
                    );
                case DF.ChatMessageType.nick:
                    return (
                        <div className="chatLogEntryNick" key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>{msg.fromUserName} is now known as {msg.toUserName}</span></div>
                    );
                case DF.ChatMessageType.chat:
                    if (!msg.renderedMessageBody) {
                        msg.renderedMessageBody = md.renderInline(msg.message);
                    }
                    if (msg.source === DF.eMessageSource.Server) {
                        return (
                            <div className="chatLogEntryChat server" key={msg.messageID}>
                                <span className="prefix">
                                    <span className='timestamp'>{timestamp}</span>
                                    &lt;<span className='serverTag userName'>7jam</span>&gt;
                                </span>
                                <span className='messageBody' dangerouslySetInnerHTML={{ __html:msg.renderedMessageBody}}></span>
                            </div>
                        );
                    } else {
                        const sourceIndicator = (msg.source == DF.eMessageSource.Discord) ? (<img className='discordChatMsgIndicator' src='./discord.ico'></img>) : null;
                        return (
                            <div className="chatLogEntryChat" key={msg.messageID}>
                                <span className="prefix">
                                    <span className='timestamp'>{timestamp}</span>
                                    &lt;{sourceIndicator}<span className="userName" style={{ color: msg.fromUserColor }}>{msg.fromUserName}</span>&gt;
                                </span>
                                <span className='messageBody' dangerouslySetInnerHTML={{ __html:msg.renderedMessageBody}}></span>
                            </div>
                        );
                    }
            }

            return null;
        });

        return (
            <div className='shortChatLog'>
                {lis}
            </div>
        );
    }
};






class FullChatLog extends React.Component {
    render() {
        if (!this.props.app || !this.props.app.roomState) return null;

        const lis = this.props.app.roomState.chatLog.map(msg => {

            const dt = new Date(msg.timestampUTC);
            const timestamp = dt.toLocaleTimeString();// `${dt.getHours()}:${dt.getMinutes()}:${dt.getSeconds()}`;

            switch (msg.messageType) {
                case DF.ChatMessageType.join:
                    let fromRoomTxt = msg.fromRoomName && `(from ${msg.fromRoomName})`;
                    return (
                        <li className="chatLogEntryJoin" key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>{msg.fromUserName} has joined the {this.props.app.roomState.roomTitle} jam {fromRoomTxt}</span></li>
                    );
                case DF.ChatMessageType.part:
                    let toRoomTxt = msg.toRoomName && `(to ${msg.toRoomName})`;
                    return (
                        <li className="chatLogEntryJoin" key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>{msg.fromUserName} has left the {this.props.app.roomState.roomTitle} jam {toRoomTxt}</span></li>
                    );
                case DF.ChatMessageType.nick:
                    return (
                        <li className="chatLogEntryNick" key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>{msg.fromUserName} is now known as {msg.toUserName}</span></li>
                    );
                case DF.ChatMessageType.chat:
                    if (!msg.renderedMessageBody) {
                        msg.renderedMessageBody = md.renderInline(msg.message);
                    }
                    if (msg.source === DF.eMessageSource.Server) {
                        return (
                            <div className="chatLogEntryChat server" key={msg.messageID}>
                                <span className="prefix">
                                    <span className='timestamp'>{timestamp}</span>
                                    &lt;<span className='serverTag userName'>7jam</span>&gt;
                                </span>
                                <span className='messageBody' dangerouslySetInnerHTML={{ __html:msg.renderedMessageBody}}></span>
                            </div>
                        );
                    } else {
                        const sourceIndicator = (msg.source == DF.eMessageSource.Discord) ? (<img className='discordChatMsgIndicator' src='./discord.ico'></img>) : null;
                        return (
                            <div className="chatLogEntryChat" key={msg.messageID}>
                                <span className="prefix">
                                    <span className='timestamp'>{timestamp}</span>
                                    &lt;{sourceIndicator}<span  className='userName' style={{ color: msg.fromUserColor }}>{msg.fromUserName}</span>&gt;
                                </span>
                                <span className='messageBody' dangerouslySetInnerHTML={{ __html:msg.renderedMessageBody}}></span>
                            </div>
                        );
                    }
            }

            return null;
        });

        return (
            <div className='fullChatLog'>
                <ul style={{ height: "100%" }}>
                    {lis}
                </ul>
            </div>
        );
    }
};









class AnnouncementArea extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
        };
        this.timer = null;
        this.timerRefs = 0;
    }
    componentWillUnmount() {
        if (this.timer) {
            clearTimerout(this.timer);
            this.timer = null;
        }
    }
    render() {
        if (!this.props.app || !this.props.app.roomState) return null;

        let html = this.props.app.roomState.announcementHTML || "";
        const countdownPrefix = "{{countdown:";
        const countdownSuffix = "}}";
        let begin = html.indexOf(countdownPrefix);
        if (begin != -1) {
            let end = html.indexOf(countdownSuffix, begin);
            if (end != -1) {
                try {
                    // countdown timer
                    let dt = html.substring(begin + countdownPrefix.length, end);
                    let remainingMS = (new Date(dt)) - (new Date());
                    const info = new DFU.TimeSpan(remainingMS);
                    html = html.substring(0, begin) + info.longString + html.substring(end + countdownSuffix.length);
                    if (!this.timer) {
                        this.timerRefs ++;
                        console.log(this.timerRefs);
                        this.timer = setTimeout(() => {
                            this.timer = null;
                            this.timerRefs --;
                            this.setState({});
                        }, 1000);
                    }
                } catch (e) {
                    // whatever.
                }
            }
        }

        return (
            <div id="announcementArea" dangerouslySetInnerHTML={{ __html: html }}></div>
        );
    }
};

class RoomAlertArea extends React.Component {
    render() {
        if (!this.props.app || !this.props.app.roomState) return null;

        if (this.props.app.myInstrument && !this.props.app.midi.IsListeningOnAnyDevice() && this.props.app.myInstrument.wantsMIDIInput) {
            return (
                <div id="roomAlertArea">
                    <div>Select a MIDI input device to start playing</div>
                    {this.props.app.deviceNameList.map(i => (
                        <button key={i} onClick={() => { this.props.app.midi.ListenOnDevice(i); gStateChangeHandler.OnStateChange(); }}>Start using {i}</button>
                    ))}
                </div>
            );
        }
        return null;
    }
};

class RoomArea extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            scrollSize: { x: 0, y: 0 },// track DOM scrollHeight / scrollWidth
            showFullChat: false,
        };
        this.screenToRoomPosition = this.screenToRoomPosition.bind(this);
        this.roomToScreenPosition = this.roomToScreenPosition.bind(this);
    }

    // helper APIs
    // where to display the background
    getScreenScrollPosition() {
        if ((!this.props.app) || (!this.props.app.roomState)) return { x: 0, y: 0 };
        let userPos = this.props.app.myUser.position;
        let x1 = (this.state.scrollSize.x / 2) - userPos.x;
        let y1 = (this.state.scrollSize.y / 2) - userPos.y;

        // that will put you square in the center of the screen every time.
        // now calculate the opposite: where the room is always centered.
        let x2 = (this.state.scrollSize.x / 2) - (this.props.app.roomState.width / 2);
        let y2 = (this.state.scrollSize.y / 2) - (this.props.app.roomState.height / 2);

        // so interpolate between the two. smaller = easier on the eyes, the room stays put, but parts can become unreachable.
        let t = 0.85;

        return {
            x: ((x1 * t) + (x2 * (1 - t))),
            y: ((y1 * t) + (y2 * (1 - t))),
        };
    }

    screenToRoomPosition(pos) { // takes html on-screen x/y position and translates to "world" coords
        if ((!this.props.app) || (!this.props.app.roomState)) return { x: 0, y: 0 };
        let sp = this.getScreenScrollPosition();
        let ret = {
            x: pos.x - sp.x,
            y: pos.y - sp.y,
        };
        if (ret.x < 0) { ret.x = 0; }
        if (ret.y < 0) { ret.y = 0; }
        if (ret.x > this.props.app.roomState.width) { ret.x = this.props.app.roomState.width; }
        if (ret.y > this.props.app.roomState.height) { ret.y = this.props.app.roomState.height; }
        return ret;
    }

    roomToScreenPosition(pos) {
        let sp = this.getScreenScrollPosition();
        return {
            x: pos.x + sp.x,
            y: pos.y + sp.y,
        };
    }

    onClick(e) {
        if ((!this.props.app) || (!this.props.app.roomState)) return false;
        if (!e.target || e.target.id != "roomArea") return false; // don't care abotu clicking anywhere except ON THIS DIV itself
        const roomPos = this.screenToRoomPosition({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });

        this.props.app.SetUserPosition(roomPos);
    }

    updateScrollSize() {
        let e = document.getElementById("roomArea");
        if (e.clientWidth != this.state.scrollSize.x || e.clientHeight != this.state.scrollSize.y) {
            this.setState({
                scrollSize: { x: e.clientWidth, y: e.clientHeight }
            });
        }
    }

    toggleChatView = () => {
        this.setState({
            showFullChat: !this.state.showFullChat
        });
    }

    componentDidMount() {
        let e = document.getElementById("roomArea");
        if (ResizeObserver) {
            this.resizeObserver = new ResizeObserver((entries) => {
                this.updateScrollSize();
            });
            this.resizeObserver.observe(e);

            this.updateScrollSize();
        }
        else {
            setInterval(() => this.updateScrollSize(), 3000);
        }
    }

    componentWillUnmount() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
    }

    render() {
        let style = {};
        let userAvatars = null;
        let roomItems = null;

        if (this.props.app && this.props.app.roomState) {
            let scrollPos = this.getScreenScrollPosition();

            userAvatars = this.props.app.roomState.users
                .filter(u => u.presence === DF.eUserPresence.Online)
                .map(u => (
                    <UserAvatar key={u.userID} app={this.props.app} user={u} displayHelper={() => this} />
                ));

            roomItems = this.props.app.roomState.roomItems.map(item => (
                <UIRoomItem key={item.itemID} app={this.props.app} item={item} displayHelper={() => this} />
            ));

            style = {
                gridArea: "roomArea",
                backgroundImage: `url(${this.props.app.roomState.img})`,
                backgroundPosition: `${scrollPos.x}px ${scrollPos.y}px`,
            };
        }


        let connection = (this.props.app) ? null : (
            <DFSignIn.Connection app={this.props.app} handleConnect={this.props.handleConnect} googleOAuthModule={this.props.googleOAuthModule} />
        );

        const seqViewVisible = this.props.app && this.props.app.roomState && this.props.sequencerShown;

        const switchViewButton = this.props.app && this.props.app.roomState && (
            <div className="switchRoomViews">
                <button className="switchChatView" onClick={this.toggleChatView}>room / chat view</button>
            </div>
        );

        const seqViewAvailable = this.props.focusedInstrument?.allowSequencer;
        const seqViewButton = seqViewAvailable && (
            <div className="showSequencer">
                <button className="showSequencerButton" onClick={() => {this.props.setSequencerShown(!seqViewVisible) }}>
                    {seqViewVisible ? "HIDE SEQUENCER" : "SHOW SEQUENCER"}
                </button>
            </div>
        );

        const isDisconnected = !this.props.app?.IsConnected();

        return (
            <div id="roomArea" className={"roomArea" + (isDisconnected ? " disconnectedGrayscale" : "")} onClick={e => this.onClick(e)} style={style}>
                {connection}
                {seqViewVisible && <SequencerMain
                    app={this.props.app}
                    sequencerShown={this.props.sequencerShown}
                    setSequencerShown={this.props.setSequencerShown}
                    instrument={this.props.focusedInstrument}
                    observerMode={!!this.props.app.observingInstrument}

                    ></SequencerMain>}

                {userAvatars}
                {roomItems}
                { !this.state.showFullChat && <ShortChatLog app={this.props.app} />}
                { this.state.showFullChat && <FullChatLog app={this.props.app} />}
                <AnnouncementArea app={this.props.app} />
                <RoomAlertArea app={this.props.app} />
                <CheerControls app={this.props.app} displayHelper={this}></CheerControls>
                <div className='roomOverlayControlsRight'>
                    {switchViewButton}
                    {seqViewButton}
                </div>
            </div>
        );
    }
}

class ChatArea extends React.Component {
    constructor(props) {
        super(props);
        this.state = { value: '' };
        this.handleChange = this.handleChange.bind(this);
    }

    handleClick() {
        if (!this.props.app) return;
        let sanitized = this.state.value.trim();
        if (sanitized.length < 1) return;
        sanitized = sanitized.substr(0, DF.ServerSettings.ChatMessageLengthMax);
        this.props.app.SendChatMessage(sanitized, null);
        this.state.value = '';
    }

    handleChange(event) {
        this.setState({ value: event.target.value });
    }

    handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            return this.handleClick();
        }
    }

    render() {
        if (!this.props.app) return null;
        return (
            <div id="chatArea" style={{ gridArea: "chatArea" }}>
                chat <input type="text" value={this.state.value} onChange={this.handleChange} onKeyDown={this.handleKeyDown} />
                <button onClick={this.handleClick.bind(this)}>send</button>
            </div>
        );
    }
}



class UpperRightControls extends React.Component {

    render() {

        return (
            <span className="topRightControls">
                {this.props.app && this.props.app.roomState && <DFOptionsDialog.DFOptionsDialog app={this.props.app} stateChangeHandler={gStateChangeHandler}></DFOptionsDialog.DFOptionsDialog>}
            </span>

        );
    }

}


class RootArea extends React.Component {
    OnStateChange() {
        // turns out this is very expensive, probably because it's at the root. A precisely optimized system would be very complex, so let's just throttle calls.
        this.stateChangeThrottler.InvokeThrottled();
        //this.setState(this.state);
    }

    HandleConnect = (userName, color, roomKey, google_access_token) => {

        if (this.state.app) {
            // this happens when you receive google token but are already connected.
            console.assert(google_access_token, "this should only happen when signing in with google...");
            this.state.app.GoogleSignIn(google_access_token);
            return;
        }

        let app = new DFApp.DigifuApp();

        // copied from ctor
        this.notesOn = []; // not part of state because it's pure jquery
        // notes on keeps a list of references to a note, since multiple people can have the same note playing it's important for tracking the note offs correctly.
        for (let i = 0; i < 128; ++i) {
            this.notesOn.push([]); // empty initially.
        }

        // if no google access token has been received for initial connect, then attempt to sign in after entry.
        if (!google_access_token) {
            this.googleOAuthModule.events.on(GoogleOAuthModule.Events.receivedToken, (access_token) => {
                this.state.app.GoogleSignIn(access_token);
            });
        }

        app.Connect(userName, color, roomKey, () => this.OnStateChange(), this.handleNoteOn, this.handleNoteOff,
            this.handleUserAllNotesOff, this.handleAllNotesOff,
            this.handleUserLeave, this.HandlePleaseReconnect,
            this.HandleCheer, this.handleRoomWelcome, google_access_token, this.onInstrumentLoadProgress);
        this.setState({ app });
    }

    onInstrumentLoadProgress = (instSpec, prog) => {
        this.stateChangeThrottler.InvokeThrottled();
        //this.instrumentLoadingProgressThrottler.proc = 
        //this.instrumentLoadingProgressThrottler.InvokeThrottled();
    };

    handleRoomRef = (r) => {
        let a = 0;
    };

    handleRoomWelcome = () => {

        if (this.state.app.roomState.softwareVersion != DF.gDigifujamVersion) {
            alert("New version released; this page will reload...");
            location.reload();
            return;
        }

        this.handleAllNotesOff();

        // throw up a screen and it fades out, then we remove it.
        var room = document.getElementById("roomArea");
        var screen = document.createElement("div");
        screen.className = "screen";
        room.append(screen);

        setTimeout(() => {
            screen.parentNode.removeChild(screen);
        }, 1600);

        // elements which animate should be switched to non-animated versions
        $('.userAvatar').addClass('roomWelcomeNoTransition');
        $('.roomArea').addClass('roomWelcomeNoTransition');
        $('.roomItem').addClass('roomWelcomeNoTransition');

        this.OnStateChange();

        setTimeout(() => {
            $('.roomWelcomeNoTransition').removeClass('roomWelcomeNoTransition');
        }, 1);

    };

    HandleCheer = (data/*user, text x, y*/) => {

        let random = function (num) {
            return (Math.random() * num)
        };

        //alert(`user cheer ${JSON.stringify(data)}`);
        if (!this.roomRef || !this.roomRef.current) return;
        //createCheer(data.user, data.text, data.x, data.y, this.roomRef);
        //console.log(`createCheer(${text}, ${x}, ${y})`);
        var durx = random(2) + 1.5;
        var dury = random(2) + 1.5;
        var fontSize = random(6) + 24;
        var animX = Math.trunc(random(2));
        var animY = Math.trunc(random(2));
        var easeY = Math.trunc(random(2)) ? "ease-in" : "ease-out";
        var easyX = Math.trunc(random(2)) ? "ease-in" : "ease-out";

        let pos = this.roomRef.current.roomToScreenPosition({ x: data.x, y: data.y });

        let css = `
                animation: floatX${animX} ${durx}s ${easyX} forwards,
                floatY${animY} ${dury}s ${easeY} forwards,
                floatOpacity ${dury}s ease-out forwards;
                top:${pos.y}px;
                left:${pos.x}px;
                font-size:${fontSize}px;
                color:${data.user.color}
            `;

        var cheerContainer = document.getElementById("roomArea")
        var cheer = document.createElement("div");
        cheer.innerText = data.text;
        cheer.className = "cheer";
        cheer.style.cssText = css;
        cheerContainer.append(cheer);

        setTimeout(() => {
            cheer.parentNode.removeChild(cheer);
        }, Math.max(durx, dury) * 1000);
    }

    HandlePleaseReconnect = () => {
        this.state.app.Disconnect();
        this.setState({ app: null });
    }

    handleNoteOn = (user, instrument, midiNote) => {

        // mixer activity indicator
        Object.keys(gInstActivityHandlers).forEach(id => {
            gInstActivityHandlers[id](instrument, midiNote);
        });

        if (user) {
            $('#userAvatar' + user.userID).toggleClass('userAvatarActivityBump1').toggleClass('userAvatarActivityBump2');
        }

        this.activityCount++;

        if (instrument.activityDisplay === "keyboard") {
            this.keyboardActivityDisplayState.PushNoteOn(user, midiNote);
        } else if (instrument.activityDisplay === "drums") {
            this.drumsActivityDisplayState.PushNoteOn(user, midiNote);
        } else {
            return;
        }
    }

    // if instrument is null, remove globally (any inst).
    removeUserNoteRef(userID, midiNote, instrument) {
        if (!instrument || instrument.activityDisplay === "keyboard") {
            this.keyboardActivityDisplayState.RemoveUserNoteRef(userID, midiNote);
        }
        if (!instrument || instrument.activityDisplay === "drums") {
            this.drumsActivityDisplayState.RemoveUserNoteRef(userID, midiNote);
        }
    }

    handleNoteOff = (user, instrument, midiNote) => {
        this.removeUserNoteRef(user?.userID, midiNote, instrument);
    }

    handleUserAllNotesOff = (user) => {
        this.drumsActivityDisplayState.AllUserNotesOff(user.userID);
        this.keyboardActivityDisplayState.AllUserNotesOff(user.userID);
    };

    handleAllNotesOff = () => {
        this.drumsActivityDisplayState.AllNotesOff();
        this.keyboardActivityDisplayState.AllNotesOff();
    };

    handleUserLeave = (userID) => {
        this.drumsActivityDisplayState.AllUserNotesOff(userID);
        this.keyboardActivityDisplayState.AllUserNotesOff(userID);
    }

    toggleWideMode = () => {
        this.setState({ wideMode: !this.state.wideMode });
    };

    get observingInstrument() {
        return this.state.observingInstrument;
    }
    set observingInstrument(inst) {
        this.state.app.observeInstrument(inst); // this will send change notifications on remote param changes.
        this.setState({ observingInstrument: inst });
    }

    get focusedInstrument() {
        return this.state.app?.myInstrument ?? this.state.observingInstrument;
    }

    get isSequencerShown() {
        const ss = this.state.sequencerShown;
        const ret = ss && !!this.focusedInstrument;
        // if our state is out of sync with this property, update.
        //setTimeout(() => this.setState({sequencerShown:ret}), 1);
        return ret;
    }

    setSequencerShown = (sequencerShown) => {
        this.setState({sequencerShown});
    }

    onWindowResize() {
        this.setState({});
    }
  

    componentDidMount() {
        window.addEventListener('resize', () => this.onWindowResize());
        this.googleOAuthModule.OnPageLoaded(true);
    }

    constructor(props) {
        super(props);
        this.state = {
            app: null,
            wideMode: false,
            observingInstrument: null,
        };

        this.googleOAuthModule = new GoogleOAuthModule();
        this.googleOAuthModule.events.on(GoogleOAuthModule.Events.signOut, () => {
            this.state.app.GoogleSignOut();
        });

        window.DFStateChangeHandler = this;
        gStateChangeHandler = this;

        this.instrumentLoadingProgressThrottler = new DFU.Throttler(1000.0 / 15);

        this.keyboardActivityDisplayState = new KeybDisplayState(midiNote => {
            return "#key_" + midiNote;
        });
        this.drumsActivityDisplayState = new KeybDisplayState(midiNote => {
            return "#drum_" + midiNote;
        });

        this.activityCount = 0;
        this.roomRef = React.createRef();
        this.stateChangeThrottler = new DFU.Throttler();
        this.stateChangeThrottler.interval = 1000.0 / 15; // external state change events should not cause full-page re-renders often.
        this.stateChangeThrottler.proc = () => {
            this.setState({});
        };
    }

    render() {
        let title = "(not connected)";
        if (this.state.app && this.state.app.roomState) {
            let activityTxt = "";
            if (window.gSpinners) {
                const spinnerName = "toggle10"; // arc
                const i = this.activityCount % window.gSpinners[spinnerName].frames.length;
                activityTxt = window.gSpinners[spinnerName].frames[i];
            }
            const onlineUsers = this.state.app.roomState.users.filter(u => u.presence === DF.eUserPresence.Online);
            title = `${this.state.app.roomState.roomTitle} ${activityTxt} [${onlineUsers.length}/${this.state.app.worldPopulation}]`;
        }
        if (document.title != title) {
            document.title = title;
        }

        if (this.state.wideMode && (!this.state.app || !this.state.app.myInstrument)) {
            setTimeout(() => {
                this.setState({ wideMode: false });
            }, 1);
        }

        let hasRightArea = this.state.app && (this.state.app.observingInstrument || this.state.app.myInstrument);

        const adminControls = (this.state.app && this.state.app.myUser.IsAdmin()) && (
            <AdminControlsButton app={this.state.app}></AdminControlsButton>
        );

        // dynamically set the column sizes. media queries don't work because there are a bunch of dynamic states here.
        // grid-template-columns: 270px minmax(0, 1fr) 320px;
        let leftSize = 270;
        let rightSize = 320;
        if (this.state.wideMode) {
            rightSize = 550; // wide mode
        } else if (!hasRightArea) {
            rightSize = 0; // no right area mode
        }

        if (window.outerWidth < 800) { // for mobile
            rightSize = 0;
            leftSize = 0;
        }

        gridContainerStyle = {
            gridTemplateColumns: `${leftSize}px minmax(0, 1fr) ${rightSize}px`,
        };

        const isDisconnected = !this.state.app?.IsConnected();
        const connectionIndicator = isDisconnected && (
            <span className='connectionIndicator disconnected' title="Trying to reconnect to 7jam..."><i className="material-icons">power_off</i></span>
        );

        return (
            <div id="allContentContainer">
            <GestureSplash app={this.state.app}></GestureSplash>
            <div id="grid-container" style={gridContainerStyle}>
                <div style={{ gridArea: "headerArea", textAlign: 'center' }} className="headerArea">
                    <span>
                        <UserSettingsButton app={this.state.app} googleOAuthModule={this.googleOAuthModule}></UserSettingsButton>
                        {adminControls}
                        {this.state.app && this.state.app.synth && <UpperRightControls app={this.state.app}></UpperRightControls>}
                        {this.state.app?.synth && <InlineMasterGainCtrl app={this.state.app} stateChangeHandler={gStateChangeHandler}></InlineMasterGainCtrl>}
                        {this.state.app?.synth && <InlinePitchBendCtrl app={this.state.app} stateChangeHandler={gStateChangeHandler}></InlinePitchBendCtrl>}
                        {/*this.state.app && this.state.app.roomState && <DFOptionsDialog.RoomBeat app={this.state.app}></DFOptionsDialog.RoomBeat>*/}
                    </span>
                    <span>
                        {connectionIndicator}
                        <span className='headerTitle'>7jam.io</span>
                        {/* i think these are from https://simpleicons.org/ */}
                        <a href="https://discord.gg/kkf9gQfKAd" target="_blank"> {/* https://discord.gg/cKSF3Mg maj7*/}
                            <svg className="socicon" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Discord icon</title><path d="M20.222 0c1.406 0 2.54 1.137 2.607 2.475V24l-2.677-2.273-1.47-1.338-1.604-1.398.67 2.205H3.71c-1.402 0-2.54-1.065-2.54-2.476V2.48C1.17 1.142 2.31.003 3.715.003h16.5L20.222 0zm-6.118 5.683h-.03l-.202.2c2.073.6 3.076 1.537 3.076 1.537-1.336-.668-2.54-1.002-3.744-1.137-.87-.135-1.74-.064-2.475 0h-.2c-.47 0-1.47.2-2.81.735-.467.203-.735.336-.735.336s1.002-1.002 3.21-1.537l-.135-.135s-1.672-.064-3.477 1.27c0 0-1.805 3.144-1.805 7.02 0 0 1 1.74 3.743 1.806 0 0 .4-.533.805-1.002-1.54-.468-2.14-1.404-2.14-1.404s.134.066.335.2h.06c.03 0 .044.015.06.03v.006c.016.016.03.03.06.03.33.136.66.27.93.4.466.202 1.065.403 1.8.536.93.135 1.996.2 3.21 0 .6-.135 1.2-.267 1.8-.535.39-.2.87-.4 1.397-.737 0 0-.6.936-2.205 1.404.33.466.795 1 .795 1 2.744-.06 3.81-1.8 3.87-1.726 0-3.87-1.815-7.02-1.815-7.02-1.635-1.214-3.165-1.26-3.435-1.26l.056-.02zm.168 4.413c.703 0 1.27.6 1.27 1.335 0 .74-.57 1.34-1.27 1.34-.7 0-1.27-.6-1.27-1.334.002-.74.573-1.338 1.27-1.338zm-4.543 0c.7 0 1.266.6 1.266 1.335 0 .74-.57 1.34-1.27 1.34-.7 0-1.27-.6-1.27-1.334 0-.74.57-1.338 1.27-1.338z" /></svg>
                        </a>
                        <a href="https://twitter.com/tenfour2" target="_blank">
                            <svg className="socicon" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>twitter.com/tenfour2</title><path d="M23.954 4.569c-.885.389-1.83.654-2.825.775 1.014-.611 1.794-1.574 2.163-2.723-.951.555-2.005.959-3.127 1.184-.896-.959-2.173-1.559-3.591-1.559-2.717 0-4.92 2.203-4.92 4.917 0 .39.045.765.127 1.124C7.691 8.094 4.066 6.13 1.64 3.161c-.427.722-.666 1.561-.666 2.475 0 1.71.87 3.213 2.188 4.096-.807-.026-1.566-.248-2.228-.616v.061c0 2.385 1.693 4.374 3.946 4.827-.413.111-.849.171-1.296.171-.314 0-.615-.03-.916-.086.631 1.953 2.445 3.377 4.604 3.417-1.68 1.319-3.809 2.105-6.102 2.105-.39 0-.779-.023-1.17-.067 2.189 1.394 4.768 2.209 7.557 2.209 9.054 0 13.999-7.496 13.999-13.986 0-.209 0-.42-.015-.63.961-.689 1.8-1.56 2.46-2.548l-.047-.02z" /></svg>
                        </a>
                        <a target="_blank" href="https://github.com/thenfour/digifujam">
                            <svg className="socicon" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>GitHub icon</title><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg>
                        </a>
                        <CreditsButton></CreditsButton>
                    </span>
                </div>
                <DFPiano.PianoArea app={this.state.app} />
                <ChatArea app={this.state.app} />
                <RoomArea app={this.state.app} focusedInstrument={this.focusedInstrument} sequencerShown={this.isSequencerShown} setSequencerShown={this.setSequencerShown} handleConnect={this.HandleConnect} ref={this.roomRef} googleOAuthModule={this.googleOAuthModule} />
                <RightArea app={this.state.app} sequencerShown={this.isSequencerShown} setSequencerShown={this.setSequencerShown} toggleWideMode={this.toggleWideMode} isWideMode={this.state.wideMode} />
                <LeftArea app={this.state.app} />

            </div>
            </div>
        );
    }
}

module.exports = {
    RootArea,
};

