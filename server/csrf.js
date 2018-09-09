"use strict";

const csrf = module.exports = {};
const crypto = require("crypto");
let tokens = [];

csrf.create = function() {
  const token = crypto.randomBytes(16).toString("hex");
  tokens.unshift(token);
  tokens = tokens.slice(0, 500);
  return token;
};

csrf.validate = function(token) {
  return tokens.some(storedToken => {
    return storedToken === token;
  });
};
