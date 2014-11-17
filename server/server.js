"use strict";

var pkg        = require("./../package.json"),
    caching    = require("./lib/caching.js"),
    cfg        = require("./lib/cfg.js"),
    demo       = require("./lib/demo.js"),
    db         = require("./lib/db.js"),
    log        = require("./lib/log.js"),
    manifest   = require("./lib/manifest.js"),
    paths      = require("./lib/paths.js").get(),
    utils      = require("./lib/utils.js");

var _          = require("lodash"),
    ap         = require("autoprefixer-core"),
    archiver   = require("archiver"),
    async      = require("async"),
    Busboy     = require("busboy"),
    chalk      = require("chalk"),
    cpr        = require("cpr"),
    fs         = require("graceful-fs"),
    mime       = require("mime"),
    mv         = require("mv"),
    request    = require("request"),
    rimraf     = require("rimraf"),
    Wss        = require("ws").Server;

var crypto     = require("crypto"),
    path       = require("path"),
    qs         = require("querystring");

var cache      = {},
    clients    = {},
    dirs       = {},
    watchers   = {},
    config     = null,
    firstRun   = null,
    hasServer  = null,
    ready      = false,
    mode       = {file: "644", dir: "755"},
    isDemo     = process.env.NODE_ENV === "droppydemo";

