"use strict";

var utils    = module.exports = {};
var async    = require("async");
var cd       = require("content-disposition");
var cpr      = require("cpr");
var crypto   = require("crypto");
var escRe    = require("escape-string-regexp");
var ext      = require("file-extension");
var fs       = require("graceful-fs");
var isBin    = require("isbinaryfile");
var mimetype = require("mime-types").lookup;
var mkdirp   = require("mkdirp");
var mv       = require("mv");
var path     = require("path");
var rimraf   = require("rimraf");
var util     = require("util");
var validate = require("valid-filename");

var paths  = require("./paths.js").get();
var log    = require("./log.js");

var forceBinaryTypes = [
  "pdf",
  "ps",
  "eps",
  "ai",
];

var overrideMimeTypes = {
  "video/x-matroska": "video/webm",
};

// mkdirp wrapper with array support
utils.mkdir = function mkdir(dir, cb) {
  if (Array.isArray(dir)) {
    async.each(dir, function(p, cb) {
      mkdirp(p, {fs: fs, mode: "755"}, cb);
    }, cb);
  } else if (typeof dir === "string") {
    mkdirp(dir, {fs: fs, mode: "755"}, cb);
  } else {
    cb(new Error("mkdir: Wrong dir type: " + typeof dir));
  }
};

// rimraf wrapper with 10 retries
utils.rm = function rm(p, cb) {
  rimraf(p, {maxBusyTries: 10, glob: {dot: true}}, cb);
};

// rimraf.sync wrapper with 10 retries
utils.rmSync = function rmSync(p) {
  var tries = 10;
  (function run() {
    try {
      rimraf.sync(p, {glob: {dot: true}});
    } catch (err) {
      if (tries-- > 0) run();
    }
  })();
};

utils.move = function move(src, dst, cb) {
  mv(src, dst, function(err) {
    if (cb) cb(err);
  });
};

utils.copyFile = function copyFile(src, dst, cb) {
  var cbCalled = false;
  var read     = fs.createReadStream(src);
  var write    = fs.createWriteStream(dst);

  function done(err) {
    if (cbCalled) return;
    cbCalled = true;
    if (cb) cb(err);
  }

  read.on("error", done);
  write.on("error", done);
  write.on("close", done);
  read.pipe(write);
};

utils.copyDir = function copyDir(src, dst, cb) {
  cpr(src, dst, {overwrite: true}, function(errs) {
    if (errs) log.error(errs);
    if (cb) cb();
  });
};

// Valid link character, the characters "l", "1", "i", "o", "0" characters are skipped
// for easier communication of links.
utils.linkChars = "abcdefghjkmnpqrstuvwxyz23456789";

// Get a pseudo-random n-character lowercase string.
utils.getLink = function getLink(links, length) {
  var link = "";
  do {
    while (link.length < length) {
      link += utils.linkChars.charAt(Math.floor(Math.random() * utils.linkChars.length));
    }
  } while (links[link]); // In case the RNG generates an existing link, go again

  return link;
};

utils.pretty = function pretty(data) {
  return util.inspect(data, {colors: true})
    .replace(/^\s+/gm, " ").replace(/\s+$/gm, "")
    .replace(/[\r\n]+/gm, "");
};

utils.getNewPath = function getNewPath(origPath, callback) {
  fs.stat(origPath, function(err, stats) {
    if (err) callback(origPath);
    else {
      var filename  = path.basename(origPath);
      var dirname   = path.dirname(origPath);
      var extension = "";

      if (filename.indexOf(".") !== -1 && stats.isFile()) {
        extension = filename.substring(filename.lastIndexOf("."));
        filename  = filename.substring(0, filename.lastIndexOf("."));
      }

      if (!/-\d+$/.test(filename)) filename += "-1";

      var canCreate = false;
      async.until(
        function() {
          return canCreate;
        },
        function(cb) {
          var num = parseInt(filename.substring(filename.lastIndexOf("-") + 1));
          filename = filename.substring(0, filename.lastIndexOf("-") + 1) + (num + 1);
          fs.stat(path.join(dirname, filename + extension), function(err) {
            canCreate = err;
            cb();
          });
        },
        function() {
          callback(path.join(dirname, filename + extension));
        }
      );
    }
  });
};

utils.normalizePath = function normalizePath(p) {
  return p.replace(/[\\|/]+/g, "/");
};

utils.addFilesPath = function addFilesPath(p) {
  return p === "/" ? paths.files : path.join(paths.files + "/" + p);
};

