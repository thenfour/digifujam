// https://zellwk.com/blog/crud-express-mongodb/

const DF = require('./clientsrc/DFCommon');
const MongoClient = require('mongodb').MongoClient;
const mongoose = require('mongoose');
const DFUser = require('./models/DFUser')
const ObjectId = mongoose.Schema.Types.ObjectId;

class DFDB {
    constructor(gConfig, onSuccess, onError) {
        if (!gConfig.mongo_connection_string) {
            console.log(`Mongo ignored.`);
            onSuccess();
            return;
        }
        mongoose.connect(gConfig.mongo_connection_string, { useNewUrlParser: true, useUnifiedTopology: true  });
        const db = mongoose.connection
        db.once('open', _ => {
            console.log(`Mongo connected.`);
            onSuccess();
        });

        db.on('error', err => {
            console.log(`Mongo connect error: ${JSON.stringify(err)}`);
            onError();
        });
    }

    // resolves with the db object
    GetOrCreateGoogleUser(username, color, google_id) {
        return new Promise((resolve, rej) => {
            DFUser.findOne({ google_id }).then(existing => {
                if (existing) {
                    existing.nickname = username;
                    existing.color = color;
                    existing.stats = existing.stats || DF.DigifuUser.emptyStatsObj();
                    existing.save().then(_ => {
                        console.log(`returning an existing user document ${existing._id}`);
                        resolve(existing);
                    });
                    return;
                }

                // create new.
                const n = new DFUser({
                    nickname: username,
                    color,
                    google_id,
                    stats: DF.DigifuUser.emptyStatsObj()
                });
                n.save((error, document) => {
                    if (error) {
                        console.log(`Error saving a new google-based user. ${JSON.stringify(error)}`);
                    } else {
                        console.log(`created a new user document ${document._id}`);
                        resolve(document);
                    }
                });
            });
        });
    } // GetOrCreateGoogleUser

    GetFollowerCount(dbUserID) {
        return new Promise((resolve, rej) => {
            // count of users where following_users contains dbUserID
            DFUser.countDocuments({following_users:dbUserID}, function (err, count) {
                if (err) {
                    console.log(`error getting followers of ${dbUserID}... ${JSON.stringify(err)}`);
                    resolve(0);
                    return;
                }
                resolve(count);
              });
        });
    }


    // userStats is an object with userIDs as keys
    UpdateUserStats(userStats) {
        const ops = Object.keys(userStats).map(userID => {

            let incObj = {};
            Object.keys(userStats[userID]).forEach(k => {
                incObj["stats." + k] = userStats[userID][k];
            });

            return {
                "updateOne": {
                    "filter": { "_id" : mongoose.Types.ObjectId(userID)},
                    "update": {
                        $inc : incObj,
                    },
                }
            };
        });
        if (ops.length) {
            //console.log(`${JSON.stringify(ops)}`);
            DFUser.bulkWrite(ops).then(ret => {
                //console.log(`bulkwrite returned`)
                //console.log(`${JSON.stringify(ret)}`)
            });
        }
    }

};


module.exports = {
    DFDB,
};



