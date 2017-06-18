#!/usr/bin/env node
"use strict";

const argv = require("minimist")(process.argv.slice(2), {
  boolean: ["color", "d", "daemon", "dev"]
});

if (!argv.dev) {
  process.env.NODE_ENV = "production";
}

const fs   = require("graceful-fs");
const pkg  = require("./package.json");

process.title = pkg.name;
process.chdir(__dirname);

const cmds = {
  start     : "start                  Start the server",
  update    : "update                 Self-Update (may require root)",
  config    : "config                 Edit the config",
  list      : "list                   List users",
  add       : "add <user> <pass>      Add a user",
  del       : "del <user>             Delete a user",
  build     : "build                  Build client resources",
  version   : "version, -v            Print version",
};

const opts = {
  configdir : "-c, --configdir <dir>  Config directory. Default: ~/.droppy/config",
  filesdir  : "-f, --filesdir <dir>   Files directory. Default: ~/.droppy/files",
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
  console.info("Building resources ...");
  require("./server/resources.js").build(function(err) {
    console.info(err || "Resources built successfully");
    process.exit(err ? 1 : 0);
  });
}

if (argv.configdir || argv.filesdir || argv.c || argv.f) {
  require("./server/paths.js").seed(argv.configdir || argv.c, argv.filesdir || argv.f);
}

if (argv.log || argv.l) {
  const ut = require("untildify");
  const path = require("path");
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

const cmd  = argv._[0];
const args = argv._.slice(1);

if (cmds[cmd]) {
  let db;
  if (cmd === "start") {
    require("./server/server.js")(null, true, argv.dev, function(err) {
      if (err) {
        require("./server/log.js").error(err);
        process.exit(1);
      }
    });
  } else if (cmd === "version") {
    console.info(pkg.version);
  } else if (cmd === "update") {
    require("./server/update.js")(pkg, function(err, message) {
      if (err) { console.error(new Error(err.message || err).stack); process.exit(1); }
      if (message) { console.info(message); process.exit(0); }
    });
  } else if (cmd === "config") {
    const paths = require("./server/paths.js").get();
    const cfg = require("./server/cfg.js");
    const edit = function() {
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
  } else if (cmd === "list") {
    db = require("./server/db.js");
    db.init(function() {
      printUsers(db.get("users"));
    });
  } else if (cmd === "add") {
    if (args.length !== 2) return printHelp();
    db = require("./server/db.js");
    db.init(function() {
      db.addOrUpdateUser(args[0], args[1], true, function() {
        printUsers(db.get("users"));
      });
    });
  } else if (cmd === "del") {
    if (args.length !== 1) return printHelp();
    db = require("./server/db.js");
    db.init(function() {
      db.delUser(args[0], function() {
        printUsers(db.get("users"));
      });
    });
  }
} else {
  printHelp();
}

function printHelp() {
  let help = "Usage: " + pkg.name + " command [options]\n\n Commands:";

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
  const editors    = ["vim", "nano", "vi", "npp", "pico", "emacs", "notepad"];
  const basename   = require("path").basename;
  const which      = require("which");
  const userEditor = basename(process.env.VISUAL || process.env.EDITOR);

  if (editors.indexOf(userEditor) === -1) {
    editors.unshift(userEditor);
  }

  (function find(editor) {
    try {
      cb(which.sync(editor));
    } catch (err) {
      if (editors.length) {
        find(editors.shift());
      } else {
        cb();
      }
    }
  })(editors.shift());
}
