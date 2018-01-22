"use strict";
const app = require("express")();
const fs = require("fs");

// alias the module. replace ".." with "droppy" when used as module
const droppy = require("..");

// initialze droppy with a config object
const droppyOnRequest = droppy({
  configdir: "./config",
  filesdir: "./files",
  logLevel: 3,
  debug: true
});

// write a test file
fs.writeFileSync("./files/test.txt", "Just a test!");

// start the app on http://localhost:8989/ or a port of your choice
app.use("/", droppyOnRequest).listen(process.env.PORT || 8989);
