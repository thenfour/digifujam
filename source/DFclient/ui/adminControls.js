const React = require('react');
let DF = require('../../DFcommon/DFCommon');
DF = Object.assign(DF, require('../../DFcommon/dfutil'));
const ClickAwayListener = require ('./3rdparty/react-click-away-listener');

let gErrorNo = 0;

class AdminControls extends React.Component {

    constructor(props) {
        super(props);
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
                window.DFStateChangeHandler.OnStateChange();
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

    _handleBackupServerState = () => {
        this.props.app.net.SendAdminChangeRoomState("backupServerState");
    }

    render() {

        const uptime = new DF.TimeSpan(this.props.app.serverUptimeSec * 1000);

        return (
                    <div>
                        <div>uptime: {uptime.longString}</div>
                        <div>node_env: {this.props.app.node_env}</div>
                        <div><button onClick={() => { throw new Error(`admin error #${gErrorNo++}`)}}>throw an exception (ALT+2)</button></div>
                        <div><a href="/stats.html" target="_blank">Stats</a></div>
                        <div><a href="/activityHookInspector.html" target="_blank">Activity graphs</a></div>
                        <div><a href="/admin.html" target="_blank">Admin page</a></div>
                        <button onClick={this.copyServerState}>Copy server state</button><br />
                        <button onClick={this.pasteServerState}>Paste server state</button><br />
                        <button onClick={this._handleBackupServerState}>Manually backup server state</button><br />
                        <button onClick={() => {window.DFShowDebugInfo = !window.DFShowDebugInfo; window.DFStateChangeHandler.OnStateChange();}}>Show/hide debug stuff</button>
                        <div>
                            announcement HTML (live update):<br />
                            <textarea style={{width:"100%", height:"250px"}} value={this.props.app.roomState.announcementHTML} onChange={e => this._handleChangeAnnouncementHTML(e.target.value)} />
                        </div>
                        <div>
                            background image:<br />
                            <input style={{width:"100%"}} type="text" value={this.props.app.roomState.backgroundLayers.at(-1).img} onChange={e => this._handleChangeRoomImg(e.target.value)} />
                        </div>
                    </div>
        );
    }
}

class AdminControlsButton extends React.Component {
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

       return [
            <div key="1" className='topMenuButton serverSettings' onClick={this.onClickExpand}>
                Server <i className="material-icons">settings</i>
            </div>,
            <div key="2" className='popupPositioner'>
            {this.state.isExpanded &&
                <ClickAwayListener onClickAway={() => { this.setState({isExpanded:false});}}>
                    <div className="userSettingsDialog popUpDialog">
                        <AdminControls app={this.props.app}></AdminControls>
                    </div>
                </ClickAwayListener>
            }
            </div>
        ];
    }
 };
 

 

module.exports = {
    AdminControlsButton
}