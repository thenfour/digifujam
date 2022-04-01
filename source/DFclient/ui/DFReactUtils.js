const React = require('react');
const DF = require('../../DFcommon/DFCommon');

let getRoomID = function (app) {
    if (!app) return window.DFRoomID;
    if (!app.roomState) return window.DFRoomID;
    return app.roomState.roomID;
}

let getValidationErrorMsg = function (userName, userColor) {
    let sanitizedName = DF.sanitizeUsername(userName);
    let validationErrorTxt = (sanitizedName != null) ? "" : "! Please enter a valid username";

    let sanitizedColor = DF.sanitizeUserColor(userColor);
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


// props
// - onChange
// - onEnter
// - value
// - style
class PasswordInput extends React.Component {
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
            <input type="password" style={this.props.style} value={this.props.value} onChange={this.handleChange} onKeyDown={this.handleKeyDown} />
        );
    }
}





/////////////////////////////////////////////////////////////////////////////////////////////////////////
// allow live editing
// props.fieldID
// props.valueSetter
// props.valueGetter
// props.readOnly
// props.maxLength
class TextField extends React.Component {
    constructor(props) {
        super(props);
        this.inpID = "textField_" + this.props.fieldID;
        this.renderedValue = "";
    }
    onChange = (e) => {
        let val = e.target.value;
        this.renderedValue = val;
        this.props.valueSetter(val);
    }
    componentDidMount() {
        // set initial values.
        let val = this.props.valueGetter();
        $("#" + this.inpID).val(val);
        this.renderedValue = val;
    }
    render() {
       let val = this.props.valueGetter();
        if (this.renderedValue != val) {
            //has been externally modified. update ui.
            this.renderedValue = val;
            $("#" + this.inpID).val(val);
        }
 
        return (
          <input readOnly={this.props.readOnly} id={this.inpID} type="text" maxLength={this.props.maxLength} onChange={this.onChange} />
        );
    }
 }
 
 
 


module.exports = {
    TextField,
    TextInputField,
    TextInputFieldExternalState,
    PasswordInput,
    getRoomID,
    getValidationErrorMsg,
};
