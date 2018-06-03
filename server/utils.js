"use strict";

const utils     = module.exports = {};
const async     = require("async");
const cd        = require("content-disposition");
const cpr       = require("cpr");
const crypto    = require("crypto");
const escRe     = require("escape-string-regexp");
const ext       = require("file-extension");
const fs        = require("graceful-fs");
const isBin     = require("isbinaryfile");
const mimeTypes = require("mime-types");
const mkdirp    = require("mkdirp");
const mv        = require("mv");
const path      = require("path");
const rimraf    = require("rimraf");
const util      = require("util");
const validate  = require("valid-filename");

const paths  = require("./paths.js").get();
const log    = require("./log.js");

const forceBinaryTypes = [
  "pdf",
  "ps",
  "eps",
  "ai",
];

const overrideMimeTypes = {
  "video/x-matroska": "video/webm",
};

// mkdirp wrapper with array support
utils.mkdir = function(dir, cb) {
  if (Array.isArray(dir)) {
    async.each(dir, (p, cb) => {
      mkdirp(p, {fs: fs, mode: "755"}, cb);
    }, cb);
  } else if (typeof dir === "string") {
    mkdirp(dir, {fs: fs, mode: "755"}, cb);
  } else {
    cb(new Error("mkdir: Wrong dir type: " + typeof dir));
  }
};

// rimraf wrapper with 10 retries
utils.rm = function(p, cb) {
  rimraf(p, {maxBusyTries: 10, glob: {dot: true}}, cb);
};

// rimraf.sync wrapper with 10 retries
utils.rmSync = function(p) {
  let tries = 10;
  (function run() {
    try {
      rimraf.sync(p, {glob: {dot: true}});
    } catch (err) {
      if (tries-- > 0) run();
    }
  })();
};

utils.move = function(src, dst, cb) {
  mv(src, dst, err => {
    if (cb) cb(err);
  });
};

