"use strict";

var fs  = require("graceful-fs"),
    dot = require("dot"),
    produceFunction = function (name, data) {
        return dot.template(data).toString().replace(/^(function )anonymous([\s\S]+)$/, name + " = $1$2;");
    },
    parseTemplates = function (folderName, templateFileName, callback) {
        if (!callback) {
            callback = templateFileName;
            templateFileName = null;
        }
        if (templateFileName) {
            var file = fs.readFileSync(folderName + "/" + templateFileName).toString();
            callback(produceFunction(templateFileName.replace(/(^[^\.\/\\]+)[\S\s]+$/, "$1"), file));
        } else {
            var out = ";(function(){",
                handleFiles = function (err, files) {
                    files.forEach(function (fileName) {
                        var data = fs.readFileSync(folderName + "/" + fileName).toString();
                        out += produceFunction(fileName.replace(/(^[^\.\/\\]+)[\S\s]+$/, "$1"), data);
                    });
                    out += "\n}());";
                    callback(out);
                };
            fs.readdir(folderName, handleFiles);
        }
    };

exports.produceFunction = produceFunction;
exports.parseTemplates = parseTemplates;
