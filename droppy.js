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

(function () {
    var
        // Libraries
        utils    = require("./lib/utils.js"),
        log      = require("./lib/log.js"),
        cfg      = require("./lib/config.js"),
        // Modules
        archiver = require("archiver"),
        async    = require("async"),
        ap       = require("autoprefixer"),
        cpr      = require("cpr"),
        Busboy   = require("busboy"),
        chalk    = require("chalk"),
        crypto   = require("crypto"),
        fs       = require("graceful-fs"),
        http     = require("http"),
        mime     = require("mime"),
        mkdirp   = require("mkdirp"),
        path     = require("path"),
        qs       = require("querystring"),
        rimraf   = require("rimraf"),
        util     = require("util"),
        Wss      = require("ws").Server,
        zlib     = require("zlib"),
        // Variables
        version   = require("./package.json").version,
        cmPath    = "node_modules/codemirror/",
        cache     = {},
        clients   = {},
        db        = {},
        dirs      = {},
        watchers  = {},
        config    = null,
        cssCache  = null,
        firstRun  = null,
        ready     = false,
        isCLI     = (process.argv.length > 2),
        mode      = {file: "644", dir: "755"},
        resources = {
            css  : [cmPath + "lib/codemirror.css", "src/style.css", "src/sprites.css"],
            js   : ["node_modules/jquery/dist/jquery.js", "src/client.js", cmPath + "lib/codemirror.js"],
            html : ["src/base.html", "src/auth.html", "src/main.html"]
        };

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

    config = cfg(path.join(process.cwd(), "config.json"));
    log.init(config);
    fs.MAX_OPEN = config.maxOpen;
    log.useTimestamp = config.timestamps;

    // Read user/sessions from DB and check if its the first run
    readDB();
    firstRun = Object.keys(db.users).length < 1;

    // Listen but show an loading page until ready
    createListener();

    // Copy/Minify JS, CSS and HTML content
    prepareContent();

    // Prepare to get up and running
    cacheResources(config.resDir, function () {
        prepareSVG(function () {
            setupDirectories(function () {
                cleanupLinks();
                ready = true;
                log.simple("Ready for requests!");
            });
        });
    });

    //-----------------------------------------------------------------------------
    // Read JS/CSS/HTML client resources, minify them, and write them to /res
    function prepareContent() {
        var out = { css : "", js  : "" },
            compiledList = ["base.html", "auth.html", "main.html", "client.js", "style.css"],
            matches = { resource: 0, compiled: 0 },
            resourceList;

        // CodeMirror Addons
        ["selection/active-line.js", "selection/mark-selection.js", "search/searchcursor.js", "edit/matchbrackets.js"].forEach(function (relPath) {
            resources.js.push(cmPath + "addon/" + relPath);
        });
        // CodeMirror Modes
        ["css/css.js", "coffeescript/coffeescript.js", "javascript/javascript.js", "xml/xml.js", "htmlmixed/htmlmixed.js", "jade/jade.js",
         "markdown/markdown.js", "php/php.js"].forEach(function (relPath) {
            resources.js.push(cmPath + "mode/" + relPath);
        });
        // CodeMirror Modes
        resources.js.push(cmPath + "keymap/sublime.js");
        // CodeMirror Themes
        ["mdn-like.css", "xq-light.css", "base16-dark.css"].forEach(function (relPath) {
            resources.css.push(cmPath + "theme/" + relPath);
        });

        resourceList = utils.flatten(resources);

        // Intialize the CSS cache when debugging
        if (config.debug) updateCSS();

        // Check if we to actually need to recompile resources
        resourceList.forEach(function (file) {
            try {
                if (crypto.createHash("md5").update(fs.readFileSync(file)).digest("base64") === db.resourceHashes[file])
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
        var resourceData = {};
        for (var type in resources) {
            if (resources.hasOwnProperty(type)) {
                resourceData[type] = resources[type].map(function read(file) {
                    var data;
                    try {
                        data = fs.readFileSync(file).toString("utf8");
                    } catch (error) {
                        log.error("Error reading " + file + ":\n", error);
                        process.exit(1);
                    }
                    return data;
                });
            }
        }

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
            db.resourceHashes[file] = crypto.createHash("md5").update(fs.readFileSync(file)).digest("base64");
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
                mkdirp.sync(config.incomingDir, mode.dir);
            } catch (error) {
                log.error("Unable to create directories:");
                log.error(error);
                process.exit(1);
            }

            if (config.demoMode) {
                cleanupForDemo(function schedule() {
                    callback();
                    setTimeout(cleanupForDemo, 60 * 60 * 1000, schedule);
                });
            } else {
                callback();
            }
        });
    }

    //-----------------------------------------------------------------------------
    // Restore the files directory to an initial state for the demo mode
    function cleanupForDemo(callback) {
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
        log.simple("Cleaning up files and adding samples...");
        cpr(__dirname, config.filesDir, {
            deleteFirst: true,
            overwrite: true,
            filter: /(files|db\.json|config\.json|\.git|temp)/
        }, function (err) {
            if (err) log.error(err);
            log.simple("Cleaning done.");
            callback();
        });

    }
    //-----------------------------------------------------------------------------
    // Clean up the directory for incoming files
    function cleanupTemp(initial, callback) {
        rimraf(config.incomingDir, function (error) {
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
    function cleanupLinks() {
        var linkcount = 0, cbcount = 0;
        for (var link in db.shortlinks) {
            if (db.shortlinks.hasOwnProperty(link)) {
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
    }

    //-----------------------------------------------------------------------------
    // Bind to listening port
    function createListener() {
        var server, key, cert, ca;
        if (!config.useTLS) {
            server = http.createServer(onRequest);
        } else {
            try {
                key = fs.readFileSync(config.tls.key);
                cert = fs.readFileSync(config.tls.cert);
                if (config.tls.ca.length) {
                    if (Array.isArray(config.tls.ca))
                        ca = config.tls.ca;
                    else if (typeof config.tls.ca === "string")
                        ca = [config.tls.ca];
                    ca = ca.map(function read(file) { return fs.readFileSync(file); });
                }
            } catch (error) {
                log.error("Couldn't read required TLS keys or certificates. See `tls` section of config.json.\n\n", util.inspect(error));
                process.exit(1);
            }

            var mod = config.useSPDY ? require("spdy").server : require("tls");

            // TLS options
            // TODO: Harden the cipher suite
            var options = {
                key              : key,
                cert             : cert,
                ca               : ca,
                honorCipherOrder : true,
                ciphers          : "ECDHE-RSA-AES256-SHA:AES256-SHA:RC4-SHA:RC4:HIGH:!MD5:!aNULL:!EDH:!AESGCM",
                secureProtocol   : "SSLv23_server_method",
                NPNProtocols     : []
            };

            mod.CLIENT_RENEG_LIMIT = 0; // No client renegotiation

            // Protocol-specific options
            if (config.useSPDY) options.windowSize = 1024 * 1024;

            server = new mod.Server(options, http._connectionListener);
            server.httpAllowHalfOpen = false;
            server.timeout = 120000;

            server.on("request", function (req, res) {
                if (config.useHSTS)
                    res.setHeader("Strict-Transport-Security", "max-age=31536000");
                onRequest(req, res);
            });

            server.on("clientError", function (err, conn) {
                conn.destroy();
            });

            // TLS session resumption
            var sessions = {};

            server.on("newSession", function (id, data) {
                sessions[id] = data;
            });

            server.on("resumeSession", function (id, callback) {
                callback(null, (id in sessions) ? sessions[id] : null);
            });
        }

        server.on("listening", function () {
            setupSocket(server);
            if (config.debug) watchCSS();
            log.simple("Listening on ", chalk.cyan(server.address().address),
                       ":", chalk.blue(server.address().port));
        });

        server.on("error", function (error) {
            if (error.code === "EADDRINUSE")
                log.simple("Failed to bind to ", chalk.cyan(config.listenHost), chalk.red(":"),
                          chalk.blue(config.listenPort), chalk.red(". Address already in use.\n"));
            else if (error.code === "EACCES")
                log.simple("Failed to bind to ", chalk.cyan(config.listenHost), chalk.red(":"),
                          chalk.blue(config.listenPort), chalk.red(". Need permission to bind to ports < 1024.\n"));
            else
                log.error(error);
            process.exit(1);
        });

        server.listen(config.listenPort);
    }

    //-----------------------------------------------------------------------------
    // GET/POST handler
    function onRequest(req, res) {
        if (!ready) {
            res.statusCode = 503;
            res.end("droppy starting up...");
            return;
        }
        switch (req.method.toUpperCase()) {
        case "GET":
            handleGET(req, res);
            break;
        case "POST":
            handlePOST(req, res);
            break;
        case "OPTIONS":
            res.setHeader("Allow", "GET,POST,OPTIONS");
            res.end("\n");
            log.info(req, res);
            break;
        default:
            res.statusCode = 405;
            res.end("\n");
            log.info(req, res);
        }
    }

    //-----------------------------------------------------------------------------
    // WebSocket functions
    function setupSocket(server) {
        var wss = new Wss({server : server});
        if (config.keepAlive > 0) {
            setInterval(function () {
                for (var client in wss.clients)
                    if (wss.clients.hasOwnProperty(client))
                        wss.clients[client].send("ping");
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
                        noLogin: config.noLogin
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
                    // Check if we already have a link for that file
                    for (var link in db.shortlinks) {
                        if (db.shortlinks[link] === msg.data) {
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
                    log.info(ws, null, "Shortlink created: " + link + " -> " + msg.data);
                    db.shortlinks[link] = msg.data;
                    sendLink(cookie, link);
                    writeDB();
                    break;
                case "DELETE_FILE":
                    log.info(ws, null, "Deleting: " + msg.data.substring(1));
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
                    log.info(ws, null, "Saving: " + msg.data.to.substring(1));
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
                case "ZERO_FILES":
                    msg.data.forEach(function (file) {
                        var cbCalled = 0, cbFired = 0;
                        if (!utils.isPathSane(file)) return log.info(ws, null, "Invalid empty file creation request: " + file);
                        cbCalled++;
                        mkdirp(path.dirname(addFilePath(file)), mode.dir, function () {
                            fs.writeFile(addFilePath(file), "", {mode: mode.file}, function () {
                                log.info(ws, null, "Received: " + file.substring(1));
                                if (++cbFired === cbCalled) send(clients[cookie].ws, JSON.stringify({ type : "UPLOAD_DONE", vId : vId }));
                            });
                        });
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
    function sendLink(cookie, link) {
        if (!clients[cookie] || !clients[cookie].ws) return;
        send(clients[cookie].ws, JSON.stringify({
            type : "SHORTLINK",
            link : link
        }));
    }

    //-----------------------------------------------------------------------------
    // Send a list of users on the server
    function sendUsers(cookie) {
        if (!clients[cookie] || !clients[cookie].ws) return;
        var userlist = {};
        for (var user in db.users) {
            if (db.users.hasOwnProperty(user)) {
                userlist[user] = db.users[user].privileged || false;
            }
        }
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
                        debugData.data = {"...": "..."};
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
            else
                log.error("Error copying from \"" + from + "\" to \"" + to + "\"");
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
        rimraf.sync(directory);
        checkWatchedDirs();
    }

    //-----------------------------------------------------------------------------
    // Watch the directory for changes and send them to the appropriate clients.
    function createWatcher(directory) {
        var dir = removeFilePath(directory), watcher, clientsToUpdate, client;
        log.debug(chalk.green("Adding Watcher: ") + dir);
        watcher = fs.watch(directory, utils.throttle(function () {
            log.debug("Watcher detected update for ", chalk.blue(dir));
            clientsToUpdate = [];
            for (var cookie in clients) {
                if (clients.hasOwnProperty(cookie)) {
                    client = clients[cookie];
                    client.views.forEach(function (view, vId) {
                        if (view && view.directory === dir && view.file === null) {
                            clientsToUpdate.push({cookie: cookie, vId: vId});
                        }
                    });
                }
            }
            if (clientsToUpdate.length > 0) {
                updateDirectory(dir, function (sizes) {
                    clientsToUpdate.forEach(function (cl) {
                        sendFiles(cl.cookie, cl.vId, "UPDATE_DIRECTORY", sizes);
                    });
                });
            }
        }, config.readInterval, { leading: true, trailing: false }));
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
        for (var cookie in clients) {
            if (clients.hasOwnProperty(cookie)) {
                var client = clients[cookie];
                client.views.forEach(function (view, vId) {
                    if (view && view.directory && view.file === null) {
                        neededDirs[client.views[vId].directory] = true;
                    }
                });
            }
        }
        for (var directory in watchers) {
            if (!neededDirs[directory]) {
                log.debug(chalk.red("Removing Watcher: ") + directory);
                watchers[directory].close();
                delete watchers[directory];
            }
        }
    }

    //-----------------------------------------------------------------------------
    // Read resources and store them in the cache object
    function cacheResources(dir, callback) {
        var relPath, fileData, fileTime, cbCalled = 0, cbFired = 0;
        cache.res = {};

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
    // prepare SVGs
    function prepareSVG(callback) {
        cache.res.svg = {};
        try {
            var svgDir = config.srcDir + "svg/", svgData = {};
            fs.readdirSync(config.srcDir + "svg/").forEach(function (name) {
                svgData[name.slice(0, name.length - 4)] = fs.readFileSync(path.join(svgDir, name), "utf8");
            });
            cache.res.svg.data = JSON.stringify(svgData);
            zlib.gzip(new Buffer(cache.res.svg.data, "utf-8"), function (error, gzipped) {
                cache.res.svg.gzipData = gzipped;
                cache.res.svg.etag = crypto.createHash("md5").update(String(new Date())).digest("hex");
                callback();
            });
        } catch (error) {
            log.error("Error processing SVGs: ",  error);
            process.exit(1);
        }
    }

    //-----------------------------------------------------------------------------
    function handleGET(req, res) {
        var URI = decodeURIComponent(req.url), isAuth = false;
        req.time = Date.now();

        if (config.noLogin && !getCookie(req.headers.cookie)) freeCookie(req, res);
        if (getCookie(req.headers.cookie) || config.noLogin)
            isAuth = true;

        if (URI === "/" || URI === "//") {
            handleResourceRequest(req, res, "base.html");
        } else if (/^\/!\/content/.test(URI)) {
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
        } else if (/^\/!\/svg/.test(URI)) {
            handleResourceRequest(req, res, "svg");
        } else if (/^\/!\/null/.test(URI)) {
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Content-Length", 0);
            res.end();
            log.info(req, res);
            return;
        } else if (/^\/!\//.test(URI)) {
            handleResourceRequest(req, res, req.url.substring(3));
        } else if (/^\/~\//.test(URI) || /^\/\$\//.test(URI)) {
            handleFileRequest(req, res, true);
        } else if (/^\/_\//.test(URI)) {
            handleFileRequest(req, res, false);
        } else if (/^\/~~\//.test(URI)) {
            streamArchive(req, res, "zip");
        } else if (URI === "/favicon.ico") {
            handleResourceRequest(req, res, "favicon.ico");
        } else {
            if (!isAuth) {
                res.statusCode = 301;
                res.setHeader("Location", "/");
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
            });
        }
    }

    //-----------------------------------------------------------------------------
    var blocked = [];
    function handlePOST(req, res) {
        var URI = decodeURIComponent(req.url), body = "";
        if (/^\/upload/.test(URI)) {
            if (!getCookie(req.headers.cookie)) {
                res.statusCode = 401;
                res.end();
                log.info(req, res);
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
        } else if (URI === "/adduser" && firstRun) {
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
                } else if (/^\/content\//.test(req.url)) {
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

                if (resourceName === "svg")
                    res.setHeader("Content-Type", "text/plain" + "; charset=utf-8");

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
        var URI = decodeURIComponent(req.url).substring(3), shortLink, dispo, filepath;

        // Check for a shortlink
        if (/^\/\$\//.test(req.url) && db.shortlinks[URI] && URI.length  === config.linkLength)
            shortLink = db.shortlinks[URI];

        // Validate the cookie for the remaining requests
        if (!getCookie(req.headers.cookie) && !shortLink) {
            res.statusCode = 301;
            res.setHeader("Location", "/");
            res.end();
            log.info(req, res);
            return;
        }

        filepath = shortLink ? addFilePath(shortLink) : addFilePath("/" + URI);

        if (filepath) {
            var mimeType = mime.lookup(filepath);

            fs.stat(filepath, function (error, stats) {
                if (!error && stats) {
                    res.statusCode = 200;
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
                    res.setHeader("Content-Type", mimeType);
                    res.setHeader("Content-Length", stats.size);
                    log.info(req, res);
                    fs.createReadStream(filepath, {bufferSize: 4096}).pipe(res);
                } else {
                    if (error.code === "ENOENT")
                        res.statusCode = 404;
                    else if (error.code === "EACCES")
                        res.statusCode = 403;
                    else
                        res.statusCode = 500;
                    res.end();
                    log.info(req, res);
                    if (error)
                        log.error(error);
                }
            });
        }
    }

    //-----------------------------------------------------------------------------
    function handleUploadRequest(req, res) {
        var busboy, done = false, files = [], cookie = getCookie(req.headers.cookie);

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

        busboy = new Busboy({ headers: req.headers, fileHwm: 1024 * 1024, limits: {fieldNameSize: 255, fieldSize: 10 * 1024 * 1024}});

        busboy.on("file", function (fieldname, file, filename) {
            var dstRelative = filename ? decodeURIComponent(filename) : fieldname,
                dst = path.join(config.filesDir, req.query.to, dstRelative),
                tmp = path.join(config.incomingDir, crypto.createHash("md5").update(String(dst)).digest("hex"));

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
            done = true;
            var names = Object.keys(files);
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
            for (var i = 0, l = results.length; i < l; i++)
                dirs[root][path.basename(tmpDirs[i])].size = results[i];
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
        var zipPath = addFilePath(decodeURIComponent(req.url.substring(4))), archive, paths, next;
        fs.stat(zipPath, function (err, stats) {
            if (err) {
                log.error(err);
            } else if (stats.isDirectory()) {
                res.statusCode = 200;
                res.setHeader("Content-Type", mime.lookup(type));

                if (req.headers["user-agent"] && req.headers["user-agent"].indexOf("MSIE") > 0)
                    res.setHeader("Content-Disposition", 'attachment; filename="' + encodeURIComponent(path.basename(zipPath)) + '.zip"');
                else
                    res.setHeader("Content-Disposition", 'attachment; filename="' + path.basename(zipPath) + '.zip"');

                res.setHeader("Transfer-Encoding", "chunked");
                log.info(req, res, "Creating zip of /", req.url.substring(4));

                archive = archiver(type, {zlib: { level: config.zipLevel }});
                archive.on("error", function (error) { log.error(error); });

                next = function (currentPath) {
                    if (currentPath[currentPath.length - 1] !== "/")
                        archive.file(currentPath, {name: removeFilePath(currentPath)});
                    else
                        archive.append("", { name: removeFilePath(currentPath) });
                };

                archive.on("entry", function () {
                    if (paths.length)
                        next(paths.pop());
                    else
                        archive.finalize();
                });
                archive.pipe(res);

                utils.walkDirectory(zipPath, true, function (error, foundPaths) {
                    if (error) log.error(error);
                    paths = foundPaths.filter(function (s) { return s !== ""; });
                    next(paths.pop());
                });
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
        config = cfg(path.join(process.cwd(), "config.json"));

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
        } catch (error) {
            if (error.code === "ENOENT" || /^\s*$/.test(dbString)) {
                db = {users: {}, sessions: {}, shortlinks: {}};

                // Recreate DB file in case it doesn't exist / is empty
                log.simple("Creating ", chalk.magenta(path.basename(config.db)), "...");
                doWrite = true;
            } else {
                log.error("Error reading ", config.db, "\n", util.inspect(error));
                process.exit(1);
            }
        }

        // Write a new DB if necessary
        if (doWrite) writeDB();
    }

    //-----------------------------------------------------------------------------
    // Add a user to the database
    function addOrUpdateUser(user, password, privileged) {
        var salt = crypto.randomBytes(4).toString("hex"), isNew = !db.users[user];
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

    var cookieName = "s", needToSave = false;

    function getCookie(cookie) {
        var session = "", cookies;
        if (cookie) {
            cookies = cookie.split("; ");
            cookies.forEach(function (c) {
                if (new RegExp("^" + cookieName + ".*").test(c)) {
                    session = c.substring(cookieName.length + 1);
                }
            });
            for (var savedsession in db.sessions) {
                if (db.sessions.hasOwnProperty(savedsession)) {
                    if (savedsession === session) {
                        db.sessions[session].lastSeen = Date.now();
                        needToSave = true;
                        return session;
                    }
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
        var sessionID = crypto.randomBytes(32).toString("base64"), priv, dateString;

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
    setInterval(cleanUpSessions, 3600000);
    function cleanUpSessions() {
        for (var session in db.sessions) {
            if (db.sessions.hasOwnProperty(session)) {
                if (!db.sessions[session].lastSeen || (Date.now() - db.sessions[session].lastSeen >= 2678400000)) {
                    delete db.sessions[session];
                    needToSave = true;
                }
            }
        }
    }

    //-----------------------------------------------------------------------------
    // Watch the CSS files for debugging
    function watchCSS() {
        resources.css.forEach(function (file) {
            fs.watch(path.join(__dirname, file), utils.debounce(updateCSS), config.readInterval);
        });
    }

    //-----------------------------------------------------------------------------
    // Update the debug CSS cache and send it to the client(s)
    function updateCSS() {
        var temp = "";
        resources.css.forEach(function (file) {
            temp += fs.readFileSync(file).toString("utf8") + "\n";
        });
        cssCache = ap("last 2 versions").process(temp).css;
        for (var cookie in clients) {
            if (clients.hasOwnProperty(cookie)) {
                var data = JSON.stringify({
                    "type"  : "UPDATE_CSS",
                    "css"   : cssCache
                });
                if (clients[cookie].ws && clients[cookie].ws.readyState === 1) {
                    clients[cookie].ws.send(data, function (error) {
                        if (error) log.error(error);
                    });
                }
            }
        }
    }

    //-----------------------------------------------------------------------------
    // Various helper functions
    function writeDB()         { fs.writeFileSync(config.db, JSON.stringify(db, null, 4)); }

    function getResPath(name)  { return path.join(config.resDir, name); }

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
        log.simple("Received " + signal + " - Shutting down...");
        var count = 0;
        for (var client in clients) {
            if (clients.hasOwnProperty(client)) {
                if (!clients[client] || !clients[client].ws) continue;
                if (clients[client].ws.readyState < 2) {
                    count++;
                    clients[client].ws.close(1001);
                }
            }
        }

        if (count > 0) log.simple("Closed " + count + " active WebSocket" + (count > 1 ? "s" : ""));

        cleanupTemp(false, function () {
            cleanUpSessions();
            writeDB();
            process.exit(0);
        });
    }
})();
