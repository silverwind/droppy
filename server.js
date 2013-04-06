// vim: ts=4:sw=4
//-----------------------------------------------------------------------------
// Droppy - File server in node.js
// https://github.com/silverwind/Droppy
//-----------------------------------------------------------------------------
// Configuration
var filesDir	= "./files/";	// Location to store the files. Will be created when necessary.
var useSSL		= false;		// Enables HTTPS over SSL (requires Cert and Key files)
var port		= "80";			// The listening port. (443 for SSL)
var httpsKey	= "./key.pem";	// Path to SSL private key file
var httpsCert	= "./cert.pem"; // Path to SSL Certificate file
//-----------------------------------------------------------------------------
// TODOs:
// - Remove 301 redirections and make it completely async
// - Send JSON instead of the whole HTML to the client
// - Test cases with special characters in filenames in both Windows and Linux
// - Add ability to navigate to subfolders
// - Multiple File selection
//-----------------------------------------------------------------------------
"use strict";

var fileList	= {},
	resDir		= "./res/",
	server		= null;
	fs			= require("fs"),
	formidable	= require("formidable"),
	io			= require("socket.io");
	mime		= require("mime"),
	util		= require("util");

// Read and cache the HTML and strip whitespace
var HTML = fs.readFileSync(resDir + "html.html", {"encoding": "utf8"});
HTML = HTML.replace(/(\n)/gm,"").replace(/(\t)/gm,"");

// Set up the directory for files and start the server
fs.mkdir(filesDir, function (err) {
	if ( !err || err.code === "EEXIST") {
		if(!useSSL) {
			server = require("http").createServer(onRequest);
		} else {
			var key,cert;
			try {
				key = fs.readFileSync(httpsKey);
				cert = fs.readFileSync(httpsCert);
			} catch(error) {
				logIt("Error reading required SSL certificate or key.");
				logError(error);
			}
			server = require("https").createServer({key: key, cert: cert}, onRequest);
		}
		server.listen(port);
		server.on("listening", function() {
			log("Listening on " + server.address().address + ":" + port + ".");
			io = io.listen(server, {"log level": 1});
			createWatcher();
			setupSockets();
		});
		server.on("error", function (err) {
			if (err.code === "EADDRINUSE")
				log("Failed to bind to port " + port + ".");
			else
				logError(err);
		});
	} else {
		logError(err);
	}

});

