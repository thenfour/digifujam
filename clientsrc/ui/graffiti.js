const DF = require("../DFCommon");
const React = require('react');
const { polyToPathDesc } = require("../dfutil");


class GraffitiArea extends React.Component {
  constructor(props) {
      super(props);
      this.state = {
      };
  }

  render() {
    if (this.props.area.polyPoints.length < 1) return null;
    const rgn = this.props.context.app.MyRoomRegion;
    console.log(`rendering ${this.props.area.id}; myrgn = ${rgn?.id}`);
    return (<path d={polyToPathDesc(this.props.area.polyPoints)} className={this.props.area.cssClass + (rgn?.id === this.props.area.id ? " active" : "")} />);
  }

};

class GraffitiScreen extends React.Component {
  constructor(props) {
      super(props);
      this.state = {
      };
  }

  render() {
    if (!this.props.context || !this.props.context.app) return null;
    const app = this.props.context.app;
    if (!app.roomState?.roomRegions) return null;

    const areas = app.roomState.roomRegions.map(a => (<GraffitiArea key={a.id} context={this.props.context} area={a} />));
    const pos = this.props.context.displayHelper.roomToScreenPosition({x:0,y:0});

    return (<div id="graffitiScreen">
      <svg style={{left:pos.x,top:pos.y, height:app.roomState.height, width:app.roomState.width}}>
        {areas}
      </svg>
    </div>);
  }

};

///------------------------------------------------
function isImageUrl(url) {
  try {
    url = new URL(url);
    const path = url.pathname.toLowerCase();
    if (path.endsWith(".png")) return true;
    if (path.endsWith(".svg")) return true;
    if (path.endsWith(".jpg")) return true;
    if (path.endsWith(".gif")) return true;
    if (path.endsWith(".jpeg")) return true;
  } catch (e) {
  }
  return false;
}

///------------------------------------------------
class GraffitiItem extends React.Component {
  constructor(props) {
      super(props);
  }

  onClickRemove = (e) => {
    this.props.context.app.net.SendGraffitiOps([{
      op: "remove",
      id: this.props.graffiti.id,
    }]);
  }

  render() {
    const app = this.props.context.app;
    const g = this.props.graffiti;
    const pos = this.props.context.displayHelper.roomToScreenPosition({x:g.position.x,y:g.position.y});
    const style = {
      left:pos.x,
      top:pos.y,
      color:g.color,
    };

    let isImage = isImageUrl(g.content);

    let contentEl = null;

    if (isImage) {
      const imgStyle = {
        backgroundImage: `url(${g.content})`,
      };
      contentEl = (<div className="graffitiContent image" style={imgStyle}></div>);
    } else {
      let content = g.content.substring(0, DF.ServerSettings.GraffitiContentTruncate);
      content = this.props.context.md.renderInline(content);
      contentEl = (<div className="graffitiContent text" dangerouslySetInnerHTML={{__html: content}}></div>);
    }

    // context.md
    // is it an image?

    return (
      <div style={style} className={"graffiti " + g.cssClass}>
        {contentEl}
        {window.DFShowDebugInfo && <div className="graffitiRemove" onClick={this.onClickRemove}>X</div>}
      </div>
    );
  }
}


///------------------------------------------------
class GraffitiContainer extends React.Component {
  constructor(props) {
      super(props);
  }

  render() {
    if (!this.props.context || !this.props.context.app) return null;
    const app = this.props.context.app;
    if (!app.roomState?.roomRegions) return null;

    const items = app.roomState.graffiti.map(g => (<GraffitiItem key={g.id} context={this.props.context} graffiti={g} />));

    return (<div id="graffitiContainer" className={window.DFShowDebugInfo ? "admin" : ""}>
        {items}
    </div>);
  }
}





///------------------------------------------------
// in the menus, for users to control their graffiti
class GraffitiCtrl extends React.Component {
  constructor(props) {
      super(props);
      this.state = {
        content: window.DFGraffitiContent ?? "",
      };
  }

  handleChange = (event) => {
    window.DFGraffitiContent = event.target.value;
    this.setState({content: event.target.value});
  }

  onClickPlace = (e) => {
    if (!this.props.app) return;
    this.props.app.net.SendGraffitiOps([{
      op: "place",
      content: this.state.content,
    }]);
  }

  onClickRemove = (e) => {
    if (!this.props.app) return;
    this.props.app.net.SendGraffitiOps([{
      op: "remove"
    }]);
  }

  render() {
    return (
      <div>
        <input type="text" value={this.state.content} onChange={this.handleChange} />
        <button onClick={this.onClickPlace}>Place</button>
        <button onClick={this.onClickRemove}>Remove</button>
      </div>
    );
  }
}


///------------------------------------------------
module.exports = {
  GraffitiScreen,
  GraffitiContainer,
  GraffitiCtrl,
};


