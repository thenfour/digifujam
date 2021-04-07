const React = require('react');
const DFUtils = require("../util");
const DFU = require('../dfutil');
const DFApp = require("../app");

class DFOptionsDialog extends React.Component {
    constructor(props) {
        super(props);

        this.quantizationOptions = [
            {
                caption: "off",
                division: 0,
                group: 0,
                cssClass: "quantizationValueOff",
            },

            // {
            //     caption: "𝅝", // whole
            //     division: 0.25, // 1/4
            //     group: 1,
            // },
            {
                caption: "𝅗𝅥",
                division: 0.5,// 1/2
                group: 1,
                cssClass: "quantizationValue",
            },
            {
                caption: "𝅘𝅥",
                division: 1, // 1/1
                group: 1,
                cssClass: "quantizationValue",
            },
            {
                caption: "𝅘𝅥𝅮",
                division: 2,
                group: 1,
                cssClass: "quantizationValue",
            },
            {
                caption: "𝅘𝅥𝅯",
                division: 4,
                group: 1,
                cssClass: "quantizationValue",
            },
            {
                caption: "𝅘𝅥𝅰",
                division: 8,
                group: 1,
                cssClass: "quantizationValue",
            },


            {
                caption: "𝅗𝅥.",
                division: 1.0 / 3.0,
                group: 2,
                cssClass: "quantizationValue",
            },
            {
                caption: "𝅘𝅥.",
                division: 2.0 / 3.0,
                group: 2,
                cssClass: "quantizationValue",
            },
            {
                caption: "𝅘𝅥𝅮.",
                division: 4.0 / 3.0,
                group: 2,
                cssClass: "quantizationValue",
            },
            {
                caption: "𝅘𝅥𝅯.",
                division: 8.0 / 3.0,
                group: 2,
                cssClass: "quantizationValue",
            },


            {
                caption: "𝅗𝅥3",
                division: 3.0 / 4.0,//3/2
                group: 3,
                cssClass: "quantizationValue",
            },
            {
                caption: "𝅘𝅥3",
                division: 3.0 / 2.0,//3/2
                group: 3,
                cssClass: "quantizationValue",
            },
            {
                caption: "𝅘𝅥𝅮3",
                division: 3,
                group: 3,
                cssClass: "quantizationValue",
            },
            {
                caption: "𝅘𝅥𝅯3",
                division: 6,
                group: 3,
                cssClass: "quantizationValue",
            },

        ];

        this.quantizationOptions.forEach((qo, i) => { qo.index = i; });

        let qi = this.findQuantizationIndex(this.props.app.myUser.quantizeSpec.beatDivision);

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

    setPBRange = (v) => {
        this.props.app.pitchBendRange = v.target.value;
        this.props.stateChangeHandler.OnStateChange();
    }

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
        let quantizeSpec = this.props.app.myUser.quantizeSpec;
        quantizeSpec.beatDivision = this.quantizationOptions[i].division;
        this.props.app.SetQuantizationSpec(quantizeSpec);
    };

    setQuantDeadZone = (v) => {
        let quantizeSpec = this.props.app.myUser.quantizeSpec;
        quantizeSpec.swallowBoundary = v.target.value / 100;
        this.props.app.SetQuantizationSpec(quantizeSpec);
        this.setState({});
    };

    setQuantBoundary = (v) => {
        let quantizeSpec = this.props.app.myUser.quantizeSpec;
        quantizeSpec.quantizeBoundary = v.target.value / 100;
        this.props.app.SetQuantizationSpec(quantizeSpec);
        this.setState({});
    };

