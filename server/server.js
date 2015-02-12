"use strict";

var pkg        = require("./../package.json"),
    resources  = require("./lib/resources.js"),
    cfg        = require("./lib/cfg.js"),
    cookies    = require("./lib/cookies.js"),
    demo       = require("./lib/demo.js"),
    db         = require("./lib/db.js"),
    log        = require("./lib/log.js"),
    manifest   = require("./lib/manifest.js"),
    mime       = require("./lib/mime.js"),
    paths      = require("./lib/paths.js").get(),
    utils      = require("./lib/utils.js"),
    watcher    = require("./lib/watcher.js");

var _          = require("lodash"),
    async      = require("async"),
    Busboy     = require("busboy"),
    chalk      = require("chalk"),
    cpr        = require("cpr"),
    engine     = require("detect-engine"),
    fs         = require("graceful-fs"),
    mv         = require("mv"),
    Wss        = require("websocket").server,
    yazl       = require("yazl");

var crypto     = require("crypto"),
    path       = require("path"),
    qs         = require("querystring");

var cache         = {},
    clients       = {},
    clientsPerDir = {},
    dirs          = {},
    config        = null,
    firstRun      = null,
    hasServer     = null,
    ready         = false,
    isDemo        = process.env.NODE_ENV === "droppydemo";

var UPDATE_THROTTLE = 500;

var droppy = function droppy(options, isStandalone, callback) {
    if (isStandalone) {
        log.logo();
        log.plain(" ", chalk.blue(pkg.name), " ", chalk.green(pkg.version), " running on ",
                chalk.blue(engine), " ", chalk.green(process.version.substring(1)), "\n ",
                chalk.blue("home"), " at ", chalk.green(paths.home), "\n");
    }

    setupProcess(isStandalone);

    async.series([
        function (cb) { utils.mkdir([paths.files, paths.temp, paths.cfg], cb); },
        function (cb) { if (isStandalone) fs.writeFile(paths.pid, process.pid, cb); else cb(); },
        function (cb) { cfg.init(options, function (err, conf) {
                if (err && err instanceof SyntaxError) {
                    if (isStandalone) {
                        log.error("config.json contains invalid JSON: ", err.message);
                        process.exit(1);
                    } else {
                        callback(err);
                    }
                }
                config = conf;
                cb(err);
            });
        },
        function (cb) { db.init(cb); },
    ], function (err) {
        if (err) return callback(err);
        log.init({logLevel: config.logLevel, timestamps: config.timestamps});
        fs.MAX_OPEN = config.maxOpen;
        firstRun = Object.keys(db.get("users")).length === 0;    // Allow user creation when no users exist
        async.series([
            function (cb) { if (isStandalone) { startListeners(cb); } else cb(); },
            function (cb) {
                log.simple("Preparing resources ...");
                resources.init(!config.debug, function (err, c) {
                    if (err) return callback(err);
                    cache = c;
                    cb();
                });
            },
            function (cb) { cleanupTemp(); cb(); },
            function (cb) { cleanupLinks(cb); },
            function (cb) { if (isDemo) demo.init(function (err) { if (err) log.error(err); }); cb(); },
            function (cb) { if (config.debug) watcher.watchResources(config.usePolling, clientUpdate); cb(); },
            function (cb) { watcher.watchFiles(config.usePolling, filesUpdate); cb(); },
        ], function (err) {
            if (err) return callback(err);
            if (isDemo) setInterval(demo.init, 30 * 60 * 1000);
            ready = true;
            log.simple("Ready for requests!");
            callback();
        });
    });
};

function onRequest(req, res, next) {
    req.time = Date.now();
    var method = req.method.toUpperCase();
    if (!hasServer && req.socket.server) setupSocket(req.socket.server);
    if (!ready) { // Show a simple self-reloading loading page during startup
        res.statusCode = 503;
        res.end("<!DOCTYPE html><html><head><title>droppy - starting ...</title></head><body><h2>Just a second! droppy is starting up ...<h2><script>window.setTimeout(function(){window.location.reload()},2000)</script></body></html>");
    } else {
        while (req.url.indexOf("%00") !== -1) req.url = req.url.replace(/\%00/g, ""); // Strip all null-bytes from the url
        if (method === "GET") {
            handleGET(req, res, next);
        } else if (method === "POST") {
            handlePOST(req, res, next);
        } else if (method === "OPTIONS") {
            res.setHeader("Allow", "GET,POST,OPTIONS");
            res.end();
            log.info(req, res);
        } else {
            res.statusCode = 405;
            res.end();
            log.info(req, res);
        }
    }
}

droppy._onRequest = onRequest;
exports = module.exports = droppy;

