const React = require('react');
const DF = require("../DFCommon");

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




module.exports = {
    TextInputField,
    TextInputFieldExternalState,
    PasswordInput,
    getRoomID,
    getValidationErrorMsg,
};
