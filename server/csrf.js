"use strict";

var csrf   = module.exports = {};
var crypto = require("crypto");
var store  = [];

csrf.get = function(req) {
  var index, token, ip = getIp(req);
  store.some(function(pair, i) {
    if (pair[0] === ip) {
      index = i;
      return true;
    }
  });
  token = getToken();
  if (typeof index === "number") {
    store[index][1] = token;
  } else {
    store.unshift([ip, token]);
  }
  store = store.slice(0, 500);
  return token;
};

csrf.validate = function validate(token) {
  return store.some(function(pair) {
    return pair[1] === token;
  });
};

function getToken() {
  return crypto.randomBytes(16).toString("hex");
}

function getIp(req) {
  return req.headers && req.headers["x-forwarded-for"] ||
    req.headers && req.headers["x-real-ip"] ||
    req.upgradeReq && req.upgradeReq.headers && req.upgradeReq.headers["x-forwarded-for"] ||
    req.upgradeReq && req.upgradeReq.headers && req.upgradeReq.headers["x-real-ip"] ||
    req._socket && req._socket.remoteAddress && req._socket.remoteAddress ||
    req.connection && req.connection.remoteAddress ||
    req.connection && req.connection.socket && req.connection.socket.remoteAddress;
}