function startListeners(callback) {
    var listeners = config.listeners, sockets = [];

    if (!Array.isArray(listeners))
        return callback(new Error("Config Error: 'listeners' must be an array"));

    listeners.forEach(function (listener) {
        ["host", "port", "protocol"].forEach(function (prop) {
            if (typeof listener[prop] === "undefined" && !isDemo)
                return callback(new Error("Config Error: listener " + prop + " undefined"));
        });

        (Array.isArray(listener.host) ? listener.host : [listener.host]).forEach(function (host) {
            (Array.isArray(listener.port) ? listener.port : [listener.port]).forEach(function (port) {
                sockets.push({
                    host  : host,
                    port  : port,
                    opts  : {
                        proto   : listener.protocol,
                        hsts    : listener.hsts,
                        key     : listener.key,
                        cert    : listener.cert,
                        ca      : listener.ca,
                        dhparam : listener.dhparam
                    }
                });
            });
        });
    });

    async.each(sockets, function (socket, cb) {
        createListener(onRequest, socket.opts, function (err, server, tlsData) {
            if (err) {
                log.error(err);
                return cb();
            }

            server.on("listening", function () {
                setupSocket(server);
                if (tlsData) {
                    require("pem").readCertificateInfo(tlsData.cert, function (err, info) {
                        if (tlsData.selfsigned || !info.commonName) {
                            log.simple(chalk.green(socket.opts.proto.toUpperCase()) + " listening on ",
                                       chalk.cyan(server.address().address), ":", chalk.blue(server.address().port) +
                                       " (" + chalk.yellow("self-signed") + ")");
                        } else {
                            log.simple(chalk.green(socket.opts.proto.toUpperCase()) + " listening on ",
                                       chalk.cyan(server.address().address), ":", chalk.blue(server.address().port) +
                                       " (" + chalk.yellow(info.commonName) + ")");
                        }
                        cb();
                    });
                } else {
                    log.simple(chalk.green(socket.opts.proto.toUpperCase()) + " listening on ",
                               chalk.cyan(server.address().address), ":", chalk.blue(server.address().port));
                    cb();
                }
            });

            server.on("error", function (error) {
                if (error.code === "EADDRINUSE")
                    log.simple("Failed to bind to ", chalk.cyan(socket.host), chalk.red(":"),
                              chalk.blue(socket.port), chalk.red(". Address already in use."));
                else if (error.code === "EACCES")
                    log.simple("Failed to bind to ", chalk.cyan(socket.host), chalk.red(":"),
                              chalk.blue(socket.port), chalk.red(". Need permission to bind to ports < 1024."));
                else
                    log.error(error);
                cb(); // TODO: Pass error
            });
            server.listen(socket.port, socket.host);
        });
    }, callback);
}

//-----------------------------------------------------------------------------
// Create socket listener
function createListener(handler, opts, callback) {
    var server, tlsModule, http = require("http");
    if (opts.proto === "http") {
        callback(null, http.createServer(handler));
    } else {
        if (opts.proto === "https")
            tlsModule = require("tls");
        else if (opts.proto === "spdy")
            tlsModule = require("spdy").server;
        else
            return callback(new Error("Config error: Unknown protocol type: " + opts.proto));

        utils.tlsInit(opts, function (err, tlsData) {
            if (err) return callback(err);

            var tlsOptions = {
                key              : tlsData.key,
                cert             : tlsData.cert,
                ca               : tlsData.ca ? tlsData.ca : undefined,
                dhparam          : tlsData.dhparam ? tlsData.dhparam : undefined,
                honorCipherOrder : true,
                NPNProtocols     : []
            };

            // Slightly more secure options for 0.10.x
            if (/^v0.10/.test(process.version)) {
                tlsOptions.ciphers = "ECDHE-RSA-AES256-SHA:AES256-SHA:RC4-SHA:RC4:HIGH:!MD5:!aNULL:!EDH:!AESGCM";
                tlsOptions.secureProtocol = "SSLv23_server_method";
            }

            tlsModule.CLIENT_RENEG_LIMIT = 0; // No client renegotiation

            // Protocol-specific options
            if (opts.proto === "spdy") tlsOptions.windowSize = 1024 * 1024;

            server = new tlsModule.Server(tlsOptions, http._connectionListener);
            server.httpAllowHalfOpen = false;
            server.timeout = 120000;

            server.on("request", function (req, res) {
                if (opts.hsts && opts.hsts > 0)
                    res.setHeader("Strict-Transport-Security", "max-age=" + opts.hsts);
                handler(req, res);
            });

            server.on("clientError", function (err, conn) {
                conn.destroy();
            });

            // TLS session resumption
            var sessions = {};
            server.on("newSession", function (id, data) {
                sessions[id] = data;
            });
            server.on("resumeSession", function (id, cb) {
                cb(null, (id in sessions) ? sessions[id] : null);
            });

            callback(null, server, tlsData);
        });
    }
}

