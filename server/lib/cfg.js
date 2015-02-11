"use strict";

var cfg        = {},
    _          = require("lodash"),
    fs         = require("graceful-fs"),
    mkdirp     = require("mkdirp"),
    path       = require("path"),
    configFile = require("./paths.js").get().cfgFile,
    defaults   = {
        "listeners" : [
            {
                "host"     : "0.0.0.0",
                "port"     : 8989,
                "protocol" : "http"
            }
        ],
        "debug"        : false,
        "keepAlive"    : 20000,
        "linkLength"   : 5,
        "logLevel"     : 2,
        "maxFileSize"  : 0,
        "maxOpen"      : 256,
        "public"       : false,
        "usePolling"   : false,
        "timestamps"   : true
    };

cfg.init = function (config, callback) {
    if (typeof config === "object" && config !== null) {
        config = migrate(config);
        config = _.defaults(config, defaults); // Add missing options
        callback(null, config);
    } else if (process.env.NODE_ENV === "droppydemo") {
        config = _.defaults({
            "listeners" : [
                {
                    "host"     : "0.0.0.0",
                    "port"     : process.env.PORT,
                    "protocol" : "http"
                }
            ],
            "public"     : true,
            "logLevel"   : 3,
            "timestamps" : false,
            "usePolling" : true
        }, defaults);
        callback(null, config);
    } else {
        fs.stat(configFile, function (err) {
            if (err) {
                if (err.code === "ENOENT") {
                    config = defaults;
                    mkdirp(path.dirname(configFile), function () {
                        write(config, function (err) {
                            callback(err || null, config);
                        });
                    });
                } else {
                    callback(err);
                }
            } else {
                fs.readFile(configFile, function (err, data) {
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
                    Object.keys(config).forEach(function (key) {
                        if (typeof defaults[key] === "undefined") {
                            delete config[key];
                        }
                    });

                    write(config, function (err) {
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
    var oldProps = ["host", "port", "useTLS", "useSPDY", "useHSTS", "readInterval"];

    var needToMigrate = oldProps.every(function (prop) {
        return config.hasOwnProperty(prop);
    });

    if (needToMigrate && !config.listeners) {
        config.listeners = [{
            "host"     : config.host,
            "port"     : config.port,
            "protocol" : config.useSPDY ? "spdy" : config.useTLS ? "https" : "http",
            "hsts"     : config.useHSTS ? 31536000 : 0
        }];
    }
    oldProps.forEach(function (prop) {
        delete config[prop];
    });
    return config;
}

exports = module.exports = cfg;
