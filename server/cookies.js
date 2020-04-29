"use strict";

const cookies = module.exports = {};
const db = require("./db.js");
const utils = require("./utils.js");

// TODO: set secure flag on cookie. Requires X-Forwarded-Proto from the proxy
const cookieParams = ["HttpOnly", "SameSite=strict"];

cookies.parse = function(cookie) {
  const entries = {};
  if (typeof cookie === "string" && cookie.length) {
    cookie.split("; ").forEach(entry => {
      const parts = entry.trim().split("=");
      entries[parts[0]] = parts[1];
    });
  }
  return entries;
};

cookies.get = function(cookie) {
  const entries = cookies.parse(cookie);
  if (!entries || !entries.s) return false;
  const sessions = Object.keys(db.get("sessions") || {});
  if (!sessions.includes(entries.s)) return false;
  return entries.s;
};

cookies.free = function(_req, res, _postData) {
  const sessions = db.get("sessions");
  const sid = utils.createSid();
  // TODO: obtain path
  res.setHeader("Set-Cookie", cookieHeaders(sid, "/", inOneYear()));
  sessions[sid] = {
    privileged: true,
    lastSeen: Date.now(),
  };
  db.set("sessions", sessions);
};

cookies.create = function(_req, res, postData) {
  const sessions = db.get("sessions");
  const sid = utils.createSid();
  const expires = postData.remember ? inOneYear() : null;
  res.setHeader("Set-Cookie", cookieHeaders(sid, postData.path, expires));
  sessions[sid] = {
    privileged: db.get("users")[postData.username].privileged,
    username: postData.username,
    lastSeen: Date.now(),
  };
  db.set("sessions", sessions);
};

cookies.unset = function(req, res, postData) {
  if (!req.headers.cookie) return;
  const session = cookies.parse(req.headers.cookie).s;
  if (!session) return;
  const sessions = db.get("sessions");
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
  const realCookie = {s: sid, path: path || "/"};
  const deleteCookie = {s: "gone", expires: epoch(), path: "/"};
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
  return Object.keys(params).map(param => {
    return `${param}=${params[param]}`;
  }).concat(cookieParams).join("; ");
}
