"use strict";

var interval, update,
    watcher  = {},
    watchers = {},
    _        = require("lodash"),
    chalk    = require("chalk"),
    chokidar = require("chokidar"),
    fs       = require("graceful-fs"),
    log      = require("./log.js"),
    paths    = require("./paths.js").get(),
    utils    = require("./utils.js");

var opts = {
    files: {
        cwd           : paths.files,
        alwaysStat    : true,
        depth         : 0,
        ignoreInitial : true
    },
    client: {
        cwd           : paths.client,
        alwaysStat    : true,
        ignoreInitial : true
    }
};

watcher.init = function init(intervalValue, updateFunc) {
    interval = intervalValue;
    update = updateFunc;
};

watcher.watchResources = function watchResources(cb) {
    chokidar.watch(".", opts.client)
        .on("error", log.error)
        .on("change", _.throttle(cb, interval, {leading: true, trailing: true}));
};

//-----------------------------------------------------------------------------
// Watch the directory for changes and send them to the appropriate clients.
watcher.createWatcher = function createWatcher(dir) {
    log.debug(chalk.green("Adding Watcher: ") + dir);
    watchers[dir] = chokidar.watch(dir, opts.files)
        .on("error", log.error)
        .on("all", _.throttle(update, interval, {leading: false, trailing: true}));
};

//-----------------------------------------------------------------------------
// Watch given directory
watcher.updateWatchers = function updateWatchers(newDir, clients, callback) {
    if (!watchers[newDir]) {
        fs.stat(utils.addFilesPath(newDir), function (error, stats) {
            if (error || !stats) {
                // Requested Directory can't be read
                watcher.checkWatchedDirs(clients);
                if (callback) callback(false);
            } else {
                // Directory is okay to be read
                watcher.createWatcher(newDir);
                watcher.checkWatchedDirs(clients);
                if (callback) callback(true);
            }
        });
    } else {
        if (callback) callback(true);
    }
};

//-----------------------------------------------------------------------------
// Check if we need the other active watchers
watcher.checkWatchedDirs = function checkWatchedDirs(clients) {
    var neededDirs = {};
    Object.keys(clients).forEach(function (cookie) {
        var client = clients[cookie];
        client.views.forEach(function (view, vId) {
            if (view && view.directory && view.file === null) {
                neededDirs[client.views[vId].directory] = true;
            }
        });
    });
    Object.keys(watchers).forEach(function (watchedDir) {
        if (!neededDirs[watchedDir]) {
            log.debug(chalk.red("Removing Watcher: ") + watchedDir);
            watchers[watchedDir].close();
            delete watchers[watchedDir];
        }
    });
};

module.exports = watcher;
