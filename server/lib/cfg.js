"use strict";

var cfg        = {},
    _          = require("lodash"),
    fs         = require("graceful-fs"),
    mkdirp     = require("mkdirp"),
    path       = require("path"),
    configFile = require("./paths.js").cfg,
    defaults   = [
        '{',
        '    "host"         : "0.0.0.0",',
        '    "port"         : 8989,',
        '    "debug"        : false,',
        '    "useTLS"       : false,',
        '    "useSPDY"      : false,',
        '    "useHSTS"      : false,',
        '    "readInterval" : 250,',
        '    "keepAlive"    : 20000,',
        '    "linkLength"   : 3,',
        '    "logLevel"     : 2,',
        '    "maxOpen"      : 256,',
        '    "maxFileSize"  : 0,',
        '    "zipLevel"     : 1,',
        '    "noLogin"      : false,',
        '    "demoMode"     : false,',
        '    "timestamps"   : true,',
        '    "tlsKey"       : "domain.key",',
        '    "tlsCert"      : "domain.crt",',
        '    "tlsCA"        : "domain.ca"',
        '}'
    ].join("\n");

cfg.init = function (config, callback) {
    if (typeof configFile === "object") {
        config = _.defaults(config, JSON.parse(defaults)); // Add missing options
        callback(null, config);
    } else if (process.env.NODE_ENV === "droppydemo") {
        config = _.defaults(config, {
            "port"         : process.env.PORT,
            "logLevel"     : 3,
            "zipLevel"     : 1,
            "demoMode"     : true,
            "noLogin"      : true,
            "timestamps"   : false
        }, JSON.parse(defaults));
        callback(null, config);
    } else {
        fs.stat(configFile, function (err) {
            if (err) {
                if (err.code === "ENOENT") {
                    config = defaults;
                    mkdirp(path.dirname(configFile), function () {
                        write(config, callback);
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
                    write(config, callback);
                });
            }
        });
    }
};

function write(config, callback) {
    fs.writeFile(configFile, JSON.stringify(config, null, 4), callback);
}

exports = module.exports = cfg;
