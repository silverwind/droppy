#!/usr/bin/env node
"use strict";

var argv = require("minimist")(process.argv.slice(2), {boolean: ["color"]});
var fs   = require("graceful-fs");
var path = require("path");
var pkg  = require("./package.json");
var ut   = require("untildify");

process.title = pkg.name;

var cmds = {
  start   : "start                Start the server",
  update  : "update               Update the server",
  config  : "config               Edit the config",
  list    : "list                 List users",
  add     : "add <user> <pass>    Add a user",
  del     : "del <user>           Delete a user",
  version : "version, -v          Print version"
};

var opts = {
  color   : "--color              Force color logging",
  home    : "--home <home>        Home directory, defaults to ~/.droppy",
  log     : "--log <logfile>      Log to logfile instead of stdout"
};

if (argv.v || argv.version) {
  console.info(pkg.version);
  process.exit(0);
}

if (argv.home) {
  require("./server/lib/paths.js").seed(argv.home);
}

if (argv.log) {
  var logfile = ut(path.resolve(argv.log)), fd;
  try {
    fd = fs.openSync(logfile, "a", "644");
  } catch (err) {
    console.error("Unable to open logfile for writing: " + err.message);
    process.exit(1);
  }
  require("./server/lib/log.js").setLogFile(fd);
}

if (!argv._.length) {
  printHelp();
  process.exit(0);
}

var cmd  = argv._[0];
var args = argv._.slice(1);

if (cmds[cmd]) {
  var db;
  switch (cmd) {
  case "start":
    require("./server/server.js")(null, true, function (err) {
      if (err) { console.error("\n" + new Error(err.message || err).stack); process.exit(1); }
    });
    break;
  case "version":
    console.info(pkg.version);
    break;
  case "update":
    require("./server/lib/update.js")(pkg, function (err, message) {
      if (err) { console.error(new Error(err.message || err).stack); process.exit(1); }
      if (message) { console.info(message); process.exit(0); }
    });
    break;
  case "config":
    var paths = require("./server/lib/paths.js").get();
    var cfg   = require("./server/lib/cfg.js");
    var edit  = function () {
      require("child_process").spawn(process.env.EDITOR || "vim", [paths.cfgFile], {stdio: "inherit"});
    };

    fs.stat(paths.cfgFile, function (err) {
      if (err && err.code === "ENOENT") {
        require("mkdirp")(paths.cfg, function () {
          cfg.init(null, function (err) {
            if (err) return console.error(new Error(err.message || err).stack);
            edit();
          });
        });
      } else {
        edit();
      }
    });
    break;
  case "list":
    db = require("./server/lib/db.js");
    db.init(function () {
      printUsers(db.get("users"));
    });
    break;
  case "add":
    if (args.length !== 2) return printHelp();
    db = require("./server/lib/db.js");
    db.init(function () {
      db.addOrUpdateUser(args[0], args[1], true, function () {
        printUsers(db.get("users"));
      });
    });
    break;
  case "del":
    if (args.length !== 1) return printHelp();
    db = require("./server/lib/db.js");
    db.init(function () {
      db.delUser(args[0], function () {
        printUsers(db.get("users"));
      });
    });
    break;
  }
} else {
  printHelp();
}

function printHelp() {
  var help = "Usage: " + pkg.name + " command [options]\n\n Commands:";

  Object.keys(cmds).forEach(function (command) {
    help += "\n   " + cmds[command];
  });

  help += "\n\n Options:";

  Object.keys(opts).forEach(function (option) {
    help += "\n   " + opts[option];
  });

  console.info(help);
}

function printUsers(users) {
  console.info("Current Users: " + Object.keys(users).join(", "));
}
