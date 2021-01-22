
let gStateChangeHandler = null;

let getRoomID = function (app) {
    if (!app) return window.DFRoomID;
    if (!app.roomState) return window.DFRoomID;
    return app.roomState.roomID;
}

let getValidationErrorMsg = function (userName, userColor) {
    let sanitizedName = sanitizeUsername(userName);
    let validationErrorTxt = (sanitizedName != null) ? "" : "! Please enter a valid username";

    let sanitizedColor = sanitizeUserColor(userColor);
    if (sanitizedColor == null) {
        validationErrorTxt += "! Please enter a valid CSS color";
    }
    return validationErrorTxt;
}

// props:
// - default
// - onChange(val)
// - onEnter
class TextInputField extends React.Component {
    constructor(props) {
        super(props);
        this.state = { value: '' };
        if (props.default) {
            this.state.value = props.default;
        }
        this.handleChange = this.handleChange.bind(this);
    }
    handleChange(val) {
        this.setState({ value: val });
        if (this.props.onChange) {
            this.props.onChange(val);
        }
    }

    _handleKeyDown = (e) => {
        if (e.key === 'Enter' && this.props.onEnter) {
            return this.props.onEnter(e);
        }
    }
    render() {
        return (
            <input type="text" ref={(input) => {
                this.inputRef = input;
            }} style={this.props.style} value={this.state.value} onChange={(e) => this.handleChange(e.target.value)} onKeyDown={this._handleKeyDown} />
        );
    }
}

// props
// - onChange
// - onEnter
// - value
// - style
class TextInputFieldExternalState extends React.Component {
    handleChange = (val) => {
        this.setState({ value: val });
        if (this.props.onChange) {
            this.props.onChange(val);
        }
    }
    handleChange = (e) => {
        if (this.props.onChange) {
            return this.props.onChange(e.target.value);
        }
    }
    handleKeyDown = (e) => {
        if (e.key === 'Enter' && this.props.onEnter) {
            return this.props.onEnter(e);
        }
    }
    render() {
        return (
            <input type="text" style={this.props.style} value={this.props.value} onChange={this.handleChange} onKeyDown={this.handleKeyDown} />
        );
    }
}



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
    }
    componentDidMount() {
        // set initial values.
        let val = this.props.param.currentValue;
        $("#" + this.inpID).val(val);
        this.renderedValue = val;
    }
    render() {
        if (this.renderedValue != this.props.param.currentValue) {
            //has been externally modified. update ui.
            let val = this.props.param.currentValue;
            this.renderedValue = val;
            $("#" + this.inpID).val(val);
        }

        return (
            <li className={this.props.param.cssClassName}>
                <input id={this.inpID} type="text" maxlength={this.props.param.maxTextLength} onChange={this.onChange} />
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
        this.props.app.SetInstrumentParam(this.props.instrument, this.props.param, val);
        gStateChangeHandler.OnStateChange();
    };
    render() {
        const buttons = (this.props.param.enumNames.map((e, val) => (
            <button className={"buttonParam " + ((this.props.param.currentValue == val) ? "active" : "")} key={val} onClick={() => this.onClickButton(val)}>{e}</button>
        )));

        return (
            <li className={this.props.param.cssClassName}>
                {buttons}
                <label>{this.props.param.name}</label>
            </li>
        );
    }
}




// CHECKBOX instrument
// props.instrument
class InstCbxParam extends React.Component {
    constructor(props) {
        super(props);
        this.inputID = "cbxparam_" + this.props.instrument.instrumentID + "_" + this.props.param.paramID;
        this.renderedValue = false;
    }
    onChange = (e) => {
        let val = e.target.checked;
        this.renderedValue = val;
        this.props.app.SetInstrumentParam(this.props.instrument, this.props.param, val);
        if (this.props.instrument.ParamChangeCausesRender(this.props.param)) {
            //setTimeout(() => this.setState(this.state), 0);
            gStateChangeHandler.OnStateChange();
        }
    }
    componentDidMount() {
        // set initial values.
        let val = !!this.props.param.currentValue;
        $("#" + this.inputID).prop("checked", val);
        this.renderedValue = val;
    }
    render() {
        if (this.renderedValue != this.props.param.currentValue) {
            //has been externally modified. update ui.
            let val = !!this.props.param.currentValue;
            this.renderedValue = val;
            $("#" + this.inputID).prop("checked", val);
        }

        return (
            <li className={this.props.param.cssClassName} style={{ display: "inline" }}>
                <input id={this.inputID} type="checkbox" onChange={this.onChange}
                //value={this.props.param.currentValue} <-- setting values like this causes massive slowness
                />
                <label>{this.props.param.name}</label>
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
            cap = p.enumNames[this.props.param.currentValue];
        } else {
            cap = this.props.param.currentValue;
        }
        $("#" + this.valueTextID).text(cap);
    }
    onChange = (e) => {
        //this.setState(this.state);
        let val = e.target.value;
        this.renderedValue = val;
        this.props.app.SetInstrumentParam(this.props.instrument, this.props.param, val);
        this.setCaption();
    }
    componentDidMount() {
        // set initial values.
        let val = this.props.param.currentValue;
        $("#" + this.sliderID).val(val);
        this.setCaption();
        this.renderedValue = val;
    }
    render() {
        if (this.renderedValue != this.props.param.currentValue) {
            //has been externally modified. update ui.
            let val = this.props.param.currentValue;
            this.renderedValue = val;
            $("#" + this.sliderID).val(val);
            this.setCaption();
        }

        return (
            <li className={this.props.param.cssClassName}>
                <input id={this.sliderID} type="range" min={this.props.param.minValue} max={this.props.param.maxValue} onChange={this.onChange}
                //value={this.props.param.currentValue} <-- setting values like this causes massive slowness
                />
                <label>{this.props.param.name}: <span id={this.valueTextID}></span></label>
            </li>
        );
    }
}


