const {exec} = require('child_process');
const ASC = require('../clientsrc/AdminServerCommon');
const DFU = require('../clientsrc/dfutil');

class ServerAdminApp {
   constructor(gConfig, gRooms, _7jamAPI, serverStats, discordBot, discordIntegrationMgr) {
      this.gRooms = gRooms;
      this.gConfig = gConfig;
      this._7jamAPI = _7jamAPI;
      this.serverStats = serverStats;
      this.discordBot = discordBot;
      this.discordIntegrationMgr = discordIntegrationMgr;
   }

   OnClientConnect(ws) {
      console.log(`Admin client connecting.`);
      if (ws.handshake.query['DF_ADMIN_PASSWORD'] !== this.gConfig.admin_key) {
         ws.disconnect();
         console.log(` -> disconnecting because incorrect admin key`);
         return;
      }
      ws.on(ASC.ClientToServerCommands.DoConsoleCommand, data => this.DoConsoleCommand(ws, data));

      ws.emit(ASC.ServerToClientCommands.Authorized);
      this.SendLogMessage(ws, "--------------------");
      this.SendHelp(ws);
      this.SendLogMessage(ws, "Welcome!");
      this.SendMainInfo(ws);
   }

   SendLogMessage(ws, message) {
      ws.emit(ASC.ServerToClientCommands.ConsoleLog, {
         messages : [
            {
               message,
               time : new Date()
            }
         ],
      });
   }
   SendLogMessages(ws, messages) {
      ws.emit(ASC.ServerToClientCommands.ConsoleLog, {
         messages : messages.map(m => {
            return {
               message : m,
               time : new Date()
            };
         }),
      });
   }

   SendHelp(ws, args) {
      this.SendLogMessages(ws, [
         `Command line help...`,
         `  echo                <str>`,
         `  main                <refresh main info>`,
         '  log',
         `  integration-status`,
         `  integration-help    <subscriptionID> <integrationID> <args...>`,
         `  integration-cmd     <subscriptionID> <integrationID> <args...>`,
      ]);
   }

   SendLog(ws, args) {
      const child = exec(this.gConfig.log_command, (error, stdout, stderr) => {
         try {
            let msgs = stdout?.toString().replace(/\r\n/, "\n").split("\n");
            msgs = msgs.concat(stderr?.toString().replace(/\r\n/, "\n").split("\n"));
            msgs = msgs.concat(error?.toString().replace(/\r\n/, "\n").split("\n"));
            this.SendLogMessages(ws, msgs);
         } catch (e) {
            this.SendLogMessage(ws, `exception occurred: ${e}`);
         }
      });
   }

   SendMainInfo(ws) {
      ws.emit(ASC.ServerToClientCommands.MainInfo, {
         uptime : this._7jamAPI.GetServerUptimeMS(),
         discordIntegrationMgr : this.discordIntegrationMgr.GetAdminDumpObject(),
         discordBot : this.discordBot.GetAdminDumpObject(),
      });
   }

   // finds subscription & integration with ids args[0] and args[1]
   FindIntegration(args) {
      let ret = null;
      this.discordIntegrationMgr.subscriptions.forEach((subscription, subscriptionID) => {
         if (subscriptionID != args[0])
            return;
         subscription.integrations?.forEach(integration => {
            if (integration.integrationID != args[1])
               return;
            ret = {subscription, integration};
         });
      });
      return ret;
   }

   SendIntegrationStatus(ws, args) {
      // subscription integration description
      let ret = [];
      this.discordIntegrationMgr.subscriptions.forEach((subscription, subscriptionID) => {
         subscription.integrations?.forEach(integration => {
            let flagsIndicator = " ";
            if (integration.GetAdminHelp) {
               flagsIndicator = "*"
            }
            ret.push(`${flagsIndicator} [${subscriptionID} ${integration.integrationID}] : ${subscription.title}`);
            if (integration.GetAdminStatus) {
               ret = ret.concat(integration.GetAdminStatus().map(s => `    ${s}`)); // add indent
            }
         });
      });
      this.SendLogMessages(ws, ret);
   }

   IntegrationHelp(ws, args) {
      args = DFU.GrabArgs(args, 2);
      const si = this.FindIntegration(args);
      if (!si) {
         this.SendLogMessage(ws, `Unable to find subscription '${args[0]}' or integration '${args[1]}'.`);
         return;
      }
      if (!si.integration.GetAdminHelp) {
         this.SendLogMessage(ws, `Integration has no help. It probably just doesn't support admin controls.`);
         return;
      }
      this.SendLogMessages(ws, si.integration.GetAdminHelp());
   }

   IntegrationCmd(ws, args) {
      if (args.length < 2) {
         this.SendLogMessage(`Not enough args; can't find subscription/integration combo.`);
         return;
      }
      args = DFU.GrabArgs(args, 2);
      const si = this.FindIntegration(args);
      if (!si)
         return;
      if (!si.integration.DoAdminCmd) {
         this.SendLogMessage(ws, `Integration has no cmd integration.`);
      }
      si.integration.DoAdminCmd(args[2], (msg) => this.SendLogMessage(ws, msg));
   }

   DoConsoleCommand(ws, data) {
      const tokens = DFU.GrabArgs(data.commandLine, 1);
      if (!tokens?.length) {
         this.SendLogMessage(ws, `failed to parse command line ${data.commandLine}`);
         return;
      }
      const cmd = tokens[0];
      const args = tokens[1];
      switch (cmd.trim()) {
      case 'echo':
         this.SendLogMessage(ws, args);
         return;
      case 'help':
         this.SendHelp(ws, args);
         return;
      case 'log':
         this.SendLog(ws, args);
         return;
      case 'main':
         this.SendMainInfo(ws);
         this.SendLogMessage(ws, `main info refreshed`);
         return;
      case 'integration-cmd':
         this.IntegrationCmd(ws, args);
         return;
      case 'integration-help':
         this.IntegrationHelp(ws, args);
         return;
      case 'integration-status':
         this.SendIntegrationStatus(ws, args);
         return;
      }
      this.SendLogMessage(ws, `Unknown command ${cmd}`);
      return;
   }
}

module.exports = {
   ServerAdminApp,
};
