const React = require('react');
const DF = require("../../DFcommon/DFCommon");
const DFUtils = require("../util");
const DFU = require('../../DFcommon/dfutil');
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

      const query = Object.fromEntries([ [ '7jamRealm', 'admin' ], ...new URLSearchParams(location.search) ]);
      query.DF_ADMIN_PASSWORD ??= window.localStorage.getItem('adminKey');

      this.state = {
         app : new AdminApp(query, () => this.RefreshUI()),
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

