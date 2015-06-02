/* jshint jquery: false */
"use strict";

var resources = {};

var templates    = require("./templates"),
    mime         = require("./mime.js"),
    pkg          = require("./../../package.json"),
    paths        = require("./paths.js").get();

var async        = require("async"),
    autoprefixer = require("autoprefixer-core"),
    cheerio      = require("cheerio"),
    cleanCSS     = require("clean-css"),
    crypto       = require("crypto"),
    fs           = require("graceful-fs"),
    htmlMinifier = require("html-minifier"),
    jb           = require("json-buffer"),
    path         = require("path"),
    postcss      = require("postcss"),
    uglify       = require("uglify-js"),
    vm           = require("vm"),
    zlib         = require("zlib");

var minify, svgData = {}, $,
    themesPath   = path.join(paths.mod, "/node_modules/codemirror/theme"),
    modesPath    = path.join(paths.mod, "/node_modules/codemirror/mode");

var opts = {
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
            keepSpecialComments : 0,
            roundingPrecision: 3,
            rebase: false
        };
    },
    get autoprefixer() {
        return {
            browsers: ["last 2 versions"]
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
            minifyCSS: cleanCSS
        };
    }
};

cleanCSS = new cleanCSS(opts.cleanCSS);

resources.files = {
        css: [
            "client/style.css",
            "client/sprites.css"
        ],
        js: [
            "node_modules/handlebars/dist/handlebars.runtime.min.js",
            "node_modules/jquery/dist/jquery.js",
            "node_modules/draggabilly/dist/draggabilly.pkgd.min.js",
            "node_modules/file-extension/file-extension.js",
            "client/client.js"
        ],
        html: [
            "client/html/base.html",
            "client/html/auth.html",
            "client/html/main.html"
        ],
        other: [
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

// On-demand loadable libs. Will be available as ?!/lib/[prop]
var libs = {
    "vjs.js": "node_modules/video.js/dist/video-js/video.js",
    "vjs.css": "node_modules/video.js/dist/video-js/video-js.min.css",
    "vjs.swf": "node_modules/video.js/dist/video-js/video-js.swf",
    "font/vjs.eot": "node_modules/video.js/dist/video-js/font/vjs.eot",
    "font/vjs.svg": "node_modules/video.js/dist/video-js/font/vjs.svg",
    "font/vjs.ttf": "node_modules/video.js/dist/video-js/font/vjs.ttf",
    "font/vjs.woff": "node_modules/video.js/dist/video-js/font/vjs.woff",
    "cm.js": [
        "node_modules/codemirror/lib/codemirror.js",
        "node_modules/codemirror/mode/meta.js",
        "node_modules/codemirror/addon/dialog/dialog.js",
        "node_modules/codemirror/addon/selection/active-line.js",
        "node_modules/codemirror/addon/selection/mark-selection.js",
        "node_modules/codemirror/addon/search/searchcursor.js",
        "node_modules/codemirror/addon/edit/matchbrackets.js",
        "node_modules/codemirror/addon/search/search.js",
        "node_modules/codemirror/keymap/sublime.js"
    ],
    "cm.css": "node_modules/codemirror/lib/codemirror.css"
};

resources.init = function init(doMinify, cb) {
    minify = doMinify;

    if (!minify) return compile(cb);

    canUseCache(function (can) {
        if (!can) return compile(cb);
        fs.readFile(paths.cache, function (err, data) {
            if (err) return cb(err);
            try {
                var cache = jb.parse(data);
                cb(null, cache);
            } catch (e) {
                compile(cb);
            }
        });
    });
};

function compile(cb) {
    async.series([compileAll, readThemes, readModes, readLibs], function (err, results) {
        if (err) return cb(err);
        var cache = {res: results[0], themes: {}, modes: {}, lib: {}};

        Object.keys(results[1]).forEach(function (theme) {
            cache.themes[theme] = {data: results[1][theme], etag: etag(), mime: mime("css")};
        });

        Object.keys(results[2]).forEach(function (mode) {
            cache.modes[mode] = {data: results[2][mode], etag: etag(), mime: mime("js")};
        });

        Object.keys(results[3]).forEach(function (file) {
            cache.lib[file] = {data: results[3][file], etag: etag(), mime: mime(path.basename(file))};
        });

        addGzip(cache, function (err, cache) {
            cache.etags = {};
            if (minify) fs.writeFile(paths.cache, jb.stringify(cache));
            cb(err, cache);
        });
    });
}

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

function canUseCache(cb) {
    var lastChange, files = [];
    Object.keys(resources.files).forEach(function (type) {
        resources.files[type].forEach(function (file) {
            files.push(path.join(paths.mod, file));
        });
    });
    Object.keys(libs).forEach(function (file) {
        if (typeof libs[file] === "string") {
            files.push(path.join(paths.mod, libs[file]));
        } else {
            libs[file].forEach(function (file) {
                files.push(path.join(paths.mod, file));
            });
        }
    });
    async.map(files, function (file, cb) {
        fs.stat(file, function (err, stats) {
            cb(null, err ? 0 : stats.mtime.getTime());
        });
    }, function (err, times) {
        if (err) return cb(err);
        lastChange = Math.max.apply(Math, times);
        fs.stat(paths.cache, function (err, stats) {
            if (err) return cb(false);
            cb(stats.mtime.getTime() > lastChange);
        });
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
                themes[name.replace(/\.css$/, "")] = new Buffer(minify ? cleanCSS.minify(css).styles : css);
            });

            // add our own theme
            fs.readFile(path.join(paths.mod, "/client/cmtheme.css"), function (err, css) {
                if (err) return callback(err);
                themes.droppy = new Buffer(minify ? cleanCSS.minify(css).styles : css);
                callback(null, themes);
            });
        });
    });
}