// props.instrument
class InstFloatParam extends React.Component {
    constructor(props) {
        super(props);
        this.valueTextInputID = "i_" + this.props.instrument.instrumentID + "_" + this.props.param.paramID;
        this.valueTextDivID = "idiv_" + this.props.instrument.instrumentID + "_" + this.props.param.paramID;
        this.valueTextID = "val_" + this.props.instrument.instrumentID + "_" + this.props.param.paramID;
        this.sliderID = "slider_" + this.props.instrument.instrumentID + "_" + this.props.param.paramID;
        this.renderedValue = -420.69;
    }
    onChange = (e) => {
        this.setState(this.state);
        let realVal = parseFloat(e.target.value) / ClientSettings.InstrumentFloatParamDiscreteValues; // 0-1 within target range.
        const p = this.props.param;
        realVal *= p.maxValue - p.minValue; // scaled to range.
        realVal += p.minValue;// shifted to correct value.

        this.renderedValue = realVal;
        this.props.app.SetInstrumentParam(this.props.instrument, this.props.param, realVal);
        this.setCaption(this.props.param.currentValue);
        this.setInputTextVal(p.currentValue);
    }
    componentDidMount() {
        // set initial values.
        const p = this.props.param;
        this.renderedValue = p.currentValue;
        this.setSliderVal(p.currentValue);
        this.setCaption(p.currentValue);
        this.setInputTextVal(p.currentValue);
        switch (p.cssClassName) {
            case "modAmtParam":
                stylizeRangeInput(this.sliderID, {
                    bgNegColorSpec: "#444",
                    negColorSpec: "#66c",
                    posColorSpec: "#66c",
                    bgPosColorSpec: "#444",
                    zeroVal: this._realValToSliderVal(0),
                });
                break;
            default:
                stylizeRangeInput(this.sliderID, {
                    bgNegColorSpec: "#044",
                    negColorSpec: "#088",
                    posColorSpec: "#088",
                    bgPosColorSpec: "#044",
                    zeroVal: this._realValToSliderVal(0),
                });
                break;
        }
    }

    _realValToSliderVal(rv) {
        const p = this.props.param;
        let sv = rv;
        sv -= p.minValue;
        sv /= p.maxValue - p.minValue;
        sv *= ClientSettings.InstrumentFloatParamDiscreteValues;
        return sv;
    }

    setInputTextVal(val) {
        $("#" + this.valueTextInputID).val(this.props.param.currentValue.toFixed(3));
    }
    setCaption(val) {
        $("#" + this.valueTextID).text(this.props.param.currentValue.toFixed(2));
    }
    setSliderVal(val) {
        const p = this.props.param;
        let currentSliderValue = this._realValToSliderVal(val);
        $("#" + this.sliderID).val(currentSliderValue);
    }

    toggleShowTxt = () => {
        let q = $("#" + this.valueTextDivID);
        if (q.is(':visible')) {
            q.toggle(false);
        } else {
            q.toggle(true);
            // this never works and i don't know why.
            //             setTimeout(() => {
            //                 let t = document.getElementById(this.valueTextDivID);
            //                 t.focus();
            //                 //t.select();
            // //                    q.focus();
            //             //    q.select();
            //             }, 100);
        }
    }

    handleTextInputKeyDown = (e) => {
        if (e.key != 'Enter') return;
        this.setState(this.state);
        let realVal = parseFloat(e.target.value);
        this.props.app.SetInstrumentParam(this.props.instrument, this.props.param, realVal);

        this.setCaption(realVal);
        this.setSliderVal(realVal);
    }
    render() {
        if (this.renderedValue != this.props.param.currentValue) {
            //has been externally modified. update ui.
            let val = this.props.param.currentValue;
            this.renderedValue = val;
            this.setSliderVal(val);//$("#" + this.sliderID).val(val);
            this.setCaption(val);
        }

        return (
            <li className={this.props.param.cssClassName}>
                <input id={this.sliderID} className="floatParam" type="range" min={0} max={ClientSettings.InstrumentFloatParamDiscreteValues} onChange={this.onChange}
                    ref={i => { this.sliderRef = i; }}
                //value={Math.trunc(currentValue)} <-- setting values like this causes massive slowness
                />
                <label onClick={this.toggleShowTxt}>{this.props.param.name}: <span id={this.valueTextID}></span></label>
                <div style={{ display: "none" }} id={this.valueTextDivID}>
                    <input type="text" id={this.valueTextInputID} onKeyDown={this.handleTextInputKeyDown} />
                </div>
            </li>
        );
    }
}






