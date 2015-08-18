"use strict";

module.exports = function droppy(home, options) {
  if (arguments.length === 1) {
    options = home;
    home    = undefined;
  }

  if (!options) {
    options = {};
  }

  if (typeof home === "string") {
    require("./server/paths.js").seed(home);
  }

  var server = require("./server/server.js");

  server(options, false, function (err) {
    if (err) throw err;
  });

  return server._onRequest;
};
