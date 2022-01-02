const DFU = require('./dfutil');

// this is an integration which only serves to sync the user list between discord & 7jam.

class UserListSyncOnly {
   get RequiresUserListSync() {
      return true;
   }

   constructor(subscription, integrationSpec, mgr, integrationID) {
      this.mgr = mgr;
      this.subscription = subscription;
      this.integrationSpec = integrationSpec;
      this.integrationID = integrationID;
   }

   GetDebugData() {
      return {
         integrationID: this.integrationID,
         engine: "UserListSyncOnly",
      };
   }

};

module.exports = {
   UserListSyncOnly,
};



