const React = require('react');
const DF = require("../DFCommon");
const DFUtils = require("../util");
const DFU = require('../dfutil');


class AdminConsoleUI extends React.Component {
   constructor(props) {
       super(props);
       this.state = {
          historyCursor: 0, // 0 = new; 1 = previous etc.
          lastKnownSerial: -1,
          cmdLine: '',
       }
       this.history = [""];
   }
   
   _handleKeyDown = (e) => {
      if (e.key === 'Enter') {
         const cmdLine = this.state.cmdLine;
         if (cmdLine.trim() == 'cls') {
            this.history = [""];
            this.props.app.ConsoleLog = [];
            this.setState({ historyCursor: 0, cmdLine: ''});
            return;
         }
         this.history[0] = cmdLine;
         if (!this.state.historyCursor) {
            this.history.unshift(""); // only add a new blank commandline when you're at the top of the stack
         }
         this.setState({
            historyCursor:0,
            cmdLine: '',
         });

         this.props.app.SendConsoleCommand(cmdLine);
      }
      else if (e.key === 'ArrowUp') {
         this.SetHistoryCursor(this.state.historyCursor + 1);
      }
      else if (e.key === 'ArrowDown') {
         this.SetHistoryCursor(this.state.historyCursor - 1);
      }
   }

   SetHistoryCursor(newCursor) {
      newCursor = Math.max(0, Math.min(this.history.length - 1, newCursor));
      this.setState({
         historyCursor:newCursor,
         cmdLine: this.history[newCursor],
      });
      setTimeout(() => this.inputRef.setSelectionRange(0, this.history[this.state.historyCursor].length), 1);
   }

   componentDidMount() {
      if (this.inputRef && this.inputRef) {
          this.inputRef.focus();
      }
   }

   render() {

      const log = this.props.app.ConsoleLog.map((s, i) =>
         <li key={i}>
            <span className='date'>{new Date(s.time).toLocaleTimeString()}</span>
            <span className={s.fromClient ? "msg client" : "msg server"}>{s.message}</span>
         </li>);

      if (this.state.lastKnownSerial != this.props.app.ConsoleLogSerial) {
         setTimeout(() => {
            this.setState({lastKnownSerial: this.props.app.ConsoleLogSerial});
            this.dummyScrollEndRef?.scrollIntoView();
         }, 10);         
      }

     return (
        <div className='consoleApp'>
           <ul className='log'>
              {log}
              <li className='dummyScrollEnd' ref={e => this.dummyScrollEndRef = e}></li>
           </ul>
           <div className='inputArea'>
              <input type='text'
                  value={this.state.cmdLine}
                  onChange={(e) => { this.setState({cmdLine: e.target.value}); }}
                  onKeyDown={this._handleKeyDown}
                  className='consoleInputText'
                  ref={(input) => { this.inputRef = input; }}></input>
           </div>
        </div>
     );
   }
}

module.exports = {
   AdminConsoleUI
};

