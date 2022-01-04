const React = require('react');
const DFReactUtils = require("./DFReactUtils");
const {GoogleUserSettings} = require('../googleSignIn');
const {GenerateUserName} = require('../NameGenerator');

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

   resetUserState = (e) => {
       this.setState({
        userName: this.props.app.myUser.name,
        userColor: this.props.app.myUser.color,
       });
   }

   sendUserStateChange = (e) => {
       this.props.app.SetUserNameColor(this.state.userName, this.state.userColor);
   };

   clickCacheSamples = () => {
       this.props.app.synth.cacheSFZInstruments(cacheLoadProgress => {
           this.setState({ cacheLoadProgress });
       });
   };

   OnClickRandomName = () => {
       const randomName = GenerateUserName(Date.now());
       this.setState({userName : randomName});
   }

   OnClickRandomColor = () => {
        const randomColor = `rgb(${[1, 2, 3].map(x => Math.random() * 256 | 0)})`;
        this.setState({userColor : randomColor});
    }

   render() {
       let inputList = null;
       if (this.props.app && this.props.app.midi) {
           if (this.props.app.deviceNameList.length == 0) {
               inputList = (
                    <div className='noMidiDevices'>
                        <div className='title'>No midi devices found</div>
                        <p>It means you will not be able to play any instruments, however it doesn't mean you can't spectate.</p>
                    </div>
                );
           } else {
               inputList = this.props.app.deviceNameList.map(i => {
                   if (this.props.app.IsListeningOnDevice(i)) {
                       return (
                           <li className='active clickable' key={i}>
                               <div onClick={() => this.props.app.StopListeningOnDevice(i)}>🎹 Listening on {i}</div>
                           </li>
                       );
                   } else {
                       return (
                           <li className='clickable' key={i}>
                               <div onClick={() => this.props.app.ListenOnDevice(i)}>Not listening on {i}</div>
                           </li>
                       );
                   }
               });
           }
       }

       const changeUserStateBtn = this.props.app ? (
           <div className="updateAboveStuff">
               <button onClick={this.resetUserState}>Reset</button>
               <button onClick={this.sendUserStateChange}>Save</button>
           </div>
       ) : null;

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
                   <div>
                       <input type="text" value={this.state.userName} onChange={(e) => this.setState({ userName: e.target.value })}></input>
                        Name
                        <button onClick={this.OnClickRandomName} >randomize</button>
                   </div>
                   <div className='colorSwatchRow'><DFReactUtils.TextInputFieldExternalState
                       style={{ width: 160 }}
                       value={this.state.userColor}
                       onChange={(val) => this.setState({ userColor: val })}
                       onEnter={this.sendUserStateChange} />
                       <div style={{backgroundColor:this.state.userColor}} className="colorSwatch"></div>
                       Color
                       <button onClick={this.OnClickRandomColor} >randomize</button>
                   </div>
                   {validationMarkup}
                   {changeUserStateBtn}
                   <GoogleUserSettings module={this.props.googleOAuthModule}></GoogleUserSettings>
                </fieldset>
                <fieldset>
                    <div className="legend">MIDI devices</div>
                    <ul className='midiDevices'>
                       {inputList}
                    </ul>
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
               <div
                    className={"dropdownMenuButton userSettingsButton " + (this.state.isExpanded ? "expanded" : "")}
                    onClick={this.onClickExpand}
                    style={{borderColor: color, color}}
                    >
                  {userName}
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





