
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
    render() {
        return (
            <input type="text" style={this.props.style} value={this.state.value} onChange={(e) => this.handleChange(e.target.value)} />
        );
    }
}



class Connection extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            userName: 'user',
            userColor: 'red',
            userStatus: '🎶',
            deviceNameList: [],
        };
        GetMidiInputDeviceList().then(inputs => {
            console.log(JSON.stringify(inputs));
            this.setState({ deviceNameList: inputs });
        });
    }

    render() {
        let inputList = null;
        if (!this.props.app) {
            if (this.state.deviceNameList.length == 0) {
                inputList = (<li>(no midi devices found; can't connect)</li>);
            } else {
                inputList = this.state.deviceNameList.map(i => (
                <li key={i}>
                    <button onClick={() => this.props.handleConnect(i, this.state.userName, this.state.userColor, this.state.userStatus)}>Connect with {i}</button>
                </li>
            ));
            }
        }

        const disconnectBtn = this.props.app ? (<button onClick={this.props.handleDisconnect}>Disconnect</button>) : null;

        const changeUserNameBtn = this.props.app ? (
            <button onClick={() => this.props.app.SetUserNameColorStatus(this.state.userName, this.state.userColor, this.state.userStatus)}>Set user state</button>
        ) : null;

        return (
            <div className="component">
                <ul>
                    <li>name:<TextInputField style={{ width: 80 }} default={this.state.userName} onChange={(val) => this.setState({ userName: val })} /></li>
                    <li>color:<TextInputField style={{ width: 80 }} default={this.state.userColor} onChange={(val) => this.setState({ userColor: val })} /></li>
                    <li>status:<TextInputField style={{ width: 80 }} default={this.state.userStatus} onChange={(val) => this.setState({ userStatus: val })} /></li>
                    {inputList}
                </ul>
                {changeUserNameBtn}
                {disconnectBtn}
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
            return (
                <li key={i.instrumentID} style={{ color: i.color }}><button onClick={() => app.ReleaseInstrument()}>Release</button> {i.name} (#{i.instrumentID}) [yours]</li>
            );
        }

        let ownedByText = "";
        if (i.controlledByUserID) {
            let u = app.FindUserByID(i.controlledByUserID);
            ownedByText = " controlled by " + u.name;
        }

        return (
            <li key={i.instrumentID} style={{ color: i.color }}><button onClick={() => app.RequestInstrument(i.instrumentID)}>Request</button> {i.name} (#{i.instrumentID}) {ownedByText}</li>
        );
    }
    render() {
        if (!this.props.app || !this.props.app.roomState) {
            return null;
        }
        const instruments = this.props.app.roomState.instrumentCloset.map(i => this.renderInstrument(i));
        return (
            <div className="component">
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
                <Connection app={this.props.app} handleConnect={this.props.handleConnect} handleDisconnect={this.props.handleDisconnect} />
                <InstrumentList app={this.props.app} />
                <UserList app={this.props.app} />
            </div>
        );
    }
}


class UserAvatar extends React.Component {
    render() {
        if (!this.props.app) return null;
        if (!this.props.app.roomState) return null;
        console.assert(this.props.displayHelper);

        const inst = this.props.app.FindInstrumentByUserID(this.props.user.userID);
        let instMarkup = null;
        if (inst) {
            const instStyle = {
                color: inst.instrument.color,
            };
            instMarkup = (
                <div style={instStyle} className="userAvatarInstrument">playing {inst.instrument.name}</div>
            );
        }

        const pos = this.props.displayHelper().roomToScreenPosition(this.props.user.position);

        const style = {
            left: pos.x,
            top: pos.y,
            color: this.props.user.color,
            borderColor: this.props.user.color
        };

        return (
                <div className="userAvatar" style={style}>
                    <div>{this.props.user.name}</div>
                    <div>{this.props.user.statusText}</div>
                    {instMarkup}
                </div>
        );
    }
};

class RoomArea extends React.Component {
    constructor(props) {
        console.log(`RoomArea ctor`);
        super(props);
        this.state = {
            scrollSize:{x:0,y:0},// track DOM scrollHeight / scrollWidth
        };
        this.screenToRoomPosition = this.screenToRoomPosition.bind(this);
        this.roomToScreenPosition = this.roomToScreenPosition.bind(this);
    }

    // helper APIs
    // where to display the background
    getScreenScrollPosition() {
        if ((!this.props.app) || (!this.props.app.roomState)) return { x:-1,y:-1};
        let userPos = this.props.app.myUser.position;
        let x = (this.state.scrollSize.x / 2) - userPos.x;
        let y = (this.state.scrollSize.y / 2) - userPos.y;

        if (x > this.state.scrollSize.x / 4) x = this.state.scrollSize.x / 4; // don't scroll so far that half of the viewport is empty.
        if (y > this.state.scrollSize.y / 4) y = this.state.scrollSize.y / 4;
        let ret = { x, y };
        return ret;
    }

    screenToRoomPosition(pos) { // takes html on-screen x/y position and translates to "world" coords
        let sp = this.getScreenScrollPosition();
        return {
            x:  pos.x - sp.x,
            y: pos.y - sp.y,
        };
    }

    roomToScreenPosition(pos) {
        let sp = this.getScreenScrollPosition();
        //console.log(`RoomToScreenPosition from pos ${JSON.stringify(pos)} with scrollSize ${JSON.stringify(this.state.scrollSize)} and scrollpos=${JSON.stringify(sp)}`);
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
        console.log("updating scroll size");
        let e = document.getElementById("roomArea");
        if (e.scrollWidth != this.state.scrollSize.x || e.scrollHeight != this.state.scrollSize.y) {
            this.setState({
                scrollSize: {x:e.scrollWidth, y:e.scrollHeight}
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
                backgroundImage:`url(${this.props.app.roomState.img})`,
                backgroundPosition: `${scrollPos.x}px ${scrollPos.y}px`,
            };
        }

        return (
            <div id="roomArea" onClick={e => this.onClick(e)} style={style}>
                {userAvatars}
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
        this.props.app.SendChatMessage(this.state.value, null);
        this.state.value = '';
    }

    handleChange(event) {
        this.setState({ value: event.target.value });
    }
    render() {
        return (
            <div id="chatArea" style={{ gridArea: "chatArea" }}>
                chat <input type="text" value={this.state.value} onChange={this.handleChange} />
                <button onClick={this.handleClick.bind(this)}>send</button>
            </div>
        );
    }
}

class PianoArea extends React.Component {
    render() {
        return (
            <div id="pianoArea" style={{ gridArea: "pianoArea" }}>piano</div>
        );
    }
}

class RootArea extends React.Component {
    OnStateChange() {
        this.setState(this.state);
    }
    OnUserStateChange() {
        this.setState(this.state);
    }

    HandleConnect(midiDevice, userName, color, statusText) {
        let app = new DigifuApp();
        app.Connect(midiDevice, userName, color, statusText, () => this.OnStateChange(), () => this.OnUserStateChange());
        this.setState({ app });
    }

    HandleDisconnect() {
        this.state.app.Disconnect();
        this.setState({ app: null });
    }

    constructor(props) {
        super(props);
        this.state = {
            app: null
        };
    }

    render() {
        return (
            <div id="grid-container">
                <div style={{ gridArea: "headerArea" }} className="headerArea">
                    <h2 >
                        <a target="_blank" href="https://digifujam.eu.openode.io/">digifujam.eu.openode.io/</a> |
                        <a target="_blank" href="https://github.com/thenfour/digifujam">github.com/thenfour/digifujam</a>
                    </h2>
                </div>
                <PianoArea app={this.state.app} />
                <ChatArea app={this.state.app} />
                <RoomArea app={this.state.app} />
                <RightArea app={this.state.app} handleConnect={(a, b, c, d) => this.HandleConnect(a, b, c, d)} handleDisconnect={() => this.HandleDisconnect()} />
            </div>
        );
    }
}