function readModes(callback) {
    var modes = {};

    // parse meta.js from CM for supported modes
    fs.readFile(path.join(paths.mod, "/node_modules/codemirror/mode/meta.js"), function (err, js) {
        if (err) return callback(err);
        var sandbox = {CodeMirror : {}};

        // Execute meta.js in a sandbox
        vm.runInNewContext(js, sandbox);
        sandbox.CodeMirror.modeInfo.forEach(function (entry) {
            if (entry.mode !== "null") modes[entry.mode] = null;
        });

        async.map(Object.keys(modes), function (mode, cb) {
            fs.readFile(path.join(modesPath, mode, mode + ".js"), function (err, data) {
                cb(err, minify ? new Buffer(uglify.minify(data.toString(), opts.uglify).code) : data);
            });
        }, function (err, result) {
            Object.keys(modes).forEach(function (mode, i) {
                modes[mode] = result[i];
            });
            callback(err, modes);
        });
    });
}

function readLibs(callback) {
    var out = {};
    async.each(Object.keys(libs), function (dest, cb) {
        if (Array.isArray(libs[dest])) {
            async.map(libs[dest], function (p, innercb) {
                fs.readFile(path.join(paths.mod, p), innercb);
            }, function (err, data) {
                out[dest] = Buffer.concat(data);
                cb(err);
            });
        } else {
            fs.readFile(path.join(paths.mod, libs[dest]), function (err, data) {
                out[dest] = data;
                cb(err);
            });
        }
    }, function (err) {
        if (minify) {
            Object.keys(out).forEach(function (file) {
                if (/\.js$/.test(file)) {
                    out[file] = new Buffer(uglify.minify(out[file].toString(), opts.uglify).code);
                } else if (/\.css$/.test(file)) {
                    out[file] = new Buffer(cleanCSS.minify(out[file].toString()).styles);
                }
            });
        }
        callback(err, out);
    });
}

