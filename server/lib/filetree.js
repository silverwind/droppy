"use strict";

var filetree = new (require("events").EventEmitter)(),
    dirs     = {},
    todoDirs = [];

var _        = require("lodash"),
    chalk    = require("chalk"),
    fs       = require("graceful-fs"),
    path     = require("path"),
    readdirp = require("readdirp");

var log      = require("./log.js"),
    mime     = require("./mime.js"),
    utils    = require("./utils.js");

var debouncedUpdate = _.debounce(function() {
    todoDirs.sort(function (a, b) {
        return a.match(/\//g).length - b.match(/\//g).length;
    }).filter(function (path, _, self) {
        return self.every(function (another) {
            return another === path || path.indexOf(another + "/") !== 0;
        });
    }).filter(function (path, index, self) {
        return self.indexOf(path) === index;
    }).forEach(function (dir) {
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
    log.debug("Updating " + chalk.blue(dir));
    fs.stat(utils.addFilesPath(dir), function (err, stats) {
        readdirp({root: utils.addFilesPath(dir)}, function (errors, results) {
            dirs[dir] = {files: {}, size: 0, mtime: stats ? stats.mtime.getTime() : Date.now()};
            if (errors) {
                errors.forEach(function (err) {
                    if (err.code === "ENOENT" && dirs[utils.removeFilesPath(err.path)]) {
                        delete dirs[utils.removeFilesPath(err.path)];
                    } else {
                        log.error(err);
                    }
                });
                if (cb) cb();
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
            if (cb) cb();
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
    utils.rm(utils.addFilesPath(dir), function (err) {
        if (err) log.error(err);
        delete dirs[path.dirname(dir)].files[path.basename(dir)];
        update(path.dirname(dir));
    });
};

filetree.unlinkdir = function unlinkdir(dir) {
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
        if (err) log.error(err);
        if(stats.isFile()) {
            if (type === "cut")
                filetree.mv(src, dst);
            else
                filetree.cp(src, dst);
        } else if (stats.isDirectory()) {
            if (type === "cut")
                filetree.mvdir(src, dst);
            else
                filetree.cpdir(src, dst);
        }
    });
};

filetree.mk = function mk(dir, cb) {
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
    fs.stat(utils.addFilesPath(src), function (err, stats) {
        if (err) log.error(err);
        if (stats.isFile())
            filetree.mv(src, dst, cb);
        else if (stats.isDirectory())
            filetree.mvdir(src, dst, cb);
    });
};

filetree.mv = function mv(src, dst, cb) {
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
    utils.move(utils.addFilesPath(src), utils.addFilesPath(dst), function (err) {
        if (err) log.error(err);
        // basedir
        dirs[dst] = _.clone(dirs[src], true);
        delete dirs[src];
        // subdirs
        Object.keys(dirs).forEach(function (dir) {
            if (new RegExp("^" + src + "/").test(dir) && dir !== src && dir !== dst) {
                dirs[dir.replace(new RegExp("^" + src + "/"), dst + "/")] = _.clone(dirs[dir], true);
                delete dirs[dir];
            }
        });
        update(path.dirname(src));
        update(path.dirname(dst));
        if (cb) cb();
    });
};

filetree.cp = function cp(src, dst, cb) {
    utils.copyFile(utils.addFilesPath(src), utils.addFilesPath(dst), function () {
        dirs[path.dirname(dst)].files[path.basename(dst)] = dirs[path.dirname(src)].files[path.basename(src)];
        update(path.dirname(dst));
        if (cb) cb();
    });
};

filetree.cpdir = function cpdir(src, dst, cb) {
    utils.copyDir(utils.addFilesPath(src), utils.addFilesPath(dst), function () {
        // basedir
        dirs[dst] = _.clone(dirs[src], true);
        // subdirs
        Object.keys(dirs).forEach(function (dir) {
            if (new RegExp("^" + src + "/").test(dir) && dir !== src && dir !== dst) {
                dirs[dir.replace(new RegExp("^" + src + "/"), dst + "/")] = _.clone(dirs[dir], true);
            }
        });
        update(path.dirname(dst));
        if (cb) cb();
    });
};

filetree.save = function save(dst, data, cb) {
    fs.stat(utils.addFilesPath(dst), function (err) {
        if (err && err.code !== "ENOENT") return cb(err);
        fs.writeFile(utils.addFilesPath(dst), data, function (err) {
            dirs[path.dirname(dst)].files[path.basename(dst)] = {size: Buffer.byteLength(data), mtime: Date.now()};
            update(path.dirname(dst));
            if (cb) cb(err);
        });
    });
};

// -----------------------------------------------------------------------------
// Get directory contents from cache
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

module.exports = filetree;

// function watch(cb) {
//     var add       = cb.bind(null, "add"),
//         unlink    = cb.bind(null, "unlink"),
//         change    = _.throttle(cb.bind(null, "change"), 500, {trailing: true}),
//         addDir    = cb.bind(null, "addDir"),
//         unlinkdir = cb.bind(null, "unlinkdir");

//     chokidar.watch(".", {
//         cwd           : paths.files,
//         alwaysStat    : true,
//         ignoreInitial : true,
//         usePolling    : true
//     })
//     .on("add", add)
//     .on("unlink", unlink)
//     .on("change", change)
//     .on("addDir", addDir)
//     .on("unlinkdir", unlinkdir)
//     .on("error", log.error);
// };
