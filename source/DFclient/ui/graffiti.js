const DF = require('../../DFcommon/DFCommon');
const React = require('react');
const { polyToPathDesc, remap, IsImageFilename, modulo, TimeSpan } = require('../../DFcommon/dfutil');
const { RegisterModalHandler, DFInvokeModal, DFModalDialog } = require('./roomPresets');









/////////////////////////////////////////////////////////////////////////////////////////////////////////
class RoomRegionPointDlg extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      shiftAmt: 5,
      liveValueStr: props.context.pointStr,
    };
  }

  componentDidMount() {
    document.addEventListener('keydown', this.keydownHandler);
    this.props.app.events.addListener("LaunchRoomRegionPointDlg", this.onLaunchRoomRegionPointDlg);
  }

  componentWillUnmount() {
    document.removeEventListener('keydown', this.keydownHandler);
    this.props.app.events.removeListener("LaunchRoomRegionPointDlg", this.onLaunchRoomRegionPointDlg);
  }

  onLaunchRoomRegionPointDlg = (e) => {
    console.log(e);
    this.setState({liveValueStr:e.pointStr});
  }

  keydownHandler = (e) => {
    const callback = {
      "ArrowLeft"  : this.onClickShiftLeft,
      "ArrowRight" : this.onClickShiftRight,
      "ArrowUp"    : this.onClickShiftUp,
      "ArrowDown"  : this.onClickShiftDown,
    }[e.key];
    callback?.();
  }

  setPos(dx, dy) {
    const newPt = JSON.parse(this.state.liveValueStr);
    newPt[0] += dx * this.state.shiftAmt;
    newPt[1] += dy * this.state.shiftAmt;
    const newStr = JSON.stringify(newPt);
    // find all points which are liveValueStr, and make them the new str

    this.props.app.roomState.roomRegions.forEach(rgn => {
      rgn.polyPoints = rgn.polyPoints.map(existingPt => {
        const str = JSON.stringify(existingPt);
        if (str === this.state.liveValueStr) {
          return newPt;
        }
        return existingPt;
      });
    });

    this.setState({liveValueStr: newStr});
    window.DFModalDialogContext.pointStr = newStr;
    window.DFStateChangeHandler.OnStateChange();
  }

  onClickShiftUp = () => {
    this.setPos(0, -1);
  }
  onClickShiftDown = () => {
    this.setPos(0, 1);
  }
  onClickShiftLeft = () => {
    this.setPos(-1, 0);
  }
  onClickShiftRight = () => {
    this.setPos(1, 0);
  }

  onClickCopy = (e) => {
    const txt = JSON.stringify({ roomRegions: this.props.app.roomState.roomRegions });
    navigator.clipboard.writeText(txt).then(() => {
      alert('Copied to the clipboard!')
    }, (e) => {
      console.log(e);
      alert('Unable to copy.')
    });
  }

  onClickPaste = (e) => {
    try {
      navigator.clipboard.readText()
        .then(text => {
          let pastingObj = JSON.parse(text);
          if (!pastingObj.roomRegions) {
            alert(`i don't think this is the right format.`);
            return;
          }
          this.props.app.roomState.roomRegions = pastingObj.roomRegions;
          window.DFStateChangeHandler.OnStateChange();
        })
        .catch(e => {
          console.log(e);
          alert('There was a problem pasting; check console (A)');
        });
    } catch (e) {
      console.log(e);
      alert('There was some problem pasting; check console (B).');
    }
  }

  render() {
    return (
      <DFModalDialog modalClassName="roomRegionPointEditor">
          <div className='subtext'>
            Changes made here are local only.
          </div>
        <fieldset>
          <div className="legend">Point editor</div>

          <input type="text" readOnly="readonly" value={this.state.liveValueStr} />

          <div className='positionCtrl'>
            <div className='vertbuttons'>
                <button onClick={this.onClickShiftUp}><i className="material-icons">arrow_drop_up</i></button>
                <button onClick={this.onClickShiftDown}><i className="material-icons">arrow_drop_down</i></button>
            </div>
            <div className='horizbuttons'>
                <button onClick={this.onClickShiftLeft}><i className="material-icons">arrow_left</i></button>
                <button onClick={this.onClickShiftRight}><i className="material-icons">arrow_right</i></button>
            </div>
          </div>
          <div className='shiftAmtButtons'>
            <button className={this.state.shiftAmt === 1 ? "active" : ""} onClick={() => this.setState({shiftAmt: 1})}>1px</button>
            <button className={this.state.shiftAmt === 5 ? "active" : ""} onClick={() => this.setState({shiftAmt: 5})}>5px</button>
            <button className={this.state.shiftAmt === 25 ? "active" : ""} onClick={() => this.setState({shiftAmt: 25})}>25px</button>
            <button className={this.state.shiftAmt === 125 ? "active" : ""} onClick={() => this.setState({shiftAmt: 125})}>125px</button>
          </div>
        </fieldset>
        <button onClick={this.onClickCopy}>Copy room region JSON</button>
        <button onClick={this.onClickPaste}>Paste room region JSON</button>
      </DFModalDialog>
    );
  }
}








/////////////////////////////////////////////////////////////////////////////////////////////////////////
RegisterModalHandler("RoomRegionPointDlg", (app, context) => {
  return <RoomRegionPointDlg app={app} context={context} />;
});

