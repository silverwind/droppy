"use strict";

var opts, logfd,
    fs    = require("graceful-fs"),
    chalk = require("chalk"),
    logColors = [
        "reset",
        "red",
        "yellow",
        "cyan"
    ],
    logLabels = [
        "",
        "ERROR",
        "INFO",
        "DEBG"
    ];

var log = function log(req, res, logLevel) {
    if (opts && opts.logLevel < logLevel) return;

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
        if (req.url) elems.unshift(decodeURIComponent(decodeURIComponent(req.url))); // For some reason, this need double decoding for upload URLs
        if (req.method) elems.unshift(chalk.yellow(req.method.toUpperCase()));

        port = req.realPort ||
               req.headers && req.headers["x-real-port"] ||
               req.connection && req.connection.remotePort ||
               req.socket && req.socket.remotePort ||
               req.connection && req.connection.socket && req.connection.socket.remotePort;

        ip   = req.realIP ||
               req.headers && req.headers["x-real-ip"] ||
               req.headers && req.headers["x-forwarded-for"] ||
               req.connection && req.connection.remoteAddress ||
               req.socket && req.socket.remoteAddress ||
               req.connection && req.connection.socket && req.connection.socket.remoteAddress;

        if (ip && port) elems.unshift(chalk.cyan(ip) + ":" + chalk.blue(port));

        if (req.headers && req.headers["x-real-port"]) req.realPort = req.headers["x-real-port"];
        if (req.headers && req.headers["x-real-ip"]) req.realIP = req.headers["x-real-ip"];
    }

    if (logLevel > 0)
        elems.unshift("[" + chalk[logColors[logLevel]](logLabels[logLevel]) + "]");

    if (opts && opts.timestamps) elems.unshift(log.timestamp());

    elems.forEach(function (part, index) {
        if (part === "")
            elems.splice(index, 1);
    });

    if (logfd) {
        fs.write(logfd, chalk.stripColor(elems.join(" ")) + "\n");
    } else {
        console.log.apply(console, elems);
    }
};

log.init = function init(o) {
    opts = o;
};

log.setLogFile = function setLogFile(fd) {
    logfd = fd;
};

log.debug = function debug(req, res) {
    if (req && req._events !== undefined) // Try to distinguish between calls containing req/res and calls without them
        log(req, res, 3, Array.prototype.slice.call(arguments, 2).join(""));
    else
        log(null, null, 3, Array.prototype.slice.call(arguments, 0).join(""));
};

log.info = function info(req, res) {
    if (req && req._events !== undefined) // Try to distinguish between calls containing req/res and calls without them
        log(req, res, 2, Array.prototype.slice.call(arguments, 2).join(""));
    else
        log(null, null, 2, Array.prototype.slice.call(arguments, 0).join(""));
};

log.error = function error(err) {
    var output;

    if (err instanceof Error)
        output = err.stack;
    else if (!err)
        output = new Error("Error handler called without an argument").stack + "\nerr = " + err;
    else if (typeof err === "string")
        output = err;
    else
        output = new Error("Unknown error type: " + typeof err).stack + "\nerr = " + err;

    log(null, null, 1, chalk.red(output));
};

log.simple = function simple() {
    if (opts && opts.logLevel < 2) return;
    log(null, null, 0, chalk.magenta("->> ") + Array.prototype.slice.call(arguments, 0).join(""));
};

log.plain = function plain() {
    if (opts && opts.logLevel < 2) return;
    log(null, null, 0, Array.prototype.slice.call(arguments, 0).join(""));
};

log.timestamp = function timestamp() {
    var now   = new Date(),
        day   = now.getDate(),
        month = now.getMonth() + 1,
        year  = now.getFullYear(),
        hrs   = now.getHours(),
        mins  = now.getMinutes(),
        secs  = now.getSeconds();

    if (month < 10) month = "0" + month;
    if (day   < 10) day   = "0" + day;
    if (hrs   < 10) hrs   = "0" + hrs;
    if (mins  < 10) mins  = "0" + mins;
    if (secs  < 10) secs  = "0" + secs;
    return chalk.yellow(year + "-"  + month + "-" + day + " " + hrs + ":" + mins + ":" + secs);
};

log.logo = function logo() {
    log.plain(chalk.blue([
        "     __                              \n",
        "  --|  |---- ----- ----- ----- -- -- \n",
        " |  _  |   _|  _  |  _  |  _  |  |  |\n",
        " |_____|__| |_____|   __|   __|___  |\n",
        "                  |__|  |__|  |_____|\n",
    ].join("")));
};

module.exports = log;
