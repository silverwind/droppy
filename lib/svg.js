"use strict";

var fs    = require("graceful-fs"),
    path  = require("path"),
    svgo  = new (require("svgo"))();

exports.process = function (dir) {
    var svgData = {};
    var files = fs.readdirSync(dir);
    files.forEach(function (name) {
        svgo.optimize(fs.readFileSync(path.join(dir, name), "utf8"), function (result) {
            svgData[name.slice(0, name.length - 4)] = result.data;
        });
    });
    return svgData;
};