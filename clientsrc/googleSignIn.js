const React = require('react');
const EventEmitter = require('events');

// Google OAuth flow reference
// https://developers.google.com/identity/protocols/oauth2

/*

WORKFLOW:

1. client gets a google login URL via /google_auth_url. this is a simple API call on the server to generate an auth url we redirect to on click.

2. user clicks the Sign in button,
   - save some login state to window.localStorage to persist data between page loads. (see DFSignIn)
   - redirect to the google auth url

3. stuff happens on google's site, they redirect to the URL we told it to, with some querystring params.
   the URL will be like,
    http://localhost:8081/?
      code=4%2F0AX4XfWgMfGo1hLJnfZYjMbsnfGAlhwV1Kqs2DTwqpCt12TFf9FHK2ulReziODtkINIvxIA
      &scope=email+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.email+openid
      &authuser=0
      &prompt=consent#

   we want to redirect to a sanitized URL so we replace the browser's history with a clean URL.
   this used to be a navigate but i want to avoid page reloads.

4. ask server (AJAX call to /google_complete_authentication) to convert the auth_code to the required tokens

   - server: uses google API to get the needed tokens, and sends back to the client via json.

   - client: main Connect() call.

We also save the refresh_token to local storage, and send to server in the initial /google_auth_url call;
the server can immediately convert this to an access token and return that for an immediate login.

SO, to modularize this we have GoogleOAuthModule as the main module which is essentially global
because it's tied so closely to the page state. it reacts to global page state and directs it via
window.href=

   OAUTH_MODULE
   events:
      - receivedGoogleURL
      - beforeRedirect
      - receivedToken
      - signOut
   methods:
      - OnPageLoaded();
      - InitiateSignIn()
      - SignOut()
   state:
      - should login controls be shown
      - is user signed in?

*/

class GoogleOAuthEventSource extends EventEmitter {}

class GoogleOAuthModule {

   static Events = {
      receivedGoogleURL : 'receivedGoogleURL',
      beforeRedirect: 'beforeRedirect',
      receivedToken: 'receivedToken',
      signOut: 'signOut',
   };

   constructor() {
      this.events = new GoogleOAuthEventSource();
      this.googleAuthURL = null;
      this.isSignedIn = false;
      this.pageLoaded = false;
   }

   receivedToken(access_token) {
      this.isSignedIn = true;
      this.events.emit(GoogleOAuthModule.Events.receivedToken, access_token);
   }

   receivedGoogleURL(googleAuthURL) {
      this.events.emit(GoogleOAuthModule.Events.receivedGoogleURL, googleAuthURL);
   }

   beforeRedirect() {
      const e = {
         valid : true,
      };
      this.events.emit(GoogleOAuthModule.Events.beforeRedirect, e);
      return e.valid;
   }

   isGoogleRedirect = () => {
      let queryParams = new URLSearchParams(window.location.search);
      return queryParams.get("code") && queryParams.get("scope").includes("google");
   };

   HaveGoogleURL() {
      const ret = !!this.googleAuthURL;
      return ret;
   }

   IsSignInInProgress() {
      return this.isWaitingForGoogleAuth;
   }

   IsSignedIn() {
      return this.isSignedIn;
   }

   FetchGoogleSignInURL() {
      const data = {
         redirect : window.location.href,
      };
      //if (allowAutoSignIn) {
         data.google_refresh_token = window.localStorage.getItem("google_refresh_token");
      //}
      $.ajax({
         type : 'GET',
         url : '/google_auth_url',
         data,
         dataType : 'json',
         success : (data) => {
            if (data.google_access_token) {
               // you are still logged in via refresh token
               this.receivedToken(data.google_access_token);
               return;
            } else if (data.url) {
               this.googleAuthURL = data.url;
               this.receivedGoogleURL(this.googleAuthURL);
            }
         }
      });
   }

   // call to init redirects etc.
   OnPageLoaded() {
      console.assert(!this.pageLoaded);
      this.pageLoaded = true;

      this.FetchGoogleSignInURL();
      if (!this.isGoogleRedirect()) {
         return;
      }
      let queryParams = new URLSearchParams(window.location.search);
      // #3: you have just been redirected back after positive google consent form.
      // - store queryparams in session cookie, redirect to homepage to clean the URL bar URL.
      const authCode = queryParams.get("code");

      const redirectURL = window.localStorage.getItem("google_redirect_url");
      this.isWaitingForGoogleAuth = true;
      window.history.replaceState({}, '', redirectURL);

      $.ajax({
         type : 'GET',
         url : '/google_complete_authentication',
         data : {code : authCode},
         dataType : 'json',
         success : (data) => {

            if (window.localStorage.getItem("staySignedIn") == 'yes') {
               window.localStorage.setItem('google_refresh_token', data.google_refresh_token);
            }

            this.isWaitingForGoogleAuth = false;

            this.receivedToken(data.google_access_token);
         }
      });
      return;
   }

