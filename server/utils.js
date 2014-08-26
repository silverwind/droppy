"use strict";

var utils = {},
    fs           = require("graceful-fs"),
    path         = require("path"),
    isBinaryFile = require("isbinaryfile"),
    zlib         = require("zlib");


// Create gzip compressed data
utils.createGzip = function createGzip(data, callback) {
    zlib.gzip(data, function (err, gzipped) {
        if (err) return callback(err);
        callback(null, gzipped);
    });
};

// Recursively walk a directory and return file paths in an array
utils.walkDirectory = function walkDirectory(dir, includeEmptyDirs, callback) {
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
};

utils.getExt = function getExt(filename) {
    var dot = filename.lastIndexOf(".");
    if (dot > -1 && dot < filename.length)
        return filename.substring(dot + 1, filename.length);
    else
        return filename;
};

utils.getNewPath = function getNewPath(origPath, callback) {
    fs.stat(origPath, function (err) {
        if (err) callback(origPath);
        else {
            origPath = origPath.replace(/([\\\/]?\.?[^\\\/\.]+)([^\\\/]*)$/, function (match, filename, exts) {
                var fnMatch = filename.match(/([\\\/\.]+\w+)\-(\d+)$/), i = 1;
                if (fnMatch !== null) {
                    filename = fnMatch[1];
                    i = parseInt(fnMatch[2], 10) + 1;
                }
                return filename + "-" + i + exts;
            });
            getNewPath(origPath, callback);
        }
    });
};

utils.isPathSane = function isPathSane(name) {
    if (/[\/\\]\.\./.test(name)) return false;      // Navigating down the tree (prefix)
    if (/\.\.[\/\\]/.test(name)) return false;      // Navigating down the tree (postfix)
    if (/[\*\{\}\|<>"]/.test(name)) return false;   // Invalid characters
    return true;
};

utils.isBinary = function isBinary(path, callback) {
    isBinaryFile(path, function (err, result) {
        if (err) return callback(err);
        callback(null, result);
    });
};

utils.resolve = function resolve(str) {
    var home;
    if (/^~/.test(str)) {
        if (process.platform === "win32") {
            home = process.env.USERPROFILE || process.env.HOMEDRIVE + process.env.HOMEPATH;
            return path.resolve(path.join(home, str.replace(/^~[\\\/]?/, "")));
        } else {
            home = process.env.HOME;
            return path.resolve(path.join(home, str.replace(/^~[\/]?/, "")));
        }
    } else {
        return path.resolve(str);
    }
};

utils.isAbsolute = function isAbsolute(p) {
    return path.resolve(p) === path.normalize(p);
};

utils.checkExistance = function checkExistance(paths) {
    var result = {};
    Object.keys(paths).forEach(function (name) {
        var method = (name === "home" || name === "root") ? "isDirectory" : "isFile";
        try {
            result[name] = fs.statSync(paths[name])[method]();
        } catch (err) {
            if (err.code === "ENOENT")
                result[name] = false;
            else
                result[name] = err;
        }
    });
    return result;
};

exports = module.exports = utils;
