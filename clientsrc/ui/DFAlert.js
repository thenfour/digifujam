const React = require('react');
const DFU = require('../dfutil');
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
      console.log(`alert message: ${message}`);
      this.setState({message});
    };
  }

  componentWillUnmount() {
    window.alert = window.DFOldAlert;
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
