"use strict";

var pkg        = require("./../package.json");
var resources  = require("./lib/resources.js");
var cfg        = require("./lib/cfg.js");
var cookies    = require("./lib/cookies.js");
var db         = require("./lib/db.js");
var filetree   = require("./lib/filetree.js");
var log        = require("./lib/log.js");
var manifest   = require("./lib/manifest.js");
var mime       = require("./lib/mime.js");
var paths      = require("./lib/paths.js").get();
var utils      = require("./lib/utils.js");

var _          = require("lodash");
var async      = require("async");
var Busboy     = require("busboy");
var chalk      = require("chalk");
var engine     = require("detect-engine");
var fs         = require("graceful-fs");
var readdirp   = require("readdirp");
var schedule   = require("node-schedule");
var Wss        = require("websocket").server;
var yazl       = require("yazl");

var crypto     = require("crypto");
var path       = require("path");
var qs         = require("querystring");

var cache           = {};
var clients         = {};
var clientsPerDir   = {};
var config          = null;
var firstRun        = null;
var hasServer       = null;
var ready           = false;

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
    function (cb) { cfg.init(options, function (err, conf) { config = conf; cb(err); }); },
    function (cb) { db.init(cb); },
    function (cb) {
      log.init({logLevel: config.logLevel, timestamps: config.timestamps});
      firstRun = Object.keys(db.get("users")).length === 0;
      cb();
    },
    function (cb) {
      log.simple("Loading " + (!config.debug ? "and minifying " : "") + "resources ...");
      resources.init(!config.debug, function (err, c) { cache = c; cb(err); });
    },
    function (cb) { cleanupTemp(); cb(); },
    function (cb) { cleanupLinks(cb); },
    function (cb) { if (config.debug) debug(); cb(); },
    function (cb) {
      if (config.demo || process.env.DROPPY_MODE === "demo") {
        process.title = "droppy-demo";
        config.demo = true;
        config.public = true;
        config.listeners = [{
          host: "0.0.0.0",
          port: process.env.PORT || 5000,
          protocol: "http"
        }];
        require("./lib/demo.js").init(cb);
      } else cb();
    },
    function (cb) { if (isStandalone) { startListeners(cb); } else cb(); },
    function (cb) { filetree.updateDir(null, cb); },
  ], function (err) {
    if (err) return callback(err);
    ready = true;
    log.simple(chalk.green("Ready for requests!"));
    callback();
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
    while (req.url.indexOf("\u0000") !== -1) req.url = req.url.replace(/\%00/g, ""); // Strip all null-bytes from the url
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
      if (typeof listener[prop] === "undefined" && !config.demo)
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
      if (err) return cb(err);
      server.on("listening", function () {
        setupSocket(server);
        if (tlsData) {
          require("pem").readCertificateInfo(tlsData.cert, function (err, info) {
            if (err) return cb(err);
            var cn = (tlsData.selfsigned || !info.commonName) ? info.commonName : "self-signed";
            log.simple("Listening on ",
                   socket.opts.proto.toLowerCase() + "://" +
                   chalk.cyan(server.address().address),
                   ":", chalk.blue(server.address().port) +
                   " (CN: " + chalk.yellow(cn) + ")");
            cb();
          });
        } else {
          log.simple("Listening on ",
                 socket.opts.proto.toLowerCase() + "://" +
                 chalk.cyan(server.address().address),
                 ":", chalk.blue(server.address().port));
          cb();
        }
      });

      server.on("error", function (err) {
        if (err.code === "EADDRINUSE")
          log.simple(chalk.red("Failed to bind to "), chalk.cyan(socket.host), chalk.red(":"),
                chalk.blue(socket.port), chalk.red(". Address already in use"));
        else if (err.code === "EACCES")
          log.simple(chalk.red("Failed to bind to "), chalk.cyan(socket.host), chalk.red(":"),
                chalk.blue(socket.port), chalk.red(". Need permission to bind to ports < 1024"));
        else
          log.error(err);
        return cb(err);
      });
      server.listen(socket.port, socket.host);
    });
  }, callback);
}

