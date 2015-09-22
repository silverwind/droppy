"use strict";

var database, db = {}, defaults = {users: {}, sessions: {}, links: {}};

var _        = require("lodash");
var fs       = require("graceful-fs");
var crypto   = require("crypto");
var mkdirp   = require("mkdirp");
var path     = require("path");

var dbFile   = require("./paths.js").get().db;

db.init = function init(callback) {
  fs.stat(dbFile, function (err) {
    if (err) {
      if (err.code === "ENOENT") {
        database = defaults;
        mkdirp(path.dirname(dbFile), function () {
          write();
          callback();
        });
      } else {
        callback(err);
      }
    } else {
      fs.readFile(dbFile, function (err, data) {
        if (err) return callback(err);
        data = data.toString();

        if (data.trim() !== "") {
          try {
            database = JSON.parse(data);
          } catch (error) {
            return callback(err);
          }
        } else {
          database = {};
        }

        database = _.defaults(database, defaults);

        // migrate old shortlinks
        if (database.shortlinks) {
          database.sharelinks = database.shortlinks;
          delete database.shortlinks;
        }
        if (database.sharelinks) {
          database.links = {};
          Object.keys(database.sharelinks).forEach(function (hash) {
            database.links[hash] = {
              location: database.sharelinks[hash],
              attachment: false
            };
          });
          delete database.sharelinks;
        }

        // remove pre-1.7 session tokens
        if (database.sessions) {
          Object.keys(database.sessions).forEach(function (session) {
            if (session.length !== 48) delete database.sessions[session];
          });
        }

        // remove unused values
        if (database.version) delete database.version;

        write();
        callback();
      });
    }
  });
};

db.get = function get(key) {
  return database[key];
};

db.set = function set(key, value) {
  database[key] = value;
  write();
};

db.addOrUpdateUser = function addOrUpdateUser(user, password, privileged) {
  var salt = crypto.randomBytes(4).toString("hex");

  database.users[user] = {
    hash: getHash(password + salt + user) + "$" + salt,
    privileged: privileged
  };

  write();
};

db.delUser = function delUser(user) {
  if (database.users[user]) {
    delete database.users[user];
    write();
    return true;
  } else {
    return false;
  }
};

db.authUser = function authUser(user, pass) {
  var parts;

  if (database.users[user]) {
    parts = database.users[user].hash.split("$");
    if (parts.length === 2 && parts[0] === getHash(pass + parts[1] + user))
      return true;
  }

  return false;
};

function write() {
  fs.writeFileSync(dbFile, JSON.stringify(database, null, 2));
}

function getHash(string) {
  return crypto.createHmac("sha256", new Buffer(string, "utf8")).digest("hex");
}

module.exports = db;
