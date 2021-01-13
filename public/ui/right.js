//const { ServerSettings } = require("../DFCommon");



let getValidationErrorMsg = function (userName, userColor) {
    let sanitizedName = sanitizeUsername(userName);
    let validationErrorTxt = (sanitizedName != null) ? "" : "! Please enter a valid username";

    let sanitizedColor = sanitizeUserColor(userColor);
    if (sanitizedColor == null) {
        validationErrorTxt += "! Please enter a valid CSS color";
    }
    return validationErrorTxt;
}



function random(num) {
    return (Math.random() * num)
}


// props:
// - default
// - onChange(val)
// - onEnter
class TextInputField extends React.Component {
    constructor(props) {
        super(props);
        this.state = { value: '' };
        if (props.default) {
            this.state.value = props.default;
        }
        this.handleChange = this.handleChange.bind(this);
    }
    handleChange(val) {
        this.setState({ value: val });
        if (this.props.onChange) {
            this.props.onChange(val);
        }
    }

    _handleKeyDown = (e) => {
        if (e.key === 'Enter' && this.props.onEnter) {
            return this.props.onEnter(e);
        }
    }
    render() {
        return (
            <input type="text" ref={(input) => {
                this.inputRef = input;
            }} style={this.props.style} value={this.state.value} onChange={(e) => this.handleChange(e.target.value)} onKeyDown={this._handleKeyDown} />
        );
    }
}

// props
// - onChange
// - onEnter
// - value
// - style
class TextInputFieldExternalState extends React.Component {
    handleChange = (val) => {
        this.setState({ value: val });
        if (this.props.onChange) {
            this.props.onChange(val);
        }
    }
    handleChange = (e) => {
        if (this.props.onChange) {
            return this.props.onChange(e.target.value);
        }
    }
    handleKeyDown = (e) => {
        if (e.key === 'Enter' && this.props.onEnter) {
            return this.props.onEnter(e);
        }
    }
    render() {
        return (
            <input type="text" style={this.props.style} value={this.props.value} onChange={this.handleChange} onKeyDown={this.handleKeyDown} />
        );
    }
}


// props
// - app
// - displayhelper
class CheerControls extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            text: '👏'
        };
        if (Cookies.get(window.DFRoomName + "_cheerText")) {
            this.state.text = Cookies.get(window.DFRoomName + "_cheerText");
        }
        this.mouseIn = false;
        this.mouseDown = false;
        this.timerRunning = false;
        //this.mousePos = { x: 0, y: 0 }; // track this on mouse move.
        console.assert(this.props.displayHelper);
    }

    // there are really 2 mouse states we have to track:
    // - mouse inside the element? this is done with mouseenter and mouseleave
    // - mouse button pressed? this is done with mousedown, mouseup, but you can for example mousedown, leave the element, and re-enter, and we need to know whether you released the button or not.
    //   so this also needs help from mouseenter/leave.

    // the timer continues to fire when both mouse button is down and mouse is inside.

    onTimeout = () => {
        if (!this.props.app || !this.props.app.roomState) {
            this.timerRunning = false;
            return null;
        }

        // perform cheer
        //const pos = this.props.displayHelper().roomToScreenPosition(this.props.app.myUser.position);
        this.props.app.SendCheer(this.state.text, this.props.app.myUser.position.x, this.props.app.myUser.position.y);

        // while allowing, continue timer
        if (this.mouseIn && this.mouseDown) {
            setTimeout(() => { this.onTimeout() }, ClientSettings.MinCheerIntervalMS);
        } else {
            this.timerRunning = false;
        }
    };

    onMouseDown = (e) => {
        this.mouseIn = true;
        this.mouseDown = true; // any time you enter, just assume mouse is released.

        // do initial cheer,
        //const pos = this.props.displayHelper().roomToScreenPosition(this.props.app.myUser.position);
        this.props.app.SendCheer(this.state.text, this.props.app.myUser.position.x, this.props.app.myUser.position.y);

        if (!this.timerRunning) {
            setTimeout(() => { this.onTimeout() }, ClientSettings.MinCheerIntervalMS);
        }
    };

    onMouseUp = (e) => {
        this.mouseDown = false; // this will stop the timer, if it was started.
    };

    onMouseEnter = (e) => {
        this.mouseIn = true;
        this.mouseDown = false; // any time you enter, just assume mouse is released.
    };

    onMouseLeave = (e) => {
        this.mouseIn = false;
        this.mouseDown = false;
    };

    // onMouseMove = (e) => {
    //     if (!e.target || e.target.id != "cheerButton") return false;
    //     this.mousePos = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
    // };

    render() {
        // onClick={() => this.props.handleCheerClick(this.state.text)}
        if (!this.props.app || !this.props.app.roomState) return null;
        return (
            <div id="cheerControl">
                <div id="cheerButton" className="cheerButton" onMouseDown={this.onMouseDown} onMouseUp={this.onMouseUp} onMouseEnter={this.onMouseEnter} onMouseLeave={this.onMouseLeave} >cheer</div>
                <TextInputFieldExternalState
                    value={this.state.text}
                    onChange={(val) => {
                        Cookies.set(window.DFRoomName + "_cheerText", val);
                        this.setState({ text: val });
                    }}
                />
            </div>
        );
    }
}


