"use strict";

var cfg        = {},
    _          = require("lodash"),
    fs         = require("graceful-fs"),
    mkdirp     = require("mkdirp"),
    path       = require("path"),
    configFile = require("./paths.js").cfg,
    defaults   = {
        "host"         : "0.0.0.0",
        "port"         : 8989,
        "debug"        : false,
        "useTLS"       : false,
        "useSPDY"      : false,
        "useHSTS"      : false,
        "readInterval" : 250,
        "keepAlive"    : 20000,
        "linkLength"   : 3,
        "logLevel"     : 2,
        "maxOpen"      : 256,
        "maxFileSize"  : 0,
        "zipLevel"     : 1,
        "noLogin"      : false,
        "demoMode"     : false,
        "timestamps"   : true
    };

cfg.init = function (config, callback) {
    if (typeof config === "object" && config !== null) {
        config = _.defaults(config, defaults); // Add missing options
        callback(null, config);
    } else if (process.env.NODE_ENV === "droppydemo") {
        config = _.defaults({
            "port"         : process.env.PORT,
            "demoMode"     : true,
            "noLogin"      : true,
            "timestamps"   : false
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
                    } catch (error) {
                        return callback(err);
                    }

                    if (!config) config = {};
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
    fs.writeFile(configFile, JSON.stringify(config, null, 4), callback);
}

exports = module.exports = cfg;
