const mongoose = require('mongoose');
//var ObjectId = mongoose.Types.ObjectID;
// var id = mongoose.Types.ObjectId();

// String
// Number
// Date
// Buffer
// Boolean
// Mixed
// ObjectId
// Array
// Decimal128
// Map

const DFUserSchema = new mongoose.Schema({
    google_id: String,
    nickname: String,
    color: String,
    socialMediaHandles: {
        type: Map,
        of: String
    },
    global_roles: [String],
    room_roles: [{ room_id: mongoose.Schema.Types.ObjectId, role: String }],
    bands: [mongoose.Schema.Types.ObjectId],
    following_users: [mongoose.Schema.Types.ObjectId],
    stats: {
        noteOns: Number,
        cheers: Number,
        messages: Number,
        presetsSaved: Number,
        paramChanges: Number,
        joins: Number,
        connectionTimeSec: Number,
    }
});

module.exports = mongoose.model('DFUser', DFUserSchema);




