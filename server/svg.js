"use strict";

var svgstore = require("svgstore");
var fs = require("fs");
var path = require("path");
var paths = require("./paths.js").get();

module.exports = function spritesheet() {
  var sprites = svgstore({
    svgAttrs: {
      style: "display: none",
    },
  });

  fs.readdirSync(paths.svg).forEach(function(file) {
    sprites.add("i-" + file.replace(/\.svg/, ""), fs.readFileSync(path.join(paths.svg, file)));
  });

  return sprites.toString({inline: true});
};