    setQuantAmt = (v) => {
        let quantizeSpec = this.props.app.myUser.quantizeSpec;
        quantizeSpec.quantizeAmt = v.target.value / 100;
        this.props.app.SetQuantizationSpec(quantizeSpec);
        this.setState({});
    }

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
                    className={"buttonParam quantizationOption " + ((this.state.quantizationIndex == qo.index) ? " active" : "") + " " + qo.cssClass}
                    onClick={() => { this.setQuantizationOptIndex(qo.index) }}>{qo.caption}</button>
            );
        };

        let renderGroup = (g) => {
            let buttons = this.quantizationOptions.filter(qo => qo.group == g).map(qo => renderButton(qo));
            return (<div key={g} className="quantizationGroup">{buttons}</div>);
        };

        const quantGroups = _groups.map(g => renderGroup(g));

        let monitoringCaption = "🔇";
        if (this.props.app.monitoringType == DFApp.eMonitoringType.Local) {
            monitoringCaption = "Local";
        }
        else if (this.props.app.monitoringType == DFApp.eMonitoringType.Remote) {
            monitoringCaption = "Remote";
        }

        let buttonCaption = <span className="optionsBtnContent">
            <span>Settings</span>
            {!!this.state.quantizationIndex && <span className="quantIndicator">Quant=<span className={this.quantizationOptions[this.state.quantizationIndex].cssClass}>{this.quantizationOptions[this.state.quantizationIndex].caption}</span></span>}
            {!this.props.app.metronome.isMuted && !this.props.app.IsMuted() && <span className="metronomeIndicator">🔺</span>}
            {!!this.props.app.myInstrument && <span className="monitoringIndicator">Monitoring:{monitoringCaption}</span>}
        </span>;

        return (
            <div>
                <div className={"optionsButton " + (this.state.isExpanded ? "expanded" : "")} onClick={this.onClickOptions}>{buttonCaption}</div>

                {this.state.isExpanded &&
                    <div className="optionsDialog">
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
                            {this.props.app.monitoringType == DFApp.eMonitoringType.Off && <div className="helpText">You will not hear yourself.</div>}
                            {this.props.app.monitoringType == DFApp.eMonitoringType.Local && <div className="helpText">You hear yourself before others do. Less latency, but you won't hear correct rhythms and you can't hear your quantization.</div>}
                            {this.props.app.monitoringType == DFApp.eMonitoringType.Remote && <div className="helpText">You hear yourself as others hear you, with a round trip through the server. More latency, but you'll hear yourself as others hear you.</div>}
                        </div>

                        <div className="component">
                            <h2>Quantization</h2>
                            <div className="helpText">Delays your notes to align to the beat. You will only hear the effect if you are using "remote" monitoring style.</div>
                            <div>
                                {quantGroups}
                            </div>
                            <div>
                                <input type="range" id="quantZone" name="quantZone" min="0" max="100" onChange={this.setQuantBoundary} value={this.props.app.myUser.quantizeSpec.quantizeBoundary * 100} disabled={!this.props.app.myUser.quantizeSpec.beatDivision} />
                                {this.props.app.myUser.quantizeSpec.quantizeBoundary * 100}
                                | Period
                                <div className="helpText">Notes played after this point in a beat will be delayed.</div>
                            </div>
                            <div>
                                <input type="range" id="quantDeadZone" name="quantDeadZone" min="0" max="100" onChange={this.setQuantDeadZone} value={this.props.app.myUser.quantizeSpec.swallowBoundary * 100} disabled={!this.props.app.myUser.quantizeSpec.beatDivision} />
                                {this.props.app.myUser.quantizeSpec.swallowBoundary * 100}
                                | No man's land
                                <div className="helpText">Notes played after this point are discarded because they're too far from a musical boundary to be useful.</div>
                            </div>
                            <div>
                                <input type="range" id="quantAmt" name="quantAmt" min="0" max="100" onChange={this.setQuantAmt} value={this.props.app.myUser.quantizeSpec.quantizeAmt * 100} disabled={!this.props.app.myUser.quantizeSpec.beatDivision} />
                                {this.props.app.myUser.quantizeSpec.quantizeAmt * 100}
                                | Amount
                            </div>
                        </div>

                        <div className="component">
                            <h2>Room Tempo</h2>
                            <div className="helpText">Changes you make here will affect quantization and metronome for everyone in the room.</div>
                            <div>
                                <input type="range" id="metronomeBPM" name="metronomeBPM" min="40" max="200" onChange={this.setRoomBPM} value={this.props.app.roomState.bpm} />
                                {this.props.app.roomState.bpm} BPM
                            </div>
                            {this.props.app.myInstrument && <div>
                                <button className={"buttonParam " + (this.props.app.GetResetBeatPhaseOnNextNote() ? "active" : "")}
                                    onClick={() => { this.props.app.ToggleResetBeatPhaseOnNextNote() }}>Set beat on next note on</button>
                            </div>}
                            {this.props.app.GetResetBeatPhaseOnNextNote() &&
                                <div className="helpText">Listening for next note in order to synchronize the room beat.</div>}

                            <div>
                                <button className="buttonParam" onClick={() => { this.props.app.AdjustBeatPhase(-50) }}>-50ms</button>
                                <button className="buttonParam" onClick={() => { this.props.app.AdjustBeatPhase(-10) }}>-10ms</button>
                                <button className="buttonParam" onClick={() => { this.props.app.AdjustBeatPhase(+10) }}>+10ms</button>
                                <button className="buttonParam" onClick={() => { this.props.app.AdjustBeatPhase(+50) }}>+50ms</button>
                                Adjust beat phase manually
                            </div>
                        </div>

                        <div className="component">
                            <h2>Metronome</h2>
                            <div className="helpText">Only you will hear the metronome.</div>
                            <div>
                                <input type="range" id="metronomeVolume" name="metronomeVolume" min="0" max="200" onChange={this.setMetronomeVolume} value={this.props.app.synth.metronomeGain * 100} disabled={this.props.app.IsMuted() || this.props.app.metronome.isMuted} />
                                <label htmlFor="metronomeVolume">volume: {Math.trunc(this.props.app.synth.metronomeGain * 100)}</label>
                                <button className="muteButton" onClick={this.onClickMetronome}>{(this.props.app.metronome.isMuted || this.props.app.IsMuted()) ? "⚪" : "🔺"}</button>
                            </div>
                        </div>

                    </div>}
            </div>);
    }
};

module.exports = DFOptionsDialog;