utils.removeFilesPath = function removeFilesPath(p) {
  if (p.length > paths.files.length)
    return utils.normalizePath(p.substring(paths.files.length));
  else if (p === paths.files)
    return "/";
};

utils.isPathSane = function isPathSane(p, isURL) {
  if (isURL) {
    if (/[/\\]\.\./.test(p)) return false;      // Navigating down the tree (prefix)
    if (/\.\.[/\\]/.test(p)) return false;      // Navigating down the tree (postfix)
    if (/[*{}|<>"]/.test(p)) return false;   // Invalid characters
    return true;
  } else {
    return p.split(/[\\/]/gm).every(function(name) {
      if (!name) return true;
      return validate(name);
    });
  }
};

utils.isBinary = function isBinary(p, callback) {
  if (forceBinaryTypes.indexOf(ext(p)) !== -1)
    return callback(null, true);

  isBin(p, function(err, result) {
    if (err) return callback(err);
    callback(null, result);
  });
};

// TODO async/await this in Node.js 8.0
utils.mime = function mime(p) {
  var mimeType = mimetype(p);
  if (overrideMimeTypes[mimeType]) return overrideMimeTypes[mimeType];
  if (mimeType) return mimeType;
  try {
    return isBin.sync(p) ? "application/octet-stream" : "text/plain; charset=utf-8";
  } catch (err) {
    return "application/octet-stream";
  }
};

utils.getDispo = function getDispo(fileName) {
  return cd(path.basename(fileName));
};

utils.createSid = function createSid() {
  return crypto.randomBytes(64).toString("base64").substring(0, 48);
};

utils.readJsonBody = function readJsonBody(req) {
  return new Promise(function(resolve, reject) {
    var body = [];
    req.on("data", function(chunk) {
      body.push(chunk);
    }).on("end", function() {
      body = String(Buffer.concat(body));
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
  });
};

utils.countOccurences = function countOccurences(string, search) {
  var num = 0, pos = 0;
  while (true) {
    pos = string.indexOf(search, pos);
    if (pos >= 0) {
      num += 1;
      pos += search.length;
    } else break;
  }
  return num;
};

utils.formatBytes = function formatBytes(num) {
  if (num < 1) return num + " B";
  var units = ["B", "kB", "MB", "GB", "TB", "PB"];
  var exp = Math.min(Math.floor(Math.log(num) / Math.log(1000)), units.length - 1);
  return (num / Math.pow(1000, exp)).toPrecision(3) + " " + units[exp];
};

// TODO: https://tools.ietf.org/html/rfc7239
utils.ip = function ip(req) {
  return req.headers && req.headers["x-forwarded-for"] &&
      req.headers["x-forwarded-for"].split(",")[0].trim() ||
    req.headers && req.headers["x-real-ip"] ||
    req.connection && req.connection.remoteAddress ||
    req.connection && req.connection.socket && req.connection.socket.remoteAddress ||
    req.addr || // custom cached property
    req.remoteAddress && req.remoteAddress;
};

utils.port = function port(req) {
  return req.headers && req.headers["x-real-port"] ||
    req.connection && req.connection.remotePort ||
    req.connection && req.connection.socket && req.connection.socket.remotePort ||
    req.port || // custom cached property
    req.remotePort && req.remotePort;
};

utils.naturalSort = function naturalSort(a, b) {
  var x = [], y = [];
  function strcmp(a, b) { return a > b ? 1 : a < b ? -1 : 0; }
  a.replace(/(\d+)|(\D+)/g, function(_, a, b) { x.push([a || 0, b]); });
  b.replace(/(\d+)|(\D+)/g, function(_, a, b) { y.push([a || 0, b]); });
  while (x.length && y.length) {
    var xx = x.shift();
    var yy = y.shift();
    var nn = (xx[0] - yy[0]) || strcmp(xx[1], yy[1]);
    if (nn) return nn;
  }
  if (x.length) return -1;
  if (y.length) return 1;
  return 0;
};

utils.extensionRe = function extensionRe(arr) {
  arr = arr.map(function(ext) {
    return escRe(ext);
  });
  return RegExp("\\.(" + arr.join("|") + ")$", "i");
};

utils.readFile = function(p, cb) {
  if (typeof p !== "string") return cb(null);
  fs.stat(p, function(_, stats) {
    if (stats && stats.isFile()) {
      fs.readFile(p, function(err, data) {
        if (err) return cb(err);
        cb(null, String(data));
      });
    } else {
      cb(null);
    }
  });
};
