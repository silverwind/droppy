//-----------------------------------------------------------------------------
// Droppy - File server in node.js
// https://github.com/silverwind/Droppy
//-----------------------------------------------------------------------------
// TODOs:
// - Test cases with special characters in filenames in both Windows and Linux
// - Multiple file operations like delete/move
// - Media queries (if needed)
// - Authentication
// - gzip compression
// - Check for any XSS
//-----------------------------------------------------------------------------
// vim: ts=4:sw=4
// jshint indent:4
"use strict";

var fileList       = {},
    cache          = {},
    server         = null,
    last           = null,
    clientFolders  = {},
    watchedDirs    = {},
    fs             = require("fs"),
    formidable     = require("formidable"),
    io             = require("socket.io"),
    mime           = require("mime"),
    util           = require("util"),
    config         = require("./config.json");

// Read and cache the HTML and strip whitespace
cache.HTML = fs.readFileSync(config.resDir + "html.html", {"encoding": "utf8"});
cache.HTML.replace(/(\n)/gm,"").replace(/(\t)/gm,"");

//-----------------------------------------------------------------------------
// Set up the directory for files and start the server
fs.mkdir(config.filesDir, function (err) {
    if ( !err || err.code === "EEXIST") {
        if(!config.useSSL) {
            server = require("http").createServer(onRequest);
        } else {
            var key, cert;
            try {
                key = fs.readFileSync(config.httpsKey);
                cert = fs.readFileSync(config.httpsCert);
            } catch(error) {
                log("Error reading required SSL certificate or key.");
                handleError(error);
            }
            server = require("https").createServer({key: key, cert: cert}, onRequest);
        }
        server.listen(config.port);
        server.on("listening", function() {
            log("Listening on " + server.address().address + ":" + config.port);
            io = io.listen(server, {"log level": 1});
            createWatcher("/");
            prepareFileList(sendUpdate,"/");
            setupSocket();
        });
        server.on("error", function (err) {
            if (err.code === "EADDRINUSE")
                log("Failed to bind to config.port " + config.port + ".");
            else
                handleError(err);
        });
    } else {
        handleError(err);
    }

});
//-----------------------------------------------------------------------------
// Watch the directory for realtime changes and send them to the client.
function createWatcher(folder) {
    fs.watch(config.filesDir,{ persistent: true }, function(event){
        if(event === "change" || event === "rename") {
            folder = folder.replace("./files","");
            prepareFileList(sendUpdate,folder);
        }
    });
}
//-----------------------------------------------------------------------------
// Send file list JSON over websocket
function sendUpdate() {
    io.sockets.emit("UPDATE_FILES", JSON.stringify(fileList));
}
//-----------------------------------------------------------------------------
// Workaround for strangely slow updates of the watcher after an action
function updateClient(address,dir){
    var dirToSend = clientFolders[address] || dir ;
    if (!dirToSend) dirToSend = "/";
    prepareFileList(sendUpdate,dirToSend);
}
//-----------------------------------------------------------------------------
// Create full directory link
function prefixBase(relativePath) {
    return config.filesDir.substring(0, config.filesDir.length - 1) + relativePath;
}
//-----------------------------------------------------------------------------
// Websocket listener
function setupSocket() {
    io.sockets.on("connection", function (socket) {
        var address = socket.handshake.address.address;
        //var remote = address.address + ":" + address.port;
        socket.on("REQUEST_UPDATE", function (dir) {
            updateClient(undefined,dir);
            clientFolders[address] = dir;
        });
        socket.on("CREATE_FOLDER", function (name) {
            fs.mkdir(prefixBase(name), null, function(err){
                if(err) handleError(err);
                updateClient(address);
            });

        });
        socket.on("SWITCH_FOLDER", function (root) {
            if ( !root.match(/^\//) || root.match(/\.\./) ) return; // Safeguard
            clientFolders[address] = root;
            if (!watchedDirs[root]) {
                createWatcher(prefixBase(root));
                watchedDirs[root] = true;
            }

            prepareFileList(sendUpdate,root);
        });
    });
}
//-----------------------------------------------------------------------------
// GET/POST handler
function onRequest(req, res) {
    var method = req.method.toUpperCase();
    var clientAddress = req.socket.remoteAddress;
    var socket = clientAddress + ":" + req.socket.remotePort;

    log("REQ:  " + socket + "\t" + method + "\t" + req.url);
    if (method === "GET") {
        if (req.url.match(/^\/res\//))
            handleResourceRequest(req,res,socket);
        else if (req.url.match(/^\/files\//))
            handleFileRequest(req,res,socket);
        else if (req.url.match(/^\/delete\//))
            handleDeleteRequest(req,res);
        else if (req.url === "/") {
            res.writeHead(200, {
                "content-type"  : "text/html"
            });
            res.end(cache.HTML);
        } else {
            res.writeHead(404);
            res.end();
        }
    } else if (method === "POST" && req.url === "/upload") {
        handleUploadRequest(req,res,socket,clientAddress);
    }
}
//-----------------------------------------------------------------------------
// Serve resources. Everything from /res/ will be cached by both the server and client
function handleResourceRequest(req,res,socket) {
    var resourceName = unescape(req.url.substring(config.resDir.length -1));
    if (cache[resourceName] === undefined){
        var path = config.resDir + resourceName;
        fs.readFile(path, function (err, data) {
            if(!err) {
                cache[resourceName] = {};
                cache[resourceName].data = data;
                cache[resourceName].size = fs.statSync(unescape(path)).size;
                cache[resourceName].mime = mime.lookup(unescape(path));
                serve();
            } else {
                handleError(err);
                res.writeHead(404);
                res.end();
                return;
            }
        });
    } else {
        serve();
    }

    function serve() {
        log("SEND: " + socket + "\t\t" + resourceName + " (" + convertToSI(cache[resourceName].size) + ")");

        res.writeHead(200, {
            "Content-Type"      : cache[resourceName].mime,
            "Content-Length"    : cache[resourceName].size,
            "Cache-Control"     : "max-age=3600, public"
        });
        res.end(cache[resourceName].data);
    }
}
//-----------------------------------------------------------------------------
function handleFileRequest(req,res,socket) {
    var path = config.filesDir + unescape(req.url.substring(config.filesDir.length -1));
    if (path) {
        var mimeType = mime.lookup(path);

        fs.stat(path, function(err,stats){
            if(err) {
                res.writeHead(500);
                res.end();
                handleError(err);
                sendUpdate(); // Send an update so the client's data stays in sync
            }
            log("SEND: " + socket + "\t\t" + path + " (" + convertToSI(stats.size) + ")");
            res.writeHead(200, {
                "Content-Type"      : mimeType,
                "Content-Length"    : stats.size
            });
            fs.createReadStream(path, {"bufferSize": 4096}).pipe(res);
        });
    }
}
//-----------------------------------------------------------------------------
function handleDeleteRequest(req,res) {
    var path = config.filesDir + unescape(req.url.replace(/^\/delete\//,""));
    log("DEL:  " + path);
    try {
        var stats = fs.statSync(path);
        if (stats.isFile()) {
            fs.unlink(path,function(){
                updateClient(req.socket.remoteAddress);
            });
        } else if (stats.isDirectory()){
            fs.rmdir(path,function(){
                updateClient(req.socket.remoteAddress);
            });
        }
        res.writeHead(200, {
            "Content-Type" : "text/html"
        });
        res.end();
        updateClient();
    } catch(error) {
        res.writeHead(500);
        res.end();
        handleError(error);
    }
}
//-----------------------------------------------------------------------------
function handleUploadRequest(req,res,socket,address) {
    if (req.url === "/upload" ) {
        var form = new formidable.IncomingForm();
        form.uploadDir = config.filesDir;
        form.parse(req);

        //Change the path from a temporary to the actual files directory
        form.on("fileBegin", function(name, file) {
            var clientFolder = clientFolders[address];
            if (clientFolder === "/")
                file.path = form.uploadDir + file.name;
            else
                file.path = prefixBase(clientFolders[address]) + "/" + file.name;
            log("RECV: " + socket + "\t\t" + file.path );
        });

        form.on('end', function() {
            updateClient(address);
        });

        form.on("error", function(err) {
            handleError(err);
            sendUpdate(); // Send an update so the client's data stays in sync
        });

        res.writeHead(200, {
            "Content-Type" : "text/html"
        });
        res.end();
    }
}
//-----------------------------------------------------------------------------
// Read the directory's content and store it in the fileList object
var prepareFileList = debounce(function (callback, root){
    var realRoot = prefixBase(root);
    last = new Date();
    fileList = {};
    fs.readdir(realRoot, function(err,files) {
        if(err) handleError(err);
        if(!files) return;
        fileList[0] = root;
        for(var i=0,len=files.length;i<len;i++){
            var name = files[i], type;
            try{
                var stats = fs.statSync(realRoot + "/" + name);
                if (stats.isFile())
                    type = "f";
                if (stats.isDirectory())
                    type = "d";
                if (type === "f" || type === "d") {
                    fileList[i+1] = {"name": name, "type": type, "size" : stats.size};
                }
            } catch(error) {
                handleError(error);
            }
        }
        if(callback !== undefined) callback();
    });
},config.readInterval);
//-----------------------------------------------------------------------------
// Logging and error handling helpers
function log(msg) {
    console.log(getTimestamp() + msg);
}

function handleError(err) {
    if (typeof err === "object") {
        if (err.message)
            log(err.message);
        if (err.stack)
            log(err.stack);
    }
}

process.on("uncaughtException", function (err) {
    log("=============== Uncaught exception! ===============");
    handleError(err);
});
//-----------------------------------------------------------------------------
// Helper function for log timestamps
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
// Helper function for size values
function convertToSI(bytes) {
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
// underscore's debounce
// https://github.com/documentcloud/underscore
function debounce(func, wait, immediate) {
    var timeout, result;
    return function() {
        var context = this, args = arguments;
        var later = function() {
            timeout = null;
            if (!immediate) result = func.apply(context, args);
        };
        var callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) result = func.apply(context, args);
        return result;
    };
}