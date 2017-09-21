"use strict";

const filetree = module.exports = new (require("events").EventEmitter)();

const _        = require("lodash");
const chokidar = require("chokidar");
const escRe    = require("escape-string-regexp");
const fs       = require("graceful-fs");
const path     = require("path");

const log      = require("./log.js");
const paths    = require("./paths.js").get();
const utils    = require("./utils.js");
const walker   = require("./walker.js");

let dirs     = {};
let todoDirs = [];
let initial  = true;
let watching = true;
let timer    = null;
let cfg      = null;

const WATCHER_DELAY = 3000;

filetree.init = function(config) {
  cfg = config;
  walker.init(cfg);
};

filetree.watch = function() {
  chokidar.watch(paths.files, {
    alwaysStat    : true,
    ignoreInitial : true,
    usePolling    : Boolean(cfg.pollingInterval),
    interval      : cfg.pollingInterval,
    binaryInterval: cfg.pollingInterval
  }).on("error", log.error).on("all", function() {
    // TODO: only update what's really necessary
    if (watching) filetree.updateAll();
  });
};

filetree.updateAll = _.debounce(function updateAll() {
  log.debug("Updating file tree because of local filesystem changes");
  filetree.updateDir(null, function() {
    filetree.emit("updateall");
  });
}, WATCHER_DELAY);

function lookAway() {
  watching = false;
  clearTimeout(timer);
  timer = setTimeout(function() {
    watching = true;
  }, WATCHER_DELAY);
}

function filterDirs(dirs) {
  return dirs.sort(function(a, b) {
    return utils.countOccurences(a, "/") - utils.countOccurences(b, "/");
  }).filter(function(path, _, self) {
    return self.every(function(another) {
      return another === path || path.indexOf(another + "/") !== 0;
    });
  }).filter(function(path, index, self) {
    return self.indexOf(path) === index;
  });
}

const debouncedUpdate = _.debounce(function() {
  filterDirs(todoDirs).forEach(function(dir) {
    filetree.emit("update", dir);
  });
  todoDirs = [];
}, 100, {trailing: true});

function update(dir) {
  updateDirSizes();
  todoDirs.push(dir);
  debouncedUpdate();
}

function handleUpdateDirErrs(errs, cb) {
  errs.forEach(function(err) {
    if (err.code === "ENOENT" && dirs[utils.removeFilesPath(err.path)]) {
      delete dirs[utils.removeFilesPath(err.path)];
    } else {
      log.error(err);
    }
  });
  if (typeof cb === "function") cb();
}

filetree.updateDir = function(dir, cb) {
  if (dir === null) { dir = "/"; dirs = {}; }
  fs.stat(utils.addFilesPath(dir), function(err, stat) {
    if (err) log.error(err);
    if (initial) { // use sync walk for performance
      initial = false;
      const r = walker.walkSync(utils.addFilesPath(dir));
      if (r[0]) handleUpdateDirErrs(r[0]);
      updateDirInCache(dir, stat, r[1], r[2], cb);
    } else {
      log.debug("Updating cache of " + dir);
      walker.walk(utils.addFilesPath(dir), function(errs, readDirs, readFiles) {
        if (errs) handleUpdateDirErrs(errs, cb);
        updateDirInCache(dir, stat, readDirs, readFiles, cb);
      });
    }
  });
};

function updateDirInCache(root, stat, readDirs, readFiles, cb) {
  dirs[root] = {files: {}, size: 0, mtime: stat ? stat.mtime.getTime() : Date.now()};

  const readDirObj = {}, readDirKeys = [];
  readDirs.sort((a, b) => utils.naturalSort(a.path, b.path)).forEach(d => {
    const path = normalize(utils.removeFilesPath(d.path));
    readDirObj[path] = d.stat;
    readDirKeys[path] = path;
  });

  // Remove deleted dirs
  Object.keys(dirs).forEach(path => {
    if (path.indexOf(root) === 0 && readDirKeys.indexOf(path) === -1 && path !== root) {
      delete dirs[path];
    }
  });

  // Add dirs
  Object.keys(readDirObj).forEach(function(path) {
    dirs[path] = {
      files: {}, size: 0, mtime: readDirObj[path].mtime.getTime() || 0
    };
  });

  // Add files
  readFiles.sort(function(a, b) {
    return utils.naturalSort(a.path, b.path);
  }).forEach(function(f) {
    const parentDir = normalize(utils.removeFilesPath(path.dirname(f.path)));
    dirs[parentDir].files[normalize(path.basename(f.path))] = {
      size: f.stat.size, mtime: f.stat.mtime.getTime() || 0
    };
    dirs[parentDir].size += f.stat.size;
  });

  update(root);
  if (typeof cb === "function") cb();
}

