const DF = require("../DFCommon");
const React = require('react');
const DFU = require('../dfutil');


class SequencerParamGroup extends React.Component {

   constructor(props) {
       super(props);
       this.state = {
          expanded: true,
       };
   }

   onOpenClicked = () => {
      this.setState({ expanded: !this.state.expanded });
  };

   render() {
      if (!this.props.app || !this.props.instrument || !this.props.instrument.allowSequencer) return null;
      const arrowText = this.state.expanded ? '⯆' : '⯈';
      return (
         <fieldset className="instParamGroup sequencerGroup">
            <legend onClick={this.onOpenClicked}>{arrowText} Sequencer</legend>
            {this.state.expanded &&
            (<ul className="instParamList">
               <li><button>play/stop</button></li>
               <li><button onClick={() => {this.props.setSequencerShown(!this.props.sequencerShown)}}>show/hide</button></li>
               <li><button>presets</button></li>
            </ul>)
            }
         </fieldset>
      );
   }
}

// app={this.props.app} instrument={this.props.instrument} observerMode={this.props.observerMode}></SequencerParamGroup>
// setSequencerShown = (shown) => {...}
// isSequencerShown

module.exports = {
   SequencerParamGroup,
}

