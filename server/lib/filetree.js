"use strict";

var filetree = new (require("events").EventEmitter)(),
    dirs     = {},
    todoDirs = [];

var _        = require("lodash"),
    chalk    = require("chalk"),
    chokidar = require("chokidar"),
    fs       = require("graceful-fs"),
    path     = require("path"),
    readdirp = require("readdirp");

var log      = require("./log.js"),
    mime     = require("./mime.js"),
    paths    = require("./paths.js").get(),
    utils    = require("./utils.js");

function filterDirs(dirs) {
    return dirs.sort(function (a, b) {
        return a.match(/\//g).length - b.match(/\//g).length;
    }).filter(function (path, _, self) {
        return self.every(function (another) {
            return another === path || path.indexOf(another + "/") !== 0;
        });
    }).filter(function (path, index, self) {
        return self.indexOf(path) === index;
    });
}

var debouncedUpdate = _.debounce(function() {
    filterDirs(todoDirs).forEach(function (dir) {
        filetree.emit("update", dir);
    });
    todoDirs = [];
}, 100, {trailing: true});

function update(dir) {
    updateDirSizes();
    todoDirs.push(dir);
    debouncedUpdate();
}

filetree.updateDir = function updateDir(dir, cb) {
    if (dir === null) { dir = "/"; dirs = {}; }
    log.debug("Updating " + chalk.blue(dir));
    fs.stat(utils.addFilesPath(dir), function (err, stats) {
        readdirp({root: utils.addFilesPath(dir)}, function (errs, results) {
            dirs[dir] = {files: {}, size: 0, mtime: stats ? stats.mtime.getTime() : Date.now()};
            if (errs) {
                errs.forEach(function (err) {
                    if (err.code === "ENOENT" && dirs[utils.removeFilesPath(err.path)])
                        delete dirs[utils.removeFilesPath(err.path)];
                    else
                        log.error(err);
                });
                if (typeof cb === "function") cb();
            }

            // Add dirs
            results.directories.forEach(function (d) {
                dirs[utils.removeFilesPath(d.fullPath)] = {files: {}, size: 0, mtime: d.stat.mtime.getTime() || 0};
            });

            // Add files
            results.files.forEach(function (f) {
                var parentDir = utils.removeFilesPath(f.fullParentDir);
                dirs[parentDir].files[f.name] = {size: f.stat.size, mtime: f.stat.mtime.getTime() || 0};
                dirs[parentDir].size += f.stat.size;
            });

            update(dir);
            if (typeof cb === "function") cb();
        });
    });
};

function updateDirSizes() {
    var todo = Object.keys(dirs);
    todo = todo.sort(function (a, b) {
        return -(a.match(/\//g).length - b.match(/\//g).length);
    });

    todo.forEach(function (d) {
        dirs[d].size = 0;
        Object.keys(dirs[d].files).forEach(function (f) {
            dirs[d].size += dirs[d].files[f].size;
        });
    });

    todo.forEach(function (d) {
        if (path.dirname(d) !== "/")
            dirs[path.dirname(d)].size += dirs[d].size;
    });
}

filetree.del = function del(dir) {
    fs.stat(utils.addFilesPath(dir), function (err, stats) {
        if (err) log.error(err);
        if (!stats) return;
        if(stats.isFile()) {
            filetree.unlink(dir);
        } else if (stats.isDirectory()) {
            filetree.unlinkdir(dir);
        }
    });
};

filetree.unlink = function unlink(dir) {
    lookAway();
    utils.rm(utils.addFilesPath(dir), function (err) {
        if (err) log.error(err);
        delete dirs[path.dirname(dir)].files[path.basename(dir)];
        update(path.dirname(dir));
    });
};

filetree.unlinkdir = function unlinkdir(dir) {
    lookAway();
    utils.rm(utils.addFilesPath(dir), function (err) {
        if (err) log.error(err);
        delete dirs[dir];
        Object.keys(dirs).forEach(function (d) {
            if (new RegExp("^" + dir + "/").test(d)) delete dirs[d];
        });
        update(path.dirname(dir));
    });
};

filetree.clipboard = function clipboard(src, dst, type) {
    fs.stat(utils.addFilesPath(src), function (err, stats) {
        lookAway();
        if (err) log.error(err);
        if(stats.isFile())
            filetree[type === "cut" ? "mv" : "cp"](src, dst);
        else if (stats.isDirectory())
            filetree[type === "cut" ? "mvdir" : "cpdir"](src, dst);
    });
};

filetree.mk = function mk(dir, cb) {
    lookAway();
    fs.stat(utils.addFilesPath(dir), function (err) {
        if (err && err.code === "ENOENT") {
            fs.open(utils.addFilesPath(dir), "wx", function (err, fd) {
                if (err) log.error(err);
                fs.close(fd, function (error) {
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

filetree.mkdir = function mkdir(dir, cb) {
    lookAway();
    fs.stat(utils.addFilesPath(dir), function (err) {
        if (err && err.code === "ENOENT") {
           utils.mkdir(utils.addFilesPath(dir), function (err) {
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

filetree.move = function move(src, dst, cb) {
    lookAway();
    fs.stat(utils.addFilesPath(src), function (err, stats) {
        if (err) log.error(err);
        if (stats.isFile())
            filetree.mv(src, dst, cb);
        else if (stats.isDirectory())
            filetree.mvdir(src, dst, cb);
    });
};

filetree.mv = function mv(src, dst, cb) {
    lookAway();
    utils.move(utils.addFilesPath(src), utils.addFilesPath(dst), function (err) {
        if (err) log.error(err);
        dirs[path.dirname(dst)].files[path.basename(dst)] = dirs[path.dirname(src)].files[path.basename(src)];
        delete dirs[path.dirname(src)].files[path.basename(src)];
        update(path.dirname(src));
        update(path.dirname(dst));
        if (cb) cb();
    });
};

filetree.mvdir = function mvdir(src, dst, cb) {
    lookAway();
    utils.move(utils.addFilesPath(src), utils.addFilesPath(dst), function (err) {
        if (err) log.error(err);
        // Basedir
        dirs[dst] = dirs[src];
        delete dirs[src];
        // Subdirs
        Object.keys(dirs).forEach(function (dir) {
            if (new RegExp("^" + src + "/").test(dir) && dir !== src && dir !== dst) {
                dirs[dir.replace(new RegExp("^" + src + "/"), dst + "/")] = dirs[dir];
                delete dirs[dir];
            }
        });
        update(path.dirname(src));
        update(path.dirname(dst));
        if (cb) cb();
    });
};

filetree.cp = function cp(src, dst, cb) {
    lookAway();
    utils.copyFile(utils.addFilesPath(src), utils.addFilesPath(dst), function () {
        dirs[path.dirname(dst)].files[path.basename(dst)] = _.clone(dirs[path.dirname(src)].files[path.basename(src)], true);
        dirs[path.dirname(dst)].files[path.basename(dst)].mtime = Date.now();
        update(path.dirname(dst));
        if (cb) cb();
    });
};

filetree.cpdir = function cpdir(src, dst, cb) {
    lookAway();
    utils.copyDir(utils.addFilesPath(src), utils.addFilesPath(dst), function () {
        // Basedir
        dirs[dst] = _.clone(dirs[src], true);
        dirs[dst].mtime = Date.now();
        // Subdirs
        Object.keys(dirs).forEach(function (dir) {
            if (new RegExp("^" + src + "/").test(dir) && dir !== src && dir !== dst) {
                dirs[dir.replace(new RegExp("^" + src + "/"), dst + "/")] = _.clone(dirs[dir], true);
                dirs[dir.replace(new RegExp("^" + src + "/"), dst + "/")].mtime = Date.now();
            }
        });
        update(path.dirname(dst));
        if (cb) cb();
    });
};

filetree.save = function save(dst, data, cb) {
    lookAway();
    fs.stat(utils.addFilesPath(dst), function (err) {
        if (err && err.code !== "ENOENT") return cb(err);
        fs.writeFile(utils.addFilesPath(dst), data, function (err) {
            dirs[path.dirname(dst)].files[path.basename(dst)] = {size: Buffer.byteLength(data), mtime: Date.now()};
            update(path.dirname(dst));
            if (cb) cb(err);
        });
    });
};

filetree.getDirContents = function getDirContents(p) {
    if (!dirs[p]) return;
    var entries = {}, files = dirs[p].files;
    Object.keys(files).forEach(function (file) {
        entries[file] = {type: "f", size: files[file].size, mtime: files[file].mtime, mime: mime(file)};
    });
    Object.keys(dirs).forEach(function (dir) {
        if (path.dirname(dir) === p && path.basename(dir)) {
            entries[path.basename(dir)] = {type: "d", mtime: dirs[dir].mtime, size: dirs[dir].size};
        }
    });
    return entries;
};

// local fs changes. debounced heavily but refresh everything.
var watcher;
var watching = false;
var timer = null;

var updateAll = _.debounce(function () {
    filetree.updateDir(null, function() {
        Object.keys(dirs).forEach(function (dir) {
            filetree.emit("update", dir);
        });
    });
}, 2000);

function lookAway() {
    unwatch();
    clearTimeout(timer);
    timer = setTimeout(watch, 2000);
}

function watch() {
    watching = true;
    watcher = chokidar.watch(paths.files, {
        alwaysStat    : true,
        ignoreInitial : true,
        usePolling    : true,
        interval      : 2000,
        binaryInterval: 2000
    }).on("error", log.error).on("all", updateAll);
}

function unwatch() {
    if (!watching || !watcher) return;
    watcher.unwatch(path.files);
}

module.exports = filetree;
