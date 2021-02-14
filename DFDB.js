// https://zellwk.com/blog/crud-express-mongodb/

const DF = require('./clientsrc/DFCommon');
const MongoClient = require('mongodb').MongoClient;
const mongoose = require('mongoose');
const DFUser = require('./models/DFUser')
const ObjectId = mongoose.Schema.Types.ObjectId;

class DFDB {
    constructor(onSuccess, onError) {
        //this.uri = ;// `mongodb+srv://${process.env.DF_ATLAS_USERNAME}:${process.env.DF_ATLAS_PASSWORD}@cluster0.2it8k.mongodb.net`;
        //this.client = new MongoClient(this.uri, { useNewUrlParser: true });
        mongoose.connect(process.env.DF_MONGO_CONNECTIONSTRING, { useNewUrlParser: true, useUnifiedTopology: true  });
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
                    existing.stats = existing.stats || {
                        notes_played: 0,
                        param_changes: 0,
                        cheers: 0,
                        messages: 0,
                        connectionTimeSec: 0,
                    };
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
                    stats: {
                        notes_played: 0,
                        param_changes: 0,
                        cheers: 0,
                        messages: 0,
                        connectionTimeSec: 0,
                    }
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

};


module.exports = {
    DFDB,
};



