"use strict";

var paths = {},
    path  = require("path"),
    root  = "~/.droppy";

paths.get = function get() {
    return {
        home      : resolve(root),
        files     : resolve(root + "/files"),
        temp      : resolve(root + "/temp"),
        cfg       : resolve(root + "/config"),
        cfgFile   : resolve(root + "/config/config.json"),
        db        : resolve(root + "/config/db.json"),
        tlsKey    : resolve(root + "/config/tls.key"),
        tlsCert   : resolve(root + "/config/tls.cert"),
        tlsCA     : resolve(root + "/config/tls.ca"),
        module    : resolve(__dirname + "/../.."),
        server    : resolve(__dirname + "/../../server"),
        client    : resolve(__dirname + "/../../client"),
        templates : resolve(__dirname + "/../../client/templates"),
        svg       : resolve(__dirname + "/../../client/svg")
    };
};

paths.seed = function seed(home) {
    root = home;
};

exports = module.exports = paths;

function resolve(str) {
    if (/^~/.test(str)) {
        var home;
        if (process.platform === "win32") {
            home = process.env.USERPROFILE || process.env.HOMEDRIVE + process.env.HOMEPATH;
            return path.resolve(path.join(home, str.replace(/^~[\\\/]?/, "")));
        } else {
            home = process.env.HOME;
            return path.resolve(path.join(home, str.replace(/^~[\/]?/, "")));
        }
    } else {
        return path.resolve(str);
    }
}
