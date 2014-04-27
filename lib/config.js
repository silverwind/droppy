"use strict";

var fs    = require("fs"),
    path  = require("path"),
    chalk = require("chalk"),
    log   = require("./log.js"),
    config,
    defaults = [
        '{',
        '    "debug"        : false,',
        '    "useTLS"       : false,',
        '    "useSPDY"      : false,',
        '    "useHSTS"      : false,',
        '    "listenHost"   : "0.0.0.0",',
        '    "listenPort"   : 8989,',
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
        '    "db"           : "./db.json",',
        '    "filesDir"     : "./files/",',
        '    "tempDir"      : "./temp/",',
        '    "tlsKey"       : "./key.pem",',
        '    "tlsCert"      : "./cert.pem",',
        '    "tlsCA"        : "./ca.pem"',
        '}'
    ].join("\n");

module.exports = function (options, configFile) {
    // Read & parse config.json, create it if necessary
    try {
        fs.statSync(configFile);
        config = JSON.parse(fs.readFileSync(configFile));
    } catch (error) {
        if (error.code === "ENOENT") {
            log.useTimestamp = true; // For consistent logging, set this to true as in the default config
            log.simple("Creating ", chalk.magenta(path.basename(configFile)), "...");
            fs.writeFileSync(configFile, defaults);
        } else {
            log.error("Error reading ", configFile, ":\n", error);
            process.exit(1);
        }
    }

    // Add any missing options
    if (!config) config = {};
    defaults = JSON.parse(defaults);
    config = merge(config, defaults);
    fs.writeFileSync(configFile, JSON.stringify(config, null, 4));

    // Change relative paths to absolutes
    ["db", "filesDir", "tempDir", "tlsKey", "tlsCert", "tlsCA"].forEach(function (prop) {
        var path = config[prop];
        if (path[0] !== "/") {
            config[prop] = path.join(__dirname + "/../" + path.substring(1));
        }
    });

    // Append trailing slash to paths if necessary
    ["filesDir", "tempDir"].forEach(function (prop) {
        var path = config[prop];
        if (path[path.length - 1] !== "/")
            config[prop] += "/";
    });

    // When used as a module, override settings with the provided options object
    if (options) config = merge(options, config);

    // Special config for droppy's demo
    if (process.env.NODE_ENV === "droppydemo") {
        log.simple("Loading demo mode configuration...");
        return {
            "debug"        : false,
            "useTLS"       : false,
            "useSPDY"      : false,
            "useHSTS"      : false,
            "listenHost"   : "0.0.0.0",
            "listenPort"   : process.env.PORT || 8989,
            "readInterval" : 250,
            "keepAlive"    : 20000,
            "linkLength"   : 3,
            "logLevel"     : 3,
            "maxOpen"      : 256,
            "zipLevel"     : 1,
            "demoMode"     : true,
            "noLogin"      : true,
            "timestamps"   : false,
            "db"           : "./db.json",
            "filesDir"     : "./files/",
            "tempDir"      : "./temp/",
            "tlsKey"       : "./key.pem",
            "tlsCert"      : "./cert.pem",
            "tlsCA"        : "./ca.pem"
        };
    } else {
        return config;
    }
};

function merge(options, defaults) {
    Object.keys(defaults).forEach(function (p) {
        try {
            if (typeof defaults[p] === "object" && !Array.isArray(defaults[p])) {
                options[p] = merge(options[p], defaults[p]);
            } else if (options[p] === undefined) {
                options[p] = defaults[p];
            }
        } catch (e) {
            options[p] = defaults[p];
        }
    });
    return options;
}
