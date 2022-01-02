// stuff here that can be shared between client & server, for admin realm.
// for server-only admin realm code see /server/serverAdminApp.js
// for client-only, see clientsrc/admin/* and clientsrc/adminUI/*

const DFUtil = require('./dfutil');
const DFMusic = require("./DFMusic");

const ClientToServerCommands = {
   DoConsoleCommand : "DoConsoleCommand", // command
};

const ServerToClientCommands = {
   Authorized : "Authorized",
   MainInfo : "MainInfo", // main misc info dump from server
   DiscordInfo : "DiscordInfo",
   ConsoleLog : "ConsoleLog",
};

module.exports = {
   ServerToClientCommands,
   ClientToServerCommands,
}