class InstrumentPresetList extends React.Component {
    presetClick(presetObj) {
        this.props.app.LoadPresetObj(presetObj);
    }
    render() {
        const lis = this.props.instrument.presets.map(preset => (
            <li key={preset.patchName} onClick={() => this.presetClick(preset)}>{preset.patchName}</li>
        ));
        return (
            <ul className="presetList">
                {lis}
            </ul>
        );
    }
};


// props.groupName
// props.app
// props.filteredParams
class InstrumentParamGroup extends React.Component {
    render() {
        const arrowText = this.props.isShown ? '⯆' : '⯈';

        let createParam = (p) => {
            if (p.hidden) return null;
            switch (p.parameterType) {
                case InstrumentParamType.intParam:
                    if (p.renderAs == "buttons") {
                        return (<InstButtonsParam key={p.paramID} app={this.props.app} instrument={this.props.instrument} param={p}></InstButtonsParam>);
                    } else {
                        return (<InstIntParam key={p.paramID} app={this.props.app} instrument={this.props.instrument} param={p}></InstIntParam>);
                    }
                case InstrumentParamType.floatParam:
                    return (<InstFloatParam key={p.paramID} app={this.props.app} instrument={this.props.instrument} param={p}></InstFloatParam>);
                case InstrumentParamType.textParam:
                    return (<InstTextParam key={p.paramID} app={this.props.app} instrument={this.props.instrument} param={p}></InstTextParam>);
                case InstrumentParamType.cbxParam:
                    return (<InstCbxParam key={p.paramID} app={this.props.app} instrument={this.props.instrument} param={p}></InstCbxParam>);
            }
        };

        return (
            <fieldset key={this.props.groupName} className="instParamGroup">
                <legend onClick={() => this.props.onToggleShown()}>{this.props.groupName} {arrowText}</legend>
                {this.props.isShown && <ul className="instParamList">
                    {this.props.filteredParams.filter(p => p.groupName == this.props.groupName).map(p => createParam(p))}
                </ul>}
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
        };
        this.state.shownGroupNames = this.props.instrument.GetDefaultShownGroupsForInstrument();
    }

    onOpenClicked = () => {
        this.setState({ presetListShown: !this.state.presetListShown });
        //this.props.app.ResetInstrumentParams();
    };

    onExportClicked = () => {
        let presetObj = this.props.instrument.exportPresetObj();
        let txt = JSON.stringify(presetObj);
        navigator.clipboard.writeText(txt).then(() => {
            alert('Patch was copied to the clipboard.')
        }, () => {
            alert('Unable to copy patch.')
        });
    };

