"use strict";

var cm       = {},
    themes   = {},
    paths    = require("./paths.js"),
    async    = require("async"),
    path     = require("path"),
    fs       = require("graceful-fs"),
    cleanCSS = new require("clean-css")({keepSpecialComments : 0});

cm.init = function init(callback) {
    var files,
        themesPath = path.join(paths.module, "/node_modules/codemirror/theme");

    fs.readdir(themesPath, function (err, filenames) {
        if (err) return callback(err);

        files = filenames.map(function (name) {
            return path.join(themesPath, name);
        });

        async.map(files, fs.readFile, function (err, data) {
            if (err) return callback(err);

            filenames.forEach(function (name, index) {
                themes[name] = cleanCSS.minify(data[index].toString());
            });

            callback(err, themes);
        });
    });
};

exports = module.exports = cm;
