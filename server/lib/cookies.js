"use strict";

var cookies = {},
    db      = require("./db.js"),
    utils   = require("./utils.js");

cookies.get = function get(cookie) {
    var entries = {};
    if (Array.isArray(cookie) && cookie.length) {
        cookie.forEach(function (c) {
            entries[c.name] = c.value;
        });
        return cookies.validate(entries);
    } else if (typeof cookie === "string" && cookie.length) {
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
    var found, sessions = db.get("sessions");
    Object.keys(sessions).some(function(session) {
        if (session === entries.s) {
            sessions[session].lastSeen = Date.now();
            db.set("sessions", sessions);
            found = session;
            return true;
        }
    });
    return found;
};

cookies.free = function free(req, res) {
    var sessions  = db.get("sessions"),
        sessionID = utils.getSid();

    res.setHeader("Set-Cookie", "s=" + sessionID + ";expires=" + new Date(Date.now() + 31536000000).toUTCString() + ";path=/");
    sessions[sessionID] = {privileged : true, lastSeen : Date.now()};
    db.set("sessions", sessions);
};

cookies.create = function create(req, res, postData) {
    var sessions  = db.get("sessions"),
        sessionID = utils.getSid();

    if (postData.remember) // semi-permanent cookie
        res.setHeader("Set-Cookie", "s=" + sessionID + ";expires=" + new Date(Date.now() + 31536000000).toUTCString() + ";path=/");
    else // single-session cookie
        res.setHeader("Set-Cookie", "s=" + sessionID + ";path=/");

    sessions[sessionID] = {privileged : db.get("users")[postData.username].privileged, lastSeen : Date.now()};
    db.set("sessions", sessions);
};

module.exports = cookies;
