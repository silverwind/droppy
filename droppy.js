#!/bin/env node
/* ----------------------------------------------------------------------------
                          droppy - file server on node
                      https://github.com/silverwind/droppy
 ------------------------------------------------------------------------------
 Copyright (c) 2012 - 2014 silverwind

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
 --------------------------------------------------------------------------- */
"use strict";

var
    // Libraries
    utils        = require("./lib/utils.js"),
    log          = require("./lib/log.js"),
    cfg          = require("./lib/config.js"),
    tpls         = require("./lib/dottemplates.js"),
    // Modules
    archiver     = require("archiver"),
    async        = require("async"),
    ap           = require("autoprefixer"),
    cpr          = require("cpr"),
    Busboy       = require("busboy"),
    chalk        = require("chalk"),
    crypto       = require("crypto"),
    fs           = require("graceful-fs"),
    _            = require("lodash"),
    mime         = require("mime"),
    mkdirp       = require("mkdirp"),
    path         = require("path"),
    qs           = require("querystring"),
    request      = require("request"),
    rimraf       = require("rimraf"),
    util         = require("util"),
    Wss          = require("ws").Server,
    zlib         = require("zlib"),
    // Variables
    version      = require("./package.json").version,
    templateList = ["views/directory.dotjs", "views/document.dotjs", "views/media.dotjs", "options.dotjs"],
    cache        = { res: {}, files: {} },
    clients      = {},
    db           = {},
    dirs         = {},
    watchers     = {},
    config       = null,
    cssCache     = null,
    firstRun     = null,
    hasServer    = null,
    ready        = false,
    hasServer    = null,
    cookieName   = "s",
    isCLI        = (process.argv.length > 2 && process.argv[2] !== "--color"),
    mode         = {file: "644", dir: "755"},
    resources    = {
        css  : [
            "node_modules/codemirror/lib/codemirror.css",
            "src/style.css",
            "src/sprites.css",
            "node_modules/codemirror/theme/mdn-like.css",
            "node_modules/codemirror/theme/xq-light.css",
            "node_modules/codemirror/theme/base16-dark.css"
        ],
        js   : [
            "node_modules/jquery/dist/jquery.js",
            "src/client.js",
            "node_modules/codemirror/lib/codemirror.js",
            "node_modules/codemirror/addon/selection/active-line.js",
            "node_modules/codemirror/addon/selection/mark-selection.js",
            "node_modules/codemirror/addon/search/searchcursor.js",
            "node_modules/codemirror/addon/edit/matchbrackets.js",
            "node_modules/codemirror/mode/css/css.js",
            "node_modules/codemirror/mode/coffeescript/coffeescript.js",
            "node_modules/codemirror/mode/javascript/javascript.js",
            "node_modules/codemirror/mode/xml/xml.js",
            "node_modules/codemirror/mode/htmlmixed/htmlmixed.js",
            "node_modules/codemirror/mode/jade/jade.js",
            "node_modules/codemirror/mode/markdown/markdown.js",
            "node_modules/codemirror/mode/php/php.js",
            "node_modules/codemirror/keymap/sublime.js"
        ],
        html : [
            "src/base.html",
            "src/auth.html",
            "src/main.html"
        ],
        templates : []
    };

