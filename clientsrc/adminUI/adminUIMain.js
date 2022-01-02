const React = require('react');
const DF = require("../DFCommon");
const DFUtils = require("../util");
const DFU = require('../dfutil');
const {AdminApp} = require('../admin/adminApp');
const {AdminHomeUI} = require('./adminHomeUI');
const {AdminConsoleUI} = require('./adminConsoleUI');

const eApps = {
   Home : [ 'home', AdminHomeUI ],
   Console : [ 'console', AdminConsoleUI ],
};

class AdminRootArea extends React.Component {
   constructor(props) {
      super(props);
      this.state = {
         app : new AdminApp(Object.fromEntries([ [ '7jamRealm', 'admin' ], ...new URLSearchParams(location.search) ]), () => this.RefreshUI()),
         selectedAppID : Object.keys(eApps)[0],
      }
   }

   RefreshUI() {
      this.setState({});
   }

   render() {
      if (!this.state.app.IsAuthorized())
         return null;

       const appList = Object.entries(eApps).map(e => 
         <li key={e[0]} onClick={()=> this.setState({selectedAppID:e[0]})} className={e[0] === this.state.selectedAppID ? "selected" : ""}>{e[1][0]}</li>
       );

       const appMain = React.createElement(eApps[this.state.selectedAppID][1], {
          app:this.state.app,
       });

      return (
         <div id="mainContainer">
            <div id="appsSidebar">
               <ul>
                  {appList}
               </ul>
            </div>
            <div id="appMain">
               {appMain}
            </div>
         </div>
      );
    }
}


module.exports = {
   AdminRootArea,
};

