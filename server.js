//-----------------------------------------------------------------------------
// Droppy - File server in node.js
// https://github.com/silverwind/Droppy
//-----------------------------------------------------------------------------
// Configuration
var fileDir = './files/';
var port = 80;
//-----------------------------------------------------------------------------
// Here be dragons
var app = require('http').createServer(RequestHandler)
	, io = require('socket.io').listen(app)
	, mime = require('mime')
	, formidable = require('formidable')
	, fs = require('fs')

fs.mkdir(fileDir);
app.listen(port);
process.setMaxListeners(0);

function RequestHandler(req, res) {
	try {
		Log("Got request from " + req.socket.remoteAddress + ": " + req.url);
		if (req.method.toLowerCase() == 'post') {
			if (req.url == '/upload' ) {
				var form = new formidable.IncomingForm();
				form.uploadDir = fileDir;
				form.parse(req);
				form.on('fileBegin', function(name, file){
					file.path = form.uploadDir + "/" + file.name;
					Log("Receiving " + file.path + " from " + req.socket.remoteAddress + ".");
				});
				form.on('end', function(name, file){
					RedirectToRoot(res,req);
				});
				form.on('progress', function(bytesReceived, bytesExpected){
					percent = (bytesReceived / bytesExpected * 100) | 0;
					io.sockets.emit('progress', percent);
				});
			}
		} else {
			if (req.url.match(/css\.css$/g)) {
				res.end(fs.readFileSync('./res/css.css'));
			} else if (req.url.indexOf('deletefile') >= 0) {
				filenames = fs.readdirSync(fileDir);
				num = req.url.match(/\d+/g)
				for (i = 0; i < filenames.length; i++) {
					if (i == num) {
						var path = fileDir + filenames[i]
						fs.unlink(path);
						Log("Deleting " + path);
					}
				}
				RedirectToRoot(res,req);
			} else if (req.url.indexOf('files') >= 0 ) {
				var file = req.url;
				if (file != null) {
					var path = "." + unescape(file);
					var mimeType = mime.lookup(path);
					var size = fs.statSync(path).size;
					Log("Sending " + path + " to " + req.socket.remoteAddress + " (" + BytesToSI(size) + ").");
					res.writeHead(200, {
						'Content-Type' : mimeType,
						'Content-Length' : size
					});
					fs.createReadStream(path, {
					  'bufferSize': 4 * 1024
					}).pipe(res);
				}
			} else {
				HTML(res,req);
			}
		}
	 } catch(err) {
		DumpError(err);
		RedirectToRoot(res,req);
	}
}

Log("Droppy: Listening on port " + port + ".")
//-----------------------------------------------------------------------------
function RedirectToRoot(res,req) {
	try {
		res.statusCode = 301;
		res.setHeader('Cache-Control', 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0');
		res.setHeader('Location', 'http://' + req.headers.host);
	} catch(err) {
		DumpError(err);
	}
	res.end();
}
//-----------------------------------------------------------------------------
function HTML(res,req) {
	res.writeHead(200, {'content-type': 'text/html'});
	res.write('<!DOCTYPE html><html lang="en">');
	res.write('<head>');
		res.write('<title>Droppy</title><link rel="stylesheet" href="css.css">');
		res.write('<meta http-equiv="content-type" content="text/html; charset=UTF-8"/>');
		res.write('<link rel="icon" type="image/png" href="data:image/png;base64,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">');
			res.write('<script src="/socket.io/socket.io.js"></script>');
			res.write('<script>');
			res.write(' var socket = io.connect("http://localhost/");');
			res.write('	socket.on("progress" , function(percent){');
			res.write(' document.getElementById("progressBar").setAttribute("value",percent);')
			res.write(' });');
			res.write('</script>');
	res.write('</head>');
	res.write('<body>');
		res.write('<div id="container"><div id="header">');
		res.write('<form action="/upload" enctype="multipart/form-data" method="post">');
		res.write('<span class="uploadbutton"><input type="file" name="file" id="file" onchange="this.form.submit()" multiple="multiple" />');
		res.write('<span class="button">Select files to upload</span></span>');
		res.write('</form></div><progress id="progressBar" max="100" value="0"><strong>Progress: 0% done.</strong></progress><div id="content">');

		filenames = fs.readdirSync(fileDir);
		for (i = 0; i < filenames.length; i++) {
			var size = BytesToSI(fs.statSync(fileDir + unescape(filenames[i])).size);
			var href = fileDir + unescape(filenames[i]) + '">' + filenames[i];
			res.write('<div id="filerow">');
			res.write('<span id="fileicon">&#x25B6;</span>');
			res.write('<span id="filename"> <a id="expander" href="' + href + '</a></span>');
			res.write('<span id="filesize">' + size + '</span>');
			res.write('<span id="filedelete">' +'<a href="deletefile/' + i + '/">&#x2716;</a>' + '</span>');
			res.write('<div id=right></div></div>');
		}
		res.write('</div></div>');
		res.write('<div id="footer"> Created on <a id="foot" href="http://nodejs.org/">node.js</a> by <a id="foot" href="https://github.com/silverwind/">silverwind</a></div>');
	res.end('</body></html>');
}
//-----------------------------------------------------------------------------
function Log(msg) {
	console.log(GetTimestamp() + msg)
}
//-----------------------------------------------------------------------------
function GetTimestamp() {
	var currentDate = new Date()
	var day = currentDate.getDate()
	var month = currentDate.getMonth() + 1
	var year = currentDate.getFullYear()
	var hours = currentDate.getHours()
	var minutes = currentDate.getMinutes()
	return day + "/" + month + "/" + year + " "+ hours + ":" + minutes + " -> ";
}
//-----------------------------------------------------------------------------
function BytesToSI(bytes)
{
	var kib = 1024;
	var mib = kib * 1024;
	var gib = mib * 1024;
	var tib = gib * 1024;

	if ((bytes >= 0) && (bytes < kib)) {
		return bytes + ' B';
	} else if ((bytes >= kib) && (bytes < mib)) {
		return (bytes / kib).toFixed(2) + ' KiB';
	} else if ((bytes >= mib) && (bytes < gib)) {
		return (bytes / mib).toFixed(2) + ' MiB';
	} else if ((bytes >= gib) && (bytes < tib)) {
		return (bytes / gib).toFixed(2) + ' GiB';
	} else if (bytes >= tib) {
		return (bytes / tib).toFixed(2) + ' TiB';
	} else {
		return bytes + ' B';
	}
}
//-----------------------------------------------------------------------------
function DumpError(err) {
	if (typeof err === 'object') {
		if (err.message)
			Log(err.message);
		if (err.stack)
			Log(err.stack);
	}
}
