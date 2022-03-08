const React = require('react');
const DFReactUtils = require("./DFReactUtils");
const {GoogleOAuthModule, GoogleSignInButton} = require('../googleSignIn');
const DF = require('../../DFcommon/DFCommon');

const gAutoJoin = true;

class Connection extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            userName: '',
            userColor: `rgb(${[1, 2, 3].map(x => Math.random() * 256 | 0)})`,
            showValidationErrors: false, // don't show until you try to connect
        };

        this.props.googleOAuthModule.events.on(GoogleOAuthModule.Events.receivedToken, this.OnReceiveGoogleAccessToken);
        this.props.googleOAuthModule.events.on(GoogleOAuthModule.Events.beforeRedirect, this.OnBeforeRedirect);

        if (window.localStorage.getItem("staySignedIn")) {
            this.state.staySignedIn = window.localStorage.getItem("staySignedIn");
        }
        if (window.localStorage.getItem("userName")) {
            this.state.userName = window.localStorage.getItem("userName");
        }
        if (window.localStorage.getItem("userColor")) {
            this.state.userColor = window.localStorage.getItem("userColor");
        }
        if (gAutoJoin) {
            this.goConnect();
        }
    }

    OnReceiveGoogleAccessToken = (access_token) => {
        this.goConnect(access_token);
    }

    OnBeforeRedirect = (e) => {
        let msg = DFReactUtils.getValidationErrorMsg(this.state.userName, this.state.userColor);
        if (msg) {
            this.setState({showValidationErrors : true});
            e.valid = false;
            return;
        }
        window.localStorage.setItem("userName", this.state.userName);
        window.localStorage.setItem("userColor", this.state.userColor);
    }

    componentDidMount() {
        if (this.nameInput && this.nameInput.inputRef) {
            this.nameInput.inputRef.focus();
        }
    }

    componentWillUnmount() {
        this.props.googleOAuthModule.events.removeListener(GoogleOAuthModule.Events.receivedToken, this.OnReceiveGoogleAccessToken);
        this.props.googleOAuthModule.events.removeListener(GoogleOAuthModule.Events.beforeRedirect, this.OnBeforeRedirect);
    }

    goConnect = (google_access_token) => {

        let userName = this.state.userName;
        let userColor = this.state.userColor;

        if (gAutoJoin) {
            // ensure a valid username.
            userName = DF.EnsureValidUsername(userName);
            userColor = DF.EnsureValidUserColor(userColor);
            this.props.handleConnect(userName, userColor, google_access_token);
            return;
        }

        let msg = DFReactUtils.getValidationErrorMsg(userName, userColor);
        if (msg) {
            this.setState({ showValidationErrors: true });
            return;
        }

        this.props.handleConnect(userName, userColor, google_access_token);
    }

    onClickLoginAnonymous = (e) => {
        this.goConnect();
    }

    render() {
        const randomColor = `rgb(${[1, 2, 3].map(x => Math.random() * 256 | 0)})`;

        const validationErrorTxt = DFReactUtils.getValidationErrorMsg(this.state.userName, this.state.userColor);

        const validationError = validationErrorTxt.length && this.state.showValidationErrors ? (
            <div className='validationError'>{validationErrorTxt}</div>
        ) : null;

        let showLoginControls = !this.props.googleOAuthModule.IsSignInInProgress();

        return (
            <div className="signinScreen">
                <div className="component">
                    <h2>Connect</h2>
                    <ul>
                        {showLoginControls &&
                            <li><DFReactUtils.TextInputField
                                ref={(input) => { this.nameInput = input; }}
                                style={{ width: 120 }}
                                default={this.state.userName}
                                onChange={(val) => this.setState({ userName: val })}
                            />
                        nickname
                        </li>}
                        {showLoginControls &&
                            <li><DFReactUtils.TextInputFieldExternalState
                                style={{ width: 120 }}
                                value={this.state.userColor}
                                onChange={(val) => this.setState({ userColor: val })}
                            />
                                <button style={{ backgroundColor: this.state.userColor }} onClick={() => { this.setState({ userColor: randomColor }) }} >random</button> color
                    </li>}

                        {showLoginControls &&
                            <li>
                                <button onClick={this.onClickLoginAnonymous}>Enter</button>
                            </li>}
                        {
                            <li>
                                <GoogleSignInButton module={this.props.googleOAuthModule}></GoogleSignInButton>
                            </li>
                        }

                    </ul>


                    {validationError}
                </div>
            </div>
        );
    }
}


module.exports = {
    Connection,
};
