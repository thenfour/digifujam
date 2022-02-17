const React = require('react');
const DFU = require('../../DFcommon/dfutil');
const ClickAwayListener = require('./3rdparty/react-click-away-listener');
const DFUtils = require("../util");

class DFAlert extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      message: null,
    }
  }

  componentDidMount() {
    window.DFOldAlert = window.alert;
    window.alert = (message) => {
      this.setState({message});
    };

    window.DFKeyTracker.events.on("keydown", this.documentOnKeyDown);
  }

  componentWillUnmount() {
    window.alert = window.DFOldAlert;
    window.DFKeyTracker.events.removeListener("keydown", this.documentOnKeyDown);
  }

  documentOnKeyDown = (e) => {
    if (!this.state.message) return;
    e.stopPropagation();
    e.preventDefault();
    this.setState({message: null});
  }

  render() {
    if (!this.state.message) return null;
    return (
        <div id="alertScreen" onClick={() => this.setState({message: null})}>
        <div id="alertScreen2">
            <div id="alertContent">{this.state.message}</div>
            <div id="alertClickToContinue">Click or press a key to continue...</div>
        </div>
        </div>);
  };
}


module.exports = {
  DFAlert,
};
