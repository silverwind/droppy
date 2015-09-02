"use strict";
var app    = require("express")();
var fs     = require("fs");

// alias the module. replace ".." with "droppy" when used as module
var droppy = require("..");

// initialze droppy with a config object
var droppyOnRequest = droppy({
  configdir: "./config",
  filesdir: "./files",
  logLevel: 3,
  debug: true
});

// write a test file
fs.writeFileSync("./files/test.txt", "Just a test!");

// start the app on http://localhost:8989/ or a port of your choice
app.use("/", droppyOnRequest).listen(process.env.PORT || 8989);