    onImportClicked = () => {
        navigator.clipboard.readText().then(text => {
            console.log('Pasted content: ', text);
            try {
                let presetObj = JSON.parse(text);
                this.props.app.LoadPresetObj(presetObj);
            } catch (e) {
                alert(`Unable to import; maybe badly formatted text... Exception: ${e}`);
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

    onToggleShownClick = () => {
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
        this.props.app.instrumentPanic();
    };

    render() {

        //if (!this.props.instrument.ShouldShowEditor) return null;

        const arrowText = this.state.presetListShown ? '⯆' : '⯈';

        let presetList = this.state.presetListShown && (
            <InstrumentPresetList instrument={this.props.instrument} app={this.props.app}></InstrumentPresetList>
        );

        let filterTxt = this.state.filterTxt.toLowerCase();
        let filteredParams = this.props.instrument.GetUsablePresetListMinusPatchName(filterTxt)
        // .filter(p => {
        //     if (p.paramID == "patchName") return false; // because this is rendered specially.
        //     if (p.groupName.toLowerCase().includes(filterTxt)) return true;
        //     if (p.name.toLowerCase().includes(filterTxt)) return true;
        //     if (p.tags.toLowerCase().includes(filterTxt)) return true;
        //     return false;
        // });

        // unique group names.
        let groupNames = [...new Set(filteredParams.map(p => p.groupName))];
        groupNames = groupNames.filter(gn => filteredParams.find(p => p.groupName == gn && !p.hidden));

        let groupFocusButtons = groupNames.map(groupName => (
            <button key={groupName} className={this.isGroupNameShown(groupName) ? "active paramGroupFocusBtn" : "paramGroupFocusBtn"} onClick={() => this.clickFocusGroupName(groupName)}>{groupName}</button>
        ));

        let groups = groupNames.map(groupName => (<InstrumentParamGroup
            groupName={groupName}
            app={this.props.app}
            instrument={this.props.instrument}
            isShown={this.isGroupNameShown(groupName)}
            onToggleShown={() => this.onToggleGroupShown(groupName)}
            filteredParams={filteredParams}
        />));

        const shownStyle = this.state.isShown ? { display: 'block' } : { display: "none" };
        const mainArrowText = this.state.isShown ? '⯆' : '⯈';

        return (
            <div className="component">
                <h2 style={{ cursor: 'pointer' }} onClick={this.onToggleShownClick}>{this.props.instrument.getDisplayName()} {mainArrowText}</h2>
                <div style={shownStyle}>
                <button onClick={this.props.toggleWideMode}>{this.props.isWideMode ? "⯇ Wide" : "⯈ Narrow"}</button>
                <button onClick={this.onPanicClick}>Panic</button>
                <button onClick={this.onReleaseClick}>Release</button>

                    <fieldset className="instParamGroup presetsGroup">
                        <legend onClick={this.onOpenClicked}>Presets {arrowText}</legend>
                        {this.state.presetListShown && (<ul className="instParamList">
                            <InstTextParam key="patchName" app={this.props.app} instrument={this.props.instrument} param={this.props.instrument.GetParamByID("patchName")}></InstTextParam>
                            <li><button onClick={this.onExportClicked}>Export to clipboard...</button></li>
                            <li><button onClick={this.onImportClicked}>Import from clipboard...</button></li>
                        </ul>)}

                        {presetList}
                    </fieldset>
                    <div className="paramGroupCtrl">
                        <div className="groupFocusButtons">
                            Param groups:
                            <button className={this.state.showingAllGroups ? "active paramGroupFocusBtn" : "paramGroupFocusBtn"} onClick={() => this.clickAllGroup()}>All</button>
                            {groupFocusButtons}
                            <div className="paramFilter">Param filter🔎<TextInputFieldExternalState onChange={this.onFilterChange} value={this.state.filterTxt}></TextInputFieldExternalState></div>
                        </div>
                    </div>
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
        if (Cookies.get(getRoomID(this.props.app) + "_cheerText")) {
            this.state.text = Cookies.get(getRoomID(this.props.app) + "_cheerText");
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
            setTimeout(() => { this.onTimeout() }, ClientSettings.MinCheerIntervalMS);
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
            setTimeout(() => { this.onTimeout() }, ClientSettings.MinCheerIntervalMS);
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

    // onMouseMove = (e) => {
    //     if (!e.target || e.target.id != "cheerButton") return false;
    //     this.mousePos = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
    // };

    render() {
        // onClick={() => this.props.handleCheerClick(this.state.text)}
        if (!this.props.app || !this.props.app.roomState) return null;
        return (
            <div id="cheerControl">
                <div id="cheerButton" className="cheerButton" onMouseDown={this.onMouseDown} onMouseUp={this.onMouseUp} onMouseEnter={this.onMouseEnter} onMouseLeave={this.onMouseLeave} >cheer</div>
                <TextInputFieldExternalState
                    value={this.state.text}
                    onChange={(val) => {
                        Cookies.set(getRoomID(this.props.app) + "_cheerText", val);
                        this.setState({ text: val });
                    }}
                />
            </div>
        );
    }
}


class UserState extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            userName: '',
            userColor: '',
            isShown: true,
        };

        if (this.props.app && this.props.app.myUser) {
            this.state.userName = this.props.app.myUser.name;
            this.state.userColor = this.props.app.myUser.color;
        }
    }

    sendUserStateChange = (e) => {
        this.props.app.SetUserNameColor(this.state.userName, this.state.userColor);
    };

    setVolumeVal = (v) => {
        let realVal = parseFloat(v.target.value) / 100;
        this.setState(this.state);
        this.props.app.synth.masterGain = realVal;
    }

    // setReverbVal = (v) => {
    //     let realVal = parseFloat(v.target.value) / 100;
    //     this.setState(this.state);
    //     this.props.app.synth.reverbGain = realVal;
    // }

    setPBRange = (v) => {
        this.setState(this.state);
        this.props.app.pitchBendRange = v.target.value;
    }

    handleToggleShownClick = () => {
        this.setState({ isShown: !this.state.isShown });
    };

    onClickMute = () => {
        // this op takes a while so do async
        setTimeout(() => {
            this.props.app.synth.isMuted = !this.props.app.synth.isMuted;
            this.setState(this.state);
        }, 0);
    };

    render() {
        let inputList = null;
        if (this.props.app && this.props.app.midi) {
            if (this.props.app.deviceNameList.length == 0) {
                inputList = (<li>(no midi devices found)</li>);
            } else {
                inputList = this.props.app.deviceNameList.map(i => {
                    if (this.props.app.midi.IsListeningOnDevice(i)) {
                        return (
                            <li key={i}>
                                <button onClick={() => this.props.app.midi.StopListeningOnDevice(i)}>Stop using {i}</button>
                            </li>
                        );
                    } else {
                        return (
                            <li key={i}>
                                <button onClick={() => this.props.app.midi.ListenOnDevice(i)}>Start using {i}</button>
                            </li>
                        );
                    }
                });
            }
        }

        let connectCaption = "You";
        // if (this.props.app && this.props.app.roomState && this.props.app.roomState.roomTitle.length) {
        //     connectCaption = this.props.app.roomState.roomTitle;
        // }

        const disconnectBtn = this.props.app ? (
            <li><button onClick={this.props.handleDisconnect}>Disconnect</button><div style={{ height: 20 }}>&nbsp;</div></li>
        ) : null;

        const changeUserStateBtn = this.props.app ? (
            <li style={{ marginBottom: 10 }}><button onClick={this.sendUserStateChange}>update above stuff</button></li>
        ) : null;

        const randomColor = `rgb(${[1, 2, 3].map(x => Math.random() * 256 | 0)})`;

        const muteMarkup = this.props.app && this.props.app.synth ? (
            <button className="muteButton" onClick={this.onClickMute}>{this.props.app.synth.isMuted ? "🔇" : "🔊"}</button>
        ) : null;

        // volume from 0 to 1(unity) to 2
        const volumeMarkup = this.props.app && this.props.app.synth ? (
            <li>
                <input type="range" id="volume" name="volume" min="0" max="200" onChange={this.setVolumeVal} value={this.props.app.synth.masterGain * 100} disabled={this.props.app.synth.isMuted} />
                <label htmlFor="volume">gain:{Math.trunc(this.props.app.synth.masterGain * 100)}</label>
                {muteMarkup}
            </li>
        ) : null;

        // const verbMarkup = this.props.app && this.props.app.synth ? (
        //     <li>
        //         <input type="range" id="verbGain" name="verbGain" min="0" max="200" onChange={this.setReverbVal} value={this.props.app.synth.reverbGain * 100} disabled={this.props.app.synth.isMuted} />
        //         <label htmlFor="verbGain">verb:{Math.trunc(this.props.app.synth.reverbGain * 100)}</label>
        //     </li>
        // ) : null;

        const pbrangeMarkup = this.props.app && this.props.app.synth ? (
            <li>
                <input type="range" id="pbrange" name="pbrange" min="0" max="12" onChange={this.setPBRange} value={this.props.app.pitchBendRange} />
                <label htmlFor="pbrange">PB range:{this.props.app.pitchBendRange}</label>
            </li>
        ) : null;

        const ulStyle = this.state.isShown ? { display: 'block' } : { display: "none" };
        const arrowText = this.state.isShown ? '⯆' : '⯈';

        const validationMsg = getValidationErrorMsg(this.state.userName, this.state.userColor);
        const validationMarkup = validationMsg.length ? (
            <div class="validationError">{validationMsg}</div>
        ) : null;

        return (
            <div className="component">
                <h2 style={{ cursor: 'pointer' }} onClick={this.handleToggleShownClick}>{connectCaption} {arrowText}</h2>
                <ul style={ulStyle}>
                    {disconnectBtn}
                    <li><TextInputField style={{ width: 80 }} default={this.state.userName} onChange={(val) => this.setState({ userName: val })} onEnter={this.sendUserStateChange} /> name</li>
                    <li><TextInputFieldExternalState
                        style={{ width: 80 }}
                        value={this.state.userColor}
                        onChange={(val) => this.setState({ userColor: val })}
                        onEnter={this.sendUserStateChange} />
                        <button style={{ backgroundColor: this.state.userColor }} onClick={() => { this.setState({ userColor: randomColor }) }} >random</button> color
                    </li>
                    {validationMarkup}
                    {changeUserStateBtn}
                    {inputList}
                    {volumeMarkup}
                    {/* {verbMarkup} */}
                    {pbrangeMarkup}
                </ul>
            </div>
        );
    }
}




class Connection extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            userName: '',
            userColor: `rgb(${[1, 2, 3].map(x => Math.random() * 256 | 0)})`,
            showValidationErrors: false, // don't show until you try to connect
        };

        if (Cookies.get(getRoomID(this.props.app) + "_userName")) {
            this.state.userName = Cookies.get(getRoomID(this.props.app) + "_userName");
        }
        if (Cookies.get(getRoomID(this.props.app) + "_userColor")) {
            this.state.userColor = Cookies.get(getRoomID(this.props.app) + "_userColor");
        }
    }

    componentDidMount() {
        this.nameInput.inputRef.focus();
    }

    goConnect = () => {
        let msg = getValidationErrorMsg(this.state.userName, this.state.userColor);
        if (msg) {
            this.setState({ showValidationErrors: true });
            return;
        }
        this.props.handleConnect(this.state.userName, this.state.userColor);
    }

    render() {
        const randomColor = `rgb(${[1, 2, 3].map(x => Math.random() * 256 | 0)})`;

        //let sanitizedName = sanitizeUsername(this.state.userName);
        const validationErrorTxt = getValidationErrorMsg(this.state.userName, this.state.userColor);

        const validationError = validationErrorTxt.length && this.state.showValidationErrors ? (
            <div class='validationError'>{validationErrorTxt}</div>
        ) : null;

        return (
            <div className="component">
                <h2>Connect</h2>
                <ul>
                    <li><TextInputField ref={(input) => { this.nameInput = input; }} style={{ width: 80 }} default={this.state.userName} onChange={(val) => this.setState({ userName: val })} onEnter={this.goConnect} /> name</li>
                    <li><TextInputFieldExternalState
                        style={{ width: 80 }}
                        value={this.state.userColor}
                        onChange={(val) => this.setState({ userColor: val })}
                        onEnter={this.goConnect} />
                        <button style={{ backgroundColor: this.state.userColor }} onClick={() => { this.setState({ userColor: randomColor }) }} >random</button> color
                    </li>
                    <button onClick={this.goConnect}>Connect</button>
                    {validationError}
                </ul>
            </div>
        );
    }
}




class UserList extends React.Component {
    render() {
        if (!this.props.app || !this.props.app.roomState) {
            return null;
        }
        //         let meText = (u.userID == digifuApp.myUser.userID) ? "<ME>" : "";

        const room = this.props.app.rooms && this.props.app.rooms.find(r => r.roomID == this.props.app.roomState.roomID);


        const users = this.props.app.roomState.users.map(u => (
            <li key={u.userID}><span className="userName" style={{ color: u.color }}>{u.name}</span><span className="userPing"> ({u.pingMS}ms ping)</span></li>
        ));

        return (
            <div className="component">
                <h2>{this.props.app.roomState.roomTitle}</h2>
                {room &&
                    <ul className="roomStats">
                        <li>🧑{room.users.length}</li>
                        <li>🎵{room.stats.noteOns}</li>
                        <li>👏{room.stats.cheers}</li>
                        <li>📝{room.stats.messages}</li>
                    </ul>
                }
                <ul>
                    {users}
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

        const rooms = this.props.app.rooms.filter(r => r.roomID != this.props.app.roomState.roomID);

        let userList = (room) => room.users.map(u => (
            <li key={u.userID}><span className="userName" style={{ color: u.color }}>{u.name}</span><span className="userPing"> ({u.pingMS}ms ping)</span></li>
        ));

        const roomsMarkup = rooms.map(room => (
            <div className="room">
                <h2>{room.roomName}</h2>
                <ul className="roomStats">
                    <li>🧑{room.users.length}</li>
                    <li>🎵{room.stats.noteOns}</li>
                    <li>👏{room.stats.cheers}</li>
                    <li>📝{room.stats.messages}</li>
                </ul>
                <ul className="userList">
                    {userList(room)}
                </ul>
            </div>
        ));

        return (
            <div className="component worldStatus">
                <h2>Other rooms</h2>
                {roomsMarkup}
            </div>
        );
    }
}


class InstrumentList extends React.Component {

