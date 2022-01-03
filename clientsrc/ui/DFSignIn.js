const React = require('react');
const DFReactUtils = require("./DFReactUtils");
const {GoogleOAuthModule, GoogleSignInButton} = require('../googleSignIn');

class Connection extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            userName: '',
            userColor: `rgb(${[1, 2, 3].map(x => Math.random() * 256 | 0)})`,
            roomKey: "",
            showValidationErrors: false, // don't show until you try to connect
        };

        this.props.googleOAuthModule.events.on(GoogleOAuthModule.Events.receivedToken, 
            (access_token) => 
            {
                this.goConnect(access_token);
            });

        this.props.googleOAuthModule.events.on(GoogleOAuthModule.Events.beforeRedirect, (e) => {
            let msg = DFReactUtils.getValidationErrorMsg(this.state.userName, this.state.userColor);
            if (msg) {
                this.setState({showValidationErrors : true});
                e.valid = false;
                return;
            }
            window.localStorage.setItem("userName", this.state.userName);
            window.localStorage.setItem("userColor", this.state.userColor);
            window.localStorage.setItem("roomKey", this.state.roomKey);
        });

        if (window.localStorage.getItem("staySignedIn")) {
            this.state.staySignedIn = window.localStorage.getItem("staySignedIn");
        }
        if (window.localStorage.getItem("userName")) {
            this.state.userName = window.localStorage.getItem("userName");
        }
        if (window.localStorage.getItem("userColor")) {
            this.state.userColor = window.localStorage.getItem("userColor");
        }
        if (window.localStorage.getItem("roomKey")) {
            this.state.roomKey = window.localStorage.getItem("roomKey");
        }
    }

    componentDidMount() {
        if (this.nameInput && this.nameInput.inputRef) {
            this.nameInput.inputRef.focus();
        }
    }

    goConnect = (google_access_token) => {
        let msg = DFReactUtils.getValidationErrorMsg(this.state.userName, this.state.userColor);
        if (msg) {
            this.setState({ showValidationErrors: true });
            return;
        }
        this.props.handleConnect(this.state.userName, this.state.userColor, this.state.roomKey, google_access_token);
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
                        {window.DFRoomWantsKey && <li><DFReactUtils.PasswordInput
                            style={{ width: 120 }}
                            value={this.state.roomKey}
                            onChange={(val) => this.setState({ roomKey: val })}
                        />
                        Room key
                        </li>}

                        {showLoginControls &&
                            <li>
                                <button onClick={this.onClickLoginAnonymous}>Enter as guest</button>
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
    Connection
};
