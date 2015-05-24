"use strict";

var templates  = {};
var async      = require("async");
var handlebars = require("handlebars");
var read       = require("fs").readFile;
var path       = require("path");

var prefix = '(function() {var template = Handlebars.template, templates = Handlebars.templates = Handlebars.templates || {};\n';
var suffix = '})();';

templates.compile = function compile(paths, cb) {
    async.map(paths, function (file, cb) {
        read(file, function (err, data) {
           if (err) return cb(err);
           cb(null, getEntry(file, data));
        });
    }, function (err, entries) {
        cb(prefix + entries.join("") + suffix);
    });
};

function getEntry(file, template) {
    var name = path.basename(file).replace(/\..+$/, "");
    var compiled = handlebars.precompile(template, {data: false});
    return "templates['" + name + "'] = template(" + compiled + ");\n";
}

module.exports = templates;
