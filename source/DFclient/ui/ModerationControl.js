
const React = require('react');
const { UserSourceToString, UserPresenceToString, eUserGlobalRole } = require('../../DFcommon/DFUser');
const { TimeSpan, hoursToMS, daysToMS } = require('../../DFcommon/dfutil');
const { IntRangeValueSpec, SeqLegendKnob } = require('./knob');

// window.DFModerationControlsVisible

// defines which ctrl panel is visible.
window.DFModerationControlContext = {
  op: null, // "user", "chat", "graffiti", "room", etc...
};


/////////////////////////////////////////////////////////////////////////////////////////////////////////
class RoomModerationDialog extends React.Component {

  constructor(props) {
    super(props);
    this.state = {
    };
  }

  onClickWhoCanPerform(o) {
    this.props.app.net.SendAdminChangeRoomState("setWhoCanPerform", {
      whoCanPerform: o,
    });
  }

  render() {
    const app = this.props.app;

    return (
      <div className='moderationPanel room'>
        <div className='topControls'>
          <span>{app.roomState.roomTitle}</span>
          <button className='close' onClick={() => { window.DFModerationControlContext.op = null; window.DFStateChangeHandler.OnStateChange();}}><i className="material-icons">close</i></button>
        </div>
        <div className='body'>
          <dt>who can perform?</dt>
          <dd>
            <button className={app.roomState.whoCanPerform === "anyone" ? "active" : ""} onClick={() => this.onClickWhoCanPerform("anyone")}>Anyone</button>
            <button className={app.roomState.whoCanPerform === "performers" ? "active" : ""} onClick={() => this.onClickWhoCanPerform("performers")}>Only performers</button>
          </dd>
        </div>
      </div>
    );
  }
}











/////////////////////////////////////////////////////////////////////////////////////////////////////////
class GraffitiModerationDialog extends React.Component {

  constructor(props) {
    super(props);
    this.state = {
      deleteConfirmation: false,
      setExpirationConfirmation: null,
      pinConfirmation: false,
      shiftAmt: 5,
    };
    
    this.sizeValueSpec = new IntRangeValueSpec(10, 400, 100);
  }

  clickDelete = (e) => {
    console.log(`click delete`);
    this.props.app.net.SendGraffitiOps([{
      op: "remove",
      id: window.DFModerationControlContext.graffitiID,
    }]);
    this.setState({deleteConfirmation: null});
  }

  clickAdjustExpiration = () => {
    console.log(`clickAdjustExpiration ${this.state.setExpirationConfirmation}`);
    const graffitiID = window.DFModerationControlContext.graffitiID;
    let g = this.props.app.roomState.graffiti.find(g => g.id === graffitiID);
    if (!g) {
      return null;
    }
    const newExpiration = g.expires + this.state.setExpirationConfirmation;
    this.props.app.net.SendGraffitiOps([{
      op: "setExpiration",
      id: graffitiID,
      expiration: newExpiration,
    }]);

    this.setState({setExpirationConfirmation: null});
  }

  clickPin = () => {
    //console.log(`clickPin`);
    const graffitiID = window.DFModerationControlContext.graffitiID;
    let g = this.props.app.roomState.graffiti.find(g => g.id === graffitiID);
    if (!g) {
      return null;
    }

    this.props.app.net.SendGraffitiOps([{
      op: "pin",
      id: graffitiID,
      pin: !g.pinned,
    }]);

    this.setState({pinConfirmation: null});
  }

  onChangeSize = (v) => {
    if (isNaN(parseFloat(v))) v = 100;
    const graffitiID = window.DFModerationControlContext.graffitiID;
    let g = this.props.app.roomState.graffiti.find(g => g.id === graffitiID);
    if (!g) {
      return null;
    }

    this.props.app.net.SendGraffitiOps([{
      op: "setSize",
      id: graffitiID,
      size: v,
    }]);

    this.setState({});
  }

