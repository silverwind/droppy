"use strict";

var watcher  = {},
    _        = require("lodash"),
    chokidar = require("chokidar"),
    chalk    = require("chalk"),
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
    },
    interval: 50
};

watcher.watchResources = function watchResources(usePolling, cb) {
    opts.client.usePolling = usePolling;

    chokidar.watch(".", opts.client)
        .on("error", log.error)
        .on("change", _.throttle(cb, opts.interval, {leading: true, trailing: true}))
        .on("ready", function () {
            log.info("Watching " + chalk.blue(opts.client.cwd) + " for changes.");
        });
};

watcher.watchFiles = function watchFiles(usePolling, cb) {
    cb = _.throttle(cb, opts.interval, {leading: true, trailing: true});

    opts.files.usePolling = usePolling;

    chokidar.watch(".", opts.files)
        .on("add", cb)
        .on("addDir", cb)
        .on("change", cb)
        .on("unlink", cb)
        .on("unlinkDir", cb)
        .on("error", log.error)
        .on("ready", function () {
            log.info("Watching " + chalk.blue(opts.files.cwd) + " for changes.");
        });
};

module.exports = watcher;
