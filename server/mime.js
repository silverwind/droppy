"use strict";

var mimeTypes = require("mime-types");

var overridesExt = {
  m4v : "video/mp4", // https://bugzilla.mozilla.org/show_bug.cgi?id=875573
  mp4v: "video/mp4"  // https://bugzilla.mozilla.org/show_bug.cgi?id=875573
};

module.exports = function lookup(path) {
  var ext = extractExt(path);
  if (overridesExt[ext])
    return overridesExt[ext];
  else
    return mimeTypes.lookup(ext) || "application/octet-stream";
};

function extractExt(filename) {
  if (!filename) return "";
  var parts = filename.split(".");
  if (parts.length === 1 || (parts[0] === "" && parts.length === 2))
    return parts[parts.length - 1];
  else
    return parts.pop().toLowerCase();
}
