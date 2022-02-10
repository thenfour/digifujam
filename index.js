const express = require('express')
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

const { _7jamServer } = require('./source/DFserver/7jamserver');

let oldConsoleLog = console.log;
let log = (msg) => {
  if (!msg)
    return;
  oldConsoleLog(`${(new Date()).toISOString()} ${msg}`);
  if (msg.stack) {
    // assume error object.
    oldConsoleLog(`EXCEPTION stack: ${msg.stack}`);
  }
};
console.log = log;

const sevenjamgogo = new _7jamServer(io, app, http);
