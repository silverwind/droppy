"use strict";

var templates  = {};
var handlebars = require("handlebars");
var read       = require("fs").readFileSync;
var path       = require("path");

var prefix = "(function() {var template = Handlebars.template, templates = Handlebars.templates = Handlebars.templates || {};\n";
var suffix = "})();";

templates.compile = function compile(paths) {
    var strings = paths.map(function (p) {
        return getEntry(p, String(read(p)));
    });
    return prefix + strings.join("") + suffix;
};

function getEntry(file, template) {
    var name = path.basename(file).replace(/\..+$/, "");
    var compiled = handlebars.precompile(template, {data: false});
    return "templates['" + name + "'] = template(" + compiled + ");\n";
}

module.exports = templates;
