"use strict";

const utils = module.exports = {};
const cd = require("content-disposition");
const crypto = require("crypto");
const escapeStringRegexp = require("escape-string-regexp");
const ext = require("file-extension");
const fs = require("fs");
const isbinaryfile = require("isbinaryfile");
const mimeTypes = require("mime-types");
const mv = require("mv");
const path = require("path");
const util = require("util");
const validate = require("valid-filename");
const {mkdir, stat, lstat, copyFile, readdir, access} = require("fs").promises;

const paths = require("./paths.js").get();

const forceBinaryTypes = [
  "pdf",
  "ps",
  "eps",
  "ai",
];

const overrideMimeTypes = {
  "video/x-matroska": "video/webm",
};

utils.mkdir = async function(dir, cb) {
  for (const d of (Array.isArray(dir) ? dir : [dir])) {
    await mkdir(d, {mode: "755", recursive: true});
  }
  cb();
};

utils.rm = function(p, cb) {
  fs.rmdir(p, {recursive: true}, cb);
};

utils.move = function(src, dst, cb) {
  mv(src, dst, err => {
    if (cb) cb(err);
  });
};

utils.copyFile = function(src, dst, cb) {
  let cbCalled = false;
  const read = fs.createReadStream(src);
  const write = fs.createWriteStream(dst);

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

utils.copyDir = async (src, dest) => {
  await mkdir(dest);

  for (const file of await readdir(src)) {
    if ((await lstat(path.join(src, file))).isFile()) {
      await copyFile(path.join(src, file), path.join(dest, file));
    } else {
      await utils.copyDir(path.join(src, file), path.join(dest, file));
    }
  }
};

// Get a pseudo-random n-character lowercase string.
utils.getLink = function(links, length) {
  const linkChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123456789";

  let link = "";
  do {
    while (link.length < length) {
      link += linkChars.charAt(Math.floor(Math.random() * linkChars.length));
    }
  } while (links[link]); // In case the RNG generates an existing link, go again

  return link;
};

utils.pretty = function(data) {
  return util.inspect(data, {colors: true})
    .replace(/^\s+/gm, " ").replace(/\s+$/gm, "")
    .replace(/[\r\n]+/gm, "");
};

utils.getNewPath = async function(origPath, callback) {
  let stats;
  try {
    stats = await stat(origPath);
  } catch {
    return callback(origPath);
  }

  let filename = path.basename(origPath);
  const dirname = path.dirname(origPath);
  let extension = "";

  if (filename.includes(".") && stats.isFile()) {
    extension = filename.substring(filename.lastIndexOf("."));
    filename = filename.substring(0, filename.lastIndexOf("."));
  }

  if (!/-\d+$/.test(filename)) filename += "-1";

  let canCreate = false;
  while (!canCreate) {
    const num = parseInt(filename.substring(filename.lastIndexOf("-") + 1));
    filename = filename.substring(0, filename.lastIndexOf("-") + 1) + (num + 1);
    try {
      await access(path.join(dirname, filename + extension));
    } catch {
      canCreate = true;
    }
  }

  callback(path.join(dirname, filename + extension));
};

utils.normalizePath = function(p) {
  return p.replace(/[\\|/]+/g, "/");
};

utils.addFilesPath = function(p) {
  return p === "/" ? paths.files : path.join(`${paths.files}/${p}`);
};

utils.removeFilesPath = function(p) {
  if (p.length > paths.files.length) {
    return utils.normalizePath(p.substring(paths.files.length));
  } else if (p === paths.files) {
    return "/";
  }
};

utils.sanitizePathsInString = function(str) {
  return (str || "").replace(new RegExp(escapeStringRegexp(paths.files), "g"), "");
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

utils.isBinary = async function(p) {
  if (forceBinaryTypes.includes(ext(p))) {
    return true;
  }

  return isbinaryfile.isBinaryFile(p);
};

utils.contentType = function(p) {
  const type = mimeTypes.lookup(p);
  if (overrideMimeTypes[type]) return overrideMimeTypes[type];

  if (type) {
    const charset = mimeTypes.charsets.lookup(type);
    return type + (charset ? `; charset=${charset}` : "");
  } else {
    try {
      return isbinaryfile.isBinaryFileSync(p) ? "application/octet-stream" : "text/plain";
    } catch {
      return "application/octet-stream";
    }
  }
};

utils.getDispo = function(fileName, download) {
  return cd(path.basename(fileName), {type: download ? "attachment" : "inline"});
};

utils.createSid = function() {
  return crypto.randomBytes(64).toString("base64").substring(0, 48);
};

utils.readJsonBody = function(req) {
  return new Promise(((resolve, reject) => {
    try {
      if (req.body) {
        // This is needed if the express application is using body-parser
        if (typeof req.body === "object") {
          resolve(req.body);
        } else {
          resolve(JSON.parse(req.body));
        }
      } else {
        let body = [];
        req.on("data", chunk => {
          body.push(chunk);
        }).on("end", () => {
          body = String(Buffer.concat(body));
          resolve(JSON.parse(body));
        });
      }
    } catch (err) {
      reject(err);
    }
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
  if (num < 1) return `${num} B`;
  const units = ["B", "kB", "MB", "GB", "TB", "PB"];
  const exp = Math.min(Math.floor(Math.log(num) / Math.log(1000)), units.length - 1);
  return `${(num / (1000 ** exp)).toPrecision(3)} ${units[exp]}`;
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

function strcmp(a, b) {
  return a > b ? 1 : a < b ? -1 : 0;
}

utils.naturalSort = function(a, b) {
  const x = [], y = [];
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
    return escapeStringRegexp(ext);
  });
  return new RegExp(`\\.(${arr.join("|")})$`, "i");
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

utils.addUploadTempExt = path => path.replace(/(\/?[^/]+)/, (_, p1) => `${p1}.droppy-upload`);
utils.removeUploadTempExt = path => path.replace(/(^\/?[^/]+)(\.droppy-upload)/, (_, p1) => p1);
utils.rootname = path => path.split("/").find(p => !!p);
