#!/usr/bin/env node
/* ----------------------------------------------------------------------------
                          droppy - file server on node
                      https://github.com/silverwind/droppy
 ------------------------------------------------------------------------------
 Copyright (c) 2012 - 2013 silverwind

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in all
 copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
 ------------------------------------------------------------------------------
  TODOs:
  - Touch events
  - Thumbnail icons for images
  - Async downloads through FileSystem API
  - User privilege levels and a admin panel to add/remove users
  - Rework client <-> server communication so that the server has more
    control over the client's current location in the file system
  - Public file links (using a URL shortening mechanism)
  - Drag and drop moving of files/folders
  - Find a solution to not send login data in cleartext over HTTP.
  - IE9 compatibilty, if possible
  - Keybindings
 --------------------------------------------------------------------------- */

"use strict";

var cache        = {},
    clients      = {},
    db           = {},
    dirs         = {},
    watchedDirs  = {},
    server       = null,
    config       = null;

var autoprefixer    = require("autoprefixer"),
    cleancss        = require("clean-css"),
    crypto          = require("crypto"),
    formidable      = require("formidable"),
    fs              = require("fs"),
    mime            = require("mime"),
    path            = require("path"),
    querystring     = require("querystring"),
    rmdir           = require("rmdir"),
    uglify          = require("uglify-js"),
    util            = require("util"),
    WebSocketServer = require("ws").Server,
    zlib            = require("zlib");

var color = {
    red     : "\u001b[31m",
    green   : "\u001b[32m",
    yellow  : "\u001b[33m",
    blue    : "\u001b[34m",
    reset   : "\u001b[0m"
};

var isCLI   = (process.argv.length > 2),
    isJitsu = (process.env.NODE_ENV === "production");

// Argument handler
if (isCLI) handleArguments();

readConfig();
logsimple(prettyStartup());
logsimple(" ->> running on node " + process.version);

// Read user/sessions from DB and add a default user if no users exist
readDB();
if (Object.keys(db.users).length < 1) {
    addUser("droppy", "droppy");
}

// Copy/Minify JS,CSS and HTML content
prepareContent();

// Read and cache all resources
logsimple(" ->> caching resources...\n");
cacheResources(config.resDir, function () {
    // Proceed with setting up the files folder and bind to the listening port
    setupFilesDir();
    createListener();
});

//-----------------------------------------------------------------------------
// Read CSS and JS, minify them, and write them to /res
function prepareContent() {
    try {
        var css, js;
        logsimple(" ->> preparing CSS...");

        css = autoprefixer.compile(fs.readFileSync(getSrcPath("css.css")).toString("utf8"), ["last 2 versions"]);
        fs.writeFileSync(getResPath("css.css"), config.debug ? css : cleancss.process(css));

        logsimple(config.debug ? " ->> preparing JS..." : " ->> minifying JS...");

        js = [
            fs.readFileSync(getSrcPath("jquery.js")).toString("utf8"),
            fs.readFileSync(getSrcPath("jquery-ui-custom.js")).toString("utf8"),
            fs.readFileSync(getSrcPath("client.js")).toString("utf8")
        ].join("\n");

        fs.writeFileSync(getResPath("client.js"), config.debug ? js :uglify.minify(js, {fromString: true}).code);

        logsimple(" ->> preparing HTML...");

        // Copy html from src to res - may do some preprocessing here later
        copyResource("base.html");
        copyResource("body-auth.html");
        copyResource("body-main.html");
    } catch (err) {
        logerror("Error reading client sources.\n", util.inspect(err));
        process.exit(1);
    }
}

