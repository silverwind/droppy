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
			} else if (req.url.match(/droppy\.png$/g)) {
				res.end(fs.readFileSync('./res/droppy.png'));
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
		res.end();
	} catch(err) {
		DumpError(err);
	}
}
//-----------------------------------------------------------------------------
function HTML(res,req) {
	res.writeHead(200, {'content-type': 'text/html'});
	res.write('<!DOCTYPE html><html lang="en">');
	res.write('<head>');
		res.write('<title>Droppy</title><link rel="stylesheet" href="css.css">');
		res.write('<meta http-equiv="content-type" content="text/html; charset=UTF-8"/>');
		res.write('<link rel="icon" type="image/png" href="http://'+ req.headers.host + '/droppy.png">');
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
