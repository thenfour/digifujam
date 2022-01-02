const React = require('react');


class AdminHomeUI extends React.Component {
    render() {
      return (
         <div>
            <ul>
            <li><a target="_blank" href="/activityHookInspector.html">activityHookInspector</a></li>
            <li><a target="_blank" href="/stats.html">stats</a></li>
            </ul>
            <pre>{JSON.stringify(this.props.app?.mainInfo, null, 2)}</pre>
         </div>
      );
    }
};


module.exports = {
   AdminHomeUI,
};