"use strict";

var caching = {};

var dottemplates = require("./dottemplates.js"),
    mime         = require("./mime.js"),
    pkg          = require("./../../package.json"),
    paths        = require("./paths.js").get();

var async        = require("async"),
    autoprefixer = require("autoprefixer-core"),
    cleanCSS     = require("clean-css"),
    crypto       = require("crypto"),
    fs           = require("graceful-fs"),
    htmlMinifier = require("html-minifier"),
    path         = require("path"),
    uglify       = require("uglify-js"),
    zlib         = require("zlib");

var doMinify, modesByMime,
    etag         = crypto.createHash("md5").update(String(Date.now())).digest("hex"),
    themesPath   = path.join(paths.mod, "/node_modules/codemirror/theme"),
    modesPath    = path.join(paths.mod, "/node_modules/codemirror/mode");

var minfierOptions = {
    get uglify() {
        return {
            fromString: true,
            compress: {
                unsafe: true,
                screw_ie8: true
            }
        };
    },
    get cleanCSS() {
        return {
            advanced : true,
            keepSpecialComments : 0
        };
    },
    get htmlMinifier() {
        return {
            removeComments: true,
            collapseWhitespace: true,
            collapseBooleanAttributes: true,
            removeAttributeQuotes: true,
            removeOptionalTags: true,
            removeRedundantAttributes: true,
            caseSensitive: true,
            minifyCSS: false
        };
    }
};

cleanCSS = new cleanCSS(minfierOptions.cleanCSS);

caching.files = {
        css: [
            "node_modules/codemirror/lib/codemirror.css",
            "client/style.css",
            "client/sprites.css"
        ],
        js: [
            "node_modules/jquery/dist/jquery.js",
            "client/lib/jquery.customSelect.min.js",
            "node_modules/draggabilly/dist/draggabilly.pkgd.min.js",
            "node_modules/pretty-bytes/pretty-bytes.js",
            "node_modules/codemirror/lib/codemirror.js",
            "node_modules/codemirror/addon/selection/active-line.js",
            "node_modules/codemirror/addon/selection/mark-selection.js",
            "node_modules/codemirror/addon/search/searchcursor.js",
            "node_modules/codemirror/addon/edit/matchbrackets.js",
            "node_modules/codemirror/keymap/sublime.js",
            "client/client.js"
        ],
        html: [
            "client/html/base.html",
            "client/html/auth.html",
            "client/html/main.html"
        ],
        templates: [
            "client/templates/views/directory.dotjs",
            "client/templates/views/document.dotjs",
            "client/templates/views/media.dotjs",
            "client/templates/options.dotjs"
        ],
        other: [
            "client/Roboto.woff",
            "client/images/logo.svg",
            "client/images/logo16.png",
            "client/images/logo32.png",
            "client/images/logo128.png",
            "client/images/logo152.png",
            "client/images/logo180.png",
            "client/images/logo192.png",
            "client/images/favicon.ico"
        ]
    };

// On-demand loadable libs, preferably minified. Will be available as ?!/[property value]
var libs = {
    "node_modules/video.js/dist/video-js/video.js"         : "video.js/vjs.js",
    "node_modules/video.js/dist/video-js/video-js.min.css" : "video.js/vjs.css",
    "node_modules/video.js/dist/video-js/video-js.swf"     : "video.js/vjs.swf",
    "node_modules/video.js/dist/video-js/font/vjs.eot"     : "video.js/font/vjs.eot",
    "node_modules/video.js/dist/video-js/font/vjs.svg"     : "video.js/font/vjs.svg",
    "node_modules/video.js/dist/video-js/font/vjs.ttf"     : "video.js/font/vjs.ttf",
    "node_modules/video.js/dist/video-js/font/vjs.woff"    : "video.js/font/vjs.woff"
};

caching.init = function init(minify, mimes, callback) {
    modesByMime = mimes;
    doMinify = minify;
    async.series([
        compileResources,
        readThemes,
        readModes,
        readLibs
    ], function (err, results) {
        if (err) return callback(err);
        var cache = { res: results[0], themes: {}, modes: {}, lib: {} };

        Object.keys(results[1]).forEach(function (theme) {
            cache.themes[theme] = {data: results[1][theme], etag: etag, mime: mime.lookup("css")};
        });

        Object.keys(results[2]).forEach(function (mode) {
            cache.modes[mode] = {data: results[2][mode], etag: etag, mime: mime.lookup("js")};
        });

        Object.keys(results[3]).forEach(function (file) {
            cache.lib[file] = {data: results[3][file], etag: etag, mime: mime.lookup(path.basename(file))};
        });

        addGzip(cache, function (err, cache) {
            cache.etags = {};
            callback(err, cache);
        });
    });
};

// Create gzip compressed data
function addGzip(cache, callback) {
    var types = Object.keys(cache), funcs = [];
    types.forEach(function (type) {
        funcs.push(function (cb) {
            gzipMap(cache[type], cb);
        });
    });
    async.parallel(funcs, function (err, results) {
        if (err) return callback(err);
        types.forEach(function (type, index) {
            cache[type] = results[index];
        });
        callback(null, cache);
    });
}