    renderInstrument(i) {
        let app = this.props.app;
        if (i.controlledByUserID == app.myUser.userID) {
            return null;
            // return (
            //     <li key={i.instrumentID} style={{ color: i.color }}><button onClick={() => app.ReleaseInstrument()}>Release</button> {i.name} (#{i.instrumentID}) [yours]</li>
            // );
        }

        let inUse = false;
        let idle = false;
        if (i.controlledByUserID) {
            inUse = true;
            let foundUser = this.props.app.roomState.FindUserByID(i.controlledByUserID);
            //console.log(`rendering instrument controlled by ${i.controlledByUserID}`);
            if (foundUser) {
                if (foundUser.user.idle) {
                    // user is taken, but considered idle. so we can show it.
                    idle = true;
                    //console.log(` ==> idle = true inst ${i.instrumentID} user ${i.controlledByUserID}`);
                }
            }
        }

        let ownedByText = "";
        if (inUse && !idle) {
            return null;
        }

        idle = idle && (<span className="idleIndicator">(Idle)</span>);

        const playBtn = app.midi.AnyMidiDevicesAvailable() ? (
            <button onClick={() => app.RequestInstrument(i.instrumentID)}>Take</button>
        ) : null;

        return (
            <li key={i.instrumentID} style={{ color: i.color }}>
                {playBtn}
                {idle} {i.getDisplayName()} {ownedByText}</li>
        );
    }
    render() {
        if (!this.props.app || !this.props.app.roomState || (this.props.app.roomState.instrumentCloset.length < 1)) {
            return null;
        }
        const instruments = this.props.app.roomState.instrumentCloset.map(i => this.renderInstrument(i));
        return (
            <div className="component" style={{ whiteSpace: "nowrap" }}>
                <h2>Instrument Closet</h2>
                <ul>
                    {instruments}
                </ul>
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
            instParams = (<InstrumentParams app={this.props.app} instrument={myInstrument} toggleWideMode={this.props.toggleWideMode} isWideMode={this.props.isWideMode}></InstrumentParams>);
        }
        return (
            <div id="rightArea" style={{ gridArea: "rightArea" }}>
                {instParams}
                <UserList app={this.props.app} />
                <WorldStatus app={this.props.app} />
            </div>
        );
    }
}

class LeftArea extends React.Component {