class UserState extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            userName: '',
            userColor: '',
            deviceNameList: [],
            isShown: true,
        };

        if (this.props.app && this.props.app.myUser) {
            this.state.userName = this.props.app.myUser.name;
            this.state.userColor = this.props.app.myUser.color;
        }

        GetMidiInputDeviceList().then(inputs => {
            console.log(JSON.stringify(inputs));
            this.setState({ deviceNameList: inputs });
        });
    }

    sendUserStateChange = (e) => {
        this.props.app.SetUserNameColor(this.state.userName, this.state.userColor);
    };

    setVolumeVal = (v) => {
        let realVal = parseFloat(v.target.value) / 100;
        this.setState(this.state);
        this.props.app.synth.masterGain = realVal;
    }

    setReverbVal = (v) => {
        let realVal = parseFloat(v.target.value) / 100;
        this.setState(this.state);
        this.props.app.synth.reverbGain = realVal;
    }

    handleToggleShownClick = () => {
        this.setState({ isShown: !this.state.isShown });
    };

    render() {
        let inputList = null;
        if (this.props.app && this.props.app.midi) {
            if (this.state.deviceNameList.length == 0) {
                inputList = (<li>(no midi devices found)</li>);
            } else {
                inputList = this.state.deviceNameList.map(i => {
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

        let connectCaption = "";
        if (this.props.app && this.props.app.roomState && this.props.app.roomState.roomTitle.length) {
            connectCaption = this.props.app.roomState.roomTitle;
        }

        const disconnectBtn = this.props.app ? (
            <li><button onClick={this.props.handleDisconnect}>Disconnect</button><div style={{ height: 20 }}>&nbsp;</div></li>
        ) : null;

        const changeUserStateBtn = this.props.app ? (
            <li style={{ marginBottom: 10 }}><button onClick={this.sendUserStateChange}>update above stuff</button></li>
        ) : null;

        const randomColor = `rgb(${[1, 2, 3].map(x => Math.random() * 256 | 0)})`;

        // volume from 0 to 1(unity) to 2
        const volumeMarkup = this.props.app && this.props.app.synth ? (
            <li>
                <input type="range" id="volume" name="volume" min="0" max="200" onChange={this.setVolumeVal} value={this.props.app.synth.masterGain * 100} />
                <label htmlFor="volume">gain:{Math.trunc(this.props.app.synth.masterGain * 100)}</label>
            </li>
        ) : null;

        const verbMarkup = this.props.app && this.props.app.synth ? (
            <li>
                <input type="range" id="verbGain" name="verbGain" min="0" max="200" onChange={this.setReverbVal} value={this.props.app.synth.reverbGain * 100} />
                <label htmlFor="verbGain">verb:{Math.trunc(this.props.app.synth.reverbGain * 100)}</label>
            </li>
        ) : null;

        const ulStyle = this.state.isShown ? { display: 'block' } : { display: "none" };
        const arrowText = this.state.isShown ? '⯆' : '⯈';

        const validationMsg = getValidationErrorMsg(this.state.userName, this.state.userColor);
        const validationMarkup = validationMsg.length ? (
            <div class="validationError">{validationMsg}</div>
        ) : null;

        return (
            <div className="component">
                <h2 style={{ cursor: 'pointer' }} onClick={this.handleToggleShownClick}>{connectCaption} {arrowText}</h2>
                <ul style={ulStyle}>
                    {disconnectBtn}
                    <li><TextInputField style={{ width: 80 }} default={this.state.userName} onChange={(val) => this.setState({ userName: val })} onEnter={this.sendUserStateChange} /> name</li>
                    <li><TextInputFieldExternalState
                        style={{ width: 80 }}
                        value={this.state.userColor}
                        onChange={(val) => this.setState({ userColor: val })}
                        onEnter={this.sendUserStateChange} />
                        <button style={{ backgroundColor: this.state.userColor }} onClick={() => { this.setState({ userColor: randomColor }) }} >random</button> color
                    </li>
                    {validationMarkup}
                    {changeUserStateBtn}
                    {inputList}
                    {volumeMarkup}
                    {verbMarkup}
                </ul>
            </div>
        );
    }
}




class Connection extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            userName: '',
            userColor: `rgb(${[1, 2, 3].map(x => Math.random() * 256 | 0)})`,
            showValidationErrors: false, // don't show until you try to connect
        };

        if (Cookies.get(window.DFRoomName + "_userName")) {
            this.state.userName = Cookies.get(window.DFRoomName + "_userName");
        }
        if (Cookies.get(window.DFRoomName + "_userColor")) {
            this.state.userColor = Cookies.get(window.DFRoomName + "_userColor");
        }
    }

    componentDidMount() {
        this.nameInput.inputRef.focus();
    }

    goConnect = () => {
        let msg = getValidationErrorMsg(this.state.userName, this.state.userColor);
        if (msg) {
            this.setState({ showValidationErrors: true });
            return;
        }
        this.props.handleConnect(this.state.userName, this.state.userColor);
    }

    render() {
        const randomColor = `rgb(${[1, 2, 3].map(x => Math.random() * 256 | 0)})`;

        //let sanitizedName = sanitizeUsername(this.state.userName);
        const validationErrorTxt = getValidationErrorMsg(this.state.userName, this.state.userColor);

        const validationError = validationErrorTxt.length && this.state.showValidationErrors ? (
            <div class='validationError'>{validationErrorTxt}</div>
        ) : null;

        return (
            <div className="component">
                <h2>Connect</h2>
                <ul>
                    <li><TextInputField ref={(input) => { this.nameInput = input; }} style={{ width: 80 }} default={this.state.userName} onChange={(val) => this.setState({ userName: val })} onEnter={this.goConnect} /> name</li>
                    <li><TextInputFieldExternalState
                        style={{ width: 80 }}
                        value={this.state.userColor}
                        onChange={(val) => this.setState({ userColor: val })}
                        onEnter={this.goConnect} />
                        <button style={{ backgroundColor: this.state.userColor }} onClick={() => { this.setState({ userColor: randomColor }) }} >random</button> color
                    </li>
                    <button onClick={this.goConnect}>Connect</button>
                    {validationError}
                </ul>
            </div>
        );
    }
}




