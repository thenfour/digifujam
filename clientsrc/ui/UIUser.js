const React = require('react');
const DF = require("../DFCommon");


class UIUserName extends React.Component {
    constructor(props) {
        super(props);
    }

    getRoleDisplayText(role) {
        switch (role) {
            case "sysadmin":
                return "@";
        }
        return role;
    }

    render() {
        return (
            <span className="userName" style={{ color: this.props.user.color }}>
                {this.props.user.name}
                {this.props.user.hasPersistentIdentity && <span className="role hasPersistentIdentity">✓</span>}
                {/* {this.props.user.IsAdmin() && <span className="role sysadmin">@</span>} */}
                {this.props.user.persistentInfo && this.props.user.persistentInfo.global_roles && this.props.user.persistentInfo.global_roles.map(r => (
                    <span className="role" key={r}>{this.getRoleDisplayText(r)}</span>
                ))}
            </span>

        );
    }
};




class AdminUserMgmt extends React.Component {
    constructor(props) {
        super(props);
    }

    render() {
        return (
            <span>
                ⚙
            </span>

        );
    }

    // add global role, remove global role
};


module.exports = {
    UIUserName,
    AdminUserMgmt,
}



