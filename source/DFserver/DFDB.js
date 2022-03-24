const fs = require('fs');
const DF = require('../DFcommon/DFCommon');
const fsp = fs.promises;

class DFDB {
  constructor(gConfig) {

    this.path = gConfig.private_storage_path + "/" +
                "db.json";

    try {
      this.data = JSON.parse(fs.readFileSync(this.path));
    } catch (e) {
      console.log(`!!! * * * * DB could not be read from:`);
      console.log(`    ${this.path}`);
      console.log(`Using an empty db.`);
      this.data = {
        users : {
            // key = id, value = "user doc"
        }
      };
    }

    this.timer = null;
    this.StartFlushTimer(false);

    // onSuccess(this);
  }

  StartFlushTimer(immediate) {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(this.OnFlushTimer, immediate ? 1000 : DF.ServerSettings.DBFlushMS);
  }

  OnFlushTimer = () => {
    try {
      this.timer = setTimeout(this.OnFlushTimer, DF.ServerSettings.DBFlushMS);
      fsp.writeFile(
          this.path, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.log(`DFDB.OnFlushTimer exception occurred`);
      console.log(e);
    }
  }

  // returns the db model object
  GetOrCreateGoogleUser(google_id) {
    if (!this.data.users[google_id]) {
      this.data.users[google_id] = {
        _id : google_id,
        stats : {
          noteOns : 0,
        },
        global_roles : [],
      };
    }
    this.StartFlushTimer(true);
    return this.data.users[google_id];
  } // GetOrCreateGoogleUser

  // userStats is an object with userIDs as keys. integrate into our data obj.
  // values are DELTAS (ya probably not the best choice)
  UpdateUserStats(userStats) {
    Object.keys(userStats).forEach(userID => {
      const props = userStats[userID];
      const userDoc = this.GetOrCreateGoogleUser(userID);
      //Object.assign(userDoc.stats, props);
      Object.keys(props).forEach(k => {
          userDoc.stats[k] += props[k];
      })
    });
    this.StartFlushTimer(true);
  }

  UpdateUserPersistentInfo(dfuser) {
    //console.log(`UpdateUserPersistentInfo(${dfuser.userID}, ${dfuser.persistentID})`);
    if (!dfuser.persistentID) return; // not a persistent user; nothing in the db needs to be updated.
    const persistentUser = this.data.users[dfuser.persistentID];
    persistentUser.global_roles = [...dfuser.persistentInfo.global_roles];
    this.StartFlushTimer(true);
  }
}

module.exports = {
  DFDB,
};