//-----------------------------------------------------------------------------
// WebSocket functions
function setupSocket(server) {
    hasServer = true;
    var wss = new Wss({
        httpServer: server,
        keepAlive: config.keepAlive > 0,
        keepaliveInterval: config.keepAlive,
        autoAcceptConnections: false
    });
    wss.on("request", function (request) {
        var ws, sid, cookie = cookies.get(request.cookies);

        if (!cookie && !config.public) {
            request.reject();
            log.info(ws, null, "Unauthorized WebSocket connection rejected.");
            return;
        } else {
            ws = request.accept();
            log.info(ws, null, "WebSocket [", chalk.green("connected"), "] ");
            sid = utils.newSid();
            clients[sid] = { views: [], cookie: cookie, ws: ws };
        }

        ws.on("message", function (message) {
            var msg = JSON.parse(message.utf8Data),
                vId = msg.vId;

            if (msg.type !== "SAVE_FILE") log.debug(ws, null, chalk.magenta("RECV "), message.utf8Data);

            switch (msg.type) {
            case "REQUEST_SETTINGS":
                sendObj(sid, {type: "SETTINGS", vId: vId, settings: {
                    "debug"         : config.debug,
                    "demoMode"      : isDemo,
                    "public"        : config.public,
                    "maxFileSize"   : config.maxFileSize,
                    "themes"        : Object.keys(cache.themes),
                    "modes"         : Object.keys(cache.modes),
                    "caseSensitive" : process.platform !== "win32"
                }});
                break;
            case "REQUEST_UPDATE":
                if (!utils.isPathSane(msg.data)) return log.info(ws, null, "Invalid update request: " + msg.data);
                if (!clients[sid]) clients[sid] = { views: [], ws: ws }; // This can happen when the server restarts
                readPath(msg.data, function (error, info) {
                    var clientDir, clientFile;
                    if (error) { // Send client back to root when the requested path doesn't exist
                        clientDir = "/";
                        clientFile = null;
                        log.error(error);
                        log.info(ws, null, "Non-existing update request, sending client to / : " + msg.data);
                        updateDirectory("/", function (sizes) {
                            sendFiles(sid, vId, "UPDATE_DIRECTORY", sizes);
                        });
                        return;
                    } else if (info.type === "f") {
                        clientDir = path.dirname(msg.data);
                        clientFile = path.basename(msg.data);
                        sendObj(sid, {type: "UPDATE_BE_FILE", file: clientFile, folder: clientDir, isFile: true, vId: vId});
                    } else {
                        clientDir = msg.data;
                        clientFile = null;
                        updateDirectory(clientDir, function (sizes) {
                            sendFiles(sid, vId, "UPDATE_DIRECTORY", sizes);
                        });
                    }
                    clients[sid].views[vId] = { file: clientFile, directory: clientDir };
                    if (!clientFile) updateClientsPerDir(clientDir, sid, vId);
                });
                break;
            case "DESTROY_VIEW":
                clients[sid].views[vId] = null;
                break;
            case "REQUEST_SHARELINK":
                if (!utils.isPathSane(msg.data)) return log.info(ws, null, "Invalid share link request: " + msg.data);
                var link, links = db.get("sharelinks");

                // Check if we already have a link for that file
                var hadLink = Object.keys(links).some(function (link) {
                    if (msg.data === links[link]) {
                        sendObj(sid, {type: "SHARELINK", vId: vId, link: link});
                        return true;
                    }
                });
                if (hadLink) break;

                link = utils.getLink(links, config.linkLength);
                log.info(ws, null, "Share link created: " + link + " -> " + msg.data);
                sendObj(sid, {type: "SHARELINK", vId: vId, link: link});
                links[link] = msg.data;
                db.set("sharelinks", links);
                break;
            case "DELETE_FILE":
                log.info(ws, null, "Deleting: " + msg.data);
                if (!utils.isPathSane(msg.data)) return log.info(ws, null, "Invalid file deletion request: " + msg.data);
                msg.data = utils.addFilesPath(msg.data);
                fs.stat(msg.data, function (error, stats) {
                    if (error) {
                        log.error("Error on stat()ing " + msg.data);
                        log.error(error);
                    } else if (stats) {
                        utils.rm(msg.data, function (error) {
                            if (error) {
                                log.error("Error deleting " + msg.data);
                                log.error(error);
                            }
                        });
                    }
                });
                break;
            case "SAVE_FILE":
                log.info(ws, null, "Saving: " + msg.data.to);
                if (!utils.isPathSane(msg.data.to)) return log.info(ws, null, "Invalid save request: " + msg.data);
                msg.data.to = utils.addFilesPath(msg.data.to);
                fs.stat(msg.data.to, function (error) {
                    if (error && error.code !== "ENOENT") {
                        log.error("Error saving " + msg.data.to);
                        log.error(error);
                        sendObj(sid, {type: "ERROR", vId: vId, text: "Error saving " + msg.data.to + ": " + error});
                    } else {
                        fs.writeFile(msg.data.to, msg.data.value, function (error) {
                            if (error) {
                                log.error("Error writing " + msg.data.to);
                                log.error(error);
                            } else {
                                delete cache.etags[msg.data.to];
                            }
                            sendObj(sid, {type: "SAVE_STATUS", vId: vId, status : error ? 1 : 0});
                        });
                    }
                });
                break;
            case "CLIPBOARD":
                if (!utils.isPathSane(msg.data.from)) return log.info(ws, null, "Invalid clipboard source: " + msg.data.from);
                if (!utils.isPathSane(msg.data.to)) return log.info(ws, null, "Invalid clipboard destination: " + msg.data.to);
                if (msg.data.to.indexOf(msg.data.from + "/") !== -1 && msg.data.to !== msg.data.from) {
                    log.error("Can't copy directory into itself");
                    sendObj(sid, {type: "ERROR", vId: vId, text: "Can't copy directory into itself."});
                    return;
                }

                var from = utils.addFilesPath(msg.data.from),
                    to   = utils.addFilesPath(msg.data.to),
                    type = msg.data.type;

                // In case source and destination are the same, append a number to the file/foldername
                if (from === to) {
                    utils.getNewPath(to, function (newTo) {
                        doClipboard(type, from, newTo);
                    });
                } else {
                    doClipboard(type, from, to);
                }
                break;
            case "CREATE_FOLDER":
                if (!utils.isPathSane(msg.data)) return log.info(ws, null, "Invalid directory creation request: " + msg.data);
                utils.mkdir(utils.addFilesPath(msg.data), function (error) {
                    if (error) return log.error(error);
                    log.info(ws, null, "Created: ", msg.data);
                });
                break;
            case "CREATE_FILE":
                if (!utils.isPathSane(msg.data)) return log.info(ws, null, "Invalid file creation request: " + msg.data);
                fs.open(utils.addFilesPath(msg.data), "wx", function (error, fd) {
                    if (error) return log.error(error);
                    fs.close(fd, function (error) {
                        if (error) log.error(error);
                        log.info(ws, null, "Created: ", msg.data);
                    });
                });
                break;
            case "RENAME":
                // Disallow whitespace-only and empty strings in renames
                if (!utils.isPathSane(msg.data.new) || /^\s*$/.test(msg.data.to) || msg.data.to === "") {
                    log.info(ws, null, "Invalid rename request: " + msg.data.new);
                    sendObj(sid, {type: "ERROR", text: "Invalid rename request"});
                    return;
                }
                fs.rename(utils.addFilesPath(msg.data.old), utils.addFilesPath(msg.data.new), function (error) {
                    if (error) log.error(error);
                    log.info(ws, null, "Renamed: ", msg.data.old, " -> ", msg.data.new);
                });
                break;
            case "GET_USERS":
                if (db.get("sessions")[cookie] && db.get("sessions")[cookie].privileged) {
                    sendUsers(sid);
                } else {
                    // Send an empty user list so the client know not to display the management options
                    sendObj(sid, {type: "USER_LIST", users: {}});
                }
                break;
            case "UPDATE_USER":
                var name = msg.data.name, pass = msg.data.pass;
                if (!db.get("sessions")[sid].privileged) return;
                if (pass === "") {
                    if (!db.get("users")[name]) return;
                    db.delUser(msg.data.name, function () {
                        log.info(ws, null, "Deleted user: ", chalk.magenta(name));
                        sendUsers(sid);
                    });
                } else {
                    var isNew = !db.get("users")[name];
                    db.addOrUpdateUser(name, pass, msg.data.priv, function () {
                        if (isNew)
                            log.info(ws, null, "Added user: ", chalk.magenta(name));
                        else
                            log.info(ws, null, "Updated user: ", chalk.magenta(name));
                        sendUsers(sid);
                    });
                }
                if (db.get("sessions")[sid].privileged) sendUsers(sid);
                break;
            case "CREATE_FILES":
                var files = Array.isArray(msg.data.files) ? msg.data.files : [msg.data.files];
                async.each(files,
                    function (file, callback) {
                        if (!utils.isPathSane(file)) return callback(new Error("Invalid empty file creation request: " + file));
                        utils.mkdir(path.dirname(utils.addFilesPath(file)), function (err) {
                            if (err) callback(err);
                            fs.writeFile(utils.addFilesPath(file), "", {mode: "644"}, function (err) {
                                if (err) return callback(err);
                                log.info(ws, null, "Created: " + file.substring(1));
                                callback();
                            });
                        });
                    }, function (err) {
                        if (err) log.error(ws, null, err);
                        if (msg.data.isUpload) sendObj(sid,{type: "UPLOAD_DONE", vId: vId});
                    }
                );
                break;
            case "CREATE_FOLDERS":
                var folders = Array.isArray(msg.data.folders) ? msg.data.folders : [msg.data.folders];
                async.each(folders,
                    function (folder, callback) {
                        if (!utils.isPathSane(folder)) return callback(new Error("Invalid empty file creation request: " + folder));
                        utils.mkdir(utils.addFilesPath(folder), callback);
                    }, function (err) {
                        if (err) log.error(ws, null, err);
                        if (msg.data.isUpload) sendObj(sid, {type: "UPLOAD_DONE", vId: vId});
                    }
                );
                break;
            case "GET_URL":
                log.info("Attempting to download " + msg.url + " to " + msg.to);
                request(msg.url, function (err, data) {
                    if (err) {
                        log.error("Error requesting " + msg.url);
                        log.error(err);
                    } else {
                        var dest = path.join(msg.to, path.basename(msg.url));
                        fs.writeFile(dest, data, {mode: "644"}, function () {
                            log.info("Sucessfully saved " + dest);
                        });
                    }
                });
                break;
            }
        });

        ws.on("close", function (code) {
            var reason;
            if (code === 4001) {
                reason = "(Logged out)";
                var sessions = db.get("sessions");
                delete sessions[cookie];
                db.set("sessions", sessions);
            } else if (code === 1001) {
                reason = "(Going away)";
            }
            removeClientPerDir(sid);
            delete clients[sid];
            log.info(ws, null, "WebSocket [", chalk.red("disconnected"), "] ", reason || "(Code: " + (code || "none")  + ")");
        });

        ws.on("error", log.error);
    });
}

