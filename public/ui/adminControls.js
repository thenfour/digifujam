

class AdminControls extends React.Component {

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

    render() {
        return (
            <div className="component" style={{ whiteSpace: "nowrap" }}>
                <h2>Admin</h2>
                <button onClick={this.copyServerState}>Copy server state</button><br />
                <button onClick={this.pasteServerState}>Paste server state</button>
            </div>
        );
    }
}
