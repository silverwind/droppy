"use strict";

var mime   = {},
    fs     = require("fs"),
    mt     = require("mime-types"),
    path   = require("path"),
    paths  = require("./paths.js").get(),
    vm     = require("vm");

var overridesExt = {
        "m4v" : "video/mp4", // https://bugzilla.mozilla.org/show_bug.cgi?id=875573
        "mp4v": "video/mp4"  // https://bugzilla.mozilla.org/show_bug.cgi?id=875573
    },
    overridesMime = {
        "text/x-c": "clike"
    };

mime.lookup = function lookup(path) {
    var ext = extractExt(path);
    if (overridesExt[ext])
        return overridesExt[ext];
    else
        return mt.lookup(ext) || "application/octet-stream";
};

mime.compile = function compile(callback) {
    // parse meta.js from CM for mode information
    fs.readFile(path.join(paths.mod, "node_modules/codemirror/mode/meta.js"), function (err, js) {
        if (err) return callback(err);

        var sandbox       = { CodeMirror : {} },
            modesByMime   = {};

        // Execute meta.js in a sandbox
        vm.runInNewContext(js, sandbox);

        // Parse out the entries with meaningful data
        sandbox.CodeMirror.modeInfo.forEach(function (entry) {
            if (entry.mime && entry.mime !== "null" && entry.mode && entry.mode !== "null") {
                modesByMime[entry.mime] = entry.mode;
            }

            if (entry.mimes && Array.isArray(entry.mimes) && entry.mode && entry.mode !== "null") {
                entry.mimes.forEach(function(mime) {
                    modesByMime[mime] = entry.mode;
                });
            }

            if (entry.mime && entry.mime !== "null" && entry.ext && Array.isArray(entry.ext)) {
                entry.ext.forEach(function(ext) {
                    if (!mt.lookup(ext)) overridesExt[ext] = entry.mime;
                });
            }
        });

        Object.keys(overridesMime).forEach(function(mime) {
            if (!modesByMime[mime])
                modesByMime[mime] = overridesMime[mime];
        });

        callback(modesByMime);
    });
};

function extractExt(filename) {
    if (!filename) return "";
    var parts = filename.split(".");
    if (parts.length === 1 || (parts[0] === "" && parts.length === 2))
        return parts[parts.length - 1];
    else
        return parts.pop().toLowerCase();
}

exports = module.exports = mime;
