"use strict";

const fs        = require("graceful-fs");
const chalk     = require("chalk");
const format    = require("url-format-lax");
const stripAnsi = require("strip-ansi");

const utils     = require("./utils.js");

const logColors = ["reset", "red", "yellow", "cyan"];
const logLabels = ["", "ERROR", "INFO", "DEBG"];
let opts, logfile;

const log = module.exports = function(req, res, logLevel, ...elems) {
  if (opts && opts.logLevel < logLevel) return;
  let statusCode;

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

    const ip = utils.ip(req);

    if (ip) {
      elems.unshift(log.formatHostPort(ip, utils.port(req) || "0"));
    }
  }

  if (logLevel > 0) {
    elems.unshift("[" + chalk[logColors[logLevel]](logLabels[logLevel]) + "]");
  }

  if (opts && opts.timestamps) {
    elems.unshift(log.timestamp());
  }

  elems.forEach((part, index) => {
    if (part === "") {
      elems.splice(index, 1);
    }
  });

  if (logfile) {
    fs.write(logfile, stripAnsi(elems.join(" ")) + "\n");
  } else {
    console.info(...elems);
  }
};

log.init = function(o) {
  opts = o;
};

log.setLogFile = function(fd) {
  logfile = fd;
};

log.debug = function(...args) {
  const [req, res, ...elems] = args;
  if (req && (req.headers || req.addr)) {
    log(req, res, 3, elems.join(""));
  } else {
    log(null, null, 3, args.join(""));
  }
};

log.info = function(...args) {
  const [req, res, ...elems] = args;
  if (req && (req.headers || req.addr)) {
    log(req, res, 2, elems.join(""));
  } else {
    log(null, null, 2, args.join(""));
  }
};

log.error = function(...args) {
  log(null, null, 1, chalk.red(log.formatError(args.length === 1 ? args[0] : args.join(" "))));
};

log.plain = function(...args) {
  if (opts && opts.logLevel < 2) return;
  log(null, null, 0, args.join(""));
};

log.timestamp = function() {
  const now = new Date();
  let day = now.getDate();
  let month = now.getMonth() + 1;
  const year = now.getFullYear();
  let hrs = now.getHours();
  let mins = now.getMinutes();
  let secs = now.getSeconds();

  if (month < 10) month = "0" + month;
  if (day < 10) day = "0" + day;
  if (hrs < 10) hrs = "0" + hrs;
  if (mins < 10) mins = "0" + mins;
  if (secs < 10) secs = "0" + secs;
  return year + "-" + month + "-" + day + " " + hrs + ":" + mins + ":" + secs;
};

log.logo = function(line1, line2, line3) {
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
  const str = format({hostname: host, port: port});
  host = str.substring(0, str.lastIndexOf(":"));
  port = str.substring(str.lastIndexOf(":") + 1, str.length);

  if (proto === "http" && port === "80" || proto === "https" && port === "443") {
    port = "";
  } else {
    port = chalk.blue(":" + port);
  }

  return chalk.cyan(host) + port;
};

log.formatError = function(err) {
  let output;
  if (err instanceof Error) {
    output = err.stack;
  } else if (!err) {
    output = new Error("Error handler called without an argument").stack + "\nerr = " + err;
  } else if (typeof err === "string") {
    output = err;
  } else {
    output = err + "\n" + (new Error()).stack;
  }

  return output.replace(/^Error: /, "");
};
