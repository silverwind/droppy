"use strict";

var crypto = require("crypto");
var path   = require("path");
var qs     = require("querystring");

var _        = require("lodash");
var async    = require("async");
var Busboy   = require("busboy");
var chalk    = require("chalk");
var engine   = require("detect-engine");
var fs       = require("graceful-fs");
var mime     = require("mime-types").lookup;
var readdirp = require("readdirp");
var schedule = require("node-schedule");
var Wss      = require("ws").Server;
var yazl     = require("yazl");

var pkg       = require("./../package.json");
var resources = require("./resources.js");
var cfg       = require("./cfg.js");
var csrf      = require("./csrf.js");
var cookies   = require("./cookies.js");
var db        = require("./db.js");
var filetree  = require("./filetree.js");
var log       = require("./log.js");
var manifest  = require("./manifest.js");
var paths     = require("./paths.js").get();
var utils     = require("./utils.js");

var cache         = {};
var clients       = {};
var clientsPerDir = {};
var config        = null;
var firstRun      = null;
var ready         = false;

var droppy = function droppy(options, isStandalone, callback) {
  if (isStandalone) {
    log.logo();
    log.plain(" ", chalk.blue(pkg.name), " ", chalk.green(pkg.version), " running on ",
      chalk.blue(engine), " ", chalk.green(process.version.substring(1)), "\n ",
      chalk.blue("config"), " at ", chalk.green(paths.config), "\n ",
      chalk.blue("files"), " at ", chalk.green(paths.files), "\n"
    );
  }
  setupProcess(isStandalone);

  async.series([
    function(cb) { utils.mkdir([paths.files, paths.temp, paths.config], cb); },
    function(cb) { if (isStandalone) fs.writeFile(paths.pid, process.pid, cb); else cb(); },
    function(cb) { cfg.init(options, function(err, conf) { config = conf; cb(err); }); },
    function(cb) { db.init(cb); },
    function(cb) {
      log.init({logLevel: config.logLevel, timestamps: config.timestamps});
      firstRun = Object.keys(db.get("users")).length === 0;
      // clean up old sessions if no users exist
      if (firstRun) db.set("sessions", {});
      cb();
    },
    function(cb) {
      log.info("Loading resources ...");
      resources.load(config.dev, function(err, c) {
        log.info("Loading resources done");
        cache = c; cb(err);
      });
    },
    function(cb) { cleanupTemp(); cb(); },
    function(cb) { cleanupLinks(cb); },
    function(cb) { if (config.dev) debug(); cb(); },
    function(cb) {
      if (config.demo || process.env.DROPPY_MODE === "demo") {
        process.title = "droppy-demo";
        config.demo = true;
        config.public = true;
        require("./demo.js").init(cb);
      } else cb();
    },
    function(cb) { if (isStandalone) { startListeners(cb); } else cb(); },
    function(cb) {
      filetree.updateDir(null, function() {
        filetree.init(config.pollingInterval);
        cb();
      });
    },
  ], function(err) {
    if (err) return callback(err);
    ready = true;
    log.info(chalk.green("Ready for requests!"));
    callback();
  });
};

function onRequest(req, res) {
  req.time = Date.now();
  if (ready) {
    if (req.method === "GET") {
      handleGET(req, res);
    } else if (req.method === "POST") {
      handlePOST(req, res);
    } else {
      res.statusCode = 405;
      res.end();
    }
  } else {
    res.statusCode = 503;
    res.end("<!DOCTYPE html><html><head><title>droppy - starting up</title></head><body><h2>Just a second! droppy is starting up ...<h2><script>window.setTimeout(function(){window.location.reload()},2000)</script></body></html>");
  }
}

droppy._onRequest = onRequest;
exports = module.exports = droppy;

