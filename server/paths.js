"use strict";

const paths = module.exports = {};
const fs = require("fs");
const path = require("path");
const untildify = require("untildify");

let configDir = "~/.droppy/config";
let filesDir = "~/.droppy/files";

paths.get = function() {
  return {
    files: resolve(filesDir),
    config: resolve(configDir),

    pid: resolve(configDir, "droppy.pid"),
    temp: resolve(configDir, "temp"),
    cfgFile: resolve(configDir, "config.json"),
    db: resolve(configDir, "db.json"),
    tlsKey: resolve(configDir, "tls.key"),
    tlsCert: resolve(configDir, "tls.cert"),
    tlsCA: resolve(configDir, "tls.ca"),

    mod: resolve(__dirname, ".."),
    server: resolve(__dirname, "..", "server"),
    client: resolve(__dirname, "..", "client"),
    templates: resolve(__dirname, "..", "client", "templates"),
    svg: resolve(__dirname, "..", "client", "svg")
  };
};

paths.seed = function(config, files) {
  if (config) configDir = config;
  if (files) filesDir = files;
};

function resolve(...args) {
  let p = path.join.apply(null, args);
  p = path.resolve(p.startsWith("~") ? untildify(p) : p);
  try {
    p = fs.realpathSync(p);
  } catch {}
  return p;
}
