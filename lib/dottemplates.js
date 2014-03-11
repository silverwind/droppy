var
	fs = require('fs'),
	dot = require('dot');
produceFunction = function(name, data) {
	return dot.template(data).toString().replace(/^(function )anonymous([\s\S]+)$/, "t." + name + " = $1$2;");
}
exports.parseTemplates = function(folderName, templateFileName, callback) {
	if (!callback) {
		callback = templateFileName;
		templateFileName = null;
	}
	if (templateFileName) {
		var file = fs.readFileSync(folderName + "/" + templateFileName).toString();
		callback(produceFunction(templateFileName.replace(/(^[^\.\/\\]+)[\S\s]+$/,"$1"), file));
	} else {
		var out = ";var t = {}; (function(){",
			handleFiles = function (err, files) {
				var fileName, data;
				for (var i = files.length - 1; i >= 0; i--) {
					fileName = files[i];
					data = fs.readFileSync(folderName + "/" + fileName).toString();
					out += produceFunction(fileName.replace(/(^[^\.\/\\]+)[\S\s]+$/,"$1"), data);
				};

				out += "\n}());"
				callback(out);
			}
		fs.readdir(folderName, handleFiles);
	}
}

exports.parseTemplates("../src/templates", function(data) {
	console.log(data);
});