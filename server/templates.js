"use strict";

var templates  = {};
var handlebars = require("handlebars");
var fs         = require("graceful-fs");
var path       = require("path");

var prefix = "(function(){var template=Handlebars.template, templates=Handlebars.templates=Handlebars.templates||{};";
var suffix = "})();";

templates.compile = function compile(paths) {
  var strings = paths.map(function(file) {
    return getEntry(file, String(fs.readFileSync(file)));
  });
  return prefix + strings.join("") + suffix;
};

function getEntry(file, template) {
  var name = path.basename(file).replace(/\..+$/, "");
  var compiled = handlebars.precompile(template, {data: false});
  return "templates['" + name + "']=template(" + compiled + ");";
}

module.exports = templates;
