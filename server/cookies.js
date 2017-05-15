"use strict";

var cookies = module.exports = {};
var db      = require("./db.js");
var utils   = require("./utils.js");

// TODO: set secure flag on cookie. Requires X-Forwarded-Proto from the proxy
var cookieParams = ["HttpOnly", "SameSite=strict"];

cookies.parse = function parse(cookie) {
  var entries = {};
  if (typeof cookie === "string" && cookie.length) {
    cookie.split("; ").forEach(function(entry) {
      var parts = entry.trim().split("=");
      entries[parts[0]] = parts[1];
    });
  }
  return entries;
};

cookies.get = function get(cookie) {
  var entries = cookies.parse(cookie);
  if (!entries || !entries.s) return false;
  if (Object.keys(db.get("sessions") || {}).indexOf(entries.s) === -1) return false;
  return entries.s;
};

cookies.free = function free(_req, res, _postData) {
  var sessions = db.get("sessions"), sid = utils.createSid();
  // TODO: obtain path
  res.setHeader("Set-Cookie", cookieHeaders(sid, "/", inOneYear()));
  sessions[sid] = {
    privileged: true,
    lastSeen: Date.now(),
  };
  db.set("sessions", sessions);
};

cookies.create = function create(_req, res, postData) {
  var sessions = db.get("sessions"), sid = utils.createSid();
  var expires = postData.remember ? inOneYear() : null;
  var headers = cookieHeaders(sid, postData.path, expires);
  res.setHeader("Set-Cookie", headers);
  sessions[sid] = {
    privileged: db.get("users")[postData.username].privileged,
    username: postData.username,
    lastSeen: Date.now(),
  };
  db.set("sessions", sessions);
};

cookies.unset = function unset(req, res, postData) {
  if (!req.headers.cookie) return;
  var session = cookies.parse(req.headers.cookie).s;
  if (!session) return;
  var sessions = db.get("sessions");
  delete sessions[session];
  db.set("sessions", sessions);
  res.setHeader("Set-Cookie", cookieHeaders("gone", postData.path, epoch()));
};

function inOneYear() {
  return new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
}

function epoch() {
  return new Date(0).toUTCString();
}

function cookieHeaders(sid, path, expires) {
  var realCookie = {s: sid, path: path || "/"};
  var deleteCookie = {s: "gone", expires: epoch(), path: "/"};
  if (path === "/" || !path) {
    if (expires) realCookie.expires = inOneYear();
    return cookieString(realCookie);
  } else {
    // expire a possible invalid old cookie on the / path
    if (expires) realCookie.expires = inOneYear();
    return [cookieString(deleteCookie), cookieString(realCookie)];
  }
}

function cookieString(params) {
  return Object.keys(params).map(function(param) {
    return param + "=" + params[param];
  }).concat(cookieParams).join("; ");
}
