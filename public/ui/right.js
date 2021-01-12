//const { ServerSettings } = require("../DFCommon");



let getValidationErrorMsg = function (userName, userColor, userStatus) {
    let sanitizedName = sanitizeUsername(userName);
    let validationErrorTxt = (sanitizedName != null) ? "" : "! Please enter a valid username";

    let sanitizedColor = sanitizeUserColor(userColor);
    if (sanitizedColor == null) {
        validationErrorTxt += "! Please enter a valid CSS color";
    }
    let sanitizedStatus = sanitizeUserStatus(userStatus);
    if (sanitizedStatus == null) {
        validationErrorTxt += "! Please enter a valid status message";
    }
    return validationErrorTxt;
}




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
            <input type="text" ref={(input) => { this.inputRef = input; }} style={this.props.style} value={this.state.value} onChange={(e) => this.handleChange(e.target.value)} onKeyDown={this._handleKeyDown} />
        );
    }
}


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




class UserState extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            userName: '',
            userColor: '',
            userStatus: '',
            deviceNameList: [],
            isShown: true,
        };

        if (this.props.app && this.props.app.myUser) {
            this.state.userName = this.props.app.myUser.name;
            this.state.userColor = this.props.app.myUser.color;
            this.state.userStatus = this.props.app.myUser.statusText;
        }

        GetMidiInputDeviceList().then(inputs => {
            console.log(JSON.stringify(inputs));
            this.setState({ deviceNameList: inputs });
        });
    }

    sendUserStateChange = (e) => {
        this.props.app.SetUserNameColorStatus(this.state.userName, this.state.userColor, this.state.userStatus);
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

        const validationMsg = getValidationErrorMsg(this.state.userName, this.state.userColor, this.state.userStatus);
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
                    <li><TextInputField style={{ width: 80 }} default={this.state.userStatus} onChange={(val) => this.setState({ userStatus: val })} onEnter={this.sendUserStateChange} /> status</li>
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
            userStatus: '🎶',
            showValidationErrors: false, // don't show until you try to connect
        };

        if (Cookies.get("userName")) {
            this.state.userName = Cookies.get("userName");
        }
        if (Cookies.get("userColor")) {
            this.state.userColor = Cookies.get("userColor");
        }
        if (Cookies.get("userStatus")) {
            this.state.userStatus = Cookies.get("userStatus");
        }
    }

    componentDidMount() {
        this.nameInput.inputRef.focus();
    }

    goConnect = () => {
        let msg = getValidationErrorMsg(this.state.userName, this.state.userColor, this.state.userStatus);
        if (msg) {
            this.setState({ showValidationErrors: true });
            return;
        }
        this.props.handleConnect(this.state.userName, this.state.userColor, this.state.userStatus);
    }

    render() {
        const randomColor = `rgb(${[1, 2, 3].map(x => Math.random() * 256 | 0)})`;

        //let sanitizedName = sanitizeUsername(this.state.userName);
        const validationErrorTxt = getValidationErrorMsg(this.state.userName, this.state.userColor, this.state.userStatus);

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
                    <li><TextInputField style={{ width: 80 }} default={this.state.userStatus} onChange={(val) => this.setState({ userStatus: val })} onEnter={this.goConnect} /> status</li>
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
            <li key={u.userID} style={{ color: u.color }}>{u.name} ({u.pingMS}ms ping)</li>
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
                <div>{this.props.user.statusText}</div>
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

            return (
                <li key={msg.messageID}>{timestamp} <span style={{ color: msg.fromUserColor }}>[{msg.fromUserName}]</span> {msg.message}</li>
            )
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
        if ((!this.props.app) || (!this.props.app.roomState)) return false;
        if (!e.target || e.target.id != "roomArea") return false; // don't care abotu clicking anywhere except ON THIS DIV itself
        const roomPos = this.screenToRoomPosition({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
        this.props.app.SetUserPosition(roomPos);
    }

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

    HandleConnect = (userName, color, statusText) => {
        let app = new DigifuApp();

        // copied from ctor
        this.notesOn = []; // not part of state because it's pure jquery
        // notes on keeps a list of references to a note, since multiple people can have the same note playing it's important for tracking the note offs correctly.
        for (let i = 0; i < 128; ++i) {
            this.notesOn.push([]); // empty initially.
        }

        app.Connect(userName, color, statusText, () => this.OnStateChange(), this.handleNoteOn, this.handleNoteOff, this.handleUserAllNotesOff, this.handleUserLeave, this.HandleNetworkDisconnected);
        this.setState({ app });
    }

    HandleNetworkDisconnected = () => {
        // actually at this point socket.io will attempt to reconnect again and when it does, 
        // the flow of events just replays regarding handshake and welcome msg etc. so nothing needs to be done.
    };

    // called BOTH for "the network disconnected us whoopsie" and "user clicked disconnect button".
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
        document.title = title;

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
                <RoomArea app={this.state.app} handleConnect={this.HandleConnect} handleDisconnect={() => this.HandleDisconnect()} />
                <RightArea app={this.state.app} handleConnect={this.HandleConnect} handleDisconnect={() => this.HandleDisconnect()} />
                <LeftArea app={this.state.app} handleConnect={this.HandleConnect} handleDisconnect={() => this.HandleDisconnect()} />
            </div>
        );
    }
}