    render() {
        const userState = (!this.props.app) ? null : (
            <UserState app={this.props.app} handleConnect={this.props.handleConnect} handleDisconnect={this.props.handleDisconnect} />
        );
        return (
            <div id="leftArea" style={{ gridArea: "leftArea" }}>
                {userState}
                <InstrumentList app={this.props.app} />
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
                <div><span className="userName">{this.props.user.name}</span></div>
                {instMarkup}
            </div>
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
        if (this.props.item.itemType == DFRoomItemType.sign) {

            let signStyle = Object.assign({
                left: pos.x,
                top: pos.y,
                opacity: this.props.item.params.isShown ? "100%" : "0",
            }, this.props.item.params.style);

            signMarkup = (<div className="roomSign" onClick={this.onClickSign} style={signStyle}
                dangerouslySetInnerHTML={{ __html: this.props.item.params.message }}></div>
            );
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
                case ChatMessageType.aggregate:
                    {
                        return msg.messages.map(aggMsg => (
                            <div className="chatLogEntryAggregate" key={msg.messageID}>{timestamp} {aggMsg}</div>
                        ));
                    }
                case ChatMessageType.join:
                    let fromRoomTxt = msg.fromRoomName && `(from ${msg.fromRoomName})`;
                    return (
                        <div className="chatLogEntryJoin" key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>{msg.fromUserName} has joined the {this.props.app.roomState.roomTitle} jam {fromRoomTxt}</span></div>
                    );
                case ChatMessageType.part:
                    let toRoomTxt = msg.toRoomName && `(to ${msg.toRoomName})`;
                    return (
                        <div className="chatLogEntryJoin" key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>{msg.fromUserName} has left the {this.props.app.roomState.roomTitle} jam {toRoomTxt}</span></div>
                    );
                case ChatMessageType.nick:
                    return (
                        <div className="chatLogEntryNick" key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>{msg.fromUserName} is now known as {msg.toUserName}</span></div>
                    );
                case ChatMessageType.chat:
                    return (
                        <div className="chatLogEntryChat" key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>[{msg.fromUserName}]</span> {msg.message}</div>
                    );
            }

            return null;
        });

