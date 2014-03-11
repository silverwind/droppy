var
	fs = require('fs'),
	dot = require('dot');

exports.parseTemplates = function(folderName, templateName, callback) {
	if (!callback) {
		callback = templateName;
		templateName = null;
	}
	if (templateName) {
		var file = fs.readFileSync(folderName + "/" + templateName).toString();
		callback(file);
	} else {
		//fs.readdir(folderName)
	}
}

exports.parseTemplates("../src/templates", "image.html", function(data) {
	console.log(data);
});