"use strict";

var cfg   = {},
    _     = require("lodash"),
    fs    = require("graceful-fs"),
    defaults = [
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

cfg.create = function (configFile, callback) {
    fs.writeFile(configFile, defaults, function (err) {
        callback(err);
    });
};

cfg.parse = function (configFile, callback) {
    var config;

    if (typeof configFile === "string") {
        try {
            config = JSON.parse(fs.readFileSync(configFile));
        } catch (err) {
            return callback(err);
        }

        if (!config)
            config = {};

        config = _.defaults(config, defaults); // Add missing options
        fs.writeFile(configFile, JSON.stringify(config, null, 4), function (err) {
            callback(err || null, config);
        });
    } else if (typeof configFile === "object") { // Module usage, TODO: pass in the base path
        config = configFile;
        config = _.defaults(config, defaults); // Add missing options
        callback(null, config);
    } else if (process.env.NODE_ENV === "droppydemo") { // TODO: no config object for demo
        config = _.defaults(config, {
            "port"         : process.env.PORT,
            "logLevel"     : 3,
            "zipLevel"     : 1,
            "demoMode"     : true,
            "noLogin"      : true,
            "timestamps"   : false
        });
        callback(null, config);
    }
};

exports = module.exports = cfg;