var server = function init(home, options, isStandalone, callback) {
    if (isStandalone) printLogo();

    async.series([
        function (cb) { utils.mkdir([paths.files, paths.temp, paths.cfg], cb); },
        function (cb) { cfg.init(options, function (err, conf) { config = conf; cb(err); }); },
        function (cb) { db.init(cb); },
    ], function (err) {
        if (err) return callback(err);
        log.init({logLevel: config.logLevel, timestamps: config.timestamps});
        fs.MAX_OPEN = config.maxOpen;
        firstRun = Object.keys(db.get("users")).length === 0;    // Allow user creation when no users exist
        async.series([
            function (cb) { if (isStandalone) { startListeners(cb); } else cb(); },
            function (cb) { log.simple("Preparing resources ..."); cb(); },
            function (cb) { caching.init(!config.debug, function (err, c) { if (err) return callback(err); cache = c; cb(); }); },
            function (cb) { cleanupTemp(cb); },
            function (cb) { cleanupLinks(cb); },
            function (cb) { if (isDemo) demo.init(function (err) { if (err) log.error(err); cb(); }); else cb(); },
            function (cb) { if (config.debug) { watchCSS(); updateCSS(null, null, cb); } else cb(); }
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
    var method = req.method.toUpperCase();
    if (!hasServer && req.socket.server) setupSocket(req.socket.server);
    if (!ready) { // Show a simple self-reloading loading page during startup
        res.statusCode = 503;
        res.end("<!DOCTYPE html><html><head></head><body><h2>Just a second! droppy is starting up ...<h2><script>window.setTimeout(function(){window.location.reload()},500)</script></body></html>");
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

server._onRequest = onRequest;
exports = module.exports = server;

function printLogo() {
    log.plain([
            "....__..............................\n",
            ".--|  |----.-----.-----.-----.--.--.\n",
            "|  _  |   _|  _  |  _  |  _  |  |  |\n",
            "|_____|__| |_____|   __|   __|___  |\n",
            ".................|__|..|__|..|_____|\n",
        ].join("").replace(/\./gm, chalk.black("."))
                  .replace(/\_/gm, chalk.magenta("_"))
                  .replace(/\-/gm, chalk.magenta("-"))
                  .replace(/\|/gm, chalk.magenta("|"))
    );
    log.simple(chalk.blue(pkg.name), " ", chalk.green(pkg.version), " running on ",
               chalk.blue("node"), " ", chalk.green(process.version.substring(1)));
    log.simple(chalk.blue("home"), " is at ", chalk.green(paths.home), "\n");
}

function startListeners(callback) {
    var listeners = config.listeners, sockets = [];

    if (!Array.isArray(listeners))
        return callback(new Error("Config Error: 'listeners' must be an array"));

    listeners.forEach(function (listener) {
        ["host", "port", "protocol"].forEach(function (prop) {
            if (typeof listener[prop] === "undefined")
                return callback(new Error("Config Error: listener " + prop + " undefined"));
        });

        (Array.isArray(listener.host) ? listener.host : [listener.host]).forEach(function (host) {
            (Array.isArray(listener.port) ? listener.port : [listener.port]).forEach(function (port) {
                sockets.push({
                    host  : host,
                    port  : port,
                    opts  : {
                        proto : listener.protocol,
                        hsts  : listener.hsts,
                        key   : listener.key,
                        cert  : listener.cert,
                        ca    : listener.ca
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
                    if (tlsData.selfsigned) {
                        log.simple(chalk.green(socket.opts.proto.toUpperCase()) + " listening on ",
                                   chalk.cyan(server.address().address), ":", chalk.blue(server.address().port) +
                                   " (" + chalk.yellow("self-signed") + ")");
                        cb();
                    } else {
                        require("pem").readCertificateInfo(tlsData.cert, function (err, info) {
                            log.simple(chalk.green(socket.opts.proto.toUpperCase()) + " listening on ",
                                       chalk.cyan(server.address().address), ":", chalk.blue(server.address().port) +
                                       " (" + chalk.yellow(info.commonName) + ")");
                            cb();
                        });
                    }
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
// Create socket listeners
function createListener(handler, opts, callback) {
    var server, tlsModule, sessions, http = require("http");
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
                honorCipherOrder : true,
                ciphers          : "ECDHE-RSA-AES256-SHA:AES256-SHA:RC4-SHA:RC4:HIGH:!MD5:!aNULL:!EDH:!AESGCM",
                secureProtocol   : "SSLv23_server_method",
                NPNProtocols     : []
            };

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
            sessions = {};
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
    var wss = new Wss({server: server});
    if (config.keepAlive > 0) {
        setInterval(function () {
            Object.keys(wss.clients).forEach(function (client) {
                wss.clients[client].send("ping");
            });
        }, config.keepAlive);
    }
    wss.on("connection", function (ws) {
        var cookie = getCookie(ws.upgradeReq.headers.cookie);

        if (!cookie && !config.public) {
            ws.close(4000);
            log.info(ws, null, "Unauthorized WebSocket connection closed.");
            return;
        } else {
            log.info(ws, null, "WebSocket [", chalk.green("connected"), "] ");
            clients[cookie] = { views: [], ws: ws };
        }
        ws.on("message", function (message) {
            if (message === "pong") return;
            var msg = JSON.parse(message),
                vId = msg.vId;

            if (msg.type !== "SAVE_FILE") // Don't log these as they spam the file contents into the log
                log.debug(ws, null, chalk.magenta("RECV "), message);

            switch (msg.type) {
            case "REQUEST_SETTINGS":
                send(clients[cookie].ws, JSON.stringify({ type : "SETTINGS", vId : vId, settings: {
                    "debug"       : config.debug,
                    "demoMode"    : isDemo,
                    "public"      : config.public,
                    "maxFileSize" : config.maxFileSize
                }}));
                break;
            case "REQUEST_UPDATE":
                if (!utils.isPathSane(msg.data)) return log.info(ws, null, "Invalid update request: " + msg.data);
                if (!clients[cookie]) clients[cookie] = { views: [], ws: ws }; // This can happen when the server restarts
                readPath(msg.data, function (error, info) {
                    if (error) {
                        // Send client back to root when the requested path doesn't exist
                        log.error(error);
                        log.info(ws, null, "Non-existing update request, sending client to / : " + msg.data);
                        sendToRoot(cookie, vId);
                        return;
                    } else if (info.type === "f") {
                        clients[cookie].views[vId] = { file: path.basename(msg.data), directory: path.dirname(msg.data) };
                        send(clients[cookie].ws, JSON.stringify({
                            type: "UPDATE_BE_FILE",
                            file: clients[cookie].views[vId].file,
                            folder: clients[cookie].views[vId].directory,
                            isFile: true,
                            vId: vId,
                        }));
                    } else {
                        clients[cookie].views[vId] = { file: null, directory: msg.data };
                        updateDirectory(clients[cookie].views[vId].directory, function (sizes) {
                            sendFiles(cookie, vId, "UPDATE_DIRECTORY", sizes);
                        });
                        updateWatchers(clients[cookie].views[vId].directory, function (success) {
                            // Send client back to / in case the directory can't be read
                            if (!success) sendToRoot(cookie, vId);
                        });
                    }
                    function sendToRoot(cookie, vId) {
                        clients[cookie].views[vId] = { file: null, directory: "/" };
                        updateDirectory("/", function (sizes) {
                            sendFiles(cookie, vId, "UPDATE_DIRECTORY", sizes);
                        });
                        updateWatchers("/");
                    }
                });
                break;
            case "DESTROY_VIEW":
                clients[cookie].views[vId] = null;
                checkWatchedDirs();
                break;
            case "REQUEST_SHORTLINK":
                if (!utils.isPathSane(msg.data)) return log.info(ws, null, "Invalid shortlink request: " + msg.data);
                var link,
                    links = db.get("shortlinks");

                // Check if we already have a link for that file
                for (var l in links) {
                    if (msg.data === links[l]) {
                        sendLink(cookie, l, vId);
                        return;
                    }
                }

                // Get a pseudo-random n-character lowercase string. The characters
                // "l", "1", "i", "o", "0" characters are skipped for easier communication of links.
                var chars = "abcdefghjkmnpqrstuvwxyz23456789";
                do {
                    link = "";
                    while (link.length < config.linkLength)
                        link += chars.charAt(Math.floor(Math.random() * chars.length));
                } while (links[link]); // In case the RNG generates an existing link, go again
                log.info(ws, null, "Shortlink created: " + link + " -> " + msg.data);
                links[link] = msg.data;
                sendLink(cookie, link, vId);
                db.set("shortlinks", links);
                break;
            case "DELETE_FILE":
                log.info(ws, null, "Deleting: " + msg.data);
                if (!utils.isPathSane(msg.data)) return log.info(ws, null, "Invalid file deletion request: " + msg.data);
                msg.data = utils.addFilesPath(msg.data);
                fs.stat(msg.data, function (error, stats) {
                    if (error) {
                        log.error("Error getting stats to delete " + msg.data);
                        log.error(error);
                    } else if (stats) {
                        if (stats.isFile())
                            deleteFile(msg.data);
                        else if (stats.isDirectory())
                            deleteDirectory(msg.data);
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
                        send(clients[cookie].ws, JSON.stringify({ vId: vId, type: "ERROR", text: "Error saving " + msg.data.to + ": " + error}));
                    } else {
                        fs.writeFile(msg.data.to, msg.data.value, function (error) {
                            if (error) {
                                log.error("Error writing " + msg.data.to);
                                log.error(error);
                                sendSaveStatus(cookie, vId, 1); // Save failed
                            } else {
                                delete cache.etags[msg.data.to];
                                sendSaveStatus(cookie, vId, 0); // Save successful
                            }
                        });
                    }
                });
                break;
            case "CLIPBOARD":
                if (!utils.isPathSane(msg.data.from)) return log.info(ws, null, "Invalid clipboard source: " + msg.data.from);
                if (!utils.isPathSane(msg.data.to)) return log.info(ws, null, "Invalid clipboard destination: " + msg.data.to);
                if (msg.data.to.indexOf(msg.data.from + "/") !== -1 && msg.data.to !== msg.data.from) {
                    log.error("Can't copy directory into itself");
                    send(clients[cookie].ws, JSON.stringify({ vId: vId, type: "ERROR", text: "Can't copy directory into itself."}));
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
                    if (error) log.error(error);
                    log.info(ws, null, "Created: ", msg.data);
                });
                break;
            case "RENAME":
                // Disallow whitespace-only and empty strings in renames
                if (!utils.isPathSane(msg.data.new) || /^\s*$/.test(msg.data.to) || msg.data.to === "") {
                    log.info(ws, null, "Invalid rename request: " + msg.data.new);
                    send(clients[cookie].ws, JSON.stringify({ type: "ERROR", text: "Invalid rename request"}));
                    return;
                }
                fs.rename(utils.addFilesPath(msg.data.old), utils.addFilesPath(msg.data.new), function (error) {
                    if (error) log.error(error);
                    log.info(ws, null, "Renamed: ", msg.data.old, " -> ", msg.data.new);
                });
                break;
            case "GET_USERS":
                if (db.get("sessions")[cookie].privileged) {
                    sendUsers(cookie);
                } else {
                    // Send an empty user list so the client know not to display the management options
                    send(clients[cookie].ws, JSON.stringify({ type : "USER_LIST", users : {} }));
                }
                break;
            case "UPDATE_USER":
                var name = msg.data.name, pass = msg.data.pass;
                if (!db.get("sessions")[cookie].privileged) return;
                if (pass === "") {
                    if (!db.get("users")[name]) return;
                    db.delUser(msg.data.name, function () {
                        log.info(ws, null, "Deleted user: ", chalk.magenta(name));
                        sendUsers(cookie);
                    });
                } else {
                    var isNew = !db.get("users")[name];
                    db.addOrUpdateUser(name, pass, msg.data.priv, function () {
                        if (isNew)
                            log.info(ws, null, "Added user: ", chalk.magenta(name));
                        else
                            log.info(ws, null, "Updated user: ", chalk.magenta(name));
                        sendUsers(cookie);
                    });
                }
                if (db.get("sessions")[cookie].privileged) sendUsers(cookie);
                break;
            case "CREATE_FILES":
                var files = Array.isArray(msg.data.files) ? msg.data.files : [msg.data.files];
                async.each(files,
                    function (file, callback) {
                        if (!utils.isPathSane(file)) return callback(new Error("Invalid empty file creation request: " + file));
                        utils.mkdir(path.dirname(utils.addFilesPath(file)), function (err) {
                            if (err) callback(err);
                            fs.writeFile(utils.addFilesPath(file), "", {mode: mode.file}, function (err) {
                                if (err) return callback(err);
                                log.info(ws, null, "Created: " + file.substring(1));
                                callback();
                            });
                        });
                    }, function (err) {
                        if (err) log.error(ws, null, err);
                        if (msg.data.isUpload) send(clients[cookie].ws, JSON.stringify({ type : "UPLOAD_DONE", vId : vId }));
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
                        if (msg.data.isUpload) send(clients[cookie].ws, JSON.stringify({ type : "UPLOAD_DONE", vId : vId }));
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
                        fs.writeFile(dest, data, {mode: mode.file}, function () {
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
                delete clients[cookie];
            }
            log.info(ws, null, "WebSocket [", chalk.red("disconnected"), "] ", reason || "(Code: " + (code || "none")  + ")");
        });

        ws.on("error", function (error) {
            log.error(error);
        });
    });
}

//-----------------------------------------------------------------------------
// Send a file list update
function sendFiles(cookie, vId, eventType, sizes) {
    if (!clients[cookie].views[vId] || !clients[cookie] || !clients[cookie].ws || !clients[cookie].ws._socket) return;
    var dir = clients[cookie].views[vId].directory,
        data = {
            vId    : vId,
            type   : eventType,
            folder : dir,
            data   : dirs[dir]
        };
    if (sizes) data.sizes = true;
    send(clients[cookie].ws, JSON.stringify(data));
}

//-----------------------------------------------------------------------------
// Send a file link to a client
function sendLink(cookie, link, vId) {
    if (!clients[cookie] || !clients[cookie].ws) return;
    send(clients[cookie].ws, JSON.stringify({
        vId  : vId,
        type : "SHORTLINK",
        link : link
    }));
}

//-----------------------------------------------------------------------------
// Send a list of users on the server
function sendUsers(cookie) {
    if (!clients[cookie] || !clients[cookie].ws) return;
    var userDB   = db.get("users"),
        userlist = {};

    Object.keys(userDB).forEach(function (user) {
        userlist[user] = userDB[user].privileged || false;
    });

    send(clients[cookie].ws, JSON.stringify({
        type  : "USER_LIST",
        users : userlist
    }));
}

//-----------------------------------------------------------------------------
// Send status of a file save
function sendSaveStatus(cookie, vId, status) {
    if (!clients[cookie] || !clients[cookie].ws) return;
    send(clients[cookie].ws, JSON.stringify({
        type   : "SAVE_STATUS",
        vId    : vId,
        status : status
    }));
}

//-----------------------------------------------------------------------------
// Do the actual sending
function send(ws, data) {
    (function queue(ws, data, time) {
        if (time > 1000) return; // in case the socket hasn't opened after 1 second, cancel the sending
        if (ws && ws.readyState === 1) {
            if (config.logLevel === 3) {
                var debugData = JSON.parse(data);
                // Remove some spammy logging
                if (debugData.type === "UPDATE_DIRECTORY") debugData.data = {"...": "..."};
                if (debugData.type === "UPDATE_CSS") debugData.css = {"...": "..."};
                log.debug(ws, null, chalk.green("SEND "), JSON.stringify(debugData));
            }
            ws.send(data, function (error) {
                if (error) log.error(error);
            });
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
// Delete a file
function deleteFile(file) {
    fs.unlink(file, function (error) {
        if (error) log.error(error);
    });
}

//-----------------------------------------------------------------------------
// Delete a directory recursively
function deleteDirectory(directory) {
    var retries = 10;
    try {
        del(directory);
    } catch (err) {
        if (retries > 0) {
            retries--;
            del(directory);
        } else {
            log.error("Unable to delete " + directory + " after 10 retries.");
            log.error(err);
        }
    }
    function del(dir) {
        rimraf.sync(dir);
        checkWatchedDirs();
    }
}

//-----------------------------------------------------------------------------
// Watch the directory for changes and send them to the appropriate clients.
function createWatcher(directory) {
    var watcher, clientsToUpdate, client,
        dir = utils.removeFilesPath(directory);
    log.debug(chalk.green("Adding Watcher: ") + dir);
    watcher = fs.watch(directory, _.throttle(function () {
        log.debug("Watcher detected update for ", chalk.blue(dir));
        clientsToUpdate = [];
        Object.keys(clients).forEach(function (cookie) {
            client = clients[cookie];
            client.views.forEach(function (view, vId) {
                if (view && view.directory === dir) {
                    clientsToUpdate.push({cookie: cookie, vId: vId});
                }
            });
        });
        if (clientsToUpdate.length > 0) {
            updateDirectory(dir, function (sizes) {
                clientsToUpdate.forEach(function (cl) {
                    sendFiles(cl.cookie, cl.vId, "UPDATE_DIRECTORY", sizes);
                });
            });
        }
    }, config.readInterval, { leading: false, trailing: true }));
    watcher.on("error", function (error) {
        log.error("Error trying to watch ", dir, "\n", error);
    });
    watchers[dir] = watcher;
}

//-----------------------------------------------------------------------------
// Watch given directory
function updateWatchers(newDir, callback) {
    if (!watchers[newDir]) {
        newDir = utils.addFilesPath(newDir);
        fs.stat(newDir, function (error, stats) {
            if (error || !stats) {
                // Requested Directory can't be read
                checkWatchedDirs();
                if (callback) callback(false);
            } else {
                // Directory is okay to be read
                createWatcher(newDir);
                checkWatchedDirs();
                if (callback) callback(true);
            }
        });
    } else {
        if (callback) callback(true);
    }
}

//-----------------------------------------------------------------------------
// Check if we need the other active watchers
function checkWatchedDirs() {
    var neededDirs = {};
    Object.keys(clients).forEach(function (cookie) {
        var client = clients[cookie];
        client.views.forEach(function (view, vId) {
            if (view && view.directory && view.file === null) {
                neededDirs[client.views[vId].directory] = true;
            }
        });
    });
    Object.keys(watchers).forEach(function (watchedDir) {
        if (!neededDirs[watchedDir]) {
            log.debug(chalk.red("Removing Watcher: ") + watchedDir);
            watchers[watchedDir].close();
            delete watchers[watchedDir];
        }
    });
}

//-----------------------------------------------------------------------------
function handleGET(req, res) {
    var URI = decodeURIComponent(req.url),
    isAuth = false;
    req.time = Date.now();

    if (!utils.isPathSane(URI)) return log.info(req, res, "Invalid GET: " + req.url);

    if (config.public && !getCookie(req.headers.cookie))
        freeCookie(req, res);
    if (getCookie(req.headers.cookie) || config.public)
        isAuth = true;

    if (/^\/\?!\/content/.test(URI)) {
        if (isAuth) {
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
        handleResourceRequest(req, res, URI.match(/\?!\/([\s\S]+)$/)[1]);
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
        if (!getCookie(req.headers.cookie)) {
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
                createCookie(req, res, postData);
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
                createCookie(req, res, postData);
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

    // CSS debugging
    if (config.debug && resourceName === "style.css") {
        res.writeHead(200, {
            "Content-Type"   : "text/css; charset=utf-8",
            "Cache-Control"  : "private, max-age=0",
            "Expires"        : "0",
            "Content-Length" : cache.css.length
        });
        res.end(cache.css);
        log.info(req, res);
        return;
    }

    // Assign filename, must be unique for resource requests
    if (/^\/\?!\/theme\//.test(req.url)) {
        resource = cache.themes[req.url.substring("/?!/theme/".length)];
    } else if (/^\/\?!\/mode\//.test(req.url)) {
        resource = cache.modes[req.url.substring("/?!/mode/".length)];
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
            res.statusCode = 200;

            // Caching
            if (req.url === "/" || /\?\!\/content/.test(req.url)) {
                res.setHeader("Cache-Control", "private, max-age=0");
                res.setHeader("Expires", "0");
                if (!config.debug)
                    res.setHeader("X-Frame-Options", "DENY");
                if (req.headers["user-agent"] && req.headers["user-agent"].indexOf("MSIE") > 0)
                    res.setHeader("X-UA-Compatible", "IE=Edge, chrome=1");
            } else if (resourceName === "manifest.json") {
                res.setHeader("Cache-Control", "private, max-age=0");
                res.setHeader("Expires", "0");
            } else if (resourceName === "favicon.ico") {
                res.setHeader("Cache-Control", "public, max-age=604800");
                res.setHeader("Expires", new Date(Date.now() + 604800000).toUTCString());
            } else if (resource.etag) {
                res.setHeader("ETag", '"' + resource.etag + '"');
            }

            // Content-Type
            if (/.+\.(js|css|html)$/.test(resourceName))
                res.setHeader("Content-Type", resource.mime + "; charset=utf-8");
            else
                res.setHeader("Content-Type", resource.mime);

            // Encoding, Length
            var acceptEncoding = req.headers["accept-encoding"] || "";
            if (/\bgzip\b/.test(acceptEncoding) && resource.gzip !== undefined) {
                res.setHeader("Content-Encoding", "gzip");
                res.setHeader("Content-Length", resource.gzip.length);
                res.setHeader("Vary", "Accept-Encoding");
                res.end(resource.gzip);
            } else {
                res.setHeader("Content-Length", resource.data.length);
                res.end(resource.data);
            }
        }
    }
    log.info(req, res);
}

//-----------------------------------------------------------------------------
function handleFileRequest(req, res, download) {
    var URI = decodeURIComponent(req.url), shortLink, filepath;

    // Check for a shortlink
    filepath = URI.match(/\?([\$~_])\/([\s\S]+)$/);
    if (filepath[1] === "$") {
        shortLink = true;
        filepath = utils.addFilesPath(db.get("shortlinks")[filepath[2]]);
    } else if (filepath[1] === "~" || filepath[1] === "_") {
        filepath = utils.addFilesPath("/" + filepath[2]);
    }

    // Validate the cookie for the remaining requests
    if (!getCookie(req.headers.cookie) && !shortLink) {
        res.writeHead(301, {"Location": "/"});
        res.end();
        log.info(req, res);
        return;
    }

    // 304 response when Etag matches
    if (!download && ((req.headers["if-none-match"] || "") === '"' + cache.etags[filepath] + '"')) {
        res.statusCode = 304;
        res.end();
        log.info(req, res);
        return;
    }

    fs.stat(filepath, function (error, stats) {
        if (!error && stats) {
            if (stats.isDirectory() && shortLink) {
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
        cookie   = getCookie(req.headers.cookie);

    req.query = qs.parse(req.url.substring("/upload?".length));
    log.info(req, res, "Upload started");

    // FEATURE: Check permissions
    if (!clients[cookie] && !config.public) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain");
        res.end();
        log.info(req, res);
        return;
    }

    opts = { headers: req.headers, fileHwm: 1024 * 1024, limits: {fieldNameSize: 255, fieldSize: 10 * 1024 * 1024}};

    if (config.maxFileSize > 0) opts.limits.fileSize = config.maxFileSize;
    busboy = new Busboy(opts);

    busboy.on("file", function (fieldname, file, filename) {
        var dstRelative = filename ? decodeURIComponent(filename) : fieldname,
            dst         = path.join(paths.files, req.query.to, dstRelative),
            tmp         = path.join(paths.temp, crypto.createHash("md5").update(String(dst)).digest("hex")),
            writeStream = fs.createWriteStream(tmp, { mode: mode.file});

        files[dstRelative] = {
            src : tmp,
            dst : decodeURIComponent(dst),
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
        send(clients[cookie].ws, JSON.stringify({ type : "UPLOAD_DONE", vId : parseInt(req.query.vId, 10) }));
    }
}

//-----------------------------------------------------------------------------
// Read a path, return type and info
// @callback : function (error, info)
function readPath(root, callback) {
    fs.stat(utils.addFilesPath(root), function (error, stats) {
        if (error) {
            callback(error);
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
        } else {
            callback(new Error("Path neither directory or file!"));
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
    var tmpDirs = [];
    Object.keys(dirContents).forEach(function (dir) {
        if (dirContents[dir].type === "d")
            tmpDirs.push(utils.addFilesPath(path.join(root, "/", dir)));
    });
    if (tmpDirs.length === 0) return;

    async.map(tmpDirs, du, function (err, results) {
        results.forEach(function (result, i) {
            if (dirs[root][path.basename(tmpDirs[i])])
                dirs[root][path.basename(tmpDirs[i])].size = result;
            else
                log.error("Directory not cached", root, path.basename(tmpDirs[i]));
        });
        callback(true);
    });
}

//-----------------------------------------------------------------------------
// Get a directory's size (the sum of all files inside it)
// TODO: caching of results
function du(dir, callback) {
    fs.stat(dir, function (error, stat) {
        if (error) { return callback(error); }
        if (!stat) return callback(null, 0);
        if (!stat.isDirectory()) return callback(null, stat.size);
        fs.readdir(dir, function (error, list) {
            if (error) return callback(error);
            async.map(list.map(function (f) { return path.join(dir, f); }), function (f, callback) { return du(f, callback); },
                function (error, sizes) {
                    callback(error, sizes && sizes.reduce(function (p, s) {
                        return p + s;
                    }, stat.size));
                }
            );
        });
    });
}

//-----------------------------------------------------------------------------
// Create a zip file from a directory and stream it to a client
function streamArchive(req, res, zipPath) {
    var archive;
    fs.stat(zipPath, function (err, stats) {
        if (err) {
            log.error(err);
        } else if (stats.isDirectory()) {
            res.statusCode = 200;
            res.setHeader("Content-Type", mime.lookup("zip"));
            res.setHeader("Content-Disposition", utils.getDispo(zipPath + ".zip"));
            res.setHeader("Transfer-Encoding", "chunked");
            log.info(req, res);
            log.info("Streaming zip of ", req.url.substring(4));

            archive = archiver("zip", {zlib: { level: config.zipLevel }});
            archive.on("error", function (error) { log.error(error); });
            archive.pipe(res);
            archive.append(null, { name: path.basename(zipPath) + '/' });
            archive.bulk([
                { expand: true, dot: true, cwd: zipPath, src: ["**"], dest: path.basename(zipPath) }
            ]);
            archive.finalize();
        } else {
            res.statusCode = 404;
            res.end();
            log.info(req, res);
        }
    });
}

//-----------------------------------------------------------------------------
// Cookie functions
function getCookie(cookie) {
    var cookies, sessions,
        session = "";
    if (cookie) {
        cookies = cookie.split("; ");
        cookies.forEach(function (c) {
            if (new RegExp("^s.*").test(c)) {
                session = c.substring(2);
            }
        });
        sessions = db.get("sessions");
        for (var savedSession in sessions) {
            if (savedSession === session) {
                sessions[session].lastSeen = Date.now();
                db.set("sessions", sessions);
                return session;
            }
        }
    }
    return false;
}

function freeCookie(req, res) {
    var dateString = new Date(Date.now() + 31536000000).toUTCString(),
        sessionID  = crypto.randomBytes(32).toString("base64"),
        sessions   = db.get("sessions");

    res.setHeader("Set-Cookie", "s=" + sessionID + ";expires=" + dateString + ";path=/");
    sessions[sessionID] = {privileged : true, lastSeen : Date.now()};
    db.set("sessions", sessions);
}

function createCookie(req, res, postData) {
    var dateString,
        users     = db.get("users"),
        sessions  = db.get("sessions"),
        sessionID = crypto.randomBytes(32).toString("base64");

    if (postData.check === "on") {
        // Create a semi-permanent cookie
        dateString = new Date(Date.now() + 31536000000).toUTCString();
        res.setHeader("Set-Cookie", "s=" + sessionID + ";expires=" + dateString + ";path=/");
    } else {
        // Create a single-session cookie
        res.setHeader("Set-Cookie", "s=" + sessionID + ";path=/");
    }
    sessions[sessionID] = {privileged : users[postData.username].privileged, lastSeen : Date.now()};
    db.set("sessions", sessions);
}

// Clean inactive sessions after 1 month of inactivity, and check their age hourly
setInterval(cleanUpSessions, 60 * 60 * 1000);
function cleanUpSessions() {
    var sessions = db.get("sessions");
    Object.keys(sessions).forEach(function (session) {
        if (!sessions[session].lastSeen || (Date.now() - sessions[session].lastSeen >= 2678400000)) {
            delete sessions[session];
        }
    });
    db.set("sessions", sessions);
}

// Clean up Etag cache hourly
setInterval(function () {
    cache.etags = {};
}, 60 * 60 * 1000);

//-----------------------------------------------------------------------------
// Watch and update style.css for debugging
function watchCSS() {
    fs.watch(path.join(paths.client, "/style.css"), updateCSS);
}

var lastUpdates = {};
function updateCSS(event, filename, cb) {
    if (!lastUpdates[filename] || Date.now() - lastUpdates[filename] > 1000) {
        lastUpdates[filename] = Date.now();
        setTimeout(function () { // Short timeout in case Windows still has the file locked
            var css = "";

            caching.files.css.forEach(function (file) {
                css += fs.readFileSync(file).toString("utf8");
            });

            css = ap({browsers: "last 2 versions"}).process(css).css;
            cache.css = css;

            if (typeof cb === "function") { // Initial cache seeding
                cb();
            } else {
                Object.keys(clients).forEach(function (cookie) {
                    send(clients[cookie].ws, JSON.stringify({
                        "type"  : "UPDATE_CSS",
                        "css"   : cache.css
                    }));
                });
            }
        }, 200);
    }
}

//-----------------------------------------------------------------------------
// Clean up the directory for incoming files
function cleanupTemp(callback) {
    rimraf(paths.temp, function (err) {
        if (err && err.code !== "ENOENT" && callback) return callback(err);
        utils.mkdir(paths.temp, function (err) {
            if (err && callback) return callback(err);
            callback();
        });
    });
}

//-----------------------------------------------------------------------------
// Clean up our shortened links by removing links to nonexistant files
function cleanupLinks(callback) {
    var linkcount = 0, cbcount = 0;
    var links = db.get("shortlinks");
    if (Object.keys(links).length === 0)
        callback();
    else {
        Object.keys(links).forEach(function (link) {
            linkcount++;
            (function (shortlink, location) {
                fs.stat(path.join(paths.files, location), function (error, stats) {
                    cbcount++;
                    if (!stats || error) {
                        delete links[shortlink];
                    }
                    if (cbcount === linkcount) {
                        db.set("shortlinks", links, function () {
                            callback();
                        });
                    }
                });
            })(link, links[link]);
        });
    }
}

//-----------------------------------------------------------------------------
// Process signal and events
process
    .on("SIGINT",  function () { shutdown("SIGINT");  })
    .on("SIGQUIT", function () { shutdown("SIGQUIT"); })
    .on("SIGTERM", function () { shutdown("SIGTERM"); })
    .on("uncaughtException", function (error) {
        log.error("=============== Uncaught exception! ===============");
        log.error(error.stack);
    });

//-----------------------------------------------------------------------------
function shutdown(signal) {
    var count = 0;
    if (!ready) process.exit(0);
    log.simple("Received " + signal + " - Shutting down ...");
    Object.keys(clients).forEach(function (client) {
        if (!clients[client] || !clients[client].ws) return;
        if (clients[client].ws.readyState < 2) {
            count++;
            clients[client].ws.close(1001);
        }
    });
    if (count > 0) log.simple("Closed " + count + " active WebSocket" + (count > 1 ? "s" : ""));

    cleanupTemp(function () {
        process.exit(0);
    });
}
