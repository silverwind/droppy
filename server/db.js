"use strict";

var database, dbFile,
    db       = {},
    _        = require("lodash"),
    fs       = require("graceful-fs"),
    crypto   = require("crypto"),
    defaults = {users: {}, sessions: {}, shortlinks: {}};

db.create = function (path, callback) {
    fs.writeFile(path, JSON.stringify(defaults, null, 4), function (err) {
        callback(err);
    });
};

db.parse = function (path, callback) {
    dbFile = path;

    fs.readFile(dbFile, function (err, data) {
        if (err) {
            return callback(err);
        } else {
            try {
                database = JSON.parse(String(data));
            } catch (error) {
                return callback(err);
            }
        }
        database = _.defaults(database, defaults); // Add missing entries
        db.write(function () {
            callback(err, database);
        });
    });
};

db.get = function (key) {
    return database[key];
};

db.set = function (key, value, callback) {
    database[key] = value;
    db.write(callback);
};

db.write = function (callback) {
    fs.writeFile(dbFile, JSON.stringify(database, null, 4), function (err) {
        if (callback) callback(err);
    });
};

db.addOrUpdateUser = function (user, password, privileged, callback) {
    var salt  = crypto.randomBytes(4).toString("hex");

    database.users[user] = {
        hash: getHash(password + salt + user) + "$" + salt,
        privileged: privileged
    };

    db.write(callback);
};

db.delUser = function (user, callback) {
    if (database.users[user]) {
        delete database.users[user];
        db.write(function (err) {
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

function getHash(string) {
    return crypto.createHmac("sha256", new Buffer(string, "utf8")).digest("hex");
}

exports = module.exports = db;
