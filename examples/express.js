"use strict";

const fs = require("fs");
const http = require("http");
const app = require("express")();
const server = http.createServer(app);

// Load the module. replace '..' with 'droppy' when used as a dependency.
const droppy = require("..");

// Initialze the droppy server with a config object.
const droppyServer = droppy({
  configdir: "./config",
  filesdir: "./files",
  logLevel: 3,
  debug: true
});

// Write a test file
fs.writeFileSync("./files/test.txt", "Just a test!");

// Bind droppy to a path and initialize its websocket. Note that this
// probably doesn't play well with other web socket servers.
app.use("/", droppyServer.onRequest);
droppyServer.setupWebSocket(server);

// start the app on http://localhost:8989/ or a port of your choice.
server.listen(process.env.PORT || 8989);
