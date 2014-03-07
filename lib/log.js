/*jslint evil: true, expr: true, regexdash: true, bitwise: true, trailing: false, sub: true, eqeqeq: true,
  forin: true, freeze: true, loopfunc: true, laxcomma: true, indent: false, white: true, nonew: true, newcap: true,
  undef: true, unused: true, globalstrict: true, node: true */
"use strict";

var chalk = require("chalk"),
    useTimestamp = true,
    highlights = {
        connected     : chalk.green,
        disconnected  : chalk.red,
        authenticated : chalk.green,
        unauthorized  : chalk.red,
        timestamp     : chalk.yellow
    },
    logo = [
        "....__..............................\n",
        ".--|  |----.-----.-----.-----.--.--.\n",
        "|  _  |   _|  _  |  _  |  _  |  |  |\n",
        "|_____|__| |_____|   __|   __|___  |\n",
        ".................|__|..|__|..|_____|\n",
    ].join("").replace(/\./gm, chalk.black("."))
              .replace(/\_/gm, chalk.yellow("_"))
              .replace(/\-/gm, chalk.yellow("-"))
              .replace(/\|/gm, chalk.yellow("|")),
    usage = [
        "Usage: node droppy [version|list|add|del] {arguments}",
        "",
        "Options:",
        "  version                     Print the version.",
        "  list                        List active users.",
        "  add <username> <password>   Create a new user.",
        "  del <username>              Delete a user.",
    ].join("\n");

function log() {
    var args = Array.prototype.slice.call(arguments, 0);
    if (useTimestamp) args.unshift(timestamp());
    for (var i = 1, len = args.length; i < len; i++) {
        var argStr = String(args[i]);
        if (typeof args[i] === "number" && [200, 202, 301, 304, 307, 401, 404, 405, 500].indexOf(args[i]) > -1) {
            switch (argStr.charAt(0)) {
            case "2":
                argStr = "[" + chalk.green(argStr) + "]";
                break;
            case "3":
                argStr = "[" + chalk.yellow(argStr) + "]";
                break;
            case "4":
            case "5":
                argStr = "[" + chalk.red(argStr) + "]";
                break;
            }
        } else if (argStr === "GET" || argStr === "POST") {
            argStr = chalk.yellow(argStr);
        } else if (highlights[argStr]) {
            argStr = "[" + highlights[argStr](argStr) + "]";
        }
        args[i] = argStr;
    }
    console.log(args.join(""));
}

function response(req, res) {
    var responseTime = "", ip, port;
    if (req.time)
        responseTime = "[" +  chalk.magenta((Date.now() - req.time) + "ms") + "]";

    ip = req.headers["x-real-ip"] || req.socket.remoteAddress;
    port = req.headers["x-real-port"] || req.socket.remotePort;

    log(chalk.cyan(ip), ":", chalk.blue(port), " ", req.method.toUpperCase(), " ",
        decodeURIComponent(req.url), " ", res.statusCode, " ", responseTime);
}

function socket(ip, port) {
    return chalk.cyan(ip) + ":" + chalk.blue(port);
}

function error(err) {
    if (err === undefined) console.log(chalk.red("Error handler called without an argument"));
    if (err.message) error(String(err.message));
    if (err.stack) error(String(err.stack));
    if (!err.message && !err.stack) console.log(chalk.red(err));
}

function simple() {
    var args = Array.prototype.slice.call(arguments, 0);
    console.log(args.join(""));
}

function timestamp() {
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
    return highlights.timestamp(year + "-"  + month + "-" + day + " " + hrs + ":" + mins + ":" + secs + " ");
}

Object.defineProperties(exports, {
    error        : { value: error },
    log          : { value: log },
    logo         : { value: logo },
    response     : { value: response },
    simple       : { value: simple },
    socket       : { value: socket },
    timestamp    : { value: timestamp },
    usage        : { value: usage },
    useTimestamp : {
        get: function () {
            return useTimestamp;
        },
        set: function (value) {
            useTimestamp = value;
        }
    }
});