//-----------------------------------------------------------------------------
// Send a file list update
function sendFiles(sid, vId, eventType, sizes) {
    if (!clients[sid]  || !clients[sid].views[vId] || !clients[sid].ws || !clients[sid].ws.socket) return;
    var dir = clients[sid].views[vId].directory,
        data = {
            vId    : vId,
            type   : eventType,
            folder : dir,
            data   : dirs[dir]
        };
    if (sizes) data.sizes = true;
    sendObj(sid, data);
}

//-----------------------------------------------------------------------------
// Send a list of users on the server
function sendUsers(sid) {
    var userDB   = db.get("users"),
        userlist = {};

    Object.keys(userDB).forEach(function (user) {
        userlist[user] = userDB[user].privileged || false;
    });
    sendObj(sid, {type: "USER_LIST", users: userlist});
}

//-----------------------------------------------------------------------------
// Send js object to single client identified by its session cooke
function sendObj(sid, data) {
    if (!clients[sid] || !clients[sid].ws) return;
    send(clients[sid].ws, JSON.stringify(data));
}

//-----------------------------------------------------------------------------
// Send js object to all clients
function sendObjAll(data) {
    Object.keys(clients).forEach(function (sid) {
        send(clients[sid].ws, JSON.stringify(data));
    });
}

