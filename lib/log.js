"use strict";

var useTimestamp = true,
    color = {
        black   : "\u001b[30m",
        red     : "\u001b[31m",
        green   : "\u001b[32m",
        yellow  : "\u001b[33m",
        blue    : "\u001b[34m",
        magenta : "\u001b[35m",
        cyan    : "\u001b[36m",
        white   : "\u001b[37m",
        reset   : "\u001b[0m"
    },
    highlights = {
        connected     : color.green,
        disconnected  : color.red,
        authenticated : color.green,
        unauthorized  : color.red,
        timestamp     : color.yellow
    },
    logo = [
        "....__..............................\n",
        ".--|  |----.-----.-----.-----.--.--.\n",
        "|  _  |   _|  _  |  _  |  _  |  |  |\n",
        "|_____|__| |_____|   __|   __|___  |\n",
        ".................|__|..|__|..|_____|\n",
    ].join("").replace(/\./gm,  color.black  + "." + color.reset)
              .replace(/\_/gm,  color.yellow + "_" + color.reset)
              .replace(/\-/gm,  color.yellow + "-" + color.reset)
              .replace(/\|/gm,  color.yellow + "|" + color.reset),
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
        if (typeof args[i] === "number" && [200, 301, 304, 307, 401, 404, 405, 500].indexOf(args[i]) > -1) {
            switch (argStr.charAt(0)) {
            case "2":
                argStr = "[" + color.green + argStr + color.reset + "]";
                break;
            case "3":
                argStr = "[" + color.yellow + argStr + color.reset + "]";
                break;
            case "4":
            case "5":
                argStr = "[" + color.red + argStr + color.reset + "]";
                break;
            }
        } else if (argStr === "GET" || argStr === "POST") {
            argStr = color.yellow + argStr + color.reset;
        } else if (highlights[argStr]) {
            argStr = "[" + highlights[argStr] + argStr + color.reset + "]";
        }
        args[i] = argStr;
    }
    args.push(color.reset);
    console.log(args.join(""));
}

function response(req, res) {
    log(
        color.cyan, req.socket.remoteAddress, color.reset, ":",
        color.magenta, req.socket.remotePort, color.reset, " ",
        req.method.toUpperCase(), " ", decodeURIComponent(req.url), " ", res.statusCode
    );
}

function error(err) {
    if (err.stack) {
        error(String(err.stack));
    } else if (err.message) {
        error(String(err.message));
    } else {
        var args = Array.prototype.slice.call(arguments, 0);
        args.unshift(color.red);
        args.push(color.reset);
        console.error(args.join(""));
    }
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

    return highlights.timestamp + year + "-"  + month + "-" + day + " " + hrs + ":" + mins + ":" + secs + " " + color.reset;
}

function socket(ip, port) {
    return [color.cyan, ip, color.reset, ":", color.magenta, port, color.reset].join("");
}

Object.defineProperties(exports, {
    color        : { value: color },
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