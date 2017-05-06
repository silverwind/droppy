"use strict";

var csrf   = module.exports = {};
var crypto = require("crypto");
var tokens = [];

csrf.create = function() {
  var token = crypto.randomBytes(16).toString("hex");
  tokens.unshift(token);
  tokens = tokens.slice(0, 500);
  return token;
};

csrf.validate = function validate(token) {
  return tokens.some(function(storedToken) {
    return storedToken === token;
  });
};