class UserList extends React.Component {
    render() {
        if (!this.props.app || !this.props.app.roomState) {
            return null;
        }
        //         let meText = (u.userID == digifuApp.myUser.userID) ? "<ME>" : "";

        const users = this.props.app.roomState.users.map(u => (
            <li key={u.userID}><span className="userName" style={{ color: u.color }}>{u.name}</span><span className="userPing"> ({u.pingMS}ms ping)</span></li>
        ));

        return (
            <div className="component">
                <h2>User list</h2>
                <ul>
                    {users}
                </ul>
            </div>
        );
    }
}


class InstrumentList extends React.Component {

    renderInstrument(i) {
        let app = this.props.app;
        if (i.controlledByUserID == app.myUser.userID) {
            return null;
            // return (
            //     <li key={i.instrumentID} style={{ color: i.color }}><button onClick={() => app.ReleaseInstrument()}>Release</button> {i.name} (#{i.instrumentID}) [yours]</li>
            // );
        }

        let inUse = false;
        let idle = false;
        if (i.controlledByUserID) {
            inUse = true;
            let foundUser = this.props.app.roomState.FindUserByID(i.controlledByUserID);
            //console.log(`rendering instrument controlled by ${i.controlledByUserID}`);
            if (foundUser) {
                if (foundUser.user.idle) {
                    // user is taken, but considered idle. so we can show it.
                    idle = true;
                    //console.log(` ==> idle = true inst ${i.instrumentID} user ${i.controlledByUserID}`);
                }
            }
        }

        let ownedByText = "";
        if (inUse && !idle) {
            return null;
        }

        idle = idle ? "(IDLE) " : "";

        const playBtn = app.midi.AnyMidiDevicesAvailable() ? (
            <button onClick={() => app.RequestInstrument(i.instrumentID)}>Take</button>
        ) : null;

        return (
            <li key={i.instrumentID} style={{ color: i.color }}>
                {playBtn}
                {idle} {i.name} {ownedByText}</li>
        );
    }
    render() {
        if (!this.props.app || !this.props.app.roomState) {
            return null;
        }
        const instruments = this.props.app.roomState.instrumentCloset.map(i => this.renderInstrument(i));
        return (
            <div className="component" style={{ whiteSpace: "nowrap", overflowY: "scroll" }}>
                <h2>Unclaimed instruments</h2>
                <ul>
                    {instruments}
                </ul>
            </div>
        );
    }
}

