const React = require('react');
const { eConnectionStatus } = require('../radioMachine');
const { SeqLegendKnob } = require('./knob');

const gKnobFormatSpec = {
  fontSpec: (knob) => { return knob.isDragging ? "16px monospace" : null; },
  textColor: "#0ff",
  padding: 1,
  lineWidth: 10,
  valHighlightWidth: 10,
  offsetY: 2,
  trackColor: "#777",
  fgColor: (knob) => { return knob.value < 0 ? "#fa4" : "#fa4"; },
  valHighlightColor: (knob) => { return knob.value === knob.valueSpec.centerValue ? "#0cc" : "#0aa"; },
  radius: 15,
  valHighlightRadius: 15,
  valueRangeRadians: .75 * 2 * Math.PI,
  valueOffsetRadians: Math.PI * 1.5,
  valHighlightRangeRad: 0,
  valHighlightLineCap: 'round', // butt round
};

class FloatValueSpec01 {
  constructor() {
      this.mouseSpeed ??= 0.004;
      this.fineMouseSpeed ??= 0.0008;
      this.centerValue = 0.5;
  }
  value01ToValue = (v01) => {
      return v01;
  }
  valueToValue01 = (v) => {
      return v;
  }
  value01ToString = (v01) => {
      return parseFloat(v01).toFixed(2);
  }
};

class FreqValueSpec {
  constructor() {
      this.mouseSpeed ??= 0.004;
      this.fineMouseSpeed ??= 0.0008;
      this.centerValue = 0.5;
  }
  value01ToValue = (v01) => {
      return v01 * 20000;
  }
  valueToValue01 = (v) => {
      return v / 20000;
  }
  value01ToString = (v01) => {
      return parseInt(this.value01ToValue(v01));
  }
};

class QValueSpec {
  constructor() {
      this.mouseSpeed ??= 0.004;
      this.fineMouseSpeed ??= 0.0008;
      this.centerValue = 0.5;
  }
  value01ToValue = (v01) => {
      return v01 * 10;
  }
  valueToValue01 = (v) => {
      return v / 10;
  }
  value01ToString = (v01) => {
      return parseFloat(this.value01ToValue(v01)).toFixed(1);
  }
};

const gValSpec01 = new FloatValueSpec01();
const gFreqSpec = new FreqValueSpec();
const gQSpec = new QValueSpec();

//-----------------------------------------------------------------
class RadioControls extends React.Component {
  constructor(props) {
    super(props);
    this.running = false;
  }

  onChangeVerb = (e) => {
    this.props.app.radio.ReverbLevel = e;
  }
  onChangeFreq = (e) => {
    this.props.app.radio.FilterFrequency = e;
  }
  onChangeQ = (e) => {
    this.props.app.radio.FilterQ = e;
  }

  componentDidMount() {
    this.running = true;
    this.props.app.radio.IcyNode.events.on("streamStateChange", this.streamStateChange);
    this.props.app.radio.IcyNode.events.on("streamInfo", this.onStreamInfo);
    this.props.app.radio.events.on("stop", this.onRadioStop);
  }

  componentWillUnmount() {
    this.onRadioStop();
  }

  streamStateChange = (e) => {
    if (!this.running) return;
    this.setState({});
  }

  onRadioStop = () => {
    this.running = false;
    this.props.app?.radio?.IcyNode.events.removeListener("streamStateChange", this.streamStateChange);
    this.props.app?.radio?.IcyNode.events.removeListener("streamInfo", this.onStreamInfo);
    this.props.app?.radio?.events.removeListener("stop", this.onRadioStop);
  }

  onStreamInfo = () => {
    this.setState({});
  }

  onToggleFXEnabled = () => {
    this.props.app.radio.FXEnabled = !this.props.app.radio.FXEnabled;
    this.setState({});
  }


