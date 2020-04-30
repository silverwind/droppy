"use strict";

const pkg = require("../package.json");
const originalUrl = require("original-url");

module.exports = function manifest(req) {
  return JSON.stringify({
    name: pkg.name,
    start_url: (originalUrl(req).full || "").replace("!/res/manifest.json", ""),
    lang: "en-US",
    background_color: "#181818",
    theme_color: "#181818",
    display: "fullscreen",
    orientation: "any",
    icons: [
      {src: "logo32.png", sizes: "32x32", type: "image/png"},
      {src: "logo120.png", sizes: "120x120", type: "image/png"},
      {src: "logo128.png", sizes: "128x128", type: "image/png"},
      {src: "logo152.png", sizes: "152x152", type: "image/png"},
      {src: "logo180.png", sizes: "180x180", type: "image/png"},
      {src: "logo192.png", sizes: "192x192", type: "image/png"}
    ]
  });
};
