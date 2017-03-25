"use strict";

var demo     = module.exports = {};
var async    = require("async");
var cpr      = require("cpr");
var chalk    = require("chalk");
var fs       = require("graceful-fs");
var path     = require("path");
var request  = require("request");
var schedule = require("node-schedule");

var log      = require("./log.js");
var paths    = require("./paths.js").get();
var utils    = require("./utils.js");

demo.init = function init(cb) {
  process.title = "droppy-demo";
  log.info("Initializing demo mode ...");
  demo.refresh(function() {
    schedule.scheduleJob("*/10 * * * *", demo.refresh);
    if (cb) cb();
  });
};

demo.refresh = function refresh(doneCallback) {
  async.series([
    function(callback) {
      utils.rm(path.join(paths.files, "**/*"), function(err) {
        if (err) log.error(err);
        callback();
      });
    },

    // Text samples
    get("https://silverwind.io/example.html", "example.html"),

    // Image samples
    get("https://silverwind.io/droppy-samples/sample-1.jpg", "/images/sample-1.jpg"),
    get("https://silverwind.io/droppy-samples/sample-2.jpg", "/images/sample-2.jpg"),
    get("https://silverwind.io/droppy-samples/sample-3.jpg", "/images/sample-3.jpg"),
    get("https://silverwind.io/droppy-samples/sample-4.jpg", "/images/sample-4.jpg"),
    get("https://silverwind.io/droppy-samples/sample-5.jpg", "/images/sample-5.jpg"),
    get("https://silverwind.io/droppy-samples/sample-6.jpg", "/images/sample-6.jpg"),
    get("https://silverwind.io/droppy-samples/sample-7.jpg", "/images/sample-7.jpg"),
    get("https://silverwind.io/droppy-samples/sample-8.jpg", "/images/sample-8.jpg"),
    get("https://silverwind.io/droppy-samples/sample-9.jpg", "/images/sample-9.jpg"),
    get("https://silverwind.io/droppy-samples/sample-10.jpg", "/images/sample-10.jpg"),
    get("https://silverwind.io/droppy-samples/sample-11.jpg", "/images/sample-11.jpg"),
    get("https://silverwind.io/droppy-samples/sample-12.jpg", "/images/sample-12.jpg"),
    get("https://silverwind.io/droppy-samples/sample-13.jpg", "/images/sample-13.jpg"),
    get("https://silverwind.io/droppy-samples/sample-14.jpg", "/images/sample-14.jpg"),
    get("https://silverwind.io/droppy-samples/sample-15.jpg", "/images/sample-15.jpg"),
    get("https://silverwind.io/droppy-samples/sample-16.jpg", "/images/sample-16.jpg"),
    get("https://silverwind.io/droppy-samples/sample-17.jpg", "/images/sample-17.jpg"),
    get("https://silverwind.io/droppy-samples/sample-18.jpg", "/images/sample-18.jpg"),
    get("https://raw.githubusercontent.com/silverwind/droppy/master/client/images/readme-logo.svg", "example.svg"),
    get("https://github.com/silverwind/droppy/raw/master/client/images/logo180.png", "example.png"),

    // Video samples - Provided by webmfiles.org
    get("http://dl1.webmfiles.org/big-buck-bunny_trailer.webm", "example.webm"),
    get("http://video.blendertestbuilds.de/download.blender.org/peach/trailer_480p.mov", "example.mp4"),

    // Audio samples - Provided by sampleswap.org
    get("http://sampleswap.org/samples-ghost/DRUM%20LOOPS%20and%20BREAKS/141%20to%20160%20bpm/258%5Bkb%5D160_roll-to-the-moon-and-back.wav.mp3", "/audio/sample-1.mp3"),
    get("http://sampleswap.org/samples-ghost/MELODIC%20SAMPLES%20and%20LOOPS/GUITARS%20BPM/1380%5Bkb%5D120_a-bleep-odyssey.aif.mp3", "/audio/sample-2.mp3"),
    get("http://sampleswap.org/samples-ghost/DRUM%20LOOPS%20and%20BREAKS/141%20to%20160%20bpm/517%5Bkb%5D160_tricky-bongos.wav.mp3", "/audio/sample-3.mp3"),
    get("http://sampleswap.org/samples-ghost/MELODIC%20SAMPLES%20and%20LOOPS/SYNTH%20AND%20ELECTRONIC%20BPM/534%5Bkb%5D078_tinkles-synth.wav.mp3", "/audio/sample-4.mp3"),
    get("http://sampleswap.org/samples-ghost/MELODIC%20SAMPLES%20and%20LOOPS/SYNTH%20AND%20ELECTRONIC%20BPM/689%5Bkb%5D120_dreamy-synth-wave.wav.mp3", "/audio/sample-5.mp3"),
    function(callback) {
      async.series([
        function(cb) { cpr(paths.client, path.join(paths.files, "/code/client"), cb); },
        function(cb) { cpr(paths.server, path.join(paths.files, "/code/server"), cb); },
        function(cb) { utils.rm(path.join(paths.files, "/code/client/svg"), cb); },
      ], callback);
    }
  ], function() {
    log.info("Demo files refreshed");
    if (doneCallback) doneCallback();
  });
};

function get(url, dest) {
  return function(callback) {
    var stream, temp;
    temp = path.join(paths.config, "/demoTemp", dest);
    dest = path.join(paths.files, dest);

    utils.mkdir([path.dirname(temp), path.dirname(dest)], function() {
      fs.stat(temp, function(err, stats) {
        if (err || !stats.size) {
          stream = fs.createWriteStream(temp);
          stream.on("error", callback);
          stream.on("close", function() {
            utils.copyFile(temp, dest, callback);
          });
          log.info(chalk.yellow("GET ") + url);
          request(url).pipe(stream);
        } else {
          utils.copyFile(temp, dest, callback);
        }
      });
    });
  };
}
