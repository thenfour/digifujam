const React = require('react');
const DFReactUtils = require("./DFReactUtils");

const GetHomepage = () => {
    const st = window.localStorage.getItem("DFHomepage");
    if (st) return st;
    return window.location.origin;
};

class Connection extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            userName: '',
            userColor: `rgb(${[1, 2, 3].map(x => Math.random() * 256 | 0)})`,
            showValidationErrors: false, // don't show until you try to connect
            googleAuthURL: null,
            staySignedIn: true,
        };

        if (window.localStorage.getItem("staySignedIn")) {
            this.state.staySignedIn = window.localStorage.getItem("staySignedIn");
        }
        if (window.localStorage.getItem("userName")) {
            this.state.userName = window.localStorage.getItem("userName");
        }
        if (window.localStorage.getItem("userColor")) {
            this.state.userColor = window.localStorage.getItem("userColor");
        }
    }

    isGoogleRedirect = () => {
        let queryParams = new URLSearchParams(window.location.search);
        return queryParams.get("code") && queryParams.get("scope").includes("google");
    };

    isHomepageRedirectForURLSanitization = () => {
        return !!window.localStorage.getItem("google_auth_code");
    };

    componentDidMount() {
        if (this.nameInput && this.nameInput.inputRef) {
            this.nameInput.inputRef.focus();
        }

        let queryParams = new URLSearchParams(window.location.search);
        if (this.isGoogleRedirect()) {
            // #3: you have just been redirected back after positive google consent form.
            // - store queryparams in session cookie, redirect to homepage to clean the URL bar URL.
            //console.log(`#3: google gave code ${queryParams.get("code")}; directing to ${GetHomepage()}`);
            window.localStorage.setItem("google_auth_code", queryParams.get("code"));
            window.location.href = GetHomepage();
        } else if (this.isHomepageRedirectForURLSanitization()) {
            // #4: you've been redirected to homepage from #3.
            const authCode = window.localStorage.getItem("google_auth_code");
            window.localStorage.removeItem('google_auth_code');
            this.setState({ isWaitingForGoogleAuth: true });

            //console.log(`#4: homepage (clean URL) with code ${authCode}. initiating ajax to get a real token.`);
            $.ajax({
                type: 'GET',
                url: '/google_complete_authentication',
                data: { code: authCode },
                dataType: 'json',
                success: (data) => {
                    //window.sessionStorage.setItem("google_access_token", data.google_access_token);
                    //console.log(` ajax reply with real access token ${data.google_access_token}. now proceeding to connect.`);
                    //console.log(data);
                    window.localStorage.removeItem('isWaitingForGoogleAuth');
                    this.goConnect(data.google_access_token);
                }
            });
        } else {
            // otherwise you're just not connected; default state. get a google login URL
            $.ajax({
                type: 'GET',
                url: '/google_auth_url',
                dataType: 'json',
                success: (data) => {
                    if (data.url) {
                        this.setState({ googleAuthURL: data.url });
                    }
                }
            });
        }
    }

    onClickGoogleSignin = () => {
        let msg = DFReactUtils.getValidationErrorMsg(this.state.userName, this.state.userColor);
        if (msg) {
            this.setState({ showValidationErrors: true });
            return;
        }
        window.localStorage.setItem("DFHomepage", window.location.href);
        window.localStorage.setItem("userName", this.state.userName);
        window.localStorage.setItem("userColor", this.state.userColor);
        window.location.href = this.state.googleAuthURL;
    }

    goConnect = (google_access_token) => {
        let msg = DFReactUtils.getValidationErrorMsg(this.state.userName, this.state.userColor);
        if (msg) {
            this.setState({ showValidationErrors: true });
            return;
        }
        window.localStorage.setItem("DFHomepage", window.location.href);
        this.props.handleConnect(this.state.userName, this.state.userColor, google_access_token);
    }

    onClickLoginAnonymous = (e) => {
        this.goConnect();
    }

    clickStaySignedIn = (e) => {
        this.setState({staySignedIn : !this.state.staySignedIn});
    }

    render() {
        const randomColor = `rgb(${[1, 2, 3].map(x => Math.random() * 256 | 0)})`;

        //let sanitizedName = sanitizeUsername(this.state.userName);
        const validationErrorTxt = DFReactUtils.getValidationErrorMsg(this.state.userName, this.state.userColor);

        const validationError = validationErrorTxt.length && this.state.showValidationErrors ? (
            <div className='validationError'>{validationErrorTxt}</div>
        ) : null;

        const showLoginControls = !(this.isGoogleRedirect() || this.isHomepageRedirectForURLSanitization()) && !this.state.isWaitingForGoogleAuth;
        let queryParams = new URLSearchParams(window.location.search);

        return (
            <div className="signinScreen">
                <div className="component">
                    <h2>Connect</h2>
                    <ul>
                        {this.state.isWaitingForGoogleAuth &&
                            <div className="lds-facebook"><div></div><div></div><div></div></div>
                        }
                        {showLoginControls &&
                            <li><DFReactUtils.TextInputField
                                ref={(input) => { this.nameInput = input; }}
                                style={{ width: 80 }}
                                default={this.state.userName}
                                onChange={(val) => this.setState({ userName: val })}
                            />
                        nickname
                        </li>}
                        {showLoginControls &&
                            <li><DFReactUtils.TextInputFieldExternalState
                                style={{ width: 80 }}
                                value={this.state.userColor}
                                onChange={(val) => this.setState({ userColor: val })}
                            />
                                <button style={{ backgroundColor: this.state.userColor }} onClick={() => { this.setState({ userColor: randomColor }) }} >random</button> color
                    </li>}
                        {showLoginControls &&
                            <li>
                                <button onClick={this.onClickLoginAnonymous}>Enter as guest</button>
                            </li>}
                        {showLoginControls && this.state.googleAuthURL &&
                            <li>
                                <button className="googleLoginButton" onClick={this.onClickGoogleSignin}></button><br />
                                {/* <button className={"stayLoggedIn" + (this.state.staySignedIn ? " on" : "")} onClick={this.clickStaySignedIn}>Stay signed in</button> */}
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
