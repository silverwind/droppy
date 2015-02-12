"use strict";

var utils  = {},
    async  = require("async"),
    cd     = require("content-disposition"),
    crypto = require("crypto"),
    fs     = require("graceful-fs"),
    isBin  = require("isbinaryfile"),
    mkdirp = require("mkdirp"),
    path   = require("path"),
    paths  = require("./paths.js").get(),
    rimraf = require("rimraf"),
    forceBinaryTypes = [
        "pdf",
        "ps",
        "eps",
        "ai"
    ];

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

// mkdirp.sync wrapper with array support
utils.mkdirSync = function mkdirSync(dir) {
    if (Array.isArray(dir)) {
        dir.forEach(function (p) {
            mkdirp.sync(p, {fs: fs, mode: "755"});
        });
    } else if (typeof dir === "string") {
        mkdirp.sync(dir, {fs: fs, mode: "755"});
    } else {
        throw new Error("mkdirSync: Wrong dir type: " + typeof dir);
    }
};

// rimraf wrapper with 10 retries
utils.rm = function rm(p, cb) {
    rimraf(p, {maxBusyTries: 10}, cb);
};

// rimraf.sync wrapper with 10 retries
utils.rmSync = function rmSync(p) {
    rimraf.sync(p, {maxBusyTries: 10});
};

// Recursively walk a directory and return on object with paths as keys and stats as values
utils.walkDirectory = function walkDirectory(dir, includeEmptyDirs, callback) {
    var results = {};
    fs.readdir(dir, function (error, list) {
        var i = 0;
        if (error) return callback(error);
        (function next() {
            var file = list[i++];
            if (!file) return callback(null, results);
            file = dir + "/" + file;
            fs.stat(file, function (error, stats) {
                if (stats && stats.isDirectory()) {
                    if (includeEmptyDirs) results[file + "/"] = stats;
                    walkDirectory(file, includeEmptyDirs, function (error, newResults) {
                        Object.keys(newResults).forEach(function (newResult) {
                            results[newResult] = newResults[newResult];
                        });
                        next();
                    });
                } else {
                    results[file] = stats;
                    next();
                }
            });
        })();
    });
};

utils.getExt = function getExt(filename) {
    var dot = filename.lastIndexOf(".");
    if (dot > -1 && dot < filename.length)
        return filename.substring(dot + 1, filename.length);
    else
        return filename;
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

// Get a unique string, used to identify websocket session
utils.newSid = function getSid() {
    var hrtime = process.hrtime();
    return String(hrtime[0] + hrtime[1]);
};

utils.getNewPath = function getNewPath(origPath, callback) {
    fs.stat(origPath, function (err, stats) {
        if (err) callback(origPath);
        else {
            var filename  = path.basename(origPath),
                dirname   = path.dirname(origPath),
                extension = "";

            if (filename.indexOf(".") !== -1 && stats.isFile()) {
                extension = filename.substring(filename.lastIndexOf("."));
                filename  = filename.substring(0, filename.lastIndexOf("."));
            }

            if (!/\-\d+$/.test(filename)) filename = filename + "-1";

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

utils.copyFile = function copyFile(source, target, cb) {
    var cbCalled = false,
        read     = fs.createReadStream(source),
        write    = fs.createWriteStream(target);

    read.on("error", done);
    write.on("error", done);
    write.on("close", done);
    read.pipe(write);

    function done(err) {
        if (cbCalled) return;
        cbCalled = true;
        cb(err);
    }
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

utils.relativeZipPath = function removeFilesPath(p) {
    return utils.normalizePath(path.relative(utils.normalizePath(paths.files), utils.normalizePath(p)));
};

utils.isPathSane = function isPathSane(name) {
    if (/[\/\\]\.\./.test(name)) return false;      // Navigating down the tree (prefix)
    if (/\.\.[\/\\]/.test(name)) return false;      // Navigating down the tree (postfix)
    if (/[\*\{\}\|<>"]/.test(name)) return false;   // Invalid characters
    return true;
};

utils.isBinary = function isBinary(path, callback) {
    if (forceBinaryTypes.indexOf(utils.getExt(path)) !== -1)
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

utils.tlsInit = function tlsInit(opts, callback) {
    if (typeof opts.key === "string" && typeof opts.cert === "string") {
        var certPaths = [
            path.resolve(paths.home, opts.key),
            path.resolve(paths.home, opts.cert),
            opts.ca ? path.resolve(paths.home, opts.ca) : undefined,
            opts.dhparam ? path.resolve(paths.home, opts.dhparam) : undefined
        ];

        async.map(certPaths, readFile, function (err, data) {
            var certStart = "-----BEGIN CERTIFICATE-----";
            var certEnd   = "-----END CERTIFICATE-----";

            var key     = data[0],
                cert    = data[1],
                ca      = data[2],
                dhparam = data[3];


            if (!key)  return callback(new Error("Unable to read TLS key: " + certPaths[0]));
            if (!cert) return callback(new Error("Unable to read TLS certificate: " + certPaths[1]));
            if (opts.ca && !ca) return callback(new Error("Unable to read TLS intermediate certificate: " + certPaths[2]));
            if (opts.dhparam && !dhparam) return callback(new Error("Unable to read TLS DH parameter file: " + certPaths[3]));

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
        });
    } else {
        // Use self-signed certs
        require("pem").createCertificate({ days: 365, selfSigned: true }, function (err, keys) {
            callback(null, {
                selfsigned : true,
                key        : keys.serviceKey,
                cert       : keys.certificate
            });
        });
    }

};

function readFile(p, cb) {
    if (typeof p !== "string") return cb(null);

    fs.stat(p, function (err, stats) {
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

exports = module.exports = utils;
