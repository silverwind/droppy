"use strict";

var npm,
    async = require("async"),
    chalk = require("chalk"),
    log   = require("./log.js");

function updateSelf(pkg, callback) {
    function loadNPM(cb) {
        // obtain a reference to the global npm to avoid having to install npm locally
        require("child_process").exec("npm", function (err, stdout) {
            var match = /npm@[^ ]+ (.+)\n/i.exec(stdout);
            if (!match) return cb(new Error("Unable to find path in npm help message."));
            cb(null, require(match[1]));
        });
    }

    function getNPMVersion(cb) {
        npm.commands.view([pkg.name, "dist-tags.latest"], true, function (err, response) {
            if (err) return cb(err);
            cb(null, Object.keys(response)[0]);
        });
    }

    function getInstalledVersion(cb) {
        npm.commands.list([pkg.name], true, function (err, response) {
            if (err) return cb(err);
            cb(null, response.dependencies[pkg.name].version);
        });
    }

    function update() {
        async.parallel([getInstalledVersion, getNPMVersion], function (err, versions) {
            if (err) return callback(err);
            if (versions[0] !== versions[1]) {
                log.info("Updating " + pkg.name + " from " + chalk.green(versions[0]) + " to " + chalk.green(versions[1]) + " ...");
                npm.commands.install([pkg.name + "@" + versions[1]], function (err)  {
                    if (err) return callback(err);
                    callback(null, "Successfully updated to " + chalk.green(versions[1]) + "!");
                });
            } else {
                callback(null, pkg.name + " is already up to date!");
            }
        });
    }

    if (!npm) {
        loadNPM(function (err, npmObj) {
            if (err) return callback(err);
            npmObj.load({global: true, loglevel: "silent"}, function (err, npmObj) {
                if (err) return callback(err);
                npm = npmObj;
                update();
            });
        });
    } else {
        update();
    }
}

exports = module.exports = updateSelf;
