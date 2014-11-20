"use strict";

var database,
    db       = {},
    _        = require("lodash"),
    fs       = require("graceful-fs"),
    crypto   = require("crypto"),
    mkdirp   = require("mkdirp"),
    path     = require("path"),
    dbFile   = require("./paths.js").get().db,
    defaults = {users: {}, sessions: {}, shortlinks: {}};

db.init = function (callback) {
    fs.stat(dbFile, function (err) {
        if (err) {
            if (err.code === "ENOENT") {
                database = defaults;
                mkdirp(path.dirname(dbFile), function () {
                    write(callback);
                });
            } else {
                callback(err);
            }
        } else {
            fs.readFile(dbFile, function (err, data) {
                if (err) return callback(err);
                try {
                    database = JSON.parse(String(data));
                } catch (error) {
                    return callback(err);
                }
                database = _.defaults(database, defaults);
                write(callback);
            });
        }
    });
};

db.get = function (key) {
    return database[key];
};

db.set = function (key, value, callback) {
    database[key] = value;
    write(callback);
};

db.addOrUpdateUser = function (user, password, privileged, callback) {
    var salt  = crypto.randomBytes(4).toString("hex");

    database.users[user] = {
        hash: getHash(password + salt + user) + "$" + salt,
        privileged: privileged
    };

    write(callback);
};

db.delUser = function (user, callback) {
    if (database.users[user]) {
        delete database.users[user];
        write(function (err) {
            callback(err, true);
        });
    } else {
        callback(null, false);
    }
};

db.authUser = function (user, pass) {
    var parts;

    if (database.users[user]) {
        parts = database.users[user].hash.split("$");
        if (parts.length === 2 && parts[0] === getHash(pass + parts[1] + user))
            return true;
    }

    return false;
};

function write(callback) {
    fs.writeFile(dbFile, JSON.stringify(database, null, 2), callback);
}

function getHash(string) {
    return crypto.createHmac("sha256", new Buffer(string, "utf8")).digest("hex");
}

exports = module.exports = db;