function startListeners(callback) {
  var listeners = config.listeners, sockets = [];

  if (!Array.isArray(listeners))
    return callback(new Error("Config Error: 'listeners' must be an array"));

  listeners.forEach(function(listener, i) {
    ["host", "port", "protocol"].forEach(function(prop) {
      if (prop === "protocol" && listener[prop] === undefined)
        listener[prop] = "http";

      if (listener[prop] === undefined && !config.demo)
        return callback(new Error("Config Error: listener " + prop + " undefined"));
    });

    (Array.isArray(listener.host) ? listener.host : [listener.host]).forEach(function(host) {
      (Array.isArray(listener.port) ? listener.port : [listener.port]).forEach(function(port) {
        sockets.push({
          host  : host,
          port  : port,
          opts  : {
            proto   : listener.protocol,
            hsts    : listener.hsts,
            key     : listener.key,
            cert    : listener.cert,
            ca      : listener.ca,
            dhparam : listener.dhparam,
            index   : i,
          }
        });
      });
    });
  });

  var listeningSockets = 0;

  async.each(sockets, function(socket, cb) {
    createListener(onRequest, socket.opts, function(err, server) {
      if (err) return cb(err);
      server.on("listening", function() {
        listeningSockets++;
        server.removeAllListeners("error");
        setupSocket(server);
        var proto = socket.opts.proto.toLowerCase();
        log.info("Listening on ",
          chalk.blue(proto + "://") +
          log.formatUrl(server.address().address, server.address().port, proto)
        );
        cb();
      }).on("error", function(err) {
        if (err.code === "EADDRINUSE") {
          log.info(chalk.red("Failed to bind to "), chalk.cyan(socket.host), chalk.red(":"),
                chalk.blue(socket.port), chalk.red(". Address already in use."));
        } else if (err.code === "EACCES") {
          log.info(chalk.red("Failed to bind to "), chalk.cyan(socket.host), chalk.red(":"),
                chalk.blue(socket.port), chalk.red(". Need permission to bind to ports < 1024."));
        } else if (err.code === "EAFNOSUPPORT") {
          log.info(chalk.red("Failed to bind to "), chalk.cyan(socket.host), chalk.red(":"),
                chalk.blue(socket.port), chalk.red(". Protocol unsupported."));
        } else log.error(err);
        return cb(err);
      }).listen(socket.port, socket.host);
    });
  }, function(err) {
    // Don't abort if we have at least one listening socket
    callback(listeningSockets === 0 ? err : null);
  });
}

// Create socket listener
function createListener(handler, opts, callback) {
  var server;
  if (opts.proto === "http") {
    var http = require("http");
    callback(null, http.createServer(handler));
  } else {
    var https = require("https");
    https.CLIENT_RENEG_LIMIT = 0;
    utils.tlsInit(opts, function(err, tlsOptions) {
      if (err) return callback(err);
      server = https.createServer(tlsOptions);

      server.on("request", function(req, res) {
        if (opts.hsts && opts.hsts > 0)
          res.setHeader("Strict-Transport-Security", "max-age=" + opts.hsts);
        handler(req, res);
      });

      server.on("clientError", function(err, conn) {
        if (err) log.error(err);
        conn.destroy();
      });

      // TLS tickets - regenerate keys every hour
      if (server.setTicketKeys) {
        (function rotate() {
          server.setTicketKeys(crypto.randomBytes(48));
          setTimeout(rotate, 60 * 60 * 1000);
        })();
      }

      callback(null, server);
    });
  }
}

