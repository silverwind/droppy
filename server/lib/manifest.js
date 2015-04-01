"use strict";

// Manifest for web application - https://w3c.github.io/manifest/

var pkg = require("./../../package.json");

module.exports = function manifest(req) {
    var data = {
        "name": pkg.name,
        "display": "fullscreen",
        "orientation": "any",
        "icons": [
            { "src": "?!/icon_16.png",  "sizes": "16x16",   "type": "image/png" },
            { "src": "?!/icon_32.png",  "sizes": "32x32",   "type": "image/png" },
            { "src": "?!/icon_120.png", "sizes": "120x120", "type": "image/png" },
            { "src": "?!/icon_128.png", "sizes": "128x128", "type": "image/png" },
            { "src": "?!/icon_152.png", "sizes": "152x152", "type": "image/png" },
            { "src": "?!/icon_180.png", "sizes": "180x180", "type": "image/png" },
            { "src": "?!/icon_192.png", "sizes": "192x192", "type": "image/png" }
        ]
    };

    if (req.headers["host"]) {
        data["start_url"] = (req.connection.encrypted ? "https://" : "http://") + req.headers["host"] + "/";
    }

    return JSON.stringify(data);
};

