const DF = require('./clientsrc/DFCommon');
const fsp = require('fs').promises;
const fs = require('fs');
const DFDB = require('./DFDB');

// https://github.com/typicode/lowdb
class DFStats {

    static getHourID(roomID) {
        // YYYYMMDD_HH__roomid
        let d = new Date();
        return `${d.getUTCFullYear()}${(d.getUTCMonth() + 1).toString().padStart(2, '0')}${d.getUTCDate().toString().padStart(2, '0')}_${d.getUTCHours().toString().padStart(2, '0')}__${roomID}`;
    }

    // see stats.html for a more complete version
    static parseHourID = id => {
        // 20210106_15__pub
        // "2021-01-06T14:01:01.000Z"
        //  YYYY-MM-DDTHH:mm:ss.sssZ
        let u1 = id.indexOf("_");
        let u2 = id.indexOf("__");
        let roomID = id.substring(u2 + 2);
        let hourOfDay = parseInt(id.substring(u1 + 1, u2));
        let yyyy = (id.substring(0, 4));
        let mm = (id.substring(4, 6));
        let dd = (id.substring(6, 8));
        return {
            hourID: id,
            hourOfDay,
            roomID,
            //dayID: `${yyyy}-${mm}-${dd}`,
            //dayDate: (new Date(`${yyyy}-${mm}-${dd}T01:01:01.000Z`)),
            date: (new Date(`${yyyy}-${mm}-${dd}T${hourOfDay.toString().padStart(2, '0')}:01:01.000Z`)),
        };
    };

    static emptyStatsObj() {
        return {
            joins: 0,
            notes: 0,
            cheers: 0,
            messages: 0,
            paramChanges: 0,
            maxUsers: 0,
            presetsSaved: 0,
        };
    }

    constructor(path, mongoDB) {
        console.log(`[dfstats ctor]`);
        this.path = path;
        this.mongoDB = mongoDB;
        
        console.log(`dfstats path = ${path}`);

        this.queuedByHourObj = {};

        //this.adapter = new FileSync(path);

        try {
            this.serverStats = JSON.parse(fs.readFileSync(path));
        } catch (e) {
            console.log(`Starting a new statistics obj.`);
            this.serverStats = { byHour: {} };
        }

        // to track user stats, map user => stats obj. stats obj is the same as in DigifuUser
        this.queuedUserStats = {};

        setTimeout(() => this.OnFlushTimer(), DF.ServerSettings.StatsFlushMS);
        setTimeout(() => this.OnStatsPruneInterval(), DF.ServerSettings.StatsPruneIntervalMS);
    }

    // removes old server statistics
    OnStatsPruneInterval() {
        try {
            const m1 = new Date();

            setTimeout(() => this.OnStatsPruneInterval(), DF.ServerSettings.StatsPruneIntervalMS);

            const keysToRemove = [];
            const now = new Date();
            const byHour = this.serverStats.byHour;
            Object.keys(byHour).forEach(k => {
                const x = DFStats.parseHourID(k);
                if ((now - x.date) > DF.ServerSettings.StatsMaxAgeMS) {
                    keysToRemove.push(k);
                }
            });

            keysToRemove.forEach(k => {
                delete byHour[k];
            });

            console.log(`OnStatsPruneInterval took ${((new Date() - m1) / 1000).toFixed(3)} sec`);
        } catch (e) {
            console.log(`OnStatsPruneInterval exception occurred`);
            console.log(e);
        }
    }

    // update stats file and database
    OnFlushTimer() {
        try {
            //const m1 = new Date();
            setTimeout(() => this.OnFlushTimer(), DF.ServerSettings.StatsFlushMS);
            //console.log(`Saving db to ${this.path}`);
            fsp.writeFile(this.path, JSON.stringify(this.serverStats, null, 2), 'utf8');
            //console.log(`Stats: OnFlushTimer took ${((new Date() - m1) / 1000).toFixed(3)} sec`);

            // TODO: write queued server stats to mongodb

            // write queued user stats to mongodb
            this.mongoDB.UpdateUserStats(this.queuedUserStats);
            this.queuedUserStats = {};

        } catch (e) {
            console.log(`OnFlushTimer exception occurred`);
            console.log(e);
        }
    }

    updateQueuedStats(roomID, user, updateRoomStatsCallback, updateUserStatsCallback) {
        let hourID = DFStats.getHourID(roomID);
        this.serverStats.byHour[hourID] = updateRoomStatsCallback(this.serverStats.byHour[hourID] || DFStats.emptyStatsObj());
        if (user.hasPersistentIdentity) {
            this.queuedUserStats[user.userID] = updateUserStatsCallback(this.queuedUserStats[user.userID] || DF.DigifuUser.emptyStatsObj());
        }
    }

    OnUserWelcome(roomID, user, roomUserCount) {
        this.updateQueuedStats(roomID, user, h => {
            h.joins++;
            h.maxUsers = Math.max(roomUserCount, h.maxUsers);
            return h;
        }, us => {
            us.joins ++;
            return us;
        });
    }

    OnNoteOn(roomID, user) {
        this.updateQueuedStats(roomID, user, h => {
            h.notes++;
            return h;
        }, us => {
            us.noteOns ++;
            return us;
        });
    }

    OnCheer(roomID, user) {
        this.updateQueuedStats(roomID, user, h => {
            h.cheers++;
            return h;
        }, us => {
            us.cheers ++;
            return us;
        });
    }

    OnMessage(roomID, user) {
        this.updateQueuedStats(roomID, user, h => {
            h.messages++;
            return h;
        }, us => {
            us.messages ++;
            return us;
        });
    }

    OnParamChange(roomID, user, paramCount) {
        this.updateQueuedStats(roomID, user, h => {
            h.paramChanges += paramCount;
            return h;
        }, us => {
            us.paramChanges ++;
            return us;
        });
    }

    OnPresetSave(roomID, user) {
        this.updateQueuedStats(roomID, user, h => {
            h.presetsSaved ++;
            return h;
        }, us => {
            us.presetsSaved ++;
            return us;
        });
    }
}

module.exports = {
    DFStats
}
