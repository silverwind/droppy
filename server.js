//-----------------------------------------------------------------------------
// Droppy - File server in node.js
// https://github.com/silverwind/Droppy
//-----------------------------------------------------------------------------
// Configuration
var filesDir = "./files/";	// Location to store the files. Will be created when necessary.
var port = "80";			// The listening port.
//-----------------------------------------------------------------------------
// Internal variables
var fileList = {};
var resDir = "./res/";
var HTML = "";
//-----------------------------------------------------------------------------
"use strict";

var server = require("http").createServer(onRequest),
	formidable = require("formidable"),
	fs = require("fs"),
	io = require("socket.io").listen(server, {"log level": 1});
	mime = require("mime"),
	util = require("util")

// Read the HTML and strip whitespace
HTML = fs.readFileSync(resDir + "html.html",{"encoding": "utf8"});
HTML = HTML.replace(/(\n)/gm,"").replace(/(\t)/gm,"");

// Set up the directory for file and start the server
fs.mkdir(filesDir, function (err) {
	if ( !err || err.code === "EEXIST") {
		server.listen(port);
		server.on("listening", function() {
			logIt("Listening on " + server.address().address + ":" + port + ".");
			createWatcher();
		});
		server.on("error", function (err) {
			if (err.code === "EADDRINUSE")
				logIt("Failed to bind to port " + port + ".");
			else
				logError(err);
		});
	} else {
		logError(err);
	}
});

function createWatcher() {
	fs.watch(filesDir,{ persistent: true }, function(event,filename){
		//Watch the directory for changes. "rename" triggers on deletes too.
		if(event == "change" || event == "rename") {
			prepareFileList(function(){
				SendUpdate();
			});
		}
	});
}

function SendUpdate() {
	io.sockets.emit("UPDATE_FILES", getFileList());
}

io.sockets.on("connection", function (socket) {
	socket.on("REQUEST_UPDATE", function (data) {
		SendUpdate();
	});
	socket.on("CREATE_FOLDER", function (name) {
		fs.mkdir(filesDir + name, null, function(err){
			if(err) logError(err);
		});
	});
});