function setUpServer() {

}
//-----------------------------------------------------------------------------
// Watch the directory for realtime changes and send them to the client.
function createWatcher() {
	fs.watch(filesDir,{ persistent: true }, function(event,filename){
		if(event == "change" || event == "rename") {
			prepareFileList(function(){
				throttle(SendUpdate(),500);
			});
		}
	});
}
//-----------------------------------------------------------------------------
// Send file list HTML over websocket
function SendUpdate() {
	io.sockets.emit("UPDATE_FILES", getFileList());
}
//-----------------------------------------------------------------------------
// Websocket listener
function setupSockets() {
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
}
//-----------------------------------------------------------------------------
function onRequest(req, res) {
	var method = req.method.toUpperCase();
	var remoteSocket = req.socket.remoteAddress + ":" + req.socket.remotePort;
	log("Request from " + remoteSocket + "\t" + method + "\t" + req.url);
	// Upload
	if (method === "POST") {
		if (req.url == "/upload" ) {
			var form = new formidable.IncomingForm();
			form.uploadDir = filesDir;
			form.parse(req);
			form.on("fileBegin", function(name, file) {
				log("Receiving from " + req.socket.remoteAddress + ":\t\t" + file.name );
				file.path = form.uploadDir + "/" + file.name;
			});

			var lastPerc = 0, perc = 0;
			form.on("progress", function(bytesReceived, bytesExpected) {
				perc = Math.abs((bytesReceived / bytesExpected * 100)) | 0;
				if (perc > lastPerc){
					lastPerc = perc;
					io.sockets.emit("UPLOAD_PROGRESS", perc);
					log(perc);
					if (perc == 100) lastPerc = 0;
				}
			});
			form.on("end", function(name, file) {
				backToRoot(res);
			});
			form.on("error", function(err) {
				logError(err);
				backToRoot(res);
			});
		}
	// Download
	} else if (method == "GET"){
		var path;
		// Resource request
		if(req.url.match(/^\/res\//)) {
			path = resDir + unescape(req.url.substring(resDir.length -1));
			fs.readFile(path, function (err, data) {
				if(!err) {
					fs.stat(path, function(err,stats){
						if(err) logError(err);
						log("Serving to " + remoteSocket + "\t\t" + path + " (" + convertToSI(stats.size) + ")");
					});
					res.end(data);
				} else {
					logError(err);
					backToRoot(res);
				}
			});
		// File request
		} else if (req.url.match(/^\/files\//)) {
			path = filesDir + unescape(req.url.substring(filesDir.length -1));
			if (path) {
				var mimeType = mime.lookup(path);
				fs.stat(path, function(err,stats){
					if(err) logError(err);
					if (!stats){
						backToRoot(res);
						SendUpdate();
					}
					log("Serving to " + remoteSocket + "\t\t" + path + " (" + convertToSI(stats.size) + ")");
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
					path = filesDir + req.url.replace(/^\/delete\//,"");
					log("Deleting " + path);
					try {
						var stats = fs.statSync(unescape(path));
						if (stats.isFile()) {
							fs.unlink(unescape(path), function(err){
								if(err) logError(err);
								backToRoot(res);
							});
						} else if (stats.isDirectory()){
							fs.rmdir(unescape(path), function(err){
								if(err) logError(err);
								backToRoot(res);
							});
						}
					} catch(error) {
						logError(error);
						backToRoot(res);
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
		function generate(data) {
			res.write(data);
		}
		res.writeHead(200, {"content-type": "text/html"});
		res.end(HTML);
	},res);
}
//-----------------------------------------------------------------------------
function prepareFileList(callback,res){
	fileList = {};
	fs.readdir(filesDir, function(err,files) {
		if(err) logError(err);
		for(i=0,len=files.length;i<len;i++){
			var name = files[i], type;
			try{
				var stats = fs.statSync(filesDir + name);
				if (stats.isFile())
					type = "f";
				if (stats.isDirectory())
					type = "d";
				if (type == "f" || type == "d") {
					fileList[i] = {"name": name, "type": type, "size" : stats.size};
				}
			} catch(error) {
				logError(error);
				backToRoot(res);
			}
		}
		callback();
	});
}
//-----------------------------------------------------------------------------
function getFileList() {
	var htmlFiles = "";
	var htmlDirs = "";
	var header = '<div class="fileheader"><div class="fileicon">Name</div><div class="filename">&nbsp;</div><div class="fileinfo">Size<span class="headerspacer">Del</span></div><div class=right></div></div>';
	var i = 0;
	var name, href;
	while(fileList[i]) {
		var file = fileList[i];
		if(file.type == "f") {
			var size = convertToSI(file.size);
			name = file.name;
			href = filesDir.substring(1) + unescape(file.name);
			htmlFiles += '<div class="filerow">';
			htmlFiles += '<div class="fileicon" title="File"><img src="res/file.png" alt="File"></div>';
			htmlFiles += '<div class="filename"><a class="filelink" href="' + href + '">' + name + '</a></div>';
			htmlFiles += '<div class="fileinfo">' + size + '<span class="spacer"></span><a href="delete/' + name + '">&#x2716;</div>';
			htmlFiles += '<div class=right></div></div>';
		} else {
			name = file.name;
			href = '#'; //TODO
			htmlDirs += '<div class="filerow">';
			htmlDirs += '<div class="fileicon" title="Directory"><img src="res/dir.png" alt="Directory"></div>';
			htmlDirs += '<div class="filename"><a class="filelink" href="' + href + '">' + name + '</a></div>';
			htmlDirs += '<div class="fileinfo">-<span class="spacer"></span><a href="delete/' + name + '">&#x2716;</div>';
			htmlDirs += '<div class=right></div></div>';
		}
		i++;
	}
	return header + htmlDirs + htmlFiles;
}
//-----------------------------------------------------------------------------
function log(msg) {
	console.log(getTimestamp() + msg);
}

function logError(err) {
	if (typeof err === "object") {
		if (err.message)
			log(err.message);
		if (err.stack)
			log(err.stack);
	}
}

process.on("uncaughtException", function (err) {
	log("=============== Uncaught exception! ===============");
	logError(err);
});
//-----------------------------------------------------------------------------
//Throttle helper function
//Source: http://remysharp.com/2010/07/21/throttling-function-calls/
function throttle(fn, threshhold, scope) {
	if(!threshhold) threshhold = 250;
	var last,deferTimer;
	return function () {
		var context = scope || this;
		var now = new Date();
		var args = arguments;
		if (last && now < last + threshhold) {
			clearTimeout(deferTimer);
			deferTimer = setTimeout(function () {
				last = now;
				fn.apply(context, args);
			}, threshhold);
		} else {
			last = now;
			fn.apply(context, args);
		}
	};
}
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

	return month + "/" + day + "/" + year + " "+ hours + ":" + minutes + ":" + seconds + " ";
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
	else										return bytes + " B";
}
