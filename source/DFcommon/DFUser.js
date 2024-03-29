
function LatchMode(id, shortName, longName, description) {
  return {
    id, shortName, longName, description
  };
}

const gSeqLatchMode = {
  "LMAuto": LatchMode("LMAuto", "Auto", "Auto (sticky keys)", "Automatically detect which notes to latch, no sustain pedal required. Double-tap a note to stop the sequencer."),
  "LMPedal": LatchMode("LMPedal", "Pedal", "Sustain pedal latch", "Hold the sustain pedal to latch notes. Release sustain pedal to stop playing. This disables sustain pedal in the instrument (so sustain pedal only controls latching)."),
  "LMSilent": LatchMode("LMSilent", "Off", "Off", "No note latching; when not playing notes don't play anything"),
  //LatchMode("LMSequencer", "Seq", "Play sequencer", "When not holding notes, play the sequence as it's written in the pattern editor"),
  //LatchMode("LMPedalSeq", "PedSq", "Sustain pedal latch + Sequencer", "Hold the sustain pedal to latch notes. Release sustain pedal to play sequence as written."),
  //LatchMode("LMAutoSeq", "AutSq", "Auto + Sequencer", "Automatically detect which notes to latch, no sustain pedal required. Double-tap a note to stop latching and play the sequence as written."),
};

const gDefaultLatchModeID = "LMAuto";

// function GetLatchModeByID(modeID) {
//   const ret = SeqLatchMode.find(m => m.id === modeID);
//   if (!ret) return gDefaultLatchMode;
//   return ret;
// }


const eUserSource = {
  SevenJam : 1,
  Discord : 2,
};

function UserSourceToString(p) {
  if (p === eUserSource.SevenJam) { return "SevenJam"; }
  if (p === eUserSource.Discord) { return "Discord"; }
  return "unknown";
}

const eUserPresence = {
  Online : 1,  // server expects websocket
  Offline : 2, // server does not expect websocket
};

function UserPresenceToString(p) {
  if (p === eUserPresence.Online) { return "online"; }
  if (p === eUserPresence.Offline) { return "offline"; }
  return "unknown";
}

const eUserGlobalRole = {
  sysadmin: {
    name:"sysadmin",
    requiredRoleToManage: "sysadmin",
  },
  moderator: {
    name: "moderator",
    requiredRoleToManage: "sysadmin",
  },
  performer: {
    name: "performer",
    requiredRoleToManage: "moderator",
  },
  shadow_ban: {// shadow_ban users' chat messages, avatar, played notes, are not 
    name: "shadow_ban",
    requiredRoleToManage: "moderator",
  },
}

function IsValidUserGlobalRoleName(roleName) {
  return Object.values(eUserGlobalRole).some(r => r.name === roleName);
}

// convert a db model DFUser to a struct usable in DigifuUser.persistentInfo
// see models/DFUser.js for the src format
const UserDBRecordToPersistentInfo = (doc) => {
  return {
    global_roles : doc.global_roles ?? [],
    stats : doc.stats ?? {},
  };
};

function EmptyStats() {
  return {
    noteOns : 0,
  };
}

function EmptyPersistentInfo() {
  return {
    global_roles : [],
    stats : EmptyStats(),
  };
};

class DigifuUser {

  #pingSmall;
  #pingDirty;

  constructor(params) {
    Object.assign(this, params ?? {});
    this.userID ??= null;
    this.pingMS ??= 0;
    this.lastActivity ??= null;           // this allows us to display as idle or release instrument
    this.persistentInfo ??= null;         // if you sign in with google (et al) this gets set to the (public) database info
    this.hasPersistentIdentity ??= false; // true if you have an identity living longer than your session. not sure how useful this is.
    this.persistentID ??= null;           // persistent identity ID (database id). Not the same as your user ID because you can "promote" your guest access to google access by signing into google (..discord, et al)
    this.danceID ??= 0;

    this.source ??= eUserSource.SevenJam;
    this.presence ??= eUserPresence.Online;

    this.name ??= "";
    this.color ??= "";
    this.position ??= {x : 0, y : 0}; // this is your TARGET position in the room/world. your position on screen will just be a client-side interpolation
    //this.idle = null; // this gets set when a user's instrument ownership becomes idle
    this.lastCheerSentDate ??= new Date();

    this.latchModeID ??= gDefaultLatchModeID;

    this.quantizeSpec ??= {
      beatDivision : 0,
      swallowBoundary : 1.00,
      quantizeBoundary : 0.2,
      quantizeAmt : 0.98,
    };

    this.#pingSmall = null;    // cached ping data
    this.#pingDirty = true;
  }

  toString() {
    return `[uname:${this.name} uid:${this.userID} upid:${this.persistentID}]`;
  }

  GetLatchModeObj() {
    const lm = gSeqLatchMode[this.latchModeID];
    if (lm) return lm;
    return gSeqLatchMode[gDefaultLatchModeID];
  }
  SetLatchModeID(lmid) {
    this.latchModeID = lmid;
  }

  IsAdmin() {
    return this.hasGlobalRole(eUserGlobalRole.sysadmin.name);
  }

  IsBanned() {
    return this.hasGlobalRole(eUserGlobalRole.shadow_ban.name);
  }

