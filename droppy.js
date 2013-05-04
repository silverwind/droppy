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
    config,
    io;

var fs                 = require("fs"),
    formidable         = require("formidable"),
    mime               = require("mime"),
    util               = require("util"),
    crypto             = require("crypto"),
    querystring        = require("querystring"),
    zlib               = require("zlib"),
    path               = require("path"),
    cleancss           = require("clean-css"),
    uglify             = require("uglify-js");


var color = {
    red     : "\u001b[31m",
    green   : "\u001b[32m",
    yellow  : "\u001b[33m",
    blue    : "\u001b[34m",
    reset   : "\u001b[0m"
};

// Argument handler
var isCLI = (process.argv.length > 2);
if (isCLI) handleArguments();

readConfig();
logsimple(prettyStartup());

var isJitsu = (process.env.NODE_ENV === "production");

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
        logsimple(" ->> preparing CSS...");

        if (DEBUG) {
            copyResource("css.css");
        } else {
            fs.writeFileSync(getResPath("css.css"),
                    cleancss.process(String(fs.readFileSync(getSrcPath("css.css"))))
            );
        }

        if (DEBUG) {
            logsimple(" ->> preparing JS...");
            fs.writeFileSync(getResPath("client.js"), [
                String(fs.readFileSync(getSrcPath("jquery.js"))),
                String(fs.readFileSync(getSrcPath("jquery.form.js"))),
                String(fs.readFileSync(getSrcPath("dropzone.js"))),
                String(fs.readFileSync(getSrcPath("prefixfree.js"))),
                String(fs.readFileSync(getSrcPath("webshim/extras/modernizr-custom.js"))),
                String(fs.readFileSync(getSrcPath("webshim/polyfiller.js"))),
                String(fs.readFileSync(getSrcPath("client.js")))
            ].join("\n"));
        } else {
            logsimple(" ->> minifying JS...");
            fs.writeFileSync(getResPath("client.js"),
                uglify.minify([
                    getSrcPath("jquery.js"),
                    getSrcPath("jquery.form.js"),
                    getSrcPath("dropzone.js"),
                    getSrcPath("prefixfree.js"),
                    getSrcPath("webshim/extras/modernizr-custom.js"),
                    getSrcPath("webshim/polyfiller.js"),
                    getSrcPath("client.js")
                ]).code
            );
        }

        require('ncp').ncp(config.srcDir + "/webshim", config.resDir + "/webshim", function (err) {
            if (err) {
                logerror(err);
            }
        });

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
// Set up the directory for files and start the server
function setupFilesDir() {
    fs.mkdir(config.filesDir, function (err) {
        if (!err || err.code === "EEXIST") {
            return true;
        } else {
            logerror("Error accessing", config.filesDir, ".");
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
        } catch (error) {
            logerror("Error reading SSL certificate or key.\n", util.inspect(error));
            process.exit(1);
        }
        server = require("https").createServer({key: key, cert: cert}, onRequest);
    }
    createWatcher(prefixFilePath("/"));
    setupSocket(server);

    // Bind to 8080 on jitsu
    if (isJitsu) {
        server.listen(8080);
    }
    else {
        server.listen(config.port);
    }

    server.on("listening", function () {
        // We're up - initialize everything
        var address = server.address();
        log("Listening on ", address.address, ":", address.port);
    });
    server.on("error", function (err) {
        if (err.code === "EADDRINUSE")
            logerror("Failed to bind to port", config.port, ". Adress already in use.\n", err.stack);
        else if (err.code === "EACCES")
            logerror("Failed to bind to port", config.port, ". Need root to bind to ports < 1024.\n", err.stack);
        else
            logerror("Error:", util.inspect(err));
        process.exit(1);
    });
}
//-----------------------------------------------------------------------------
// Watch the directory for realtime changes and send them to the appropriate clients.
function createWatcher(folder) {
    var relativePath = folder.replace(config.filesDir.substring(0, config.filesDir.length - 1), "");
    var watcher = fs.watch(folder, { persistent: true }, function (event) {
        if (event === "change" || event === "rename") {
            // Files in a watched directory changed. Figure out which client(s) need updates
            // This part might be quite costly cpu-wise while files are being written, need
            // to figure out something better, like an object lookup.
            for (var client in clients) {
                if (clients.hasOwnProperty(client)) {
                    var clientDir = clients[client].directory;
                    if (clientDir === relativePath) {
                        readDirectory(clientDir, function () {
                            sendMessage(client, "UPDATE_FILES");
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
function prefixFilePath(relativePath) {
    return config.filesDir.substring(0, config.filesDir.length - 1) + relativePath;
}
//-----------------------------------------------------------------------------
// WebSocket listener
function setupSocket(server) {
    io = require("socket.io").listen(server, {"log level": 1});

    io.sockets.on("connection", function (ws) {
        var remoteIP = ws.handshake.address.address;
        var remotePort = ws.handshake.address.port;
        log(remoteIP, ":", remotePort, " WebSocket [", color.green, "connected", color.reset, "]");

        ws.on("REQUEST_UPDATE", function (data) {
            var dir = JSON.parse(data);
            dir = dir.replace(/&amp;/g, "&");
            clients[remoteIP] = { "directory": dir, "ws": ws};
            readDirectory(dir, function () {
                sendMessage(remoteIP, "UPDATE_FILES");
            });
        });

        ws.on("CREATE_FOLDER", function (data) {
            var dir = JSON.parse(data);
            fs.mkdir(prefixFilePath(dir), config.mode, function (err) {
                if (err) logerror(err);
                readDirectory(clients[remoteIP].directory, function () {
                    sendMessage(remoteIP, "UPDATE_FILES");
                });
            });
        });

        ws.on("DELETE_FILE", function (data) {
            var dir = JSON.parse(data);
            dir = prefixFilePath(dir);
            fs.stat(dir, function (err, stats) {
                if (err) {
                    logerror(err);
                    return;
                }
                if (stats.isFile()) {
                    fs.unlink(dir, function (err) {
                        if (err) logerror(err);
                    });
                } else if (stats.isDirectory()) {
                    fs.rmdir(dir, function (err) {
                        if (err) logerror(err);
                        // TODO: handle ENOTEMPTY
                    });
                }
            });
        });

        ws.on("SWITCH_FOLDER", function (data) {
            var dir = JSON.parse(data);
            if (!dir.match(/^\//) || dir.match(/\.\./)) return;
            dir = dir.replace(/&amp;/g, "&");
            clients[remoteIP] = { "directory": dir, "ws": ws};
            updateWatchers(dir);
            readDirectory(dir, function () {
                sendMessage(remoteIP, "UPDATE_FILES");
            });
        });

        ws.on("disconnect", function () {
            log(remoteIP, ":", remotePort, " WebSocket [", color.red, "disconnected", color.reset, "]");
        });
    });
}
//-----------------------------------------------------------------------------
// Watch given directory and check if we need the other active watchers
function updateWatchers(newDir) {
    if (!watchedDirs[newDir]) {
        createWatcher(prefixFilePath(newDir));

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
        "folder": dir,
        "data"  : dirs[dir]
    });
    clients[IP].ws.emit(messageType, data, function (err) {
        if (err) logerror(err);
    });
}
//-----------------------------------------------------------------------------
// GET/POST handler
function onRequest(req, res) {
    var method = req.method.toUpperCase();

    if (method === "GET") {
        if (req.url.match(/^\/get\//)) {
            handleFileRequest(req, res);
        } else {
            handleGET(req, res);
        }
    } else if (method === "POST") {
        if (req.url === "/upload") {
            if (!checkCookie(req)) {
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
                        html = html.replace(resource, function (match) {
                            return match.replace(".", "." + cache[resource].revision + ".");
                        });
                    }
                }
                cache[file].data = html;
            } else if (file.match(/.*\.css/)) {
                var css = String(cache[file].data);
                for (var res in cache) {
                    if (!res.match(/.*\.css/) && cache.hasOwnProperty(res)) {
                        css = css.replace(res, function (match) {
                            return match.replace(".", "." + cache[res].revision + ".");
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
        logerror("Error Unable to strip revision off ", filename);
        return filename;
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
                if (readCount > 20) {
                    logerror(err);
                    process.exit(1);
                } else {
                    read();
                }
            }

            cache[relPath] = {};
            cache[relPath].data = fileData;
            cache[relPath].revision = Number(fileTime).toString(36); //base36 the modified timestamp
            cache[relPath].mime = mime.lookup(fullPath);
            if (fileName.match(/.*(js|css|html)$/)) {
                filesToGzip.push(relPath);
            }
            addRevisions();
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
// Handle all GETs, except downloads
function handleGET(req, res) {
    var resourceName;

    switch (req.url) {
    case "/":
        resourceName = "base.html";
        break;
    case "/content":
        var obj = {};
        if (checkCookie(req)) {
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
        logresponse(req, res);
        return;
    default:
        var fileName = path.basename(req.url);
        var dirName = path.dirname(req.url);

        if (fileName.match(/\./g).length >= 2)
            fileName = stripRevision(fileName);

        if (dirName.indexOf("/res") === 0)
            dirName = dirName.substring(5);

        if (dirName === "")
            resourceName = fileName;
        else
            resourceName = dirName + "/" + fileName;

        if (resourceName.match(/favicon.ico/))
            resourceName = "icon.ico";

        break;
    }


    if (cache[resourceName] === undefined) {
        res.statusCode = 404;
        res.end();
        logresponse(req, res);
    } else {
        res.statusCode = 200;

        if (req.url === "/") res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Content-Type", cache[resourceName].mime);
        res.setHeader("Cache-Control", "public, max-age=31536000");

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
//-----------------------------------------------------------------------------
function handleFileRequest(req, res) {
    if (!checkCookie(req)) {
        res.statusCode = 301;
        res.setHeader("Location", "/");
        res.end();
        logresponse(req, res);
    }
    var filepath = unescape(prefixFilePath(req.url.replace("get/", "")));
    if (filepath) {
        var mimeType = mime.lookup(filepath);

        fs.stat(filepath, function (err, stats) {
            if (err) {
                res.statusCode = 500;
                res.end();
                logresponse(req, res);
                logerror(err);
            } else {
                res.statusCode = 200;
                res.setHeader("Content-Disposition", ['attachment; filename="', path.basename(filepath), '"'].join(""));
                res.setHeader("Content-Type", mimeType);
                res.setHeader("Content-Length", stats.size);
                logresponse(req, res);
                fs.createReadStream(filepath, {"bufferSize": 4096}).pipe(res);
            }
        });
    }
}
//-----------------------------------------------------------------------------
function handleUploadRequest(req, res) {
    var socket = req.socket.remoteAddress + ":" + req.socket.remotePort;
    if (req.url === "/upload") {
        var form = new formidable.IncomingForm();
        var address = req.socket.remoteAddress;
        var uploadedFiles = {};
        form.parse(req);

        form.on("fileBegin", function (name, file) {
            var pathToSave;
            if (clients[address].directory === undefined || clients[address].directory === "/")
                pathToSave = config.filesDir + file.name;
            else
                pathToSave = prefixFilePath(clients[address].directory) + "/" + file.name;

            uploadedFiles[file.name] = {
                "temppath" : file.path,
                "savepath" : pathToSave
            };

            log(socket, " Receiving ", pathToSave.substring(config.filesDir.length + 1));
        });

        form.on("end", function () {
            for (var file in uploadedFiles) {
                if (uploadedFiles.hasOwnProperty(file)) {
                    try {
                        var is = fs.createReadStream(uploadedFiles[file].temppath, {bufferSize: 64 * 1024});
                        var os = fs.createWriteStream(uploadedFiles[file].savepath);

                        is.pipe(os);

                        is.on("close", function () {
                            fs.unlinkSync(uploadedFiles[file].temppath);
                            fs.chmod(uploadedFiles[file].savepath, config.mode, function (err) {
                                if (err) logerror(err);
                            });
                        });

                        is.on("error", function (err) {
                            logerror(err);
                        });
                    } catch (err) {
                        logerror(err);
                    }
                    res.statusCode = 200;
                    res.end();
                    logresponse(req, res);
                }
            }
        });

        form.on("error", function (err) {
            logerror(err);
        });
    }
}
//-----------------------------------------------------------------------------
// Read the directory's content and store it in "dirs"
var readDirectory = debounce(function (root, callback) {
    lastRead = new Date();
    fs.readdir(prefixFilePath(root), function (err, files) {
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
            fs.stat(prefixFilePath(root) + "/" + filename, function (err, stats) {
                counter++;
                if (err) logerror(err);
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
}, config.readInterval);
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
    var opts = ["useSSL", "port", "readInterval", "mode", "httpsKey", "httpsCert", "db", "filesDir", "resDir", "srcDir"];
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
            logsimple("->> creating" + path.basename(config.db) + "...");
            db = {users: {}, sessions: {}};
            doWrite = true;
        } else {
            logerror("Error reading ", config.db, "\n", util.inspect(e));
            process.exit(1);
        }
    }

    // Write a new DB if necessary
    if (doWrite) {
        try {
            fs.writeFileSync(config.db, JSON.stringify(db, null, 4));
        } catch (e) {
            logerror("Error writing ", config.db, "\n", util.inspect(e));
            if (isCLI) process.exit(1);
        }
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
        try {
            fs.writeFileSync(config.db, JSON.stringify(db, null, 4));
            if (isCLI) logsimple("User ", user, " successfully added.");
            if (isCLI) process.exit();
        } catch (e) {
            logerror("Error writing ", config.db, "\n", util.inspect(e));
            if (isCLI) process.exit(1);
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
    if (cookie !== undefined) {
        var cookies = cookie.split("; ");
        cookies.forEach(function (c) {
            if (c.match(/^_SESSION.*/)) {
                sid = c.substring(9);
            }
        });
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
        var dateString = new Date(new Date().getTime() + 31536000000).toUTCString();
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
            fs.stat(file, function (err, stat) {
                if (stat && stat.isDirectory()) {
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

//-----------------------------------------------------------------------------
// Logging and error handling helpers

function log() {
    var args = Array.prototype.slice.call(arguments, 0);
    args.unshift(getTimestamp());
    for (var i = 1, len = args.length; i < len; i++) {
        var argStr = String(args[i]);
        if (typeof args[i] === "number" && args[i] >= 100 && args[i] < 600) {
            switch (argStr.charAt(0)) {
            case "1":
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
    log(req.socket.remoteAddress, ":", req.socket.remotePort, " ", req.method.toUpperCase(), " ", req.url, " ", res.statusCode);
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
        args.unshift(getTimestamp() + color.red);
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