class RightArea extends React.Component {

    render() {
        return (
            <div id="rightArea" style={{ gridArea: "rightArea" }}>
                <UserList app={this.props.app} />
            </div>
        );
    }
}

class LeftArea extends React.Component {

    render() {
        const userState = (!this.props.app) ? null : (
            <UserState app={this.props.app} handleConnect={this.props.handleConnect} handleDisconnect={this.props.handleDisconnect} />
        );
        return (
            <div id="leftArea" style={{ gridArea: "leftArea" }}>
                {userState}
                <InstrumentList app={this.props.app} />
            </div>
        );
    }
}


class UserAvatar extends React.Component {

    onReleaseInstrument = () => {
        if (!this.props.app) return null;
        this.props.app.ReleaseInstrument();
    };

    render() {
        if (!this.props.app) return null;
        if (!this.props.app.roomState) return null;
        console.assert(this.props.displayHelper);
        const isMe = (this.props.app.myUser.userID == this.props.user.userID);

        const inst = this.props.app.roomState.FindInstrumentByUserID(this.props.user.userID);
        let instMarkup = null;
        if (inst) {
            const instStyle = {
                color: inst.instrument.color,
            };
            let releaseButton = isMe ? (
                <button onClick={this.onReleaseInstrument}>Release</button>
            ) : null;

            instMarkup = (
                <div style={instStyle} className="userAvatarInstrument">
                    playing {inst.instrument.name}
                    <br />
                    {releaseButton}
                </div>
            );
        }

        const pos = this.props.displayHelper().roomToScreenPosition(this.props.user.position);

        const style = {
            left: pos.x,
            top: pos.y,
            color: this.props.user.color,
            borderColor: this.props.user.color
        };

        const className = "userAvatar userAvatarActivityBump1" + (isMe ? " me" : "");

        return (
            <div className={className} id={'userAvatar' + this.props.user.userID} style={style}>
                <div>{this.props.user.name}</div>
                {instMarkup}
            </div>
        );
    }
};


