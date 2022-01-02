const React = require('react');
const DFReactUtils = require("./DFReactUtils");



class UserState extends React.Component {
   constructor(props) {
       super(props);

       this.state = {
           userName: '',
           userColor: '',
           //isShown: false,
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

   // handleToggleShownClick = () => {
   //     this.setState({ isShown: !this.state.isShown });
   // };

   clickCacheSamples = () => {
       this.props.app.synth.cacheSFZInstruments(cacheLoadProgress => {
           this.setState({ cacheLoadProgress });
       });
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

       const changeUserStateBtn = this.props.app ? (
           <li className="updateAboveStuff"><button onClick={this.sendUserStateChange}>Save</button></li>
       ) : null;

       const randomColor = `rgb(${[1, 2, 3].map(x => Math.random() * 256 | 0)})`;

       const validationMsg = DFReactUtils.getValidationErrorMsg(this.state.userName, this.state.userColor);
       const validationMarkup = validationMsg.length ? (
           <div className="validationError">{validationMsg}</div>
       ) : null;

       let cacheHasErrors = this.state.cacheLoadProgress && this.state.cacheLoadProgress.errors > 0;

       const cacheSamplesButton = this.props.app && (<li className="preloadSFZ">
           <button onClick={this.clickCacheSamples}>Preload all samples</button>
           {this.state.cacheLoadProgress && <div>
               {this.state.cacheLoadProgress.successes} success,
               {this.state.cacheLoadProgress.errors} errors /
               {this.state.cacheLoadProgress.totalFiles} total</div>}
       </li>);

       return (
           <div className="userSettings">
               <ul>
                   <li><DFReactUtils.TextInputField style={{ width: 160 }} default={this.state.userName} onChange={(val) => this.setState({ userName: val })} onEnter={this.sendUserStateChange} /> name</li>
                   <li className='colorSwatchRow'><div style={{backgroundColor:this.state.userColor}} className="colorSwatch"></div><DFReactUtils.TextInputFieldExternalState
                       style={{ width: 160 }}
                       value={this.state.userColor}
                       onChange={(val) => this.setState({ userColor: val })}
                       onEnter={this.sendUserStateChange} /> color
                       <button onClick={() => { this.setState({ userColor: randomColor }) }} >random</button>
                   </li>
                   {validationMarkup}
                   {changeUserStateBtn}
                   {inputList}
                   {cacheSamplesButton}
               </ul>
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
                      <UserState app={this.props.app}></UserState>
                   </div>}
           </div>);
   }
};




module.exports =  {
   UserSettingsButton,
};