  IsModerator() {
    if (!this.persistentInfo)
      return false;
    if (!this.persistentInfo.global_roles)
      return false;
    return this.persistentInfo.global_roles.some(x => x === eUserGlobalRole.moderator.name || x === eUserGlobalRole.sysadmin.name);
  }

  IsPerformer() {
    return this.hasGlobalRole(eUserGlobalRole.performer.name);
  }

  // called when integrating ping data on clients
  clearGlobalRoles() {
    this.#pingDirty = true;
    if (!this.persistentInfo) {
      this.persistentInfo = EmptyPersistentInfo();
    }
    if (!this.persistentInfo.global_roles) {
      this.persistentInfo.global_roles = [ ];
    }
  }

  removeGlobalRole(roleName) {
    if (!this.persistentInfo) return;
    if (!this.persistentInfo.global_roles) return;
    const i = this.persistentInfo.global_roles.findIndex(r => r === roleName);
    if (i === -1) return;
    this.#pingDirty = true;
    this.persistentInfo.global_roles.splice(i, 1);
  }

  // this is called when user has explicitly set the admin key.
  addGlobalRole(roleName) {
    this.#pingDirty = true;
    if (!this.persistentInfo) {
      this.persistentInfo = EmptyPersistentInfo();
    }

    if (!IsValidUserGlobalRoleName(roleName)) {
      console.log(`unknown user global role ${roleName}`);
      return;
    }

    if (!this.persistentInfo.global_roles) {
      this.persistentInfo.global_roles = [ roleName ];
      return;
    }
    if (this.persistentInfo.global_roles.some(r => r === roleName)) {
      return; // already exists
    }
    this.persistentInfo.global_roles.push(roleName);
  }

  hasGlobalRole(roleName) {
    if (!this.persistentInfo)
      return false;
    if (!this.persistentInfo.global_roles)
      return false;
    return this.persistentInfo.global_roles.some(x => x === roleName);
  }

  HasRequiredRoleToManageRole(roleName) {
    if (this.IsAdmin()) return true; // override any silliness
    const roleObj = eUserGlobalRole[roleName];
    if (!roleObj) return false; // unknown role? just let admins clean that up i guess and everyone else no.
    return this.hasGlobalRole(roleObj.requiredRoleToManage);
  }

  SetColor(c) {
    this.#pingDirty = true;
    this.color = c;
  }

  SetName(n) {
    this.#pingDirty = true;
    this.name = n;
  }

  SetPresence(p) {
    this.#pingDirty = true;
    this.presence = p;
  }

  ExportForUserStatsPing() {
    return [this.pingMS ?? 0, (this.persistentInfo?.stats?.noteOns) ?? 0];
  }

  ImportUserStatsPing(fields) {
    if (fields[0]) {
      this.pingMS = fields[0];
    }
    if (fields[1]) {
      this.SetNoteOns(fields[1]);
    }
  }

  // called by server; includes a bare minimum info to pass to clients from other rooms.
  ExportForWorldState(/*detailed*/) {
    if (this.#pingDirty) {
      this.#pingSmall = [
        this.userID,
        this.name,
        this.color,
        this.source,
        this.presence,
        this.IsBanned()?1:0,
      ];

      this.#pingDirty = false;
    }

    this.#pingSmall.ping = this.pingMS;
    return this.#pingSmall;
  }

  // called by clients for users of OTHER rooms. so don't actually return a DigifuUser object, return a js object map with
  // sensible field naming that resembles DigifuUser.
  static FromWorldState(data) {
    return {
      userID: data[0],
      name: data[1],
      color: data[2],
      source: data[3],
      presence: data[4],
      isBanned: !!data[5],
    }

  }

  PersistentSignIn(hasPersistentIdentity, persistentID, persistentInfo) {
    this.#pingDirty = true;
    this.hasPersistentIdentity = hasPersistentIdentity;
    this.persistentID = persistentID?.toString();
    this.persistentInfo = persistentInfo;
  }

  PersistentSignOut() {
    this.#pingDirty = true;
    this.hasPersistentIdentity = false;
    this.persistentID = null;
    // prevent signout/signin from artificially inflating stats. when you connect to persistent state, we reset the stats. and vice-vesa.
    this.persistentInfo = EmptyPersistentInfo();
  }

  IncNoteOns() {
    if (this.persistentInfo?.stats?.noteOns) {
      return this.SetNoteOns(this.persistentInfo.stats.noteOns + 1);
    }
    return this.SetNoteOns(1);
  }

  SetNoteOns(n) {
    this.#pingDirty = true;
    if (!this.persistentInfo) {
      this.persistentInfo = EmptyPersistentInfo();
    }
    if (!this.persistentInfo.stats) {
      this.persistentInfo.stats = EmptyStats();
    }
    this.persistentInfo.stats.noteOns = n;
  }

}; // DigifuUser

module.exports = {
  DigifuUser,
  eUserSource,
  eUserPresence,
  eUserGlobalRole,
  EmptyPersistentInfo,
  EmptyStats,
  UserDBRecordToPersistentInfo,
  UserPresenceToString,
  UserSourceToString,
  gDefaultLatchModeID,
  gSeqLatchMode,
}
