const React = require('react');
const DFU = require('../dfutil');
const ClickAwayListener = require ('./3rdparty/react-click-away-listener');
const DF = require("../DFCommon");



/////////////////////////////////////////////////////////////////////////////////////////////////////////
class SequencerPresetDialog extends React.Component {
   constructor(props) {
      super(props);
      this.state = {
      };
   }

   render() {

     return (
      <div className="dialogContainer">
         <legend onClick={this.props.onClose}>Presets</legend>
         <ul className='dropDownMenu'>
            <li>a preset?</li>
         </ul>
      </div>

     );
 }
};

module.exports = SequencerPresetDialog;