function gzipMap(map, callback) {
    var names = Object.keys(map), funcs = [];
    names.forEach(function (name) {
        funcs.push(function (cb) {
            gzip(map[name].data, cb);
        });
    });
    async.parallel(funcs, function (err, results) {
        if (err) return callback(err);
        names.forEach(function (name, index) {
            map[name].gzip = results[index];
        });
        callback(null, map);
    });
}

function gzip(data, callback) {
    zlib.gzip(data, function (err, gzipped) {
        if (err) return callback(err);
        callback(null, gzipped);
    });
}

function readThemes(callback) {
    var themes = {};
    fs.readdir(themesPath, function (err, filenames) {
        if (err) return callback(err);

        var files = filenames.map(function (name) {
            return path.join(themesPath, name);
        });

        async.map(files, fs.readFile, function (err, data) {
            if (err) return callback(err);

            filenames.forEach(function (name, index) {
                var css = String(data[index]);
                themes[name.replace(/\.css$/, "")] = doMinify ? new Buffer(cleanCSS.minify(css).styles) : new Buffer(css);
            });

            callback(err, themes);
        });
    });
}

function readModes(callback) {
    var modes = {};
    Object.keys(modesByMime).forEach(function (mime) {
        var mode = modesByMime[mime];
        if (!modes[mode]) modes[mode] = "";
    });

    async.map(Object.keys(modes), function (mode, cb) {
        fs.readFile(path.join(modesPath, mode, mode + ".js"), function (err, data) {
            if (doMinify)
                cb(err, new Buffer(uglify.minify(data.toString(), minfierOptions.uglify).code));
            else
                cb(err, data);
        });
    }, function (err, result) {
        Object.keys(modes).forEach(function (mode, i) {
            modes[mode] = result[i];
        });
        callback(err, modes);
    });
}

function readLibs(callback) {
    var ret = {};
    async.each(Object.keys(libs), function (p, cb) {
        fs.readFile(path.join(paths.mod, p), function (err, data) {
            ret[libs[p]] = data;
            cb(err);
        });
    }, function (err) {
        callback(err, ret);
    });
}

function compileResources(callback) {
    var resData  = {}, resCache = {},
        out      = { css : "", js  : "" };

    // Read resources
    Object.keys(caching.files).forEach(function (type) {
        resData[type] = caching.files[type].map(function read(file) {
            var data;
            try {
                data = fs.readFileSync(path.join(paths.mod, file)).toString("utf8");
            } catch (error) {
                return callback(error);
            }
            return data;
        });
    });

    // Concatenate CSS
    resData.css.forEach(function (data) {
        out.css += data;
    });

    // Concatenate JS
    resData.js.forEach(function (data) {
        out.js += data + ";";
    });

    // Add SVG object
    var svgDir = paths.svg, svgData = {};
    fs.readdirSync(svgDir).forEach(function (name) {
        svgData[name.slice(0, name.length - 4)] = fs.readFileSync(path.join(svgDir, name), "utf8");
    });
    out.js = out.js.replace("/* {{ svg }} */", "droppy.svg = " + JSON.stringify(svgData) + ";");

    // Insert Templates Code
    var templateCode = "var t = {fn:{},views:{}};";
    resData.templates.forEach(function (data, index) {
        // Produce the doT functions
        templateCode += dottemplates
            .produceFunction("t." + caching.files.templates[index].replace(/\.dotjs$/, "")
            .split("/").slice(2).join("."), data);
    });
    templateCode += ";";
    out.js = out.js.replace("/* {{ templates }} */", templateCode);

    // Insert CM mime modes
    out.js = out.js.replace("/* {{ droppy.mimeModes }} */", "droppy.mimeModes = " + JSON.stringify(modesByMime) + ";\n");

    // Add CSS vendor prefixes
    try {
        out.css = autoprefixer.process(out.css).css;
    } catch (e) {
        return callback(e);
    }

    // Minify JS and CSS
    if (doMinify) {
        out.js  = uglify.minify(out.js, minfierOptions.uglify).code;
        out.css = cleanCSS.minify(out.css).styles;
    }

    // Read and minifiy HTML files
    while (caching.files.html.length) {
        var name = path.basename(caching.files.html.pop()),
            data = resData.html.pop()
                .replace(/\{\{version\}\}/gm, pkg.version)
                .replace(/\{\{name\}\}/gm, pkg.name);

        if (doMinify) {
            data = htmlMinifier.minify(data, minfierOptions.htmlMinifier);
        }

        resCache[name] = {data: new Buffer(data), etag: etag, mime: mime.lookup("html")};
    }


    resCache["client.js"] = {data: new Buffer(out.js), etag: etag, mime: mime.lookup("js")};
    resCache["style.css"] = {data: new Buffer(out.css), etag: etag, mime: mime.lookup("css")};

    // Read misc files
    caching.files.other.forEach(function (file) {
        var data, date,
            name     = path.basename(file),
            fullPath = path.join(paths.mod, file);

        try {
            data = fs.readFileSync(fullPath);
            date = fs.statSync(fullPath).mtime;
        } catch (err) {
            callback(err);
        }

        resCache[name] = {
            data: data,
            etag: crypto.createHash("md5").update(String(date)).digest("hex"),
            mime: mime.lookup(name)
        };
    });
    callback(null, resCache);
}

exports = module.exports = caching;
