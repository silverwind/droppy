"use strict";

var utils = {},
    async = require("async"),
    fs    = require("graceful-fs"),
    isBin = require("isbinaryfile"),
    path  = require("path"),
    paths = require("./paths.js").get();

// Recursively walk a directory and return file paths in an array
utils.walkDirectory = function walkDirectory(dir, includeEmptyDirs, callback) {
    var results = [];
    fs.readdir(dir, function (error, list) {
        var i = 0;
        if (error) return callback(error);
        (function next() {
            var file = list[i++];
            if (!file) return callback(null, results);
            file = dir + "/" + file;
            fs.stat(file, function (error, stats) {
                if (stats && stats.isDirectory()) {
                    if (includeEmptyDirs) results.push(file + "/");
                    walkDirectory(file, includeEmptyDirs, function (error, res) {
                        results = results.concat(res);
                        next();
                    });
                } else {
                    results.push(file);
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

utils.getNewPath = function getNewPath(origPath, callback) {
    fs.stat(origPath, function (err) {
        if (err) callback(origPath);
        else {
            origPath = origPath.replace(/([\\\/]?\.?[^\\\/\.]+)([^\\\/]*)$/, function (match, filename, exts) {
                var fnMatch = filename.match(/([\\\/\.]+\w+)\-(\d+)$/), i = 1;
                if (fnMatch !== null) {
                    filename = fnMatch[1];
                    i = parseInt(fnMatch[2], 10) + 1;
                }
                return filename + "-" + i + exts;
            });
            getNewPath(origPath, callback);
        }
    });
};

utils.copyFile = function copyFile(source, target, cb) {
    var cbCalled = false;

    var rd = fs.createReadStream(source);
    rd.on("error", function (err) {
        done(err);
    });
    var wr = fs.createWriteStream(target);
    wr.on("error", function (err) {
        done(err);
    });
    wr.on("close", function () {
        done();
    });
    rd.pipe(wr);

    function done(err) {
        if (!cbCalled) {
            cb(err);
            cbCalled = true;
        }
    }
};

utils.addFilesPath = function addFilesPath(p) {
    return path.join(paths.files + "/" + p);
};

utils.removeFilesPath = function removeFilesPath(p) {
    return "/" + path.relative(paths.files, p).replace(/[\\|\/]+/g, "/");
};

utils.isPathSane = function isPathSane(name) {
    if (/[\/\\]\.\./.test(name)) return false;      // Navigating down the tree (prefix)
    if (/\.\.[\/\\]/.test(name)) return false;      // Navigating down the tree (postfix)
    if (/[\*\{\}\|<>"]/.test(name)) return false;   // Invalid characters
    return true;
};

utils.isBinary = function isBinary(path, callback) {
    isBin(path, function (err, result) {
        if (err) return callback(err);
        callback(null, result);
    });
};

utils.getDispo = function getDispo(fileName) {
    fileName = path.basename(fileName);
    return "attachment; filename=\"" + fileName + "\"; filename*=UTF-8''" + encodeURIComponent(fileName);
};

utils.tlsInit = function tlsInit(callback) {
    var key  = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA0kJe7hotIUJTLQuOXdu4IL8+L7ZWO5+dPkrVmzKXSGxlGptf\n1ZeMGT8\/5ONzEcwp9BHqNz5IbN78sD87HJf+30DYqxQgDdbXQDEUZG+OFOFWhVtt\nxJ63yuyNlmpwNX+DmzdfS8n6YOTuj61z0fM9hrQ8KgA0fBlQH8XQ9SS7kBuySRne\n0+lkka+4fondenYbQLtQ0ZUZAZTJlR9qVGTXIhffiZyePa1U4GFs58a98G9gi1WA\n4cfnDwPa6PhLZrmoR+xW46EAzCvW8rDW1e25eQXNPqidWBK5fDFpFkmui+D89T\/+\nq8uu\/c+4e6TAMUqxPibye2u\/wAee3ZBp\/DyDhwIDAQABAoIBAA2AFXhUVfF8wLpz\ns4BzSy9PGD8YBhFt\/jqxs2VzqiMMUrGSqGSehnBYj1GzCQBri4YQYGmLpjrXVoI6\njSEY4VSUZVUWxbgdw1Rr0lNglk7g6R1G8ZVeW468AZtW2j2VIm4k8Al9voXaLTcs\ne\/NPGvQ7PmG0Aaq2NV7U5MXYxfJKtxmVlAlrqs3Fu+vCByH3nBbt+MD7JRfj9elk\nkiAY0FAOp10IqpLlF6GLD5xelI3OjlEqL9dJS3U14aULhXNp36A0lCju8ZK6+9dF\nvu94sBYlxrC0fUZAo7XZv6PTbwHXaiJg3\/HpwKAJD7RGYxyLtCb4zRylhS1U+Oi7\nV6iUhAECgYEA+QQXX+koi\/NcvZrfi7k4Qcl13EmyCjh8BNdMipGP6Oz3G0TUkdlS\nL935XIAhDZ6Wx1cBf1J1SumDbA5bvps50gd3o8p2ndtWWhSaWysYd1n9RjCFOauR\nI8cwT8C7yZU6nWjzh6l6dtjegJ6tNmbzqqWGHmLPC9rFQMPnax+tiCcCgYEA2CgC\no\/ds4M38u4dRkMghvVOeDWpyv8G7dRXDkpRqzoUCI+wzoZb+CGCpNeow05TSBURb\nu2L28eUtR0D9P\/ZejpTibSp\/Z7Sxjzl9SLvj4szpkldvb6yiEuD2DsZHo20DFuv+\nc+tW57s6PORiKT831cOkeT1wyhwf62FukZqZ5aECgYEAya4lnFmDrG2rRClmOo0F\n4kpfec36M8rxrx4M8QHZ02Xw8RX7MDEaHoiiiOeBXb1\/Eu4F2XAYbVbZSTAL4EFq\nQBAqNu8oyMs3kfez2Hj79NZeinWLwVySTa7rEvzfWvHRKmIxM0PxWsZk1zkswq35\nVdF\/4aZXWJuUPNMt4BYk\/usCgYA2GdWHWn86yPOvsA+\/MAgZzdrqOrFbw0564Kah\nglo1NF8zxIOrtxH\/4MmZP\/NWkZH7VX+sJ\/ns01KA2ghIwQ4rm6IMdq2KtFQYp+fu\nk3BXLLhtM0sl5UxvczTCv+fgRIGYdBqswsNunpLV+MeE0VjVPPFmkvUu8NkgXbOB\n5\/MK4QKBgQDMxxwaWaRXGEjhF0LhIVQvsLqcpWylzLJE+FzBpVxsWbUVDdfoKLxZ\nmQaAIVisil07H2VuskycArs4mnny5qkDrPTf\/avV\/WACRadELzTVs079xJ03NGqo\nDcaWVsPOdnALhgbQeEtY3FsVvxn6ZxjmGxMHQ7p1XayDRzR89vEn+Q==\n-----END RSA PRIVATE KEY-----";
    var cert = "-----BEGIN CERTIFICATE-----\nMIIC9TCCAd2gAwIBAgIJAI3HQ+EEARNoMA0GCSqGSIb3DQEBBQUAMBExDzANBgNV\nBAMMBmRyb3BweTAeFw0xNDA4MzExODEyMTJaFw0yNDA4MjgxODEyMTJaMBExDzAN\nBgNVBAMMBmRyb3BweTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBANJC\nXu4aLSFCUy0Ljl3buCC\/Pi+2VjufnT5K1Zsyl0hsZRqbX9WXjBk\/P+TjcxHMKfQR\n6jc+SGze\/LA\/OxyX\/t9A2KsUIA3W10AxFGRvjhThVoVbbcSet8rsjZZqcDV\/g5s3\nX0vJ+mDk7o+tc9HzPYa0PCoANHwZUB\/F0PUku5AbskkZ3tPpZJGvuH6J3Xp2G0C7\nUNGVGQGUyZUfalRk1yIX34mcnj2tVOBhbOfGvfBvYItVgOHH5w8D2uj4S2a5qEfs\nVuOhAMwr1vKw1tXtuXkFzT6onVgSuXwxaRZJrovg\/PU\/\/qvLrv3PuHukwDFKsT4m\n8ntrv8AHnt2Qafw8g4cCAwEAAaNQME4wHQYDVR0OBBYEFFN6V4jLgQidtXAVsxSA\nAwxdn85CMB8GA1UdIwQYMBaAFFN6V4jLgQidtXAVsxSAAwxdn85CMAwGA1UdEwQF\nMAMBAf8wDQYJKoZIhvcNAQEFBQADggEBAFdZREnEsxnugL\/VDqs56PVQdyNnky39\nsBDXyiJTHDtMTGd4aI\/VijTzCPY6IMSLWy5TTZIvlBVNT2TZT+hPaLAxi9KHFl3S\nvZB276YL\/\/qiiaECJUte9Ic6D7MyTZVWYhgPPLpePilNQ1C9v1wMqTrP\/Ld78wW0\nQBgc9\/GSZbVgblAuqyW2Y0qkrMXP0NPPqYeliZ6wAElF4JIg+DKYor\/6AAbQFs4H\nulUA1FD2ekRmxA8kG1a\/79pd0Xa5JskACbsGqXYicyyWhx+BkEi167ZYRaDF3cFU\nFxwsAC32NwY1dcPcoieoq7RkWdYDyNxup26R2f9IA62auEyAGIWyXBU=\n-----END CERTIFICATE-----\n";
    var ca   = "";

    async.parallel([
        function (cb) {
            fs.stat(paths.tlsKey, function (err, stats) {
                if (err && err.code === "ENOENT") {
                    fs.writeFile(paths.tlsKey, key, function (err) { cb(err, key); });
                } else if (stats.isFile()) {
                    fs.readFile(paths.tlsKey, function (err, data) { cb(err, String(data)); });
                }
            });
        },
        function (cb) {
            fs.stat(paths.tlsCert, function (err, stats) {
                if (err && err.code === "ENOENT") {
                    fs.writeFile(paths.tlsCert, cert, function (err) { cb(err, cert); });
                } else if (stats.isFile()) {
                    fs.readFile(paths.tlsCert, function (err, data) { cb(err, String(data)); });
                }
            });
        },
        function (cb) {
            fs.stat(paths.tlsCA, function (err, stats) {
                if (err && err.code === "ENOENT") {
                    fs.writeFile(paths.tlsCA, ca, function (err) { cb(err, ca); });
                } else if (stats.isFile()) {
                    fs.readFile(paths.tlsCA, function (err, data) { cb(err, String(data)); });
                }
            });
        }
    ], callback);
};

exports = module.exports = utils;
