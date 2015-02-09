"use strict";

var watcher  = {},
    _        = require("lodash"),
    chokidar = require("chokidar"),
    log      = require("./log.js"),
    paths    = require("./paths.js").get();

var opts = {
    files: {
        cwd           : paths.files,
        alwaysStat    : true,
        ignoreInitial : true
    },
    client: {
        cwd           : paths.client,
        alwaysStat    : true,
        ignoreInitial : true
    }
};

watcher.watchResources = function watchResources(interval, cb) {
    chokidar.watch(".", opts.client)
        .on("error", log.error)
        .on("change", _.throttle(cb, interval, {leading: true, trailing: true}));
};



watcher.watchFiles = function watchFiles(interval, cb) {
    cb = _.throttle(cb, interval, {leading: false, trailing: true});

    chokidar.watch(".", opts.files)
        .on("add", cb)
        .on("addDir", cb)
        .on("change", cb)
        .on("unlink", cb)
        .on("unlinkDir", cb)
        .on("error", log.error);
};

module.exports = watcher;
