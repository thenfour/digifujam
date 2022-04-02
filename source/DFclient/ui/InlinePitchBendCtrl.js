const React = require('react');
const DFUtils = require("../util");
const DFU = require('../../DFcommon/dfutil');
const DFApp = require("../app");
const DFMusic = require("../../DFcommon/DFMusic");
const { SeqLegendKnob, IntRangeValueSpec } = require('./knob');

const gTopRowKnobFormatSpec = {
   fontSpec: "12px sans-serif",
   centerText: (knob) => { return knob.props.enabled ? `${knob.smallCaption}:${knob.valueSpec.value01ToString(knob.valueSpec.valueToValue01(knob.value))}` : "mute"; },
   textColor: "#ddd",
   padding: 1,
   lineWidth: 10,
   valHighlightWidth: 10,
   offsetY: 2,
   trackColor: "#555",
   fgColor: (knob) => { return knob.props.enabled ? "#077" : "#777"; },
   valHighlightColor: (knob) => { return knob.props.enabled ? "#0cc" : "#bbb"; },
   radius: 18,
   valHighlightRadius: 18,
   valueRangeRadians: .75 * 2 * Math.PI,
   valueOffsetRadians: Math.PI * 1.5,
   valHighlightRangeRad: 0,
   valHighlightLineCap: 'round', // butt round
 };


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

class KnobPitchBendCtrl extends React.Component {
   constructor(props) {
      super(props);
      this.pbValueSpec = new IntRangeValueSpec(-12, 12, 0, 2);
   }

   setPBRange = (v) => {
      this.props.app.pitchBendRange = v;
      this.props.stateChangeHandler.OnStateChange();
  }

   render() {
      return (
      <span className='pitchBend'>
         <SeqLegendKnob
               caption="Pitch Bend"
               smallCaption="PB"
               className="knob"
               enabled="true"
               hideTitle="1"
               initialValue={this.props.app.pitchBendRange}
               valueSpec={this.pbValueSpec}
               onChange={this.setPBRange}
               formatSpec={gTopRowKnobFormatSpec}
            />
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
         <button className = "muteButton" onClick = {this.onClickMute}>{this.props.app.IsMuted() ?
         (<i className="material-icons">volume_off</i>) : (<i className="material-icons">volume_up</i>)}</button>
      </span>);
   }
};



class KnobMasterVolumeCtrl extends React.Component {
   constructor(props) {
      super(props);
      this.valueSpec = new IntRangeValueSpec(0, 200, 100, 100);
   }

   componentDidMount() {
      window.DFKeyTracker.events.on("toggleMute", this.handleMuteHotkey);
   }

   componentWillUnmount() {
      window.DFKeyTracker.events.removeListener("toggleMute", this.handleMuteHotkey);
   }

   handleMuteHotkey = () => {
      if (!this.props.app) return;
      this.props.app.SetMuted(!this.props.app.IsMuted());
      this.props.stateChangeHandler.OnStateChange();
   }

   setVolumeVal = (v) => {
      let realVal = parseFloat(v) / 100;
      this.props.app.synth.masterGain = realVal;
      this.props.stateChangeHandler.OnStateChange();
   }

   onClickMute = () => {
      this.props.app.SetMuted(!this.props.app.IsMuted());
      this.props.stateChangeHandler.OnStateChange();
   };

   render() {
      return (
      <span className='masterVolume'>
         <SeqLegendKnob
               caption="Master volume"
               smallCaption="Vol"
               className="knob"
               enabled={!this.props.app.IsMuted()}
               hideTitle="1"
               initialValue={this.props.app.synth.masterGain * 100}
               valueSpec={this.valueSpec}
               onChange={this.setVolumeVal}
               formatSpec={gTopRowKnobFormatSpec}
            />
         <button
            className={"muteButton " + (this.props.app.IsMuted() ? "muted" : "unmuted")}
            onClick = {this.onClickMute}
            title="Toggle mute (ALT+M)"
            >
            { this.props.app.IsMuted() ?
               (<i className="material-icons">volume_off</i>)
               : (<i className="material-icons">volume_up</i>)
            }
         </button>
      </span>);
   }
};





module.exports = {
   InlinePitchBendCtrl: KnobPitchBendCtrl,
   InlineMasterGainCtrl: KnobMasterVolumeCtrl,
}