//-----------------------------------------------------------------------------
// Do the actual sending
function send(ws, data) {
    (function queue(ws, data, time) {
        if (time > 1000) return; // in case the socket hasn't opened after 1 second, cancel the sending
        if (ws && ws.state === "open") {
            if (config.logLevel === 3) {
                var debugData = JSON.parse(data);
                // Remove some spammy logging
                if (debugData.type === "UPDATE_DIRECTORY") debugData.data = {"...": "..."};
                if (debugData.type === "RELOAD" && debugData.css) debugData.css = {"...": "..."};
                log.debug(ws, null, chalk.green("SEND "), JSON.stringify(debugData));
            }
            ws.sendUTF(data);
        } else {
            setTimeout(queue, 50, ws, data, time + 50);
        }
    })(ws, data, 0);
}
//-----------------------------------------------------------------------------
// Perform clipboard operation, copy/paste or cut/paste
function doClipboard(type, from, to) {
    fs.stat(from, function (error, stats) {
        if (error) return logError(error);
        if (stats) {
            if (type === "cut") {
                mv(from, to, logError);
            } else {
                if (stats.isFile()) {
                    utils.copyFile(from, to, logError);
                } else {
                    fs.readdir(from, function (error, files) {
                        if (error) return logError(error);
                        if (files.length) {
                            cpr(from, to, {deleteFirst: false, overwrite: true, confirm: true}, logError);
                        } else {
                            utils.mkdir(to);
                        }
                    });
                }
            }
        }
    });

    function logError(error) {
        if (!error) return;
        if (type === "cut")
            log.error("Error moving from \"" + from + "\" to \"" + to + "\"");
        else  {
            if (error === "no files to copy") {
                utils.mkdir(to);
            } else {
                log.error("Error copying from \"" + from + "\" to \"" + to + "\"");
            }
        }
        log.error(error);
    }
}

//-----------------------------------------------------------------------------
function handleGET(req, res) {
    var URI = decodeURIComponent(req.url);

    if (!utils.isPathSane(URI)) return log.info(req, res, "Invalid GET: " + req.url);

    if (config.public && !cookies.get(req.headers.cookie))
        cookies.free(req, res);

    if (/^\/\?!\/content/.test(URI)) {
        if (cookies.get(req.headers.cookie) || config.public) {
            res.setHeader("X-Page-Type", "main");
            handleResourceRequest(req, res, "main.html");
        } else if (firstRun) {
            res.setHeader("X-Page-Type", "firstrun");
            handleResourceRequest(req, res, "auth.html");
        } else {
            res.setHeader("X-Page-Type", "auth");
            handleResourceRequest(req, res, "auth.html");
        }
    } else if (/^\/\?!\//.test(URI)) {
        handleResourceRequest(req, res, (/\?!\/([\s\S]+)$/.exec(URI)[1]));
    } else if (/^\/\?[~\$]\//.test(URI)) {
        handleFileRequest(req, res, true);
    } else if (/^\/\?\?\//.test(URI)) {
        handleTypeRequest(req, res);
    } else if (/^\/\?_\//.test(URI)) {
        handleFileRequest(req, res, false);
    } else if (/^\/\?~~\//.test(URI)) {
        streamArchive(req, res, utils.addFilesPath(decodeURIComponent(req.url.substring("/~~/".length))));
    } else if (/^\/favicon.ico$/.test(URI)) {
        handleResourceRequest(req, res, "favicon.ico");
    } else {
        handleResourceRequest(req, res, "base.html");
    }
}

//-----------------------------------------------------------------------------
var blocked = [];
function handlePOST(req, res) {
    var URI = decodeURIComponent(req.url),
        body = "";

    if (!utils.isPathSane(URI)) return log.info(req, res, "Invalid POST: " + req.url);

    if (/\/upload/.test(URI)) {
        if (!cookies.get(req.headers.cookie)) {
            res.statusCode = 401;
            res.end();
            log.info(req, res);
        }
        handleUploadRequest(req, res);
    } else if (/\/login/.test(URI)) {
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

        req.on("data", function (data) { body += data; });
        req.on("end", function () {
            var postData = qs.parse(body);
            if (db.authUser(postData.username, postData.password)) {
                cookies.create(req, res, postData);
                endReq(req, res, true);
                log.info(req, res, "User ", postData.username, chalk.green(" authenticated"));
            } else {
                endReq(req, res, false);
                log.info(req, res, "User ", postData.username, chalk.red(" unauthorized"));
            }
        });
    } else if (/\/adduser/.test(URI) && firstRun) {
        req.on("data", function (data) { body += data; });
        req.on("end", function () {
            var postData = qs.parse(body);
            if (postData.username !== "" && postData.password !== "") {
                db.addOrUpdateUser(postData.username, postData.password, true);
                cookies.create(req, res, postData);
                firstRun = false;
                endReq(req, res, true);
            } else {
                endReq(req, res, false);
            }
        });
    } else {
        res.statusCode = 404;
        res.end();
    }

    function endReq(req, res, success) {
        res.statusCode = success ? 202 : 401;
        res.setHeader("Content-Type", "text/plain");
        res.setHeader("Content-Length", 0);
        res.end();
        log.info(req, res);
    }
}

//-----------------------------------------------------------------------------
function handleResourceRequest(req, res, resourceName) {
    var resource;

    // Assign filename, must be unique for resource requests
    if (/^\/\?!\/theme\//.test(req.url)) {
        resource = cache.themes[req.url.substring("/?!/theme/".length)];
    } else if (/^\/\?!\/mode\//.test(req.url)) {
        resource = cache.modes[req.url.substring("/?!/mode/".length)];
    } else if (/^\/\?!\/lib\//.test(req.url)) {
        resource = cache.lib[req.url.substring("/?!/lib/".length)];
    } else if (/^\/\?!\/manifest\.json$/.test(req.url)) {
        resource = {
            data: manifest(req),
            mime: "application/manifest+json"
        };
    } else {
        resource = cache.res[resourceName];
    }

    // Regular resource handling
    if (resource === undefined) {
        res.statusCode = 404;
        res.end();
    } else {
        if ((req.headers["if-none-match"] || "") === '"' + resource.etag + '"') {
            res.statusCode = 304;
            res.end();
        } else {
            var headers = {}, status = 200;

            if (req.url === "/" || /\?\!\/content/.test(req.url)) {
                if (!config.debug)
                    headers["X-Frame-Options"] = "DENY";
                if (req.headers["user-agent"] && req.headers["user-agent"].indexOf("MSIE") > 0)
                    headers["X-UA-Compatible"] = "IE=Edge, chrome=1";
            }

            if (/.+\.(png|ico|svg|woff)$/.test(resourceName)) {
                headers["Cache-Control"] = "public, max-age=604800";
                headers["Expires"] = new Date(Date.now() + 604800000).toUTCString();
            } else {
                headers["Cache-Control"] = "private, max-age=0";
                headers["Expires"] = "0";
            }

            if (resource.etag && !/\?\!\/content/.test(req.url)) {
                headers["ETag"] = '"' + resource.etag + '"';
            }

            // Content-Type
            if (/.+\.(js|css|html|svg)$/.test(resourceName))
                headers["Content-Type"] = resource.mime + "; charset=utf-8";
            else
                headers["Content-Type"] = resource.mime;

            // Encoding, Length
            var acceptEncoding = req.headers["accept-encoding"] || "";
            if ((/\bgzip\b/.test(acceptEncoding) || req.isSpdy) && resource.gzip && !config.debug) {
                headers["Content-Encoding"] = "gzip";
                headers["Content-Length"] = resource.gzip.length;
                headers["Vary"] = "Accept-Encoding";
                res.writeHead(status, headers);
                res.end(resource.gzip);
            } else {
                headers["Content-Length"] = resource.data.length;
                res.writeHead(status, headers);
                res.end(resource.data);
            }

        }
    }
    log.info(req, res);
}