function copyResource(filepath) {
    fs.writeFileSync(getResPath(filepath), fs.readFileSync(getSrcPath(filepath)));
}
//-----------------------------------------------------------------------------
// Set up the directory for files
function setupFilesDir() {
    fs.mkdir(config.filesDir, function (err) {
        if (!err || err.code === "EEXIST") {
            return true;
        } else {
            logerror("Error accessing ", config.filesDir);
            logerror(util.inspect(err));
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
            server = require("https").createServer({key: key, cert: cert}, onRequest);
        } catch (error) {
            logerror("Error reading SSL certificate or key.\n", util.inspect(error));
            process.exit(1);
        }
    }
    createWatcher(addFilePath("/"));
    setupSocket(server);

    // Bind to 8080 on jitsu
    var port =  isJitsu ? process.env.PORT : config.port;

    server.listen(port);

    server.on("listening", function () {
        // We're up - initialize everything
        var address = server.address();
        log("Listening on ", address.address, ":", address.port);
    });

    server.on("error", function (err) {
        if (err.code === "EADDRINUSE")
            logerror("Failed to bind to port ", port, ". Address already in use.\n\n", err.stack);
        else if (err.code === "EACCES")
            logerror("Failed to bind to port ", port, ". Need root to bind to ports < 1024.\n\n", err.stack);
        else
            logerror("Error:", util.inspect(err));
        process.exit(1);
    });

}
//-----------------------------------------------------------------------------
// Watch the directory for realtime changes and send them to the appropriate clients.
function createWatcher(folder) {
    watchedDirs[removeFilePath(folder)] = fs.watch(folder, debounce(function () {
        updateClients(folder);
    }), config.readInterval);

    function updateClients(folder) {
        var clientsToUpdate = [];
        for (var client in clients) {
            var clientDir = clients[client].directory;
            if (clientDir === removeFilePath(folder)) {
                clientsToUpdate.push(client);
                readDirectory(clientDir, function () {
                    sendMessage(clientsToUpdate.pop(), "UPDATE_FILES");
                });
            }
        }
    }
}
//-----------------------------------------------------------------------------
// Add ./files/ to a path
function addFilePath(p) {
    return config.filesDir.substring(0, config.filesDir.length - 1) + p;
}
// Remove ./files/ from a path
function removeFilePath(p) {
    return p.replace(config.filesDir.substring(0, config.filesDir.length - 1), "");
}
//-----------------------------------------------------------------------------
// WebSocket listener
function setupSocket(server) {
    var wss = new WebSocketServer({server : server});
    wss.on("connection", function (ws) {
        var remoteIP   = ws._socket.remoteAddress;
        var remotePort = ws._socket.remotePort;
        var cookie     = getCookie(ws.upgradeReq.headers.cookie);

        if (!cookie) {
            log(remoteIP, ":", remotePort, " Unauthorized WebSocket connection closed.");
            ws.send("UNAUTHORIZED");
            ws.close();
            return;
        } else {
            log(remoteIP, ":", remotePort, " WebSocket [", color.green, "connected", color.reset, "]");
        }

        ws.on("message", function (message) {
            var msg = JSON.parse(message);
            var dir = msg.data;

            switch (msg.type) {
            case "REQUEST_UPDATE":
                dir = dir.replace(/&amp;/g, "&");
                clients[cookie] = { "directory": dir, "ws": ws};
                readDirectory(dir, function () {
                    sendMessage(cookie, "UPDATE_FILES");
                });
                break;
            case "CREATE_FOLDER":
                fs.mkdir(addFilePath(dir), config.mode, function (err) {
                    if (err) logerror(err);
                    readDirectory(clients[cookie].directory, function () {
                        sendMessage(cookie, "UPDATE_FILES");
                    });
                });
                break;
            case "DELETE_FILE":
                log(remoteIP, ":", remotePort, " Deleting: " + dir.substring(1));
                dir = addFilePath(dir);

                var deleteFile =  function (dir, second) {
                    fs.stat(dir, function (err, stats) {
                        if (stats && !err) {
                            if (stats.isFile()) {
                                fs.unlink(dir, function (err) {
                                    if (err) logerror(err);
                                });
                            } else if (stats.isDirectory()) {
                                rmdir(dir, function (err) {
                                    if (err) logerror(err);
                                    readDirectory(clients[cookie].directory, function () {
                                        sendMessage(cookie, "UPDATE_FILES");
                                    });
                                });
                            }
                        } else if (err) {
                            if (second) throw err;
                            deleteFile(dir.replace(/&/, "&amp;"), true);
                        }
                    });
                };

                // Filenames with "&amp;" can actually exist, but the client will send us and
                // unescaped "&" in both cases ("&" and "&amp;"). To remedy this, we try to delete
                // both variations before erroring. This can still fail if a path contains both
                // cases at the same time, but it's the best solution until we do async downloads
                // using the FileSystem API.
                if (dir.indexOf("&")) {
                    try {
                        deleteFile(dir);
                    } catch (err) {
                        logerror(err);
                        readDirectory(clients[cookie].directory, function () {
                            sendMessage(cookie, "UPDATE_FILES");
                        });
                    }
                } else {
                    deleteFile(dir);
                }

                break;
            case "SWITCH_FOLDER":
                if (!dir.match(/^\//) || dir.match(/\.\./)) return;
                dir = dir.replace(/&amp;/g, "&");
                switchClientFolder(cookie, dir, ws);

                break;
            case "LOGOUT":
                delete db.sessions[cookie];
                writeDB();
                break;
            }
        });
        ws.on("close", function () {
            log(remoteIP, ":", remotePort, " WebSocket [", color.red, "disconnected", color.reset, "]");
        });
        ws.on("error", function (err) {
            logerror(err);
        });
    });
}
//-----------------------------------------------------------------------------
// Switch a client into a folder and update watchers
function switchClientFolder(cookie, dir, ws) {
    if (!clients[cookie]) clients[cookie] = {};
    clients[cookie].directory = dir;
    if (ws) clients[cookie].ws = ws;

    updateWatchers(dir, function (ok) {
        // Send client back to root in case the requested directory can't be read
        if (!ok) {
            dir = "/";
            clients[cookie].directory = dir;
        }

        if (!ws)
            waitOnWebsocket(cookie, dir);
        else
            readDirectory(dir, function () {
                sendMessage(cookie, "NEW_FOLDER");
            });

        function waitOnWebsocket(cookie, dir) {
            var runtime = 0;
            // Wait 10 seconds for a client to open the websocket after a direct folder navigation
            var retry = setInterval(function () {
                if (runtime >= 10000) clearInterval(retry);
                if (clients[cookie].ws) {
                    clearInterval(retry);
                    readDirectory(dir, function () {
                        sendMessage(cookie, "NEW_FOLDER");
                    });
                }
                runtime += 50;
            }, 50);
        }
    });
}
//-----------------------------------------------------------------------------
// Watch given directory
function updateWatchers(newDir, callback) {
    if (!watchedDirs[newDir]) {
        newDir = addFilePath(newDir);
        fs.stat(newDir, function (err, stats) {
            if (err || !stats) {
                // Requested Directory can't be read
                checkWatchedDirs();
                callback(false);
            } else {
                // Directory is okay to be read
                createWatcher(newDir);
                checkWatchedDirs();
                callback(true);
            }
        });
    } else {
        callback(true);
    }
}
//-----------------------------------------------------------------------------
// Check if we need the other active watchers
function checkWatchedDirs() {
    var neededDirs = {};
    for (var client in clients) {
        neededDirs[clients[client].directory] = true;
    }

    for (var directory in watchedDirs) {
        if (!neededDirs[directory]) {
            watchedDirs[directory].close();
            delete watchedDirs[directory];
        }
    }
}
//-----------------------------------------------------------------------------
// Send file list JSON over websocket
function sendMessage(cookie, messageType) {
    // Dont't send if the socket isn't open
    if (!clients[cookie].ws._socket) return;
    var dir = clients[cookie].directory;
    var data = JSON.stringify({
        "type"  : messageType,
        "folder": dir,
        "data"  : dirs[dir]
    });
    clients[cookie].ws.send(data, function (err) {
        if (err) logerror(err);
    });
}
//-----------------------------------------------------------------------------
// GET/POST handler
function onRequest(req, res) {
    switch (req.method.toUpperCase()) {
    case "GET":
        handleGET(req, res);
        break;
    case "POST":
        handlePOST(req, res);
        break;
    default:
        res.statusCode = 405;
        res.setHeader("Allow", "GET, POST");
        res.end();
        logresponse(req, res);
    }
}
//-----------------------------------------------------------------------------
// Read resources and store them in the cache object
function cacheResources(dir, callback) {
    dir = dir.substring(0, dir.length - 1); // Strip trailing slash

    walkDirectory(dir, function (err, results) {
        var filesToGzip = [];
        results.forEach(function (fullPath) {                   // fullPath = ./res/webshim/shims/styles/shim.css
            var relPath = fullPath.substring(dir.length + 1);   // relPath  = webshim/shims/styles/shim.css
            var fileName = path.basename(fullPath);             // fileName = shim.css
            var fileData, fileTime;

            // This is rather hacky. node seems to throw ENOENT on files that
            // clearly exist when reading them in quick succession. This code
            // tries to read a file 20 times before quitting.
            var readCount = 0;
            try {
                var read = function () {
                    fileData = fs.readFileSync(fullPath);
                    fileTime = fs.statSync(fullPath).mtime;
                    readCount++;
                };
                read();
            } catch (err) {
                if (readCount >= 20) {
                    logerror(err);
                    process.exit(1);
                } else {
                    read();
                }
            }

            cache[relPath] = {};
            cache[relPath].data = fileData;
            cache[relPath].etag = crypto.createHash("md5").update(String(fileTime)).digest("hex");
            cache[relPath].mime = mime.lookup(fullPath);
            if (fileName.match(/.*(js|css|html)$/)) {
                filesToGzip.push(relPath);
            }
        });

        if (filesToGzip.length > 0)
            runGzip();
        else
            callback();

        function runGzip() {
            var currentFile = filesToGzip[0];
            zlib.gzip(cache[currentFile].data, function (err, compressedData) {
                cache[currentFile].gzipData = compressedData;
                filesToGzip = filesToGzip.slice(1);
                if (filesToGzip.length > 0)
                    runGzip();
                else
                    callback();
            });
        }
    });
}
//-----------------------------------------------------------------------------
// Handle all GET requests
function handleGET(req, res) {
    var URI = decodeURIComponent(req.url);
    var resourceName;

    if (URI === "/") {
        handleResourceRequest(req, res, "base.html");
    } else if (URI === "/content") {
        if (getCookie(req.headers.cookie)) {
            res.setHeader("X-Page-Type", "main");
            handleResourceRequest(req, res, "body-main.html");
        } else {
            res.setHeader("X-Page-Type", "auth");
            handleResourceRequest(req, res, "body-auth.html");
        }
    } else if (URI.match(/^\/get\//)) {
        handleFileRequest(req, res);
    } else if (URI.match(/^\/res\//)) {
        var fileName = path.basename(req.url);
        var dirName = path.dirname(req.url);
        dirName = dirName.substring(5);
        resourceName = (dirName === "") ? fileName : dirName + "/" + fileName;
        handleResourceRequest(req, res, resourceName);
    } else if (URI === "/favicon.ico") {
        handleResourceRequest(req, res, "icon.ico");
    } else {
        // Check if client is going to a folder directly
        fs.stat(path.join(config.filesDir, URI), function (err, stats) {
            if (!err && stats.isDirectory()) {
                handleResourceRequest(req, res, "base.html");
                // Strip trailing slash
                if (URI.charAt(URI.length - 1) === "/")
                    URI = URI.substring(0, URI.length - 1);

                switchClientFolder(getCookie(req.headers.cookie), URI);
            } else {
                res.statusCode = 301;
                res.setHeader("Location", "/");
                res.end();
                logresponse(req, res);
            }
        });
    }
}
//-----------------------------------------------------------------------------
// Handle all POST requests
function handlePOST(req, res) {
    if (req.url === "/upload") {
        if (!getCookie(req.headers.cookie)) {
            res.statusCode = 401;
            res.end();
            logresponse(req, res);
        }
        handleUploadRequest(req, res);
    } else if (req.url === "/login") {
        var body = "";
        req.on("data", function (data) {
            body += data;
        });
        req.on("end", function () {
            var postData = querystring.parse(body);
            var response;
            if (isValidUser(postData.username, postData.password)) {
                log(req.socket.remoteAddress, ":", req.socket.remotePort, " ",
                    "User ", postData.username, " [", color.green, "authenticated", color.reset, "]");
                response = "OK";
                createCookie(req, res, postData);
            } else {
                log(req.socket.remoteAddress, ":", req.socket.remotePort, " ",
                    "User ", postData.username, " [", color.red, "unathorized", color.reset, "]");
                response = "NOK";
            }
            var json = JSON.stringify(response);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Length", json.length);
            res.end(json);
            logresponse(req, res);
        });
    }
}
//-----------------------------------------------------------------------------
function handleResourceRequest(req, res, resourceName) {
    if (cache[resourceName] === undefined) {
        res.statusCode = 404;
        res.end();
        logresponse(req, res);
    } else {
        var ifNoneMatch = req.headers["if-none-match"] || "";
        if (ifNoneMatch === cache[resourceName].etag && req.url !== "/content") {
            res.statusCode = 304;
            res.end();
            logresponse(req, res);
        } else {
            res.statusCode = 200;

            if (req.url === "/content") {
                res.setHeader("Cache-Control", "private, no-cache, no-transform, no-store");
            } else if (resourceName === "icon.ico") {
                // Long cache on favicon, because some browsers seem to request them constantly
                res.setHeader("Cache-Control", "max-age=7257600");
            } else {
                res.setHeader("ETag", cache[resourceName].etag);
            }

            if (req.url === "/" && !config.debug)
                res.setHeader("X-Frame-Options", "DENY");

            if (resourceName.match(/.*(js|css|html)$/))
                res.setHeader("Content-Type", cache[resourceName].mime + "; charset=utf-8");
            else
                res.setHeader("Content-Type", cache[resourceName].mime);

            var acceptEncoding = req.headers["accept-encoding"] || "";
            if (acceptEncoding.match(/\bgzip\b/) && cache[resourceName].gzipData !== undefined) {
                res.setHeader("Content-Encoding", "gzip");
                res.setHeader("Content-Length", cache[resourceName].gzipData.length);
                res.setHeader("Vary", "Accept-Encoding");

                res.end(cache[resourceName].gzipData);
            } else {
                res.setHeader("Content-Length", cache[resourceName].data.length);
                res.end(cache[resourceName].data);
            }
            logresponse(req, res);
        }
    }
}
//-----------------------------------------------------------------------------
function handleFileRequest(req, res) {
    if (!getCookie(req.headers.cookie)) {
        res.statusCode = 301;
        res.setHeader("Location", "/");
        res.end();
        logresponse(req, res);
    }

    var filepath = addFilePath(decodeURIComponent(req.url).replace("get/", ""));
    if (filepath) {
        var mimeType = mime.lookup(filepath);

        fs.stat(filepath, function (err, stats) {
            if (!err && stats) {
                res.statusCode = 200;
                res.setHeader("Content-Disposition", ['attachment; filename="', path.basename(filepath), '"'].join(""));
                res.setHeader("Content-Type", mimeType);
                res.setHeader("Content-Length", stats.size);
                logresponse(req, res);
                fs.createReadStream(filepath, {bufferSize: 4096}).pipe(res);
            } else {
                res.statusCode = 500;
                res.end();
                logresponse(req, res);
                if (err)
                    logerror(err);
            }
        });
    }
}
//-----------------------------------------------------------------------------
function handleUploadRequest(req, res) {
    var socket = req.socket.remoteAddress + ":" + req.socket.remotePort;
    if (req.url === "/upload") {
        var form = new formidable.IncomingForm();
        var cookie = getCookie(req.headers.cookie);
        var uploadedFiles = {};
        form.parse(req, function (err) {
            if (err) logerror();
            res.writeHead(200, {"content-type": "text/plain"});
            res.end();
            logresponse(req, res);
        });
        form.on("fileBegin", function (name, file) {
            var pathToSave;

            if (clients[cookie].directory === undefined || clients[cookie].directory === "/")
                pathToSave = config.filesDir + file.name;
            else
                pathToSave = addFilePath(clients[cookie].directory) + "/" + file.name;

            uploadedFiles[file.name] = {
                "temppath" : file.path,
                "savepath" : pathToSave
            };

            log(socket, " Receiving ", pathToSave.substring(config.filesDir.length));
        });

        form.on("end", function () {
            var count = 0, deletecount = 0;
            for (var file in uploadedFiles) {
                count++;
                var input, output;

                input = fs.createReadStream(uploadedFiles[file].temppath, {bufferSize: 4096});

                input.on("close", function () {
                    fs.unlink(this.path, function (err) {
                        deletecount++;
                        if (err) logerror(err);
                        if (deletecount === count) {
                            sendMessage(cookie, "UPLOAD_DONE");
                        }
                    });
                });

                input.on("error", function (err) {
                    logerror(err);
                });

                output = fs.createWriteStream(uploadedFiles[file].savepath, {mode: config.mode});

                output.on("error", function (err) {
                    logerror(err);
                });

                input.pipe(output);
            }
        });

        form.on("error", function (err) {
            logerror(err);
        });
    }
}
//-----------------------------------------------------------------------------
// Read the directory's content and store it in "dirs"
function readDirectory(root, callback) {
    fs.readdir(addFilePath(root), function (err, files) {
        if (err) logerror(err);
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
            fs.stat(addFilePath(root) + "/" + filename, function (err, stats) {
                counter++;
                if (!err && stats) {
                    if (stats.isFile())
                        type = "f";
                    if (stats.isDirectory())
                        type = "d";
                    if (type === "f" || type === "d")
                        dirContents[filename] = {"type": type, "size" : stats.size};
                } else if (err) {
                    logerror(err);
                }
                if (counter === lastFile) {
                    // All stat callbacks have fired
                    dirs[root] = dirContents;
                    callback();
                }
            });
        }
    });
}
//-----------------------------------------------------------------------------
// Argument handler
function handleArguments() {
    var args = process.argv.slice(2);
    var option = args[0];

    switch (option) {
    case "-adduser":
        if (args.length === 3) {
            readDB();
            addUser(args[1], args[2]);
        } else {
            printUsage();
            process.exit(1);
        }
        break;
    case "--help":
        printUsage();
        process.exit(0);
        break;
    default:
        logsimple("Unknown argument. See 'node droppy --help for help.'\n");
        process.exit(1);
        break;
    }

    function printUsage() {
        logsimple("droppy - file server on node.js (https://github.com/silverwind/droppy)");
        logsimple("Usage: node droppy [option] [option arguments]\n");
        logsimple("-help \t\t\t\tPrint this help");
        logsimple("-adduser username password\tCreate a new user for authentication\n");
    }
}
//-----------------------------------------------------------------------------
// Read and validate config.json
function readConfig() {
    try {
        config = JSON.parse(fs.readFileSync("./config.json"));
    } catch (e) {
        logerror("Error reading config.json\n", util.inspect(e));
        process.exit(1);
    }

    var opts = ["debug", "useSSL", "port", "readInterval", "mode", "httpsKey", "httpsCert", "db", "filesDir", "resDir", "srcDir"];
    for (var i = 0, len = opts.length; i < len; i++) {
        if (config[opts[i]] === undefined) {
            logerror("Error: Missing property in config.json:", opts[i]);
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
            logsimple(" ->> creating " + path.basename(config.db) + "...");
            db = {users: {}, sessions: {}};
            doWrite = true;
        } else {
            logerror("Error reading ", config.db, "\n", util.inspect(e));
            process.exit(1);
        }
    }

    // Write a new DB if necessary
    if (doWrite) {
        writeDB();
    }
}
//-----------------------------------------------------------------------------
// Get a SHA256 hash of a string
function getHash(string) {
    return crypto.createHmac("sha256", new Buffer(string, "utf8")).digest("hex");
}
//-----------------------------------------------------------------------------
// Add a user to the database save it to disk
function addUser(user, password) {
    if (db.users[user] !== undefined) {
        logsimple("User ", user, " already exists!");
        if (isCLI) process.exit(1);
    } else {
        var salt = crypto.randomBytes(4).toString("hex");
        db.users[user] = getHash(password + salt + user) + "$" + salt;
        fs.writeFileSync(config.db, JSON.stringify(db, null, 4));
        writeDB(function () {
            if (isCLI) logsimple("User ", user, " successfully added.");
            if (isCLI) process.exit();
        });
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
function getCookie(cookie) {
    var sid = "";
    if (cookie !== undefined) {
        var cookies = cookie.split("; ");
        cookies.forEach(function (c) {
            if (c.match(/^sid.*/)) {
                sid = c.substring(4);
            }
        });
    }
    for (var savedsid in db.sessions) {
        if (savedsid === sid) {
            return sid;
        }
    }
    return false;
}

function createCookie(req, res, postData) {
    var sessionID = crypto.randomBytes(32).toString("base64");
    if (postData.check === "on") {
        // Create a semi-permanent cookie
        var dateString = new Date(new Date().getTime() + 31536000000).toUTCString();
        db.sessions[sessionID] = true;
        writeDB();
        res.setHeader("Set-Cookie", "sid=" + sessionID + "; Expires=" + dateString);
    } else {
        // Create a single-session cookie
        // TODO: Delete these session ids after a certain period of inactivity from the client
        db.sessions[sessionID] = true;
        res.setHeader("Set-Cookie", "sid=" + sessionID + ";");
    }
}

function writeDB(callback) {
    fs.writeFile(config.db, JSON.stringify(db, null, 4), function (err) {
        if (err) {
            logerror("Error writing ", config.db, "\n", util.inspect(err));
            if (isCLI) process.exit(1);
        }
        if (callback) callback();
    });
}
//============================================================================
// Misc helper functions
//============================================================================
function getResPath(name) {
    return path.join(config.resDir, name);
}

function getSrcPath(name) {
    return path.join(config.srcDir, name);
}

function getTimestamp() {
    if (isJitsu) return "";
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

    return year + "-"  + month + "-" + day + " " + hours + ":" + minutes + ":" + seconds + " ";
}

function prettyStartup() {
    return ([
        "    __\n",
        ".--|  .----.-----.-----.-----.--.--.\n",
        "|  _  |   _|  _  |  _  |  _  |  |  |\n",
        "|_____|__| |_____|   __|   __|___  |\n",
        "                 |__|  |__|  |_____|\n\n"
    ].join(""));
}

// Recursively walk a directory and return file paths in an array
function walkDirectory(dir, callback) {
    var results = [];
    fs.readdir(dir, function (err, list) {
        if (err) return callback(err);
        var i = 0;
        (function next() {
            var file = list[i++];
            if (!file) return callback(null, results);
            file = dir + '/' + file;
            fs.stat(file, function (err, stats) {
                if (stats && stats.isDirectory()) {
                    walkDirectory(file, function (err, res) {
                        results = results.concat(res);
                        next();
                    });
                } else {
                    results.push(file);
                    next();
                }
            });
        })();
    });
}

// underscore's debounce - https://github.com/documentcloud/underscore
function debounce(func, wait, immediate) {
    var timeout, result;
    return function () {
        var context = this, args = arguments;
        var later = function () {
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
//============================================================================
// Logging and error handling helpers
//============================================================================

function log() {
    var args = Array.prototype.slice.call(arguments, 0);
    args.unshift(getTimestamp());
    for (var i = 1, len = args.length; i < len; i++) {
        var argStr = String(args[i]);
        if (typeof args[i] === "number" && [200, 301, 304, 307, 401, 404, 405, 500].indexOf(args[i]) > -1) {
            switch (argStr.charAt(0)) {
            case "2":
                argStr = "[" + color.green + argStr + color.reset + "]";
                break;
            case "3":
                argStr = "[" + color.yellow + argStr + color.reset + "]";
                break;
            case "4":
            case "5":
                argStr = "[" + color.red + argStr + color.reset + "]";
                break;
            }
            args[i] = argStr;
        } else if (argStr === "GET" || argStr === "POST") {
            argStr = color.yellow + argStr + color.reset;
        }
    }
    args.push(color.reset);
    console.log(args.join(""));
}

function logresponse(req, res) {
    log(req.socket.remoteAddress, ":", req.socket.remotePort, " ", req.method.toUpperCase(), " ", decodeURIComponent(req.url), " ", res.statusCode);
}

function logerror(error) {
    if (typeof error === "object") {
        if (error.stack) {
            logerror(String(error.stack));
        }
        if (error.message) {
            logerror(String(error.message));
        }
    } else {
        var args = Array.prototype.slice.call(arguments, 0);
        args.unshift(color.red);
        args.push(color.reset);
        console.log(args.join(""));
    }
}

function logsimple() {
    var args = Array.prototype.slice.call(arguments, 0);
    console.log(args.join(""));
}

process.on("uncaughtException", function (err) {
    logerror("=============== Uncaught exception! ===============");
    logerror(err);
});