utils.copyFile = function(src, dst, cb) {
  let cbCalled = false;
  const read     = fs.createReadStream(src);
  const write    = fs.createWriteStream(dst);

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

utils.copyDir = function(src, dst, cb) {
  cpr(src, dst, {overwrite: true}, errs => {
    if (errs) log.error(errs);
    if (cb) cb();
  });
};

// Valid link character, the characters "l", "1", "i", "o", "0" characters are skipped
// for easier communication of links.
utils.linkChars = "abcdefghjkmnpqrstuvwxyz23456789";

// Get a pseudo-random n-character lowercase string.
utils.getLink = function(links, length) {
  let link = "";
  do {
    while (link.length < length) {
      link += utils.linkChars.charAt(Math.floor(Math.random() * utils.linkChars.length));
    }
  } while (links[link]); // In case the RNG generates an existing link, go again

  return link;
};

utils.pretty = function(data) {
  return util.inspect(data, {colors: true})
    .replace(/^\s+/gm, " ").replace(/\s+$/gm, "")
    .replace(/[\r\n]+/gm, "");
};

utils.getNewPath = function(origPath, callback) {
  fs.stat(origPath, (err, stats) => {
    if (err) callback(origPath);
    else {
      let filename  = path.basename(origPath);
      const dirname   = path.dirname(origPath);
      let extension = "";

      if (filename.indexOf(".") !== -1 && stats.isFile()) {
        extension = filename.substring(filename.lastIndexOf("."));
        filename = filename.substring(0, filename.lastIndexOf("."));
      }

      if (!/-\d+$/.test(filename)) filename += "-1";

      let canCreate = false;
      async.until(
        () => {
          return canCreate;
        },
        cb => {
          const num = parseInt(filename.substring(filename.lastIndexOf("-") + 1));
          filename = filename.substring(0, filename.lastIndexOf("-") + 1) + (num + 1);
          fs.stat(path.join(dirname, filename + extension), err => {
            canCreate = err;
            cb();
          });
        },
        () => {
          callback(path.join(dirname, filename + extension));
        }
      );
    }
  });
};

utils.normalizePath = function(p) {
  return p.replace(/[\\|/]+/g, "/");
};

utils.addFilesPath = function(p) {
  return p === "/" ? paths.files : path.join(paths.files + "/" + p);
};

utils.removeFilesPath = function(p) {
  if (p.length > paths.files.length) {
    return utils.normalizePath(p.substring(paths.files.length));
  } else if (p === paths.files) {
    return "/";
  }
};

utils.isPathSane = function(p, isURL) {
  if (isURL) {
    // Navigating up/down the tree
    if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(p)) {
      return false;
    }
    // Invalid URL path characters
    if (!/^[a-zA-Z0-9-._~:/?#[\]@!$&'()*+,;=%]+$/.test(p)) {
      return false;
    }
    return true;
  } else {
    return p.split(/[\\/]/gm).every(name => {
      if (name === "." || name === "..") return false;
      if (!name) return true;
      return validate(name); // will reject invalid filenames on Windows
    });
  }
};

utils.isBinary = function(p, callback) {
  if (forceBinaryTypes.indexOf(ext(p)) !== -1) {
    return callback(null, true);
  }

  isBin(p, (err, result) => {
    if (err) return callback(err);
    callback(null, result);
  });
};

// TODO async/await this in Node.js 8
utils.contentType = function(p) {
  const type = mimeTypes.lookup(p);
  if (overrideMimeTypes[type]) return overrideMimeTypes[type];

  if (type) {
    const charset = mimeTypes.charsets.lookup(type);
    return type + (charset ? "; charset=" + charset : "");
  } else {
    try {
      return isBin.sync(p) ? "application/octet-stream" : "text/plain";
    } catch (err) {
      return "application/octet-stream";
    }
  }
};

utils.getDispo = function(fileName, inline) {
  return cd(path.basename(fileName), {type: inline ? "inline" : "attachment"});
};

utils.createSid = function() {
  return crypto.randomBytes(64).toString("base64").substring(0, 48);
};

utils.readJsonBody = function(req) {
  return new Promise(((resolve, reject) => {
    let body = [];
    req.on("data", chunk => {
      body.push(chunk);
    }).on("end", () => {
      body = String(Buffer.concat(body));
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
  }));
};

utils.countOccurences = function(string, search) {
  let num = 0, pos = 0;
  while (true) {
    pos = string.indexOf(search, pos);
    if (pos >= 0) {
      num += 1;
      pos += search.length;
    } else break;
  }
  return num;
};

utils.formatBytes = function(num) {
  if (num < 1) return num + " B";
  const units = ["B", "kB", "MB", "GB", "TB", "PB"];
  const exp = Math.min(Math.floor(Math.log(num) / Math.log(1000)), units.length - 1);
  return (num / Math.pow(1000, exp)).toPrecision(3) + " " + units[exp];
};

// TODO: https://tools.ietf.org/html/rfc7239
utils.ip = function(req) {
  return req.headers && req.headers["x-forwarded-for"] &&
      req.headers["x-forwarded-for"].split(",")[0].trim() ||
    req.headers && req.headers["x-real-ip"] ||
    req.connection && req.connection.remoteAddress ||
    req.connection && req.connection.socket && req.connection.socket.remoteAddress ||
    req.addr || // custom cached property
    req.remoteAddress && req.remoteAddress;
};

utils.port = function(req) {
  return req.headers && req.headers["x-real-port"] ||
    req.connection && req.connection.remotePort ||
    req.connection && req.connection.socket && req.connection.socket.remotePort ||
    req.port || // custom cached property
    req.remotePort && req.remotePort;
};

utils.naturalSort = function(a, b) {
  const x = [], y = [];
  function strcmp(a, b) { return a > b ? 1 : a < b ? -1 : 0; }
  a.replace(/(\d+)|(\D+)/g, (_, a, b) => { x.push([a || 0, b]); });
  b.replace(/(\d+)|(\D+)/g, (_, a, b) => { y.push([a || 0, b]); });
  while (x.length && y.length) {
    const xx = x.shift();
    const yy = y.shift();
    const nn = (xx[0] - yy[0]) || strcmp(xx[1], yy[1]);
    if (nn) return nn;
  }
  if (x.length) return -1;
  if (y.length) return 1;
  return 0;
};

utils.extensionRe = function(arr) {
  arr = arr.map(ext => {
    return escRe(ext);
  });
  return RegExp("\\.(" + arr.join("|") + ")$", "i");
};

utils.readFile = function(p, cb) {
  if (typeof p !== "string") return cb(null);
  fs.stat(p, (_, stats) => {
    if (stats && stats.isFile()) {
      fs.readFile(p, (err, data) => {
        if (err) return cb(err);
        cb(null, String(data));
      });
    } else {
      cb(null);
    }
  });
};

utils.arrify = function(val) {
  return Array.isArray(val) ? val : [val];
};
