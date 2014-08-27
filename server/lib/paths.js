"use strict";

var utils = require("./utils.js");

exports = module.exports = {
    home  : utils.resolve("~/.droppy"),
    files : utils.resolve("~/.droppy/files"),
    cfg   : utils.resolve("~/.droppy/config/config.json"),
    db    : utils.resolve("~/.droppy/config/db.json")
};
