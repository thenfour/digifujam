const DF = require('./public/DFCommon');
const fsp = require('fs').promises;
const fs = require('fs');

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
        };
    }

    constructor(path) {
        this.path = path;
        console.log(`dfstats path = ${path}`);

        this.queuedByHourObj = {};

        //this.adapter = new FileSync(path);

        try {
            this.db = JSON.parse(fs.readFileSync(path));
        } catch (e) {
            console.log(`Starting a new statistics obj.`);
            this.db = { byHour: {} };
        }

        setTimeout(() => this.OnFlushTimer(), DF.ServerSettings.StatsFlushMS);
        setTimeout(() => this.OnStatsPruneInterval(), DF.ServerSettings.StatsPruneIntervalMS);
    }


    OnStatsPruneInterval() {
        try {
            const m1 = new Date();

            setTimeout(() => this.OnStatsPruneInterval(), DF.ServerSettings.StatsPruneIntervalMS);

            const keysToRemove = [];
            const now = new Date();
            const byHour = this.db.byHour;
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

    OnFlushTimer() {
        try {
            const m1 = new Date();
            setTimeout(() => this.OnFlushTimer(), DF.ServerSettings.StatsFlushMS);
            //console.log(`Saving db to ${this.path}`);
            fsp.writeFile(this.path, JSON.stringify(this.db, null, 2), 'utf8');
            //console.log(`Stats: OnFlushTimer took ${((new Date() - m1) / 1000).toFixed(3)} sec`);
        } catch (e) {
            console.log(`OnFlushTimer exception occurred`);
            console.log(e);
        }
    }

    updateQueuedStats(roomID, updateCallback) {
        let hourID = DFStats.getHourID(roomID);
        let existing = this.db.byHour[hourID] || DFStats.emptyStatsObj();
        this.db.byHour[hourID] = updateCallback(existing);
    }

    OnUserWelcome(roomID, roomUserCount) {
        this.updateQueuedStats(roomID, h => {
            h.joins++;
            h.maxUsers = Math.max(roomUserCount, h.maxUsers);
            return h;
        });
    }

    OnNoteOn(roomID) {
        this.updateQueuedStats(roomID, h => {
            h.notes++;
            return h;
        });
    }

    OnCheer(roomID) {
        this.updateQueuedStats(roomID, h => {
            h.cheers++;
            return h;
        });
    }

    OnMessage(roomID) {
        this.updateQueuedStats(roomID, h => {
            h.messages++;
            return h;
        });
    }

    OnParamChange(roomID, paramCount) {
        this.updateQueuedStats(roomID, h => {
            h.paramChanges += paramCount;
            return h;
        });
    }
}

module.exports = {
    DFStats
}
