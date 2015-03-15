"use strict";
var app    = require("express")();
var fs     = require("fs");
var droppy = require("../")("./home", {logLevel: 3, debug: true});

fs.writeFile("./home/files/test.txt", "Just a test!");

app.use("/", droppy).listen(8989);
