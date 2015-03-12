"use strict";

var watcher  = {},
    chokidar = require("chokidar"),
    chalk    = require("chalk"),
    log      = require("./log.js"),
    paths    = require("./paths.js").get(),
    _        = require("lodash");

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
};

watcher.watchResources = function watchResources(usePolling, cb) {
    opts.client.usePolling = usePolling;

    chokidar.watch(".", opts.client)
        .on("error", log.error)
        .on("change", cb)
        .on("ready", function () {
            log.info("Watching " + chalk.blue(opts.client.cwd) + " for changes.");
        });
};

watcher.watchFiles = function watchFiles(usePolling, cb) {
    opts.files.usePolling = usePolling;

    var add       = cb.bind(null, "add"),
        unlink    = cb.bind(null, "unlink"),
        change    = _.throttle(cb.bind(null, "change"), 500, {trailing: true}),
        addDir    = cb.bind(null, "addDir"),
        unlinkDir = cb.bind(null, "unlinkDir");

    chokidar.watch(".", opts.files)
        .on("add", add)
        .on("unlink", unlink)
        .on("change", change)
        .on("addDir", addDir)
        .on("unlinkDir", unlinkDir)
        .on("error", log.error);
};

module.exports = watcher;
