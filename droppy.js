#!/usr/bin/env node
//-----------------------------------------------------------------------------
// droppy - file server on node.js
// https://github.com/silverwind/droppy
//-----------------------------------------------------------------------------
//Copyright (c) 2012 - 2013 silverwind
//
//Permission is hereby granted, free of charge, to any person obtaining a copy
//of this software and associated documentation files (the "Software"), to deal
//in the Software without restriction, including without limitation the rights
//to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//copies of the Software, and to permit persons to whom the Software is
//furnished to do so, subject to the following conditions:
//
//The above copyright notice and this permission notice shall be included in all
//copies or substantial portions of the Software.
//
//THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//SOFTWARE.
//-----------------------------------------------------------------------------
// Current limitiations:
// - None known
//-----------------------------------------------------------------------------
// TODOs:
// - Logout functionality
// - Admin panel to add/remove users
// - Add cookie authentification to the websocket connection
// - Recursive deleting of folders (with confirmation)
// - Drag and drop moving of files/folders
// - Keybindings (navigation and copy, cut, paste of files)
// - Find a solution to not send login data in cleartext over HTTP. OAuth?
//-----------------------------------------------------------------------------
// vim: ts=4:sw=4
// jshint indent:4

"use strict";

var DEBUG = false;

var cache          = {},
    clients        = {},
    watchedDirs    = {},
    dirs           = {},
    db             = {},
    server,
    lastRead,
    config;


var fs                 = require("fs"),
    formidable         = require("formidable"),
    WebSocketServer    = require("ws").Server,
    mime               = require("mime"),
    util               = require("util"),
    crypto             = require("crypto"),
    querystring        = require("querystring"),
    zlib               = require("zlib"),
    path               = require("path"),
    cleancss           = require("clean-css"),
    uglify             = require("uglify-js");

readConfig();
// Argument handler
if (process.argv.length > 2)
    handleArguments();

console.log(prettyStartup());

readDB();
if (Object.keys(db.users).length < 1) {
    addUser("droppy", "droppy");
}

prepareContent();

// Read and cache all resources
cacheResources(function() {
    // Proceed with setting up the files folder and bind to the listening port
    setupFilesDir();
    createListener();
});

