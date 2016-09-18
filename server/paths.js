"use strict";

var paths     = module.exports = {};
var fs        = require("fs");
var path      = require("path");
var untildify = require("untildify");

var configDir = "~/.droppy/config";
var filesDir  = "~/.droppy/files";

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
  if (files) filesDir = files;
};

function resolve() {
  var p = path.join.apply(null, arguments);
  p = path.resolve(/^~/.test(p) ? untildify(p) : p);
  try {
    p = fs.realpathSync(p);
  } catch (e) {}
  return p;
}