class ChatLog extends React.Component {
    render() {
        if ((!this.props.app) || (!this.props.app.roomState)) return null;

        const lis = this.props.app.roomState.chatLog.map(msg => {

            const dt = new Date(msg.timestampUTC);
            const timestamp = dt.toLocaleTimeString();// `${dt.getHours()}:${dt.getMinutes()}:${dt.getSeconds()}`;

            switch (msg.messageType) {
                case ChatMessageType.join:
                    return (
                        <li className="chatLogEntryJoin" key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>{msg.fromUserName} has joined the jam</span></li>
                    );
                case ChatMessageType.part:
                    return (
                        <li className="chatLogEntryJoin" key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>{msg.fromUserName} has left the jam</span></li>
                    );
                case ChatMessageType.nick:
                    return (
                        <li className="chatLogEntryNick" key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>{msg.fromUserName} is now known as {msg.toUserName}</span></li>
                    );
                case ChatMessageType.chat:
                    return (
                        <li className="chatLogEntryChat" key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>[{msg.fromUserName}]</span> {msg.message}</li>
                    );
            }

            return null;
            // return (
            //     <li key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>[{msg.fromUserName}]</span> {msg.message}</li>
            // )
        });

        return (
            <ul className='chatLog'>
                {lis}
            </ul>
        );
    }
};

class AnnouncementArea extends React.Component {
    render() {
        if (!this.props.app || !this.props.app.roomState) return null;

        return (
            <div id="announcementArea" dangerouslySetInnerHTML={{ __html: this.props.app.roomState.announcementHTML }}></div>
        );
    }
};

class RoomAlertArea extends React.Component {
    render() {
        if (!this.props.app || !this.props.app.roomState) return null;

        let roomAlertText = "";
        if (this.props.app.myInstrument && !this.props.app.midi.IsListeningOnAnyDevice()) roomAlertText = "Select a MIDI input device to start playing";

        if (roomAlertText.length < 1) return null;

        return (
            <div id="roomAlertArea"><span>{roomAlertText}</span></div>
        );
    }
};

class RoomArea extends React.Component {
    constructor(props) {
        console.log(`RoomArea ctor`);
        super(props);
        this.state = {
            scrollSize: { x: 0, y: 0 },// track DOM scrollHeight / scrollWidth
        };
        this.screenToRoomPosition = this.screenToRoomPosition.bind(this);
        this.roomToScreenPosition = this.roomToScreenPosition.bind(this);

        //this.isExpectingCheer = false; // true directly after clicking "cheer", and back to false when you mouse up or ESC
        //this.isCheerDragging = false; // true after clicking cheer and clicking mouse. back to false on mouse up or ESC
        //this.cheerText = "";
        //this.lastCheerTime = new Date(); // for throttling. AND also for detecting when we should ignore onClick due to onMouseUp handled
    }

    // helper APIs
    // where to display the background
    getScreenScrollPosition() {
        if ((!this.props.app) || (!this.props.app.roomState)) return { x: 0, y: 0 };
        let userPos = this.props.app.myUser.position;
        let x1 = (this.state.scrollSize.x / 2) - userPos.x;
        let y1 = (this.state.scrollSize.y / 2) - userPos.y;

        // that will put you square in the center of the screen every time.
        // now calculate the opposite: where the room is always centered.
        let x2 = (this.state.scrollSize.x / 2) - (this.props.app.roomState.width / 2);
        let y2 = (this.state.scrollSize.y / 2) - (this.props.app.roomState.height / 2);

        // so interpolate between the two. smaller = more fixed.
        let t = 0.3;

        return {
            x: ((x1 * t) + (x2 * (1 - t))),
            y: ((y1 * t) + (y2 * (1 - t))),
        };
    }

    screenToRoomPosition(pos) { // takes html on-screen x/y position and translates to "world" coords
        if ((!this.props.app) || (!this.props.app.roomState)) return { x: 0, y: 0 };
        let sp = this.getScreenScrollPosition();
        let ret = {
            x: pos.x - sp.x,
            y: pos.y - sp.y,
        };
        if (ret.x < 0) { ret.x = 0; }
        if (ret.y < 0) { ret.y = 0; }
        if (ret.x > this.props.app.roomState.width) { ret.x = this.props.app.roomState.width; }
        if (ret.y > this.props.app.roomState.height) { ret.y = this.props.app.roomState.height; }
        return ret;
    }

