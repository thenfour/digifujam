const React = require('react');
const DFUtils = require("../util");
const DFU = require('../dfutil');
const DFApp = require("../app");
const DFMusic = require("../DFMusic");

// props: 
// - app
// - stateChangeHandler
class InlinePitchBendCtrl extends React.Component {
   constructor(props) {
      super(props);
   }

   setPBRange = (v) => {
      this.props.app.pitchBendRange = v.target.value;
      this.props.stateChangeHandler.OnStateChange();
  }

   render() {
      return (
      <span>
         <input type="range" id="pbrange" name="pbrange" min="0" max="12" onChange={this.setPBRange} value={this.props.app.pitchBendRange} />
         <label htmlFor="pbrange">PB range:{this.props.app.pitchBendRange}</label>
      </span>);
   }
};


// props: 
// - app
// - stateChangeHandler
class InlineMasterGainCtrl extends React.Component {
   constructor(props) {
      super(props);
   }

   setVolumeVal = (v) => {
      let realVal = parseFloat(v.target.value) / 100;
      this.props.app.synth.masterGain = realVal;
      this.props.stateChangeHandler.OnStateChange();
   }

   onClickMute = () => {
      this.props.app.SetMuted(!this.props.app.IsMuted());
      this.props.stateChangeHandler.OnStateChange();
   };

   render() {
      return (<span>
              <input type = "range" id = "volume" name = "volume" min = "0" max = "200" onChange = {this.setVolumeVal} value = {this.props.app.synth.masterGain * 100} disabled = { this.props.app.IsMuted() } />
         <label htmlFor="volume">gain:{Math.trunc(this.props.app.synth.masterGain * 100)}</label>
              <button className = "muteButton" onClick = {this.onClickMute}>{this.props.app.IsMuted() ? "🔇" : "🔊"}</button>
      </span>);
   }
};

module.exports = {
   InlinePitchBendCtrl,
   InlineMasterGainCtrl,
}
