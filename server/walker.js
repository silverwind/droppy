"use strict";

const walker = module.exports = {};
const fs     = require("fs");
const mm     = require("multimatch");

const mmOpts = {
  matchBase: true,
  dot: true,
  nocomment: true,
};

let cfg = null;

walker.init = function(config) {
  cfg = config;
};

walker.walk = function(dir, cb) {
  let files = [], dirs = [], errs = [];
  fs.readdir(dir, (err, list) => {
    if (err) errs.push(err);
    (function next(i) {
      if (!list || !list[i]) {
        return cb(errs.length ? errs : null, dirs, files);
      }

      const path = dir + "/" + list[i];
      if (mm(path, cfg.ignorePatterns, mmOpts).length) {
        return cb(errs.length ? errs : null, dirs, files);
      }

      fs.stat(path, (err, stat) => {
        if (err) {
          errs.push(err);
          next(++i);
        } else if (stat && stat.isDirectory()) {
          dirs.push({path: path, stat: stat});
          walker.walk(path, (e, d, f) => {
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
  const errs = [];
  let files = [], dirs = [], list;
  try {
    list = fs.readdirSync(dir);
    for (let i = 0, l = list.length; i < l; i++) {
      const path = dir + "/" + list[i];
      if (!mm(path, cfg.ignorePatterns, mmOpts).length) {
        try {
          const stat = fs.statSync(path);
          if (stat.isDirectory()) {
            dirs.push({path: path, stat: stat});
            const r = walker.walkSync(path);
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
