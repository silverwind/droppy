"use strict";

var utils  = {};

var async    = require("async");
var cd       = require("content-disposition");
var cpr      = require("cpr");
var crypto   = require("crypto");
var ext      = require("file-extension");
var fs       = require("graceful-fs");
var isBin    = require("isbinaryfile");
var mkdirp   = require("mkdirp");
var mv       = require("mv");
var path     = require("path");
var pem      = require("pem");
var rimraf   = require("rimraf");
var sanitize = require("sanitize-filename");
var util     = require("util");

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
var CERT_DAYS = 365;

// mkdirp wrapper with array support
utils.mkdir = function mkdir(dir, cb) {
  if (Array.isArray(dir)) {
    async.each(dir, function (p, cb) {
      mkdirp(p, {fs: fs, mode: "755"}, cb);
    }, function (err) {
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
  rimraf(p, {maxBusyTries: 10}, cb);
};

// rimraf.sync wrapper with 10 retries
utils.rmSync = function rmSync(p) {
  var tries = 10;
  (function run() {
    try {
      rimraf.sync(p);
    } catch(e) {
      if (tries-- > 0) run();
    }
  })();
};

utils.move = function move(src, dst, cb) {
  mv(src, dst, function (err) {
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
  cpr(src, dst, {overwrite: true}, function (errs) {
    if (errs) log.error(errs);
    if (cb) cb();
  });
};

// Get a pseudo-random n-character lowercase string. The characters
// "l", "1", "i", "o", "0" characters are skipped for easier communication of links.
utils.getLink = function getLink(links, length) {
  var chars = "abcdefghjkmnpqrstuvwxyz23456789", link = "";
  do {
    while (link.length < length) {
      link += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (links[link]); // In case the RNG generates an existing link, go again

  return link;
};

utils.pretty = function pretty(data) {
  return util.inspect(data, {colors: true}).replace(/\s+/gm, "");
};

utils.getNewPath = function getNewPath(origPath, callback) {
  fs.stat(origPath, function (err, stats) {
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
        function () {
          return canCreate;
        },
        function (cb) {
          var num = parseInt(filename.substring(filename.lastIndexOf("-") + 1), 10);
          filename = filename.substring(0, filename.lastIndexOf("-") + 1) + (num + 1);
          fs.stat(path.join(dirname, filename + extension), function (err) {
            canCreate = err;
            cb();
          });
        },
        function () {
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
  return path.join(paths.files + "/" + p);
};

utils.removeFilesPath = function removeFilesPath(p) {
  return utils.normalizePath("/" + path.relative(paths.files, p));
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
    return p.split(/[\\\/]/gm).every(function (name) {
      return name === sanitize(name);
    });
  }
};

utils.isBinary = function isBinary(path, callback) {
  if (forceBinaryTypes.indexOf(ext(path)) !== -1)
    return callback(null, true);

  isBin(path, function (err, result) {
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
    utils.tlsSetup(opts, function (err, tlsData) {
      cbs[opts.index].forEach(function (cb) {
        cb(err, tlsData);
      });
    });
  } else cbs[opts.index].push(cb);
};

utils.tlsSetup = function tlsSetup(opts, callback) {
  opts.honorCipherOrder = true;

  // Slightly more secure options for 0.10.x
  if (/^v0\.10/.test(process.version)) {
    opts.ciphers = "ECDHE-RSA-AES256-SHA:AES256-SHA:RC4-SHA:RC4:HIGH:!MD5:!aNULL:!EDH:!AESGCM";
  } else {
    opts.ciphers = "ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:" +
      "ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-SHA256:" +
      "DHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:ECDHE-RSA-AES256-SHA256:" +
      "DHE-RSA-AES256-SHA256:HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA";
  }

  if (typeof opts.key === "string" && typeof opts.cert === "string") {
    var certPaths = [
      path.resolve(paths.config, opts.key),
      path.resolve(paths.config, opts.cert),
      opts.ca ? path.resolve(paths.config, opts.ca) : undefined,
      opts.dhparam ? path.resolve(paths.config, opts.dhparam) : undefined
    ];

    async.map(certPaths, readFile, function (_, data) {
      var certStart = "-----BEGIN CERTIFICATE-----";
      var certEnd   = "-----END CERTIFICATE-----";

      var key     = data[0];
      var cert    = data[1];
      var ca      = data[2];
      var dhparam = data[3];

      if (!key)  return callback(new Error("Unable to read TLS key: " + certPaths[0]));
      if (!cert) return callback(new Error("Unable to read TLS certificate: " + certPaths[1]));
      if (opts.ca && !ca) return callback(new Error("Unable to read TLS intermediate certificate: " + certPaths[2]));
      if (opts.dhparam && !dhparam) return callback(new Error("Unable to read TLS DH parameter file: " + certPaths[3]));

      var finish = function finish(dhparam) {
        // Split combined certificate and intermediate
        if (!ca && cert.indexOf(certStart) !== cert.lastIndexOf(certStart)) {
          ca   = cert.substring(cert.lastIndexOf(certStart));
          cert = cert.substring(0, cert.indexOf(certEnd) + certEnd.length);
        }

        callback(null, {
          selfsigned : false,
          key        : key,
          cert       : cert,
          ca         : ca,
          dhparam    : dhparam
        });
      };

      if (dhparam) {
        pem.getDhparamInfo(dhparam, function (err, info) {
          if (err) return callback(err);
          if (info.size < 1024) {
            log.simple("DH parameters key too short, regenerating");
            createDH(function (err, dh) {
              if (err) return callback(err);
              finish(dh);
            });
          } else {
            finish(dhparam);
          }
        });
      } else {
        var saved = db.get("dhparam");
        if (saved) return finish(saved);

        createDH(function (err, dhparam) {
          if (err) return callback(err);
          finish(dhparam);
        });
      }
    });
  } else { // Use self-signed certs
    pem.createCertificate({days: CERT_DAYS, selfSigned: true}, function (err, keys) {
      if (err) return callback(err);
      var data = {
        selfsigned : true,
        key        : keys.serviceKey,
        cert       : keys.certificate,
        dhparam    : db.get("dhparam")
      };
      if (data.dhparam) {
        pem.getDhparamInfo(data.dhparam, function (err, info) {
          if (err) return callback(err);
          if (info.size < 1024) {
            log.simple("DH parameters key too short, regenerating");
            createDH(function (err, dhparam) {
              if (err) return callback(err);
              data.dhparam = dhparam;
              callback(null, data);
            });
          } else {
            callback(null, data);
          }
        });
      } else {
        createDH(function (err, dhparam) {
          if (err) return callback(err);
          data.dhparam = dhparam;
          callback(null, data);
        });
      }
    });
  }
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

function createDH(cb) {
  log.simple("Generating " + DHPARAM_BITS + " bit DH parameters. This will take a long time.");
  pem.createDhparam(DHPARAM_BITS, function (err, result) {
    if (err) return cb(err);
    db.set("dhparam", result.dhparam);
    cb(null, result.dhparam);
  });
}

function readFile(p, cb) {
  if (typeof p !== "string") return cb(null);

  fs.stat(p, function (_, stats) {
    if (stats && stats.isFile()) {
      fs.readFile(p, function (err, data) {
        if (err) return cb(err);
        cb(null, String(data));
      });
    } else {
      cb(null);
    }
  });
}

module.exports = utils;
