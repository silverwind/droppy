"use strict";

var caching      = {};

var dottemplates = require("./dottemplates.js"),
    pkg          = require("./../../package.json"),
    paths        = require("./paths.js")();

var async        = require("async"),
    autoprefixer = require("autoprefixer"),
    cleanCSS     = new require("clean-css")({keepSpecialComments : 0}),
    crypto       = require("crypto"),
    fs           = require("graceful-fs"),
    mime         = require("mime"),
    path         = require("path"),
    uglify       = require("uglify-js"),
    zlib         = require("zlib");

var doMinify,
    themesPath   = path.join(paths.module, "/node_modules/codemirror/theme"),
    modesPath    = path.join(paths.module, "/node_modules/codemirror/mode");

var files = {
        css: [
            "node_modules/codemirror/lib/codemirror.css",
            "client/style.css",
            "client/sprites.css"
        ],
        js: [
            "node_modules/jquery/dist/jquery.js",
            "client/client.js",
            "node_modules/codemirror/lib/codemirror.js",
            "node_modules/codemirror/addon/selection/active-line.js",
            "node_modules/codemirror/addon/selection/mark-selection.js",
            "node_modules/codemirror/addon/search/searchcursor.js",
            "node_modules/codemirror/addon/edit/matchbrackets.js",
            "node_modules/codemirror/keymap/sublime.js"
        ],
        html: [
            "client/base.html",
            "client/auth.html",
            "client/main.html"
        ],
        templates: [
            "client/templates/views/directory.dotjs",
            "client/templates/views/document.dotjs",
            "client/templates/views/media.dotjs",
            "client/templates/options.dotjs"
        ],
        other: [
            "client/OpenSans-Light.woff",
            "client/OpenSans-Regular.woff",
            "client/favicon.ico"
        ]
    };

// mime list extracted from codemirror/mode/meta.js
var modesByMime = {
    "application/javascript": "javascript",
    "application/json": "javascript",
    "application/ld+json": "javascript",
    "application/sieve": "sieve",
    "application/typescript": "javascript",
    "application/x-aspx": "htmlembedded",
    "application/x-cypher-query": "cypher",
    "application/x-ejs": "htmlembedded",
    "application/x-httpd-php": "php",
    "application/x-json": "javascript",
    "application/x-jsp": "htmlembedded",
    "application/x-sparql-query": "sparql",
    "application/xml": "xml",
    "application/xml-dtd": "dtd",
    "application/xquery": "xquery",
    "message/http": "http",
    "text/apl": "apl",
    "text/css": "css",
    "text/html": "htmlmixed",
    "text/javascript": "javascript",
    "text/mirc": "mirc",
    "text/n-triples": "ntriples",
    "text/tiki": "tiki",
    "text/turtle": "turtle",
    "text/vbscript": "vbscript",
    "text/velocity": "velocity",
    "text/x-asterisk": "asterisk",
    "text/x-c++src": "clike",
    "text/x-clojure": "clojure",
    "text/x-cobol": "cobol",
    "text/x-coffeescript": "coffeescript",
    "text/x-common-lisp": "commonlisp",
    "text/x-csharp": "clike",
    "text/x-csrc": "clike",
    "text/x-cython": "python",
    "text/x-d": "d",
    "text/x-diff": "diff",
    "text/x-dylan": "dylan",
    "text/x-ecl": "ecl",
    "text/x-eiffel": "eiffel",
    "text/x-erlang": "erlang",
    "text/x-feature": "gherkin",
    "text/x-fortran": "fortran",
    "text/x-fsharp": "mllike",
    "text/x-gas": "gas",
    "text/x-gfm": "gfm",
    "text/x-go": "go",
    "text/x-groovy": "groovy",
    "text/x-haml": "haml",
    "text/x-haskell": "haskell",
    "text/x-haxe": "haxe",
    "text/x-jade": "jade",
    "text/x-java": "clike",
    "text/x-julia": "julia",
    "text/x-kotlin": "kotlin",
    "text/x-latex": "stex",
    "text/x-less": "css",
    "text/x-livescript": "livescript",
    "text/x-lua": "lua",
    "text/x-mariadb": "sql",
    "text/x-markdown": "markdown",
    "text/x-nginx-conf": "nginx",
    "text/x-ocaml": "mllike",
    "text/x-octave": "octave",
    "text/x-pascal": "pascal",
    "text/x-perl": "perl",
    "text/x-php": "php",
    "text/x-pig": "pig",
    "text/x-properties": "properties",
    "text/x-puppet": "puppet",
    "text/x-python": "python",
    "text/x-rsrc": "r",
    "text/x-rst": "rst",
    "text/x-ruby": "ruby",
    "text/x-rustsrc": "rust",
    "text/x-sass": "sass",
    "text/x-scala": "clike",
    "text/x-scheme": "scheme",
    "text/x-scss": "css",
    "text/x-sh": "shell",
    "text/x-slim": "slim",
    "text/x-smarty": "smarty",
    "text/x-solr": "solr",
    "text/x-sql": "sql",
    "text/x-stex": "stex",
    "text/x-stsrc": "smalltalk",
    "text/x-systemverilog": "verilog",
    "text/x-tcl": "tcl",
    "text/x-tiddlywiki": "tiddlywiki",
    "text/x-toml": "toml",
    "text/x-vb": "vb",
    "text/x-verilog": "verilog",
    "text/x-yaml": "yaml",
    "text/x-z80": "z80"
};

