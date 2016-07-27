"use strict";

// Manifest for web application - https://w3c.github.io/manifest/

var pkg = require("./../package.json");

module.exports = function manifest(req) {
  var data = {
    name: pkg.name,
    lang: "en-US",
    background_color: "#181818",
    theme_color: "#181818",
    display: "fullscreen",
    orientation: "any",
    icons: [
      {src: "logo32.png",  sizes: "32x32",   type: "image/png"},
      {src: "logo120.png", sizes: "120x120", type: "image/png"},
      {src: "logo128.png", sizes: "128x128", type: "image/png"},
      {src: "logo152.png", sizes: "152x152", type: "image/png"},
      {src: "logo180.png", sizes: "180x180", type: "image/png"},
      {src: "logo192.png", sizes: "192x192", type: "image/png"}
    ]
  };

  var proto = (req.connection && req.connection.encrypted) ? "https://" : "http://";
  var path = (req.url.match(/(.+)\?!\/manifest\.json/) || [null, "/"])[1];
  data.start_url = proto + req.headers["host"] + path;

  return JSON.stringify(data);
};
