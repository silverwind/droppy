#!/usr/bin/env node

"use strict";

var cmd, args,
    pkg   = require("./package.json"),
    argv  = require("minimist")(process.argv.slice(2), {boolean: ["color"]});

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
    home    : "--home <home>        Home directory, defaults to ~/.droppy"
};

if (argv.v || argv.version) {
    console.info(pkg.version);
    process.exit(0);
}

if (argv.home) {
    require("./server/lib/paths.js").seed(argv.home);
}

if (!argv._.length) {
    printHelp();
    process.exit(0);
}

cmd  = argv._[0];
args = argv._.slice(1);

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
        var paths = require("./server/lib/paths.js").get(),
            cfg   = require("./server/lib/cfg.js"),
            edit  = function () {
                require("child_process").spawn(process.env.EDITOR || "vim", [paths.cfgFile], {stdio: "inherit"});
            };

        require("graceful-fs").stat(paths.cfgFile, function (err) {
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
    var help = pkg.name + " " + pkg.version + " ( " + pkg.homepage + " )\n\nUsage: " + pkg.name + " [command] [options]\n\n Commands:";

    Object.keys(cmds).forEach(function (command) {
        help += "\n   " + cmds[command];
    });

    help += "\n\n Options";

    Object.keys(opts).forEach(function (option) {
        help += "\n   " + opts[option];
    });

    console.info(help);
}

function printUsers(users) {
    console.info("Current Users: " + Object.keys(users).join(", "));
}
