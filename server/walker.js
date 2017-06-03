"use strict";

var walker = module.exports = {};
var fs     = require("fs");
var mm     = require("multimatch");

var mmOpts = {
  matchBase: true,
  dot: true,
  nocomment: true,
};

var cfg = null;

walker.init = function(config) {
  cfg = config;
};

walker.walk = function(dir, cb) {
  var files = [], dirs = [], errs = [];
  fs.readdir(dir, function(err, list) {
    if (err) errs.push(err);
    (function next(i) {
      if (!list || !list[i]) {
        return cb(errs.length ? errs : null, dirs, files);
      }

      var path = dir + "/" + list[i];
      if (mm(path, cfg.ignorePatterns, mmOpts).length) {
        return cb(errs.length ? errs : null, dirs, files);
      }

      fs.stat(path, function(err, stat) {
        if (err) {
          errs.push(err);
          next(++i);
        } else if (stat && stat.isDirectory()) {
          dirs.push({path: path, stat: stat});
          walker.walk(path, function(e, d, f) {
            if (e) errs = errs.concat(e);
            dirs = dirs.concat(d);
            files = files.concat(f);
            next(++i);
          });
        } else {
          files.push({path: path, stat: stat});
          next(++i);
        }
      });
    })(0);
  });
};

walker.walkSync = function(dir) {
  var files = [], dirs = [], errs = [], list;
  try {
    list = fs.readdirSync(dir);
    for (var i = 0, l = list.length; i < l; i++) {
      var path = dir + "/" + list[i];
      if (!mm(path, cfg.ignorePatterns, mmOpts).length) {
        try {
          var stat = fs.statSync(path);
          if (stat.isDirectory()) {
            dirs.push({path: path, stat: stat});
            var r = walker.walkSync(path);
            dirs = dirs.concat(r[1]);
            files = files.concat(r[2]);
          } else {
            files.push({path: path, stat: stat});
          }
        } catch (err) {
          errs.push(err);
        }
      }
    }
  } catch (err) {
    errs.push(err);
  }
  return [errs, dirs, files];
};