    roomToScreenPosition(pos) {
        let sp = this.getScreenScrollPosition();
        return {
            x: pos.x + sp.x,
            y: pos.y + sp.y,
        };
    }

    onClick(e) {
        // if (((new Date()) - this.lastCheerTime) < 100) {
        //     // you have cheered within some milliseconds of this event. it means this onClick is almost certainly the result of a onMouseUp where we have been cheering.
        //     return;
        // }
        if ((!this.props.app) || (!this.props.app.roomState)) return false;
        if (!e.target || e.target.id != "roomArea") return false; // don't care abotu clicking anywhere except ON THIS DIV itself
        const roomPos = this.screenToRoomPosition({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });

        //if (!this.isExpectingCheer) {
            //     this.props.app.SendCheer(this.cheerText, roomPos.x, roomPos.y);
            //     //this.isCheering = e.shiftKey; // shift continues cheering
            // } else {
            this.props.app.SetUserPosition(roomPos);
        //}
    }

    // handleCheerClick = (text) => {
    //     // init cheer state when you click "CHEER" button
    //     this.isExpectingCheer = true;
    //     this.isCheerDragging = false;
    //     this.cheerText = text;
    // }

    // onMouseDown = (e) => {
    //     if ((!this.props.app) || (!this.props.app.roomState)) return false;
    //     if (!e.target || e.target.id != "roomArea") return false; // don't care abotu clicking anywhere except ON THIS DIV itself
    //     const roomPos = this.screenToRoomPosition({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });

    //     if (this.isExpectingCheer) {
    //         this.props.app.SendCheer(this.cheerText, roomPos.x, roomPos.y);
    //         this.lastCheerTime = new Date();
    //         this.isCheerDragging = true;
    //     }
    // }

    // onMouseUp = (e) => {
    //     if (this.isExpectingCheer || this.isCheerDragging) {
    //         this.lastCheerTime = new Date(); // this is necessary so onClick() detects when to ignore due to multiple event
    //         this.isExpectingCheer = false;
    //         this.isCheerDragging = false;
    //     }
    // }

    // onMouseMove = (e) => {
    //     if ((!this.props.app) || (!this.props.app.roomState)) return false;
    //     if (!e.target || e.target.id != "roomArea") return false; // don't care abotu clicking anywhere except ON THIS DIV itself

    //     if (this.isCheerDragging) {
    //         if (e.buttons != 1) { // this indicates button pressed. important to check here because we don't always get a mouseup event if you move the mouse off-window.
    //             this.isExpectingCheer = false;
    //             this.isCheerDragging = false;
    //         }
    //         else {
    //             if (((new Date()) - this.lastCheerTime) >= ClientSettings.MinCheerIntervalMS) {
    //                 this.lastCheerTime = new Date();
    //                 const roomPos = this.screenToRoomPosition({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
    //                 this.props.app.SendCheer(this.cheerText, roomPos.x, roomPos.y);
    //             }
    //         }
    //     }
    // }

    updateScrollSize() {
        let e = document.getElementById("roomArea");
        if (e.clientWidth != this.state.scrollSize.x || e.clientHeight != this.state.scrollSize.y) {
            this.setState({
                scrollSize: { x: e.clientWidth, y: e.clientHeight }
            });
        }
    }

    componentDidMount() {
        let e = document.getElementById("roomArea");
        this.resizeObserver = new ResizeObserver((entries) => {
            this.updateScrollSize();
        });
        this.resizeObserver.observe(e);

        this.updateScrollSize();
    }