function onRequest(req, res) {
	var method = req.method.toUpperCase();
	var remoteSocket = req.socket.remoteAddress + ":" + req.socket.remotePort;
	logIt("Request from " + remoteSocket + "\t" + method + "\t" + req.url);
	// Upload
	if (method === "POST") {
		if (req.url == "/upload" ) {
			var form = new formidable.IncomingForm();
			form.uploadDir = filesDir;
			form.parse(req);
			form.on("fileBegin", function(name, file) {
				logIt("Receiving from " + req.socket.remoteAddress + ":\t\t" + file.name );
				file.path = form.uploadDir + "/" + file.name;
			});

			var lastPerc = 0, perc = 0;
			form.on("progress", function(bytesReceived, bytesExpected) {
				perc = Math.abs((bytesReceived / bytesExpected * 100)) | 0;
				if (perc > lastPerc){
					lastPerc = perc;
					io.sockets.emit("UPLOAD_PROGRESS", perc);
					logIt(perc);
					if (perc == 100) lastPerc = 0;
				}
			});
			form.on("end", function(name, file) {
				backToRoot(res);
			});
			form.on("error", function(err) {
				logError(err);
				backToRoot(res);
			})
		}
	// Download
	} else if (method == "GET"){
		// Resource request
		if(req.url.match(/^\/res\//)) {
			var path = resDir + req.url.substring(resDir.length -1);
			fs.readFile(path, function (err, data) {
				if(!err) {
					fs.stat(path, function(err,stats){
						if(err) logError(err);
						logIt("Serving to " + remoteSocket + "\t\t" + path + " (" + convertToSI(stats.size) + ")");
					});
					res.end(data);
				} else {
					logError(err);
					backToRoot(res);
				}
			});
		// File request
		} else if (req.url.match(/^\/files\//)) {
			var path = filesDir + unescape(req.url.substring(filesDir.length -1));
			if (path) {
				var mimeType = mime.lookup(path);
				fs.stat(path, function(err,stats){
					if(err) logError(err);
					if (!stats){
						backToRoot(res);
						SendUpdate();
					}
					logIt("Serving to " + remoteSocket + "\t\t" + path + " (" + convertToSI(stats.size) + ")");
					res.writeHead(200, {
						"Content-Type"		: mimeType,
						"Content-Length"	: stats.size
					});
					fs.createReadStream(path, {"bufferSize": 4096}).pipe(res);
				});

			}
		}
		// Delete request
		else if (req.url.match(/^\/delete\//)) {
			fs.readdir(filesDir, function(err, files){
				if(!err) {
					var path = filesDir + req.url.replace(/^\/delete\//,"");

					logIt("Deleting " + path);
					try{
						var stats = fs.statSync(path);
					} catch(err) {
						logError(err);
						backToRoot(res);
					}

					if (stats.isFile()) {
						fs.unlink(path, function(err){
							if(err) logError(err);
							backToRoot(res);
						});
					} else if (stats.isDirectory()){
						fs.rmdir(path, function(err){
							if(err) logError(err);
							backToRoot(res);
						});
					}
				} else {
					logError(err);
					backToRoot(res);
				}
			});
		// Serve the page
		} else {
			getHTML(res,req);
		}
	}
}

//-----------------------------------------------------------------------------
function backToRoot(res) {
	res.writeHead(301, {
		"Cache-Control":	"no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0",
		"Location" :		"/"
	});
	res.end();
}
//-----------------------------------------------------------------------------
function getHTML(res) {
	prepareFileList(function () {
		function generate(data) {res.write(data)}
		res.writeHead(200, {"content-type": "text/html"});
		res.end(HTML);
	});
}
//-----------------------------------------------------------------------------
function prepareFileList(callback){
	fileList = {};
	fs.readdir(filesDir, function(err,files) {
		if(err) logError(err);
		for(i=0,len=files.length;i<len;i++){
			var name = files[i], type;
			try{
				var stats = fs.statSync(ilesDir + name);
			} catch(err) {
				logError(err);
				backToRoot(res);
			}
			if (stats.isFile())
				type = "f";
			if (stats.isDirectory())
				type = "d";
			if (type == "f" || type == "d") {
				fileList[i] = {"name": name, "type": type, "size" : stats.size};
			}
		}
		callback();
	});
}
//-----------------------------------------------------------------------------
function getFileList() {
	var htmlfiles = "";
	var htmlDirs = "";
	var i = 0;
	while(fileList[i]) {
		var file = fileList[i];
		if(file.type == "f") {
			var size = convertToSI(file.size);
			var name = file.name;
			var href = filesDir.substring(1) + unescape(file.name);
			htmlfiles += '<div class="filerow">';
			htmlfiles += '<span class="fileicon" title="File"><img src="res/file.png" alt="File"></span>';
			htmlfiles += '<span class="filename"><a class="filelink" href="' + href + '">' + name + '</a></span>';
			htmlfiles += '<span class="filesize">' + size + '</span>';
			htmlfiles += '<span class="filedelete" title="Delete file"><a href="delete/' + name + '">&#x2716;</a></span>';
			htmlfiles += '<div class=right></div></div>';
		} else {
			var name = file.name;
			var href = '#'; //TODO
			htmlDirs += '<div class="filerow">';
			htmlDirs += '<span class="fileicon" title="Directory"><img src="res/dir.png" alt="Directory"></span>';
			htmlDirs += '<span class="filename"><a class="filelink" href="' + href + '">' + name + '</a></span>';
			htmlDirs += '<span class="filesize">-</span>';
			htmlDirs += '<span class="filedelete" title="Delete directory">' +'<a href="delete/' + name + '/">&#x2716;</a>' + '</span>';
			htmlDirs += '<div class=right></div></div>';
		}
		i++;
	}
	return htmlDirs + htmlfiles;
}
//-----------------------------------------------------------------------------
function logIt(msg) {
	console.log(getTimestamp() + msg);
}

function logError(err) {
	if (typeof err === "object") {
		if (err.message)
			logIt(err.message);
		if (err.stack)
			logIt(err.stack);
	}
}
process.on("uncaughtException", function (err) {
	logIt("=============== Uncaught exception! ===============");
	logError(err);
});
//-----------------------------------------------------------------------------
function getTimestamp() {
	var currentDate = new Date();
	var day = currentDate.getDate();
	var month = currentDate.getMonth() + 1;
	var year = currentDate.getFullYear();
	var hours = currentDate.getHours();
	var minutes = currentDate.getMinutes();
	var seconds = currentDate.getSeconds();

	if (hours < 10) hours = "0" + hours;
	if (minutes < 10) minutes = "0" + minutes;
	if (seconds < 10) seconds = "0" + seconds;

	return day + "." + month + "." + year + " "+ hours + ":" + minutes + ":" + seconds + " ";
}
//-----------------------------------------------------------------------------
function convertToSI(bytes)
{
	var kib = 1024;
	var mib = kib * 1024;
	var gib = mib * 1024;
	var tib = gib * 1024;

	if ((bytes >= 0) && (bytes < kib))			return bytes + " B";
	else if ((bytes >= kib) && (bytes < mib))	return (bytes / kib).toFixed(2) + " KiB";
	else if ((bytes >= mib) && (bytes < gib))	return (bytes / mib).toFixed(2) + " MiB";
	else if ((bytes >= gib) && (bytes < tib))	return (bytes / gib).toFixed(2) + " GiB";
	else if (bytes >= tib)						return (bytes / tib).toFixed(2) + " TiB";
	else 										return bytes + " B";
}