//-----------------------------------------------------------------------------
function handleFileRequest(req, res, download) {
    var URI = decodeURIComponent(req.url), shareLink, filepath;

    // Check for a shareLink
    filepath = /\?([\$~_])\/([\s\S]+)$/.exec(URI);
    if (filepath[1] === "$") {
        shareLink = true;
        filepath = utils.addFilesPath(db.get("sharelinks")[filepath[2]]);
    } else if (filepath[1] === "~" || filepath[1] === "_") {
        filepath = utils.addFilesPath("/" + filepath[2]);
    }

    // Validate the cookie for the remaining requests
    if (!cookies.get(req.headers.cookie) && !shareLink) {
        res.writeHead(301, {"Location": "/"});
        res.end();
        log.info(req, res);
        return;
    }

    // 304 response when Etag matches
    if (!download && ((req.headers["if-none-match"] || "") === '"' + cache.etags[filepath] + '"')) {
        res.writeHead(304, {
            "Content-Type": mime.lookup(filepath)
        });
        res.end();
        log.info(req, res);
        return;
    }

    fs.stat(filepath, function (error, stats) {
        if (!error && stats) {
            if (stats.isDirectory() && shareLink) {
                streamArchive(req, res, filepath);
            } else {
                var headers = {"Content-Type": mime.lookup(filepath), "Content-Length": stats.size}, status = 200;
                if (download) {
                    headers["Content-Disposition"] = utils.getDispo(filepath);
                    res.writeHead(status, headers);
                    fs.createReadStream(filepath).pipe(res);
                } else {
                    cache.etags[filepath] = crypto.createHash("md5").update(String(stats.mtime)).digest("hex");
                    headers["Accept-Ranges"] = "bytes"; // advertise ranges support
                    headers["Etag"] = '"' + cache.etags[filepath] + '"';
                    if (req.headers.range) {
                        var total        = stats.size,
                            range        = req.headers.range,
                            parts        = range.replace(/bytes=/, "").split("-"),
                            partialstart = parts[0],
                            partialend   = parts[1],
                            start        = parseInt(partialstart, 10),
                            end          = partialend ? parseInt(partialend, 10) : total - 1;

                        status = 206;
                        headers["Content-Length"] = (end - start) + 1;
                        headers["Content-Range"]  = "bytes " + start + "-" + end + "/" + total;
                        res.writeHead(status, headers);
                        fs.createReadStream(filepath, {start: start, end: end}).pipe(res);
                    } else {
                        res.writeHead(status, headers);
                        fs.createReadStream(filepath).pipe(res);
                    }
                }
            }
        } else {
            if (error.code === "ENOENT")
                res.statusCode = 404;
            else if (error.code === "EACCES")
                res.statusCode = 403;
            else
                res.statusCode = 500;
            log.error(error);
            res.end();
        }
        log.info(req, res);
    });
}

//-----------------------------------------------------------------------------
function handleTypeRequest(req, res) {
    utils.isBinary(utils.addFilesPath(decodeURIComponent(req.url).substring(4)), function (error, result) {
        if (error) {
            res.statusCode = 500;
            res.end();
            log.error(error);
        } else {
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/plain");
            res.end(result ? "binary" : "text");
        }
    });
}

