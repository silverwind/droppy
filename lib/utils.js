"use strict";

var fs           = require("fs"),
    crypto       = require("crypto"),
    isBinaryFile = require("isbinaryfile");

function fixPath(p) {
    return p.replace(/[\\|\/]+/g, "/");
}

function getHash(string) {
    return crypto.createHmac("sha256", new Buffer(string, "utf8")).digest("hex");
}

function flatten(ob) {
    var toReturn = [];
    Object.keys(ob).forEach(function (i) {
        if ((typeof ob[i]) === "object") {
            var flatObject = flatten(ob[i]);
            Object.keys(flatObject).forEach(function (j) {
                toReturn.push(flatObject[j]);
            });
        } else {
            toReturn[i] = ob[i];
        }
    });
    return toReturn;
}

// Recursively walk a directory and return file paths in an array
function walkDirectory(dir, includeEmptyDirs, callback) {
    var results = [];
    fs.readdir(dir, function (error, list) {
        var i = 0;
        if (error) return callback(error);
        (function next() {
            var file = list[i++];
            if (!file) return callback(null, results);
            file = dir + "/" + file;
            fs.stat(file, function (error, stats) {
                if (stats && stats.isDirectory()) {
                    if (includeEmptyDirs) results.push(file + "/");
                    walkDirectory(file, includeEmptyDirs, function (error, res) {
                        results = results.concat(res);
                        next();
                    });
                } else {
                    results.push(file);
                    next();
                }
            });
        })();
    });
}

function getExt(filename) {
    var dot = filename.lastIndexOf(".");
    if (dot > -1 && dot < filename.length)
        return filename.substring(dot + 1, filename.length);
    else
        return filename;
}

function getNewPath(origPath, callback) {
    fs.stat(origPath, function (err) {
        if (err) callback(origPath);
        else {
            origPath = origPath.replace(/([\\\/]?\.?[^\\\/\.]+)([^\\\/]*)$/, function (match, filename, exts) {
                var fnMatch = filename.match(/([\\\/\.]+\w+)\-(\d+)$/), i = 1;
                if (fnMatch !== null) {
                    filename = fnMatch[1];
                    i = parseInt(fnMatch[2]) + 1;
                }
                return filename + "-" + i + exts;
            });
            getNewPath(origPath, callback);
        }
    });
}

function isPathSane(name) {
    if (/[\/\\]\.\./.test(name)) return false;      // Navigating down the tree (prefix)
    if (/\.\.[\/\\]/.test(name)) return false;      // Navigating down the tree (postfix)
    if (/[\*\{\}\|<>"]/.test(name)) return false;   // Invalid characters
    return true;
}

function isBinary(path, callback) {
    isBinaryFile(path, function (err, result) {
        if (err) return callback(err);
        callback(null, result);
    });
}

Object.defineProperties(exports, {
    fixPath       : { value: fixPath },
    getHash       : { value: getHash },
    flatten       : { value: flatten },
    walkDirectory : { value: walkDirectory },
    getExt        : { value: getExt },
    getNewPath    : { value: getNewPath },
    isPathSane    : { value: isPathSane },
    isBinary      : { value: isBinary }
});