caching.init = function init(minify, callback) {
    doMinify = minify;
    async.series([compileResources, readThemes, readModes], function (err, results) {
        if (err) return callback(err);
        var cache = {}, etag = crypto.createHash("md5").update(String(Date.now())).digest("hex");

        cache.res = results[0];

        cache.themes = {};
        Object.keys(results[1]).forEach(function (theme) {
            cache.themes[theme] = {data: results[1][theme], etag: etag, mime: mime.lookup("css")};
        });

        cache.modes = {};
        Object.keys(results[2]).forEach(function (mode) {
            cache.modes[mode] = {data: results[2][mode], etag: etag, mime: mime.lookup("js")};
        });

        // callback(null, cache);
        addGzip(cache, callback);
    });
};

// Create gzip compressed data
function addGzip(cache, callback) {
    async.series([
        function (cb) { gzipMap(cache.res, cb); },
        function (cb) { gzipMap(cache.themes, cb); },
        function (cb) { gzipMap(cache.modes, cb); }
    ], function (err, results) {
        if (err) callback(err);
        cache.res = results[0];
        cache.themes = results[1];
        cache.modes = results[2];
        callback(null, cache);
    });
}

function gzipMap(map, callback) {
    var names = Object.keys(map);
    var dataFunctions = [];
    names.forEach(function (name) {
        dataFunctions.push(function (fcb) { gzip(map[name].data, fcb); });
    });
    async.parallel(dataFunctions, function (err, results) {
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
                if (doMinify)
                    themes[name.replace(".css", "")] = cleanCSS.minify(data[index].toString());
                else
                    themes[name.replace(".css", "")] = data[index].toString();
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

    var cbDue = 0, cbFired = 0, ret = {};
    Object.keys(modes).forEach(function (mode) {
        cbDue++;
        fs.readFile(path.join(modesPath, mode, mode + ".js"), function (err, data) {
            if (err) callback(err);
            cbFired++;

            if (doMinify)
                ret[mode] = uglify.minify(data.toString(), {fromString: true, compress: {unsafe: true, screw_ie8: true}}).code;
            else
                ret[mode] = data.toString();

            if (cbFired === cbDue) callback(null, ret);
        });
    });
}

function compileResources(callback) {
    var resData  = {}, resCache = {},
        out      = { css : "", js  : "" };

    // Read resources
    Object.keys(files).forEach(function (type) {
        resData[type] = files[type].map(function read(file) {
            var data;
            try {
                data = fs.readFileSync(path.join(paths.module, file)).toString("utf8");
            } catch (error) {
                return callback(error);
            }
            return data;
        });
    });

    // Concatenate CSS and JS
    resData.css.forEach(function (data) {
        out.css += data + "\n";
    });

    // Append a semicolon to each javascript
    resData.js.forEach(function (data) {
        out.js += data + ";\n";
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
            .produceFunction("t." + files.templates[index].replace(/\.dotjs$/, "")
            .split("/").slice(2).join("."), data);
    });
    templateCode += ";";
    out.js = out.js.replace("/* {{ templates }} */", templateCode);

    // Add CSS vendor prefixes
    out.css = autoprefixer({browsers: "last 2 versions"}).process(out.css).css;

    if (doMinify) {
        out.js  = uglify.minify(out.js, { fromString: true, compress: { unsafe: true, screw_ie8: true } }).code;
        out.css = cleanCSS.minify(out.css);
    }

    // Save compiled resources
    var etag = crypto.createHash("md5").update(String(Date.now())).digest("hex");

    while (files.html.length) {
        var name = path.basename(files.html.pop()),
            data = resData.html.pop().replace(/\n^\s*/gm, "").replace("{{version}}", pkg.version); // Prepare HTML by removing tabs, CRs and LFs

        resCache[name] = {data: data, etag: etag, mime: mime.lookup(".html")};
    }

    resCache["client.js"] = {data: out.js, etag: etag, mime: mime.lookup("js")};
    resCache["style.css"] = {data: out.css, etag: etag, mime: mime.lookup("css")};

    // Read misc files
    files.other.forEach(function (file) {
        var data, date,
            name     = path.basename(file),
            fullPath = path.join(paths.module, file);

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
