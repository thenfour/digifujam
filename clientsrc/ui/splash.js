// I actually hate splash screens, but this forces users to do a user gesture to enter the site,
// which is a requirement for Chrome before it allows you to create audiocontext.
// The AudioContext was not allowed to start. It must be resumed (or created) after a user gesture on the page. https://goo.gl/7K7WLu
const React = require('react');
const {GestureTracker} = require("../util");

const gTracker = new GestureTracker();
window.DFKeyTracker = gTracker;

class GestureSplash extends React.Component {
   constructor(props) {
      super(props);
      gTracker.events.on('gesture', () => {
         this.setState({});
      });
   }

   render() {
      if (gTracker.hasUserGestured)
         return null;
      if (!this.props.app) // allows the login screen to show.
         return null;
       return (
           <div id="gestureSplash">
              <div id="gestureSplash2">
               <img id="splashLogo" src="uiimg/splash_logo.png"></img>
               <div id="splashTextContainer">
               <div id="splashTitle">Welcome to 7jam!</div>
               <div id="splashClickToContinue">Click or press a key to continue...</div>
               </div>
              </div>
            </div>
       );
   };
}

module.exports = {
   GestureSplash,
}