function updateDirSizes() {
  const todo = Object.keys(dirs);

  todo.sort(function(a, b) {
    return utils.countOccurences(b, "/") - utils.countOccurences(a, "/");
  });

  todo.forEach(function(d) {
    dirs[d].size = 0;
    Object.keys(dirs[d].files).forEach(function(f) {
      dirs[d].size += dirs[d].files[f].size;
    });
  });

  todo.forEach(function(d) {
    if (path.dirname(d) !== "/" && dirs[path.dirname(d)]) {
      dirs[path.dirname(d)].size += dirs[d].size;
    }
  });
}

filetree.del = function(dir) {
  fs.stat(utils.addFilesPath(dir), function(err, stats) {
    if (err) log.error(err);
    if (!stats) return;
    if (stats.isFile()) {
      filetree.unlink(dir);
    } else if (stats.isDirectory()) {
      filetree.unlinkdir(dir);
    }
  });
};

filetree.unlink = function(dir) {
  lookAway();
  utils.rm(utils.addFilesPath(dir), function(err) {
    if (err) log.error(err);
    delete dirs[path.dirname(dir)].files[path.basename(dir)];
    update(path.dirname(dir));
  });
};

filetree.unlinkdir = function(dir) {
  lookAway();
  utils.rm(utils.addFilesPath(dir), function(err) {
    if (err) log.error(err);
    delete dirs[dir];
    Object.keys(dirs).forEach(function(d) {
      if (new RegExp("^" + escRe(dir) + "/").test(d)) delete dirs[d];
    });
    update(path.dirname(dir));
  });
};

filetree.clipboard = function(src, dst, type) {
  fs.stat(utils.addFilesPath(src), function(err, stats) {
    lookAway();
    if (err) log.error(err);
    if (stats.isFile()) {
      filetree[type === "cut" ? "mv" : "cp"](src, dst);
    } else if (stats.isDirectory()) {
      filetree[type === "cut" ? "mvdir" : "cpdir"](src, dst);
    }
  });
};

filetree.mk = function(dir, cb) {
  lookAway();
  fs.stat(utils.addFilesPath(dir), function(err) {
    if (err && err.code === "ENOENT") {
      fs.open(utils.addFilesPath(dir), "wx", function(err, fd) {
        if (err) log.error(err);
        fs.close(fd, function(error) {
          if (error) log.error(error);
          dirs[path.dirname(dir)].files[path.basename(dir)] = {size: 0, mtime: Date.now()};
          update(path.dirname(dir));
          if (cb) cb();
        });
      });
    } else {
      if (cb) cb();
    }
  });
};

filetree.mkdir = function(dir, cb) {
  lookAway();
  fs.stat(utils.addFilesPath(dir), function(err) {
    if (err && err.code === "ENOENT") {
      utils.mkdir(utils.addFilesPath(dir), function(err) {
        if (err) log.error(err);
        dirs[dir] = {files: {}, size: 0, mtime: Date.now()};
        update(path.dirname(dir));
        if (cb) cb();
      });
    } else {
      if (cb) cb();
    }
  });
};

filetree.move = function(src, dst, cb) {
  lookAway();
  fs.stat(utils.addFilesPath(src), function(err, stats) {
    if (err) log.error(err);
    if (stats.isFile()) {
      filetree.mv(src, dst, cb);
    } else if (stats.isDirectory()) {
      filetree.mvdir(src, dst, cb);
    }
  });
};

