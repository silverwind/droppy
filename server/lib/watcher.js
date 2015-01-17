"use strict";

var interval, update,
    watcher  = {},
    watchers = {},
    log      = require("./log.js"),
    utils    = require("./utils.js"),
    _        = require("lodash"),
    fs       = require("graceful-fs"),
    chalk    = require("chalk"),
    chokidar = require("chokidar");

watcher.init = function init(intervalValue, updateFunc, cb) {
    interval = intervalValue;
    update = updateFunc;
    cb();
};

var chokidarOpts = {
    ignoreInitial: true,
    depth        : 1     // https://github.com/paulmillr/chokidar/issues/206
};

//-----------------------------------------------------------------------------
// Watch the directory for changes and send them to the appropriate clients.
watcher.createWatcher = function createWatcher(directory) {
    var dir = utils.removeFilesPath(directory);
    log.debug(chalk.green("Adding Watcher: ") + dir);
    watchers[dir] = chokidar.watch(directory, chokidarOpts).on("all", _.throttle(function () {
        update(dir);
    }, interval, {leading: false, trailing: true}));
};

//-----------------------------------------------------------------------------
// Watch given directory
watcher.updateWatchers = function updateWatchers(newDir, clients, callback) {
    if (!watchers[newDir]) {
        newDir = utils.addFilesPath(newDir);
        fs.stat(newDir, function (error, stats) {
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
