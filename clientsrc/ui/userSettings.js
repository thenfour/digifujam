const React = require('react');
const DFReactUtils = require("./DFReactUtils");
const {GoogleUserSettings} = require('../googleSignIn');


class UserState extends React.Component {
   constructor(props) {
       super(props);

       this.state = {
           userName: '',
           userColor: '',
           cacheLoadProgress: null,
       };

       if (this.props.app && this.props.app.myUser) {
           this.state.userName = this.props.app.myUser.name;
           this.state.userColor = this.props.app.myUser.color;
       }
   }

   sendUserStateChange = (e) => {
       this.props.app.SetUserNameColor(this.state.userName, this.state.userColor);
   };

   clickCacheSamples = () => {
       this.props.app.synth.cacheSFZInstruments(cacheLoadProgress => {
           this.setState({ cacheLoadProgress });
       });
   };

   render() {
       let inputList = null;
       if (this.props.app && this.props.app.midi) {
           if (this.props.app.deviceNameList.length == 0) {
               inputList = (<div>(no midi devices found)</div>);
           } else {
               inputList = this.props.app.deviceNameList.map(i => {
                   if (this.props.app.midi.IsListeningOnDevice(i)) {
                       return (
                           <div key={i}>
                               <button onClick={() => this.props.app.midi.StopListeningOnDevice(i)}>Stop using {i}</button>
                           </div>
                       );
                   } else {
                       return (
                           <div key={i}>
                               <button onClick={() => this.props.app.midi.ListenOnDevice(i)}>Start using {i}</button>
                           </div>
                       );
                   }
               });
           }
       }

       const changeUserStateBtn = this.props.app ? (
           <div className="updateAboveStuff"><button onClick={this.sendUserStateChange}>Save</button></div>
       ) : null;

       const randomColor = `rgb(${[1, 2, 3].map(x => Math.random() * 256 | 0)})`;

       const validationMsg = DFReactUtils.getValidationErrorMsg(this.state.userName, this.state.userColor);
       const validationMarkup = validationMsg.length ? (
           <div className="validationError">{validationMsg}</div>
       ) : null;

       let cacheHasErrors = this.state.cacheLoadProgress && this.state.cacheLoadProgress.errors > 0;

       const cacheSamplesButton = this.props.app && (<div className="preloadSFZ">
           <button onClick={this.clickCacheSamples}>Preload all samples</button>
           {this.state.cacheLoadProgress && <div>
               {this.state.cacheLoadProgress.successes} success,
               {this.state.cacheLoadProgress.errors} errors /
               {this.state.cacheLoadProgress.totalFiles} total</div>}
       </div>);

       return (
           <div className="userSettings">
               <fieldset>
                    <div className="legend">Identity</div>
                   <div><DFReactUtils.TextInputField style={{ width: 160 }} default={this.state.userName} onChange={(val) => this.setState({ userName: val })} onEnter={this.sendUserStateChange} /> Name</div>
                   <div className='colorSwatchRow'><DFReactUtils.TextInputFieldExternalState
                       style={{ width: 160 }}
                       value={this.state.userColor}
                       onChange={(val) => this.setState({ userColor: val })}
                       onEnter={this.sendUserStateChange} />
                       <div style={{backgroundColor:this.state.userColor}} className="colorSwatch"></div>
                       Color
                       <button onClick={() => { this.setState({ userColor: randomColor }) }} >randomize</button>
                   </div>
                   {validationMarkup}
                   {changeUserStateBtn}
                   <GoogleUserSettings module={this.props.googleOAuthModule}></GoogleUserSettings>
                </fieldset>
                <fieldset>
                    <div className="legend">MIDI devices</div>
                   {inputList}
                </fieldset>
                <fieldset>
                    <div className="legend">System</div>
                   {cacheSamplesButton}
                </fieldset>
           </div>
       );
   }
}

class UserSettingsButton extends React.Component {
   constructor(props) {
       super(props);
       this.state = {
           isExpanded: false,
       };
   }

   onClickExpand = () => {
       this.setState({
           isExpanded: !this.state.isExpanded,
       });
   };

   render() {

      if (!this.props.app) return null;

      let userName = this.props.app?.myUser?.name ?? "You";
      let color = this.props.app?.myUser?.color ?? "#0cc";

       return (
           <div className='dropdownMenu left'>
               <div className={"dropdownMenuButton userSettingsButton " + (this.state.isExpanded ? "expanded" : "")} onClick={this.onClickExpand}>
                  <span style={{color}}>{userName}</span>
                  </div>

               {this.state.isExpanded &&
                   <div className="userSettingsDialog popUpDialog">
                      <UserState app={this.props.app} googleOAuthModule={this.props.googleOAuthModule}></UserState>
                   </div>}
           </div>);
   }
};




module.exports =  {
   UserSettingsButton,
};





