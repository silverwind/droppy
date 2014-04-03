"use strict";

var fs     = require("fs"),
    crypto = require("crypto");

function fixPath(p) {
    return p.replace(/[\\|\/]+/g, "/");
}

function getHash(string) {
    return crypto.createHmac("sha256", new Buffer(string, "utf8")).digest("hex");
}

// _.debounce, https://github.com/jashkenas/underscore/blob/master/underscore.js
function debounce(func, wait) {
    var timeout, result;
    return function () {
        var context = this, args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(function () {
            timeout = null;
            result = func.apply(context, args);
        }, wait);
        return result;
    };
}

// _.throttle, https://github.com/jashkenas/underscore/blob/master/underscore.js
function throttle(func, wait, options) {
    var context, args, result;
    var timeout = null;
    var previous = 0;
    if (!options) options = {};
    var later = function () {
        previous = options.leading === false ? 0 : Date.now();
        timeout = null;
        result = func.apply(context, args);
        context = args = null;
    };
    return function () {
        var now = Date.now();
        if (!previous && options.leading === false) previous = now;
        var remaining = wait - (now - previous);
        context = this;
        args = arguments;
        if (remaining <= 0) {
            clearTimeout(timeout);
            timeout = null;
            previous = now;
            result = func.apply(context, args);
            context = args = null;
        } else if (!timeout && options.trailing !== false) {
            timeout = setTimeout(later, remaining);
        }
        return result;
    };
}

function flatten(ob) {
    var toReturn = [];
    for (var i in ob) {
        if (ob.hasOwnProperty(i)) {
            if ((typeof ob[i]) === "object") {
                var flatObject = flatten(ob[i]);
                for (var x in flatObject) {
                    if (flatObject.hasOwnProperty(x)) {
                        toReturn.push(flatObject[x]);
                    }
                }
            } else {
                toReturn[i] = ob[i];
            }
        }
    }
    return toReturn;
}

// Recursively walk a directory and return file paths in an array
function walkDirectory(dir, includeEmptyDirs, callback) {
    var results = [];
    fs.readdir(dir, function (error, list) {
        if (error) return callback(error);
        var i = 0;
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
    if (/[\*\{\}\?\|<>"]/.test(name)) return false; // Invalid characters
    return true;
}

Object.defineProperties(exports, {
    fixPath       : { value: fixPath },
    getHash       : { value: getHash },
    debounce      : { value: debounce },
    throttle      : { value: throttle },
    flatten       : { value: flatten },
    walkDirectory : { value: walkDirectory },
    getExt        : { value: getExt },
    getNewPath    : { value: getNewPath },
    isPathSane    : { value: isPathSane },
});
