"use strict";

const cfg = module.exports = {};
const fs = require("fs");
const {dirname} = require("path");

const configFile = require("./paths.js").get().cfgFile;

const defaults = {
  listeners: [
    {
      host: ["0.0.0.0", "::"],
      port: 8989,
      protocol: "http"
    }
  ],
  public: false,
  timestamps: true,
  linkLength: 5,
  linkExtensions: false,
  logLevel: 2,
  maxFileSize: 0,
  updateInterval: 1000,
  pollingInterval: 0,
  keepAlive: 20000,
  uploadTimeout: 604800000,
  allowFrame: false,
  readOnly: false,
  ignorePatterns: [],
  watch: true,
  headers: {},
};

const hiddenOpts = ["dev"];

cfg.init = function(config, callback) {
  if (typeof config === "object" && config !== null) {
    config = Object.assign({}, defaults, config);
    callback(null, config);
  } else {
    fs.stat(configFile, err => {
      if (err) {
        if (err.code === "ENOENT") {
          config = defaults;
          fs.mkdir(dirname(configFile), {recursive: true}, (err) => {
            if (err) return callback(err);
            write(config, err => {
              callback(err || null, config);
            });
          });
        } else {
          callback(err);
        }
      } else {
        fs.readFile(configFile, (err, data) => {
          if (err) return callback(err);

          try {
            config = JSON.parse(String(data));
          } catch (err2) {
            return callback(err2);
          }

          if (!config) config = {};

          config = Object.assign({}, defaults, config);

          // TODO: validate more options
          if (typeof config.pollingInterval !== "number") {
            return callback(new TypeError("Expected a number for the 'pollingInterval' option"));
          }

          // Remove options no longer present
          Object.keys(config).forEach(key => {
            if (defaults[key] === undefined && !hiddenOpts.includes(key)) {
              delete config[key];
            }
          });

          write(config, err => {
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
