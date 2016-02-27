"use strict";

var templates  = {};
var handlebars = require("handlebars");
var fs         = require("graceful-fs");
var path       = require("path");

var prefix = "(function(){var template=Handlebars.template, templates=Handlebars.templates=Handlebars.templates||{};";
var suffix = "})();";

templates.compile = function compile(paths) {
  var strings = paths.map(function(file) {
    var string = String(fs.readFileSync(file));
    string = string.split("\n").map(function(line) {
      return line.trim();
    }).join("");
    return getEntry(file, string);
  });
  return prefix + strings.join("") + suffix;
};

function getEntry(file, template) {
  var name = path.basename(file).replace(/\..+$/, "");
  var compiled = handlebars.precompile(template, {data: false});
  return "templates['" + name + "']=template(" + compiled + ");";
}

module.exports = templates;
