"use strict";

var cookies = module.exports = {};
var db      = require("./db.js");
var utils   = require("./utils.js");

var cookieParams = ["HttpOnly", "SameSite=strict", "path=/"];

cookies.get = function get(cookie) {
  var entries = {};
  if (typeof cookie === "string" && cookie.length) {
    cookie.split("; ").forEach(function(entry) {
      var parts = entry.trim().split("=");
      entries[parts[0]] = parts[1];
    });
    return cookies.validate(entries);
  } else {
    return false;
  }
};

cookies.validate = function validate(entries) {
  if (!entries || !entries.s) return false;
  if (Object.keys(db.get("sessions") || {}).indexOf(entries.s) === -1) return false;
  return entries.s;
};

cookies.free = function free(_req, res) {
  var sessions = db.get("sessions"), sessionID = utils.getSid();
  res.setHeader("Set-Cookie", [
    "s=" + sessionID,
    "expires=" + inOneMonth(),
  ].concat(cookieParams).join("; "));
  sessions[sessionID] = {
    privileged : true,
    lastSeen : Date.now()
  };
  db.set("sessions", sessions);
};

cookies.create = function create(_req, res, postData) {
  var sessions = db.get("sessions"), sessionID = utils.getSid();
  if (postData.remember) { // semi-permanent cookie
    res.setHeader("Set-Cookie", [
      "s=" + sessionID,
      "expires=" + inOneMonth(),
    ].concat(cookieParams).join("; "));
  } else { // single-session cookie
    res.setHeader("Set-Cookie", [
      "s=" + sessionID,
    ].concat(cookieParams).join("; "));
  }
  sessions[sessionID] = {
    privileged : db.get("users")[postData.username].privileged,
    lastSeen : Date.now()
  };
  db.set("sessions", sessions);
};

function inOneMonth() {
  return new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
}
