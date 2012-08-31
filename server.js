var http = require('http');
var fs = require('fs');
var formidable = require('formidable');

//Configuration
var fileDir = './files/';
var port = 80;

fs.mkdir(fileDir);

http.createServer(function(req, res) {
	try {
		Log("Request from " + req.socket.remoteAddress + ": " + req.url);

		if (req.method.toLowerCase() == 'post') {
			if (req.url == '/upload' ) {
				var form = new formidable.IncomingForm();
				form.uploadDir = fileDir;
				form.parse(req);
				form.on('fileBegin', function(name, file){
					file.path = form.uploadDir + "/" + file.name;
				})
				form.on('end', function(name, file){
					RedirectToRoot(res,req);
				})
			}
		} else {
			if (req.url.match(/css\.css$/g)) {
				res.end(fs.readFileSync('./css.css'));
			} else if (req.url.match(/droppy\.png$/g)) {
				res.end(fs.readFileSync('droppy.png'));
			} else if (req.url.indexOf('deletefile') >= 0) {
				filenames = fs.readdirSync(fileDir);
				num = req.url.match(/\d+/g)
				for (i = 0; i < filenames.length; i++) {
					if (i == num) {
						fs.unlink(fileDir + filenames[i]);
					}
				}
				RedirectToRoot(res,req);
			} else if (req.url.indexOf('files') >= 0 ) {
				var file = req.url;
				if (file != null) {
					fs.createReadStream("." + unescape(file), {
					  'bufferSize': 4 * 1024
					}).pipe(res)

				}
			} else {
				HTML(res,req);
			}
		}
	 } catch(err) {
		DumpError(err);
		RedirectToRoot(res,req);
	}
}).listen(port);
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
	res.write(
	'<!DOCTYPE html>' +
	'<html lang="en"><head><title>Droppy</title><link rel="stylesheet" href="css.css">' +
	'<meta http-equiv="content-type" content="text/html; charset=UTF-8"/>' +
	'<link rel="icon" type="image/png" href="http://'+ req.headers.host + '/droppy.png"></head><body>' +
	'<div id="container"><div id="header">' +
	'<form action="/upload" enctype="multipart/form-data" method="post">'+
	'<span class="uploadbutton"><input type="file" name="file" id="file" onchange="this.form.submit()" multiple="multiple" /><span class="button">Select files to upload</span></span>'+
	'</form></div><div id="content">'
	);
	filenames = fs.readdirSync(fileDir);
	for (i = 0; i < filenames.length; i++) {
		var size = BytesToSI(fs.statSync(fileDir + unescape(filenames[i])).size,2);
		var href = fileDir + unescape(filenames[i]) + '">' + filenames[i];
		res.write(  '<div id="filerow">' +
					'<span id="fileicon">&#x25B6;</span>' +
					'<span id="filename"> <a id="expander" href="' + href + '</a></span>' +
					'<span id="filesize">' + size + '</span>' +
					'<span id="filedelete">' +'<a href="deletefile/' + i + '/">&#x2716;</a>' + '</span>' +
				'<div id=right></div></div>');
	}
	res.write('</div></div>');
	res.write('<div id="footer"> created on <a id="foot" href="http://nodejs.org/">node.js</a> by <a id="foot" href="https://github.com/silverwind/">silverwind</a></div>');
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
function BytesToSI(bytes, precision)
{
	var kib = 1024;
	var mib = kib * 1024;
	var gib = mib * 1024;
	var tib = gib * 1024;

	if ((bytes >= 0) && (bytes < kib)) {
		return bytes + ' B';
	} else if ((bytes >= kib) && (bytes < mib)) {
		return (bytes / kib).toFixed(precision) + ' KiB';
	} else if ((bytes >= mib) && (bytes < gib)) {
		return (bytes / mib).toFixed(precision) + ' MiB';
	} else if ((bytes >= gib) && (bytes < tib)) {
		return (bytes / gib).toFixed(precision) + ' GiB';
	} else if (bytes >= tib) {
		return (bytes / tib).toFixed(precision) + ' TiB';
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
