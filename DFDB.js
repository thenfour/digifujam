const fs = require('fs');
const DF = require('./clientsrc/DFCommon');
const fsp = fs.promises;

class DFDB {
  constructor(gConfig, onSuccess, onError) {

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

    setTimeout(this.OnFlushTimer, DF.ServerSettings.DBFlushMS);

    onSuccess(this);
  }

  OnFlushTimer = () => {
    try {
      setTimeout(this.OnFlushTimer, DF.ServerSettings.DBFlushMS);
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
  }
}

module.exports = {
  DFDB,
};