    componentWillUnmount() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
    }

    render() {
        let style = {};
        let userAvatars = null;
        if (this.props.app && this.props.app.roomState) {
            let scrollPos = this.getScreenScrollPosition();

            userAvatars = this.props.app.roomState.users.map(u => (
                <UserAvatar key={u.userID} app={this.props.app} user={u} displayHelper={() => this} />
            ));

            style = {
                gridArea: "roomArea",
                backgroundImage: `url(${this.props.app.roomState.img})`,
                backgroundPosition: `${scrollPos.x}px ${scrollPos.y}px`,
            };
        }

        let connection = (this.props.app) ? null : (
            <Connection app={this.props.app} handleConnect={this.props.handleConnect} handleDisconnect={this.props.handleDisconnect} />
        );

        return (
            <div id="roomArea" onClick={e => this.onClick(e)} style={style}>
                {connection}
                {userAvatars}
                <ChatLog app={this.props.app} />
                <AnnouncementArea app={this.props.app} />
                <RoomAlertArea app={this.props.app} />
                <CheerControls app={this.props.app} displayHelper={() => this}></CheerControls>
            </div>
        );
    }
}

class ChatArea extends React.Component {
    constructor(props) {
        super(props);
        this.state = { value: '' };
        this.handleChange = this.handleChange.bind(this);
    }

    handleClick() {
        if (!this.props.app) return;
        let sanitized = this.state.value.trim();
        if (sanitized.length < 1) return;
        sanitized = sanitized.substr(0, ServerSettings.ChatMessageLengthMax);
        this.props.app.SendChatMessage(sanitized, null);
        this.state.value = '';
    }

    handleChange(event) {
        this.setState({ value: event.target.value });
    }

    handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            return this.handleClick();
        }
    }

    render() {
        if (!this.props.app) return null;
        return (
            <div id="chatArea" style={{ gridArea: "chatArea" }}>
                chat <input type="text" value={this.state.value} onChange={this.handleChange} onKeyDown={this.handleKeyDown} />
                <button onClick={this.handleClick.bind(this)}>send</button>
            </div>
        );
    }
}

class RootArea extends React.Component {
    OnStateChange() {
        this.setState(this.state);
    }

    HandleConnect = (userName, color) => {
        let app = new DigifuApp();

        // copied from ctor
        this.notesOn = []; // not part of state because it's pure jquery
        // notes on keeps a list of references to a note, since multiple people can have the same note playing it's important for tracking the note offs correctly.
        for (let i = 0; i < 128; ++i) {
            this.notesOn.push([]); // empty initially.
        }

        app.Connect(userName, color, () => this.OnStateChange(), this.handleNoteOn, this.handleNoteOff, this.handleUserAllNotesOff, this.handleUserLeave, this.HandleNetworkDisconnected, this.HandleCheer);
        this.setState({ app });
    }

    handleRoomRef = (r) => {
        let a = 0;
    };

    HandleCheer = (data/*user, text x, y*/) => {
        //alert(`user cheer ${JSON.stringify(data)}`);
        if (!this.roomRef || !this.roomRef.current) return;
        //createCheer(data.user, data.text, data.x, data.y, this.roomRef);
        //console.log(`createCheer(${text}, ${x}, ${y})`);
        var durx = random(2) + 1.5;
        var dury = random(2) + 1.5;
        var fontSize = random(6) + 24;
        var animX = Math.trunc(random(2));
        var animY = Math.trunc(random(2));
        var easeY = Math.trunc(random(2)) ? "ease-in" : "ease-out";
        var easyX = Math.trunc(random(2)) ? "ease-in" : "ease-out";

        let pos = this.roomRef.current.roomToScreenPosition({ x: data.x, y: data.y });

        let css = `
                animation: floatX${animX} ${durx}s ${easyX} forwards,
                floatY${animY} ${dury}s ${easeY} forwards,
                floatOpacity ${dury}s ease-out forwards;
                top:${pos.y}px;
                left:${pos.x}px;
                font-size:${fontSize}px;
                color:${data.user.color}
            `;

        var cheerContainer = document.getElementById("roomArea")
        var cheer = document.createElement("div");
        cheer.innerText = data.text;
        cheer.className = "cheer";
        cheer.style.cssText = css;
        cheerContainer.append(cheer);

        setTimeout(() => {
            cheer.parentNode.removeChild(cheer);
        }, Math.max(durx, dury) * 1000);
    }

