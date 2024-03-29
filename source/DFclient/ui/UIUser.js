const React = require('react');
const DF = require("../../DFcommon/DFCommon");
const { eUserGlobalRole } = require('../../DFcommon/DFUser');


class UIUserName extends React.Component {
    constructor(props) {
        super(props);
    }

    getRoleDisplayText(role) {
        switch (role) {
            case eUserGlobalRole.sysadmin.name:
                return "@";
            case eUserGlobalRole.moderator.name:
                return "^";
            case eUserGlobalRole.performer.name:
                return "+";
            // don't indicate shadow ban
        }
        return null;
    }

    render() {

        const u = this.props.user;
        let noteOnBadge = this.props.user.persistentInfo && this.props.user.persistentInfo.stats && this.props.user.persistentInfo.stats.noteOns > 1000 && (
            <span className="badge noteOns">♫ {Math.floor(this.props.user.persistentInfo.stats.noteOns / 1000)}K</span>
            //<span className="role noteOns">♫ {this.props.user.persistentInfo.stats.noteOns}</span>
        );

        const className = (this.props.user.presence === DF.eUserPresence.Online) ? "userName online" : "userName offline";

        let moderationCtrl = null;
        
        //  && (u.userID != this.props.app.myUser.userID)
        if (window.DFModerationControlsVisible && (u.source === DF.eUserSource.SevenJam) && this.props.app.myUser.IsModerator()) {
            moderationCtrl = (<span className='userModerationGear' onClick={() => window.DFEvents.emit("moderateUser", u.userID)}><i className="material-icons">settings</i></span>);
        }

        return (
            <span className={className} style={{ color: this.props.user.color }}>
                {moderationCtrl}
                <span className='uname'>{this.props.user.name}</span>
                {this.props.user.hasPersistentIdentity && <span className="badge hasPersistentIdentity">✓</span>}
                {this.props.user.persistentInfo && (this.props.user.persistentInfo.global_roles?.length > 0) &&
                    <span className="badge">
                        {this.props.user.persistentInfo.global_roles.map(r => {
                            const displayTxt = this.getRoleDisplayText(r);
                            return displayTxt && (<span className={"role " + r} key={r}>{displayTxt}</span>);
                        })
                        }
                    </span>
                }
                {noteOnBadge}
            </span>

        );
    }
};

module.exports = {
    UIUserName,
}



