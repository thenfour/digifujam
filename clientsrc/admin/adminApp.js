const DF = require("../DFCommon");
const ASC = require("../AdminServerCommon");
const DFU = require("../util");

class AdminApp {
   constructor(query, refreshHandler) {
      this.refreshHandler = refreshHandler;

      this.ConsoleLog = [];
      this.ConsoleLogSerial = 0;
      this.authorized = false;
      this.mainInfo = {};

      this.socket = io({
         query
      });
      this.socket.on(ASC.ServerToClientCommands.Authorized, (data) => this.NET_OnAuthorized(data));
      this.socket.on(ASC.ServerToClientCommands.MainInfo, (data) => this.NET_OnMainInfo(data));
      this.socket.on(ASC.ServerToClientCommands.DiscordInfo, (data) => this.NET_OnDiscordInfo(data));
      this.socket.on(ASC.ServerToClientCommands.ConsoleLog, (data) => this.NET_OnConsoleLog(data));
   }

   NET_OnAuthorized(data) {
      this.authorized = true;
      console.log(`NET_OnAuthorized`);
      this.refreshHandler();
   }

   NET_OnMainInfo(data) {
      console.log(`NET_OnMainInfo`);
      this.mainInfo = data;
      this.refreshHandler();
   }

   NET_OnDiscordInfo(data) {
      console.log(`NET_OnDiscordInfo`);
      this.refreshHandler();
   }

   NET_OnConsoleLog(data) {
      this.ConsoleLogSerial ++;
      console.log(`NET_OnConsoleLog`);
      this.ConsoleLog = this.ConsoleLog.concat(data.messages);
      this.refreshHandler();
   }

   IsAuthorized() {
      return this.authorized;
   }

   SendConsoleCommand(commandLine) {
      this.ConsoleLog.push({
         message: commandLine,
         fromClient: true,
         time: new Date(),
      });
      this.socket.emit(ASC.ClientToServerCommands.DoConsoleCommand, {
         commandLine,
      });
   }
}

module.exports = {
   AdminApp,
};
