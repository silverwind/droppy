"use strict";
var app    = require("express")();
var fs     = require("fs");

// alias the module. replace ".." with "droppy" when used as module
var droppy = require("..");

// initialze droppy with a config object
// protip: use logLevel: 0 to supress all logging
var droppyOnRequest = droppy("./home", {logLevel: 3, debug: true});

// write a test file
fs.writeFileSync("./home/files/test.txt", "Just a test!");

// start the app on http://localhost:8989/
app.use("/", droppyOnRequest).listen(8989);
