"use strict";

module.exports = function droppy(opts) {
  opts = opts || {};

  if (opts.configdir || opts.filesdir) {
    require("./server/paths.js").seed(opts.configdir, opts.filesdir);
  }

  if (opts.log) {
    const ut = require("untildify");
    const fs = require("fs");
    const path = require("path");
    let fd;

    try {
      fd = fs.openSync(ut(path.resolve(opts.log)), "a", "644");
    } catch (err) {
      throw new Error("Unable to open log file for writing: " + err.message);
    }
    require("./server/log.js").setLogFile(fd);
  }

  const server = require("./server/server.js");
  return server(opts, false, false, err => {
    if (err) throw err;
  });
};