//-----------------------------------------------------------------------------
function handleUploadRequest(req, res) {
    var busboy, opts,
        done     = false,
        files    = {},
        cookie   = cookies.get(req.headers.cookie);

    req.query = qs.parse(req.url.substring("/upload?".length));

    if (!cookie && !config.public) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain");
        res.end();
        log.info(req, res);
        return;
    }

    log.info(req, res, "Upload started");

    opts = { headers: req.headers, fileHwm: 1024 * 1024, limits: {fieldNameSize: 255, fieldSize: 10 * 1024 * 1024}};

    if (config.maxFileSize > 0) opts.limits.fileSize = config.maxFileSize;
    busboy = new Busboy(opts);

    busboy.on("file", function (fieldname, file, filename) {
        var dstRelative = filename ? decodeURIComponent(filename) : fieldname,
            dst         = path.join(paths.files, decodeURIComponent(req.query.to), dstRelative),
            tmp         = path.join(paths.temp, crypto.createHash("md5").update(String(dst)).digest("hex")),
            writeStream = fs.createWriteStream(tmp, { mode: "644"});

        files[dstRelative] = {
            src : tmp,
            dst : dst,
            ws  : writeStream
        };

        file.pipe(writeStream);
    });

    busboy.on("filesLimit", function () {
        log.info(req, res, "Maximum files limit reached, cancelling upload");
        closeConnection();
    });

    busboy.on("finish", function () {
        var names = Object.keys(files);
        log.info(req, res, "Received " + names.length + " files");
        done = true;
        while (names.length > 0) {
            (function (name) {
                fs.stat(files[name].dst, function (error) {
                    if (error) { // File doesn't exist
                        fs.stat(path.dirname(files[name].dst), function (error) {
                            if (error) { // Dir doesn't exist
                                utils.mkdir(path.dirname(files[name].dst), function () {
                                    moveFile(files[name].src, files[name].dst);
                                });
                            } else {
                                moveFile(files[name].src, files[name].dst);
                            }
                        });
                    } else {
                        if (req.query.r === "true") { // Rename option from the client
                            (function (src, dst) {
                                utils.getNewPath(dst, function (newDst) {
                                    moveFile(src, newDst);
                                });
                            })(files[name].src, files[name].dst);

                        } else {
                            moveFile(files[name].src, files[name].dst);
                        }
                    }
                });
            })(names.pop());
        }
        closeConnection();

        function moveFile(src, dst) {
            mv(src, dst, function (err) {
                if (err) log.error(err);
            });
        }
    });

    req.on("close", function () {
        if (!done) log.info(req, res, "Upload cancelled");
        closeConnection();

        // Clean up the temp files
        Object.keys(files).forEach(function (relPath) {
            var ws = files[relPath].ws;
            fs.unlink(files[relPath].src, function () {});
            ws.on("finish", function () { // Wait for a possible stream to close before deleting
                fs.unlink(files[relPath].src, function () {});
            });
            ws.end();
        });
    });

    req.pipe(busboy);

    function closeConnection() {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain");
        res.setHeader("Connection", "close");
        res.end();

        // find websocket sid of the client and send the final event
        Object.keys(clients).forEach(function (sid) {
            if (clients[sid].cookie === cookie) {
                sendObj(sid, {type: "UPLOAD_DONE", vId: parseInt(req.query.vId, 10)});
            }
        });
    }
}

//-----------------------------------------------------------------------------
// Read a path, return type and info
// @callback : function (err, info)
function readPath(root, callback) {
    fs.stat(utils.addFilesPath(root), function (err, stats) {
        if (err) {
            callback(null, {
                type: "e",
                size: 0,
                mtime: 0
            });
        } else if (stats.isFile()) {
            callback(null, {
                type: "f",
                size: stats.size,
                mtime: stats.mtime.getTime() || 0,
                mime: mime.lookup(path.basename(root))
            });
        } else if (stats.isDirectory()) {
            callback(null, {
                type: "d",
                size: 0,
                mtime: stats.mtime.getTime() || 0
            });
        }
    });
}
//-----------------------------------------------------------------------------
// Update a directory's content
function updateDirectory(root, callback) {
    fs.readdir(utils.addFilesPath(root), function (error, files) {
        var dirContents = {}, fileNames;
        if (error) log.error(error);
        if (!files || files.length === 0) {
            dirs[root] = dirContents;
            callback();
            return;
        }
        fileNames = files;
        files = files.map(function (entry) { return root + "/" + entry; });
        async.map(files, readPath, function (err, results) {
            var i = fileNames.length;
            while (i > -1) {
                if (results[i]) {
                    dirContents[fileNames[i]] = results[i];
                }
                i--;
            }
            dirs[root] = dirContents;
            callback();
            generateDirSizes(root, dirContents, callback);
        });
    });
}

function generateDirSizes(root, dirContents, callback) {
    var todoDirs = [];
    Object.keys(dirContents).forEach(function (dir) {
        if (dirContents[dir].type === "d")
            todoDirs.push(utils.addFilesPath(path.join(root, "/", dir)));
    });
    if (todoDirs.length === 0) return;

    async.map(todoDirs, du, function (err, results) {
        results.forEach(function (result, i) {
            if (dirs[root][path.basename(todoDirs[i])])
                dirs[root][path.basename(todoDirs[i])].size = result;
            else
                log.error("Directory not cached", root, path.basename(todoDirs[i]));
        });
        callback(true);
    });
}

//-----------------------------------------------------------------------------
// Get a directory's size (the sum of all files inside it)
// TODO: caching of results
function du(dir, callback) {
    fs.stat(dir, function (error, stat) {
        if (error || !stat) return callback(null, 0);
        if (!stat.isDirectory()) return callback(null, stat.size);
        fs.readdir(dir, function (error, files) {
            if (error || !files || files.length === 0) return callback(null, 0);
            files = files.map(function (file) { return path.join(dir, file); });
            async.map(files, du, function (error, sizes) {
                callback(error, sizes && sizes.reduce(function (p, s) {
                    return p + s;
                }, stat.size));
            });
        });
    });
}

//-----------------------------------------------------------------------------
// Create a zip file from a directory and stream it to a client
function streamArchive(req, res, zipPath) {
    var zip;
    fs.stat(zipPath, function (err, stats) {
        if (err) {
            log.error(err);
        } else if (stats.isDirectory()) {
            res.statusCode = 200;
            res.setHeader("Content-Type", mime.lookup("zip"));
            res.setHeader("Content-Disposition", utils.getDispo(zipPath + ".zip"));
            res.setHeader("Transfer-Encoding", "chunked");
            log.info(req, res);
            log.info("Streaming zip of ", chalk.blue(utils.removeFilesPath(zipPath)));
            zip = new yazl.ZipFile();
            utils.walkDirectory(zipPath, true, function (err, files) {
                if (err) log.error(err);
                Object.keys(files).forEach(function (file) {
                    var stats = files[file];
                    if (/\/$/.test(file))
                        zip.addEmptyDirectory(utils.relativeZipPath(file), {mtime: stats.mtime, mode: stats.mode});
                    else
                        zip.addFile(file, utils.relativeZipPath(file), {mtime: stats.mtime, mode: stats.mode});
                });
                zip.outputStream.pipe(res);
                zip.end();
            });
        } else {
            res.statusCode = 404;
            res.end();
            log.info(req, res);
        }
    });
}

