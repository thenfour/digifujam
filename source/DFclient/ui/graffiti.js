const DF = require('../../DFcommon/DFCommon');
const React = require('react');
const { polyToPathDesc, remap, IsImageFilename, modulo, TimeSpan } = require('../../DFcommon/dfutil');


class GraffitiArea extends React.Component {
  constructor(props) {
      super(props);
      this.state = {
      };
  }

  render() {
    if (this.props.area.polyPoints.length < 1) return null;
    const rgn = this.props.context.app.MyRoomRegion;
    //console.log(`rendering ${this.props.area.id}; myrgn = ${rgn?.id}`);
    return (<path d={polyToPathDesc(this.props.area.polyPoints)} className={this.props.area.cssClass + (rgn?.id === this.props.area.id ? " active" : "")} />);
  }

};

class GraffitiScreen extends React.Component {
  constructor(props) {
      super(props);
      this.state = {
      };
  }

  onClick = (e) => {
    if (!e.target || e.target.id != "graffitiScreen") return false; // don't care abotu clicking anywhere except ON THIS DIV itself
    const roomPos = this.screenToRoomPosition({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
    //console.log(`room pos ${JSON.stringify(roomPos)}`);
    //this.props.app.SetUserPosition(roomPos);
  }

  render() {
    if (!this.props.context || !this.props.context.app) return null;
    const app = this.props.context.app;
    if (!app.roomState?.roomRegions) return null;

    const areas = app.roomState.roomRegions.map(a => (<GraffitiArea key={a.id} context={this.props.context} area={a} />));
    const pos = this.props.context.displayHelper.roomToScreenPosition({x:0,y:0});

    return (<div id="graffitiScreen" onClick={this.onClick}>
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
    return IsImageFilename(url.pathname);
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

  onClickCtrl(graffitiID) {
    //console.log(`control ${graffitiID}`);
    window.DFModerationControlContext.op = "graffiti";
    window.DFModerationControlContext.graffitiID = graffitiID;
    window.DFStateChangeHandler.OnStateChange();
  }

  render() {
    const app = this.props.context.app;
    const g = this.props.graffiti;
    const pos = this.props.context.displayHelper.roomToScreenPosition({x:g.position.x,y:g.position.y});

    const isYours = (this.props.context.app.myUser.userID === g.userID);

    let rot = remap(g.seed, 0, 1, 4, 10) * Math.sign(((g.seed * 1337) % 2) - 1);
    const fonts = [
      'Barriecito',
      'Gochi Hand',
      'Patrick Hand SC',            
    ];
    let fontFamily = fonts.at(modulo(Math.trunc(g.seed * 10899), fonts.length));

    const style = {
      left:pos.x,
      top:pos.y,
      color:g.color,
      transformOrigin: "0 0",
      transform: `rotateZ(${rot}deg) translate(-50%,-50%)`,
      fontFamily,
    };

    let isImage = isImageUrl(g.content);

    let contentEl = null;

    if (isImage) {
      const imgStyle = {
        backgroundImage: `url(${g.content})`,
        "--size": g.size ?? "100px",
      };
      contentEl = (<div className="graffitiContent image" style={imgStyle}></div>);
    } else {
      let content = g.content.substring(0, DF.ServerSettings.GraffitiContentTruncate);
      content = this.props.context.md.renderInline(content);
      contentEl = (<div className="graffitiContent text" dangerouslySetInnerHTML={{__html: content}}></div>);
    }

    // graffitiItemContainer > graffiti > graffitiContent
    // container because we apply our own transformations & positioning.
    return (
      <div className={"graffitiItemContainer " + (isImage ? " image" : " text")} style={style}>
      <div className={"graffiti " + g.cssClass}>
        {contentEl}
        {(window.DFModerationControlsVisible && app.myUser.IsModerator()) &&
          <div className='graffitiControls'>
            {/* <div className="graffitiRemove" title='delete' onClick={this.onClickRemove}>&#128465;<i className="material-icons">delete</i></div> */}
            {g.pinned && <div className="graffitiPin" title='Pinned' onClick={() => this.onClickCtrl(g.id)}><i className="material-icons">push_pin</i></div>}
            {<div className="graffitiCtrl" title='Settings' onClick={() => this.onClickCtrl(g.id)}><i className="material-icons">settings</i></div>}
          </div>
        }
      </div>
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

//------------------------------------------------
// in the menus, for users to control their graffiti
class GraffitiCtrl extends React.Component {
  constructor(props) {
      super(props);
      this.state = {
        content: "",
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

  onClickRemove = (graffitiID) => {
    if (!this.props.app) return;
    this.props.app.net.SendGraffitiOps([{
      op: "remove",
      id: graffitiID,
    }]);
  }

  render() {
    const me = this.props.app.myUser;
    return (
      <div className='graffitiUserCtrl'>
        <div>
          {/* pinned graffiti controls */}
          {this.props.app.roomState.graffiti
            .filter(g => this.props.app.roomState.isUserForGraffiti(g, me.userID, me.persistentID))
            .map((g,i) => {
              return (<div key={i} className='mygraffiti'>
                  <div className='controls'>
                    {g.pinned ?
                      <div className='pinIndicator'><i className="material-icons">push_pin</i></div>
                      : <div className='expires'>Expires in {new TimeSpan(new Date(g.expires) - new Date()).longString}</div>
                    }
                    <button onClick={() => this.onClickRemove(g.id)}><i className="material-icons">delete</i></button>
                  </div>
                  <div className='content'>{g.content}</div>
                </div>);
            })
          }
        </div>

        <div>
          {/* manage "NEW" graffiti. */}
          <input type="text" value={this.state.content} onChange={this.handleChange} />
          <button onClick={this.onClickPlace}>Place</button>
        </div>
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


