"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const qs = require("querystring");
const {promisify} = require("util");
const {readFile} = require("fs").promises;

const throttle = require("lodash.throttle");
const Busboy = require("busboy");
const {red, blue, green, cyan, magenta} = require("colorette");
const escRe = require("escape-string-regexp");
const etag = require("etag");
const imgSize = require("image-size");
const rrdir = require("rrdir");
const sendFile = require("send");
const ut = require("untildify");
const Wss = require("ws").Server;
const yazl = require("yazl");

const cfg = require("./cfg.js");
const cookies = require("./cookies.js");
const csrf = require("./csrf.js");
const db = require("./db.js");
const filetree = require("./filetree.js");
const log = require("./log.js");
const manifest = require("./manifest.js");
const paths = require("./paths.js").get();
const pkg = require("../package.json");
const resources = require("./resources.js");
const utils = require("./utils.js");

let cache = {};
const clients = {};
const clientsPerDir = {};
let config = null;
let firstRun = null;
let ready = false;
let dieOnError = true;

module.exports = async function droppy(opts, isStandalone, dev, callback) {
  if (isStandalone) {
    log.logo(
      [
        blue(pkg.name),
        green(pkg.version),
        "running on",
        blue("node"),
        green(process.version.substring(1))
      ].join(" "),
      [
        blue("config"),
        "at",
        green(paths.config)
      ].join(" "),
      [
        blue("files"),
        "at",
        green(paths.files)
      ].join(" ")
    );
  }
  setupProcess(isStandalone);

  try {
    await promisify((cb) => {
      utils.mkdir([paths.files, paths.config], cb);
    })();

    await promisify((cb) => {
      if (isStandalone) {
        fs.writeFile(paths.pid, String(process.pid), cb);
      } else {
        cb();
      }
    })();

    await promisify((cb) => {
      cfg.init(opts, (err, conf) => {
        if (!err) {
          config = conf;
          if (dev) config.dev = dev;
        }
        cb(err);
      });
    })();

    await promisify((cb) => {
      db.load(() => {
        db.watch(config);
        cb();
      });
    })();

    await promisify((cb) => {
      log.init({logLevel: config.logLevel, timestamps: config.timestamps});
      firstRun = Object.keys(db.get("users")).length === 0;
      // clean up old sessions if no users exist
      if (firstRun) db.set("sessions", {});
      log.info("Configuration: ", utils.pretty(config));
      log.info("Loading resources ...");
      resources.load(config.dev, (err, c) => {
        log.info("Loading resources done");
        cache = c; cb(err);
      });
    })();

    await promisify((cb) => {
      cleanupLinks(cb);
    })();

    await promisify((cb) => {
      if (config.dev) debug(); cb();
    })();

    await promisify((cb) => {
      if (isStandalone) { startListeners(cb); } else cb();
    })();

    await promisify((cb) => {
      log.info("Caching files ...");
      filetree.init(config);
      filetree.updateDir(null).then(() => {
        if (config.watch) filetree.watch();
        log.info("Caching files done");
        cb();
      });
    })();

    await promisify((cb) => {
      if (typeof config.keepAlive === "number" && config.keepAlive > 0) {
        setInterval(() => {
          Object.keys(clients).forEach(client => {
            if (!clients[client].ws) return;
            try {
              clients[client].ws.ping();
            } catch {}
          });
        }, config.keepAlive);
      }
      cb();
    })();
  } catch (err) {
    return callback(err);
  }

  ready = true;
  log.info(green("Ready for requests!"));
  dieOnError = false;
  callback();

  return {onRequest, setupWebSocket};
};

