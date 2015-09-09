#!/usr/bin/env node
"use strict";

var argv  = require("minimist")(process.argv.slice(2), {boolean: ["color"]});
var fs    = require("graceful-fs");
var pkg   = require("./package.json");

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
  color     : "--color              Force enable color in terminal",
  nocolor   : "--no-color           Force disable color in terminal",
  configdir : "--configdir <dir>    Config directory. Default: ~/.droppy",
  filesdir  : "--filesdir <dir>     Files directory. Default: <configdir>/files",
  log       : "--log <file>         Log to file instead of stdout"
};

if (argv.v || argv.V || argv.version) {
  console.info(pkg.version);
  process.exit(0);
}

if (argv.configdir || argv.filesdir || argv.home) {
  if (argv.home)
    console.log("\n Warning: --home is deprecated, use --configdir and --filesdir\n");

  require("./server/paths.js").seed(argv.configdir || argv.home, argv.filesdir);
}

if (argv.log) {
  var ut = require("untildify");
  var path = require("path");
  try {
    require("./server/log.js").setLogFile(fs.openSync(ut(path.resolve(argv.log)), "a", "644"));
  } catch (err) {
    console.error("Unable to open log file for writing: " + err.message);
    process.exit(1);
  }
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
    require("./server/update.js")(pkg, function (err, message) {
      if (err) { console.error(new Error(err.message || err).stack); process.exit(1); }
      if (message) { console.info(message); process.exit(0); }
    });
    break;
  case "config":
    var paths = require("./server/paths.js").get();
    var cfg   = require("./server/cfg.js");
    var which = require("which");

    var findEditor = function findEditor(cb) {
      var editors = ["vim", "vi", "nano", "pico", "emacs", "npp", "notepad"];
      (function find(editor) {
        try {
          cb(which.sync(editor));
        } catch(e) {
          if (editors.length)
            find(editors.shift());
          else
            cb();
        }
      })(editors.shift());
    };

    var edit = function edit() {
      findEditor(function (editor) {
        if (!editor) return console.error("No suitable editor found, please edit " + paths.cfgFile);
        require("child_process").spawn(editor, [paths.cfgFile], {stdio: "inherit"});
      });
    };

    fs.stat(paths.cfgFile, function (err) {
      if (err && err.code === "ENOENT") {
        require("mkdirp")(paths.config, function () {
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
    db = require("./server/db.js");
    db.init(function () {
      printUsers(db.get("users"));
    });
    break;
  case "add":
    if (args.length !== 2) return printHelp();
    db = require("./server/db.js");
    db.init(function () {
      db.addOrUpdateUser(args[0], args[1], true, function () {
        printUsers(db.get("users"));
      });
    });
    break;
  case "del":
    if (args.length !== 1) return printHelp();
    db = require("./server/db.js");
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
