"use strict";

var async      = require("async");
var handlebars = require("handlebars");
var read       = require("fs").readFile;
var path       = require("path");

var prefix = '(function() {var template = Handlebars.template, templates = Handlebars.templates = Handlebars.templates || {};\n';
var suffix = '})();';

module.exports = function precompile(paths, cb) {
    async.map(paths), function (file, cb) {
        read(file, function (err, data) {
           if (err) return cb(err);
           cb(null, getEntry(p, data));
        });
    }, function (err, entries) {
        cb(prefix + entries.join("") + suffix);
    });
}

function getEntry(file, template) {
    var name = path.basename(file).replace(/\..+$/, "");
    return "templates['" + name + "'] = template(" + template + ");\n";
}
