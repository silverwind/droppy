"use strict";

var watcher  = {},
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

    chokidar.watch(".", opts.files)
        .on("add", cb.bind(null, "file", "add"))
        .on("unlink", cb.bind(null, "file", "unlink"))
        .on("change", cb.bind(null, "file", "change"))
        .on("addDir", cb.bind(null, "dir", "addDir"))
        .on("unlinkDir", cb.bind(null, "dir", "unlinkDir"))
        .on("error", log.error)
        .on("ready", function () {
            log.info("Watching " + chalk.blue(opts.files.cwd) + " for changes.");
        });
};

module.exports = watcher;
