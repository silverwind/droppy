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
  - Improve perceived responsivness through preloading/caching of content
  - Rework client <-> server communication so that the server has more
    control over the client's current location in the file system
  - User privilege levels and a interface to add/remove users
  - Drag and drop to move/copy entries
  - Image thumbnails
  - Keybindings
  - SVG icons
  - Modularize both client and server javascript code
 --------------------------------------------------------------------------- */
"use strict";

var helpers         = require("./lib/helpers.js"),
    log             = require("./lib/log.js"),
    autoprefixer    = require("autoprefixer"),
    cleancss        = require("clean-css"),
    crypto          = require("crypto"),
    formidable      = require("formidable"),
    fs              = require("graceful-fs"),
    mime            = require("mime"),
    path            = require("path"),
    querystring     = require("querystring"),
    uglify          = require("uglify-js"),
    util            = require("util"),
    WebSocketServer = require("ws").Server,
    wrench          = require("wrench"),
    zlib            = require("zlib");

var cache        = {},
    clients      = {},
    db           = {},
    dirs         = {},
    watchedDirs  = {},
    server       = false,
    debug        = false,
    debugcss     = false,
    config       = false,
    isCLI        = (process.argv.length > 2),
    isJitsu      = (process.env.NODE_ENV === "production");

// Argument handler
if (isCLI) handleArguments();

readConfig();

fs.MAX_OPEN = config.maxOpen;
debug = config.debug;
log.useTimestamp = !isJitsu;
log.simple(helpers.logo);
log.simple(" ->> running on node " + process.version);

// Read user/sessions from DB and add a default user if no users exist
readDB();
if (Object.keys(db.users).length < 1) {
    addUser("droppy", "droppy", true);
}

// Copy/Minify JS,CSS and HTML content
prepareContent();

// Read and cache all resources
log.simple(" ->> caching resources...\n");
cacheResources(config.resDir, function () {
    // Set up the exposed files folder
    setupFilesDir();

    // Clean up our shortened links
    cleanUpLinks();

    // Bind to the listening port
    createListener();
});

