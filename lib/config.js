/*jslint evil: true, expr: true, regexdash: true, bitwise: true, trailing: false, sub: true, eqeqeq: true,
  forin: true, freeze: true, loopfunc: true, laxcomma: true, indent: false, white: true, nonew: true, newcap: true,
  undef: true, unused: true, globalstrict: true, node: true */
"use strict";

var fs = require("fs"),
    path = require("path"),
    log = require("./log.js"),
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
        '    "maxOpen"      : 256,',
        '    "zipLevel"     : 1,',
        '    "noLogin"      : false,',
        '    "demoMode"     : false,',
        '    "timestamps"   : true,',
        '    "db"           : "./db.json",',
        '    "filesDir"     : "./files/",',
        '    "incomingDir"  : "./temp/incoming/",',
        '    "resDir"       : "./res/",',
        '    "srcDir"       : "./src/",',
        '    "tls" : {',
        '        "key"       : "./keys/key.pem",',
        '        "cert"      : "./keys/cert.pem",',
        '        "ca"        : []',
        '    }',
        '}'
    ].join("\n");

module.exports = function (configFile) {
    // Read & parse config.json, create it if necessary
    try {
        fs.statSync(configFile);
        config = JSON.parse(fs.readFileSync(configFile));
    } catch (error) {
        if (error.code === "ENOENT") {
            log.simple(log.color.yellow, " ->> ", log.color.reset, "creating ",
                       log.color.magenta, path.basename(configFile), log.color.reset, "...");
            fs.writeFileSync(configFile, defaults);
        } else {
            log.error("Error reading ", configFile, ":\n", error);
            process.exit(1);
        }
    }

    // Add any missing options
    if (!config) config = {};
    defaults = JSON.parse(defaults);
    config = mergeDefaults(config, defaults);
    fs.writeFileSync(configFile, JSON.stringify(config, null, 4));

    // Change relative paths to absolutes during runtime
    ["db", "filesDir", "incomingDir", "resDir", "srcDir"].forEach(function (prop) {
        if (config[prop][0] === ".") {
            config[prop] = path.join(process.cwd() + config[prop].substring(1));
        }
    });
    ["cert", "key", "ca"].forEach(function (prop) {
        if (config.tls[prop][0] === ".") {
            config.tls[prop] = path.join(process.cwd() + config.tls[prop].substring(1));
        }
    });
    return config;
};

function mergeDefaults(options, defaults) {
    for (var p in defaults) {
        if (defaults.hasOwnProperty(p)) {
            try {
                if (typeof defaults[p] === "object" && !Array.isArray(defaults[p])) {
                    options[p] = mergeDefaults(options[p], defaults[p]);
                } else if (options[p] === undefined) {
                    options[p] = defaults[p];
                }
            } catch (e) {
                options[p] = defaults[p];
            }
        }
    }
    return options;
}
