"use strict";

var cfg        = {};

var _          = require("lodash");
var fs         = require("graceful-fs");
var mkdirp     = require("mkdirp");
var path       = require("path");

var configFile = require("./paths.js").get().cfgFile;

var defaults = {
  listeners : [
    {
      host     : ["0.0.0.0", "::"],
      port     : 8989,
      protocol : "http"
    }
  ],
  public          : false,
  timestamps      : true,
  linkLength      : 5,
  logLevel        : 2,
  maxFileSize     : 0,
  updateInterval  : 1000,
  pollingInterval : 0,
  keepAlive       : 20000,
  allowFrame      : false,
};

var hiddenOpts = ["dev", "demo"];

cfg.init = function init(config, callback) {
  if (typeof config === "object" && config !== null) {
    config = migrate(config);
    config = _.defaults(config, defaults); // Add missing options
    callback(null, config);
  } else {
    fs.stat(configFile, function(err) {
      if (err) {
        if (err.code === "ENOENT") {
          config = defaults;
          mkdirp(path.dirname(configFile), function() {
            write(config, function(err) {
              callback(err || null, config);
            });
          });
        } else {
          callback(err);
        }
      } else {
        fs.readFile(configFile, function(err, data) {
          if (err) return callback(err);

          try {
            config = JSON.parse(String(data));
          } catch (err) {
            return callback(err);
          }

          if (!config) config = {};

          config = migrate(config);
          config = _.defaults(config, defaults);

          // Remove options no longer present
          Object.keys(config).forEach(function(key) {
            if (defaults[key] === undefined && hiddenOpts.indexOf(key) === -1) {
              delete config[key];
            }
          });

          write(config, function(err) {
            callback(err || null, config);
          });
        });
      }
    });
  }
};

function write(config, callback) {
  fs.writeFile(configFile, JSON.stringify(config, null, 2), callback);
}

function migrate(config) {
  var oldProps = [
    "host",
    "port",
    "useTLS",
    "useSPDY",
    "useHSTS",
    "readInterval",
    "maxOpen"
  ];

  var needToMigrate = oldProps.every(function(prop) {
    return config.hasOwnProperty(prop);
  });

  if (needToMigrate && !config.listeners) {
    config.listeners = [{
      host     : config.host,
      port     : config.port,
      protocol : config.useSPDY || config.useTLS ? "https" : "http",
      hsts     : config.useHSTS ? 31536000 : 0
    }];
  }
  oldProps.forEach(function(prop) {
    delete config[prop];
  });
  return config;
}

module.exports = cfg;
