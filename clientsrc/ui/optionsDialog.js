const React = require('react');
const DFUtils = require("../util");
const DFU = require('../dfutil');
const DFApp = require("../app");

class DFOptionsDialog extends React.Component {
    constructor(props) {
        super(props);

        this.quantizationOptions = [
            {
                caption: "None",
                division: 0,
                group: 0,
            },

            {
                caption: "𝅝", // whole
                division: 0.25, // 1/4
                group: 1,
            },
            {
                caption: "𝅗𝅥",
                division: 0.5,// 1/2
                group: 1,
            },
            {
                caption: "𝅘𝅥",
                division: 1, // 1/1
                group: 1,
            },
            {
                caption: "𝅘𝅥𝅮",
                division: 2,
                group: 1,
            },
            {
                caption: "𝅘𝅥𝅯",
                division: 4,
                group: 1,
            },
            {
                caption: "𝅘𝅥𝅰",
                division: 8,
                group: 1,
            },


            {
                caption: "𝅘𝅥.",
                division: 2.0 / 3.0,
                group: 2,
            },
            {
                caption: "𝅘𝅥𝅮.",
                division: 4.0 / 3.0,
                group: 2,
            },
            {
                caption: "𝅘𝅥𝅯.",
                division: 8.0 / 3.0,
                group: 2,
            },


            {
                caption: "𝅘𝅥3",
                division: 3.0 / 2.0,//3/2
                group: 3,
            },

            {
                caption: "𝅘𝅥𝅮3",
                division: 3,
                group: 3,
            },
            {
                caption: "𝅘𝅥𝅯3",
                division: 6,
                group: 3,
            },

        ];

        this.quantizationOptions.forEach((qo, i) => { qo.index = i; });

        let qi = this.findQuantizationIndex(this.props.app.myUser.quantizeBeatDivision);

        this.state = {
            isExpanded: false,
            quantizationIndex: qi,
        };
    }

    onClickOptions = () => {
        this.setState({
            isExpanded: !this.state.isExpanded,
        });
    };

    setVolumeVal = (v) => {
        let realVal = parseFloat(v.target.value) / 100;
        this.props.app.synth.masterGain = realVal;
        this.props.stateChangeHandler.OnStateChange();
    }

    setPBRange = (v) => {
        this.props.app.pitchBendRange = v.target.value;
        this.props.stateChangeHandler.OnStateChange();
    }

    onClickMute = () => {
        // this op takes a while so do async
        setTimeout(() => {
            this.props.app.synth.isMuted = !this.props.app.synth.isMuted;
            this.props.stateChangeHandler.OnStateChange();
        }, 0);
    };

    onSetMonitoringType(mt) {
        this.props.app.setMonitoringType(mt);
        this.setState({});
    }
    findQuantizationIndex(beatDivision) {
        let nearestDist = 0;
        let nearestIndex = -1;
        this.quantizationOptions.forEach((val, index) => {
            let dist = Math.abs(val.division - beatDivision);
            if (nearestIndex == -1 || dist < nearestDist) {
                nearestDist = dist;
                nearestIndex = index;
            }
        });
        return nearestIndex;
    }

    setQuantizationOptIndex = (i) => {
        this.setState({
            quantizationIndex: i,
        });
        this.props.app.SetQuantizationSpec(this.quantizationOptions[i].division);
    };

    setRoomBPM = (v) => {
        if (v.target.value < 1 || v.target.value > 200)
            return;

        this.props.app.SendRoomBPM(v.target.value);
    }

    onClickMetronome = () => {
        this.props.app.metronome.isMuted = !this.props.app.metronome.isMuted;
        this.setState({});//gStateChangeHandler.OnStateChange();
    }

    setMetronomeVolume = (v) => {
        let realVal = parseFloat(v.target.value) / 100;
        this.props.app.synth.metronomeGain = realVal;
        this.setState({});//gStateChangeHandler.OnStateChange();
    }


    render() {

        let _groups = [...new Set(this.quantizationOptions.map(p => p.group))];

        let renderButton = (qo) => {
            return (
                <button
                    key={qo.index}
                    className={"buttonParam quantizationOption " + ((this.state.quantizationIndex == qo.index) ? " active" : "")}
                    onClick={() => { this.setQuantizationOptIndex(qo.index) }}>{qo.caption}</button>
            );
        };

        let renderGroup = (g) => {
            let buttons = this.quantizationOptions.filter(qo => qo.group == g).map(qo => renderButton(qo));
            return (<div key={g} className="quantizationGroup">{buttons}</div>);
        };

        const quantGroups = _groups.map(g => renderGroup(g));

        return (
            <div>
                <div className={"optionsButton " + (this.state.isExpanded ? "expanded" : "")} onClick={this.onClickOptions}>Options</div>
                {this.state.isExpanded &&
                    <div className="optionsDialog">

                        <div className="component">
                            <h2>Master volume</h2>
                            <div>
                                <input type="range" id="volume" name="volume" min="0" max="200" onChange={this.setVolumeVal} value={this.props.app.synth.masterGain * 100} disabled={this.props.app.synth.isMuted} />
                                <label htmlFor="volume">gain:{Math.trunc(this.props.app.synth.masterGain * 100)}</label>
                                <button className="muteButton" onClick={this.onClickMute}>{this.props.app.synth.isMuted ? "🔇" : "🔊"}</button>
                            </div>
                        </div>

                        <div className="component">
                            <h2>Pitch bend</h2>
                            <div>
                                <input type="range" id="pbrange" name="pbrange" min="0" max="12" onChange={this.setPBRange} value={this.props.app.pitchBendRange} />
                                <label htmlFor="pbrange">PB range:{this.props.app.pitchBendRange}</label>
                            </div>
                        </div>

                        <div className="component">
                            <h2>Monitoring</h2>
                            <div>
                                <button className={"buttonParam " + ((this.props.app.monitoringType == DFApp.eMonitoringType.Off) ? "active" : "")} onClick={() => { this.onSetMonitoringType(DFApp.eMonitoringType.Off) }}>Off</button>
                                <button className={"buttonParam " + ((this.props.app.monitoringType == DFApp.eMonitoringType.Local) ? "active" : "")} onClick={() => { this.onSetMonitoringType(DFApp.eMonitoringType.Local) }}>Local</button>
                                <button className={"buttonParam " + ((this.props.app.monitoringType == DFApp.eMonitoringType.Remote) ? "active" : "")} onClick={() => { this.onSetMonitoringType(DFApp.eMonitoringType.Remote) }}>Remote</button>
                            </div>
                        </div>

                        <div className="component">
                            <h2>Quantization</h2>
                            <div>
                                {quantGroups}
                            </div>
                        </div>

                        <div className="component">
                            <h2>Room BPM (shared)</h2>
                            <div>
                                <input type="range" id="metronomeBPM" name="metronomeBPM" min="40" max="200" onChange={this.setRoomBPM} value={this.props.app.roomState.bpm} />
                                {this.props.app.roomState.bpm}
                            </div>
                        </div>

                        <div className="component">
                            <h2>Metronome</h2>
                            <div>
                                <input type="range" id="metronomeVolume" name="metronomeVolume" min="0" max="200" onChange={this.setMetronomeVolume} value={this.props.app.synth.metronomeGain * 100} disabled={this.props.app.synth.isMuted || this.props.app.metronome.isMuted} />
                                <button className="muteButton" onClick={this.onClickMetronome}>{(this.props.app.metronome.isMuted || this.props.app.synth.isMuted) ? "🔇" : "🔊"}</button>
                            </div>
                        </div>

                    </div>}
            </div>);
    }
};

module.exports = DFOptionsDialog;

