"use strict";

var	fs = require('fs'),
	dot = require('dot');

exports.produceFunction = function (name, data) {
	return dot.template(data).toString().replace(/^(function )anonymous([\s\S]+)$/, name + " = $1$2;");
};

exports.parseTemplates = function (folderName, templateFileName, callback) {
	if (!callback) {
		callback = templateFileName;
		templateFileName = null;
	}
	if (templateFileName) {
		var file = fs.readFileSync(folderName + "/" + templateFileName).toString();
		callback(exports.produceFunction(templateFileName.replace(/(^[^\.\/\\]+)[\S\s]+$/, "$1"), file));
	} else {
		var out = ";(function(){",
			handleFiles = function (err, files) {
				var fileName, data;
				for (var i = files.length - 1; i >= 0; i--) {
					fileName = files[i];
					data = fs.readFileSync(folderName + "/" + fileName).toString();
					out += exports.produceFunction(fileName.replace(/(^[^\.\/\\]+)[\S\s]+$/, "$1"), data);
				}
				out += "\n}());";
				callback(out);
			};
		fs.readdir(folderName, handleFiles);
	}
};

