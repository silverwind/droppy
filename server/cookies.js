"use strict";

var cookies = {};
var db      = require("./db.js");
var utils   = require("./utils.js");

cookies.get = function get(cookie) {
  var entries = {};
  if (typeof cookie === "string" && cookie.length) {
    cookie.split("; ").forEach(function (entry) {
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

cookies.free = function free(req, res) {
  var sessions = db.get("sessions"), sessionID = utils.getSid();
  res.setHeader("Set-Cookie", "s=" + sessionID + ";expires=" + new Date(Date.now() + 31536000000).toUTCString() + ";path=/");
  sessions[sessionID] = {privileged : true, lastSeen : Date.now()};
  db.set("sessions", sessions);
};

cookies.create = function create(req, res, postData) {
  var sessions = db.get("sessions"), sessionID = utils.getSid();
  if (postData.remember) // semi-permanent cookie
    res.setHeader("Set-Cookie", "s=" + sessionID + ";expires=" + new Date(Date.now() + 31536000000).toUTCString() + ";path=/");
  else // single-session cookie
    res.setHeader("Set-Cookie", "s=" + sessionID + ";path=/");
  sessions[sessionID] = {privileged : db.get("users")[postData.username].privileged, lastSeen : Date.now()};
  db.set("sessions", sessions);
};

module.exports = cookies;