//-----------------------------------------------------------------------------
// Read CSS and JS, minify them, and write them to /res
function prepareContent() {
    try {
        console.log(" ->> minifying CSS...");
        fs.writeFileSync(getResPath("css.css"),
                cleancss.process(String(fs.readFileSync(getSrcPath("css.css"))))
        );

        if (DEBUG) {
            console.log(" ->> preparing JS...");
            fs.writeFileSync(getResPath("client.js"), [
                String(fs.readFileSync(getSrcPath("jquery.js"))),
                String(fs.readFileSync(getSrcPath("jquery.form.js"))),
                String(fs.readFileSync(getSrcPath("dropzone.js"))),
                String(fs.readFileSync(getSrcPath("prefixfree.js"))),
                String(fs.readFileSync(getSrcPath("client.js")))
            ].join("\n"));
        } else {
            console.log(" ->> minifying JS...");
            fs.writeFileSync(getResPath("client.js"),
                uglify.minify([
                    getSrcPath("jquery.js"),
                    getSrcPath("jquery.form.js"),
                    getSrcPath("dropzone.js"),
                    getSrcPath("prefixfree.js"),
                    getSrcPath("client.js")
                ]).code
            );
        }
        console.log(" ->> preparing HTML...\n");
        // Copy html from src to res - may do some preprocessing here later
        fs.writeFileSync(getResPath("base.html"),fs.readFileSync(getSrcPath("base.html")));
        fs.writeFileSync(getResPath("body-auth.html"),fs.readFileSync(getSrcPath("body-auth.html")));
        fs.writeFileSync(getResPath("body-main.html"),fs.readFileSync(getSrcPath("body-main.html")));
    } catch(err) {
        console.log("Error reading client sources.\n" + util.inspect(err));
        process.exit(1);
    }
}
//-----------------------------------------------------------------------------
// Set up the directory for files and start the server
function setupFilesDir() {
    fs.mkdir(config.filesDir, function (err) {
        if ( !err || err.code === "EEXIST") {
            return true;
        } else {
            console.log("Error accessing",config.filesDir,".");
            console.log(util.inspect(err));
            process.exit(1);
        }
    });
}
//-----------------------------------------------------------------------------
// Bind to listening port
function createListener() {
    if (!config.useSSL) {
        server = require("http").createServer(onRequest);
    } else {
        var key, cert;
        try {
            key = fs.readFileSync(config.httpsKey);
            cert = fs.readFileSync(config.httpsCert);
        } catch(error) {
            console.log("Error reading SSL certificate or key.\n",util.inspect(error));
            process.exit(1);
        }
        server = require("https").createServer({key: key, cert: cert}, onRequest);
    }
    server.listen(config.port);
    server.on("listening", function() {
        //We're up - initialize everything
        var address = server.address();
        log("Listening on ", address.address, ":", address.port);
        createWatcher(prefixBasePath("/"));
        setupSocket(server);
    });
    server.on("error", function (err) {
        if (err.code === "EADDRINUSE")
            console.log("Failed to bind to port", config.port, ". Adress already in use.");
        else if (err.code === "EACCES")
            console.log("Failed to bind to port", config.port, ". Need root to bind to ports < 1024.");
        else
            console.log("Error:",util.inspect(err));
        process.exit(1);
    });
}
//-----------------------------------------------------------------------------
// Watch the directory for realtime changes and send them to the appropriate clients.
function createWatcher(folder) {
    var relativePath = folder.replace(config.filesDir.substring(0, config.filesDir.length - 1),"");
    var watcher = fs.watch(folder,{ persistent: true }, function(event) {
        if (event === "change" || event === "rename") {
            // Files in a watched directory changed. Figure out which client(s) need updates
            // This part might be quite costly cpu-wise while files are being written, need
            // to figure out something better, like an object lookup.
            for (var client in clients) {
                if (clients.hasOwnProperty(client)) {
                    var clientDir = clients[client].directory;
                    if (clientDir === relativePath) {
                        readDirectory(clientDir, function() {
                            sendMessage(client,"UPDATE_FILES");
                        });
                    }
                }
            }
        }
    });
    watchedDirs[relativePath] = watcher;
}
//-----------------------------------------------------------------------------
// Create absolute directory link
function prefixBasePath(relativePath) {
    return config.filesDir.substring(0, config.filesDir.length - 1) + relativePath;
}
//-----------------------------------------------------------------------------
// WebSocket listener
function setupSocket(server) {
    var wss = new WebSocketServer({server : server});
    wss.on("connection", function(ws) {
        var remoteIP = ws._socket.remoteAddress;
        var remotePort = ws._socket.remotePort;
        log("WS:   ", remoteIP, ":", remotePort, " connected");

        ws.on("message", function(message) {
            var msg = JSON.parse(message);
            var dir = msg.data;

            switch(msg.type) {
            case "REQUEST_UPDATE":
                dir = dir.replace(/&amp;/g,"&");
                clients[remoteIP] = { "directory": dir, "ws": ws};
                readDirectory(dir, function() {
                    sendMessage(remoteIP, "UPDATE_FILES");
                });
                break;
            case "CREATE_FOLDER":
                fs.mkdir(prefixBasePath(dir), config.mode, function(err) {
                    if (err) handleError(err);
                    readDirectory(clients[remoteIP].directory, function() {
                        sendMessage(remoteIP, "UPDATE_FILES");
                    });
                });
                break;
            case "DELETE_FILE":
                dir = prefixBasePath(dir);
                log("DEL:  ", remoteIP, ":", remotePort, "\t\t", dir);
                fs.stat(dir, function(err, stats) {
                    if (err) {
                        handleError(err);
                        return;
                    }
                    if (stats.isFile()) {
                        fs.unlink(dir, function(err) {
                            if (err) handleError(err);
                        });
                    } else if (stats.isDirectory()) {
                        fs.rmdir(dir, function(err) {
                            if (err) handleError(err);
                            // TODO: handle ENOTEMPTY
                        });
                    }
                });
                break;
            case "SWITCH_FOLDER":
                if ( !dir.match(/^\//) || dir.match(/\.\./) ) return;
                dir = dir.replace(/&amp;/g,"&");
                clients[remoteIP] = { "directory": dir, "ws": ws};
                updateWatchers(dir);
                readDirectory(dir, function() {
                    sendMessage(remoteIP, "UPDATE_FILES");
                });
                break;
            }
        });
        ws.on("close", function() {
            log("WS:   ", remoteIP, ":", remotePort, " disconnected");
        });
        ws.on("error", function(err) {
            log(err);
        });
    });
}
//-----------------------------------------------------------------------------
// Watch given directory and check if we need the other active watchers
function updateWatchers(newDir) {
    if (!watchedDirs[newDir]) {
        createWatcher(prefixBasePath(newDir));

        var neededDirs = {};
        for (var client in clients) {
            if (clients.hasOwnProperty(client)) {
                neededDirs[clients[client].directory] = true;
            }
        }

        for (var directory in watchedDirs) {
            if (watchedDirs.hasOwnProperty(directory)) {
                if (!neededDirs[directory]) {
                    watchedDirs[directory].close();
                    delete watchedDirs[directory];
                }
            }
        }
    }
}
//-----------------------------------------------------------------------------
// Send file list JSON over websocket
function sendMessage(IP, messageType) {
    // Dont't send if the socket isn't open
    if (clients[IP].ws._socket === null) return;
    var dir = clients[IP].directory;
    var data = JSON.stringify({
        "type"  : messageType,
        "folder": dir,
        "data"  : dirs[dir]
    });
    clients[IP].ws.send(data, function(err) {
        if (err) handleError(err);
    });
}
//-----------------------------------------------------------------------------
// GET/POST handler
function onRequest(req, res) {
    var method = req.method.toUpperCase();
    var socket = req.socket.remoteAddress + ":" + req.socket.remotePort;
    log("REQ:  ", socket, "\t", method, "\t", req.url);

    if (method === "GET") {
        if (req.url.match(/^\/get\//)) {
            handleFileRequest(req, res);
        } else {
            handleGET(req,res);
        }
    } else if (method === "POST") {
        if (req.url === "/upload") {
            if (!checkCookie(req)) res.end(401);
            handleUploadRequest(req,res);
        } else if (req.url === "/login") {
            var body = "";
            req.on("data", function(data) {
                body += data;
            });
            req.on("end", function() {
                var postData = querystring.parse(body);
                var response;
                if (isValidUser(postData.username, postData.password)) {
                    log("AUTH: ", socket, "\t\tUser ", postData.username, " successfully authenticated.");
                    response = "OK";
                    createCookie(req, res, postData);
                } else {
                    log("AUTH: ", socket, "\t\tUser ", postData.username, " failed authentication.");
                    response = "NOK";
                }
                var json = JSON.stringify(response);
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json");
                res.setHeader("Content-Length", json.length);
                res.end(json);
            });
        }
    }
}
//-----------------------------------------------------------------------------
// Append revision number to cached files, to force clients to download a changed file
// Format: file.ext -> file.hfw6c03k.css
function addRevisions() {
    for (var file in cache) {
        if (cache.hasOwnProperty(file)) {
            if (file.match(/.*\.html/)) {
                var html = String(cache[file].data);
                for (var resource in cache) {
                    if (!resource.match(/.*\.html/) && cache.hasOwnProperty(resource)) {
                        html = html.replace(resource, function(match) {
                            return match.replace(".","." + cache[resource].revision + ".");
                        });
                    }
                }
                cache[file].data = html;
            } else if (file.match(/.*\.css/)) {
                var css = String(cache[file].data);
                for (var res in cache) {
                    if (!res.match(/.*\.css/) && cache.hasOwnProperty(res)) {
                        css = css.replace(res, function(match) {
                            return match.replace(".","." + cache[res].revision + ".");
                        });
                    }
                }
                cache[file].data = css;
            }
        }
    }
}

// .. And strip a request off its revision
function stripRevision(filename) {
    var parts = filename.split(".");
    if (parts.length === 3) {
        return parts[0] + "." + parts[2];
    } else {
        log("Error Unable to strip revision off ", filename);
        return filename;
    }
}
//-----------------------------------------------------------------------------
// Read resources and store them in the cache object
function cacheResources(callback) {
    var files = fs.readdirSync(config.resDir);
    var filesToGzip = [];
    for (var i = 0, len = files.length; i < len; i++) {
        var fileName = files[i];
        var dir = getResPath(fileName);
        var fileData = fs.readFileSync(dir);
        var stats;
        try {
            stats = fs.statSync(dir);
        } catch (err) {
            log(err);
            continue;
        }
        cache[fileName] = {};
        cache[fileName].data = fileData;
        cache[fileName].size = stats.size;
        cache[fileName].revision = Number(stats.mtime).toString(36); //base36 the modified timestamp
        cache[fileName].mime = mime.lookup(dir);

        if (fileName.match(/.*(js|css|html)$/))
            filesToGzip.push(fileName);
    }
    addRevisions();

    if (filesToGzip.length > 0)
        runGzip();
    else
        callback();

    function runGzip() {
        var currentFile = filesToGzip[0];
        zlib.gzip(cache[currentFile].data, function(err,compressed) {
            cache[currentFile].gzipData = compressed;
            cache[currentFile].gzipSize = compressed.length;
            filesToGzip = filesToGzip.slice(1);
            if (filesToGzip.length > 0)
                runGzip();
            else
                callback();
        });
    }
}
//-----------------------------------------------------------------------------
// Handle all GETs, except downloads
function handleGET(req, res) {
    var resourceName;
    var hasCookie = checkCookie(req);

    if (req.url === "/") {
        resourceName = "base.html";
    } else if (req.url === "/content") {
        var obj = {};
        if (hasCookie) {
            obj.type = "main";
            obj.data = cache["body-main.html"].data;
        } else {
            obj.type = "auth";
            obj.data = cache["body-auth.html"].data;
        }
        var json = JSON.stringify(obj);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Length", json.length);
        res.setHeader("Cache-Control", "no-cache");
        res.end(json);
        return;
    }  else {
        resourceName = path.basename(req.url);
        if (resourceName.match(/\./g).length >= 2) {
            resourceName = stripRevision(resourceName);
        }
    }

    if (cache[resourceName] === undefined) {
        res.writeHead(404);
        res.end();
    } else {
        res.statusCode = 200;

        if (req.url === "/") res.setHeader("X-Frame-Options","DENY");
        res.setHeader("Content-Type", cache[resourceName].mime);
        res.setHeader("Cache-Control", "public, max-age=31536000");

        var acceptEncoding = req.headers["accept-encoding"] || "";
        if (acceptEncoding.match(/\bgzip\b/) && cache[resourceName].gzipSize !== undefined) {
            res.setHeader("Content-Encoding", "gzip");
            res.setHeader("Content-Length", cache[resourceName].gzipSize);
            res.setHeader("Vary", "Accept-Encoding");
            res.end(cache[resourceName].gzipData);
        } else {
            res.setHeader("Content-Length", cache[resourceName].size);
            res.end(cache[resourceName].data);
        }
    }
}
//-----------------------------------------------------------------------------
function handleFileRequest(req, res) {
    if (!checkCookie(req)) {
        res.statusCode = 301;
        res.setHeader("Location", "/");
        res.end();
    }
    var socket = req.socket.remoteAddress + ":" + req.socket.remotePort;
    var filepath = unescape(prefixBasePath(req.url.replace("get/","")));
    if (filepath) {
        var mimeType = mime.lookup(filepath);

        fs.stat(filepath, function(err,stats) {
            if (err) {
                res.writeHead(500);
                res.end();
                handleError(err);
            }
            log("SEND: ", socket, "\t\t", filepath, " (", convertToSI(stats.size), ")");
            res.writeHead(200, {
                "Content-Disposition" : ['attachment; filename="',path.basename(filepath),'"'].join(""),
                "Content-Type"        : mimeType,
                "Content-Length"      : stats.size
            });
            fs.createReadStream(filepath, {"bufferSize": 4096}).pipe(res);
        });
    }
}
//-----------------------------------------------------------------------------
function handleUploadRequest(req, res) {
    var socket = req.socket.remoteAddress + ":" + req.socket.remotePort;
    if (req.url === "/upload" ) {
        var form = new formidable.IncomingForm();
        var address = req.socket.remoteAddress;
        var uploadedFiles = [];
        form.uploadDir = config.filesDir;
        form.parse(req);

        //Change the path from a temporary to the actual files directory
        form.on("fileBegin", function(name, file) {
            if (clients[address].directory === "/")
                file.path = form.uploadDir + file.name;
            else
                file.path = prefixBasePath(clients[address].directory) + "/" + file.name;
            uploadedFiles.push(file.path);

            log("RECV: ", socket, "\t\t", file.path );
        });

        form.on("end", function() {
            uploadedFiles.forEach(function(file) {
                fs.chmod(file, config.mode, function(err) {
                    if (err) handleError(err);
                });
            });
        });

        form.on("error", function(err) {
            handleError(err);

        });

        res.writeHead(200, {
            "Content-Type" : "text/html"
        });
        res.end();
    }
}
//-----------------------------------------------------------------------------
// Read the directory's content and store it in "dirs"
var readDirectory = debounce(function (root, callback) {
    lastRead = new Date();
    fs.readdir(prefixBasePath(root), function(err,files) {
        if (err) handleError(err);
        if (!files) return;

        var dirContents = {};

        if (files.length === 0) {
            dirs[root] = dirContents;
            callback();
        }

        var lastFile = files.length;
        var counter = 0;

        for (var i = 0 ; i < lastFile; i++) {
            var filename = files[i], type;
            inspectFile(filename);
        }

        function inspectFile(filename) {
            fs.stat(prefixBasePath(root) + "/" + filename, function(err, stats) {
                counter++;
                if (err) handleError(err);
                if (stats.isFile())
                    type = "f";
                if (stats.isDirectory())
                    type = "d";
                if (type === "f" || type === "d")
                    dirContents[filename] = {"type": type, "size" : stats.size};

                // All callbacks have fired
                if (counter === lastFile) {
                    dirs[root] = dirContents;
                    callback();
                }
            });
        }
    });
},config.readInterval);
//-----------------------------------------------------------------------------
// Logging and error handling helpers
function log() { //getTimestamp(),
    var arr = Array.prototype.slice.call(arguments, 0);
    console.log(getTimestamp(), arr.join(""));
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
// Argument handler
function handleArguments() {
    var args = process.argv.slice(2);
    var option = args[0];

    switch(option) {
    case "-adduser":
        if (args.length === 3 ) {
            addUser(args[1],args[2]);
        } else {
            printUsage();
            process.exit(1);
        }
        break;
    case "-help":
        printUsage();
        process.exit();
        break;
    default:
        process.stdout.write("Unknown argument. See 'node droppy -? for help.'");
        process.exit(1);
        break;
    }

    function printUsage() {
        process.stdout.write("droppy - file server on node.js (https://github.com/silverwind/droppy)\n");
        process.stdout.write("Usage: node droppy [option] [option arguments]\n\n");
        process.stdout.write("-help \t\t\t\tPrint this help\n");
        process.stdout.write("-adduser username password\tCreate a new user for authentication\n");
    }
}
//-----------------------------------------------------------------------------
// Read and validate config.json
function readConfig() {
    try {
        config = JSON.parse(fs.readFileSync("./config.json"));
    } catch (e) {
        console.log("Error reading config.json\n",util.inspect(e));
        process.exit(1);
    }
    var opts = ["useSSL","port","readInterval","mode","httpsKey","httpsCert","db","filesDir","resDir","srcDir"];
    for (var i = 0, len = opts.length; i < len; i++) {
        if (config[opts[i]] === undefined) {
            console.log("Error: Missing property in config.json:", opts[i]);
            process.exit(1);
        }
    }
}
//-----------------------------------------------------------------------------
// Read and validate user database
function readDB() {
    var dbString = "";
    var doWrite = false;

    try {
        dbString = String(fs.readFileSync(config.db));
        db = JSON.parse(dbString);

        // Create sub-objects in case they aren't here
        if (!db.users) {
            db.users = {};
            doWrite = true;
        }
        if (!db.sessions) {
            db.sessions = {};
            doWrite = true;
        }
    } catch (e) {
        if (e.code === "ENOENT" || dbString.match(/^\s*$/)) {
            // Recreate DB file in case it doesn't exist / is empty
            db = {users: {}, sessions: {}};
            doWrite = true;
        } else {
            console.log("Error reading", config.db);
            console.log(util.inspect(e));
            process.exit(1);
        }
    }

    // Write a new DB if necessary
    try {
        fs.writeFileSync(config.db, JSON.stringify(db, null, 4));
    } catch (e) {
        console.log("Error writing", config.db);
        console.log(util.inspect(e));
        process.exit(1);
    }
}
//-----------------------------------------------------------------------------
// Get a SHA256 hash of a string
function getHash(string) {
    return crypto.createHmac("sha256", new Buffer(string, "utf8")).digest("hex");
}
//-----------------------------------------------------------------------------
// Add a user to the database save it to disk
function addUser (user, password) {
    readDB();
    if (db.users[user] !== undefined) {
        console.log("User", user, "already exists!");
        process.exit(1);
    } else {
        var salt = crypto.randomBytes(4).toString("hex");
        db.users[user] = getHash(password + salt + user) + "$" + salt;
        try {
            fs.writeFileSync(config.db, JSON.stringify(db, null, 4));
            if (user === "droppy") {
                console.log (" ->> default user added: Username: droppy, Password: droppy");
            } else {
                console.log("User", user, "sucessfully added.");
                process.exit();
            }
        } catch (e) {
            console.log("Error writing", config.db);
            console.log(util.inspect(e));
            process.exit(1);
        }
    }
}
//-----------------------------------------------------------------------------
// Check if user/password is valid
function isValidUser(user, password) {
    if (db.users[user]) {
        var parts = db.users[user].split("$");
        if (parts.length === 2 && parts[0] === getHash(password + parts[1] + user))
            return true;
    }
    return false;
}
//-----------------------------------------------------------------------------
// Cookie helpers
function checkCookie(req) {
    var cookie = req.headers.cookie, sid = "";
    if (cookie !== undefined && cookie.match(/^_SESSION.*/)) {
        sid = cookie.substring(9);
    }

    for (var savedsid in db.sessions) {
        if (savedsid === sid) {
            return true;
        }
    }
    return false;
}

function createCookie(req, res, postData) {
    var sessionID = crypto.randomBytes(64).toString("base64");
    if (postData.check === "on") {
        // Create a semi-permanent cookie
        var dateString = new Date(new Date().getTime()+31536000000).toUTCString();
        db.sessions[sessionID] = true;
        fs.writeFileSync(config.db, JSON.stringify(db, null, 4));
        res.setHeader("Set-Cookie", "_SESSION=" + sessionID + "; Expires=" + dateString);
    } else {
        // Create a single-session cookie
        // TODO: Delete these session ids after a certain period of inactivity from the client
        db.sessions[sessionID] = true;
        res.setHeader("Set-Cookie", "_SESSION=" + sessionID + ";");
    }

}
/* ============================================================================
 *  Misc helper functions
 * ============================================================================
 */
function getResPath(name) {
    return path.join(config.resDir, name);
}

function getSrcPath(name) {
    return path.join(config.srcDir, name);
}

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

    return year + "-"  + month + "-" + day + " "+ hours + ":" + minutes + ":" + seconds;
}

function convertToSI(bytes) {
    var kib = 1024,
        mib = kib * 1024,
        gib = mib * 1024,
        tib = gib * 1024;

    if ((bytes >= 0) && (bytes < kib))         return bytes + " bytes";
    else if ((bytes >= kib) && (bytes < mib))  return (bytes / kib).toFixed(2) + "KiB";
    else if ((bytes >= mib) && (bytes < gib))  return (bytes / mib).toFixed(2) + "MiB";
    else if ((bytes >= gib) && (bytes < tib))  return (bytes / gib).toFixed(2) + "GiB";
    else if (bytes >= tib)                     return (bytes / tib).toFixed(2) + "TiB";
    else return bytes + " bytes";
}

function prettyStartup() {
    return([
        "    __\n",
        ".--|  .----.-----.-----.-----.--.--.\n",
        "|  _  |   _|  _  |  _  |  _  |  |  |\n",
        "|_____|__| |_____|   __|   __|___  |\n",
        "                 |__|  |__|  |_____|\n\n"
    ].join(""));
}
// underscore's debounce - https://github.com/documentcloud/underscore
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
