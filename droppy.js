#!/usr/bin/env node
"use strict";

const fs = require("fs");
const pkg = require("./package.json");
const untildify = require("untildify");
const path = require("path");

require("util").inspect.defaultOptions.depth = 4;

const argv = require("minimist")(process.argv.slice(2), {
  boolean: ["color", "d", "daemon", "dev"]
});

if (!argv.dev) {
  process.env.NODE_ENV = "production";
}

process.title = pkg.name;
process.chdir(__dirname);

const cmds = {
  start: "start                  Start the server",
  stop: "stop                   Stop all daemonized servers",
  config: "config                 Edit the config",
  list: "list                   List users",
  add: "add <user> <pass> [p]  Add or update a user. Specify 'p' for privileged",
  del: "del <user>             Delete a user",
  build: "build                  Build client resources",
  version: "version, -v            Print version",
};

const opts = {
  configdir: "-c, --configdir <dir>  Config directory. Default: ~/.droppy/config",
  filesdir: "-f, --filesdir <dir>   Files directory. Default: ~/.droppy/files",
  daemon: "-d, --daemon           Daemonize (background) process",
  log: "-l, --log <file>       Log to file instead of stdout",
  dev: "--dev                  Enable developing mode",
  color: "--color                Force-enable colored log output",
  nocolor: "--no-color             Force-disable colored log output",
};

if (argv.v || argv.V || argv.version) {
  console.info(pkg.version);
  process.exit(0);
}

if (argv.daemon || argv.d) {
  require("daemonize-process")();
}

if (argv._[0] === "build") {
  console.info("Building resources ...");
  require("./server/resources.js").build(err => {
    console.info(err || "Resources built successfully");
    process.exit(err ? 1 : 0);
  });
}

if (argv.configdir || argv.filesdir || argv.c || argv.f) {
  require("./server/paths.js").seed(argv.configdir || argv.c, argv.filesdir || argv.f);
}

if (argv.log || argv.l) {
  try {
    require("./server/log.js").setLogFile(fs.openSync(untildify(path.resolve(argv.log || argv.l)), "a", "644"));
  } catch (err) {
    console.error(`Unable to open log file for writing: ${err.message}`);
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
    require("./server/server.js")(null, true, argv.dev, err => {
      if (err) {
        require("./server/log.js").error(err);
        process.exit(1);
      }
    });
  } else if (cmd === "stop") {
    const ps = require("ps-node");
    const log = require("./server/log.js");
    ps.lookup({command: pkg.name}, async (err, procs) => {
      if (err) {
        log.error(err);
        process.exit(1);
      } else {
        procs = procs.filter(proc => Number(proc.pid) !== process.pid);
        if (!procs.length) {
          log.info("No processes found");
          process.exit(0);
        }

        const pids = await Promise.all(procs.map(proc => {
          return new Promise(resolve => {
            ps.kill(proc.pid, err => {
              if (err) {
                log.error(err);
                return process.exit(1);
              }
              resolve(proc.pid);
            });
          });
        }));

        if (pids.length) {
          console.info(`Killed PIDs: ${pids.join(", ")}`);
        }
        process.exit(0);
      }
    });
  } else if (cmd === "version") {
    console.info(pkg.version);
  } else if (cmd === "config") {
    const paths = require("./server/paths.js").get();
    const cfg = require("./server/cfg.js");
    const edit = function() {
      findEditor(editor => {
        if (!editor) return console.error(`No suitable editor found, please edit ${paths.cfgFile}`);
        require("child_process").spawn(editor, [paths.cfgFile], {stdio: "inherit"});
      });
    };
    fs.stat(paths.cfgFile, err => {
      if (err && err.code === "ENOENT") {
        fs.mkdir(paths.config, {recursive: true}, () => {
          cfg.init(null, err => {
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
    db.load(() => {
      printUsers(db.get("users"));
    });
  } else if (cmd === "add") {
    if (args.length !== 2 && args.length !== 3) printHelp();
    db = require("./server/db.js");
    db.load(() => {
      db.addOrUpdateUser(args[0], args[1], args[2] === "p", () => {
        printUsers(db.get("users"));
      });
    });
  } else if (cmd === "del") {
    if (args.length !== 1) printHelp();
    db = require("./server/db.js");
    db.load(() => {
      db.delUser(args[0], () => {
        printUsers(db.get("users"));
      });
    });
  }
} else {
  printHelp();
}

function printHelp() {
  let help = `Usage: ${pkg.name} command [options]\n\n Commands:`;

  Object.keys(cmds).forEach(command => {
    help += `\n   ${cmds[command]}`;
  });

  help += "\n\n Options:";

  Object.keys(opts).forEach(option => {
    help += `\n   ${opts[option]}`;
  });

  console.info(help);
  process.exit();
}

function printUsers(users) {
  if (Object.keys(users).length === 0) {
    console.info("No users defined. Use 'add' to add one.");
  } else {
    console.info(`Current Users:\n${Object.keys(users).map(user => {
      return `  - ${user}`;
    }).join("\n")}`);
  }
}

function findEditor(cb) {
  const editors    = ["vim", "nano", "vi", "npp", "pico", "emacs", "notepad"];
  const basename   = require("path").basename;
  const which      = require("which");
  const userEditor = basename(process.env.VISUAL || process.env.EDITOR);

  if (!editors.includes(userEditor)) {
    editors.unshift(userEditor);
  }

  (function find(editor) {
    try {
      cb(which.sync(editor));
    } catch {
      if (editors.length) {
        find(editors.shift());
      } else {
        cb();
      }
    }
  })(editors.shift());
}