filetree.moveTemps = function(src, dst, cb) {
  lookAway();
  utils.move(src, dst, cb);
};

filetree.mv = function(src, dst, cb) {
  lookAway();
  utils.move(utils.addFilesPath(src), utils.addFilesPath(dst), function(err) {
    if (err) log.error(err);
    dirs[path.dirname(dst)].files[path.basename(dst)] = dirs[path.dirname(src)].files[path.basename(src)];
    delete dirs[path.dirname(src)].files[path.basename(src)];
    update(path.dirname(src));
    update(path.dirname(dst));
    if (cb) cb();
  });
};

filetree.mvdir = function(src, dst, cb) {
  lookAway();
  utils.move(utils.addFilesPath(src), utils.addFilesPath(dst), function(err) {
    if (err) log.error(err);
    // Basedir
    dirs[dst] = dirs[src];
    delete dirs[src];
    // Subdirs
    Object.keys(dirs).forEach(function(dir) {
      if (new RegExp("^" + escRe(src) + "/").test(dir) && dir !== src && dir !== dst) {
        dirs[dir.replace(new RegExp("^" + escRe(src) + "/"), dst + "/")] = dirs[dir];
        delete dirs[dir];
      }
    });
    update(path.dirname(src));
    update(path.dirname(dst));
    if (cb) cb();
  });
};

filetree.cp = function(src, dst, cb) {
  lookAway();
  utils.copyFile(utils.addFilesPath(src), utils.addFilesPath(dst), function() {
    dirs[path.dirname(dst)].files[path.basename(dst)] = _.cloneDeep(dirs[path.dirname(src)].files[path.basename(src)]);
    dirs[path.dirname(dst)].files[path.basename(dst)].mtime = Date.now();
    update(path.dirname(dst));
    if (cb) cb();
  });
};

filetree.cpdir = function(src, dst, cb) {
  lookAway();
  utils.copyDir(utils.addFilesPath(src), utils.addFilesPath(dst), function() {
    // Basedir
    dirs[dst] = _.cloneDeep(dirs[src]);
    dirs[dst].mtime = Date.now();
    // Subdirs
    Object.keys(dirs).forEach(function(dir) {
      if (new RegExp("^" + escRe(src) + "/").test(dir) && dir !== src && dir !== dst) {
        dirs[dir.replace(new RegExp("^" + escRe(src) + "/"), dst + "/")] = _.cloneDeep(dirs[dir]);
        dirs[dir.replace(new RegExp("^" + escRe(src) + "/"), dst + "/")].mtime = Date.now();
      }
    });
    update(path.dirname(dst));
    if (cb) cb();
  });
};

filetree.save = function(dst, data, cb) {
  lookAway();
  fs.stat(utils.addFilesPath(dst), function(err) {
    if (err && err.code !== "ENOENT") return cb(err);
    fs.writeFile(utils.addFilesPath(dst), data, function(err) {
      dirs[path.dirname(dst)].files[path.basename(dst)] = {size: Buffer.byteLength(data), mtime: Date.now()};
      update(path.dirname(dst));
      if (cb) cb(err);
    });
  });
};

filetree.ls = function(p) {
  if (!dirs[p]) return;
  const entries = {};
  const files = dirs[p].files;
  Object.keys(files).forEach(function(file) {
    entries[file] = [
      "f",
      Math.round(files[file].mtime / 1e3),
      files[file].size
    ].join("|");
  });
  Object.keys(dirs).forEach(function(dir) {
    if (path.dirname(dir) === p && path.basename(dir)) {
      entries[path.basename(dir)] = [
        "d",
        Math.round(dirs[dir].mtime / 1e3),
        dirs[dir].size
      ].join("|");
    }
  });
  return entries;
};

filetree.lsFilter = function(p, re) {
  if (!dirs[p]) return;
  return Object.keys(dirs[p].files).filter(function(file) {
    return re.test(file);
  });
};

function normalize(str) {
  return String.prototype.normalize ? str.normalize() : str;
}
