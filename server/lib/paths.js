"use strict";

var utils = require("./utils.js");

exports = module.exports = {
    home      : utils.resolve("~/.droppy"),
    files     : utils.resolve("~/.droppy/files"),
    cfg       : utils.resolve("~/.droppy/config/config.json"),
    db        : utils.resolve("~/.droppy/config/db.json"),
    tlsKey    : utils.resolve("~/.droppy/config/tls.key"),
    tlsCert   : utils.resolve("~/.droppy/config/tls.cert"),
    tlsCA     : utils.resolve("~/.droppy/config/tls.ca"),
    module    : utils.resolve(__dirname + "/../.."),
    server    : utils.resolve(__dirname + "/../../server"),
    client    : utils.resolve(__dirname + "/../../client"),
    templates : utils.resolve(__dirname + "/../../client/templates"),
    svg       : utils.resolve(__dirname + "/../../client/svg")
};
