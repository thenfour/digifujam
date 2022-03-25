const express = require('express')
const app = express();

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

app.use(function (req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

app.use("/", express.static("public"));

const port = 7000;

app.listen(port, () => {
  console.log(`CDN listening on port ${port}`)
})


