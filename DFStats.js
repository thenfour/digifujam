const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')


// https://github.com/typicode/lowdb
class DFStats {

    static getHourID(roomID) {
        // YYYYMMDD_HH__roomid
        let d = new Date();
        return `${d.getUTCFullYear()}${d.getUTCMonth().toString().padStart(2, '0')}${d.getUTCDay().toString().padStart(2, '0')}_${d.getUTCHours().toString().padStart(2, '0')}__${roomID}`;
    }

    // updateCallback is like (hourlyStatsObj) => { return updated hourlystats obj }
    updateHourlyStats(roomID, updateCallback) {
        if (!this.db) return null;

        let hourID = DFStats.getHourID(roomID);
        let byHour = this.db.get("byHour");
        if (!byHour.has(hourID).value()) {
            byHour.set(hourID, updateCallback({
                connections: 0,
                noteOns: 0,
                cheers: 0,
                messages: 0,
                paramChanges: 0,
            })).write();
        } else {
            byHour.update(hourID, hourStats => updateCallback(hourStats)).write();
        }
    }

    constructor(path) {
        this.path = path;
        console.log(`dfstats path = ${path}`);

        this.adapter = new FileSync(path);
        this.db = low(this.adapter);
        this.db.defaults({ byHour: {} })
            .write();
    }

    OnUserConnect() {
        setTimeout(() => {
            this.updateHourlyStats("", h => {
                h.connections++;
                return h;
            });
        }, 0);
    }

    OnNoteOn(roomID) {
        setTimeout(() => {
            this.updateHourlyStats(roomID, h => {
                h.noteOns++;
                return h;
            });
        }, 0);
    }

    OnCheer(roomID) {
        setTimeout(() => {
            this.updateHourlyStats(roomID, h => {
                h.cheers++;
                return h;
            });
        }, 0);
    }

    OnMessage(roomID) {
        setTimeout(() => {
            this.updateHourlyStats(roomID, h => {
                h.messages++;
                return h;
            });
        }, 0);
    }

    OnParamChange(roomID, paramCount) {
        setTimeout(() => {
            this.updateHourlyStats(roomID, h => {
                h.paramChanges += paramCount;
                return h;
            });
        }, 0);
    }
}

module.exports = {
    DFStats
}
