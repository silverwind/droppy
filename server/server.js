"use strict";

const crypto = require("crypto");
const os     = require("os");
const path   = require("path");
const qs     = require("querystring");

const _        = require("lodash");
const async    = require("async");
const Busboy   = require("busboy");
const chalk    = require("chalk");
const escRe    = require("escape-string-regexp");
const fs       = require("graceful-fs");
const imgSize  = require("image-size");
const readdirp = require("readdirp");
const schedule = require("node-schedule");
const sendFile = require("send");
const ut       = require("untildify");
const yazl     = require("yazl");

const cfg       = require("./cfg.js");
const cookies   = require("./cookies.js");
const csrf      = require("./csrf.js");
const db        = require("./db.js");
const filetree  = require("./filetree.js");
const log       = require("./log.js");
const manifest  = require("./manifest.js");
const paths     = require("./paths.js").get();
const pkg       = require("./../package.json");
const resources = require("./resources.js");
const utils     = require("./utils.js");

let cache           = {};
const clients       = {};
const clientsPerDir = {};
let config          = null;
let firstRun        = null;
let Wss             = null;
let uwsLogged       = false;
let ready           = false;

const droppy = function droppy(opts, isStandalone, dev, callback) {
  if (isStandalone) {
    log.logo(
      [
        chalk.blue(pkg.name),
        chalk.green(pkg.version),
        "running on",
        chalk.blue("node"),
        chalk.green(process.version.substring(1))
      ].join(" "),
      [
        chalk.blue("config"),
        "at",
        chalk.green(paths.config)
      ].join(" "),
      [
        chalk.blue("files"),
        "at",
        chalk.green(paths.files)
      ].join(" ")
    );
  }
  setupProcess(isStandalone);

  async.series([
    function(cb) { utils.mkdir([paths.files, paths.temp, paths.config], cb); },
    function(cb) { if (isStandalone) fs.writeFile(paths.pid, process.pid, cb); else cb(); },
    function(cb) {
      cfg.init(opts, function(err, conf) {
        if (!err) {
          config = conf;
          if (dev) config.dev = dev;
        }
        cb(err);
      });
    },
    function(cb) {
      db.load(function() {
        db.watch(config);
        cb();
      });
    },
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
      if (config.demo) {
        process.title = "droppy-demo";
        config.demo = true;
        config.public = true;
        require("./demo.js").init(cb);
      } else cb();
    },
    function(cb) { if (isStandalone) { startListeners(cb); } else cb(); },
    function(cb) {
      filetree.init(config);
      filetree.updateDir(null, function() {
        if (config.watch) filetree.watch();
        cb();
      });
    },
    function(cb) {
      if (typeof config.keepAlive === "number" && config.keepAlive > 0) {
        setInterval(function() {
          Object.keys(clients).forEach(function(client) {
            if (!clients[client].ws) return;
            clients[client].ws.ping(undefined, undefined, true);
          });
        }, config.keepAlive);
      }
      cb();
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
    if (!utils.isPathSane(req.url, true)) {
      res.statusCode = 400;
      res.end();
      return log.info(req, res, "Invalid GET: " + req.url);
    }
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
module.exports = droppy;

function startListeners(callback) {
  if (!Array.isArray(config.listeners)) {
    return callback(new Error("Config Error: 'listeners' option must be an array"));
  }

  const targets = [];
  config.listeners.forEach(function(listener, i) {
    if (listener.protocol === undefined) {
      listener.protocol = "http";
    }

    // arrify and filter `undefined`
    const hosts = utils.arrify(listener.host).filter(host => Boolean(host));
    const ports = utils.arrify(listener.port).filter(port => Boolean(port));
    const sockets = utils.arrify(listener.socket).filter(socket => Boolean(socket));

    // validate listener options
    hosts.forEach(host => {
      if (typeof host !== "string") {
        return callback(new Error("Invalid config value: 'host' = " + hosts[host]));
      }
    });
    ports.forEach((port, i) => {
      if (typeof port !== "number" && typeof port !== "string") {
        return callback(new Error("Invalid config value: 'port' = " + port));
      }

      if (typeof port === "string") {
        const num = parseInt(port);
        if (Number.isNaN(num)) {
          return callback(new Error("Invalid config value: 'port' = " + port));
        }
        ports[i] = num;
      }
    });
    sockets.forEach(socket => {
      if (typeof socket !== "string") {
        return callback(new Error("Invalid config value: 'socket' = " + socket));
      }

      try {
        fs.unlinkSync(socket);
      } catch (err) {
        if (err.code !== "ENOENT") {
          return callback(
            new Error("Unable to write to unix socket '" + socket + "': " + err.code)
          );
        }
      }
    });

    // On Linux, Node.js listens on v4 and v6 when :: is given as host. Don't attempt
    // to bind to v4 to prevent an misleading error being logged.
    // https://github.com/nodejs/node/issues/7200
    if (hosts.length > 1 && os.platform() === "linux" &&
        hosts.includes("::") && hosts.includes("0.0.0.0")) {
      hosts.splice(hosts.indexOf("0.0.0.0"), 1);
    }

    const opts = {
      proto: listener.protocol,
      hsts: listener.hsts,
      key: listener.key,
      cert: listener.cert,
      dhparam: listener.dhparam,
      passphrase: listener.passphrase,
      index: i,
    };

    // listen on all host + port combinations
    hosts.forEach(function(host) {
      ports.forEach(function(port) {
        targets.push({
          host: host,
          port: port,
          opts: opts,
        });
      });
    });

    // listen on unix socket
    sockets.forEach(function(socket) {
      targets.push({
        socket: socket,
        opts: opts,
      });
    });
  });

  let listenerCount = 0;
  async.each(targets, function(target, cb) {
    createListener(onRequest, target.opts, function(err, server) {
      if (err) return cb(err);

      server.on("listening", function() {
        server.removeAllListeners("error");
        listenerCount++;
        setupSocket(server);
        const proto = target.opts.proto.toLowerCase();

        if (target.socket) { // socket
          fs.chmodSync(target.socket, 0o666); // make it rw
          // a unix socket URL should normally percent-encode the path, but
          // we're printing a path-less URL so pretty-print it with slashes.
          log.info("Listening on ",
            chalk.blue(proto + "+unix://") +
            chalk.cyan(server.address())
          );
        } else { // host + port
          log.info("Listening on ",
            chalk.blue(proto + "://") +
            log.formatHostPort(server.address().address, server.address().port, proto)
          );
        }
        cb();
      });

      server.on("error", function(err) {
        if (target.host && target.port) {
          if (err.code === "EADDRINUSE") {
            log.info(
              chalk.red("Failed to bind to "), chalk.cyan(target.host), chalk.red(":"),
              chalk.blue(target.port), chalk.red(". Address already in use.")
            );
          } else if (err.code === "EACCES") {
            log.info(
              chalk.red("Failed to bind to "), chalk.cyan(target.host), chalk.red(":"),
              chalk.blue(target.port), chalk.red(". Need permission to bind to ports < 1024.")
            );
          } else if (err.code === "EAFNOSUPPORT") {
            log.info(
              chalk.red("Failed to bind to "), chalk.cyan(target.host), chalk.red(":"),
              chalk.blue(target.port), chalk.red(". Protocol unsupported.")
            );
          } else if (err.code === "EADDRNOTAVAIL") {
            log.info(
              chalk.red("Failed to bind to "), chalk.cyan(target.host), chalk.red(":"),
              chalk.blue(target.port), chalk.red(". Address not available.")
            );
          } else log.error(err);
        } else log.error(err);
        return cb(err);
      });

      if (target.socket) {
        server.listen(target.socket);
      } else {
        server.listen(target.port, target.host);
      }
    });
  }, function(err) {
    // don't emit error (and abort) if we have at least 1 listener
    return callback(listenerCount === 0 ? err : null);
  });
}

function createListener(handler, opts, callback) {
  let server;
  if (opts.proto === "http") {
    server = require("http").createServer(handler);
    server.on("clientError", function(_err, socket) {
      if (socket.writable) {
        // Node.js 6.0
        socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
      }
    });
    callback(null, server);
  } else {
    // disable client session renegotiation
    const tls = require("tls");
    tls.CLIENT_RENEG_LIMIT = 0;
    tls.CLIENT_RENEG_WINDOW = Infinity;

    const https = require("https");
    tlsInit(opts, function(err, tlsOptions) {
      if (err) return callback(err);

      try {
        server = https.createServer(tlsOptions);
      } catch (err) {
        if (/(bad password|bad decrypt)/.test(err)) {
          let errText;
          if (!tlsOptions.passphrase) {
            errText = "TLS key '" + opts.key + "' is encrypted with a passphrase. " +
              "You can either decrypt the key using `openssl rsa -in " + opts.key +
              " -out " + opts.key + "` or use the `passphrase` option on the listener.";
          } else {
            errText = "Wrong passphrase for TLS key '" + opts.key + "'";
          }
          return callback(new Error(errText));
        } else {
          return callback(err);
        }
      }

      server.on("request", function(req, res) {
        if (opts.hsts && opts.hsts > 0) {
          res.setHeader("Strict-Transport-Security", "max-age=" + opts.hsts);
        }
        handler(req, res);
      });

      function tlsError(err, socket) {
        // can't get the remote address at this point, just log the error
        if (err && err.message) log.debug(null, null, err.message);
        if (socket.writable) socket.destroy();
      }
      server.on("clientError", tlsError); // Node.js < 6.0
      server.on("tlsClientError", tlsError); // Node.js 6.0 (event renamed)

      // TLS tickets - regenerate keys every hour, Node.js 4.0
      (function rotate() {
        server.setTicketKeys(crypto.randomBytes(48));
        setTimeout(rotate, 60 * 60 * 1000);
      })();

      callback(null, server);
    });
  }
}

// WebSocket functions
function setupSocket(server) {
  // fall back from uws to ws in case it failed to build
  try {
    Wss = require("uws").Server;
  } catch (err) {
    if (!uwsLogged) {
      log.info("`uws` module failed to build, falling back to `ws`");
      uwsLogged = true;
    }
    Wss = require("ws").Server;
  }
  const wss = new Wss({
    server: server,
    verifyClient: function(info, cb) {
      if (validateRequest(info.req)) return cb(true);
      log.info(info.req, {statusCode: 401}, "Unauthorized WebSocket connection rejected.");
      cb(false, 401, "Unauthorized");
    }
  });
  wss.on("connection", function(ws, req) {
    req = req || ws.upgradeReq; // compat: ws 3.0.0
    ws.addr = ws._socket.remoteAddress;
    ws.port = ws._socket.remotePort;
    ws.headers = Object.assign({}, req.headers);
    log.info(ws, null, "WebSocket [", chalk.green("connected"), "]");
    const sid = ws._socket.remoteAddress + " " + ws._socket.remotePort;
    const cookie = cookies.get(req.headers.cookie);
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

      const vId = msg.vId;
      const priv = Boolean((db.get("sessions")[cookie] || {}).privileged);

      if (msg.type === "REQUEST_SETTINGS") {
        sendObj(sid, {type: "SETTINGS", vId: vId, settings: {
          version       : pkg.version,
          dev           : config.dev,
          demo          : config.demo,
          public        : config.public,
          readOnly      : config.readOnly,
          priv          : priv,
          engine        : "node " + process.version.substring(1),
          platform      : process.platform,
          caseSensitive : process.platform === "linux", // TODO: actually test the filesystem
          themes        : Object.keys(cache.themes).sort().join("|"),
          modes         : Object.keys(cache.modes).sort().join("|"),
        }});
      } else if (msg.type === "REQUEST_UPDATE") {
        if (!validatePaths(msg.data, msg.type, ws, sid, vId)) return;
        if (!clients[sid]) clients[sid] = {views: [], ws: ws}; // This can happen when the server restarts
        fs.stat(utils.addFilesPath(msg.data), function(err, stats) {
          let clientDir, clientFile;
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
      } else if (msg.type === "DESTROY_VIEW") {
        clients[sid].views[vId] = null;
      } else if (msg.type === "REQUEST_SHARELINK") {
        if (!validatePaths(msg.data.location, msg.type, ws, sid, vId)) return;
        const links = db.get("links");

        // Check if we already have a link for that file
        const hadLink = Object.keys(links).some(function(link) {
          if (msg.data.location === links[link].location && msg.data.attachement === links[link].attachement) {
            sendObj(sid, {type: "SHARELINK", vId: vId, link: link, attachement: msg.data.attachement});
            return true;
          }
        });
        if (hadLink) return;

        const link = utils.getLink(links, config.linkLength);
        log.info(ws, null, "Share link created: " + link + " -> " + msg.data.location);
        sendObj(sid, {type: "SHARELINK", vId: vId, link: link, attachement: msg.data.attachement});
        links[link] = {location: msg.data.location, attachement: msg.data.attachement};
        db.set("links", links);
      } else if (msg.type === "DELETE_FILE") {
        log.info(ws, null, "Deleting: " + msg.data);
        if (config.readOnly) return sendError(sid, vId, "Files are read-only.");
        if (!validatePaths(msg.data, msg.type, ws, sid, vId)) return;
        filetree.del(msg.data);
      } else if (msg.type === "SAVE_FILE") {
        log.info(ws, null, "Saving: " + msg.data.to);
        if (config.readOnly) return sendError(sid, vId, "Files are read-only.");
        if (!validatePaths(msg.data.to, msg.type, ws, sid, vId)) return;
        filetree.save(msg.data.to, msg.data.value, function(err) {
          if (err) {
            sendError(sid, vId, "Error saving " + msg.data.to);
            log.error(err);
          } else sendObj(sid, {type: "SAVE_STATUS", vId: vId, status : err ? 1 : 0});
        });
      } else if (msg.type === "CLIPBOARD") {
        const src = msg.data.src;
        const dst = msg.data.dst;
        const type = msg.data.type;
        log.info(ws, null, "Clipboard " + type + ": " + src + " -> " + dst);
        if (config.readOnly) return sendError(sid, vId, "Files are read-only.");
        if (!validatePaths([src, dst], msg.type, ws, sid, vId)) return;
        if (new RegExp("^" + escRe(msg.data.src) + "/").test(msg.data.dst)) {
          return sendError(sid, vId, "Can't copy directory into itself");
        }

        fs.stat(utils.addFilesPath(msg.data.dst), function(err, stats) {
          if (!err && stats || msg.data.src === msg.data.dst) {
            utils.getNewPath(utils.addFilesPath(msg.data.dst), function(newDst) {
              filetree.clipboard(msg.data.src, utils.removeFilesPath(newDst), msg.data.type);
            });
          } else {
            filetree.clipboard(msg.data.src, msg.data.dst, msg.data.type);
          }
        });
      } else if (msg.type === "CREATE_FOLDER") {
        if (config.readOnly) return sendError(sid, vId, "Files are read-only.");
        if (!validatePaths(msg.data, msg.type, ws, sid, vId)) return;
        filetree.mkdir(msg.data);
      } else if (msg.type === "CREATE_FILE") {
        if (config.readOnly) return sendError(sid, vId, "Files are read-only.");
        if (!validatePaths(msg.data, msg.type, ws, sid, vId)) return;
        filetree.mk(msg.data);
      } else if (msg.type === "RENAME") {
        if (config.readOnly) return sendError(sid, vId, "Files are read-only.");
        const rSrc = msg.data.src;
        const rDst = msg.data.dst;
        // Disallow whitespace-only and empty strings in renames
        if (!validatePaths([rSrc, rDst], msg.type, ws, sid, vId) ||
            /^\s*$/.test(rDst) || rDst === "" || rSrc === rDst) {
          log.info(ws, null, "Invalid rename request: " + rSrc + "-> " + rDst);
          sendError(sid, vId, "Invalid rename request");
          return;
        }
        filetree.move(rSrc, rDst);
      } else if (msg.type === "GET_USERS") {
        if (priv && !config.public) sendUsers(sid);
      } else if (msg.type === "UPDATE_USER") {
        const name = msg.data.name;
        const pass = msg.data.pass;
        if (!priv) return;
        if (pass === "") {
          if (!db.get("users")[name]) return;
          if ((db.get("sessions")[cookie] || {}).username === name) {
            return sendError(sid, null, "Cannot delete yourself!");
          }
          if (db.delUser(name)) log.info(ws, null, "Deleted user: ", chalk.magenta(name));
        } else {
          const isNew = !db.get("users")[name];
          db.addOrUpdateUser(name, pass, msg.data.priv || false);
          log.info(ws, null, (isNew ? "Added" : "Updated") + " user: ", chalk.magenta(name));
        }
        sendUsers(sid);
      } else if (msg.type === "CREATE_FILES") {
        if (config.readOnly) return sendError(sid, vId, "Files are read-only.");
        if (!validatePaths(msg.data.files, msg.type, ws, sid, vId)) return;
        async.each(msg.data.files, function(file, cb) {
          filetree.mkdir(utils.addFilesPath(path.dirname(file)), function() {
            filetree.mk(utils.addFilesPath(file), cb);
          });
        }, function(err) {
          if (err) log.error(ws, null, err);
        });
      } else if (msg.type === "CREATE_FOLDERS") {
        if (config.readOnly) return sendError(sid, vId, "Files are read-only.");
        if (!validatePaths(msg.data.folders, msg.type, ws, sid, vId)) return;
        async.each(msg.data.folders, function(folder, cb) {
          filetree.mkdir(utils.addFilesPath(folder), cb);
        }, function(err) {
          if (err) log.error(ws, null, err);
        });
      } else if (msg.type === "GET_MEDIA") {
        const dir = msg.data.dir;
        const exts = msg.data.exts;
        if (!validatePaths(dir, msg.type, ws, sid, vId)) return;
        const files = filetree.lsFilter(dir, utils.extensionRe(exts.img.concat(exts.vid)));
        if (!files) return sendError(sid, vId, "No displayable files in directory");
        async.map(files, function(file, cb) {
          if (utils.extensionRe(exts.img).test(file)) {
            imgSize(path.join(utils.addFilesPath(dir), file), function(err, dims) {
              if (err) log.error(err);
              cb(null, {
                src: file,
                w: dims && dims.width ? dims.width : 0,
                h: dims && dims.height ? dims.height : 0,
              });
            });
          } else cb(null, {video: true, src: file});
        }, function(_, obj) {
          sendObj(sid, {type: "MEDIA_FILES", vId: vId, files: obj});
        });
      }
    });

    ws.on("close", function(code) {
      let reason;
      if (code === 4001) {
        reason = "(Logged out)";
        const sessions = db.get("sessions");
        delete sessions[cookie];
        db.set("sessions", sessions);
      } else if (code === 1001) {
        reason = "(Going away)";
      }
      removeClientPerDir(sid);
      delete clients[sid];
      if (code === 1011) {
        log.info(ws, null, "WebSocket [", chalk.red("disconnected"), "] ", "(CSFR prevented or server restarted)");
      } else {
        log.info(ws, null, "WebSocket [", chalk.red("disconnected"), "] ", reason || "(Code: " + (code || "none") + ")");
      }
    });
    ws.on("error", log.error);
  });
  wss.on("error", log.error);
}

// Ensure that a given path does not contain invalid file names
function validatePaths(paths, type, ws, sid, vId) {
  return (Array.isArray(paths) ? paths : [paths]).every(function(p) {
    if (!utils.isPathSane(p)) {
      sendError(sid, vId, "Invalid request");
      log.info(ws, null, "Invalid " + type + " request: " + p);
      return false;
    } else {
      return true;
    }
  });
}

// Send a file list update
function sendFiles(sid, vId) {
  if (!clients[sid] || !clients[sid].views[vId] || !clients[sid].ws || !clients[sid].ws._socket) return;
  const dir = clients[sid].views[vId].directory;
  sendObj(sid, {
    type   : "UPDATE_DIRECTORY",
    vId    : vId,
    folder : dir,
    data   : filetree.ls(dir)
  });
}

// Send a list of users on the server
function sendUsers(sid) {
  const userDB   = db.get("users");
  const userlist = {};

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

function sendError(sid, vId, text) {
  sendObj(sid, {type: "ERROR", vId: vId, text: text});
  log.info(clients[sid].ws, null, "Sent error: " + text);
}

function redirectToRoot(req, res) {
  res.writeHead(307, {Location: "/", "Cache-Control": "public, max-age=0"});
  res.end();
  log.info(req, res);
  return;
}

// Do the actual sending
function send(ws, data) {
  (function queue(ws, data, time) {
    if (time > 1000) return; // in case the socket hasn't opened after 1 second, cancel the sending
    if (ws && ws.readyState === 1) {
      if (config.logLevel === 3) {
        const debugData = JSON.parse(data);
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
  const URI = decodeURIComponent(req.url);

  if (config.public && !cookies.get(req.headers.cookie)) {
    cookies.free(req, res);
  }

  // unauthenticated GETs
  if (URI === "/") {
    if (validateRequest(req)) {
      handleResourceRequest(req, res, "main.html");
      const sessions = db.get("sessions");
      if (sessions[cookies.get(req.headers.cookie)]) {
        sessions[cookies.get(req.headers.cookie)].lastSeen = Date.now();
      }
      db.set("sessions", sessions);
    } else if (firstRun) {
      handleResourceRequest(req, res, "first.html");
    } else {
      handleResourceRequest(req, res, "auth.html");
    }
    return;
  } else if (URI === "/robots.txt") {
    res.writeHead(200, {"Content-Type": "text/plain; charset=utf-8"});
    res.end("User-agent: *\nDisallow: /\n");
    return log.info(req, res);
  } else if (URI === "/favicon.ico") {
    res.statusCode = 404;
    res.end();
    return log.info(req, res);
  } else if (/^\/!\/res\/[\s\S]+/.test(URI)) {
    return handleResourceRequest(req, res, URI.substring(7));
  }

  if (/^\/!\/dl\/[\s\S]+/.test(URI) || /^\/\??\$\/[\s\S]+$/.test(URI)) {
    return handleFileRequest(req, res, true);
  }

  // validate requests below
  if (!validateRequest(req)) {
    res.statusCode = 401;
    res.end();
    log.info(req, res);
    return;
  }

  if (/^\/!\/token$/.test(URI)) {
    if (req.headers["x-app"] === "droppy") {
      res.writeHead(200, {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Type": "text/plain; charset=utf-8"
      });
      res.end(csrf.create(req));
    } else {
      res.statusCode = 401;
      res.end();
    }
  } else if (/^\/!\/type\/[\s\S]+/.test(URI)) {
    handleTypeRequest(req, res, utils.addFilesPath(URI.substring(7)));
  } else if (/^\/!\/file\/[\s\S]+/.test(URI)) {
    handleFileRequest(req, res, false);
  } else if (/^\/!\/zip\/[\s\S]+/.test(URI)) {
    streamArchive(req, res, utils.addFilesPath(URI.substring(6)), true);
  } else {
    redirectToRoot(req, res);
  }
}

const rateLimited = [];
function handlePOST(req, res) {
  const URI = decodeURIComponent(req.url);

  // unauthenticated POSTs
  if (/^\/!\/login/.test(URI)) {
    res.setHeader("Content-Type", "text/plain");

    // Rate-limit login attempts to one attempt every 2 seconds
    const ip = utils.ip(req);
    if (rateLimited.indexOf(ip) !== -1) {
      res.statusCode = 429;
      res.end();
      return;
    } else {
      rateLimited.push(ip);
      setTimeout(function() {
        rateLimited.some(function(rIp, i) {
          if (rIp === ip) return rateLimited.splice(i, 1);
        });
      }, 2000);
    }

    utils.readJsonBody(req).then(function(postData) {
      if (db.authUser(postData.username, postData.password)) {
        cookies.create(req, res, postData);
        res.statusCode = 200;
        res.end();
        log.info(req, res, "User ", "'", postData.username, "'", chalk.green(" authenticated"));
      } else {
        res.statusCode = 401;
        res.end();
        log.info(req, res, "User ", "'", postData.username, "'", chalk.red(" unauthorized"));
      }
    }).catch(function(err) {
      log.error(err);
      res.statusCode = 400;
      res.end();
      log.info(req, res);
    });
    return;
  } else if (firstRun && /^\/!\/adduser/.test(URI)) {
    res.setHeader("Content-Type", "text/plain");
    utils.readJsonBody(req).then(function(postData) {
      if (postData.username && postData.password &&
          typeof postData.username === "string" &&
          typeof postData.password === "string") {
        db.addOrUpdateUser(postData.username, postData.password, true);
        cookies.create(req, res, postData);
        firstRun = false;
        res.statusCode = 200;
        res.end();
        log.info(req, res, "User ", "'", postData.username, "' created");
      } else {
        res.statusCode = 400;
        res.end();
        log.info(req, res, "Invalid user creation request");
      }
    }).catch(function() {
      res.statusCode = 400;
      res.end();
      log.info(req, res);
    });
    return;
  }

  // validate requests below
  if (!validateRequest(req)) {
    res.statusCode = 401;
    res.end();
    log.info(req, res);
    return;
  }

  if (/^\/!\/upload/.test(URI)) {
    handleUploadRequest(req, res);
  } else if (/^\/!\/logout$/.test(URI)) {
    res.setHeader("Content-Type", "text/plain");
    utils.readJsonBody(req).then(function(postData) {
      cookies.unset(req, res, postData);
      res.statusCode = 200;
      res.end();
      log.info(req, res);
    }).catch(function(err) {
      log.error(err);
      res.statusCode = 400;
      res.end();
      log.info(req, res);
    });
  } else {
    res.statusCode = 404;
    res.end();
    log.info(req, res);
  }
}

function handleResourceRequest(req, res, resourceName) {
  let resource;

  // Assign filename, must be unique for resource requests
  if (/^\/!\/res\/theme\//.test(req.url)) {
    resource = cache.themes[req.url.substring("/!/res/theme/".length)];
  } else if (/^\/!\/res\/mode\//.test(req.url)) {
    resource = cache.modes[req.url.substring("/!/res/mode/".length)];
  } else if (/^\/!\/res\/lib\//.test(req.url)) {
    resource = cache.lib[req.url.substring("/!/res/lib/".length)];
  } else if (/^\/!\/res\/manifest\.json$/.test(req.url)) {
    resource = {
      data: manifest(req),
      mime: "application/manifest+json; charset=UTF-8"
    };
  } else {
    resource = cache.res[resourceName];
  }

  // Regular resource handling
  const headers = {};
  let status = 200;
  let data;

  if (resource === undefined) {
    status = 400;
  } else {
    headers["Vary"] = "Accept-Encoding";

    // Caching
    headers["Cache-Control"] = "public, max-age=0";
    if (resource.etag) {
      headers["ETag"] = resource.etag;
    }

    // Check Etag
    if ((req.headers["if-none-match"] || "") === resource.etag) {
      res.writeHead(304, headers);
      res.end();
      log.info(req, res);
      return;
    }

    // Headers on HTML requests
    if (/\.html$/.test(resourceName)) {
      headers["Content-Security-Policy"] = [
        "script-src 'self' 'unsafe-inline' blob: data:",
        "style-src 'self' 'unsafe-inline' blob: data:",
        "media-src 'self' blob: data:",
        "font-src 'self' blob: data:",
        "child-src 'none'",
        "object-src 'none'",
        "form-action 'self'",
        // connect-src 'self' does not include websockets in Firefox and Safari.
        // The proper way to solve it would require a X-Forwarded-Proto to be set
        // by a reverse proxy, which would be a breaking change. Disabled until
        // below bug is fixed.
        // Firefox bug: https://bugzilla.mozilla.org/show_bug.cgi?id=1345615
        // "connect-src 'self' ws:" + origin + " wss:" + origin,
      ].join("; ");
      headers["X-Content-Type-Options"] = "nosniff";
      headers["Referrer-Policy"] = "no-referrer";
      if (!config.allowFrame) {
        headers["X-Frame-Options"] = "DENY";
      }
      if (req.headers["user-agent"] && req.headers["user-agent"].indexOf("MSIE") > 0) {
        headers["X-UA-Compatible"] = "IE=Edge";
      }
    }

    // Content-Type
    headers["Content-Type"] = resource.mime;

    // Encoding, length
    const encodings = (req.headers["accept-encoding"] || "").split(",").map(function(e) {
      return e.trim().toLowerCase();
    }).filter(function(e) {
      return Boolean(e);
    });
    if (config.compression && encodings.includes("br") && resource.brotli) {
      headers["Content-Encoding"] = "br";
      headers["Content-Length"] = resource.brotli.length;
      data = resource.brotli;
    } else if (config.compression && encodings.includes("gzip") && resource.gzip) {
      headers["Content-Encoding"] = "gzip";
      headers["Content-Length"] = resource.gzip.length;
      data = resource.gzip;
    } else {
      headers["Content-Length"] = resource.data.length;
      data = resource.data;
    }
  }
  res.writeHead(status, headers);
  res.end(data);
  log.info(req, res);
}

function handleFileRequest(req, res, download) {
  const URI = decodeURIComponent(req.url);
  let shareLink, filepath;
  const linkRe = new RegExp("^/\\??\\$/([" + utils.linkChars + "]{" + config.linkLength + "})$");

  let parts = linkRe.exec(URI);
  if (parts && parts[1]) { // check for sharelink
    const link = db.get("links")[parts[1]];
    if (!link) return redirectToRoot(req, res);
    shareLink = true;
    download = link.attachement;
    filepath = utils.addFilesPath(link.location);
  } else { // it's a direct file request
    if (!validateRequest(req)) {
      return redirectToRoot(req, res);
    }
    parts = /^\/!\/(.+?)\/(.+)$/.exec(URI);
    if (!parts || !parts[1] || !parts[2] || !utils.isPathSane(parts[2])) {
      return redirectToRoot(req, res);
    }
    download = parts[1] === "dl";
    filepath = utils.addFilesPath("/" + [parts[2]]);
  }

  fs.stat(filepath, function(error, stats) {
    if (!error && stats) {
      if (stats.isDirectory() && shareLink) {
        streamArchive(req, res, filepath, download);
      } else {
        streamFile(req, res, filepath, download, stats);
      }
    } else {
      if (error.code === "ENOENT") {
        res.statusCode = 404;
      } else if (error.code === "EACCES") {
        res.statusCode = 403;
      } else {
        res.statusCode = 500;
      }
      log.error(error);
      res.end();
    }
    log.info(req, res);
  });
}

function handleTypeRequest(req, res, file) {
  utils.isBinary(file, function(err, result) {
    if (err) {
      res.statusCode = 500;
      res.end();
      log.error(err);
    } else {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(result ? "binary" : "text");
    }
  });
  log.info(req, res);
}

function handleUploadRequest(req, res) {
  const files = {};
  let done = false;
  let limitHit;

  if (config.readOnly) {
    res.statusCode = 403;
    res.end();
    log.info(req, res, "Upload cancelled because of read-only mode");
    return;
  }

  // Set huge timeout for big file uploads and/or slow connection
  res.setTimeout(24 * 60 * 60 * 1000);

  req.query = qs.parse(req.url.substring("/upload?".length));

  if (!req.query || !req.query.to) {
    res.statusCode = 500;
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

  const dstDir = decodeURIComponent(req.query.to) || clients[req.sid].views[req.query.vId].directory;
  log.info(req, res, "Upload started");
  const opts = {
    preservePath: true,
    headers: req.headers,
    fileHwm: 1024 * 1024,
    limits: {fieldNameSize: 255, fieldSize: 10 * 1024 * 1024}
  };
  if (config.maxFileSize > 0) opts.limits.fileSize = config.maxFileSize;

  const busboy = new Busboy(opts);
  busboy.on("error", log.error);
  busboy.on("file", function(_, file, filePath) {
    if (!utils.isPathSane(filePath) || !utils.isPathSane(dstDir)) return;

    const dst = path.join(paths.files, dstDir, filePath);
    const tmp = path.join(paths.temp, crypto.randomBytes(32).toString("hex"));
    const ws  = fs.createWriteStream(tmp, {mode: "644"});
    files[filePath] = {src: tmp, dst : dst, ws: ws};

    file.on("limit", function() {
      log.info(req, res, "Maximum file size reached, cancelling upload");
      sendError(
        req.sid, req.query.vId,
        "Maximum upload size of " + utils.formatBytes(config.maxFileSize) + " exceeded."
      );
      limitHit = true;
      closeConnection();
      removeTempFiles();
    });

    file.pipe(ws);
  });

  busboy.on("finish", function() {
    const names = Object.keys(files);
    const total = names.length;
    let added = 0;
    const toMove = [];

    log.info(req, res, "Received " + names.length + " files");
    done = true;

    // remove all temporary files if one hit the limit
    if (limitHit) return removeTempFiles();

    while (names.length > 0) {
      (function(name) {
        fs.stat(files[name].dst, function(err) {
          if (err) { // File doesn't exist
            fs.stat(path.dirname(files[name].dst), function(err) {
              if (err) { // Dir doesn't exist
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
        filetree.updateDir(dstDir, config);
      });
    }
  });

  req.on("close", function() {
    if (!done) log.info(req, res, "Upload cancelled");
    closeConnection();
    removeTempFiles();
  });

  req.pipe(busboy);

  function removeTempFiles() {
    async.each(Object.keys(files), function(name, cb) {
      utils.rm(files[name].src, function() {
        delete files[name];
        cb();
      });
    });
  }

  function closeConnection() {
    res.statusCode = 200;
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
  while (true) {
    if (clientsPerDir[dir]) {
      clientsPerDir[dir].forEach(function(client) {
        client.update();
      });
    }
    if (dir === "/") break;
    dir = path.dirname(dir);
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
    const removeAt = [];
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
        sendObjAll({
          type: "RELOAD",
          css: String(cache.res["style.css"].data).replace('"sprites.png"', '"!/res/sprites.png"')
        });
      } else if (/\.(js|hbs)$/.test(file)) {
        cache.res["client.js"] = resources.compileJS();
        sendObjAll({type: "RELOAD"});
      } else if (/\.(html|svg)$/.test(file)) {
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

// Clean up sharelinks by removing links to nonexistant files
function cleanupLinks(callback) {
  let linkcount = 0, cbcount = 0;
  const links = db.get("links");
  if (Object.keys(links).length === 0) {
    callback();
  } else {
    Object.keys(links).forEach(function(link) {
      linkcount++;
      (function(shareLink, location) {
        // check for links not matching the configured length
        if (shareLink.length !== config.linkLength) {
          log.debug("deleting link not matching the configured length: " + shareLink);
          delete links[shareLink];
          if (++cbcount === linkcount) {
            db.set("links", links);
            callback();
          }
          return;
        }
        // check for links where the target does not exist anymore
        fs.stat(path.join(paths.files, location), function(error, stats) {
          if (!stats || error) {
            log.debug("deleting nonexistant link: " + shareLink);
            delete links[shareLink];
          }
          if (++cbcount === linkcount) {
            if (JSON.stringify(links) !== JSON.stringify(db.get("links"))) {
              db.set("links", links);
            }
            callback();
          }
        });
      })(link, links[link].location);
    });
  }
}

// Create a zip file from a directory and stream it to a client
function streamArchive(req, res, zipPath, download) {
  if (!validateRequest(req)) return redirectToRoot(req, res);
  fs.stat(zipPath, function(err, stats) {
    if (err) {
      log.error(err);
    } else if (stats.isDirectory()) {
      const zip = new yazl.ZipFile();
      const relPath = utils.removeFilesPath(zipPath);
      const targetDir = path.basename(relPath);
      log.info(req, res);
      log.info("Streaming zip of ", chalk.blue(relPath));
      res.statusCode = 200;
      res.setHeader("Content-Type", utils.contentType(zip));
      res.setHeader("Transfer-Encoding", "chunked");
      if (download) res.setHeader("Content-Disposition", utils.getDispo(zipPath + ".zip"));
      readdirp({root: zipPath, entryType: "both"}).on("data", function(file) {
        const pathInZip = path.join(targetDir, file.path);
        const metaData = {mtime: file.stat.mtime, mode: file.stat.mode};
        if (file.stat.isDirectory()) {
          zip.addEmptyDirectory(pathInZip, metaData);
        } else {
          zip.addFile(file.fullPath, pathInZip, metaData);
        }
      }).on("warn", log.info).on("error", log.error).on("end", function() {
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

function streamFile(req, res, filepath, download, stats) {
  // send exprects a url-encoded argument
  sendFile(req, encodeURIComponent(utils.removeFilesPath(filepath).substring(1)), {
    root: paths.files,
    dotfiles: "allow",
    index: false,
    etag: false,
    cacheControl: false,
  }).on("headers", function(res) {
    res.setHeader("Content-Type", utils.contentType(filepath));
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    if (download) {
      res.setHeader("Content-Disposition", utils.getDispo(filepath));
    }
  }).on("error", function(err) {
    log.error(err);
    if (req.headers.range) {
      log.error("requested:", req.headers.range, "end:" + stats.size);
    }
  }).on("stream", function() {
    log.info(req, res);
  }).pipe(res);
}

function validateRequest(req) {
  return Boolean(cookies.get(req.headers.cookie) || config.public);
}

const cbs = [];
function tlsInit(opts, cb) {
  if (!cbs[opts.index]) {
    cbs[opts.index] = [cb];
    tlsSetup(opts, function(err, tlsData) {
      cbs[opts.index].forEach(function(cb) {
        cb(err, tlsData);
      });
    });
  } else cbs[opts.index].push(cb);
}

function tlsSetup(opts, cb) {
  opts.honorCipherOrder = true;

  if (typeof opts.key !== "string") {
    return cb(new Error("Missing TLS option 'key'"));
  } if (typeof opts.cert !== "string") {
    return cb(new Error("Missing TLS option 'cert'"));
  }

  const certPaths = [
    path.resolve(paths.config, ut(opts.key)),
    path.resolve(paths.config, ut(opts.cert)),
    opts.dhparam ? path.resolve(paths.config, opts.dhparam) : undefined
  ];

  async.map(certPaths, utils.readFile, function(_, data) {
    const key     = data[0];
    const certs   = data[1];
    const dhparam = data[3];

    if (!key) return cb(new Error("Unable to read TLS key: " + certPaths[0]));
    if (!certs) return cb(new Error("Unable to read TLS certificates: " + certPaths[1]));
    if (opts.dhparam && !dhparam) return cb(new Error("Unable to read TLS DH parameter file: " + certPaths[3]));

    function createDH() {
      log.info("Generating 2048 bit Diffie-Hellman parameters. This will take a long time.");
      const dh = require("dhparam")(2048);
      db.set("dhparam", dh);
      return dh;
    }

    cb(null, {
      cert: certs,
      key: key,
      dhparam: dhparam || db.get("dhparam") || createDH(),
      passphrase: opts.passphrase,
    });
  });
}

// Hourly tasks
schedule.scheduleJob("* 0 * * *", function hourly() {
  if (!ready) return;
  // Clean inactive sessions after 1 month of inactivity
  const sessions = db.get("sessions");
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
    process.on("SIGINT", endProcess.bind(null, "SIGINT"));
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
  let count = 0;
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
