"use strict";

var demo     = {},
    async    = require("async"),
    cpr      = require("cpr"),
    chalk    = require("chalk"),
    fs       = require("graceful-fs"),
    path     = require("path"),
    request  = require("request"),
    schedule = require("node-schedule"),
    yauzl    = require("yauzl");

var filetree = require("./filetree.js"),
    log      = require("./log.js"),
    paths    = require("./paths.js").get(),
    utils    = require("./utils.js");

demo.init = function init(cb) {
    process.title = "droppy-demo";
    demo.refresh(function () {
        schedule.scheduleJob("*/10 * * * *", demo.refresh);
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

        // Get audio samples - Provided by http://sampleswap.org
        get("http://sampleswap.org/samples-ghost/DRUM%20LOOPS%20and%20BREAKS/141%20to%20160%20bpm/258%5Bkb%5D160_roll-to-the-moon-and-back.wav.mp3", "/audio/sample-1.mp3"),
        get("http://sampleswap.org/samples-ghost/MELODIC%20SAMPLES%20and%20LOOPS/GUITARS%20BPM/1380%5Bkb%5D120_a-bleep-odyssey.aif.mp3", "/audio/sample-2.mp3"),
        get("http://sampleswap.org/samples-ghost/DRUM%20LOOPS%20and%20BREAKS/141%20to%20160%20bpm/517%5Bkb%5D160_tricky-bongos.wav.mp3", "/audio/sample-3.mp3"),
        get("http://sampleswap.org/samples-ghost/MELODIC%20SAMPLES%20and%20LOOPS/SYNTH%20AND%20ELECTRONIC%20BPM/534%5Bkb%5D078_tinkles-synth.wav.mp3", "/audio/sample-4.mp3"),
        get("http://sampleswap.org/samples-ghost/MELODIC%20SAMPLES%20and%20LOOPS/SYNTH%20AND%20ELECTRONIC%20BPM/689%5Bkb%5D120_dreamy-synth-wave.wav.mp3", "/audio/sample-5.mp3"),
        function (callback) {
            async.parallel([
                function (cb) { cpr(paths.client, path.join(paths.files, "/code/client"), cb); },
                function (cb) { cpr(paths.server, path.join(paths.files, "/code/server"), cb); }
            ], callback);
        }
    ], function () {
        log.simple("Demo refreshed");
        filetree.updateAll();
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
    yauzl.fromBuffer(data, function (err, zipfile) {
        var done, count = 0, written = 0;
        if (err) callback(err);
        zipfile.on("entry", function (entry) {
            count++;
            if (/\/$/.test(entry.fileName)) {
                utils.mkdir(path.join(dest, entry.fileName));
                if (done) callback(null);
            } else {
                zipfile.openReadStream(entry, function (err, rs) {
                    if (err) return callback(err);
                    var ws = fs.createWriteStream(path.join(dest, entry.fileName));
                    ws.on("finish", function () {
                        written++;
                        if (done && written === count) {
                            callback(null);
                        }
                    });
                    rs.pipe(ws);
                });
            }
        });
        zipfile.on("end", function () {
            done = true;
        });
    });
}

module.exports = demo;
