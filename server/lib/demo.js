"use strict";

var demo     = {},
    async    = require("async"),
    cpr      = require("cpr"),
    chalk    = require("chalk"),
    fs       = require("fs"),
    log      = require("./log.js"),
    path     = require("path"),
    paths    = require("./paths.js").get(),
    request  = require("request"),
    schedule = require("node-schedule"),
    utils    = require("./utils.js"),
    yauzl    = require("yauzl");

demo.init = function init (cb) {
    process.title = "droppy-demo";
    demo.refresh(function () {
        schedule.scheduleJob('*/10 * * * *', demo.refresh);
        if (cb) cb();
    });
};


demo.refresh = function refresh(doneCallback) {
    async.series([
        function (callback) {
            utils.rm(paths.files, function () {
                utils.mkdir(paths.files, callback);
            });
        },
        // Get image samples
        getZip("https://silverwind.io/droppy-samples.zip", "/images", path.join(paths.home, "/demoTemp/img.zip")),

        // Get video samples - Provided by http://www.webmfiles.org
        get("http://video.webmfiles.org/big-buck-bunny_trailer.webm", "/video/Big Buck Bunny.webm"),

        // Get audio samples - Provided by http://sampleswap.org/mp3/creative-commons/free-music.php
        get("http://sampleswap.org/mp3/artist/earthling/earthling_Room-To-Breath-160.mp3", "/audio/Earthling - Room To Breath.mp3"),
        get("http://sampleswap.org/mp3/artist/joevirus/joevirus_Tenchu-160.mp3", "/audio/Joevirus - Tenchu.mp3"),
        get("http://sampleswap.org/mp3/artist/TranceAddict/Tejaswi_Intuition-160.mp3", "/audio/Tejaswi - Intuition.mp3"),
        function (callback) {
            async.parallel([
                function (cb) { cpr(paths.client, path.join(paths.files, "/code/client"), cb); },
                function (cb) { cpr(paths.server, path.join(paths.files, "/code/server"), cb); }
            ], callback);
        }
    ], function () {
        log.simple("Demo refreshed");
        if (doneCallback) doneCallback();
    });
};

function get(url, dest) {
    return function (callback) {
        var stream, temp;
        temp = path.join(paths.home, "/demoTemp", dest);
        dest = path.join(paths.files, dest);

        utils.mkdir([path.dirname(temp), path.dirname(dest)], function () {
            fs.stat(temp, function (err, stats) {
                if (err || !stats.size) {
                    stream = fs.createWriteStream(temp);
                    stream.on("error", callback);
                    stream.on("close", function () {
                        utils.copyFile(temp, dest, callback);
                    });
                    log.simple(chalk.yellow("GET ") + url);
                    request(url).pipe(stream);
                } else {
                    utils.copyFile(temp, dest, callback);
                }
            });
        });
    };
}

function getZip(url, dest, zipDest) {
    return function (callback) {
        dest = path.join(paths.files, dest);
        utils.mkdir([dest, path.dirname(zipDest)], function () {
            fs.stat(zipDest, function (err, stats) {
                if (err || !stats.size) {
                    log.simple(chalk.yellow("GET ") + url);
                    request({url: url, encoding: null}, function (err, _, data) {
                        if (err) return callback(err);
                        fs.writeFile(zipDest, data, log.error);
                        unzip(data, dest, callback);
                    });
                } else {
                    fs.readFile(zipDest, function (err, data) {
                        if (err) return callback(err);
                        unzip(data, dest, callback);
                    });
                }
            });
        });
    };
}

function unzip(data, dest, callback) {
    yauzl.fromBuffer(data, function(err, zipfile) {
        var done, count = 0, written = 0;
        if (err) callback(err);
        zipfile.on("entry", function(entry) {
            count++;
            if (/\/$/.test(entry.fileName)) {
                utils.mkdir(path.join(dest, entry.fileName));
                if (done) callback(null);
            } else {
                zipfile.openReadStream(entry, function(err, rs) {
                    if (err) return callback(err);
                    var ws = fs.createWriteStream(path.join(dest, entry.fileName));
                    ws.on("finish", function() {
                        written++;
                        if (done && (written === count)) {
                            callback(null);
                        }
                    });
                    rs.pipe(ws);
                });
            }
        });
        zipfile.on("end", function() {
            done = true;
        });
    });
}

module.exports = demo;
