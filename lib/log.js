/*jslint evil: true, expr: true, regexdash: true, bitwise: true, trailing: false, sub: true,
  eqeqeq: true, forin: true, freeze: true, loopfunc: true, laxcomma: true, indent: false, white: true,
  nonew: true, newcap: true, undef: true, unused: true, globalstrict: true, node: true */
"use strict";

var chalk = require("chalk"),
    config = require("../config.json"),
    useTimestamp;

var log = function log(req, res, logLevel) {
    if (config.logLevel < logLevel) return;

    var elems = Array.prototype.slice.call(arguments, 3),
        ip, port, statusCode;

    if (req && req.time) elems.unshift("[" +  chalk.magenta((Date.now() - req.time) + "ms") + "]");

    if (res) {
        if (res.statusCode) {
           statusCode = res.statusCode;
           switch (String(statusCode).charAt(0)) {
           case "2":
               statusCode = "[" + chalk.green(statusCode) + "]";
               break;
           case "3":
               statusCode = "[" + chalk.yellow(statusCode) + "]";
               break;
           case "4":
           case "5":
               statusCode = "[" + chalk.red(statusCode) + "]";
               break;
           }
           elems.unshift(statusCode);
        }
    }

    if (req) {
        if (req.url) elems.unshift(decodeURIComponent(req.url));
        if (req.method) elems.unshift(chalk.yellow(req.method.toUpperCase()));

        port =  req.socketPort || // This is used for the 'close' event on websockets
                req.headers && req.headers["x-real-port"] ||
                req.upgradeReq && req.upgradeReq.headers && req.upgradeReq.headers["x-real-port"] ||
                req.socket && req.socket.remotePort ||
                req._socket && req._socket.remotePort;

        req.socketPort = port;
        if (port) elems.unshift(chalk.blue(port));

        ip   =  req.socketAddress || // This is used for the 'close' event on websockets
                req.headers && req.headers["x-real-ip"] ||
                req.upgradeReq && req.upgradeReq.headers && req.upgradeReq.headers["x-real-ip"] ||
                req.socket && req.socket.remoteAddress ||
                req._socket && req._socket.remoteAddress;

        req.socketAddress = ip;
        if (ip) elems.unshift(chalk.cyan(ip) + ":");
    }
    if (log.useTimestamp) elems.unshift(log.timestamp());

    elems.forEach(function(part, index) {
        if (part[part.length - 1] !== ":")
            elems[index] = part + " ";
        if (part === "")
            elems.splice(index, 1);
    });

    console.log(elems.join(""));
};

log.debug = function (req, res) {
    if (req && "_events" in req) // Try to distinguish between calls containing req/res and calls without them
        log(req, res, 3, Array.prototype.slice.call(arguments, 2).join(""));
    else
        log(req, res, 3, Array.prototype.slice.call(arguments, 0).join(""));
};

log.info = function (req, res) {
    if (req && "_events" in req) // Try to distinguish between calls containing req/res and calls without them
        log(req, res, 2, Array.prototype.slice.call(arguments, 2).join(""));
    else
        log(req, res, 2, Array.prototype.slice.call(arguments, 0).join(""));
};

log.error = function error(err) {
    if (err === undefined) return log(null, null, 1, "Error handler called without an argument");
    if (err.message) error(String(err.message));
    if (err.stack) error(String(err.stack));
    if (!err.message && !err.stack) log(null, null, 1, err);
};

log.simple = function () {
    log(null, null, 0, chalk.magenta("->> ") + Array.prototype.slice.call(arguments, 0).join(""));
};

log.logo = function() {
    log(null, null, 0, [
            "....__..............................\n",
            ".--|  |----.-----.-----.-----.--.--.\n",
            "|  _  |   _|  _  |  _  |  _  |  |  |\n",
            "|_____|__| |_____|   __|   __|___  |\n",
            ".................|__|..|__|..|_____|\n",
        ].join("").replace(/\./gm, chalk.black("."))
                  .replace(/\_/gm, chalk.yellow("_"))
                  .replace(/\-/gm, chalk.yellow("-"))
                  .replace(/\|/gm, chalk.yellow("|"))
    );
};

log.usage = [
        "Usage: node droppy [version|list|add|del] {arguments}",
        "",
        "Options:",
        "  version                     Print the version.",
        "  list                        List active users.",
        "  add <username> <password>   Create a new user.",
        "  del <username>              Delete a user.",
    ].join("\n");


Object.defineProperty(log, "useTimestamp", {
    get: function () {
        return useTimestamp;
    },
    set: function (value) {
        useTimestamp = value;
    }
});

log.timestamp = function() {
    var now   = new Date(),
        day   = now.getDate(),
        month = now.getMonth() + 1,
        year  = now.getFullYear(),
        hrs   = now.getHours(),
        mins  = now.getMinutes(),
        secs  = now.getSeconds();

    month  < 10 && (month  = "0" + month);
    day    < 10 && (day    = "0" + day);
    hrs    < 10 && (hrs    = "0" + hrs);
    mins   < 10 && (mins   = "0" + mins);
    secs   < 10 && (secs   = "0" + secs);
    return chalk.yellow(year + "-"  + month + "-" + day + " " + hrs + ":" + mins + ":" + secs);
};

exports = module.exports = log;
