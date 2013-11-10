"use strict";

var fs = require("fs");

// _.debounce, https://github.com/jashkenas/underscore/blob/master/underscore.js
exports.debounce = function (func, wait) {
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
};

// _.throttle, https://github.com/jashkenas/underscore/blob/master/underscore.js
exports.throttle = function (func, wait, options) {
    var context, args, result;
    var timeout = null;
    var previous = 0;
    options || (options = {});
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
};

exports.flattenObj = function flatten(ob) {
    var toReturn = [];
    for (var i in ob) {
        if (ob.hasOwnProperty(i)) {
            if ((typeof ob[i]) === 'object') {
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
};

// Recursively walk a directory and return file paths in an array
exports.walkDirectory = function walkDirectory(dir, callback) {
    var results = [];
    fs.readdir(dir, function (error, list) {
        if (error) return callback(error);
        var i = 0;
        (function next() {
            var file = list[i++];
            if (!file) return callback(null, results);
            file = dir + '/' + file;
            fs.stat(file, function (error, stats) {
                if (stats && stats.isDirectory()) {
                    walkDirectory(file, function (error, res) {
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

exports.logo = [
    "....__..............................\n",
    ".--|  |----.-----.-----.-----.--.--.\n",
    "|  _  |   _|  _  |  _  |  _  |  |  |\n",
    "|_____|__| |_____|   __|   __|___  |\n",
    ".................|__|..|__|..|_____|\n"
].join("");