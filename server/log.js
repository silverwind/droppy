"use strict";

var opts, logfile;

var fs     = require("graceful-fs");
var chalk  = require("chalk");
var format = require("url-format-lax");

var logColors = ["reset", "red", "yellow", "cyan"];
var logLabels = ["", "ERROR", "INFO", "DEBG"];

var log = function log(req, res, logLevel) {
  if (opts && opts.logLevel < logLevel) return;
  var elems = Array.prototype.slice.call(arguments, 3), statusCode;

  if (req && req.time) elems.unshift("[" + chalk.magenta((Date.now() - req.time) + "ms") + "]");

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

    var port =
      req.headers && req.headers["x-forwarded-port"] ||
      req.headers && req.headers["x-real-port"] ||
      req.upgradeReq && req.upgradeReq.headers && req.upgradeReq.headers["x-forwarded-port"] ||
      req.upgradeReq && req.upgradeReq.headers && req.upgradeReq.headers["x-real-port"] ||
      req._socket && req._socket.remotePort && req._socket.remotePort ||
      req.connection && req.connection.remotePort ||
      req.connection && req.connection.socket && req.connection.socket.remotePort;

    var ip =
      req.headers && req.headers["x-forwarded-for"] ||
      req.headers && req.headers["x-real-ip"] ||
      req.upgradeReq && req.upgradeReq.headers && req.upgradeReq.headers["x-forwarded-for"] ||
      req.upgradeReq && req.upgradeReq.headers && req.upgradeReq.headers["x-real-ip"] ||
      req._socket && req._socket.remoteAddress && req._socket.remoteAddress ||
      req.connection && req.connection.remoteAddress ||
      req.connection && req.connection.socket && req.connection.socket.remoteAddress;

    if (ip && port) elems.unshift(log.formatHostPort(ip, port));
  }

  if (logLevel > 0)
    elems.unshift("[" + chalk[logColors[logLevel]](logLabels[logLevel]) + "]");

  if (opts && opts.timestamps) elems.unshift(log.timestamp());

  elems.forEach(function (part, index) {
    if (part === "")
      elems.splice(index, 1);
  });

  if (logfile) {
    fs.write(logfile, chalk.stripColor(elems.join(" ")) + "\n");
  } else {
    console.log.apply(console, elems);
  }
};

log.init = function init(o) {
  opts = o;
};

log.setLogFile = function setLogFile(fd) {
  logfile = fd;
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
  var now   = new Date();
  var day   = now.getDate();
  var month = now.getMonth() + 1;
  var year  = now.getFullYear();
  var hrs   = now.getHours();
  var mins  = now.getMinutes();
  var secs  = now.getSeconds();

  if (month < 10) month = "0" + month;
  if (day   < 10) day   = "0" + day;
  if (hrs   < 10) hrs   = "0" + hrs;
  if (mins  < 10) mins  = "0" + mins;
  if (secs  < 10) secs  = "0" + secs;
  return chalk.yellow(year + "-" + month + "-" + day + " " + hrs + ":" + mins + ":" + secs);
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

log.formatHostPort = function formatHostPort(host, port) {
  var str = format({hostname: host, port: port});
  host = str.substring(0, str.lastIndexOf(":"));
  port = str.substring(str.lastIndexOf(":") + 1, str.length);
  return chalk.cyan(host) + ":" + chalk.blue(port);
};

module.exports = log;