function onRequest(req, res) {
  req.time = Date.now();

  for (const [key, value] of Object.entries(config.headers || {})) {
    res.setHeader(key, value);
  }

  if (ready) {
    if (!utils.isPathSane(req.url, true)) {
      res.statusCode = 400;
      res.end();
      return log.info(req, res, `Invalid GET: ${req.url}`);
    }
    if (req.method === "GET" || req.method === "HEAD") {
      handleGETandHEAD(req, res);
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

async function startListeners(callback) {
  if (!Array.isArray(config.listeners)) {
    return callback(new Error("Config Error: 'listeners' option must be an array"));
  }

  const targets = [];
  config.listeners.forEach((listener, i) => {
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
        return callback(new Error(`Invalid config value: 'host' = ${hosts[host]}`));
      }
    });
    ports.forEach((port, i) => {
      if (typeof port !== "number" && typeof port !== "string") {
        return callback(new Error(`Invalid config value: 'port' = ${port}`));
      }

      if (typeof port === "string") {
        const num = parseInt(port);
        if (Number.isNaN(num)) {
          return callback(new Error(`Invalid config value: 'port' = ${port}`));
        }
        ports[i] = num;
      }
    });
    sockets.forEach(socket => {
      if (typeof socket !== "string") {
        return callback(new Error(`Invalid config value: 'socket' = ${socket}`));
      }

      try {
        fs.unlinkSync(socket);
      } catch (err) {
        if (err.code !== "ENOENT") {
          return callback(
            new Error(`Unable to write to unix socket '${socket}': ${err.code}`)
          );
        }
      }
    });

    const opts = {
      proto: listener.protocol,
      key: listener.key,
      cert: listener.cert,
      index: i,
    };

    // listen on all host + port combinations
    hosts.forEach(host => {
      ports.forEach(port => {
        targets.push({host, port, opts});
      });
    });

    // listen on unix socket
    sockets.forEach(socket => {
      targets.push({socket, opts});
    });
  });

  let listenerCount = 0;

  await Promise.all(targets.map(target => {
    return new Promise(resolve => {
      createListener(onRequest, target.opts, (err, server) => {
        if (err) {
          log.error(
            "Error creating listener",
            `${target.opts.proto + (target.opts.socket ? "+unix://" : "://") +
            log.formatHostPort(target.host, target.port, target.opts.proto)
            }: ${err.message}`
          );
          return resolve();
        }

        server.on("listening", () => {
          server.removeAllListeners("error");
          listenerCount++;
          setupWebSocket(server);
          const proto = target.opts.proto.toLowerCase();

          if (target.socket) { // socket
            fs.chmodSync(target.socket, 0o666); // make it rw
            // a unix socket URL should normally percent-encode the path, but
            // we're printing a path-less URL so pretty-print it with slashes.
            log.info("Listening on ",
              blue(`${proto}+unix://`) +
              cyan(server.address())
            );
          } else { // host + port
            const addr = server.address().address;
            const port = server.address().port;

            const addrs = [];
            if (addr === "::" || addr === "0.0.0.0") {
              const interfaces = os.networkInterfaces();
              Object.keys(interfaces).forEach(name => {
                interfaces[name].forEach(intf => {
                  if (addr === "::" && intf.address) {
                    addrs.push(intf.address);
                  } else if (addr === "0.0.0.0" && intf.family === "IPv4" && intf.address) {
                    addrs.push(intf.address);
                  }
                });
              });
            } else {
              addrs.push(addr);
            }

            if (!addrs.length) {
              addrs.push(addr);
            }

            addrs.sort();

            addrs.forEach(addr => {
              log.info("Listening on ", blue(`${proto}://`) + log.formatHostPort(addr, port, proto));
            });
          }
          resolve();
        });

        server.on("error", err => {
          if (target.host && target.port) {
            // check for other listeners on the same port and surpress misleading errors
            // from being printed because of Node's weird dual-stack behaviour.
            let otherListenerFound = false;
            if (target.host === "::" || target.host === "0.0.0.0") {
              targets.some(t => {
                if (target.port === t.port && target.host !== t.host && target.host) {
                  otherListenerFound = true;
                  return true;
                }
              });
            }

            if (err.code === "EADDRINUSE") {
              if (!otherListenerFound) {
                log.info(
                  red("Failed to listen on "), log.formatHostPort(target.host, target.port),
                  red(". Address already in use.")
                );
              }
            } else if (err.code === "EACCES") {
              log.info(
                red("Failed to listen on "), log.formatHostPort(target.host, target.port),
                red(". Need permission to bind to ports < 1024.")
              );
            } else if (err.code === "EAFNOSUPPORT") {
              if (!otherListenerFound) {
                log.info(
                  red("Failed to listen on "), log.formatHostPort(target.host, target.port),
                  red(". Protocol unsupported. Are you trying to " +
                    "listen on IPv6 while the protocol is disabled?")
                );
              }
            } else if (err.code === "EADDRNOTAVAIL") {
              log.info(
                red("Failed to listen on "), log.formatHostPort(target.host, target.port),
                red(". Address not available.")
              );
            } else log.error(err);
          } else log.error(err);
          return resolve();
        });

        if (target.socket) {
          server.listen(target.socket);
        } else {
          server.listen(target.port, target.host);
        }
      });
    });
  }));

  // Only emit an error if we have at 0 listeners
  return callback(listenerCount === 0 ? new Error("No listeners available") : null);
}

function tlsError(err, socket) {
  // can't get the remote address at this point, just log the error
  if (err && err.message) log.debug(null, null, err.message);
  if (socket.writable) socket.destroy();
}

function createListener(handler, opts, callback) {
  let server;
  if (opts.proto === "http") {
    server = require("http").createServer(handler);
    callback(null, server);
  } else {
    const https = require("https");
    tlsInit(opts, (err, tlsOptions) => {
      if (err) return callback(err);

      try {
        server = https.createServer(tlsOptions);
      } catch (err2) {
        return callback(err2);
      }

      server.on("request", handler);
      server.on("tlsClientError", tlsError);
      callback(null, server);
    });
  }
}

