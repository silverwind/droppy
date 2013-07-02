"use strict";

exports.debounce = function (func, wait) {
    var timeout, result;
    return function () {
        var context = this, args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(function () {
            timeout = null;
            result = func.apply(context, args);
        }, wait);
        return result;
    };
};

exports.logo = [
    "    __\n",
    ".--|  .----.-----.-----.-----.--.--.\n",
    "|  _  |   _|  _  |  _  |  _  |  |  |\n",
    "|_____|__| |_____|   __|   __|___  |\n",
    "                 |__|  |__|  |_____|\n"
].join("");
