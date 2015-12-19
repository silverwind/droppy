"use strict";

var paths     = {};
var fs        = require("fs");
var path      = require("path");
var untildify = require("untildify");

var configDir = "~/.droppy";
var filesDir  = path.join(configDir, "files");
var checked   = false;

paths.get = function get() {
  return {
    files     : resolve(filesDir),
    config    : resolve(configDir),

    pid       : resolve(configDir, "droppy.pid"),
    temp      : resolve(configDir, "temp"),
    cfgFile   : resolve(configDir, "config.json"),
    db        : resolve(configDir, "db.json"),
    tlsKey    : resolve(configDir, "tls.key"),
    tlsCert   : resolve(configDir, "tls.cert"),
    tlsCA     : resolve(configDir, "tls.ca"),

    mod       : resolve(__dirname, ".."),
    server    : resolve(__dirname, "..", "server"),
    client    : resolve(__dirname, "..", "client"),
    templates : resolve(__dirname, "..", "client", "templates"),
    svg       : resolve(__dirname, "..", "client", "svg")
  };
};

paths.seed = function seed(config, files) {
  if (config) configDir = config;
  if (files) {
    filesDir = files;
  } else {
    filesDir = path.join(config, "files");
  }
  checkMigrate();
  cleanupConfigDir();
};

checkMigrate();
cleanupConfigDir();

// migrate pre 3.0 config files
function checkMigrate() {
  if (checked) return;
  checked = true;
  var oldConfig = resolve(configDir, "config");
  fs.stat(oldConfig, function(_err, stats) {
    if (stats && stats.isDirectory()) {
      fs.readdirSync(oldConfig).forEach(function(file) {
        fs.renameSync(path.join(oldConfig, file), path.join(resolve(configDir), file));
      });
      require("rimraf").sync(oldConfig);
    }
  });
}

// cleanup unnecessary files
function cleanupConfigDir() {
  var cacheFile = resolve(configDir, "cache");
  fs.stat(cacheFile, function(_err, stats) {
    if (stats) {
      fs.unlinkSync(cacheFile);
    }
  });
}

module.exports = paths;

function resolve() {
  var p = path.join.apply(null, arguments);
  return path.resolve(/^~/.test(p) ? untildify(p) : p);
}
