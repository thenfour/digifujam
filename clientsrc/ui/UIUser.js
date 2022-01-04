const React = require('react');
const DF = require("../DFCommon");


class UIUserName extends React.Component {
    constructor(props) {
        super(props);
    }

    getRoleDisplayText(role) {
        switch (role) {
            case "sysadmin":
                return null; // no point showing this.
        }
        return role;
    }

    render() {

        let noteOnBadge = this.props.user.persistentInfo && this.props.user.persistentInfo.stats && this.props.user.persistentInfo.stats.noteOns > 1000 && (
            <span className="role noteOns">♫ {Math.floor(this.props.user.persistentInfo.stats.noteOns / 1000)}K</span>
            //<span className="role noteOns">♫ {this.props.user.persistentInfo.stats.noteOns}</span>
        );

        const className = (this.props.user.presence === DF.eUserPresence.Online) ? "userName online" : "userName offline";

        return (
            <span className={className} style={{ color: this.props.user.color }}>
                {this.props.user.name}
                {this.props.user.hasPersistentIdentity && <span className="role hasPersistentIdentity">✓</span>}
                {this.props.user.persistentInfo && this.props.user.persistentInfo.global_roles && this.props.user.persistentInfo.global_roles.map(r => {
                    const displayTxt = this.getRoleDisplayText(r);
                    return displayTxt && (<span className="role" key={r}>{displayTxt}</span>);
                })
                }
                {noteOnBadge}
            </span>

        );
    }
};

module.exports = {
    UIUserName,
}