function readSVG() {
    fs.readdirSync(paths.svg).forEach(function (name) {
        var className = name.slice(0, name.length - ".svg".length);
        $ = cheerio.load(fs.readFileSync(path.join(paths.svg, name)).toString(), {xmlMode: true});
        $("svg").addClass(className);
        svgData[className] = $.html();
    });
}

function addSVG(html) {
    $ = cheerio.load(html);
    $("svg").each(function () {
        $(this).replaceWith(svgData[$(this).attr("class")]);
    });
    return $.html();
}

resources.compileJS = function compileJS() {
    var js = "";
    resources.files.js.forEach(function (file) {
        js += fs.readFileSync(path.join(paths.mod, file)).toString("utf8") + ";";
    });

    // Add SVG object
    js = js.replace("/* {{ svg }} */", "droppy.svg = " + JSON.stringify(svgData) + ";");

    // Add Handlebars precompiled templates
    var temps = fs.readdirSync(paths.templates).map(function (p) {
        return path.join(paths.templates, p);
    });
    js = js.replace("/* {{ templates }} */", templates.compile(temps));

    // Minify
    if (minify) js = uglify.minify(js, opts.uglify).code;

    return {data: new Buffer(js), etag: etag(), mime: mime("js")};
};

resources.compileCSS = function compileCSS() {
    var css = "";
    resources.files.css.forEach(function (file) {
        css += fs.readFileSync(path.join(paths.mod, file)).toString("utf8") + "\n";
    });

    // Vendor prefixes
    css = postcss([autoprefixer]).process(css).css;

    // Minify
    if (minify) css = cleanCSS.minify(css).styles;

    return {data: new Buffer(css), etag: etag(), mime: mime("css")};
};

resources.compileHTML = function compileHTML(res) {
    var html = {};
    resources.files.html.forEach(function (file) {
        var data = fs.readFileSync(path.join(paths.mod, file)).toString("utf8")
            .replace(/\{\{version\}\}/gm, pkg.version)
            .replace(/\{\{name\}\}/gm, pkg.name)
            .replace(/\{\{engine\}\}/gm, require("detect-engine") + " " + process.version.substring(1));

        // Add SVGs
        data = addSVG(data);

        // Minify
        if (minify) data = htmlMinifier.minify(data, opts.htmlMinifier);

        html[path.basename(file)] = data;
    });

    // Combine pages
    $ = cheerio.load(html["base.html"]);
    $("html").attr("data-type", "main");
    res["main.html"] = {
        data: new Buffer($("#page").replaceWith(html["main.html"]).end().html()),
        etag: etag(),
        mime: mime("html")
    };

    $ = cheerio.load(html["base.html"]);
    $("html").attr("data-type", "auth");
    res["auth.html"] = {
        data: new Buffer($("#page").replaceWith(html["auth.html"]).end().html()),
        etag: etag(),
        mime: mime("html")
    };

    $ = cheerio.load(html["base.html"]);
    $("html").attr("data-type", "firstrun");
    res["firstrun.html"] = {
        data: new Buffer($("#page").replaceWith(html["auth.html"]).end().html()),
        etag: etag(),
        mime: mime("html")
    };

    return res;
};

function compileAll(callback) {
    var res = {};

    readSVG();
    res["client.js"] = resources.compileJS();
    res["style.css"] = resources.compileCSS();
    res = resources.compileHTML(res);

    // Read misc files
    resources.files.other.forEach(function (file) {
        var data, date,
            name     = path.basename(file),
            fullPath = path.join(paths.mod, file);

        try {
            data = fs.readFileSync(fullPath);
            date = fs.statSync(fullPath).mtime;
        } catch (err) {
            callback(err);
        }

        res[name] = {
            data: data,
            etag: crypto.createHash("md5").update(String(date)).digest("hex"),
            mime: mime(name)
        };
    });
    callback(null, res);
}

function etag() {
    return crypto.createHash("md5").update(String(Date.now())).digest("hex");
}

module.exports = resources;
