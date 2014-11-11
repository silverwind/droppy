"use strict";

var demo    = {},
    async   = require("async"),
    rimraf  = require("rimraf"),
    cpr     = require("cpr"),
    log     = require("./log.js"),
    utils   = require("./utils.js"),
    paths   = require("./paths.js").get(),
    fs      = require("fs"),
    request = require("request"),
    path    = require("path");

demo.init = function init(doneCallback) {
    async.series([
        function (callback) {
            log.simple("Cleaning up ...");
            rimraf(paths.files, function () {
                utils.mkdir(paths.files, function () {
                    callback(null);
                });
            });
        },
        function (callback) {
            log.simple("Copying code to samples ...");
            async.parallel([
                function (cb) { cpr(paths.client, path.join(paths.files, "/client"), cb); },
                function (cb) { cpr(paths.server, path.join(paths.files, "/server"), cb); }
            ], function (err) {
                if (err) log.error(err);
                callback(null);
            });
        },
        function (callback) {
            var dest    = path.join(paths.files, "/sample-images"),
                zipDest = path.join(paths.home, "/demoTemp/img.zip"),
                output  = require("unzip").Extract({ path: dest });

            output.on("error", callback);
            output.on("close", callback);

            utils.mkdir(dest, function () {
                utils.mkdir(path.dirname(zipDest), function () {
                    fs.stat(zipDest, function (err, stats) {
                        if (err || stats.size === 0) {
                            log.simple("Getting image samples ...");
                            var ws = fs.createWriteStream(zipDest);
                            ws.on("finish", function () {
                                fs.createReadStream(zipDest).pipe(output);
                            });
                            request("https://silverwind.io/droppy-samples.zip").pipe(ws);
                        } else {
                            fs.createReadStream(zipDest).pipe(output);
                        }
                    });
                });
            });
        },
        // http://www.webmfiles.org
        get("http://video.webmfiles.org/big-buck-bunny_trailer.webm", "/sample-video/Big Buck Bunny.webm"),
        // http://sampleswap.org/mp3/creative-commons/free-music.php
        get("http://sampleswap.org/mp3/artist/earthling/earthling_Room-To-Breath-160.mp3", "/sample-audio/Earthling - Room To Breath.mp3"),
        get("http://sampleswap.org/mp3/artist/joevirus/joevirus_Tenchu-160.mp3", "/sample-audio/Joevirus - Tenchu.mp3"),
        get("http://sampleswap.org/mp3/artist/TranceAddict/Tejaswi_Intuition-160.mp3", "/sample-audio/Tejaswi - Intuition.mp3"),
        function (callback) {
            log.simple("Demo files ready!");
            callback();
        }
    ], doneCallback);
};

function get(src, dst) {
    return function (cb) {
        var stream;
        var temp = path.join(paths.home, "/demoTemp", dst);
        var dest = path.join(paths.files, dst);

        utils.mkdir(path.dirname(temp), function () {
            utils.mkdir(path.dirname(dest), function () {
                fs.exists(temp, function (exists) {
                    if (!exists) {
                        log.simple("Downloading " + src + " ...");
                        stream = fs.createWriteStream(temp);
                        stream.on("error", cb);
                        stream.on("close", function () {
                            utils.copyFile(temp, dest, cb);
                        });
                        request(src).pipe(stream);
                    } else {
                        utils.copyFile(temp, dest, cb);
                    }
                });
            });
        });
    };
}

exports = module.exports = demo;