  render() {
    const info = this.props.app?.radio?.IcyNode?.StreamInfo;
    if (!info) return null;
    const showDebugInfo = window.DFShowDebugInfo;
    const pp = this.props.app.radio.IcyNode.playOrPauseAction;

    let connectionState = null;
    let connectionStateDescription = null;
    switch (info.connectionState) {
      case eConnectionStatus.Connected:
        //connectionState = <i className="material-icons">cast_connected</i>;
        connectionState = <i className="material-icons">signal_cellular_alt</i>;
        connectionStateDescription = "You're connected and can play the stream";
        //SignalCellularAlt
        break;
      case eConnectionStatus.Disconnected:
        //connectionState = <i className="material-icons">power_off</i>;
        connectionState = <i className="material-icons">signal_cellular_alt</i>;
        connectionStateDescription = "The stream is up, but you're not connected for some reason.";
        break;
      case eConnectionStatus.Offline:
        //connectionState = <i className="material-icons">cloud_off</i>;
        connectionState = <i className="material-icons">signal_cellular_alt</i>;
        connectionStateDescription = "The stream is not running; nothing to play.";
        break;
    }

    return (
        <div id="radioControls">
          <div className="basicControls">
            <button id="radioPlayPause" className={pp} onClick={() => this.props.app.radio.IcyNode.playOrPause()}>
              {(pp === 'virtualPlay' || pp === 'play') ? <i className="material-icons">play_arrow</i> :<i className="material-icons">pause</i> }
            </button>
          </div>
          <div className='metadata'>
            <div className='streamName'>{info.stream.name}</div>
            <div className='streamDescription'>{info.stream.description}</div>
            <div className='nowPlayingArtist'>{info.nowPlaying.artist ?? ""}</div>
            <div className='nowPlayingTitle'>{info.nowPlaying.title ?? ""}</div>
          </div>
          <div className='lessImportantControls'>
            <button title="Reload the stream" id="radioRefresh" onClick={() => this.props.app.radio.IcyNode.refresh()}><i className="material-icons">refresh</i></button>
            <div title={connectionStateDescription} id="radioConnectionStatus" className={info.connectionState}>{connectionState}</div>
          </div>
          {showDebugInfo && <div className="knobs">
            <SeqLegendKnob
              caption="Verb"
              className="knob"
              initialValue={this.props.app.radio.ReverbLevel}
              valueSpec={gValSpec01}
              formatSpec={gKnobFormatSpec}
              onChange={this.onChangeVerb}
            >
            </SeqLegendKnob>

            <SeqLegendKnob
              caption="FiltFreq"
              className="knob"
              initialValue={200}
              valueSpec={gFreqSpec}
              formatSpec={gKnobFormatSpec}
              onChange={this.onChangeFreq}
            >
            </SeqLegendKnob>

            <SeqLegendKnob
              caption="FiltQ"
              className="knob"
              initialValue={this.props.app.radio.FilterQ}
              valueSpec={gQSpec}
              formatSpec={gKnobFormatSpec}
              onChange={this.onChangeQ}
            >
            </SeqLegendKnob>

            <div className='toggle' onClick={() => this.onToggleFXEnabled()}>FX {this.props.app.radio.FXEnabled ? "enabled" : "disabled" }</div>

          </div>}
        </div>
      );
  }
}






//-----------------------------------------------------------------
//  style={style} item={this.props.item} displayHelper={this.props.displayHelper} app={this.props.app} />);
class RadioMetadataRoomItem extends React.Component {
  constructor(props) {
    super(props);
    this.running = false;
  }

  componentDidMount() {
    this.running = true;
    this.props.app.radio.events.on("stop", this.onRadioStop);
    this.props.app.radio.IcyNode.events.on("streamStateChange", this.streamStateChange);
    this.props.app.radio.IcyNode.events.on("streamInfo", this.onStreamInfo);
  }

  componentWillUnmount() {
    this.onRadioStop();
  }

  streamStateChange = (e) => {
    if (!this.running) return;
    this.setState({});
  }

  onStreamInfo = () => {
    this.setState({});
  }

  onRadioStop = () => {
    this.running = false;
    this.props.app?.radio?.IcyNode.events.removeListener("streamStateChange", this.streamStateChange);
    this.props.app?.radio?.IcyNode.events.removeListener("streamInfo", this.onStreamInfo);
    this.props.app?.radio?.events.removeListener("stop", this.onRadioStop);
  }

  render() {
    const info = this.props.app?.radio?.IcyNode?.StreamInfo;
    if (!info) return null;
    return (
    <div className={"roomItem " + (this.props.item.cssClass ?? "")} style={this.props.style}>
      <div className='streamName'>{info.stream.name}</div>
      <div className='streamDescription'>{info.stream.description}</div>
      <div className='nowPlayingArtist'>{info.nowPlaying.artist ?? ""}</div>
      <div className='nowPlayingTitle'>{info.nowPlaying.title ?? ""}</div>
    </div>);
  }
}



//-----------------------------------------------------------------
class RadioVisRoomItem extends React.Component {
  constructor(props) {
    super(props);
    this.running = false;
    this.frameSkip = 0;
  }

  componentDidMount() {
    this.props.app.radio.events.on("stop", this.onRadioStop);

    this.analyzerNode = this.props.app.radio.AnalyserNode;
    //this.analyzerNode.smoothingTimeConstant = 0.8;
    this.analyzerNode.fftSize = 2 ** 5;
    this.bufferLength = this.analyzerNode.frequencyBinCount;
    this.dataArray = new Uint8Array(this.bufferLength);

    const section = document.querySelector('section#radioVis');
    this.v = (new Array(this.bufferLength)).fill().map(e => (e = document.createElement('i')) && section.appendChild(e) && e);

    this.running = true;
    requestAnimationFrame(this.animFrame);
  }

  componentWillUnmount() {
    this.props.app?.radio?.events.removeListener("stop", this.onRadioStop);
    this.running = false;
  }

  onRadioStop = () => {
    this.running = false;
    this.analyzerNode = null; // remove ref
  }

  animFrame = () => {
    if (!this.running) return;
    if (this.frameSkip) { // frames left to skip.
      this.frameSkip --;
      requestAnimationFrame(this.animFrame);
      return;
    }
    this.frameSkip = 2;
    this.analyzerNode.getByteFrequencyData(this.dataArray);
    this.dataArray.forEach((d, i) => this.v[i].style.setProperty('--c', d));
    requestAnimationFrame(this.animFrame);
  };

  render() {
    const info = this.props.app?.radio?.IcyNode?.StreamInfo;
    if (!info) return null;
    return (
    <div className={"roomItem " + (this.props.item.cssClass ?? "")} style={this.props.style}>
      <section id="radioVis"></section>
    </div>);
  }
}




module.exports = {
  RadioControls,
  RadioMetadataRoomItem,
  RadioVisRoomItem,
}