const verifyClient = (info, cb) => {
  if (validateRequest(info.req)) return cb(true);
  log.info(info.req, {statusCode: 401}, "Unauthorized WebSocket connection rejected.");
  cb(false, 401, "Unauthorized");
};

// WebSocket functions
function setupWebSocket(server) {
  let wss;
  if (server !== false) {
    wss = new Wss({server, verifyClient});
  } else {
    wss = new Wss({noServer: true, verifyClient});
  }
  wss.on("connection", onWebSocketRequest);
  wss.on("error", log.error);
  return wss;
}

function onWebSocketRequest(ws, req) {
  ws.addr = ws._socket.remoteAddress;
  ws.port = ws._socket.remotePort;
  ws.headers = Object.assign({}, req.headers);
  log.info(ws, null, "WebSocket [", green("connected"), "]");
  const sid = `${ws._socket.remoteAddress} ${ws._socket.remotePort}`;
  const cookie = cookies.get(req.headers.cookie);
  clients[sid] = {views: [], cookie, ws};

  ws.on("message", async msg => {
    msg = JSON.parse(msg);

    if (msg.type !== "SAVE_FILE") {
      log.debug(ws, null, magenta("RECV "), utils.pretty(msg));
    }

    if (!csrf.validate(msg.token)) {
      ws.close(1011);
      return;
    }

    const vId = msg.vId;
    const priv = Boolean((db.get("sessions")[cookie] || {}).privileged);

    if (msg.type === "REQUEST_SETTINGS") {
      sendObj(sid, {type: "SETTINGS", vId, settings: {
        priv,
        version: pkg.version,
        dev: config.dev,
        public: config.public,
        readOnly: config.readOnly,
        watch: config.watch,
        engine: `node ${process.version.substring(1)}`,
        platform: process.platform,
        caseSensitive: process.platform === "linux", // TODO: actually test the filesystem
        themes: Object.keys(cache.themes).sort().join("|"),
        modes: Object.keys(cache.modes).sort().join("|"),
      }});
    } else if (msg.type === "REQUEST_UPDATE") {
      if (!validatePaths(msg.data, msg.type, ws, sid, vId)) return;
      if (!clients[sid]) clients[sid] = {views: [], ws}; // This can happen when the server restarts
      fs.stat(utils.addFilesPath(msg.data), (err, stats) => {
        let clientDir, clientFile;
        if (err) { // Send client back to root when the requested path doesn't exist
          clientDir = "/";
          clientFile = null;
          log.error(err);
          log.info(ws, null, `Non-existing update request, sending client to / : ${msg.data}`);
        } else if (stats.isFile()) {
          clientDir = path.dirname(msg.data);
          clientFile = path.basename(msg.data);
          sendObj(sid, {type: "UPDATE_BE_FILE", file: clientFile, folder: clientDir, isFile: true, vId});
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
    } else if (msg.type === "RELOAD_DIRECTORY") {
      if (!validatePaths(msg.data.dir, msg.type, ws, sid, vId)) return;
      filetree.updateDir(msg.data.dir).then(() => {
        sendFiles(sid, vId);
      });
    } else if (msg.type === "DESTROY_VIEW") {
      clients[sid].views[vId] = null;
    } else if (msg.type === "REQUEST_SHARELINK") {
      if (!validatePaths(msg.data.location, msg.type, ws, sid, vId)) return;
      const links = db.get("links");

      // Check if we already have a link for that file
      const hadLink = Object.keys(links).some(link => {
        if (msg.data.location === links[link].location && msg.data.attachement === links[link].attachement) {
          const ext = links[link].ext || path.extname(links[link].location);
          sendObj(sid, {
            type: "SHARELINK",
            vId,
            link: (config.linkExtensions && ext) ? (link + ext) : link,
            attachement: msg.data.attachement,
          });
          return true;
        }
      });
      if (hadLink) return;

      const link = utils.getLink(links, config.linkLength);
      const ext = path.extname(msg.data.location);
      log.info(ws, null, `Share link created: ${link} -> ${msg.data.location}`);

      links[link] = {
        location: msg.data.location,
        attachement: msg.data.attachement,
        ext,
      };
      db.set("links", links);
      sendObj(sid, {
        type: "SHARELINK",
        vId,
        link: config.linkExtensions ? (link + ext) : link,
        attachement: msg.data.attachement
      });
    } else if (msg.type === "DELETE_FILE") {
      log.info(ws, null, `Deleting: ${msg.data}`);
      if (config.readOnly) return sendError(sid, vId, "Files are read-only");
      if (!validatePaths(msg.data, msg.type, ws, sid, vId)) return;
      filetree.del(msg.data);
    } else if (msg.type === "SAVE_FILE") {
      log.info(ws, null, `Saving: ${msg.data.to}`);
      if (config.readOnly) return sendError(sid, vId, "Files are read-only");
      if (!validatePaths(msg.data.to, msg.type, ws, sid, vId)) return;
      filetree.save(msg.data.to, msg.data.value, err => {
        if (err) {
          sendError(sid, vId, `Error saving: ${err.message}`);
          log.error(err);
        } else sendObj(sid, {type: "SAVE_STATUS", vId, status: err ? 1 : 0});
      });
    } else if (msg.type === "CLIPBOARD") {
      const src = msg.data.src;
      const dst = msg.data.dst;
      const type = msg.data.type;
      log.info(ws, null, `Clipboard ${type}: ${src} -> ${dst}`);
      if (config.readOnly) return sendError(sid, vId, "Files are read-only");
      if (!validatePaths([src, dst], msg.type, ws, sid, vId)) return;
      if (new RegExp(`^${escRe(msg.data.src)}/`).test(msg.data.dst)) {
        return sendError(sid, vId, "Can't copy directory into itself");
      }

      fs.stat(utils.addFilesPath(msg.data.dst), async (err, stats) => {
        if (!err && stats || msg.data.src === msg.data.dst) {
          utils.getNewPath(utils.addFilesPath(msg.data.dst), newDst => {
            filetree.clipboard(msg.data.src, utils.removeFilesPath(newDst), msg.data.type);
          });
        } else {
          filetree.clipboard(msg.data.src, msg.data.dst, msg.data.type);
        }
      });
    } else if (msg.type === "CREATE_FOLDER") {
      if (config.readOnly) return sendError(sid, vId, "Files are read-only");
      if (!validatePaths(msg.data, msg.type, ws, sid, vId)) return;
      filetree.mkdir(msg.data, err => {
        if (err) sendError(sid, vId, `Error creating folder: ${err.message}`);
      });
    } else if (msg.type === "CREATE_FILE") {
      if (config.readOnly) return sendError(sid, vId, "Files are read-only");
      if (!validatePaths(msg.data, msg.type, ws, sid, vId)) return;
      filetree.mk(msg.data, err => {
        if (err) sendError(sid, vId, `Error creating file: ${err.message}`);
      });
    } else if (msg.type === "RENAME") {
      if (config.readOnly) return sendError(sid, vId, "Files are read-only");
      const rSrc = msg.data.src;
      const rDst = msg.data.dst;
      // Disallow whitespace-only and empty strings in renames
      if (!validatePaths([rSrc, rDst], msg.type, ws, sid, vId) ||
          /^\s*$/.test(rDst) || rDst === "" || rSrc === rDst) {
        log.info(ws, null, `Invalid rename request: ${rSrc}-> ${rDst}`);
        sendError(sid, vId, "Invalid rename request");
        return;
      }
      filetree.move(rSrc, rDst);

      // update sharelinks to new destination
      const links = db.get("links");
      for (const link of Object.keys(links)) {
        if (links[link].location === rSrc) {
          links[link].location = rDst;
          log.info(ws, null, `Share link updated: ${link} -> ${rDst}`);
        }
      }
      db.set("links", links);
    } else if (msg.type === "GET_USERS") {
      if (priv && !config.public) sendUsers(sid);
    } else if (msg.type === "UPDATE_USER") {
      const name = msg.data.name;
      const pass = msg.data.pass;
      if (!priv) return;
      if (pass === "") {
        if (!db.get("users")[name]) return;
        if ((db.get("sessions")[cookie] || {}).username === name) {
          return sendError(sid, null, "Cannot delete yourself");
        }
        if (db.delUser(name)) log.info(ws, null, "Deleted user: ", magenta(name));
      } else {
        const isNew = !db.get("users")[name];
        db.addOrUpdateUser(name, pass, msg.data.priv || false);
        log.info(ws, null, `${isNew ? "Added" : "Updated"} user: `, magenta(name));
      }
      sendUsers(sid);
    } else if (msg.type === "CREATE_FILES") {
      if (config.readOnly) return sendError(sid, vId, "Files are read-only");
      if (!validatePaths(msg.data.files, msg.type, ws, sid, vId)) return;

      await Promise.all(msg.data.files.map(file => {
        return new Promise(resolve => {
          filetree.mkdir(utils.addFilesPath(path.dirname(file)), (err) => {
            if (err) log.error(ws, null, err);
            filetree.mk(utils.addFilesPath(file), (err) => {
              if (err) log.error(ws, null, err);
              resolve();
            });
          });
        });
      }));
    } else if (msg.type === "CREATE_FOLDERS") {
      if (config.readOnly) return sendError(sid, vId, "Files are read-only");
      if (!validatePaths(msg.data.folders, msg.type, ws, sid, vId)) return;

      await Promise.all(msg.data.folders.map(folder => {
        return new Promise(resolve => {
          filetree.mkdir(utils.addFilesPath(folder), (err) => {
            if (err) log.error(ws, null, err);
            resolve();
          });
        });
      }));
    } else if (msg.type === "GET_MEDIA") {
      const dir = msg.data.dir;
      const exts = msg.data.exts;
      if (!validatePaths(dir, msg.type, ws, sid, vId)) return;
      const allExts = exts.img.concat(exts.vid).concat(exts.pdf);
      const files = filetree.lsFilter(dir, utils.extensionRe(allExts));
      if (!files) return sendError(sid, vId, "No displayable files in directory");

      const mediaFiles = await Promise.all(files.map(file => {
        return new Promise(resolve => {
          if (utils.extensionRe(exts.pdf).test(file)) {
            resolve({pdf: true, src: file});
          } else if (utils.extensionRe(exts.img).test(file)) {
            imgSize(path.join(utils.addFilesPath(dir), file), (err, dims) => {
              if (err) log.error(err);
              resolve({
                src: file,
                w: dims && dims.width ? dims.width : 0,
                h: dims && dims.height ? dims.height : 0,
              });
            });
          } else {
            resolve({video: true, src: file});
          }
        });
      }));
      sendObj(sid, {type: "MEDIA_FILES", vId, files: mediaFiles});
    } else if (msg.type === "SEARCH") {
      const query = msg.data.query;
      const dir =  msg.data.dir;
      if (!validatePaths(dir, msg.type, ws, sid, vId)) return;
      sendObj(sid, {
        type: "SEARCH_RESULTS",
        vId,
        folder: dir,
        results: filetree.search(query, dir)
      });
    }
  });

  ws.on("close", code => {
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
      log.info(ws, null, "WebSocket [", red("disconnected"), "] ", "(CSFR prevented or server restarted)");
    } else {
      log.info(ws, null, "WebSocket [", red("disconnected"), "] ", reason || `(Code: ${code || "none"})`);
    }
  });
  ws.on("error", log.error);
}

// Ensure that a given path does not contain invalid file names
function validatePaths(paths, type, ws, sid, vId) {
  return (Array.isArray(paths) ? paths : [paths]).every(p => {
    if (!utils.isPathSane(p)) {
      sendError(sid, vId, "Invalid request");
      log.info(ws, null, `Invalid ${type} request: ${p}`);
      return false;
    } else {
      return true;
    }
  });
}

// Send a file list update
function sendFiles(sid, vId) {
  if (!clients[sid] || !clients[sid].views[vId] || !clients[sid].ws || !clients[sid].ws._socket) return;
  const folder = clients[sid].views[vId].directory;
  sendObj(sid, {
    type: "UPDATE_DIRECTORY",
    vId, folder,
    data: filetree.ls(folder)
  });
}

// Send a list of users on the server
function sendUsers(sid) {
  const userDB = db.get("users");
  const userlist = {};

  Object.keys(userDB).forEach(user => {
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
  Object.keys(clients).forEach(sid => {
    send(clients[sid].ws, JSON.stringify(data));
  });
}

function sendError(sid, vId, text) {
  text = utils.sanitizePathsInString(text);
  sendObj(sid, {type: "ERROR", vId, text});
  log.error(clients[sid].ws, null, `Sent error: ${text}`);
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
        log.debug(ws, null, green("SEND "), utils.pretty(debugData));
      }
      ws.send(data, err => {
        if (err) log.err(err);
      });
    } else {
      setTimeout(queue, 50, ws, data, time + 50);
    }
  })(ws, data, 0);
}

