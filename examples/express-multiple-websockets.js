"use strict";

const fs = require("fs");
const http = require("http");
const app = require("express")();
const server = http.createServer(app);
const ws = require("ws")

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

// Bind droppy to a path and initialize its websocket.
// The returned websocket server object is used to make it play well with
// other websocket applications on the same port.
app.use("/", droppyServer.onRequest);
var droppyWss = droppyServer.setupWebSocket(false);

// Create another simple websocket server.
// In this case it does nothing but log when a message is received.
var WebSocketServer = ws.Server
var wss = new WebSocketServer({noServer: true})
// This sets the handler function for the 'connection' event. This fires
// every time a new connection is initially established.
wss.on('connection', handleConnection)
function handleConnection() {
  console.log('Connection on the non-droppy websockets!')
}
// Make it so websocket connections are handled by the websocket server, not
// the normal https server.
server.on('upgrade', function(request, socket, head) {
  if (request.url === '/notDroppy') {
    wss.handleUpgrade(request, socket, head, function(ws) {
      wss.emit('connection', ws, request)
    })
  }
  if (request.url === '/!/socket') {
    droppyWss.handleUpgrade(request, socket, head, function(ws) {
      droppyWss.emit('connection', ws, request)
    })
  }
})

// start the app on http://localhost:8989/ or a port of your choice.
server.listen(process.env.PORT || 8989);
