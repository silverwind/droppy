"use strict";

var doMinify,
    cm         = {},
    themes     = {},
    paths      = require("./paths.js"),
    async      = require("async"),
    path       = require("path"),
    fs         = require("graceful-fs"),
    themesPath = path.join(paths.module, "/node_modules/codemirror/theme"),
    modesPath  = path.join(paths.module, "/node_modules/codemirror/mode"),
    cleanCSS   = new require("clean-css")({keepSpecialComments : 0}),
    uglify     = require("uglify-js").minify;

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

cm.init = function init(minify, callback) {
    doMinify = minify || false;
    async.series([initThemes, initModes], function (err, results) {
        if (err) return callback(err);
        callback(null, {
            themes: results[0],
            modes: results[1]
        });
    });
};

function initThemes(callback) {
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

function initModes(callback) {
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
                ret[mode] = uglify(data.toString(), {fromString: true, compress: {unsafe: true, screw_ie8: true}}).code;
            else
                ret[mode] = data.toString();

            if (cbFired === cbDue) callback(null, ret);
        });
    });
}


exports = module.exports = cm;
