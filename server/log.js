"use strict";

var fs        = require("graceful-fs");
var chalk     = require("chalk");
var format    = require("url-format-lax");
var stripAnsi = require("strip-ansi");

var utils     = require("./utils.js");

var logColors = ["reset", "red", "yellow", "cyan"];
var logLabels = ["", "ERROR", "INFO", "DEBG"];
var opts, logfile;

var log = module.exports = function log(req, res, logLevel) {
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

    var ip = utils.ip(req);

    if (ip)
      elems.unshift(log.formatHostPort(ip, utils.port(req) || "0"));
  }

  if (logLevel > 0)
    elems.unshift("[" + chalk[logColors[logLevel]](logLabels[logLevel]) + "]");

  if (opts && opts.timestamps) elems.unshift(log.timestamp());

  elems.forEach(function(part, index) {
    if (part === "")
      elems.splice(index, 1);
  });

  if (logfile) {
    fs.write(logfile, stripAnsi(elems.join(" ")) + "\n");
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
  if (req && (req.headers || req.addr))
    log(req, res, 3, Array.prototype.slice.call(arguments, 2).join(""));
  else
    log(null, null, 3, Array.prototype.slice.call(arguments, 0).join(""));
};

log.info = function info(req, res) {
  if (req && (req.headers || req.addr))
    log(req, res, 2, Array.prototype.slice.call(arguments, 2).join(""));
  else
    log(null, null, 2, Array.prototype.slice.call(arguments, 0).join(""));
};

log.error = function error(err) {
  log(null, null, 1, chalk.red(log.formatError(err)));
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
  return year + "-" + month + "-" + day + " " + hrs + ":" + mins + ":" + secs;
};

log.logo = function logo(line1, line2, line3) {
  log.plain(chalk.blue([
    "\n",
    "           .:.\n",
    `    :::  .:::::.   ${line1}\n`,
    `  ..:::..  :::     ${line2}\n`,
    `   ':::'   :::     ${line3}\n`,
    "     '\n",
  ].join("")));
};

log.formatHostPort = function(host, port, proto) {
  var str = format({hostname: host, port: port});
  host = str.substring(0, str.lastIndexOf(":"));
  port = str.substring(str.lastIndexOf(":") + 1, str.length);

  if (proto === "http" && port === "80" || proto === "https" && port === "443")
    port = "";
  else
    port = chalk.blue(":" + port);

  return chalk.cyan(host) + port;
};

log.formatError = function formatError(err) {
  var output;
  if (err instanceof Error)
    output = err.stack;
  else if (!err)
    output = new Error("Error handler called without an argument").stack + "\nerr = " + err;
  else if (typeof err === "string")
    output = err;
  else
    output = new Error("Unknown error type: " + typeof err).stack + "\nerr = " + err;

  return output.replace(/^Error: /, "");
};