        return (
            <div className='shortChatLog'>
                {/* <button className="switchChatView" onClick={this.props.onToggleView}>Switch view</button> */}
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
                case ChatMessageType.join:
                    let fromRoomTxt = msg.fromRoomName && `(from ${msg.fromRoomName})`;
                    return (
                        <li className="chatLogEntryJoin" key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>{msg.fromUserName} has joined the {this.props.app.roomState.roomTitle} jam {fromRoomTxt}</span></li>
                    );
                case ChatMessageType.part:
                    let toRoomTxt = msg.toRoomName && `(to ${msg.toRoomName})`;
                    return (
                        <li className="chatLogEntryJoin" key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>{msg.fromUserName} has left the {this.props.app.roomState.roomTitle} jam {toRoomTxt}</span></li>
                    );
                case ChatMessageType.nick:
                    return (
                        <li className="chatLogEntryNick" key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>{msg.fromUserName} is now known as {msg.toUserName}</span></li>
                    );
                case ChatMessageType.chat:
                    return (
                        <li className="chatLogEntryChat" key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>[{msg.fromUserName}]</span> {msg.message}</li>
                    );
            }

            return null;
        });

        return (
            <div className='fullChatLog'>
                {/* <button className="switchChatView" onClick={this.props.onToggleView}>Switch view</button> */}
                <ul style={{ height: "100%" }}>
                    {lis}
                </ul>
            </div>
        );
    }
};









class AnnouncementArea extends React.Component {
    render() {
        if (!this.props.app || !this.props.app.roomState) return null;

        return (
            <div id="announcementArea" dangerouslySetInnerHTML={{ __html: this.props.app.roomState.announcementHTML }}></div>
        );
    }
};

class RoomAlertArea extends React.Component {
    render() {
        if (!this.props.app || !this.props.app.roomState) return null;

        if (this.props.app.myInstrument && !this.props.app.midi.IsListeningOnAnyDevice()) {
            return (
                <div id="roomAlertArea">
                    <div>Select a MIDI input device to start playing</div>
                    {this.props.app.deviceNameList.map(i => (
                        <button onClick={() => this.props.app.midi.ListenOnDevice(i)}>Start using {i}</button>
                    ))}
                </div>
            );
        }
        return null;
    }
};