// WebSocket functions
function setupSocket(server) {
  var wss = new Wss({
    server: server,
    verifyClient: function(info, cb) {
      if (validateRequest(info.req)) {
        log.info(info.req, null, "WebSocket [", chalk.green("connected"), "] ");
        cb(true);
      } else {
        log.info(info.req, {statusCode: 401}, "Unauthorized WebSocket connection rejected.");
        cb(false, 401, "Unauthorized");
      }
    }
  });
  if (typeof config.keepAlive === "number" && config.keepAlive > 0) {
    Object.keys(wss.clients).forEach(function(client) {
      client.ws.ping();
    });
  }
  wss.on("connection", function(ws) {
    var sid = ws._socket.remoteAddress + " " + ws._socket.remotePort;
    var cookie = cookies.get(ws.upgradeReq.headers.cookie);
    clients[sid] = {views: [], cookie: cookie, ws: ws};

    ws.on("message", function(msg) {
      msg = JSON.parse(msg);

      if (msg.type !== "SAVE_FILE") {
        log.debug(ws, null, chalk.magenta("RECV "), utils.pretty(msg));
      }

      if (!csrf.validate(msg.token)) {
        ws.close(1011);
        return;
      }

      var vId = msg.vId;
      switch (msg.type) {
      case "REQUEST_SETTINGS":
        sendObj(sid, {type: "SETTINGS", vId: vId, settings: {
          version       : pkg.version,
          debug         : config.dev,
          demo          : config.demo,
          public        : config.public,
          engine        : [engine, process.version.substring(1)].join(" "),
          caseSensitive : process.platform !== "win32",
          themes        : Object.keys(cache.themes).join("|"),
          modes         : Object.keys(cache.modes).join("|"),
        }});
        break;
      case "REQUEST_UPDATE":
        if (!utils.isPathSane(msg.data)) return log.info(ws, null, "Invalid update request: " + msg.data);
        if (!clients[sid]) clients[sid] = {views: [], ws: ws}; // This can happen when the server restarts
        fs.stat(utils.addFilesPath(msg.data), function(err, stats) {
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
        if (!utils.isPathSane(msg.data.location)) return log.info(ws, null, "Invalid share link request: " + msg.data);
        var link, links = db.get("links");

        // Check if we already have a link for that file
        var hadLink = Object.keys(links).some(function(link) {
          if (msg.data.location === links[link].location && msg.data.attachement === links[link].attachement) {
            sendObj(sid, {type: "SHARELINK", vId: vId, link: link, attachement: msg.data.attachement});
            return true;
          }
        });
        if (hadLink) break;

        link = utils.getLink(links, config.linkLength);
        log.info(ws, null, "Share link created: " + link + " -> " + msg.data.location);
        sendObj(sid, {type: "SHARELINK", vId: vId, link: link, attachement: msg.data.attachement});
        links[link] = {location: msg.data.location, attachement: msg.data.attachement};
        db.set("links", links);
        break;
      case "DELETE_FILE":
        log.info(ws, null, "Deleting: " + msg.data);
        if (!utils.isPathSane(msg.data)) return log.info(ws, null, "Invalid file deletion request: " + msg.data);
        filetree.del(msg.data);
        break;
      case "SAVE_FILE":
        log.info(ws, null, "Saving: " + msg.data.to);
        if (!utils.isPathSane(msg.data.to)) return log.info(ws, null, "Invalid save request: " + msg.data);
        filetree.save(msg.data.to, msg.data.value, function(err) {
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

        fs.stat(utils.addFilesPath(msg.data.dst), function(err, stats) {
          if (!err && stats || msg.data.src === msg.data.dst) {
            utils.getNewPath(utils.addFilesPath(msg.data.dst), function(newDst) {
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
        if (!db.get("sessions")[cookie] || !db.get("sessions")[cookie].privileged) return;
        if (pass === "") {
          if (!db.get("users")[name]) return;
          if (db.delUser(msg.data.name)) log.info(ws, null, "Deleted user: ", chalk.magenta(name));
          if (Object.keys(db.get("users")).length === 0) {
            firstRun = true;
            db.set("sessions", {});
          }
        } else {
          var isNew = !db.get("users")[name];
          db.addOrUpdateUser(name, pass, msg.data.priv);
          log.info(ws, null, (isNew ? "Added" : "Updated") + " user: ", chalk.magenta(name));
        }
        sendUsers(sid);
        break;
      case "CREATE_FILES":
        async.each(msg.data.files, function(file, cb) {
          if (!utils.isPathSane(file)) return cb(new Error("Invalid file creation request: " + file));
          filetree.mkdir(utils.addFilesPath(path.dirname(file)), function() {
            filetree.mk(utils.addFilesPath(file), cb);
          });
        }, function(err) {
          if (err) log.error(ws, null, err);
        });
        break;
      case "CREATE_FOLDERS":
        async.each(msg.data.folders, function(folder, cb) {
          if (!utils.isPathSane(folder)) return cb(new Error("Invalid folder creation request: " + folder));
          filetree.mkdir(utils.addFilesPath(folder), cb);
        }, function(err) {
          if (err) log.error(ws, null, err);
        });
        break;
      }
    });

    ws.on("close", function(code) {
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
      if (code === 1011)
        log.info(ws, null, "WebSocket [", chalk.red("disconnected"), "] ", "(CSFR prevented or server restarted)");
      else
        log.info(ws, null, "WebSocket [", chalk.red("disconnected"), "] ", reason || "(Code: " + (code || "none") + ")");
    });

    ws.on("error", log.error);
  });
}

// Send a file list update
function sendFiles(sid, vId) {
  if (!clients[sid] || !clients[sid].views[vId] || !clients[sid].ws || !clients[sid].ws._socket) return;
  var dir = clients[sid].views[vId].directory;
  sendObj(sid, {
    type   : "UPDATE_DIRECTORY",
    vId    : vId,
    folder : dir,
    data   : filetree.getDirContents(dir)
  });
}

// Send a list of users on the server
function sendUsers(sid) {
  var userDB   = db.get("users");
  var userlist = {};

  Object.keys(userDB).forEach(function(user) {
    userlist[user] = userDB[user].privileged || false;
  });
  sendObj(sid, {type: "USER_LIST", users: userlist});
}

// Send js object to single client identified by its session cookie
function sendObj(sid, data) {
  if (!clients[sid] || !clients[sid].ws) return;
  send(clients[sid].ws, JSON.stringify(data));
}

// Send js object to all clients
function sendObjAll(data) {
  Object.keys(clients).forEach(function(sid) {
    send(clients[sid].ws, JSON.stringify(data));
  });
}

// Do the actual sending
function send(ws, data) {
  (function queue(ws, data, time) {
    if (time > 1000) return; // in case the socket hasn't opened after 1 second, cancel the sending
    if (ws && ws.readyState === 1) {
      if (config.logLevel === 3) {
        var debugData = JSON.parse(data);
        // Remove some spammy logging
        if (debugData.type === "RELOAD" && debugData.css) debugData.css = {"...": "..."};
        log.debug(ws, null, chalk.green("SEND "), utils.pretty(debugData));
      }
      ws.send(data, function(err) {
        if (err) log.err(err);
      });
    } else {
      setTimeout(queue, 50, ws, data, time + 50);
    }
  })(ws, data, 0);
}

function handleGET(req, res) {
  var URI = decodeURIComponent(req.url);

  if (!utils.isPathSane(URI, true))
    return log.info(req, res, "Invalid GET: " + req.url);

  if (config.public && !cookies.get(req.headers.cookie))
    cookies.free(req, res);

  if (/^\/\?!\//.test(URI)) {
    handleResourceRequest(req, res, /\?!\/([\s\S]+)$/.exec(URI)[1]);
  } else if (/^\/\?\@$/.test(URI)) {
    if (validateRequest(req)) {
      res.writeHead(200, {"Content-Type": "text/plain"});
      res.end(csrf.get(req));
      log.info(req, res);
    }
  } else if (/^\/\?[~\$]\//.test(URI)) {
    handleFileRequest(req, res, true);
  } else if (/^\/\?\?\//.test(URI)) {
    handleTypeRequest(req, res);
  } else if (/^\/\?_\//.test(URI)) {
    handleFileRequest(req, res, false);
  } else if (/^\/\?~~\//.test(URI)) {
    streamArchive(req, res, utils.addFilesPath(URI.substring(4)), true);
  } else if (/^\/favicon.ico$/.test(URI)) {
    handleResourceRequest(req, res, "favicon.ico");
  } else {
    if (validateRequest(req)) {
      handleResourceRequest(req, res, "main.html");
      if (config.public) return;
      var sessions = db.get("sessions");
      sessions[cookies.get(req.headers.cookie)].lastSeen = Date.now();
      db.set("sessions", sessions);
    } else if (firstRun) {
      handleResourceRequest(req, res, "firstrun.html");
    } else {
      handleResourceRequest(req, res, "auth.html");
    }
  }
}

var rateLimited = [];
function handlePOST(req, res) {
  var URI = decodeURIComponent(req.url), postData = {};

  if (!utils.isPathSane(URI, true))
    return log.info(req, res, "Invalid POST: " + req.url);

  if (/\/upload/.test(URI)) {
    if (!validateRequest(req)) {
      res.statusCode = 401;
      res.end();
      log.info(req, res);
    }
    handleUploadRequest(req, res);
  } else if (/\/login/.test(URI)) {
    // Rate-limit login attempts to one attempte every 2 seconds
    if (rateLimited.indexOf(req.socket.remoteAddress) !== -1) {
      res.statusCode = 429;
      res.end();
      return;
    }
    rateLimited.push(req.socket.remoteAddress);
    setTimeout(function() {
      rateLimited.pop(req.socket.remoteAddress);
    }, 2000);

    req.pipe(new Busboy({headers: req.headers}).on("field", function(fieldname, val) {
      postData[fieldname] = val;
    }).on("finish", function() {
      if (db.authUser(postData.username, postData.password)) {
        cookies.create(req, res, postData);
        endReq(res, true);
        log.info(req, res, "User ", "'", postData.username, "'", chalk.green(" authenticated"));
      } else {
        endReq(res, false);
        log.info(req, res, "User ", "'", postData.username, "'", chalk.red(" unauthorized"));
      }
    }));
  } else if (/\/adduser/.test(URI) && firstRun) {
    req.pipe(new Busboy({headers: req.headers}).on("field", function(fieldname, val) {
      postData[fieldname] = val;
    }).on("finish", function() {
      if (postData.username !== "" && postData.password !== "") {
        db.addOrUpdateUser(postData.username, postData.password, true);
        cookies.create(req, res, postData);
        firstRun = false;
        endReq(res, true);
        log.info(req, res, "User ", "'", postData.username, "'", chalk.green("' added"));
      } else {
        endReq(res, false);
        log.info(req, res, "Invalid user creation request for user ", "'", postData.username, "'");
      }
    }));
  } else {
    res.statusCode = 404;
    res.end();
    log.info(req, res);
  }

  function endReq(res, success) {
    res.statusCode = success ? 200 : 401;
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Length", 0);
    res.end();
  }
}

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
    if ((req.headers["if-none-match"] || "") === resource.etag) {
      res.statusCode = 304;
      res.end();
    } else {
      var headers = {}, status = 200;

      if (/\.html$/.test(resourceName)) {
        headers["Content-Security-Policy"] = "script-src 'self' 'unsafe-eval' blob: data:; child-src 'self' blob: data:; object-src 'self'; media-src 'self' blob: data:";
        headers["X-Frame-Options"] = "DENY";
        if (req.headers["user-agent"] && req.headers["user-agent"].indexOf("MSIE") > 0)
          headers["X-UA-Compatible"] = "IE=Edge, chrome=1";
      }

      if (/.+\.(ico|svg|woff)$/.test(resourceName)) {
        headers["Cache-Control"] = "public, max-age=604800";
        headers["Expires"] = new Date(Date.now() + 604800000).toUTCString();
      } else {
        if (resource.etag && !/\.html$/.test(resourceName)) {
          headers["ETag"] = resource.etag;
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
      if (/\bgzip\b/.test(acceptEncoding) && resource.gzip) {
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

function handleFileRequest(req, res, download) {
  var URI = decodeURIComponent(req.url), shareLink, filepath;

  // Check for a shareLink
  filepath = /\?([\$~_])\/([\s\S]+)$/.exec(URI);
  if (filepath.length && filepath[1] === "$") {
    var link = db.get("links")[filepath[2]];
    shareLink = true;
    filepath = utils.addFilesPath(link.location);
    download = link.attachement;
  } else if (filepath[1] === "~" || filepath[1] === "_") {
    filepath = utils.addFilesPath("/" + filepath[2]);
  }

  // Validate the cookie for the remaining requests
  if (!validateRequest(req) && !shareLink) {
    res.writeHead(301, {Location: "/"});
    res.end();
    log.info(req, res);
    return;
  }

  fs.stat(filepath, function(error, stats) {
    if (!error && stats) {
      if (stats.isDirectory() && shareLink) {
        streamArchive(req, res, filepath, download);
      } else {
        var headers = {"Content-Type": mime(filepath), "Content-Length": stats.size}, status = 200;
        if (download) {
          headers["Content-Disposition"] = utils.getDispo(filepath);
          res.writeHead(status, headers);
          fs.createReadStream(filepath).pipe(res);
        } else {
          headers["Accept-Ranges"] = "bytes"; // advertise ranges support
          if (req.headers.range) {
            var total        = stats.size;
            var range        = req.headers.range;
            var parts        = range.replace(/bytes=/, "").split("-");
            var partialstart = parts[0];
            var partialend   = parts[1];
            var start        = parseInt(partialstart);
            var end          = partialend ? parseInt(partialend) : total - 1;

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

function handleTypeRequest(req, res) {
  utils.isBinary(utils.addFilesPath(decodeURIComponent(req.url).substring(4)), function(err, result) {
    if (err) {
      res.statusCode = 500;
      res.end();
      log.error(err);
    } else {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain");
      res.end(result ? "binary" : "text");
    }
  });
}

function handleUploadRequest(req, res) {
  var busboy, opts, dstDir, done = false, files = {};

  if (!validateRequest(req)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "text/plain");
    res.end();
    log.info(req, res, "Unauthorized upload request");
    log.info(req, res);
    return;
  }

  // Set huge timeout for big file uploads and/or slow connection
  res.setTimeout(24 * 60 * 60 * 1000);

  req.query = qs.parse(req.url.substring("/upload?".length));

  if (!req.query || !req.query.to) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain");
    res.end();
    log.info(req, res, "Invalid upload request");
    return;
  }

  Object.keys(clients).some(function(sid) {
    if (clients[sid].cookie === cookies.get(req.headers.cookie)) {
      req.sid = sid;
      return true;
    }
  });

  dstDir = decodeURIComponent(req.query.to) || clients[req.sid].views[req.query.vId].directory;
  log.info(req, res, "Upload started");
  opts = {
    preservePath: true,
    headers: req.headers,
    fileHwm: 1024 * 1024,
    limits: {fieldNameSize: 255, fieldSize: 10 * 1024 * 1024}
  };
  if (config.maxFileSize > 0) opts.limits.fileSize = config.maxFileSize;

  busboy = new Busboy(opts);
  busboy.on("error", log.error);
  busboy.on("file", function(_, file, filePath) {
    if (!utils.isPathSane(filePath)) return;
    var dst = path.join(paths.files, dstDir, filePath);
    var tmp = path.join(paths.temp, crypto.randomBytes(32).toString("hex"));
    var ws  = fs.createWriteStream(tmp, {mode: "644"});
    files[filePath] = {src: tmp, dst : dst, ws: ws};
    file.pipe(ws);
  });

  busboy.on("filesLimit", function() {
    log.info(req, res, "Maximum files limit reached, cancelling upload");
    closeConnection();
  });

  busboy.on("finish", function() {
    var names = Object.keys(files), total = names.length, added = 0, toMove = [];
    log.info(req, res, "Received " + names.length + " files");
    done = true;

    while (names.length > 0) {
      (function(name) {
        fs.stat(files[name].dst, function(error) {
          if (error) { // File doesn't exist
            fs.stat(path.dirname(files[name].dst), function(error) {
              if (error) { // Dir doesn't exist
                utils.mkdir(path.dirname(files[name].dst), function() {
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
              (function(src, dst) {
                utils.getNewPath(dst, function(newDst) {
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
      async.eachLimit(toMove, 64, function(pair, cb) {
        filetree.moveTemps(pair[0], pair[1], function(err) {
          if (err) log.error(err);
          cb(null);
        });
      }, function() {
        filetree.updateDir(dstDir);
      });
    }
  });

  req.on("close", function() {
    if (!done) log.info(req, res, "Upload cancelled");
    closeConnection();

    // Clean up the temp files
    Object.keys(files).forEach(function(relPath) {
      var ws = files[relPath].ws;
      fs.unlink(files[relPath].src, function() {});
      ws.on("finish", function() { // Wait for a possible stream to close before deleting
        fs.unlink(files[relPath].src, function() {});
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
  }
}

filetree.on("updateall", function() {
  Object.keys(clientsPerDir).forEach(function(dir) {
    clientsPerDir[dir].forEach(function(client) {
      client.update();
    });
  });
});

filetree.on("update", function(dir) {
  if (clientsPerDir[dir]) {
    clientsPerDir[dir].forEach(function(client) {
      client.update();
    });
  }

  var parent = dir;
  while (true) {
    parent = path.dirname(parent);
    if (parent === dir) return;
    if (clientsPerDir[parent]) {
      clientsPerDir[parent].forEach(function(client) {
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
    update : _.throttle(function() {
      sendFiles(this.sid, this.vId);
    }, config.updateInterval, {leading: true, trailing: true})
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

function debug() {
  require("chokidar").watch(paths.client, {
    alwaysStat    : true,
    ignoreInitial : true
  }).on("change", function(file) {
    setTimeout(function() { // prevent EBUSY on win32
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

// Needs to be synchronous for process.on("exit")
function cleanupTemp() {
  fs.readdirSync(paths.temp).forEach(function(file) {
    utils.rmSync(path.join(paths.temp, file));
  });
}

// Clean up shortlinks by removing links to nonexistant files
function cleanupLinks(callback) {
  var linkcount = 0, cbcount = 0, links = db.get("links");
  if (Object.keys(links).length === 0)
    callback();
  else {
    Object.keys(links).forEach(function(link) {
      linkcount++;
      (function(shareLink, location) {
        fs.stat(path.join(paths.files, location), function(error, stats) {
          cbcount++;
          if (!stats || error) {
            delete links[shareLink];
          }
          if (cbcount === linkcount) {
            db.set("links", links);
            callback();
          }
        });
      })(link, links[link].location);
    });
  }
}

// Create a zip file from a directory and stream it to a client
function streamArchive(req, res, zipPath, download) {
  if (!validateRequest(req)) {
    res.writeHead(301, {Location: "/"});
    res.end();
    log.info(req, res);
    return;
  }
  fs.stat(zipPath, function(err, stats) {
    if (err) {
      log.error(err);
    } else if (stats.isDirectory()) {
      var zip = new yazl.ZipFile();
      var basePath = path.dirname(utils.removeFilesPath(zipPath));
      log.info(req, res);
      log.info("Streaming zip of ", chalk.blue(utils.removeFilesPath(zipPath)));
      res.statusCode = 200;
      res.setHeader("Content-Type", mime(zip));
      res.setHeader("Transfer-Encoding", "chunked");
      if (download) res.setHeader("Content-Disposition", utils.getDispo(zipPath + ".zip"));
      readdirp({root: zipPath, entryType: "both"})
        .on("warn", log.info).on("error", log.error).on("data", function(file) {
          var stats = file.stat;
          var relPath = utils.relativeZipPath(file.fullPath, basePath);
          if (stats.isDirectory())
            zip.addEmptyDirectory(relPath, {mtime: stats.mtime, mode: stats.mode});
          else
            zip.addFile(file.fullPath, relPath, {mtime: stats.mtime, mode: stats.mode});
        })
        .on("end", function() {
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

function validateRequest(req) {
  return Boolean(cookies.get(req.headers.cookie) || config.public);
}

// Hourly tasks
schedule.scheduleJob("* 0 * * *", function hourly() {
  if (!ready) return;
  // Clean inactive sessions after 1 month of inactivity
  var sessions = db.get("sessions");
  Object.keys(sessions).forEach(function(session) {
    if (!sessions[session].lastSeen || (Date.now() - sessions[session].lastSeen >= 2678400000)) {
      delete sessions[session];
    }
  });
  db.set("sessions", sessions);
});

// Process startup
function setupProcess(standalone) {
  process.on("exit", cleanupTemp);

  if (standalone) {
    process.on("SIGINT",  endProcess.bind(null, "SIGINT"));
    process.on("SIGQUIT", endProcess.bind(null, "SIGQUIT"));
    process.on("SIGTERM", endProcess.bind(null, "SIGTERM"));
    process.on("uncaughtException", function(error) {
      log.error("=============== Uncaught exception! ===============");
      log.error(error);
    });
  }
}

// Process shutdown
function endProcess(signal) {
  var count = 0;
  log.info("Received " + chalk.red(signal) + " - Shutting down ...");
  Object.keys(clients).forEach(function(sid) {
    if (!clients[sid] || !clients[sid].ws) return;
    if (clients[sid].ws.readyState < 2) {
      count++;
      clients[sid].ws.close(1001);
    }
  });
  if (count > 0) log.info("Closed " + count + " WebSocket" + (count > 1 ? "s" : ""));
  try { fs.unlinkSync(paths.pid); } catch (err) {}
  process.exit(0);
}