    HandleNetworkDisconnected = () => {
        // actually at this point socket.io will attempt to reconnect again and when it does, 
        // the flow of events just replays regarding handshake and welcome msg etc. so nothing needs to be done.
    };

    // called for "user clicked disconnect button".
    HandleDisconnect = () => {
        this.state.app.Disconnect();
        this.setState({ app: null });
    }

    handleNoteOn = (user, instrument, midiNote, velocity) => {
        $('#userAvatar' + user.userID).toggleClass('userAvatarActivityBump1').toggleClass('userAvatarActivityBump2');

        this.notesOn[midiNote].push({ userID: user.userID, color: user.color });
        this.activityCount++;

        let k = $("#key_" + midiNote);
        if (!k.hasClass('active')) {
            k.addClass("active");
        }
        k.css("background-color", user.color);
    }

    removeUserNoteRef(userID, midiNote) {
        let refs = this.notesOn[midiNote];
        refs.removeIf(r => (r.userID == userID));

        let k = $("#key_" + midiNote);
        if (refs.length < 1) {
            k.removeClass("active");
            k.css("background-color", "");
            return;
        }
        k.css("background-color", refs[refs.length - 1].color);
    }

    handleNoteOff = (user, instrument, midiNote) => {
        let refs = this.notesOn[midiNote];
        if (refs.length < 1) return;

        this.removeUserNoteRef(user.userID, midiNote);
    }

    handleUserAllNotesOff = (user, instrument) => {
        // remove all refs of this user
        this.notesOn.forEach((refs, midiNote) => {
            if (refs.length < 1) return;
            this.removeUserNoteRef(user.userID, midiNote);
        });
    };

    handleUserLeave = (userID) => {
        this.notesOn.forEach((ref, i) => {
            this.removeUserNoteRef(userID, i);
        });
    }

    constructor(props) {
        super(props);
        this.state = {
            app: null
        };

        this.notesOn = []; // not part of state because it's pure jquery
        this.activityCount = 0;
        this.roomRef = React.createRef();

        // notes on keeps a list of references to a note, since multiple people can have the same note playing it's important for tracking the note offs correctly.
        for (let i = 0; i < 128; ++i) {
            this.notesOn.push([]); // empty initially.
        }
    }

    render() {
        let title = "(not connected)";
        if (this.state.app && this.state.app.roomState) {
            let activityTxt = "";
            if (window.gSpinners) {
                const spinnerName = "toggle10"; // arc
                const i = this.activityCount % window.gSpinners[spinnerName].frames.length;
                activityTxt = window.gSpinners[spinnerName].frames[i];
            }
            title = `${this.state.app.roomState.roomTitle} ${activityTxt} [${this.state.app.roomState.users.length}]`;
        }
        if (document.title != title) {
            document.title = title;
        }

        const url = window.location.href.split('?')[0];
        return (
            <div id="grid-container">
                <div style={{ gridArea: "headerArea", textAlign: 'center' }} className="headerArea">
                    <span style={{ float: 'left' }}>
                        <a target="_blank" href="{url}">{url}</a></span>
                    <span style={{ float: 'right' }}>
                        <a target="_blank" href="https://github.com/thenfour/digifujam">github</a> \\&nbsp;
                        <a target="_blank" href="https://twitter.com/tenfour2">twitter</a>
                    </span>
                </div>
                <PianoArea app={this.state.app} />
                <ChatArea app={this.state.app} />
                <RoomArea app={this.state.app} handleConnect={this.HandleConnect}
                    handleDisconnect={() => this.HandleDisconnect()}
                    ref={this.roomRef} />
                <RightArea app={this.state.app} handleConnect={this.HandleConnect} handleDisconnect={() => this.HandleDisconnect()} />
                <LeftArea app={this.state.app} handleConnect={this.HandleConnect} handleDisconnect={() => this.HandleDisconnect()} />
            </div>
        );
    }
}