//-----------------------------------------------------------------------------
// Read JS/CSS/HTML client resources, minify them, and write them to /res
function prepareContent() {
    var out = {},
        resources = {
            css  : ["style.css", "sprites.css"],
            js   : ["modernizr.js", "jquery.js", "client.js"],
            html : ["base.html", "auth.html", "main.html"]
        };

    // Read resources
    log.simple(" ->> reading resources...");
    for (var type in resources) {
        resources[type].forEach(function (file, key, array) {
            var data;
            try {
                data = fs.readFileSync(getSrcPath(file)).toString("utf8");
            } catch (error) {
                log.error("Error reading " + file + ":\n", error);
                process.exit(1);
            }
            if (type === "html") {
                array[key] = {};
                array[key][file] = data;
            } else
                array[key] = data;
        });
    }

    // Concatenate CSS and JS
    log.simple(" ->> preparing resources...");
    resources.css.forEach(function (data) {
        out.css += data + "\n";
    });
    resources.js.forEach(function (data) {
        // Append a semicolon to each javascript file to make sure it's
        // properly terminated. The minifier afterwards will take care of
        // any double-semicolons and whitespace.
        out.js += data + ";\n";
    });

    // Add CSS vendor prefixes
    out.css = autoprefixer("last 2 versions").compile(out.css);
    // Minify CSS
    !debug && (out.css = cleancss.process(out.css, {keepSpecialComments : 0, removeEmpty : true}));
    // Set the client debug variable to mirror the server's
    out.js = out.js.replace("var debug;", debug ? "var debug = true;" : "var debug = false;");
    // Minify JS
    !debug && (out.js = uglify.minify(out.js, {fromString: true}).code);

    log.simple(" ->> writing resources...");
    try {
        resources.html.forEach(function (file) {
            var name = Object.keys(file)[0];
            // Minify HTML by removing tabs, CRs and LFs
            fs.writeFileSync(getResPath(name), file[name].replace(/[\t\r\n]/gm, ""));
        });
        fs.writeFileSync(getResPath("client.js"), out.js);
        fs.writeFileSync(getResPath("style.css"), out.css);
    } catch (error) {
        log.error("Error writing resources:\n", error);
        process.exit(1);
    }
}
//-----------------------------------------------------------------------------
// Set up the directory for files
function setupFilesDir() {
    fs.mkdir(config.filesDir, config.dirMode, function (error) {
        if (!error || error.code === "EEXIST") {
            return true;
        } else {
            log.error("Error accessing ", config.filesDir);
            log.error(util.inspect(error));
            process.exit(1);
        }
    });
}
//-----------------------------------------------------------------------------
// Clean up our shortened links by removing links to nonexistant files
function cleanUpLinks() {
    var linkcount = 0, cbcount = 0;
    for (var link in db.shortlinks) {
        linkcount++;
        (function (shortlink, location) {
            fs.stat(path.join(config.filesDir, location), function (error, stats) {
                cbcount++;
                if (!stats || error) {
                    delete db.shortlinks[shortlink];
                }
                if (cbcount === linkcount) {
                    writeDB();
                }
            });
        })(link, db.shortlinks[link]);
    }
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
            log.error("Error reading SSL certificate or key.\n", util.inspect(error));
            process.exit(1);
        }
    }

    server.on("listening", function () {
        setupSocket(server);
        if (debug) setupDebugWatcher();
        log.log("Listening on port ", server.address().port);
    });

    server.on("error", function (error) {
        if (error.code === "EADDRINUSE")
            log.error("Failed to bind to port ", port, ". Address already in use.\n");
        else if (error.code === "EACCES")
            log.error("Failed to bind to port ", port, ". Need root to bind to ports < 1024.\n");
        else
            log.error("Error:", util.inspect(error));
        process.exit(1);
    });

    // Bind to 8080 on jitsu
    var port =  isJitsu ? process.env.PORT : config.port;
    server.listen(port);
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
        log.response(req, res);
    }
}
//-----------------------------------------------------------------------------
// WebSocket functions
function setupSocket(server) {
    var wss = new WebSocketServer({server : server});
    wss.on("connection", function (ws) {
        var remoteIP   = ws._socket.remoteAddress;
        var remotePort = ws._socket.remotePort;
        var cookie     = getCookie(ws.upgradeReq.headers.cookie);

        if (!cookie) {
            ws.close(4000);
            log.log(remoteIP, ":", remotePort, " Unauthorized WebSocket connection closed.");
            return;
        } else {
            log.log(remoteIP, ":", remotePort, " WebSocket ", "connected");
            if (!clients[cookie]) {
                clients[cookie] = {};
                clients[cookie].ws = ws;
            }
        }

        ws.on("message", function (message) {
            var msg = JSON.parse(message);
            var dir = msg.data;
            switch (msg.type) {
            case "REQUEST_UPDATE":
                clients[cookie] = {
                    directory: dir,
                    ws: ws
                };
                readDirectory(clients[cookie].directory, function () {
                    sendFiles(cookie, "UPDATE_FILES");
                });
                updateWatchers(clients[cookie].directory);
                break;
            case "CREATE_FOLDER":
                var foldername = path.basename(dir);
                if (foldername.match(/[\\*{}\/<>?|]/) || foldername.match(/^(\.+)$/)) {
                    log.log(remoteIP, ":", remotePort, " Invalid directory creation request: " + foldername);
                    return;
                }

                fs.mkdir(addFilePath(dir), config.dirMode, function (error) {
                    if (error) log.error(error);
                    log.log(remoteIP, ":", remotePort, " Created: ", dir);
                    readDirectory(clients[cookie].directory, function () {
                        sendFiles(cookie, "UPDATE_FILES");
                    });
                });
                break;
            case "REQUEST_SHORTLINK":
                // Check if we already have a link for that file
                for (var link in db.shortlinks) {
                    if (db.shortlinks[link] === dir) {
                        sendLink(cookie, link);
                        return;
                    }
                }

                // Get a pseudo-random n-character lowercase string. The characters
                // "l", "1", "i", o", "0" characters are skipped for easier communication of links.
                var chars = "abcdefghjkmnpqrstuvwxyz23456789";
                do {
                    link = "";
                    while (link.length < config.linkLength)
                        link += chars.charAt(Math.floor(Math.random() * chars.length));
                } while (db.shortlinks[link]); // In case the RNG generates an existing link, go again

                log.log(remoteIP, ":", remotePort, " Shortlink created: " + link + " -> " + dir);
                // Store the created link
                db.shortlinks[link] = dir;

                // Send the shortlink to the client
                sendLink(cookie, link);
                writeDB();
                break;
            case "DELETE_FILE":
                log.log(remoteIP, ":", remotePort, " Deleting: " + dir.substring(1));
                dir = addFilePath(dir);

                fs.stat(dir, function (error, stats) {
                    if (stats && !error) {
                        if (stats.isFile()) {
                            fs.unlink(dir, function (error) {
                                if (error) log.error(error);
                                readDirectory(clients[cookie].directory, function () {
                                    sendFiles(cookie, "UPDATE_FILES");
                                });
                            });
                        } else if (stats.isDirectory()) {
                            try {
                                wrench.rmdirSyncRecursive(dir);
                            } catch (error) {
                                log.error(error);
                            }

                            readDirectory(clients[cookie].directory, function () {
                                sendFiles(cookie, "UPDATE_FILES");
                            });
                        }
                    }
                });
                break;
            case "SWITCH_FOLDER":
                if (!dir.match(/^\//) || dir.match(/\.\./)) return;
                clients[cookie].directory = dir;
                updateWatchers(dir, function (ok) {
                    // Send client back to root in case the requested directory can't be read
                    var msg = ok ? "UPDATE_FILES" : "NEW_FOLDER";
                    if (!ok) {
                        clients[cookie].directory = "/";
                    }
                    readDirectory(clients[cookie].directory, function () {
                        sendFiles(cookie, msg);
                    });
                });

                break;
            case "GET_USERS":
                // Only allow priviledged users to administer accounts
                if (!db.sessions[cookie].privileged) {
                    return;
                }
                // Only send relevant data for the user list
                var userlist = {};
                for (var user in db.users) {
                    userlist[user] = {
                        "privileged": db.users[user].privileged
                    };
                }
                var data = JSON.stringify({
                    type   : "USER_LIST",
                    users  : userlist
                });

                send(clients[cookie].ws, data);
                break;
            }
        });

        ws.on("close", function (code) {
            var reason;
            if (code === 4001) {
                reason = "(Client logged out)";
                delete db.sessions[cookie];
                writeDB();
            } else if (code === 1001) {
                reason = "(Client going away)";
                delete clients[cookie];
            }
            log.log(remoteIP, ":", remotePort, " WebSocket ", "disconnected", " ", reason || "(Code: " + (code || "none")  + ")");
        });

        ws.on("error", function (error) {
            log.error(error);
        });
    });
}

// Send a WS event to the client containing an file list update
function sendFiles(cookie, eventType) {
    if (!clients[cookie] || !clients[cookie].ws || !clients[cookie].ws._socket) return;
    var dir = clients[cookie].directory;
    var data = JSON.stringify({
        type   : eventType,
        folder : dir,
        data   : dirs[dir]
    });
    send(clients[cookie].ws, data);
}

// Send a file link to a client
function sendLink(cookie, link) {
    if (!clients[cookie] || !clients[cookie].ws) return;
    send(clients[cookie].ws, JSON.stringify({
        "type" : "SHORTLINK",
        "link" : link
    }));
}

// Do the actual sending
function send(ws, data) {
    (function queue(ws, data, time) {
        if (time > 1000) return; // in case the socket hasn't opened after 1 second, cancel the sending
        if (ws && ws.readyState === 1) {
            ws.send(data, function (error) {
                if (error) log.error(error);
            });
        } else {
            setTimeout(queue, 50, ws, data, time + 50);
        }
    })(ws, data, 0);
}
//-----------------------------------------------------------------------------
// Watch the directory for realtime changes and send them to the appropriate clients.
function createWatcher(folder) {
    var watcher = fs.watch(folder, helpers.debounce(function () {
        updateClients(folder);
    }), config.readInterval);

    watcher.on("error", function (error) {
        log.error("Error trying to watch ", removeFilePath(folder), "\n", error);
    });

    watchedDirs[removeFilePath(folder)] = watcher;

    function updateClients(folder) {
        var clientsToUpdate = [];
        for (var client in clients) {
            var clientDir = clients[client].directory;
            if (clientDir === removeFilePath(folder)) {
                clientsToUpdate.push(client);
                readDirectory(clientDir, function () {
                    sendFiles(clientsToUpdate.pop(), "UPDATE_FILES");
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
// Watch given directory
function updateWatchers(newDir, callback) {
    if (!watchedDirs[newDir]) {
        newDir = addFilePath(newDir);
        fs.stat(newDir, function (error, stats) {
            if (error || !stats) {
                // Requested Directory can't be read
                checkWatchedDirs();
                callback && callback(false);
            } else {
                // Directory is okay to be read
                createWatcher(newDir);
                checkWatchedDirs();
                callback && callback(true);
            }
        });
    } else {
        callback && callback(true);
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
// Read resources and store them in the cache object
function cacheResources(dir, callback) {
    var gzipFiles, relPath, fileName, fileData, fileTime;
    dir = dir.substring(0, dir.length - 1); // Strip trailing slash

    walkDirectory(dir, function (error, results) {
        if (error) log.error(error);
        gzipFiles = [];
        results.forEach(function (fullPath) {
            relPath = fullPath.substring(dir.length + 1);
            fileName = path.basename(fullPath);

            try {
                fileData = fs.readFileSync(fullPath);
                fileTime = fs.statSync(fullPath).mtime;
            } catch (error) {
                log.error(error);
            }

            cache[relPath] = {};
            cache[relPath].data = fileData;
            cache[relPath].etag = crypto.createHash("md5").update(String(fileTime)).digest("hex");
            cache[relPath].mime = mime.lookup(fullPath);
            if (fileName.match(/.*(js|css|html|svg)$/)) {
                gzipFiles.push(relPath);
            }
        });

        if (gzipFiles.length > 0)
            runGzip();
        else
            callback();

        function runGzip() {
            var currentFile = gzipFiles[0];
            zlib.gzip(cache[currentFile].data, function (error, compressedData) {
                if (error) log.error(error);
                cache[currentFile].gzipData = compressedData;
                gzipFiles = gzipFiles.slice(1);
                if (gzipFiles.length > 0)
                    runGzip();
                else
                    callback();
            });
        }
    });
}
//-----------------------------------------------------------------------------
function handleGET(req, res) {
    var URI = decodeURIComponent(req.url);
    var resourceName;

    if (URI === "/") {
        handleResourceRequest(req, res, "base.html");
    } else if (/^\/content\//.test(URI)) {
        if (getCookie(req.headers.cookie)) {
            res.setHeader("X-Page-Type", "main");
            handleResourceRequest(req, res, "main.html");
        } else {
            res.setHeader("X-Page-Type", "auth");
            handleResourceRequest(req, res, "auth.html");
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
        var cookie = getCookie(req.headers.cookie);
        if (!cookie) {
            res.statusCode = 301;
            res.setHeader("Location", "/");
            res.end();
            log.response(req, res);
            return;
        }

        // Check if client is going to a folder directly
        fs.stat(path.join(config.filesDir, URI), function (error, stats) {
            if (!error && stats.isDirectory()) {
                handleResourceRequest(req, res, "base.html");
                // Strip trailing slash
                if (URI.charAt(URI.length - 1) === "/")
                    URI = URI.substring(0, URI.length - 1);

                if (!clients[cookie]) clients[cookie] = {};
                clients[cookie].directory = URI;
                updateWatchers(URI);
            } else {
                res.statusCode = 301;
                res.setHeader("Location", "/");
                res.end();
                log.response(req, res);
            }
        });
    }
}
//-----------------------------------------------------------------------------
var blocked = [];
function handlePOST(req, res) {
    var URI = decodeURIComponent(req.url);
    if (URI === "/upload") {
        if (!getCookie(req.headers.cookie)) {
            res.statusCode = 401;
            res.end();
            log.response(req, res);
        }
        handleUploadRequest(req, res);
    } else if (URI === "/login") {
        // Throttle login attempts to 1 per second
        if (blocked.indexOf(req.socket.remoteAddress) >= 0) {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end();
            return;
        }
        blocked.push(req.socket.remoteAddress);
        (function (ip) {
            setTimeout(function () {
                blocked.pop(ip);
            }, 1000);
        })(req.socket.remoteAddress);

        var body = "";
        req.on("data", function (data) {
            body += data;
        });
        req.on("end", function () {
            var postData = querystring.parse(body);
            var response;
            if (isValidUser(postData.username, postData.password)) {
                log.log(req.socket.remoteAddress, ":", req.socket.remotePort, " ",
                    "User ", postData.username, "authenticated");
                response = "OK";
                createCookie(req, res, postData);
            } else {
                log.log(req.socket.remoteAddress, ":", req.socket.remotePort, " ",
                    "User ", postData.username, "unauthorized");
                response = "NOK";
            }
            var json = JSON.stringify(response);
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Content-Length", json.length);
            res.end(json);
            log.response(req, res);
        });
    }
}
//-----------------------------------------------------------------------------
function handleResourceRequest(req, res, resourceName) {
    if (debug && resourceName === "style.css") {
        // Shortcut for CSS debugging when no Websocket is available
        debugcss = [
            fs.readFileSync(getSrcPath("style.css")).toString("utf8"),
            fs.readFileSync(getSrcPath("sprites.css")).toString("utf8")
        ].join("\n");
        debugcss = autoprefixer("last 2 versions").compile(debugcss);
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/css; charset=utf-8");
        res.setHeader("Cache-Control", "private, no-cache, no-transform, no-store");
        res.setHeader("Content-Length", Buffer.byteLength(debugcss, 'utf8'));
        res.end(debugcss);
        return;
    }

    // Regular resource handling
    if (cache[resourceName] === undefined) {
        if (resourceName === "null") { // Serve an empty document for the dummy iframe
            res.end();
            return;
        }
        res.statusCode = 404;
        res.end();
    } else {
        var ifNoneMatch = req.headers["if-none-match"] || "";
        if (ifNoneMatch === cache[resourceName].etag) {
            res.statusCode = 304;
            res.end();
        } else {
            res.statusCode = 200;

            if (req.url === "/") {
                // Disallow framing except when debugging
                !debug && res.setHeader("X-Frame-Options", "DENY");
                // Set the IE10 compatibility mode
                if (req.headers["user-agent"].indexOf("MSIE") > 0)
                    res.setHeader("X-UA-Compatible", "IE=Edge, chrome=1");
            } else if (/^\/content\//.test(req.url)) {
                // Don't ever cache /content since its data is dynamic
                res.setHeader("Cache-Control", "private, no-cache, no-transform, no-store");
            } else if (resourceName === "icon.ico") {
                // Set a long cache on the favicon, as some browsers seem to request them constantly
                res.setHeader("Cache-Control", "max-age=7257600");
            } else {
                // All other content can be cached
                res.setHeader("ETag", cache[resourceName].etag);
            }

            if (resourceName.match(/.*(js|css|html|svg)$/))
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
        }
    }
    log.response(req, res);
}
//-----------------------------------------------------------------------------
function handleFileRequest(req, res) {
    var URI = decodeURIComponent(req.url).substring(5, req.url.length); // Strip "/get/" off the URI
    var directLink;
    if (URI.length  === config.linkLength) // We got a n-character suffix after /get/
        if (db.shortlinks[URI]) directLink = db.shortlinks[URI];

    if (!getCookie(req.headers.cookie) && ! directLink) {
        res.statusCode = 301;
        res.setHeader("Location", "/");
        res.end();
        log.response(req, res);
        return;
    }
    var filepath = directLink ? addFilePath(directLink) : addFilePath("/" + URI);
    if (filepath) {
        var mimeType = mime.lookup(filepath);

        fs.stat(filepath, function (error, stats) {
            if (!error && stats) {
                res.statusCode = 200;
                res.setHeader("Content-Disposition", ['attachment; filename="', path.basename(filepath), '"'].join(""));
                res.setHeader("Content-Type", mimeType);
                res.setHeader("Content-Length", stats.size);
                log.response(req, res);
                fs.createReadStream(filepath, {bufferSize: 4096}).pipe(res);
            } else {
                res.statusCode = 500;
                res.end();
                log.response(req, res);
                if (error)
                    log.error(error);
            }
        });
    }
}
//-----------------------------------------------------------------------------
function handleUploadRequest(req, res) {
    var socket = req.socket.remoteAddress + ":" + req.socket.remotePort;
    if (req.url === "/upload") {
        var cookie = getCookie(req.headers.cookie);

        // TODO: Figure out a client's directory if don't have it at this point
        // (happens on server shutdown with the client staying on the page)
        if (!clients[cookie]) {
            res.statusCode = 500;
            res.end();
            log.response(req, res);
            return;
        }

        var form = new formidable.IncomingForm();
        var basePath = path.join(config.filesDir + clients[cookie].directory);

        form.type = "multipart";
        form.parse(req, function (error, fields, files) {
            res.writeHead(200, {"content-type": "text/plain"});
            res.end();
            log.response(req, res);
            if (error && error.message !== "Request aborted") {
                log.error(error);
                readDirectory(clients[cookie].directory, function () {
                    sendFiles(cookie, "UPLOAD_DONE");
                });
            }
            var createdPaths = {};
            for (var file in files) {
                try {
                    var fullPath = path.dirname(path.join(basePath, file));
                    if (!createdPaths[fullPath]) {
                        try {
                            wrench.mkdirSyncRecursive(fullPath, config.dirMode);
                            createdPaths[fullPath] = true;
                        } catch (error) {
                            log.error(error);
                        }
                    }
                } catch (error) {
                    if (error || error.code !== "EEXIST") log.error(error);
                }
            }

        });

        // Process files in batches of 100s
        var files = [], total = 0;
        form.on("fileBegin", function (name, file) {
            var set = Math.floor(total / 100);
            if (!files[set]) files[set] = [];
            files[Math.floor(total / 100)].push({
                "temppath" : file.path,
                "savepath" : path.join(basePath, file.name)
            });
            total++;
        });

        form.on("end", function () {
            log.log(socket, " Received ", total, " files.");
            (function processNext(next) {
                var cbCount = 0, cbFired = 0;
                while (next.length > 0) {
                    cbCount++;
                    processFile(next.pop(), function () {
                        cbFired++;
                        if (next.length === 0 && cbCount === cbFired) {
                            if (files.length > 0) {
                                processNext(files.pop());
                            } else {
                                readDirectory(clients[cookie].directory, function () {
                                    sendFiles(cookie, "UPLOAD_DONE");
                                });
                            }
                        }
                    });
                }
            })(files.pop());

            function processFile(file, callback) {
                var input = fs.createReadStream(file.temppath, {bufferSize: 4096});
                var output = fs.createWriteStream(file.savepath, {mode: config.filesMode});

                input.on("error",  function (error) { log.error(error); callback(); });
                output.on("error", function (error) { log.error(error); callback(); });

                input.on("close", function () {
                    fs.unlink(this.path, function (error) {
                        if (error) log.error(error);
                    });
                    callback();
                });

                input.pipe(output);
            }
        });

        form.on("error", function (error) {
            if (error && error.message === "Request aborted") {
                log.log(socket, " Upload cancelled.");
            } else {
                log.error(error);
            }
            readDirectory(clients[cookie].directory, function () {
                sendFiles(cookie, "UPLOAD_DONE");
            });
        });
    }
}
//-----------------------------------------------------------------------------
// Read the directory's content and store it in "dirs"
function readDirectory(root, callback) {
    fs.readdir(addFilePath(root), function (error, files) {
        if (error) log.error(error);
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
            fs.stat(addFilePath(root) + "/" + filename, function (error, stats) {
                counter++;
                if (!error && stats) {
                    if (stats.isFile())
                        type = "f";
                    if (stats.isDirectory())
                        type = "d";
                    if (type === "f" || type === "d")
                        dirContents[filename] = {"type": type, "size" : stats.size};
                } else if (error) {
                    log.error(error);
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
        log.simple("Unknown argument. See 'node droppy --help for help.'\n");
        process.exit(1);
        break;
    }

    function printUsage() {
        log.simple("droppy - file server on node.js (https://github.com/silverwind/droppy)");
        log.simple("Usage: node droppy [option] [option arguments]\n");
        log.simple("-help \t\t\t\tPrint this help");
        log.simple("-adduser username password\tCreate a new user for authentication\n");
    }
}
//-----------------------------------------------------------------------------
// Read and validate config.json
function readConfig() {
    try {
        config = JSON.parse(fs.readFileSync("./config.json"));
    } catch (e) {
        log.error("Error reading config.json\n", util.inspect(e));
        process.exit(1);
    }

    var opts = [
        "debug", "useSSL", "port", "readInterval", "filesMode", "dirMode",
        "linkLength", "maxOpen", "httpsKey", "httpsCert", "db", "filesDir", "resDir", "srcDir"
    ];
    for (var i = 0, len = opts.length; i < len; i++) {
        if (config[opts[i]] === undefined) {
            log.error("Error: Missing property in config.json:", opts[i]);
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
        if (Object.keys(db).length !== 3) doWrite = true;
        if (!db.users) db.users = {};
        if (!db.sessions) db.sessions = {};
        if (!db.shortlinks) db.shortlinks = {};
    } catch (e) {
        if (e.code === "ENOENT" || dbString.match(/^\s*$/)) {
            // Recreate DB file in case it doesn't exist / is empty
            log.simple(" ->> creating " + path.basename(config.db) + "...");
            db = {users: {}, sessions: {}, shortlinks: {}};
            doWrite = true;
        } else {
            log.error("Error reading ", config.db, "\n", util.inspect(e));
            process.exit(1);
        }
    }

    // Write a new DB if necessary
    if (doWrite)
        writeDB();
}
//-----------------------------------------------------------------------------
// Get a SHA256 hash of a string
function getHash(string) {
    return crypto.createHmac("sha256", new Buffer(string, "utf8")).digest("hex");
}
//-----------------------------------------------------------------------------
// Add a user to the database and save it to disk
function addUser(user, password, privileged) {
    var salt;
    if (db.users[user] !== undefined) {
        log.simple("User ", user, " already exists!");
        if (isCLI) process.exit(1);
    } else {
        salt = crypto.randomBytes(4).toString("hex");
        db.users[user] = {
            hash: getHash(password + salt + user) + "$" + salt,
            privileged: privileged
        };
        fs.writeFileSync(config.db, JSON.stringify(db, null, 4));
        writeDB(function () {
            if (isCLI) log.simple("User ", user, " successfully added.");
            if (isCLI) process.exit();
        });
    }
}
//-----------------------------------------------------------------------------
// Check if user/password is valid
function isValidUser(user, password) {
    var parts;
    if (db.users[user]) {
        parts = db.users[user].hash.split("$");
        if (parts.length === 2 && parts[0] === getHash(password + parts[1] + user))
            return true;
    }
    return false;
}
//-----------------------------------------------------------------------------
// Cookie helpers
function getCookie(cookie) {
    var sid = "";
    if (cookie) {
        var cookies = cookie.split("; ");
        cookies.forEach(function (c) {
            if (c.match(/^sid.*/)) {
                sid = c.substring(4);
            }
        });
        for (var savedsid in db.sessions) {
            if (savedsid === sid) {
                return sid;
            }
        }
    }
    return false;
}

function createCookie(req, res, postData) {
    var sessionID = crypto.randomBytes(32).toString("base64");
    var priv = db.users[postData.username].privileged;

    if (postData.check === "on") {
        // Create a semi-permanent cookie
        var dateString = new Date(new Date().getTime() + 31536000000).toUTCString();
        res.setHeader("Set-Cookie", "sid=" + sessionID + "; Expires=" + dateString);
    } else {
        // Create a single-session cookie
        // TODO: Delete these session ids after a certain period of inactivity from the client
        res.setHeader("Set-Cookie", "sid=" + sessionID + ";");
    }
    db.sessions[sessionID] = {privileged : priv};
    writeDB();
}

function writeDB(callback) {
    fs.writeFile(config.db, JSON.stringify(db, null, 4), function (error) {
        if (error) {
            log.error("Error writing ", config.db, "\n", util.inspect(error));
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

// Recursively walk a directory and return file paths in an array
function walkDirectory(dir, callback) {
    var results = [];
    fs.readdir(dir, function (error, list) {
        if (error) return callback(error);
        var i = 0;
        (function next() {
            var file = list[i++];
            if (!file) return callback(null, results);
            file = dir + '/' + file;
            fs.stat(file, function (error, stats) {
                if (stats && stats.isDirectory()) {
                    walkDirectory(file, function (error, res) {
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

// Watch the CSS files and send updates to the client for live styling
function setupDebugWatcher() {
    var cssfile = config.srcDir + "style.css";
    fs.watch(cssfile, helpers.debounce(function () {
        debugcss = [
            fs.readFileSync(getSrcPath("style.css")).toString("utf8"),
            fs.readFileSync(getSrcPath("sprites.css")).toString("utf8")
        ].join("\n");
        debugcss = autoprefixer("last 2 versions").compile(debugcss);

        for (var cookie in clients) {
            var data = JSON.stringify({
                "type"  : "UPDATE_CSS",
                "css"   : debugcss
            });
            if (clients[cookie].ws && clients[cookie].ws.readyState === 1) {
                clients[cookie].ws.send(data, function (error) {
                    if (error) log.error(error);
                });
            }
        }
    }), 100);
}

//============================================================================
// process event handlers
//============================================================================

process
    .on("SIGINT",  function () { shutdown("SIGINT");  })
    .on("SIGQUIT", function () { shutdown("SIGQUIT"); })
    .on("SIGTERM", function () { shutdown("SIGTERM"); })
    .on("uncaughtException", function (error) {
        log.error("=============== Uncaught exception! ===============");
        log.error(error);
    });

function shutdown(signal) {
    log.log("Received " + signal + " - Shutting down...");
    var count = 0;
    for (var client in clients) {
        if (!clients[client] || !clients[client].ws) continue;
        if (clients[client].ws.readyState < 2) {
            count++;
            clients[client].ws.close(1001);
        }
    }

    if (count > 0) log.log("Closed " + count + " active WebSockets");
    process.exit();
}