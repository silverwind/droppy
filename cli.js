#!/usr/bin/env node

"use strict";

var cmd   = process.argv[2],
    args  = process.argv.slice(3),
    pkg   = require("./package.json");

var cmds = {
    start   : "start                  Start the server",
    update  : "update                 Update the server",
    config  : "config                 Edit the config",
    list    : "list                   List users",
    add     : "add <user> <pass>      Add a user",
    del     : "del <user>             Delete a user",
    version : "version                Print version"
};

function printHelp() {
    var help = pkg.name + " " + pkg.version + " ( " + pkg.homepage + " )\n\nUsage: droppy [command] [options]\n\n Commands:";

    Object.keys(cmds).forEach(function (command) {
        help += "\n   " + cmds[command];
    });
    console.info(help);
}
if (cmds[cmd]) {
    switch (cmd) {
    case "version":
        console.info(pkg.version);
        break;
    case "config":
        var paths = require("./server/lib/paths.js");
        require("child_process").spawn(process.env.EDITOR || "vim", [paths.cfg], {stdio: "inherit"});
        break;
    case "update":
        require("./server/lib/update.js")(pkg, function (err, message) {
            if (err) { console.error(err); process.exit(1); }
            if (message) { console.info(message); process.exit(0); }
        });
        break;
    case "list":
        var db = require("./server/lib/db.js");
        db.init(function () {
            console.log("Current Users: " + Object.keys(db.get("users")).join(", "));
        });
        break;
    case "add":
        if (args.length !== 2) return printHelp();
        var db = require("./server/lib/db.js");
        db.init(function () {
            db.addOrUpdateUser(args[0], args[1], true, function () {
                console.log("Current Users: " + Object.keys(db.get("users")).join(", "));
            });
        });
        break;
    case "del":
        if (args.length !== 1) return printHelp();
        var db = require("./server/lib/db.js");
        db.init(function () {
            db.delUser(args[0], function () {
                console.log("Current Users: " + Object.keys(db.get("users")).join(", "));
            });
        });
        break;
    }

} else {
    printHelp();
}
