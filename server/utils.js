"use strict";

var utils    = module.exports = {};
var async    = require("async");
var cd       = require("content-disposition");
var cpr      = require("cpr");
var crypto   = require("crypto");
var dhparam  = require("dhparam");
var ext      = require("file-extension");
var fs       = require("graceful-fs");
var isBin    = require("isbinaryfile");
var mkdirp   = require("mkdirp");
var mv       = require("mv");
var path     = require("path");
var rimraf   = require("rimraf");
var sanitize = require("sanitize-filename");
var util     = require("util");
var ut       = require("untildify");

var db     = require("./db.js");
var log    = require("./log.js");
var paths  = require("./paths.js").get();

var forceBinaryTypes = [
  "pdf",
  "ps",
  "eps",
  "ai"
];

var DHPARAM_BITS = 2048;

// mkdirp wrapper with array support
utils.mkdir = function mkdir(dir, cb) {
  if (Array.isArray(dir)) {
    async.each(dir, function(p, cb) {
      mkdirp(p, {fs: fs, mode: "755"}, cb);
    }, function(err) {
      cb(err);
    });
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
    } catch (e) {
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

      if (!/\-\d+$/.test(filename)) filename += "-1";

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
  return p.replace(/[\\|\/]+/g, "/");
};

utils.addFilesPath = function addFilesPath(p) {
  if (p === "/")
    return paths.files;
  else
    return path.join(paths.files + "/" + p);
};

utils.removeFilesPath = function removeFilesPath(p) {
  if (p.length > paths.files.length)
    return utils.normalizePath(p.substring(paths.files.length));
  else if (p === paths.files)
    return "/";
};

utils.relativeZipPath = function removeFilesPath(p, base) {
  return utils.normalizePath(path.relative(utils.normalizePath(utils.addFilesPath(base)), utils.normalizePath(p)));
};

utils.isPathSane = function isPathSane(p, isURL) {
  if (isURL) {
    if (/[\/\\]\.\./.test(p)) return false;      // Navigating down the tree (prefix)
    if (/\.\.[\/\\]/.test(p)) return false;      // Navigating down the tree (postfix)
    if (/[\*\{\}\|<>"]/.test(p)) return false;   // Invalid characters
    return true;
  } else {
    return p.split(/[\\\/]/gm).every(function(name) {
      return name === sanitize(name);
    });
  }
};

utils.isBinary = function isBinary(path, callback) {
  if (forceBinaryTypes.indexOf(ext(path)) !== -1)
    return callback(null, true);

  isBin(path, function(err, result) {
    if (err) return callback(err);
    callback(null, result);
  });
};

utils.getDispo = function getDispo(fileName) {
  return cd(path.basename(fileName));
};

utils.getSid = function getSid() {
  return crypto.randomBytes(64).toString("base64").substring(0, 48);
};

var cbs = [];
utils.tlsInit = function tlsInit(opts, cb) {
  if (!cbs[opts.index]) {
    cbs[opts.index] = [cb];
    utils.tlsSetup(opts, function(err, tlsData) {
      cbs[opts.index].forEach(function(cb) {
        cb(err, tlsData);
      });
    });
  } else cbs[opts.index].push(cb);
};

utils.tlsSetup = function tlsSetup(opts, cb) {
  opts.honorCipherOrder = true;

  if (typeof opts.key !== "string")
    return cb(new Error("Missing TLS option 'key'"));
  if (typeof opts.cert !== "string")
    return cb(new Error("Missing TLS option 'cert'"));

  var certPaths = [
    path.resolve(paths.config, ut(opts.key)),
    path.resolve(paths.config, ut(opts.cert)),
    opts.ca ? path.resolve(paths.config, opts.ca) : undefined,
    opts.dhparam ? path.resolve(paths.config, opts.dhparam) : undefined
  ];

  async.map(certPaths, readFile, function(_, data) {
    var certStart = "-----BEGIN CERTIFICATE-----";
    var certEnd   = "-----END CERTIFICATE-----";

    var key     = data[0];
    var cert    = data[1];
    var ca      = data[2];
    var dhparam = data[3];

    if (!key)  return cb(new Error("Unable to read TLS key: " + certPaths[0]));
    if (!cert) return cb(new Error("Unable to read TLS certificate: " + certPaths[1]));
    if (opts.ca && !ca) return cb(new Error("Unable to read TLS intermediate certificate: " + certPaths[2]));
    if (opts.dhparam && !dhparam) return cb(new Error("Unable to read TLS DH parameter file: " + certPaths[3]));

    // Split combined certificate and intermediate
    if (!ca && cert.indexOf(certStart) !== cert.lastIndexOf(certStart)) {
      ca   = cert.substring(cert.lastIndexOf(certStart));
      cert = cert.substring(0, cert.indexOf(certEnd) + certEnd.length);
    }

    cb(null, {
      key     : key,
      cert    : cert,
      ca      : ca,
      dhparam : dhparam || db.get("dhparam") || createDH()
    });
  });
};

utils.countOccurences = function countOccurences(string, search) {
  var num = 0, pos = 0;
  while ((pos = string.indexOf(search, pos)) >= 0) {
    num += 1;
    pos += search.length;
  }
  return num;
};

utils.formatBytes = function formatBytes(num) {
  if (num < 1) return num + " B";
  var units = ["B", "kB", "MB", "GB", "TB", "PB"];
  var exp = Math.min(Math.floor(Math.log(num) / Math.log(1000)), units.length - 1);
  return (num / Math.pow(1000, exp)).toPrecision(3) + " " + units[exp];
};

function createDH() {
  log.info("Generating " + DHPARAM_BITS + " bit DH parameters. This will take a long time.");
  var dh = dhparam(DHPARAM_BITS);
  db.set("dhparam", dh);
  return dh;
}

function readFile(p, cb) {
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
}
