

const eUserSource = {
  SevenJam : 1,
  Discord : 2,
};

const eUserPresence = {
  Online : 1,  // server expects websocket
  Offline : 2, // server does not expect websocket
};

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
  #pingDetailed;
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

    this.quantizeSpec ??= {
      beatDivision : 0,
      swallowBoundary : 1.00,
      quantizeBoundary : 0.2,
      quantizeAmt : 0.98,
    };

    this.#pingSmall = null;    // cached ping data
    this.#pingDetailed = null; // cached ping data
    this.#pingDirty = true;
  }

  IsAdmin() {
    return this.hasGlobalRole("sysadmin");
  }

  addGlobalRole(role) {
    this.#pingDirty = true;
    if (!this.persistentInfo) {
      this.persistentInfo = EmptyPersistentInfo();
    }
    if (!this.persistentInfo.global_roles) {
      this.persistentInfo.global_roles = [ role ];
      return;
    }
    if (this.persistentInfo.global_roles.some(r => r === role)) {
      return; // already exists
    }
    this.persistentInfo.global_roles.push(role);
  }

  hasGlobalRole(role) {
    if (!this.persistentInfo)
      return false;
    if (!this.persistentInfo.global_roles)
      return false;
    return this.persistentInfo.global_roles.some(x => x == role);
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

  // called by server; includes a bare minimum info to pass to clients from other rooms.
  ExportPing(detailed) {
    if (this.#pingDirty) {
      //console.log(`exporting ping`);
      this.#pingSmall = {
        id : this.userID,
        n : this.name,
        c : this.color,
        s : this.source,
        p : this.presence,
      };
      
      this.#pingDetailed = {};
      if (this.persistentInfo?.global_roles?.length) {
        this.#pingDetailed.gr = this.persistentInfo.global_roles;
      }
      if (this.persistentInfo?.stats?.noteOns) {
        this.#pingDetailed.no = this.persistentInfo.stats.noteOns;
      }

      this.#pingDetailed = Object.assign(this.#pingDetailed, this.#pingSmall);
      this.#pingDirty = false;
    }

    this.#pingDetailed.ping = this.#pingSmall.ping = this.pingMS;

    return detailed ? this.#pingDetailed : this.#pingSmall;
  }

  // called by clients to integrate this data to your room. name/color/etc should not actually be necessary because
  // they come from other more timely server messages.
  // call this AFTER FromPing().
  IntegrateFromPing(u) {
    //this.#pingDirty = true; // not really relevant to clients but for completeness...
    console.assert(u.userID === this.userID);
    if (u.pingMS)
      this.pingMS = u.pingMS;
    // if (u.n) this.name = u.n;
    // if (u.c) this.color = u.c;
    // if (u.source)
    //   this.source = u.source;
    // if (u.presence)
    //   this.presence = u.presence;
    if (u.global_roles) {
      u.global_roles.forEach(r => {this.addGlobalRole(r)});
    }
    if (u.noteOns) {
      this.SetNoteOns(u.noteOns);
    }
  }

  // called by clients for users of OTHER rooms. so don't actually return a DigifuUser object, return a js object map with
  // sensible field naming that resembles DigifuUser.
  static FromPing(data) {
    if (data.ping)
      data.pingMS = data.ping;
    data.userID = data.id;
    data.name = data.n;
    data.color = data.c;
    data.source = data.s;
    data.presence = data.p;
    if (data.no)
      data.noteOns = data.no;
    if (data.gr)
      data.global_roles = data.gr;
    delete data.id;
    delete data.ping;
    delete data.n;
    delete data.c;
    delete data.s;
    delete data.p;
    delete data.no;
    delete data.gr;
    return data;
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
  EmptyPersistentInfo,
  EmptyStats,
  UserDBRecordToPersistentInfo,
}