   InitiateSignIn(staySignedIn) {
      if (!this.beforeRedirect()) {
         return;
      }
      window.localStorage.setItem("staySignedIn", staySignedIn ? "yes" : "no");
      window.localStorage.setItem("google_redirect_url", window.location.href);
      window.location.href = this.googleAuthURL;
   }

   SignOut() {
      // there's not really much to do; just forget the identity, and tell the server to demote our account.
      this.isSignedIn = false;
      window.localStorage.removeItem('google_refresh_token'); // prevent further auto-signin
      this.events.emit(GoogleOAuthModule.Events.signOut);
   }
}

class GoogleSignInButton extends React.Component {
   constructor(props) {
      super(props);

      this.state = {
         staySignedIn : false,
      };

      this.props.module.events.on(GoogleOAuthModule.Events.receivedGoogleURL, this.OnGoogleURLReceived);
   }

   OnGoogleURLReceived = () => {
      this.setState({});
   };

   componentWillUnmount() {
      this.props.module.events.removeListener(GoogleOAuthModule.Events.receivedGoogleURL, this.OnGoogleURLReceived);
   }


   onClickGoogleSignin = () => {
      this.props.module.InitiateSignIn(this.state.staySignedIn);
   }

   clickStaySignedIn = (e) => {
      this.setState({staySignedIn : !this.state.staySignedIn});
   }

   render() {

      // UI states:
      // - not available (no URL)
      // - not signed in but ready (have URL, not signed in)
      // - sign in in progress
      // - signed in (show sign out)

      if (this.props.module.IsSignedIn()) {
         return (<div>You are signed in via Google</div>);
      }
      if (this.props.module.IsSignInInProgress()) return (<div className="lds-facebook"><div></div><div></div><div></div></div>);
      if (!this.props.module.HaveGoogleURL()) return null;
      return (
        <div className='homeGoogleSignInContainer'>
            <button className="googleLoginButton" onClick={this.onClickGoogleSignin}></button>
            {/* buttons are just simpler in react than checkboxes */}
            <button className = {"stayLoggedIn" + (this.state.staySignedIn ? " on" : "")} onClick = {this.clickStaySignedIn}>{(this.state.staySignedIn ? "✅" : "⬜")} Stay signed in</button>
         </div>);
      }
   }

   // component to use on user settings dialog to provide:
   // sign out
   // promotion of account to google
   class GoogleUserSettings extends React.Component {
      constructor(props) {
         super(props);

         this.state = {
            staySignedIn : false,
         };

         this.props.module.events.on(GoogleOAuthModule.Events.receivedGoogleURL, () => {
            this.setState({});
         });
      }

      onClickGoogleSignin = () => {
         this.props.module.InitiateSignIn(this.state.staySignedIn);
      }

      clickStaySignedIn = (e) => {
         this.setState({staySignedIn : !this.state.staySignedIn});
      }

      OnSignOutClicked = (e) => {
         this.props.module.SignOut();
      }

      render() {

         if (this.props.module.IsSignedIn()) {
            return (<div className='userSettingsGoogleSignInContainer'>You are signed in via Google. <button onClick = {this.OnSignOutClicked}>Sign out of Google</button></div>);
         }
         if (this.props.module.IsSignInInProgress())
            return (<div className='userSettingsGoogleSignInContainer'>
               <div className = "lds-facebook"><div></div><div></div><div></div></div>
               </div>
               );
         if (!this.props.module.HaveGoogleURL())
            return null;
      return (
        <div className='userSettingsGoogleSignInContainer'>
            <button className="googleLoginButton" onClick={this.onClickGoogleSignin}></button>
            {/* buttons are just simpler in react than checkboxes */}
            <button className = {"stayLoggedIn" + (this.state.staySignedIn ? " on" : "")} onClick = {this.clickStaySignedIn}>{(this.state.staySignedIn ? "✅" : "⬜")} Stay signed in</button>
         </div>);
   }
}



module.exports = {
   GoogleOAuthModule,
   GoogleSignInButton,
   GoogleUserSettings,
};
