"use strict";

var paths     = {};
var root      = "~/.droppy";

var path      = require("path");
var untildify = require("untildify");

paths.get = function get() {
    return {
        home      : resolve(root),
        pid       : resolve(root + "/droppy.pid"),
        files     : resolve(root + "/files"),
        temp      : resolve(root + "/temp"),
        cache     : resolve(root + "/cache"),
        cfg       : resolve(root + "/config"),
        cfgFile   : resolve(root + "/config/config.json"),
        db        : resolve(root + "/config/db.json"),
        tlsKey    : resolve(root + "/config/tls.key"),
        tlsCert   : resolve(root + "/config/tls.cert"),
        tlsCA     : resolve(root + "/config/tls.ca"),
        mod       : resolve(__dirname + "/../.."),
        server    : resolve(__dirname + "/../../server"),
        client    : resolve(__dirname + "/../../client"),
        templates : resolve(__dirname + "/../../client/templates"),
        svg       : resolve(__dirname + "/../../client/svg")
    };
};

paths.seed = function seed(home) {
    root = home;
};

module.exports = paths;

function resolve(str) {
    return path.resolve(/^~/.test(str) ? untildify(str) : str);
}
