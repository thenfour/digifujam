

class AdminControls extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            isShown: false,
        }
    }

    copyServerState = () => {
        this.props.app.net.downloadServerState((data) => {
            let txt = JSON.stringify(data, null, 2);
            navigator.clipboard.writeText(txt).then(() => {
                alert('Server state was copied to the clipboard.')
            }, () => {
                alert('Unable to copy.')
            });

        });
    };

    pasteServerState = () => {
        navigator.clipboard.readText().then(text => {
            try {
                let presetObj = JSON.parse(text);
                this.props.app.net.uploadServerState(presetObj);
                gStateChangeHandler.OnStateChange();
            } catch (e) {
                alert(`Unable to import; probably badly formatted text... Exception: ${e}`);
            }
        })
            .catch(err => {
                alert('Unable to read clipboard');
            });
    };

    _handleChangeAnnouncementHTML(txt) {
        this.props.app.net.SendAdminChangeRoomState("setAnnouncementHTML", txt);
    }

    _handleChangeRoomImg(txt) {
        this.props.app.net.SendAdminChangeRoomState("setRoomImg", txt);
    }

    onClickHeader = e => {
        this.setState({ isShown: !this.state.isShown });
    }

    render() {

        const uptimeInSec = this.props.app.serverUptimeSec;
        const uptimeInMin = uptimeInSec / 60;
        const uptimeInHours = uptimeInMin / 60;
        const uptimeHours = Math.trunc(uptimeInHours).toString().padStart(2, "0");
        const uptimeMinutes = Math.trunc(DF.getDecimalPart(uptimeInHours) * 60).toString().padStart(2, "0");
        const uptimeSec = Math.trunc(DF.getDecimalPart(uptimeInMin) * 60).toString().padStart(2, "0");

        const uptimeStr = `${uptimeHours}h ${uptimeMinutes}m ${uptimeSec}s`;

        return (
            <div className="component" style={{ whiteSpace: "nowrap" }}>
                <h2 onClick={this.onClickHeader}>{DF.getArrowText(this.state.isShown)} Admin</h2>
                {this.state.isShown &&
                    <div>
                        <div>uptime: {uptimeStr}</div>
                        <button onClick={this.copyServerState}>Copy server state</button><br />
                        <button onClick={this.pasteServerState}>Paste server state</button>
                        <div style={{ fontSize: "x-small" }}>
                            announcement HTML (live update):<br />
                            <textarea value={this.props.app.roomState.announcementHTML} onChange={e => this._handleChangeAnnouncementHTML(e.target.value)} />
                        </div>
                        <div style={{ fontSize: "x-small" }}>
                            roomimg:<br />
                            <input type="text" value={this.props.app.roomState.img} onChange={e => this._handleChangeRoomImg(e.target.value)} />
                        </div>
                    </div>
                }
            </div>
        );
    }
}