  setPos(dx, dy) {
    const graffitiID = window.DFModerationControlContext.graffitiID;
    let g = this.props.app.roomState.graffiti.find(g => g.id === graffitiID);
    if (!g) {
      return null;
    }
    this.props.app.net.SendGraffitiOps([{
      op: "setPosition",
      id: graffitiID,
      x: g.position.x + dx * this.state.shiftAmt,
      y: g.position.y + dy * this.state.shiftAmt,
    }]);
    this.setState({});
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

  render() {
    const graffitiID = window.DFModerationControlContext.graffitiID;
    let g = this.props.app.roomState.graffiti.find(g => g.id === graffitiID);
    if (!g) {
      return null;
    }

    const u = this.props.app.roomState.getUserForGraffiti(g); // may be null!

    return (
      <div className='moderationPanel graffiti'>
        <div className='topControls'>
          <span>Graffiti</span>
          <button className='close' onClick={() => { window.DFModerationControlContext.op = null; window.DFStateChangeHandler.OnStateChange();}}><i className="material-icons">close</i></button>
        </div>
        <div className='body'>
          <dl>

            <dt>Graffiti</dt>
            <dd className='graffiti'>
              <span className='field colorSwatch' style={{backgroundColor:g.color}}></span>
              <span className='field colorText'>{g.color}</span>
              <span className='field id'>gid #{g.id}</span>
              <span className='field userid'>uid #{g.userID}</span>
              <span className='field userid'>puid #{g.persistentID}</span>
            </dd>
            <dt>Content</dt>
            <dd className='content'>{g.content}</dd>

            <dt>Size/Position</dt>
            <dd className='size'>
              <div className='field'>{isNaN(parseFloat(g.size)) ? "(undefined)" : g.size.toFixed(2)}</div>
              <div className='controls'>
                <SeqLegendKnob
                  caption="Size"
                  className="knob"
                  initialValue={isNaN(parseFloat(g.size)) ? 100 : g.size}
                  valueSpec={this.sizeValueSpec}
                  onChange={this.onChangeSize}
                />
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
              </div>
            </dd>

            <dt>User</dt>
            {!!u ? (
            <dd className='name'>
              <span className='field txt'>{u.name}</span>
              <span className='field id'>uid #{u.userID}</span>
              {u.persistentID ?
                (<span className='field persistentid'>upid #{u.persistentID}</span>)
                : (<span className='field persistentid'>non-persistent</span>)
              }
            </dd>
            ) : (<dd>(doesn't exist)</dd>)}


            <dt>Pinning</dt>
            <dd className='pinning'>
              {g.pinned ? <div className='field pinned'>pinned</div> : <div className='field notpinned'>not pinned</div>}
              {g.pinned ? <button className="unpin" onClick={() => this.setState({pinConfirmation:true})}>- Unpin</button> : <button className="pin" onClick={() => this.setState({pinConfirmation:true})}>+ Pin</button>}

              { this.state.pinConfirmation && (
                <div className='warningConfirm pinning'>
                  <div className='desc'>
                    Click OK to <span className='dynamic'>{g.pinned ? "unpin" : "pin"}</span> this graffiti.
                  </div>
                  <div className='buttons'>
                    <button onClick={() => this.clickPin()}>OK</button>
                    <button onClick={() => this.setState({pinConfirmation: null})}>Cancel</button>
                  </div>
                </div>)}
            </dd>


            <dt>Expiration</dt>
            <dd className='expiration'>
              <div className='info'>
                <div className='field absolute'>{new Date(g.expires).toISOString()}</div>
                <div className='field remaining'>{ new TimeSpan(new Date(g.expires) - new Date()).longString }</div>
              </div>
              <div className='buttons'>
                <button className="expiration extend" onClick={() => this.setState({setExpirationConfirmation: hoursToMS(1)})}>+ Extend 1 hour</button>
                <button className="expiration extend" onClick={() => this.setState({setExpirationConfirmation: hoursToMS(8)})}>+ Extend 8 hours</button>
                <button className="expiration extend" onClick={() => this.setState({setExpirationConfirmation: hoursToMS(24)})}>+ Extend 1 day</button>
                <button className="expiration extend" onClick={() => this.setState({setExpirationConfirmation: daysToMS(7)})}>+ Extend 7 days</button>
                <button className="expiration extend" onClick={() => this.setState({setExpirationConfirmation: daysToMS(30)})}>+ Extend 30 days</button>
                <button className="expiration extend" onClick={() => this.setState({setExpirationConfirmation: daysToMS(365)})}>+ Extend 1 year</button>
              </div>
              <div className='buttons'>
                <button className="expiration subtract" onClick={() => this.setState({setExpirationConfirmation: hoursToMS(-1)})}>- Subtract 1 hour</button>
                <button className="expiration subtract" onClick={() => this.setState({setExpirationConfirmation: hoursToMS(-8)})}>- Subtract 8 hours</button>
                <button className="expiration subtract" onClick={() => this.setState({setExpirationConfirmation: hoursToMS(-24)})}>- Subtract 1 day</button>
                <button className="expiration subtract" onClick={() => this.setState({setExpirationConfirmation: daysToMS(-7)})}>- Subtract 7 days</button>
                <button className="expiration subtract" onClick={() => this.setState({setExpirationConfirmation: daysToMS(-30)})}>- Subtract 30 days</button>
                <button className="expiration subtract" onClick={() => this.setState({setExpirationConfirmation: daysToMS(-365)})}>- Subtract 1 year</button>

                { this.state.setExpirationConfirmation && (
                <div className='warningConfirm'>
                  <div className='desc'>
                    Click OK to adjust expiration by <span className='dynamic'>{new TimeSpan(this.state.setExpirationConfirmation).longString }</span>.
                    <br />
                    New expiration @ <span className='dynamic'>{new Date(g.expires + this.state.setExpirationConfirmation).toISOString()}</span>
                    <br />
                    Which is in <span className='dynamic'>{new TimeSpan(new Date(g.expires + this.state.setExpirationConfirmation) - new Date()).longString}</span>
                  </div>
                  <div className='buttons'>
                    <button onClick={() => this.clickAdjustExpiration()}>OK</button>
                    <button onClick={() => this.setState({setExpirationConfirmation: null})}>Cancel</button>
                  </div>
                </div>)}

              </div>
              <div className='buttons'>
                <button className="delete" onClick={() => this.setState({deleteConfirmation: true})}>&#128465; Delete</button>

                { this.state.deleteConfirmation && (
                <div className='warningConfirm'>
                  <div className='desc'>
                    Are you sure you want to delete this graffiti?
                  </div>
                  <div className='buttons'>
                    <button onClick={() => this.clickDelete()}>OK</button>
                    <button onClick={() => this.setState({deleteConfirmation: null})}>Cancel</button>
                  </div>
                </div>)}


              </div>
            </dd>

          </dl>
        
        </div>
      </div>
    );
  }
}






/////////////////////////////////////////////////////////////////////////////////////////////////////////
class UserModerationDialog extends React.Component {

  constructor(props) {
    super(props);
    this.state = {
      addVisible: false,
      deleteRoleConfirmation: null,
      addRoleConfirmation: null,
    };
  }

  deleteGlobalRole() {
    const role = this.state.deleteRoleConfirmation;
    const userID = window.DFModerationControlContext.userID;
    this.props.app.net.SendUserRoleOp({
      op: "removeGlobalRole",
      userID,
      role,
    });
    //console.log(`deleteGlobalRole ${role} to user id ${userID}`);
    this.setState({deleteRoleConfirmation:null});
  }

  addGlobalRole() {
    const role = this.state.addRoleConfirmation;
    const userID = window.DFModerationControlContext.userID;
    this.props.app.net.SendUserRoleOp({
      op: "addGlobalRole",
      userID,
      role,
    });
    //console.log(`add global role ${role} to user id ${userID}`);
    this.setState({
      addVisible:false,
      addRoleConfirmation:null,
    });
  }

  toggleAddGlobalRowMenu() {
    this.setState({
      addVisible: !this.state.addVisible,
    })
  }

  render() {
    const userID = window.DFModerationControlContext.userID;
    let foundUser = this.props.app.roomState.FindUserByID(userID);
    if (!foundUser) return null;
    const u = foundUser.user;

    return (
      <div className='moderationPanel'>
        <div className='topControls'>
          <span>User Moderation / Administration</span>
          <button className='close' onClick={() => { window.DFModerationControlContext.op = null; window.DFStateChangeHandler.OnStateChange();}}><i className="material-icons">close</i></button>
        </div>
        <div className='body'>
          <dl>
            <dt></dt>
            <dd className='name'>
              <span className='field txt'>{u.name}</span>
              <span className='field colorSwatch' style={{backgroundColor:u.color}}></span>
              <span className='field colorText'>{u.color}</span>
              <span className='field id'>#{u.userID}</span>
            </dd>
            <dt>Presence</dt><dd className='presence'><span className='field'>{UserPresenceToString(u.presence)}</span></dd>
            <dt>Source</dt><dd className='source'><span className='field'>{UserSourceToString(u.source)}</span></dd>
            <dt>persistentIdentity</dt><dd className='field persistentIdentity'><span className='field'>{u.hasPersistentIdentity ? "" : "none"}{u.persistentID}</span></dd>
            <dt>Global roles</dt><dd className='field roles'>
              {
                u.persistentInfo && u.persistentInfo.global_roles.map((r, i) => {
                  const can = this.props.app.myUser.HasRequiredRoleToManageRole(r);
                  return (
                  <span className={"field button " + (can ? "enabled" : "disabled")} key={i}  onClick={can && (() => this.setState({deleteRoleConfirmation: r}))}>
                    {can && <i className="material-icons">delete</i>}
                    {r}
                    </span>
                  );
                })
              }
              { this.state.deleteRoleConfirmation && (
                <div className='warningConfirm'>
                  <div className='desc'>
                    Are you sure you want to delete role <span className='dynamic'>{this.state.deleteRoleConfirmation}</span> from user <span className='dynamic'>{u.name}</span>
                  </div>
                  <div className='buttons'>
                    <button onClick={() => this.deleteGlobalRole()}>OK</button>
                    <button onClick={() => this.setState({deleteRoleConfirmation: null})}>Cancel</button>
                  </div>
                </div>)}


              <span className='button' onClick={() => this.toggleAddGlobalRowMenu()}>
                <i className="material-icons">add</i>
              </span>
                {
                  this.state.addVisible && <ul className='comboBox'>
                    {Object.values(eUserGlobalRole)
                      .filter(roleObj => !(u.persistentInfo?.global_roles.some(gr => gr === roleObj.name))) // where not already exists
                      .map((roleObj, i) => {
                        const can = this.props.app.myUser.HasRequiredRoleToManageRole(roleObj.name);
                        return (<li
                          key={i}
                          className={can ? "enabled" : "disabled"}
                          onClick={can && (() => this.setState({addRoleConfirmation: roleObj.name}))}
                          >+ {roleObj.name}
                        </li>);
                      })}
                  </ul>
                }


              { this.state.addRoleConfirmation && (
                <div className='warningConfirm'>
                  <div className='desc'>
                    Are you sure you want to add role <span className='dynamic'>{this.state.addRoleConfirmation}</span> to user <span className='dynamic'>{u.name}</span>
                  </div>
                  <div className='buttons'>
                    <button onClick={() => this.addGlobalRole()}>OK</button>
                    <button onClick={() => this.setState({addRoleConfirmation: null})}>Cancel</button>
                  </div>
                </div>)}

            </dd>
          </dl>
        
        </div>
      </div>
    );
  }
}


/////////////////////////////////////////////////////////////////////////////////////////////////////////
class ModerationControlPanel extends React.Component {
  componentDidMount() {
    window.DFEvents.on("moderateUser", this.onModerateUser);
  }
  componentWillUnmount() {
    window.DFEvents.removeListener("moderateUser", this.onModerateUser);
  }

  onModerateUser = (userID) => {
    //console.log(userID);
    window.DFModerationControlContext.op = "user";
    window.DFModerationControlContext.userID = userID;
    window.DFStateChangeHandler.OnStateChange();
  }

  render() {
    if (!this.props.app) return null;

    if (window.DFModerationControlContext.op === "user") {
      return <UserModerationDialog app={this.props.app} />
    }

    if (window.DFModerationControlContext.op === "graffiti") {
      return <GraffitiModerationDialog app={this.props.app} />
    }

    if (window.DFModerationControlContext.op === "room") {
      return <RoomModerationDialog app={this.props.app} />
    }

    return null;
  }
}

module.exports = {
  ModerationControlPanel,
}


