"use strict";

const svgstore = require("svgstore");
const fs = require("fs");
const path = require("path");
const paths = require("./paths.js").get();

module.exports = function svg() {
  const sprites = svgstore({
    svgAttrs: {
      style: "display: none",
    },
  });

  fs.readdirSync(paths.svg).forEach(file => {
    sprites.add(`i-${file.replace(/\.svg/, "")}`, fs.readFileSync(path.join(paths.svg, file)));
  });

  return sprites.toString({inline: true});
};
