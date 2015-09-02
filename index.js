"use strict";

module.exports = function droppy(opts) {
  opts = opts || {};

  if (opts.configdir || opts.filesdir) {
    require("./server/paths.js").seed(opts.configdir, opts.filesdir);
  }

  if (opts.log) {
    var ut   = require("untildify");
    var fs   = require("fs");
    var path = require("path");
    var fd;

    try {
      fd = fs.openSync(ut(path.resolve(opts.log)), "a", "644");
    } catch (err) {
      throw new Error("Unable to open log file for writing: " + err.message);
    }
    require("./server/log.js").setLogFile(fd);
  }

  var server = require("./server/server.js");
  server(opts, false, function (err) {
    if (err) throw err;
  });

  return server._onRequest;
};
