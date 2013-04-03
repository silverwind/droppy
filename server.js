//-----------------------------------------------------------------------------
// Droppy - File server in node.js
// https://github.com/silverwind/Droppy
//-----------------------------------------------------------------------------
// Configuration
var filesDir = './files/';	// Location to store the files. Will be created when necessary.
var port = "80";			// The listening port.
//-----------------------------------------------------------------------------
// Internal variables
var fileList = {};
var resDir = './res/';
//-----------------------------------------------------------------------------
var server = require('http').createServer(onRequest),
	formidable = require('formidable'),
	fs = require('fs'),
	io = require('socket.io').listen(server, {'log level': 1});
	mime = require('mime'),
	util = require('util')

// Set up the directory for file and start the server
fs.mkdir(filesDir, function (err) {
	if ( !err || err.code === 'EEXIST') {
		server.listen(port);
		server.on('listening', function() {
			logS('Listening on ' + server.address().address + ':' + port + '.');
		});
		server.on('error', function (err) {
			if (err.code === 'EADDRINUSE')
				logS('Failed to bind to port ' + port + '.');
			else
				logError(err);
		});
	} else {
		logError(err);
	}
});

function onRequest(req, res) {
	var method = req.method.toUpperCase();
	var remoteSocket = req.socket.remoteAddress + ':' + req.socket.remotePort;
	logS('Request from ' + remoteSocket + '\t' + method + '\t' + req.url);
	// Upload
	if (method === 'POST') {
		if (req.url == '/upload' ) {
			var form = new formidable.IncomingForm();
			form.uploadDir = filesDir;
			form.parse(req);
			form.on('fileBegin', function(name, file) {
				logS('Receiving from ' + req.socket.remoteAddress + ':\t\t' + file.name );
				file.path = form.uploadDir + '/' + file.name;
				io.sockets.emit('newfile', file.name);
			});
			form.on('end', function(name, file) {
				backToRoot(res,req);
			});
			form.on('progress', function(bytesReceived, bytesExpected) {
				percent = (bytesReceived / bytesExpected * 100) | 0;
				io.sockets.emit('progress', percent);
			});
			form.on('error', function(err) {
				errhtml = util.inspect(err);
				logS('Error: ' + errhtml)
				res.writeHead(200, {'content-type': 'text/plain'});
				res.end('error:\n\n'+ errhtml);
			})
		}
	// Download
	} else if (method == 'GET'){
		// Resource request
		if(req.url.match(/^\/res\//)) {
			var path = resDir + req.url.substring(resDir.length -1);
			fs.readFile(path, function (err, data) {
				if(!err) {
					fs.stat(path, function(err,stats){
						if(err) logError(err);
						logS('Serving to ' + remoteSocket + '\t\t' + path + ' (' + convertToSI(stats.size) + ')');
					});
					res.end(data);
				} else {
					logError(err);
					backToRoot(res,req);
				}
			});
		// File request
		} else if (req.url.match(/^\/files\//)) {
			var path = filesDir + unescape(req.url.substring(filesDir.length -1));
			if (path) {
				var mimeType = mime.lookup(path);
				fs.stat(path, function(err,stats){
					if(err) logError(err);
					logS('Serving to ' + remoteSocket + '\t\t' + path + ' (' + convertToSI(stats.size) + ')');
					res.writeHead(200, {
						'Content-Type' : mimeType,
						'Content-Length' : stats.size
					});
					fs.createReadStream(path, {
					  'bufferSize': 4 * 1024
					}).pipe(res);
				});

			}
		}
		// Delete request
		else if (req.url.match(/^\/delete\//)) {
			fs.readdir(filesDir, function(err, files){
				if(!err) {
					for (i = 0; i < files.length; i++) {
						if (i == req.url.match(/\d+/)) {
							var path = filesDir + files[i];
							logS('Deleting ' + path);
							fs.unlink(path, function(err){
								if(err) logError(err);
								backToRoot(res,req);
							});
							break;
						}
					}
				} else {
					logError(err);
					backToRoot(res,req);
				}
			});
		// Serve the page
		} else {
			getHTML(res,req);
		}
	}
}

//-----------------------------------------------------------------------------
function backToRoot(res,req) {
	res.writeHead(301, {
		'Cache-Control':	'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0',
		'Location' :		'http://' + req.headers.host
	});
	res.end();
}
//-----------------------------------------------------------------------------
function getHTML(res,req) {
	prepareFileList(ready);
	function ready() {
		function generate(data) {res.write(data + '\r\n')}
		res.writeHead(200, {'content-type': 'text/html'});
		generate('<!DOCTYPE html><html lang="en">');
		generate('<head>');
		generate('<title>Droppy</title><link rel="stylesheet" href="/res/css.css">');
		generate('<meta http-equiv="content-type" content="text/html; charset=UTF-8"/>');
		generate('<link rel="shortcut icon" type="image/png" href="/res/icon.png">');
		generate('<link href="http://fonts.googleapis.com/css?family=Open+Sans" rel="stylesheet" type="text/css">')
		generate('<script src="/socket.io/socket.io.js" type="text/javascript"></script>');
		generate('<script type="text/javascript">');
		generate('var socket = io.connect("http://' + req.headers.host + '");');
		generate('socket.on("progress", function(percentage){');
		generate('document.getElementById("progressBar").style.width = percentage + "%";});')
		generate('socket.on("newfile", function(file){');
		generate('document.getElementById("progressBar").style.width = percentage + "%";});')
		generate('</script>');
		generate('</head>');
		generate('<body>');
		generate('<div id="container"><div id="buttons">');
		generate('<div id="logo"><p id="logotext">Droppy</p></div>');
		generate('<form action="/upload" enctype="multipart/form-data" method="post">');
		generate('<div class="file-upload"><span><span id="symbol">&#11014;</span> Upload file(s)</span><input type="file" name="file" id="file" onchange="this.form.submit()" multiple="multiple" /></div>');
		generate('</form>');
		generate('<div class="add-folder"><span><span id="symbol">&#9733;</span> Create Folder</span></div><div id="progress"><div id="progressBar"></div></div></div>')
		generate('<div id="content">');
		generate(getFileList());
		generate('</div></div>');
		generate('<footer> Created on <a class="foot" href="http://nodejs.org/">node.js</a> by <a class="foot" href="https://github.com/silverwind/">silverwind</a></footer>');
		res.end('</body></html>');
	}
}
//-----------------------------------------------------------------------------
function prepareFileList(callback){
	fileList = {};
	fs.readdir(filesDir, function(err,files) {
		if(err) logError(err);
		for(i=0,len=files.length;i<len;i++){
			var name = files[i], type;
			stats = fs.statSync(filesDir + unescape(name));
			if (stats.isFile())
				type = 'f';
			if (stats.isDirectory())
				type = 'd';
			if (type == 'f' || type == 'd') {
				fileList[i] = {'name': name, 'type': type, "size" : stats.size};
			}
		}
		callback();
	});
}
//-----------------------------------------------------------------------------
function getFileList() {
	var html = '';
	var i = 0;
	while(fileList[i]) {
		var file = fileList[i];
		if(file.type == 'f') {
			var size = convertToSI(file.size);
			var name = file.name;
			var href = filesDir.substring(1) + unescape(file.name);
			html += '<div class="filerow">';
			html += '<span class="fileicon"><img src="res/file.png" alt="File"></span>';
			html += '<span class="filename"><a class="filelink" href="' + href + '">' + name + '</a></span>';
			html += '<span class="filesize">' + size + '</span>';
			html += '<span class="filedelete"><a href="delete/' + i + '/">&#x2716;</a></span>';
			html += '<div class=right></div></div>';
		} else {
			var name = file.name;
			var href = '#'; //TODO
			html += '<div class="filerow">';
			html += '<span class="fileicon"><img src="res/dir.png" alt="Directory"></span>';
			html += '<span class="filename"><a class="filelink" href="' + href + '">' + name + '</a></span>';
			html += '<span class="filesize">-</span>';
			html += '<span class="filedelete">' +'<a href="delete/' + i + '/">&#x2716;</a>' + '</span>';
			html += '<div class=right></div></div>';
		}
		i++;
	}
	return html;
}
//-----------------------------------------------------------------------------
function logS(msg) {
	console.log(getTimestamp() + msg);
}

function logError(err) {
	if (typeof err === 'object') {
		if (err.message)
			logS(err.message);
		if (err.stack)
			logS(err.stack);
	}
}
process.on('uncaughtException', function (err) {
	logS('=============== Uncaught exception! ===============');
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

	if (hours < 10) hours = '0' + hours;
	if (minutes < 10) minutes = '0' + minutes;
	if (seconds < 10) seconds = '0' + seconds;

	return day + "." + month + "." + year + " "+ hours + ":" + minutes + ":" + seconds + " ";
}
//-----------------------------------------------------------------------------
function convertToSI(bytes)
{
	var kib = 1024;
	var mib = kib * 1024;
	var gib = mib * 1024;
	var tib = gib * 1024;

	if ((bytes >= 0) && (bytes < kib))			return bytes + ' B';
	else if ((bytes >= kib) && (bytes < mib))	return (bytes / kib).toFixed(2) + ' KiB';
	else if ((bytes >= mib) && (bytes < gib))	return (bytes / mib).toFixed(2) + ' MiB';
	else if ((bytes >= gib) && (bytes < tib))	return (bytes / gib).toFixed(2) + ' GiB';
	else if (bytes >= tib)						return (bytes / tib).toFixed(2) + ' TiB';
	else 										return bytes + ' B';
}
