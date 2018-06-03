"use strict";

const demo     = module.exports = {};
const async    = require("async");
const cpr      = require("cpr");
const chalk    = require("chalk");
const fs       = require("graceful-fs");
const path     = require("path");
const request  = require("request");
const schedule = require("node-schedule");

const log      = require("./log.js");
const paths    = require("./paths.js").get();
const utils    = require("./utils.js");

demo.init = function(cb) {
  process.title = "droppy-demo";
  log.info("Initializing demo mode ...");
  demo.refresh(() => {
    schedule.scheduleJob("*/10 * * * *", demo.refresh);
    if (cb) cb();
  });
};

demo.refresh = function(doneCallback) {
  async.series([
    function(callback) {
      utils.rm(path.join(paths.files, "**/*"), err => {
        if (err) log.error(err);
        callback();
      });
    },

    // Text samples
    get("https://silverwind.io/example.html", "example.html"),

    // PDF Sample
    get("https://www.ecma-international.org/publications/files/ECMA-ST/ECMA-404.pdf", "example.pdf"),

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

    // Video samples
    get("http://wiki.garrysmod.com/images/1/1d/big-buck-bunny_trailer.webm", "example.webm"),
    get("http://download.blender.org/peach/trailer/trailer_720p.mov", "example.mov"),

    // Audio samples
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
  ], () => {
    log.info("Demo files refreshed");
    if (doneCallback && typeof doneCallback === "function") doneCallback();
  });
};

function get(url, dest) {
  return function(callback) {
    const temp = path.join(paths.config, "/demoTemp", dest);
    dest = path.join(paths.files, dest);
    utils.mkdir([path.dirname(temp), path.dirname(dest)], () => {
      fs.stat(temp, (err, stats) => {
        if (err || !stats.size) {
          const stream = fs.createWriteStream(temp);
          stream.on("error", callback);
          stream.on("close", () => {
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
