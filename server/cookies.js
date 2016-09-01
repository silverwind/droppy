"use strict";

var cookies = module.exports = {};
var db      = require("./db.js");
var utils   = require("./utils.js");

var cookieParams = ["HttpOnly", "SameSite=strict", "path=/"];

cookies.parse = function parse(cookie) {
  var entries = {};
  if (typeof cookie === "string" && cookie.length) {
    cookie.split("; ").forEach(function(entry) {
      var parts = entry.trim().split("=");
      entries[parts[0]] = parts[1];
    });
  }
  return entries;
}

cookies.get = function get(cookie) {
  var entries = cookies.parse(cookie);
  if (!entries || !entries.s) return false;
  if (Object.keys(db.get("sessions") || {}).indexOf(entries.s) === -1) return false;
  return entries.s;
};

cookies.free = function free(_req, res) {
  var sessions = db.get("sessions"), sessionID = utils.getSid();
  res.setHeader("Set-Cookie", cookieString({s: sessionID, expires: inOneYear()}));
  sessions[sessionID] = {
    privileged : true,
    lastSeen : Date.now()
  };
  db.set("sessions", sessions);
};

cookies.create = function create(_req, res, postData) {
  var sessions = db.get("sessions"), sessionID = utils.getSid();
  if (postData.remember) { // semi-permanent cookie
    res.setHeader("Set-Cookie", cookieString({s: sessionID, expires: inOneYear()}));
  } else { // single-session cookie
    res.setHeader("Set-Cookie", cookieString({s: sessionID}));
  }
  sessions[sessionID] = {
    privileged : db.get("users")[postData.username].privileged,
    lastSeen : Date.now()
  };
  db.set("sessions", sessions);
};

cookies.unset = function unset(req, res) {
  if (!req.headers.cookie) return;
  var session = cookies.parse(req.headers.cookie).s;
  if (!session) return;
  var sessions = db.get("sessions");
  delete sessions[session];
  db.set("sessions", sessions);
  res.setHeader("Set-Cookie", cookieString({s: "gone", expires: epoch()}));
}

function inOneYear() {
  return new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
}

function epoch() {
  return new Date(0).toUTCString();
}

function cookieString(params) {
  return Object.keys(params).map(function(param) {
    return param + "=" + params[param];
  }).concat(cookieParams).join("; ");
}
