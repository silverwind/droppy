var
	fs = require('fs'),
	dot = require('dot');
produceFunction = function(name, data) {
	return dot.template(data).toString().replace(/^(function )anonymous([\s\S]+)$/, name + " = $1$2;");
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
		//fs.readdir(folderName)
	}
}

exports.parseTemplates("../src/templates", "document.html", function(data) {
	console.log(data);
});