//-----------------------------------------------------------------------------
// Exported function, takes a option object which overrides config.json
var droppy = module.exports = function (options) {
    init(options);
    return function (req, res, next) {
        var method = req.method.toUpperCase();
        if (!hasServer && req.socket.server) setupSocket(req.socket.server);
        if (!ready) { // Show a simple self-reloading loading page during startup
            res.statusCode = 503;
            res.end("<!DOCTYPE html><html><head></head><body><h2>Just a second! droppy is starting up...<h2><script>window.setTimeout(function(){window.location.reload()},500)</script></body></html>");
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
    };
};


//-----------------------------------------------------------------------------
// Start up our own listener when not used as a module
if (!module.parent) {
    // Argument handler
    if (isCLI) handleArguments();

    console.log([
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
    log.simple(chalk.blue("droppy "), chalk.green(version), " running on ",
               chalk.blue("node "), chalk.green(process.version.substring(1), "\n"));

    createListener(droppy());
}

//-----------------------------------------------------------------------------
// Init everything
function init(options) {
    config = cfg(options, path.join(__dirname, "config.json"));

    log.init(config);

    fs.MAX_OPEN = config.maxOpen;
    log.useTimestamp = config.timestamps;

    // Read user/sessions from DB and check if its the first run
    readDB();
    // Copy/Minify JS, CSS and HTML content
    prepareContent();

    // Prepare to get up and running
    cacheResources(path.join(__dirname + "/res/"), function () {
        setupDirectories(function () {
            cleanupLinks(function() {
                ready = true;
                log.simple("Ready for requests!");
            });
        });
    });
}

//-----------------------------------------------------------------------------
// Read JS/CSS/HTML client resources, minify them, and write them to /res
function prepareContent() {
    var resourceList,
        resourceData = {},
        out = { css : "", js  : "" },
        compiledList = ["base.html", "auth.html", "main.html", "client.js", "style.css"],
        matches = { resource: 0, compiled: 0 };

    // Add Templates
    templateList.forEach(function (relPath) {
        resources.templates.push("src/templates/" + relPath);
    });

    resourceList = utils.flatten(resources);
    // Intialize the CSS cache when debugging
    if (config.debug) updateCSS();

    // Check if we to actually need to recompile resources
    resourceList.forEach(function (file) {
        try {
            if (crypto.createHash("md5").update(fs.readFileSync(path.join(__dirname, file))).digest("base64") === db.resourceHashes[file])
                matches.resource++;
            else return;
        } catch (error) { return; }
    });
    compiledList.forEach(function (file) {
        try {
            if (fs.statSync(getResPath(file)))
                matches.compiled++;
            else return;
        } catch (error) { return; }
    });
    if (matches.resource === resourceList.length &&
        matches.compiled === compiledList.length &&
        db.resourceDebug !== undefined &&
        db.resourceDebug === config.debug) {
        return;
    }

    // Read resources
    Object.keys(resources).forEach(function (type) {
        resourceData[type] = resources[type].map(function read(file) {
            var data;
            try {
                data = fs.readFileSync(path.join(__dirname, file)).toString("utf8");
            } catch (error) {
                log.error("Error reading " + file + ":\n", error);
                process.exit(1);
            }
            return data;
        });
    });

    // Concatenate CSS and JS
    log.simple("Minifying resources...");
    resourceData.css.forEach(function (data) {
        out.css += data + "\n";
    });

    resourceData.js.forEach(function (data) {
        // Append a semicolon to each javascript file to make sure it's
        // properly terminated. The minifier afterwards will take care of
        // any double-semicolons and whitespace.
        out.js += data + ";\n";
    });

    // Add SVG object
    var svgDir = path.join(__dirname,"/src/svg/"), svgData = {};
    fs.readdirSync(svgDir).forEach(function (name) {
        svgData[name.slice(0, name.length - 4)] = fs.readFileSync(path.join(svgDir, name), "utf8");
    });
    out.js = out.js.replace("/* {{ svg }} */", "droppy.svg = " + JSON.stringify(svgData) + ";");

    // Insert Templates Code
    var templateCode = "var t = {fn:{},views:{}};";
    resourceData.templates.forEach(function (data, index) {
        // Produce the doT functions
        templateCode += tpls.produceFunction("t." + templateList[index].replace(/\.dotjs$/, "").replace(/[\\\/]/, "."), data);
    });
    templateCode += ";";
    out.js = out.js.replace("/* {{ templates }} */", templateCode);


    // Add CSS vendor prefixes
    out.css = ap("last 2 versions").process(out.css).css;
    // Minify CSS
    out.css = new require("clean-css")({keepSpecialComments : 0}).minify(out.css);
    // Minify JS
    if (!config.debug)
        out.js = require("uglify-js").minify(out.js, {
            fromString: true,
            compress: {
                unsafe: true,
                screw_ie8: true
            }
        }).code;

    // Prepare HTML
    try {
        var index = 0;
        resourceData.html.forEach(function (data) {
            var name = path.basename(resources.html[index]);
            // Minify HTML by removing tabs, CRs and LFs
            fs.writeFileSync(getResPath(path.basename(name)), data.replace(/\n^\s*/gm, "").replace("{{version}}", version));
            index++;
        });
        fs.writeFileSync(getResPath("client.js"), out.js);
        fs.writeFileSync(getResPath("style.css"), out.css);
    } catch (error) {
        log.error("Error writing resources:\n", error);
        process.exit(1);
    }

    // Save the hashes of all compiled files
    resourceList.forEach(function (file) {
        if (!db.resourceHashes) db.resourceHashes = {};
        db.resourceHashes[file] = crypto.createHash("md5").update(fs.readFileSync(path.join(__dirname, file))).digest("base64");
        db.resourceDebug = config.debug; // Save the state of the last resource compilation
    });
    writeDB();
}

//-----------------------------------------------------------------------------
// Set up the directory
function setupDirectories(callback) {
    cleanupTemp(true, function () {
        try {
            mkdirp.sync(config.filesDir, mode.dir);
            mkdirp.sync(config.tempDir, mode.dir);
        } catch (error) {
            log.error("Unable to create directories:");
            log.error(error);
            process.exit(1);
        }

        if (config.demoMode) {
            cleanupForDemo(function schedule() {
                callback();
                setTimeout(cleanupForDemo, 30 * 60 * 1000, schedule);
            });
        } else {
            callback();
        }
    });
}

//-----------------------------------------------------------------------------
// Restore the files directory to an initial state for the demo mode
function cleanupForDemo(doneCallback) {
    var oldWatched, currentWatched;
    oldWatched = [];
    currentWatched = Object.keys(watchers);
    if (currentWatched.length > 0) {
        oldWatched = currentWatched;
        currentWatched.forEach(function (dir) {
            watchers[dir].close();
            delete watchers[dir];
        });
    }

    async.series([
        function (callback) {
            log.simple("Cleaning up...");
            rimraf(config.filesDir, function () {
                mkdirp(config.filesDir, mode.dir, function () {
                    callback(null);
                });
            });
        },
        function (callback) {
            log.simple("Adding samples...");
            cpr(path.join(__dirname, "src"), path.join(config.filesDir, "Sources"), function () {
                cpr(path.join(__dirname, "node_modules"), path.join(config.filesDir, "Modules"), function () {
                    callback(null);
                });
            });
        },
        function (callback) {
            var temp = path.join(config.tempDir + "img.zip"),
                DecompressZip = require("decompress-zip"),
                unzipper = new DecompressZip(temp),
                dest = path.join(config.filesDir, "Images");
            log.simple("Downloading image samples...");
            mkdirp(dest, mode.dir, function () {
                request("http://gdurl.com/lWOY/download").pipe(fs.createWriteStream(temp)).on("close", function() {
                    unzipper.on("extract", function () {
                        callback(null);
                    });
                    unzipper.extract({path: dest});
                });
            });
        }
    ], doneCallback);
}
//-----------------------------------------------------------------------------
// Clean up the directory for incoming files
function cleanupTemp(initial, callback) {
    rimraf(config.tempDir, function (error) {
        if (!initial) return callback();
        if (error) {
            log.simple("Error cleaning up temporary directories:");
            log.error(error);
            process.exit(1);
        }
        callback();
    });
}

//-----------------------------------------------------------------------------
// Clean up our shortened links by removing links to nonexistant files
function cleanupLinks(callback) {
    var linkcount = 0, cbcount = 0;
    var links = Object.keys(db.shortlinks);
    if (links.length === 0)
        callback();
    else {
        links.forEach(function (link) {
            linkcount++;
            (function (shortlink, location) {
                fs.stat(path.join(config.filesDir, location), function (error, stats) {
                    cbcount++;
                    if (!stats || error) {
                        delete db.shortlinks[shortlink];
                    }
                    if (cbcount === linkcount) {
                        writeDB();
                        callback();
                    }
                });
            })(link, db.shortlinks[link]);
        });
    }
}

//-----------------------------------------------------------------------------
// Bind to listening port
function createListener(handler) {
    var server, key, cert, ca, tlsModule, options, sessions,
        http = require("http");
    if (!config.useTLS) {
        server = http.createServer(handler);
    } else {
        try {
            key = fs.readFileSync(config.tlsKey);
            cert = fs.readFileSync(config.tlsCert);
            if (config.tls.ca.length) ca = fs.readFileSync(config.tlsCA);
        } catch (error) {
            log.error("Couldn't read required TLS keys or certificates.", util.inspect(error));
            process.exit(1);
        }

        tlsModule = config.useSPDY ? require("spdy").server : require("tls");

        // TLS options
        options = {
            key              : key,
            cert             : cert,
            ca               : ca,
            honorCipherOrder : true,
            ciphers          : "ECDHE-RSA-AES256-SHA:AES256-SHA:RC4-SHA:RC4:HIGH:!MD5:!aNULL:!EDH:!AESGCM",
            secureProtocol   : "SSLv23_server_method",
            NPNProtocols     : []
        };

        tlsModule.CLIENT_RENEG_LIMIT = 0; // No client renegotiation

        // Protocol-specific options
        if (config.useSPDY) options.windowSize = 1024 * 1024;

        server = new tlsModule.Server(options, http._connectionListener);
        server.httpAllowHalfOpen = false;
        server.timeout = 120000;

        server.on("request", function (req, res) {
            if (config.useHSTS) res.setHeader("Strict-Transport-Security", "max-age=31536000");
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

        server.on("resumeSession", function (id, callback) {
            callback(null, (id in sessions) ? sessions[id] : null);
        });
    }

    server.on("listening", function () {
        if (config.debug) watchCSS();
        log.simple("Listening on ", chalk.cyan(server.address().address),
                   ":", chalk.blue(server.address().port));
    });

    server.on("error", function (error) {
        if (error.code === "EADDRINUSE")
            log.simple("Failed to bind to ", chalk.cyan(config.host), chalk.red(":"),
                      chalk.blue(config.port), chalk.red(". Address already in use.\n"));
        else if (error.code === "EACCES")
            log.simple("Failed to bind to ", chalk.cyan(config.host), chalk.red(":"),
                      chalk.blue(config.port), chalk.red(". Need permission to bind to ports < 1024.\n"));
        else
            log.error(error);
        process.exit(1);
    });

    server.listen(config.port);
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

        if (!cookie && !config.noLogin) {
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
                    debug: config.debug,
                    demoMode: config.demoMode,
                    noLogin: config.noLogin,
                    maxFileSize: config.maxFileSize
                }}));
                break;
            case "REQUEST_UPDATE":
                if (!utils.isPathSane(msg.data)) return log.info(ws, null, "Invalid update request: " + msg.data);
                if (!clients[cookie]) clients[cookie] = { views: [], ws: ws }; // This can happen when the server restarts
                readPath(msg.data, function (error, info) {
                    if (error) {
                        return log.info(ws, null, "Non-existing update request: " + msg.data);
                    } else if (info.type === "f") {
                        clients[cookie].views[vId] = {};
                        clients[cookie].views[vId].file = path.basename(msg.data);
                        clients[cookie].views[vId].directory = path.dirname(msg.data);
                        send(clients[cookie].ws, JSON.stringify({
                            type: "UPDATE_BE_FILE",
                            file: clients[cookie].views[vId].file,
                            folder: clients[cookie].views[vId].directory,
                            isFile: true,
                            vId: vId,
                        }));
                    } else {
                        clients[cookie].views[vId] = {};
                        clients[cookie].views[vId].file = null;
                        clients[cookie].views[vId].directory = msg.data;
                        updateDirectory(clients[cookie].views[vId].directory, function (sizes) {
                            sendFiles(cookie, vId, "UPDATE_DIRECTORY", sizes);
                        });
                        updateWatchers(clients[cookie].views[vId].directory, function (success) {
                            // Send client back to / in case the directory can't be read
                            if (!success) {
                                updateDirectory("/", function (sizes) {
                                    sendFiles(cookie, vId, "UPDATE_DIRECTORY", sizes);
                                });
                            }
                        });
                    }
                });
                break;
            case "DESTROY_VIEW":
                clients[cookie].views[vId] = null;
                checkWatchedDirs();
                break;
            case "REQUEST_SHORTLINK":
                if (!utils.isPathSane(msg.data)) return log.info(ws, null, "Invalid shortlink request: " + msg.data);
                var link;
                // Check if we already have a link for that file
                if (msg.data in db.shortlinks) {
                    sendLink(cookie, db.shortlinks[msg.data], vId);
                    return;
                }
                // Get a pseudo-random n-character lowercase string. The characters
                // "l", "1", "i", "o", "0" characters are skipped for easier communication of links.
                var chars = "abcdefghjkmnpqrstuvwxyz23456789";
                do {
                    link = "";
                    while (link.length < config.linkLength)
                        link += chars.charAt(Math.floor(Math.random() * chars.length));
                } while (db.shortlinks[link]); // In case the RNG generates an existing link, go again
                log.info(ws, null, "Shortlink created: " + link + " -> " + msg.data);
                db.shortlinks[link] = msg.data;
                sendLink(cookie, link, vId);
                writeDB();
                break;
            case "DELETE_FILE":
                log.info(ws, null, "Deleting: " + msg.data);
                if (!utils.isPathSane(msg.data)) return log.info(ws, null, "Invalid file deletion request: " + msg.data);
                msg.data = addFilePath(msg.data);
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
                msg.data.to = addFilePath(msg.data.to);
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
                msg.data.from = addFilePath(msg.data.from);
                msg.data.to = addFilePath(msg.data.to);
                // In case source and destination are the same, append a number to the file/foldername
                utils.getNewPath(msg.data.to, function (newPath) {
                    doClipboard(msg.data.type, msg.data.from, newPath);
                });
                break;
            case "CREATE_FOLDER":
                if (!utils.isPathSane(msg.data)) return log.info(ws, null, "Invalid directory creation request: " + msg.data);
                mkdirp(addFilePath(msg.data), mode.dir, function (error) {
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
                fs.rename(addFilePath(msg.data.old), addFilePath(msg.data.new), function (error) {
                    if (error) log.error(error);
                    log.info(ws, null, "Renamed: ", msg.data.old, " -> ", msg.data.new);
                });
                break;
            case "GET_USERS":
                if (db.sessions[cookie].privileged) {
                    sendUsers(cookie);
                } else {
                    // Send an empty user list so the client know not to display the management options
                    send(clients[cookie].ws, JSON.stringify({ type : "USER_LIST", users : {} }));
                }
                break;
            case "UPDATE_USER":
                var name = msg.data.name, pass = msg.data.pass;
                if (!db.sessions[cookie].privileged) return;
                if (pass === "") {
                    if (!db.users[name]) return;
                    delUser(msg.data.name);
                    log.info(ws, null, "Deleted user: ", chalk.magenta(name));
                    sendUsers(cookie);
                } else {
                    var isNew = !db.users[name];
                    addOrUpdateUser(name, pass, msg.data.priv);
                    if (isNew)
                        log.info(ws, null, "Added user: ", chalk.magenta(name));
                    else
                        log.info(ws, null, "Updated user: ", chalk.magenta(name));
                    sendUsers(cookie);
                }
                if (db.sessions[cookie].privileged) sendUsers(cookie);
                break;
            case "CREATE_FILES":
                var files = Array.isArray(msg.data.files) ? msg.data.files : [msg.data.files];
                async.each(files,
                    function (file, callback) {
                        if (!utils.isPathSane(file)) return callback(new Error("Invalid empty file creation request: " + file));
                        mkdirp(path.dirname(addFilePath(file)), mode.dir, function (err) {
                            if (err) callback(err);
                            fs.writeFile(addFilePath(file), "", {mode: mode.file}, function (err) {
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
                        mkdirp(addFilePath(folder), mode.dir, callback);
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
                delete db.sessions[cookie];
                writeDB();
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
    var userlist = {};
    Object.keys(db.users).forEach(function (user) {
        userlist[user] = db.users[user].privileged || false;
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
                if (debugData.type === "UPDATE_DIRECTORY")
                    debugData.data = {"...": "..."}; // Remove directory data so logs aren't getting too spammy
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
        if (error) logError(error);
        if (stats && !error) {
            if (type === "cut") {
                fs.rename(from, to, logError);
            } else {
                if (stats.isFile()) {
                    copyFile(from, to, logError);
                } else if (stats.isDirectory()) {
                    cpr(from, to, {deleteFirst: false, overwrite: true, confirm: true}, logError);
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
                mkdirp(to);
            } else {
                log.error("Error copying from \"" + from + "\" to \"" + to + "\"");
            }
        }
        log.error(error);
    }
}
//-----------------------------------------------------------------------------
// Copy a file from one location to another quickly
// snippet from: http://stackoverflow.com/a/14387791/2096729
function copyFile(from, to, cb) {
    var cbCalled = false;
    from = fs.createReadStream(from);
    from.on("error", function (err) {
        done(err);
    });

    to = fs.createWriteStream(to);
    to.on("error", function (err) {
        done(err);
    });
    to.on("close", function () {
        done();
    });
    from.pipe(to);

    function done(err) {
        if (!cbCalled) {
            cb(err);
            cbCalled = true;
        }
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
    } catch(err) {
        if (retries > 0) {
            retries--;
            del(directory);
        } else {
            log.error("Unable to delete " + directory + " after 10 retries.");
            log.error(err);
        }
    }
    function del (dir) {
        rimraf.sync(dir);
        checkWatchedDirs();
    }
}

//-----------------------------------------------------------------------------
// Watch the directory for changes and send them to the appropriate clients.
function createWatcher(directory) {
    var watcher, clientsToUpdate, client,
        dir = removeFilePath(directory);
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
        newDir = addFilePath(newDir);
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
// Read resources and store them in the cache object
function cacheResources(dir, callback) {
    var relPath, fileData, fileTime,
        cbCalled = 0,
        cbFired = 0;

    dir = dir.substring(0, dir.length - 1); // Strip trailing slash
    utils.walkDirectory(dir, false, function (error, results) {
        if (error) log.error(error);
        results.forEach(function (fullPath) {
            relPath = fullPath.substring(dir.length + 1);
            try {
                fileData = fs.readFileSync(fullPath);
                fileTime = fs.statSync(fullPath).mtime;
            } catch (error) {
                log.error("Unable to read resource", error);
                process.exit(1);
            }

            cache.res[relPath] = {};
            cache.res[relPath].data = fileData;
            cache.res[relPath].etag = crypto.createHash("md5").update(String(fileTime)).digest("hex");
            cache.res[relPath].mime = mime.lookup(fullPath);
            if (/.*(js|css|html)$/.test(path.basename(fullPath))) {
                (function (filePath, data) {
                    cbCalled++;
                    zlib.gzip(data, function (error, gzipped) {
                        if (error) log.error(error);
                        cache.res[filePath].gzipData = gzipped;
                        if (++cbFired === cbCalled)
                            callback();
                    });
                })(relPath, cache.res[relPath].data);
            }
        });
    });
}

//-----------------------------------------------------------------------------
function handleGET(req, res, next) {
    var URI = decodeURIComponent(req.url),
    isAuth = false;
    req.time = Date.now();

    if (config.noLogin && !getCookie(req.headers.cookie))
        freeCookie(req, res);
    if (getCookie(req.headers.cookie) || config.noLogin)
        isAuth = true;

    if (/\?!\/content/.test(URI)) {
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
    } else if (/\?!\//.test(URI)) {
        handleResourceRequest(req, res, URI.match(/\?!\/([\s\S]+)$/)[1]);
    } else if (/\?[~\$]\//.test(URI)) {
        handleFileRequest(req, res, true);
    } else if (/\?_\//.test(URI)) {
        handleFileRequest(req, res, false);
    } else if (/\?~~\//.test(URI)) {
        streamArchive(req, res, "zip");
    } else if (/\?favicon.ico/.test(URI)) {
        handleResourceRequest(req, res, "favicon.ico");
    /*} else if (URI === "/" || URI === "//") {*/
    } else {
        handleResourceRequest(req, res, "base.html");
        /*if (!isAuth) {
            res.statusCode = 301;
            res.setHeader("Location", "");
            res.end();
            log.info(req, res);
            return;
        }

        // Check if client is going to a path directly
        fs.stat(path.join(config.filesDir, URI), function (error) {
            if (!error) {
                handleResourceRequest(req, res, "base.html");
            } else {
                log.error(error);
                res.statusCode = 301;
                res.setHeader("Location", "/");
                res.end();
                log.info(req, res);
            }
        });*/
    }
}

//-----------------------------------------------------------------------------
var blocked = [];
function handlePOST(req, res, next) {
    var URI = decodeURIComponent(req.url)
      , body = "";
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
            if (isValidUser(postData.username, postData.password)) {
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
                addOrUpdateUser(postData.username, postData.password, true);
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
    // Shortcut for CSS debugging when no Websocket is available
    if (config.debug && resourceName === "style.css") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/css; charset=utf-8");
        res.setHeader("Cache-Control", "private, no-cache, no-transform, no-store");
        res.setHeader("Content-Length", Buffer.byteLength(cssCache, "utf8"));
        res.end(cssCache);
        log.info(req, res);
        return;
    }

    // Regular resource handling
    if (cache.res[resourceName] === undefined) {
        res.statusCode = 404;
        res.end();
    } else {
        if ((req.headers["if-none-match"] || "") === cache.res[resourceName].etag) {
            res.statusCode = 304;
            res.end();
        } else {
            res.statusCode = 200;

            // Disallow framing except when debugging
            if (!config.debug) res.setHeader("X-Frame-Options", "DENY");

            if (req.url === "/") {
                // Set the IE10 compatibility mode
                if (req.headers["user-agent"] && req.headers["user-agent"].indexOf("MSIE") > 0)
                    res.setHeader("X-UA-Compatible", "IE=Edge, chrome=1");
            } else if (/\?\/content\//.test(req.url)) {
                // Don't ever cache /content since its data is dynamic
                res.setHeader("Cache-Control", "private, no-cache, no-transform, no-store");
            } else if (resourceName === "favicon.ico") {
                // Set a long cache on the favicon, as some browsers seem to request them constantly
                res.setHeader("Cache-Control", "max-age=7257600");
            } else {
                // All other content can be cached
                res.setHeader("ETag", cache.res[resourceName].etag);
            }

            if (/.+\.(js|css|html)$/.test(resourceName))
                res.setHeader("Content-Type", cache.res[resourceName].mime + "; charset=utf-8");
            else
                res.setHeader("Content-Type", cache.res[resourceName].mime);

            var acceptEncoding = req.headers["accept-encoding"] || "";
            if (/\bgzip\b/.test(acceptEncoding) && cache.res[resourceName].gzipData !== undefined) {
                res.setHeader("Content-Encoding", "gzip");
                res.setHeader("Content-Length", cache.res[resourceName].gzipData.length);
                res.setHeader("Vary", "Accept-Encoding");
                res.end(cache.res[resourceName].gzipData);
            } else {
                res.setHeader("Content-Length", cache.res[resourceName].data.length);
                res.end(cache.res[resourceName].data);
            }
        }
    }
    log.info(req, res);
}

//-----------------------------------------------------------------------------
function handleFileRequest(req, res, download) {
    var URI = decodeURIComponent(req.url), shortLink, dispo, filepath;

    // Safety check
    //if (!utils.isPathSane(URI)) return log.info(req, res, "Invalid file request: " + req.url);

    // Check for a shortlink
    filepath = URI.match(/\?([\$~_])\/([\s\S]+)$/)
    if (filepath[1] === "$") {
        filepath = addFilePath(db.shortlinks[filepath[2]]);
    } else if (filepath[1] === "~"
            || filepath[1] === "_") {
        filepath = addFilePath("/" + filepath[2]);
    }

    // Validate the cookie for the remaining requests
    if (!getCookie(req.headers.cookie) && !shortLink) {
        res.statusCode = 301;
        res.setHeader("Location", "/");
        res.end();
        log.info(req, res);
        return;
    }

    // 304 response when Etag matches
    if (!download && (req.headers["if-none-match"] || "" === cache.files[filepath])) {
        res.statusCode = 304;
        res.end();
        log.info(req, res);
        return;
    }

    fs.stat(filepath, function (error, stats) {
        if (!error && stats) {
            res.statusCode = 200;

            // Set disposition headers for downloads
            if (download) {
                if (shortLink) {
                    // IE 10/11 can't handle an UTF-8 Content-Dispotsition header, so we encode it
                    if (req.headers["user-agent"] && req.headers["user-agent"].indexOf("MSIE") > 0)
                        dispo = ['attachment; filename="', encodeURIComponent(path.basename(filepath)), '"'].join("");
                    else
                        dispo = ['attachment; filename="', path.basename(filepath), '"'].join("");
                } else {
                    dispo = "attachment";
                }
                res.setHeader("Content-Disposition", dispo);
            }

            // Set short caching headers for non-downloads
            if (!download) {
                res.setHeader("Cache-Control", "private, max-age=30");
                cache.files[filepath] = crypto.createHash("md5").update(String(stats.mtime)).digest("hex");
                res.setHeader("Etag", cache.files[filepath]);
            }

            res.setHeader("Content-Type", mime.lookup(filepath));
            res.setHeader("Content-Length", stats.size);

            fs.createReadStream(filepath, {bufferSize: 4096}).pipe(res);
        } else {
            if (error.code === "ENOENT")
                res.statusCode = 404;
            else if (error.code === "EACCES")
                res.statusCode = 403;
            else
                res.statusCode = 500;
            res.end();
            if (error) log.error(error);
        }
    });

    log.info(req, res);
}

//-----------------------------------------------------------------------------
function handleUploadRequest(req, res) {
    var busboy, opts,
        done = false,
        files = [],
        cookie = getCookie(req.headers.cookie);

    req.query = qs.parse(req.url.substring("/upload?".length));
    log.info(req, res, "Upload started");

    // FEATURE: Check permissions
    if (!clients[cookie] && !config.noLogin) {
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
            dst = path.join(config.filesDir, req.query.to, dstRelative),
            tmp = path.join(config.tempDir, crypto.createHash("md5").update(String(dst)).digest("hex"));

        log.info(req, res, "Receiving: " + dstRelative);
        files[dstRelative] = {
            src: tmp,
            dst: decodeURIComponent(dst)
        };

        file.pipe(fs.createWriteStream(tmp, { mode: mode.file}));
    });

    busboy.on("filesLimit", function () {
        closeConnection();
    });

    busboy.on("finish", function () {
        var names = Object.keys(files);
        done = true;
        while (names.length > 0) {
            (function (name) {
                fs.stat(files[name].dst, function (error) {
                    if (error) { // File doesn't exist
                        fs.stat(path.dirname(files[name].dst), function (error) {
                            if (error) { // Dir doesn't exist
                                mkdirp.sync(path.dirname(files[name].dst), mode.dir);
                            }
                            moveFile(files[name].src, files[name].dst);
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
            fs.rename(src, dst, function (err) {
                if (err) log.error(err);
            });
        }
    });

    req.on("close", function () {
        if (!done) log.info(req, res, "Upload cancelled");
        closeConnection();
    });

    req.pipe(busboy);

    function closeConnection() {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain");
        res.setHeader("Connection", "close");
        res.end();
        send(clients[cookie].ws, JSON.stringify({ type : "UPLOAD_DONE", vId : req.query.vId }));
    }
}

//-----------------------------------------------------------------------------
// Read a path, return type and info
// @callback : function (error, info)
function readPath(root, callback) {
    fs.stat(addFilePath(root), function (error, stats) {
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
    fs.readdir(addFilePath(root), function (error, files) {
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
        if (dirContents[dir].type === "d") tmpDirs.push(addFilePath(root + "/" + dir));
    });
    if (tmpDirs.length === 0) return;

    async.map(tmpDirs, du, function (err, results) {
        results.forEach(function (result, i) {
            dirs[root][path.basename(tmpDirs[i])].size = result;
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
function streamArchive(req, res, type) {
    var zipPath = addFilePath(decodeURIComponent(req.url.substring(4))), archive, dispo;
    fs.stat(zipPath, function (err, stats) {
        if (err) {
            log.error(err);
        } else if (stats.isDirectory()) {
            res.statusCode = 200;

            if (req.headers["user-agent"] && req.headers["user-agent"].indexOf("MSIE") > 0)
                dispo = ['attachment; filename="', encodeURIComponent(path.basename(zipPath)), '.zip"'].join("");
            else
                dispo = ['attachment; filename="', path.basename(zipPath), '.zip"'].join("");

            res.setHeader("Content-Type", mime.lookup(type));
            res.setHeader("Content-Disposition", dispo);
            res.setHeader("Transfer-Encoding", "chunked");
            log.info(req, res);
            log.info("Streaming zip of /", req.url.substring(4));

            archive = archiver(type, {zlib: { level: config.zipLevel }});
            archive.on("error", function (error) { log.error(error); });
            archive.pipe(res);
            archive.append(null, { name: path.basename(zipPath) + '/' });
            archive.bulk([
                { expand: true, cwd: zipPath, src: ["**/*", "**/.*", "**/.*/**"], dest: path.basename(zipPath) }
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
// Argument handler
function handleArguments() {
    var args = process.argv.slice(2), option = args[0];
    config = cfg(path.join(__dirname, "config.json"));

    if (option === "list" && args.length === 1) {
        readDB();
        log.simple(["Active Users: "].concat(chalk.magenta(Object.keys(db.users).join(", "))).join(""));
        process.exit(0);
    } else if (option === "add" && args.length === 3) {
        readDB();
        process.exit(addOrUpdateUser(args[1], args[2], true));
    } else if (option === "del" && args.length === 2) {
        readDB();
        process.exit(delUser(args[1]));
    } else if (option === "version" || option === "-v" || option === "--version") {
        log.simple(version);
        process.exit(0);
    } else {
        printUsage(1);
    }

    function printUsage(exitCode) {
        log.simple(log.usage);
        process.exit(exitCode);
    }
}

//-----------------------------------------------------------------------------
// Read and validate the user database
function readDB() {
    var dbString = "",
        doWrite  = false;
    try {
        dbString = String(fs.readFileSync(config.db));
        db = JSON.parse(dbString);

        // Create sub-objects in case they aren't here
        if (Object.keys(db).length !== 3) doWrite = true;
        if (!db.users) db.users = {};
        if (!db.sessions) db.sessions = {};
        if (!db.shortlinks) db.shortlinks = {};
    } catch (error) {
        if (error.code === "ENOENT" || /^\s*$/.test(dbString)) {
            db = {users: {}, sessions: {}, shortlinks: {}};

            // Recreate DB file in case it doesn't exist / is empty
            log.simple("Creating ", chalk.magenta(path.basename(config.db)), "...");
            doWrite = true;
        } else {
            log.error("Error readinxg ", config.db, "\n", util.inspect(error));
            process.exit(1);
        }
    }

    // Write a new DB if necessary
    if (doWrite) writeDB();

    // Allow user creation when no users exist.
    firstRun = Object.keys(db.users).length < 1;
}

//-----------------------------------------------------------------------------
// Add a user to the database
function addOrUpdateUser(user, password, privileged) {
    var salt = crypto.randomBytes(4).toString("hex"),
        isNew = !db.users[user];
    db.users[user] = {
        hash: utils.getHash(password + salt + user) + "$" + salt,
        privileged: privileged
    };
    writeDB();
    if (isCLI) log.simple(chalk.magenta(user), " successfully ", isNew ? "added." : "updated.");
    return 1;
}

//-----------------------------------------------------------------------------
// Remove a user from the database
function delUser(user) {
    if (db.users[user]) {
        delete db.users[user];
        writeDB();
        if (isCLI) log.simple(chalk.magenta(user), " successfully removed.");
        return 0;
    } else {
        if (isCLI) log.simple(chalk.magenta(user), " does not exist!");
        return 1;
    }
}

//-----------------------------------------------------------------------------
// Check if user/password is valid
function isValidUser(user, pass) {
    var parts;
    if (db.users[user]) {
        parts = db.users[user].hash.split("$");
        if (parts.length === 2 && parts[0] === utils.getHash(pass + parts[1] + user))
            return true;
    }
    return false;
}

//-----------------------------------------------------------------------------
// Cookie functions
function getCookie(cookie) {
    var cookies,
        session = "";
    if (cookie) {
        cookies = cookie.split("; ");
        cookies.forEach(function (c) {
            if (new RegExp("^" + cookieName + ".*").test(c)) {
                session = c.substring(cookieName.length + 1);
            }
        });
        for (var savedsession in db.sessions) {
            if (savedsession === session) {
                db.sessions[session].lastSeen = Date.now();
                return session;
            }
        }
    }
    return false;
}

function freeCookie(req, res) {
    var dateString = new Date(Date.now() + 31536000000).toUTCString(),
        sessionID  = crypto.randomBytes(32).toString("base64");

    res.setHeader("Set-Cookie", cookieName + "=" + sessionID + ";expires=" + dateString + ";path=/");
    db.sessions[sessionID] = {privileged : true, lastSeen : Date.now()};
    writeDB();
}

function createCookie(req, res, postData) {
    var priv, dateString,
        sessionID = crypto.randomBytes(32).toString("base64");

    priv = db.users[postData.username].privileged;
    if (postData.check === "on") {
        // Create a semi-permanent cookie
        dateString = new Date(Date.now() + 31536000000).toUTCString();
        res.setHeader("Set-Cookie", cookieName + "=" + sessionID + ";expires=" + dateString + ";path=/");
    } else {
        // Create a single-session cookie
        res.setHeader("Set-Cookie", cookieName + "=" + sessionID + ";path=/");
    }
    db.sessions[sessionID] = {privileged : priv, lastSeen : Date.now()};
    writeDB();
}

// Clean inactive sessions after 1 month of inactivity, and check their age hourly
setInterval(cleanUpSessions, 60 * 60 * 1000);
function cleanUpSessions() {
    Object.keys(db.sessions).forEach(function (session) {
        if (!db.sessions[session].lastSeen || (Date.now() - db.sessions[session].lastSeen >= 2678400000)) {
            delete db.sessions[session];
        }
    });
}

// Clean up Etag cache hourly
setInterval(cleanUpEtags, 60 * 60 * 1000);
function cleanUpEtags() {
    cache.files = {};
}

//-----------------------------------------------------------------------------
// Watch the CSS files for debugging
function watchCSS() {
    resources.css.forEach(function (file) {
        fs.watch(path.join(__dirname, file), updateCSS);
    });
}

//-----------------------------------------------------------------------------
// Update the debug CSS cache and send it to the client(s)
function updateCSS() {
    var temp = "";
    resources.css.forEach(function (file) {
        temp += fs.readFileSync(path.join(__dirname, file)).toString("utf8") + "\n";
    });
    cssCache = ap("last 2 versions").process(temp).css;
    Object.keys(clients).forEach(function (cookie) {
        var data = JSON.stringify({
            "type"  : "UPDATE_CSS",
            "css"   : cssCache
        });
        if (clients[cookie].ws && clients[cookie].ws.readyState === 1) {
            clients[cookie].ws.send(data, function (error) {
                if (error) log.error(error);
            });
        }
    });
}

//-----------------------------------------------------------------------------
// Various helper functions
function writeDB()         { fs.writeFileSync(config.db, JSON.stringify(db, null, 4)); }
function getResPath(name)  { return path.join(__dirname + "/res/", name); }
// removeFilePath is intentionally not an inverse to the add function
function addFilePath(p)    { return utils.fixPath(config.filesDir + p); }
function removeFilePath(p) { return utils.fixPath("/" + utils.fixPath(p).replace(utils.fixPath(config.filesDir), "")); }

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
    log.simple("Received " + signal + " - Shutting down...");
    Object.keys(clients).forEach(function (client) {
        if (!clients[client] || !clients[client].ws) return;
        if (clients[client].ws.readyState < 2) {
            count++;
            clients[client].ws.close(1001);
        }
    });

    if (count > 0) log.simple("Closed " + count + " active WebSocket" + (count > 1 ? "s" : ""));

    cleanupTemp(false, function () {
        cleanUpSessions();
        writeDB();
        process.exit(0);
    });
}