function handleGETandHEAD(req, res) {
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

  if (/^\/!\/dl\/[\s\S]+/.test(URI) || /^\/\$\/[\s\S]+$/.test(URI)) {
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
    log.info(req, res);
  } else if (/^\/!\/type\/[\s\S]+/.test(URI)) {
    handleTypeRequest(req, res, utils.addFilesPath(URI.substring(7)));
  } else if (/^\/!\/file\/[\s\S]+/.test(URI)) {
    handleFileRequest(req, res, false);
  } else if (/^\/!\/zip\/[\s\S]+/.test(URI)) {
    const zipPath = utils.addFilesPath(URI.substring(6));
    fs.stat(zipPath, (err, stats) => {
      if (!err && stats.isDirectory()) {
        streamArchive(req, res, zipPath, true, stats, false);
      } else {
        if (err) log.error(err);
        res.statusCode = 404;
        res.end();
        log.info(req, res);
      }
    });
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
    if (rateLimited.includes(ip)) {
      res.statusCode = 429;
      res.end();
      return;
    } else {
      rateLimited.push(ip);
      setTimeout(() => {
        rateLimited.some((rIp, i) => {
          if (rIp === ip) return rateLimited.splice(i, 1);
        });
      }, 2000);
    }

    utils.readJsonBody(req).then(postData => {
      if (db.authUser(postData.username, postData.password)) {
        cookies.create(req, res, postData);
        res.statusCode = 200;
        res.end();
        log.info(req, res, "User ", "'", postData.username, "'", green(" authenticated"));
      } else {
        res.statusCode = 401;
        res.end();
        log.info(req, res, "User ", "'", postData.username, "'", red(" unauthorized"));
      }
    }).catch(err => {
      log.error(err);
      res.statusCode = 400;
      res.end();
      log.info(req, res);
    });
    return;
  } else if (firstRun && /^\/!\/adduser/.test(URI)) {
    res.setHeader("Content-Type", "text/plain");
    utils.readJsonBody(req).then(postData => {
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
    }).catch(() => {
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
    utils.readJsonBody(req).then(postData => {
      cookies.unset(req, res, postData);
      res.statusCode = 200;
      res.end();
      log.info(req, res);
    }).catch(err => {
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
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:",
        "style-src 'self' 'unsafe-inline' blob: data:",
        "media-src 'self' blob: data:",
        "font-src 'self' blob: data:",
        "worker-src 'self' blob: data:",
        "frame-src 'self' blob: data:",
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
    const encodings = (req.headers["accept-encoding"] || "").split(",").map(e => {
      return e.trim().toLowerCase();
    }).filter(e => {
      return Boolean(e);
    });
    if (encodings.includes("br") && resource.brotli) {
      headers["Content-Encoding"] = "br";
      headers["Content-Length"] = resource.brotli.length;
      data = resource.brotli;
    } else if (encodings.includes("gzip") && resource.gzip) {
      headers["Content-Encoding"] = "gzip";
      headers["Content-Length"] = resource.gzip.length;
      data = resource.gzip;
    } else {
      headers["Content-Length"] = resource.data.length;
      data = resource.data;
    }
  }
  res.writeHead(status, headers);
  res.end(req.method === "GET" ? data : undefined);
  log.info(req, res);
}

function handleFileRequest(req, res, download) {
  const URI = decodeURIComponent(req.url);
  let shareLink, filepath;

  let parts = /^\/\$\/([a-z0-9]+)\.?([a-z0-9.]+)?$/i.exec(URI);
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
    filepath = utils.addFilesPath(`/${[parts[2]]}`);
  }

  fs.stat(filepath, (error, stats) => {
    if (!error && stats) {
      if (stats.isDirectory() && shareLink) {
        streamArchive(req, res, filepath, download, stats, shareLink);
      } else {
        streamFile(req, res, filepath, download, stats, shareLink);
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

async function handleTypeRequest(req, res, file) {
  let isBinary;
  try {
    isBinary = await utils.isBinary(file);
  } catch (err) {
    res.statusCode = 500;
    res.end();
    log.error(err);
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(isBinary ? "binary" : "text");
  log.info(req, res);
}

function handleUploadRequest(req, res) {
  let done = false;

  if (config.readOnly) {
    res.statusCode = 403;
    res.end();
    log.info(req, res, "Upload cancelled because of read-only mode");
    return;
  }

  if (req.setTimeout) req.setTimeout(config.uploadTimeout);
  if (req.connection.setTimeout) req.connection.setTimeout(config.uploadTimeout);
  if (res.setTimeout) res.setTimeout(config.uploadTimeout);

  req.query = qs.parse(req.url.substring("/!/upload?".length));
  const vId = req.query.vId;

  if (!req.query || !req.query.to) {
    res.statusCode = 500;
    res.end();
    log.info(req, res, "Invalid upload request");
    return;
  }

  Object.keys(clients).some(sid => {
    if (clients[sid].cookie === cookies.get(req.headers.cookie)) {
      req.sid = sid;
      return true;
    }
  });

  const dstDir = decodeURIComponent(req.query.to) || clients[req.sid].views[vId].directory;
  let numFiles = 0;

  log.info(req, res, "Upload started");

  const opts = {
    preservePath: true,
    headers: req.headers,
    fileHwm: 1024 * 1024,
    limits: {fieldNameSize: 255, fieldSize: 10 * 1024 * 1024}
  };
  if (config.maxFileSize > 0) opts.limits.fileSize = config.maxFileSize;

  const busboy = new Busboy(opts);
  const rootNames = new Set();

  busboy.on("error", err => {
    log.error(err);
  });

  const onWriteError = err => {
    log.error(req, res, err);
    sendError(req.sid, vId, `Error writing the file: ${err.message}`);
    closeConnection(400);
  };

  busboy.on("file", (_, file, filePath) => {
    if (!utils.isPathSane(filePath) || !utils.isPathSane(dstDir)) return;
    numFiles++;

    file.on("limit", () => {
      log.info(req, res, "Maximum file size reached, cancelling upload");
      sendError(
        req.sid, vId,
        `Maximum upload size of ${utils.formatBytes(config.maxFileSize)} exceeded.`
      );
      closeConnection(400);
    });

    // store temp names in rootNames for later rename
    const tmpPath = utils.addUploadTempExt(filePath);
    rootNames.add(utils.rootname(tmpPath));

    const dst = path.join(paths.files, dstDir, tmpPath);
    utils.mkdir(path.dirname(dst), () => {
      fs.stat(dst, err => {
        if (err && err.code === "ENOENT") {
          const ws = fs.createWriteStream(dst, {mode: "644"});
          ws.on("error", onWriteError);
          file.pipe(ws);
        } else if (!err) {
          if (req.query.rename === "1") {
            utils.getNewPath(dst, newDst => {
              const ws = fs.createWriteStream(newDst, {mode: "644"});
              ws.on("error", onWriteError);
              file.pipe(ws);
            });
          } else {
            const ws = fs.createWriteStream(dst, {mode: "644"});
            ws.on("error", onWriteError);
            file.pipe(ws);
          }
        } else {
          onWriteError(err);
        }
      });
    });
  });

  busboy.on("finish", async () => {
    log.info(req, res, `Received ${numFiles} files`);
    done = true;

    // move temp files into place
    await Promise.all([...rootNames].map(async p => {
      const srcPath = path.join(paths.files, dstDir, p);
      const dstPath = path.join(paths.files, dstDir, utils.removeUploadTempExt(p));
      await promisify(utils.move)(srcPath, dstPath);
    }));

    filetree.updateDir(dstDir);
    closeConnection();
  });

  req.on("close", async () => {
    if (!done) {
      log.info(req, res, "Upload cancelled");

      // remove all uploaded temp files on cancel
      await Promise.all([...rootNames].map(async p => {
        await promisify(utils.rm)(path.join(paths.files, dstDir, p));
      }));

      filetree.updateDir(dstDir);
      closeConnection();
    }
  });

  req.pipe(busboy);

  function closeConnection(status) {
    if (res.finished) return;
    res.statusCode = status || 200;
    res.setHeader("Connection", "close");
    res.end();
  }
}

filetree.on("updateall", () => {
  Object.keys(clientsPerDir).forEach(dir => {
    clientsPerDir[dir].forEach(client => {
      client.update();
    });
  });
});

filetree.on("update", dir => {
  while (true) {
    if (clientsPerDir[dir]) {
      clientsPerDir[dir].forEach(client => {
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
    sid, vId,
    update: throttle(function() {
      sendFiles(this.sid, this.vId);
    }, config.updateInterval, {leading: true, trailing: true})
  });
}

function removeClientPerDir(sid, vId) {
  Object.keys(clientsPerDir).forEach(dir => {
    const removeAt = [];
    clientsPerDir[dir].forEach((client, i) => {
      if (client.sid === sid && (typeof vId === "number" ? client.vId === vId : true)) {
        removeAt.push(i);
      }
    });
    removeAt.reverse().forEach(pos => {
      clientsPerDir[dir].splice(pos, 1);
    });

    // purge dirs with no clients
    if (!clientsPerDir[dir].length) delete clientsPerDir[dir];
  });
}

function debug() {
  require("chokidar").watch(paths.client, {
    alwaysStat: true,
    ignoreInitial: true
  }).on("change", file => {
    setTimeout(async () => { // prevent EBUSY on win32
      if (/\.css$/.test(file)) {
        cache.res["style.css"] = await resources.compileCSS();
        sendObjAll({
          type: "RELOAD",
          css: String(cache.res["style.css"].data).replace('"sprites.png"', '"!/res/sprites.png"')
        });
      } else if (/\.(js|hbs)$/.test(file)) {
        cache.res["client.js"] = await resources.compileJS();
        sendObjAll({type: "RELOAD"});
      } else if (/\.(html|svg)$/.test(file)) {
        await resources.compileHTML(cache.res);
        sendObjAll({type: "RELOAD"});
      }
    }, 100);
  });
}

// Clean up sharelinks by removing links to nonexistant files
function cleanupLinks(callback) {
  let linkcount = 0, cbcount = 0;
  const links = db.get("links");
  if (Object.keys(links).length === 0) {
    callback();
  } else {
    Object.keys(links).forEach(link => {
      linkcount++;
      (function(shareLink, location) {
        // check for links not matching the configured length
        if (shareLink.length !== config.linkLength) {
          log.debug(`deleting link not matching the configured length: ${shareLink}`);
          delete links[shareLink];
          if (++cbcount === linkcount) {
            db.set("links", links);
            callback();
          }
          return;
        }
        // check for links where the target does not exist anymore
        fs.stat(path.join(paths.files, location), (error, stats) => {
          if (!stats || error) {
            log.debug(`deleting nonexistant link: ${shareLink}`);
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

// verify a resource etag, returns the etag if it doesn't match, otherwise
// returns null indicating the response is handled with a 304
function checkETag(req, res, path, mtime) {
  const eTag = etag(`${path}/${mtime}`);
  if ((req.headers["if-none-match"] || "") === eTag) {
    res.statusCode = 304;
    res.end();
    log.info(req, res);
    return null;
  }
  return eTag;
}

// Create a zip file from a directory and stream it to a client
function streamArchive(req, res, zipPath, download, stats, shareLink) {
  const eTag = checkETag(req, res, zipPath, stats.mtime);
  if (!eTag) return;
  const zip = new yazl.ZipFile();
  const relPath = utils.removeFilesPath(zipPath);
  log.info(req, res);
  log.info(req, res, "Streaming zip of ", blue(relPath));
  res.statusCode = 200;
  res.setHeader("Content-Type", utils.contentType(zip));
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Content-Disposition", utils.getDispo(`${zipPath}.zip`, download));
  res.setHeader("Cache-Control", `${shareLink ? "public" : "private"}, max-age=0`);
  res.setHeader("ETag", eTag);

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  rrdir.async(zipPath, {stats: true}).then(entries => {
    for (const entry of entries) {
      const pathInZip = path.relative(zipPath, entry.path);
      const metaData = {
        mtime: (entry.stats && entry.stats.mtime) ? entry.stats.mtime : new Date(),
        mode: (entry.stats && entry.stats.mode) ? entry.stats.mode : 0o666,
      };

      if (entry.directory) {
        zip.addEmptyDirectory(pathInZip, metaData);
      } else {
        zip.addFile(entry.path, pathInZip, metaData);
      }
    }

    zip.outputStream.pipe(res);
    zip.end();
  }).catch(err => {
    log.error(req, res, err);
    res.statusCode = 500;
    res.end();
  });
}

function streamFile(req, res, filepath, download, stats, shareLink) {
  const eTag = checkETag(req, res, filepath, stats.mtime);
  if (!eTag) return;

  function setHeaders(res) {
    res.setHeader("Content-Type", utils.contentType(filepath));
    res.setHeader("Cache-Control", `${shareLink ? "public" : "private"}, max-age=0`);
    res.setHeader("Content-Disposition", utils.getDispo(filepath, download));
    res.setHeader("ETag", eTag);
  }

  if (req.method === "HEAD") {
    setHeaders(res);
    res.end();
    return;
  }

  // send expects a url-encoded argument
  sendFile(req, encodeURIComponent(utils.removeFilesPath(filepath).substring(1)), {
    root: paths.files,
    dotfiles: "allow",
    index: false,
    etag: false,
    cacheControl: false,
  }).on("headers", res => {
    setHeaders(res);
  }).on("error", err => {
    log.error(err);
    if (err.status === 416) {
      log.error("requested range:", req.headers.range);
      log.error("file size:", stats.size);
    }
    res.statusCode = typeof err.status === "number" ? err.status : 400;
    res.end();
  }).on("stream", () => {
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
    tlsSetup(opts, (err, tlsData) => {
      cbs[opts.index].forEach(cb => {
        cb(err, tlsData);
      });
    });
  } else cbs[opts.index].push(cb);
}

async function tlsSetup(opts, cb) {
  if (typeof opts.key !== "string") {
    return cb(new Error("Missing TLS option 'key'"));
  }
  if (typeof opts.cert !== "string") {
    return cb(new Error("Missing TLS option 'cert'"));
  }

  const cert = await readFile(path.resolve(paths.config, ut(opts.cert)), "utf8");
  const key = await readFile(path.resolve(paths.config, ut(opts.key)), "utf8");

  cb(null, {cert, key});
}

function cleanupSessions() {
  if (!ready) return;
  // Clean inactive sessions after 1 month of inactivity
  const sessions = db.get("sessions");
  Object.keys(sessions).forEach(session => {
    if (!sessions[session].lastSeen || (Date.now() - sessions[session].lastSeen >= 2678400000)) {
      delete sessions[session];
    }
  });
  db.set("sessions", sessions);
}

setTimeout(() => setInterval(cleanupSessions, 3600 * 1000), 60 * 1000);

// Process startup
function setupProcess(standalone) {
  if (standalone) {
    process.on("SIGINT", endProcess.bind(null, "SIGINT"));
    process.on("SIGQUIT", endProcess.bind(null, "SIGQUIT"));
    process.on("SIGTERM", endProcess.bind(null, "SIGTERM"));
    process.on("unhandledRejection", error => {
      log.error(error);
      if (dieOnError) process.exit(1);
    });
    process.on("uncaughtException", error => {
      log.error(error);
      if (dieOnError) process.exit(1);
    });
  }
}

// Process shutdown
function endProcess(signal) {
  let count = 0;
  log.info(`Received ${red(signal)} - Shutting down ...`);
  Object.keys(clients).forEach(sid => {
    if (!clients[sid] || !clients[sid].ws) return;
    if (clients[sid].ws.readyState < 2) {
      count++;
      clients[sid].ws.close(1001);
    }
  });
  if (count > 0) log.info(`Closed ${count} WebSocket${count > 1 ? "s" : ""}`);
  try { fs.unlinkSync(paths.pid); } catch {}
  process.exit(0);
}