class RoomArea extends React.Component {
    constructor(props) {
        console.log(`RoomArea ctor`);
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
        this.resizeObserver = new ResizeObserver((entries) => {
            this.updateScrollSize();
        });
        this.resizeObserver.observe(e);

        this.updateScrollSize();
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

            userAvatars = this.props.app.roomState.users.map(u => (
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
            <Connection app={this.props.app} handleConnect={this.props.handleConnect} handleDisconnect={this.props.handleDisconnect} />
        );

        const switchViewButton = this.props.app && this.props.app.roomState && (<button className="switchChatView" onClick={this.toggleChatView}>chat/room view</button>);

        return (
            <div id="roomArea" className="roomArea" onClick={e => this.onClick(e)} style={style}>
                {connection}
                {userAvatars}
                {roomItems}
                { !this.state.showFullChat && <ShortChatLog app={this.props.app} onToggleView={this.toggleChatView} />}
                { this.state.showFullChat && <FullChatLog app={this.props.app} onToggleView={this.toggleChatView} />}
                <AnnouncementArea app={this.props.app} />
                <RoomAlertArea app={this.props.app} />
                <CheerControls app={this.props.app} displayHelper={this}></CheerControls>
                {switchViewButton}

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
        sanitized = sanitized.substr(0, ServerSettings.ChatMessageLengthMax);
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

class RootArea extends React.Component {
    OnStateChange() {
        this.setState(this.state);
    }

    HandleConnect = (userName, color) => {
        let app = new DigifuApp();

        // copied from ctor
        this.notesOn = []; // not part of state because it's pure jquery
        // notes on keeps a list of references to a note, since multiple people can have the same note playing it's important for tracking the note offs correctly.
        for (let i = 0; i < 128; ++i) {
            this.notesOn.push([]); // empty initially.
        }

        app.Connect(userName, color, () => this.OnStateChange(), this.handleNoteOn, this.handleNoteOff,
            this.handleUserAllNotesOff, this.handleAllNotesOff,
            this.handleUserLeave, this.HandleNetworkDisconnected,
            this.HandleCheer, this.handleRoomWelcome);
        this.setState({ app });
    }

    handleRoomRef = (r) => {
        let a = 0;
    };

    handleRoomWelcome = () => {
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

    HandleNetworkDisconnected = () => {
        // actually at this point socket.io will attempt to reconnect again and when it does, 
        // the flow of events just replays regarding handshake and welcome msg etc. so nothing needs to be done.
    };

    // called for "user clicked disconnect button".
    HandleDisconnect = () => {
        this.state.app.Disconnect();
        this.setState({ app: null });
    }

    handleNoteOn = (user, instrument, midiNote, velocity) => {
        $('#userAvatar' + user.userID).toggleClass('userAvatarActivityBump1').toggleClass('userAvatarActivityBump2');

        this.notesOn[midiNote].push({ userID: user.userID, color: user.color });
        this.activityCount++;

        let k = $("#key_" + midiNote);
        if (!k.hasClass('active')) {
            k.addClass("active");
        }
        k.css("background-color", user.color);
    }

    removeUserNoteRef(userID, midiNote) {
        let refs = this.notesOn[midiNote];
        refs.removeIf(r => (r.userID == userID));

        let k = $("#key_" + midiNote);
        if (refs.length < 1) {
            k.removeClass("active");
            k.css("background-color", "");
            return;
        }
        k.css("background-color", refs[refs.length - 1].color);
    }

    handleNoteOff = (user, instrument, midiNote) => {
        let refs = this.notesOn[midiNote];
        if (refs.length < 1) return;

        this.removeUserNoteRef(user.userID, midiNote);
    }

    handleUserAllNotesOff = (user, instrument) => {
        // remove all refs of this user
        this.notesOn.forEach((refs, midiNote) => {
            if (refs.length < 1) return;
            this.removeUserNoteRef(user.userID, midiNote);
        });
    };

    handleAllNotesOff = () => {
        this.notesOn = []; // not part of state because it's pure jquery
        // notes on keeps a list of references to a note, since multiple people can have the same note playing it's important for tracking the note offs correctly.
        for (let i = 0; i < 128; ++i) {
            this.notesOn.push([]); // empty initially.
        }
    };

    handleUserLeave = (userID) => {
        this.notesOn.forEach((ref, i) => {
            this.removeUserNoteRef(userID, i);
        });
    }

    toggleWideMode = () => {
        this.setState({ wideMode: !this.state.wideMode });
    };

    constructor(props) {
        super(props);
        this.state = {
            app: null,
            wideMode: false,
        };

        gStateChangeHandler = this;

        this.notesOn = []; // not part of state because it's pure jquery
        this.activityCount = 0;
        this.roomRef = React.createRef();

        // notes on keeps a list of references to a note, since multiple people can have the same note playing it's important for tracking the note offs correctly.
        for (let i = 0; i < 128; ++i) {
            this.notesOn.push([]); // empty initially.
        }
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
            title = `${this.state.app.roomState.roomTitle} ${activityTxt} [${this.state.app.roomState.users.length}]`;
        }
        if (document.title != title) {
            document.title = title;
        }

        if (this.state.wideMode && (!this.state.app || !this.state.app.myInstrument)) {
            setTimeout(() => {
                this.setState({ wideMode: false });
            }, 1);            
        }

        const url = window.location.href.split('?')[0];
        return (
            <div id="grid-container" className={this.state.wideMode && "wide"}>
                <div style={{ gridArea: "headerArea", textAlign: 'center' }} className="headerArea">
                    <span style={{ float: 'left' }}>
                        <a target="_blank" href="https://github.com/thenfour/digifujam">github</a>
                        {/* <a target="_blank" href="{url}">{url}</a> */}</span>
                    <span style={{ float: 'right' }}>
                        <a target="_blank" href="https://twitter.com/tenfour2">Made by tenfour</a>
                    </span>
                </div>
                <PianoArea app={this.state.app} />
                <ChatArea app={this.state.app} />
                <RoomArea app={this.state.app} handleConnect={this.HandleConnect}
                    handleDisconnect={() => this.HandleDisconnect()}
                    ref={this.roomRef} />
                <RightArea app={this.state.app} handleConnect={this.HandleConnect} handleDisconnect={() => this.HandleDisconnect()} toggleWideMode={this.toggleWideMode} isWideMode={this.state.wideMode} />
                <LeftArea app={this.state.app} handleConnect={this.HandleConnect} handleDisconnect={() => this.HandleDisconnect()} />

            </div>
        );
    }
}