function LaunchRoomRegionPointDlg(app, pointStr) {
  //window.DFStateChangeHandler.OnStateChange();
  app.events.emit("LaunchRoomRegionPointDlg", { pointStr });

  DFInvokeModal({
    op: "RoomRegionPointDlg",
    pointStr,
  })
}




/////////////////////////////////////////////////////////////////////////////////////////////////////////
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
    // find a suitable location for text.
    const acc = [0,0];
    this.props.area.polyPoints.forEach(pt => { acc[0] += pt[0]; acc[1] += pt[1]; });
    acc[0] /= this.props.area.polyPoints.length;
    acc[1] /= this.props.area.polyPoints.length;
    const activeClass = (rgn?.id === this.props.area.id ? " active" : "");
    return (
      <g>
      <path d={polyToPathDesc(this.props.area.polyPoints)} className={this.props.area.cssClass +activeClass} />
      <text x={acc[0]} y={acc[1]} className={"regionLabel " + activeClass}>ID:{this.props.area.id}</text>
      </g>
    );
  }

};

/////////////////////////////////////////////////////////////////////////////////////////////////////////
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

    const uniquePoints = new Set(); // stores a STRING representation of points.
    app.roomState.roomRegions.forEach(rgn => {
      rgn.polyPoints.forEach(pt => {
        const str = JSON.stringify(pt);
        uniquePoints.add(str);
      });
    });

    const points = [];
    uniquePoints.forEach((ptStr, i) => {
      const pt = JSON.parse(ptStr);
      const ptpos = this.props.context.displayHelper.roomToScreenPosition({x:pt[0],y:pt[1]});
      const ptstyle = {
        "--x": `${ptpos.x}px`,
        "--y": `${ptpos.y}px`,
      };
      points.push(
      <div key={i} className={"roomRegionPointHandle " + (window.DFModalDialogContext.pointStr === ptStr ? " selected" : "")} style={ptstyle} onClick={(e) => LaunchRoomRegionPointDlg(app, ptStr)}>
        <div className='inner'></div>
      </div>);
    })

    return (<div id="graffitiScreen" onClick={this.onClick}>
      <svg style={{left:pos.x,top:pos.y, height:app.roomState.height, width:app.roomState.width}}>
        {areas}
      </svg>
      {points}
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

    //const isYours = app.roomState.isUserForGraffiti(g, app.myUser.userID, app.myUser.persistentID);

    let rot = 0;
    if (!g.disableRotation) {
      rot = remap(g.seed, 0, 1, 4, 10) * Math.sign(((g.seed * 1337) % 2) - 1);
    }
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
      "--rot": `${rot}deg`,
      //transform: `rotateZ(${rot}deg) translate(-50%,-50%)`,
      fontFamily,
      "--RX": g.RX ?? 0,
      "--RY": g.RY ?? 0,
      "--RZ": g.RZ ?? 0,
      "--RW": g.RW ?? 0,
      "--seed": g.seed,
      "--size": g.size ?? 0,
    };

    let isImage = isImageUrl(g.content);

    let contentEl = null;

    if (isImage) {
      const imgStyle = {
        backgroundImage: `url(${g.content})`,
        "--size": g.size ? `${g.size}px` : "100px",
      };
      contentEl = (<div className="graffitiContent image" style={imgStyle}></div>);
    } else {
      const style = {
        // this is not actually used most of the time, but if you want to be able to change the size of text, use dynamicFontSize css class and then it will use this.
        "--size": g.size ? `${g.size}px` : "100px",
      };
      let content = g.content.substring(0, DF.ServerSettings.GraffitiContentTruncate);
      content = content.replaceAll("{roomTitle}", app.roomState.roomPresets.liveMetadata.name);
      content = content.replaceAll("{roomDescription}", app.roomState.roomPresets.liveMetadata.description);
      content = content.replaceAll("{roomTags}", app.roomState.roomPresets.liveMetadata.tags);
      // content = content.replaceAll("{roomAnnouncement}", app.roomState.); <-- currently not supported because it's non-trivial with the timer stuff
      content = window.DFRenderMarkdown(content);
      contentEl = (<div className="graffitiContent text" style={style} dangerouslySetInnerHTML={{__html: content}}></div>);
    }

    // graffitiItemContainer > graffiti > graffitiContent
    // container because we apply our own transformations & positioning.
    return [
      (<div key="g" className={"graffitiItemContainer " + (isImage ? " image " : " text ") + " " + g.cssClass + " " + g.extraCssClass} style={style}>
        <div className={"graffiti " + g.cssClass + " " + g.extraCssClass}>
          {contentEl}
        </div>
      </div>),

    (window.DFModerationControlsVisible && app.myUser.IsModerator()) &&
      <div key="mod" className='graffitiModerationCtrl' style={style}>
        {g.pinned && <div className="graffitiPin" title='Pinned' onClick={() => this.onClickCtrl(g.id)}><i className="material-icons">push_pin</i></div>}
        {<div className="graffitiCtrl" title='Settings' onClick={() => this.onClickCtrl(g.id)}><i className="material-icons">settings</i></div>}
      </div>
    ];
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

    const items = app.roomState.graffiti
      .filter(g => app.GraffitiIsVisible(g))
      .map(g => (<GraffitiItem key={g.id} context={this.props.context} graffiti={g} />));

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