//-----------------------------------------------------------------------------
// Hourly tasks
setInterval(function hourly() {
    // Clean inactive sessions after 1 month of inactivity
    var sessions = db.get("sessions");
    Object.keys(sessions).forEach(function (session) {
        if (!sessions[session].lastSeen || (Date.now() - sessions[session].lastSeen >= 2678400000)) {
            delete sessions[session];
        }
    });
    db.set("sessions", sessions);
    // Clean up Etag cache
    cache.etags = {};
}, 60 * 60 * 1000);

//-----------------------------------------------------------------------------
// Watcher callback for files
function filesUpdate(type, event, p) {
    p = utils.normalizePath(p);              // Remove OS inconsistencies
    p = (p === ".") ? "/" : "/" + p;         // Prefix "/"

    log.debug("[" + chalk.magenta("FS:" + event) + "] " + chalk.blue(p));

    var dir;
    if (type === "dir") { // "addDir", "unlinkDir"
        if (p === "/") return; // Should never happen
        dir = path.resolve(p, "..");
    } else { // "add", "unlink",  "change"
        dir = path.dirname(p);
    }

    if (!clientsPerDir[dir]) return;

    // read the dir and push updates
    updateDirectory(dir, function (sizes) {
        clientsPerDir[dir].forEach(function (client) {
            client.update(sizes);
        });
    });
}

function updateClientsPerDir(dir, sid, vId) {
    // remove current client from any previous dirs
    removeClientPerDir(sid, vId);

    // and add client back
    if (!clientsPerDir[dir]) clientsPerDir[dir] = [];
    clientsPerDir[dir].push({
        sid    : sid,
        vId    : vId,
        update : _.throttle(function (sizes) {
           sendFiles(this.sid, this.vId, "UPDATE_DIRECTORY", sizes);
        }, UPDATE_THROTTLE, {leading: true, trailing: true})
    });
}

function removeClientPerDir(sid, vId) {
    Object.keys(clientsPerDir).forEach(function(dir) {
        var removeAt = [];
        clientsPerDir[dir].forEach(function(client, i) {
            if (client.sid === sid && (typeof vId === "number" ? client.vId === vId : true)) {
                removeAt.push(i);
            }
        });
        removeAt.reverse().forEach(function(pos) {
            clientsPerDir[dir].splice(pos, 1);
        });

        // purge dirs with no clients
        if (!clientsPerDir[dir].length) delete clientsPerDir[dir];
    });
}

//-----------------------------------------------------------------------------
// Update client directory on changes
function clientUpdate(filepath) {
    setTimeout(function () { // prevent EBUSY on win32
        if (/css$/.test(filepath)) {
            cache.res["style.css"] = resources.compileCSS();
            sendObjAll({type: "RELOAD", css: cache.res["style.css"].data.toString("utf8")});
        } else if (/js$/.test(filepath)) {
            cache.res["client.js"] = resources.compileJS();
            sendObjAll({type: "RELOAD"});
        } else if (/html$/.test(filepath)) {
            resources.compileHTML(cache.res);
            sendObjAll({type: "RELOAD"});
        }
    }, 100);
}

//-----------------------------------------------------------------------------
// Clean up the directory for incoming files
// Needs to be synchronous for process.on("exit")
function cleanupTemp() {
    fs.readdirSync(paths.temp).forEach(function (file) {
        utils.rmSync(path.join(paths.temp, file));
    });
}

//-----------------------------------------------------------------------------
// Clean up our shortened links by removing links to nonexistant files
function cleanupLinks(callback) {
    var linkcount = 0, cbcount = 0;
    var links = db.get("sharelinks");
    if (Object.keys(links).length === 0)
        callback();
    else {
        Object.keys(links).forEach(function (link) {
            linkcount++;
            (function (shareLink, location) {
                fs.stat(path.join(paths.files, location), function (error, stats) {
                    cbcount++;
                    if (!stats || error) {
                        delete links[shareLink];
                    }
                    if (cbcount === linkcount) {
                        db.set("sharelinks", links, function () {
                            callback();
                        });
                    }
                });
            })(link, links[link]);
        });
    }
}

//-----------------------------------------------------------------------------
// Process startup
function setupProcess(standalone) {
    process.on("exit", cleanupTemp);

    if (standalone) {
        process.on("SIGINT",  function () { endProcess("SIGINT");  });
        process.on("SIGQUIT", function () { endProcess("SIGQUIT"); });
        process.on("SIGTERM", function () { endProcess("SIGTERM"); });
        process.on("uncaughtException", function (error) {
            log.error("=============== Uncaught exception! ===============");
            log.error(error.stack);
        });
    }
}

//-----------------------------------------------------------------------------
// Process shutdown
function endProcess(signal) {
    var count = 0;
    log.simple("Received " + chalk.red(signal) + " - Shutting down ...");
    Object.keys(clients).forEach(function (sid) {
        if (!clients[sid] || !clients[sid].ws) return;
        if (clients[sid].ws.state === "open" || clients[sid].ws.state === "connecting") {
            count++;
            clients[sid].ws.drop(1001);
        }
    });
    if (count > 0) log.simple("Closed " + count + " active WebSocket" + (count > 1 ? "s" : ""));

    try {
       fs.unlinkSync(paths.pid);
   } catch(err) {}

    process.exit(0);
}