//-----------------------------------------------------------------------------
// Create socket listener
function createListener(handler, opts, callback) {
  var server, http = require("http");
  if (opts.proto === "http") {
    callback(null, http.createServer(handler));
  } else {
    utils.tlsInit(opts, function (err, tlsData) {
      if (err) return callback(err);

      var https = require("https");
      var tlsOptions = {
        key              : tlsData.key,
        cert             : tlsData.cert,
        ca               : tlsData.ca ? tlsData.ca : undefined,
        dhparam          : tlsData.dhparam ? tlsData.dhparam : undefined,
        honorCipherOrder : true,
      };

      // Slightly more secure options for 0.10.x
      if (engine === "node" && /^v0\.10/.test(process.version)) {
        tlsOptions.ciphers = "ECDHE-RSA-AES256-SHA:AES256-SHA:RC4-SHA:RC4:HIGH:!MD5:!aNULL:!EDH:!AESGCM";
      } else {
        tlsOptions.ciphers = "ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:" +
                   "ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-SHA256:" +
                   "DHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:ECDHE-RSA-AES256-SHA256:" +
                   "DHE-RSA-AES256-SHA256:HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA";
      }

      // Disable insecure client renegotiation
      https.CLIENT_RENEG_LIMIT = 0;

      server = https.createServer(tlsOptions);
      server.httpAllowHalfOpen = false;
      server.timeout = 120000;

      server.on("request", function (req, res) {
        if (opts.hsts && opts.hsts > 0)
          res.setHeader("Strict-Transport-Security", "max-age=" + opts.hsts);
        handler(req, res);
      });

      server.on("clientError", function (err, conn) {
        if (err) log.error(err);
        conn.destroy();
      });

      // TLS session resumption
      var sessions = {};
      server.on("newSession", function (id, data) {
        sessions[id] = data;
      });
      server.on("resumeSession", function (id, cb) {
        cb(null, id in sessions ? sessions[id] : null);
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
    autoAcceptConnections: false,
    maxReceivedFrameSize: Infinity,
    maxReceivedMessageSize: Infinity
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
      clients[sid] = {views: [], cookie: cookie, ws: ws};
    }

    ws.on("message", function (message) {
      var msg = JSON.parse(message.utf8Data),
        vId = msg.vId;

      if (msg.type !== "SAVE_FILE") log.debug(ws, null, chalk.magenta("RECV "), message.utf8Data);

      switch (msg.type) {
      case "REQUEST_SETTINGS":
        sendObj(sid, {type: "SETTINGS", vId: vId, settings: {
          debug         : config.debug,
          demo          : config.demo,
          public        : config.public,
          maxFileSize   : config.maxFileSize,
          themes        : Object.keys(cache.themes).join("|"),
          modes         : Object.keys(cache.modes).join("|"),
          caseSensitive : process.platform !== "win32"
        }});
        break;
      case "REQUEST_UPDATE":
        if (!utils.isPathSane(msg.data)) return log.info(ws, null, "Invalid update request: " + msg.data);
        if (!clients[sid]) clients[sid] = {views: [], ws: ws}; // This can happen when the server restarts
        fs.stat(utils.addFilesPath(msg.data), function (err, stats) {
          var clientDir, clientFile;
          if (err) { // Send client back to root when the requested path doesn't exist
            clientDir = "/";
            clientFile = null;
            log.error(err);
            log.info(ws, null, "Non-existing update request, sending client to / : " + msg.data);
          } else if (stats.isFile()) {
            clientDir = path.dirname(msg.data);
            clientFile = path.basename(msg.data);
            sendObj(sid, {type: "UPDATE_BE_FILE", file: clientFile, folder: clientDir, isFile: true, vId: vId});
          } else {
            clientDir = msg.data;
            clientFile = null;

          }
          clients[sid].views[vId] = {file: clientFile, directory: clientDir};
          if (!clientFile) {
            updateClientLocation(clientDir, sid, vId);
            sendFiles(sid, vId);
          }
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
        filetree.del(msg.data);
        break;
      case "SAVE_FILE":
        log.info(ws, null, "Saving: " + msg.data.to);
        if (!utils.isPathSane(msg.data.to)) return log.info(ws, null, "Invalid save request: " + msg.data);
        filetree.save(msg.data.to, msg.data.value, function (err) {
          if (err)
            sendObj(sid, {type: "ERROR", vId: vId, text: "Error saving " + msg.data.to + ": " + err});
          else
            sendObj(sid, {type: "SAVE_STATUS", vId: vId, status : err ? 1 : 0});
        });
        break;
      case "CLIPBOARD":
        log.info(ws, null, "Clipboard " + msg.data.type + ": " + msg.data.src + " -> " + msg.data.dst);
        if (!utils.isPathSane(msg.data.src)) return log.info(ws, null, "Invalid clipboard src: " + msg.data.src);
        if (!utils.isPathSane(msg.data.dst)) return log.info(ws, null, "Invalid clipboard dst: " + msg.data.dst);
        if (new RegExp("^" + msg.data.src + "/").test(msg.data.dst))
          return sendObj(sid, {type: "ERROR", vId: vId, text: "Can't copy directory into itself"});

        fs.lstat(utils.addFilesPath(msg.data.dst), function (err, stats) {
          if (!err && stats || msg.data.src === msg.data.dst) {
            utils.getNewPath(utils.addFilesPath(msg.data.dst), function (newDst) {
              filetree.clipboard(msg.data.src, utils.removeFilesPath(newDst), msg.data.type);
            });
          } else {
            filetree.clipboard(msg.data.src, msg.data.dst, msg.data.type);
          }
        });
        break;
      case "CREATE_FOLDER":
        if (!utils.isPathSane(msg.data)) return log.info(ws, null, "Invalid directory creation request: " + msg.data);
        filetree.mkdir(msg.data);
        break;
      case "CREATE_FILE":
        if (!utils.isPathSane(msg.data)) return log.info(ws, null, "Invalid file creation request: " + msg.data);
        filetree.mk(msg.data);
        break;
      case "RENAME":
        // Disallow whitespace-only and empty strings in renames
        if (!utils.isPathSane(msg.data.dst) || /^\s*$/.test(msg.data.dst) || msg.data.dst === "" || msg.data.src === msg.data.dst) {
          log.info(ws, null, "Invalid rename request: " + msg.data.src + "-> " + msg.data.dst);
          sendObj(sid, {type: "ERROR", text: "Invalid rename request"});
          return;
        }
        filetree.move(msg.data.src, msg.data.dst);
        break;
      case "GET_USERS":
        if (db.get("sessions")[cookie] && db.get("sessions")[cookie].privileged) {
          sendUsers(sid);
        } else { // Unauthorized
          sendObj(sid, {type: "USER_LIST", users: {}});
        }
        break;
      case "UPDATE_USER":
        var name = msg.data.name, pass = msg.data.pass;
        if (!db.get("sessions")[cookie].privileged) return;
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
        if (db.get("sessions")[cookie].privileged) sendUsers(sid);
        break;
      case "CREATE_FILES":
        async.each(msg.data.files, function (file, cb) {
          if (!utils.isPathSane(file)) return cb(new Error("Invalid empty file creation request: " + file));
          filetree.mkdir(utils.addFilesPath(path.dirname(file)), function () {
            filetree.mk(utils.addFilesPath(file), cb);
          });
        }, function (err) {
          if (err) log.error(ws, null, err);
          if (msg.data.isUpload) sendObj(sid, {type: "UPLOAD_DONE", vId: vId});
        });
        break;
      case "CREATE_FOLDERS":
        async.each(msg.data.folders, function (folder, cb) {
          if (!utils.isPathSane(folder)) return cb(new Error("Invalid empty file creation request: " + folder));
          filetree.mkdir(utils.addFilesPath(folder), cb);
        }, function (err) {
          if (err) log.error(ws, null, err);
          if (msg.data.isUpload) sendObj(sid, {type: "UPLOAD_DONE", vId: vId});
        });
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
function sendFiles(sid, vId) {
  if (!clients[sid]  || !clients[sid].views[vId] || !clients[sid].ws || !clients[sid].ws.socket) return;
  var dir = clients[sid].views[vId].directory;
  sendObj(sid, {
    type   : "UPDATE_DIRECTORY",
    vId    : vId,
    folder : dir,
    data   : filetree.getDirContents(dir)
  });
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
function handleGET(req, res) {
  var URI = decodeURIComponent(req.url);

  if (!utils.isPathSane(URI)) return log.info(req, res, "Invalid GET: " + req.url);

  if (config.public && !cookies.get(req.headers.cookie))
    cookies.free(req, res);

  if (/^\/\?!\//.test(URI)) {
    handleResourceRequest(req, res, /\?!\/([\s\S]+)$/.exec(URI)[1]);
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
    var cookie = cookies.get(req.headers.cookie);
    if (cookie || config.public) {
      handleResourceRequest(req, res, "main.html");
      if (config.public) return;
      var sessions = db.get("sessions");
      sessions[cookie].lastSeen = Date.now();
      db.set("sessions", sessions);
    } else if (firstRun) {
      handleResourceRequest(req, res, "firstrun.html");
    } else {
      handleResourceRequest(req, res, "auth.html");
    }
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

      if (/\.html$/.test(resourceName)) {
        if (!config.debug)
          headers["X-Frame-Options"] = "DENY";
        if (req.headers["user-agent"] && req.headers["user-agent"].indexOf("MSIE") > 0)
          headers["X-UA-Compatible"] = "IE=Edge, chrome=1";
      }

      if (/.+\.(png|ico|svg|woff)$/.test(resourceName)) {
        headers["Cache-Control"] = "public, max-age=604800";
        headers["Expires"] = new Date(Date.now() + 604800000).toUTCString();
      } else {
        if (resource.etag && !/\.html$/.test(resourceName)) {
          headers["ETag"] = '"' + resource.etag + '"';
        }
        headers["Cache-Control"] = "private, max-age=0";
        headers["Expires"] = "0";
      }

      // Content-Type
      if (/.+\.(js|css|html|svg)$/.test(resourceName))
        headers["Content-Type"] = resource.mime + "; charset=utf-8";
      else
        headers["Content-Type"] = resource.mime;

      // Encoding, Length
      var acceptEncoding = req.headers["accept-encoding"] || "";
      if (/\bgzip\b/.test(acceptEncoding) && resource.gzip && !config.debug) {
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
    res.writeHead(301, {Location: "/"});
    res.end();
    log.info(req, res);
    return;
  }

  // 304 response when Etag matches
  if (!download && (req.headers["if-none-match"] || "") === '"' + cache.etags[filepath] + '"') {
    res.writeHead(304, {
      "Content-Type": mime(filepath)
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
        var headers = {"Content-Type": mime(filepath), "Content-Length": stats.size}, status = 200;
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
            headers["Content-Length"] = end - start + 1;
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
  var busboy, opts, dstDir,
    done     = false,
    files    = {},
    cookie   = cookies.get(req.headers.cookie);

  req.query = qs.parse(req.url.substring("/upload?".length));

  if (!req.query || !req.query.to) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain");
    res.end();
    log.info(req, res, "Invalid upload request");
    return;
  }

  if (!cookie && !config.public) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "text/plain");
    res.end();
    log.info(req, res, "Unauthorized upload request");
    log.info(req, res);
    return;
  }

  Object.keys(clients).some(function (sid) {
    if (clients[sid].cookie === cookie) {
      req.sid = sid;
      return true;
    }
  });

  dstDir = decodeURIComponent(req.query.to) || clients[req.sid].views[req.query.vId].directory;
  log.info(req, res, "Upload started");
  opts = {headers: req.headers, fileHwm: 1024 * 1024, limits: {fieldNameSize: 255, fieldSize: 10 * 1024 * 1024}};

  if (config.maxFileSize > 0) opts.limits.fileSize = config.maxFileSize;
  busboy = new Busboy(opts);
  busboy.on("error", log.error);
  busboy.on("file", function (fieldname, file, filename) {
    var dstRelative = filename ? decodeURIComponent(filename) : fieldname,
      dst         = path.join(paths.files, dstDir, dstRelative),
      tmp         = path.join(paths.temp, crypto.createHash("md5").update(String(dst)).digest("hex")),
      writeStream = fs.createWriteStream(tmp, {mode: "644"});

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
    var names = Object.keys(files), total = names.length, added = 0;
    log.info(req, res, "Received " + names.length + " files");
    done = true;

    var toMove = [];

    while (names.length > 0) {
      (function (name) {
        fs.stat(files[name].dst, function (error) {
          if (error) { // File doesn't exist
            fs.stat(path.dirname(files[name].dst), function (error) {
              if (error) { // Dir doesn't exist
                utils.mkdir(path.dirname(files[name].dst), function () {
                  toMove.push([files[name].src, files[name].dst]);
                  if (++added === total) run();
                });
              } else {
                toMove.push([files[name].src, files[name].dst]);
                if (++added === total) run();
              }
            });
          } else {
            if (req.query.r === "1") { // Rename option from the client
              (function (src, dst) {
                utils.getNewPath(dst, function (newDst) {
                  toMove.push([src, newDst]);
                  if (++added === total) run();
                });
              })(files[name].src, files[name].dst);

            } else {
              toMove.push([files[name].src, files[name].dst]);
              if (++added === total) run();
            }
          }
        });
      })(names.pop());
    }

    closeConnection();

    function run() {
      async.eachLimit(toMove, 64, function (pair, cb) {
        filetree.moveTemps(pair[0], pair[1], function (err) {
          if (err) log.error(err);
          cb(null);
        });
      }, filetree.updateDir.bind(null, dstDir));
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
    sendObj(req.sid, {type: "UPLOAD_DONE", vId: Number(req.query.vId)});
  }
}

filetree.on("updateall", function () {
  Object.keys(clientsPerDir).forEach(function (dir) {
    clientsPerDir[dir].forEach(function (client) {
      client.update();
    });
  });
});

filetree.on("update", function (dir) {
  if (clientsPerDir[dir]) {
    clientsPerDir[dir].forEach(function (client) {
      client.update();
    });
  }

  var parent = dir;
  while (true) {
    parent = path.dirname(parent);
    if (parent === dir) return;
    if (clientsPerDir[parent]) {
      clientsPerDir[parent].forEach(function (client) {
        client.update();
      });
    }
    if (parent === "/") break;
  }
});

function updateClientLocation(dir, sid, vId) {
  // remove current client from any previous dirs
  removeClientPerDir(sid, vId);

  // and add client back
  if (!clientsPerDir[dir]) clientsPerDir[dir] = [];
  clientsPerDir[dir].push({
    sid    : sid,
    vId    : vId,
    update : _.throttle(function () {
      sendFiles(this.sid, this.vId);
    }, config.updateInterval, {leading: true, trailing: true})
  });
}

function removeClientPerDir(sid, vId) {
  Object.keys(clientsPerDir).forEach(function (dir) {
    var removeAt = [];
    clientsPerDir[dir].forEach(function (client, i) {
      if (client.sid === sid && (typeof vId === "number" ? client.vId === vId : true)) {
        removeAt.push(i);
      }
    });
    removeAt.reverse().forEach(function (pos) {
      clientsPerDir[dir].splice(pos, 1);
    });

    // purge dirs with no clients
    if (!clientsPerDir[dir].length) delete clientsPerDir[dir];
  });
}

function debug() {
  require("chokidar").watch(paths.client, {
    alwaysStat    : true,
    ignoreInitial : true
  }).on("change", function (file) {
    setTimeout(function () { // prevent EBUSY on win32
      if (/\.css$/.test(file)) {
        cache.res["style.css"] = resources.compileCSS();
        sendObjAll({type: "RELOAD", css: cache.res["style.css"].data.toString("utf8")});
      } else if (/\.js$/.test(file) || /\.handlebars$/.test(file)) {
        cache.res["client.js"] = resources.compileJS();
        sendObjAll({type: "RELOAD"});
      } else if (/\.html$/.test(file)) {
        resources.compileHTML(cache.res);
        sendObjAll({type: "RELOAD"});
      }
    }, 100);
  });
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
// Create a zip file from a directory and stream it to a client
function streamArchive(req, res, zipPath) {
  fs.stat(zipPath, function (err, stats) {
    if (err) {
      log.error(err);
    } else if (stats.isDirectory()) {
      var zip = new yazl.ZipFile();
      var basePath = path.dirname(utils.removeFilesPath(zipPath));
      log.info(req, res);
      log.info("Streaming zip of ", chalk.blue(utils.removeFilesPath(zipPath)));
      res.writeHead(200, {
        "Content-Type"       : mime("zip"),
        "Content-Disposition": utils.getDispo(zipPath + ".zip"),
        "Transfer-Encoding"  : "chunked"
      });
      readdirp({root: zipPath, entryType: "both"})
        .on("warn", log.info).on("error", log.error).on("data", function (file) {
          var stats = file.stat;
          var relPath = utils.relativeZipPath(file.fullPath, basePath);
          if (stats.isDirectory())
            zip.addEmptyDirectory(relPath, {mtime: stats.mtime, mode: stats.mode});
          else
            zip.addFile(file.fullPath, relPath, {mtime: stats.mtime, mode: stats.mode});
        })
        .on("end", function () {
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
schedule.scheduleJob("* 0 * * *", function hourly() {
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
});

//-----------------------------------------------------------------------------
// Process startup
function setupProcess(standalone) {
  process.on("exit", cleanupTemp);

  if (standalone) {
    process.on("SIGINT",  endProcess.bind(null, "SIGINT"));
    process.on("SIGQUIT", endProcess.bind(null, "SIGQUIT"));
    process.on("SIGTERM", endProcess.bind(null, "SIGTERM"));
    process.on("uncaughtException", function (error) {
      log.error("=============== Uncaught exception! ===============");
      log.error(error);
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
  if (count > 0) log.simple("Closed " + count + " WebSocket" + (count > 1 ? "s" : ""));
  try { fs.unlinkSync(paths.pid); } catch(err) {}
  process.exit(0);
}
