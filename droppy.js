#!/usr/bin/env node
"use strict";

var argv = require("minimist")(process.argv.slice(2), {boolean: ["color", "d", "daemon"]});
var fs   = require("graceful-fs");
var pkg  = require("./package.json");

process.title = pkg.name;

var cmds = {
  start     : "start                  Start the server",
  update    : "update                 Self-Update (may require root)",
  config    : "config                 Edit the config",
  list      : "list                   List users",
  add       : "add <user> <pass>      Add a user",
  del       : "del <user>             Delete a user",
  build     : "build                  Build client resources",
  version   : "version, -v            Print version",
};

var opts = {
  configdir : "-c, --configdir <dir>  Config directory. Default: ~/.droppy",
  filesdir  : "-f, --filesdir <dir>   Files directory. Default: <configdir>/files",
  daemon    : "-d, --daemon           Daemonize (background) process",
  log       : "-l, --log <file>       Log to file instead of stdout",
  dev       : "--dev                  Enable developing mode",
  color     : "--color                Force enable color in terminal",
  nocolor   : "--no-color             Force disable color in terminal",
};

if (argv.v || argv.V || argv.version) {
  console.info(pkg.version);
  process.exit(0);
}

if (argv.daemon || argv.d) {
  require("daemon")();
}

if (argv._[0] === "build") {
  console.log("Building resources ...");
  require("./server/resources.js").build(function(err) {
    console.log(err || "Resources built successfully");
    process.exit(err ? 1 : 0);
  });
}

if (argv.configdir || argv.filesdir || argv.c || argv.f) {
  require("./server/paths.js").seed(argv.configdir || argv.c, argv.filesdir || argv.f);
}

if (argv.log || argv.l) {
  var ut = require("untildify");
  var path = require("path");
  try {
    require("./server/log.js").setLogFile(fs.openSync(ut(path.resolve(argv.log || argv.l)), "a", "644"));
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
    require("./server/server.js")(null, true, argv.dev, function(err) {
      if (err) {
        require("./server/log.js").error(err);
        process.exit(1);
      }
    });
    break;
  case "version":
    console.info(pkg.version);
    break;
  case "update":
    require("./server/update.js")(pkg, function(err, message) {
      if (err) { console.error(new Error(err.message || err).stack); process.exit(1); }
      if (message) { console.info(message); process.exit(0); }
    });
    break;
  case "config":
    var paths = require("./server/paths.js").get();
    var cfg   = require("./server/cfg.js");
    var edit = function edit() {
      findEditor(function(editor) {
        if (!editor) return console.error("No suitable editor found, please edit " + paths.cfgFile);
        require("child_process").spawn(editor, [paths.cfgFile], {stdio: "inherit"});
      });
    };

    fs.stat(paths.cfgFile, function(err) {
      if (err && err.code === "ENOENT") {
        require("mkdirp")(paths.config, function() {
          cfg.init(null, function(err) {
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
    db.init(function() {
      printUsers(db.get("users"));
    });
    break;
  case "add":
    if (args.length !== 2) return printHelp();
    db = require("./server/db.js");
    db.init(function() {
      db.addOrUpdateUser(args[0], args[1], true, function() {
        printUsers(db.get("users"));
      });
    });
    break;
  case "del":
    if (args.length !== 1) return printHelp();
    db = require("./server/db.js");
    db.init(function() {
      db.delUser(args[0], function() {
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

  Object.keys(cmds).forEach(function(command) {
    help += "\n   " + cmds[command];
  });

  help += "\n\n Options:";

  Object.keys(opts).forEach(function(option) {
    help += "\n   " + opts[option];
  });

  console.info(help);
}

function printUsers(users) {
  console.info("Current Users: " + Object.keys(users).join(", "));
}

function findEditor(cb) {
  var editors    = ["vim", "nano", "vi", "npp", "pico", "emacs", "notepad"];
  var basename   = require("path").basename;
  var which      = require("which");
  var userEditor = basename(process.env.VISUAL || process.env.EDITOR);

  if (editors.indexOf(userEditor) === -1)
    editors.unshift(userEditor);

  (function find(editor) {
    try {
      cb(which.sync(editor));
    } catch (err) {
      if (editors.length)
        find(editors.shift());
      else
        cb();
    }
  })(editors.shift());
}
