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

exports.objToFlatArray = function flatten(ob) {
    var toReturn = [];
    for (var i in ob) {
        if (!ob.hasOwnProperty(i)) continue;
        if ((typeof ob[i]) === 'object') {
            var flatObject = flatten(ob[i]);
            for (var x in flatObject) {
                if (!flatObject.hasOwnProperty(x)) continue;
                toReturn.push(flatObject[x]);
            }
        } else {
            toReturn[i] = ob[i];
        }
    }
    return toReturn;
}

exports.logo = [
    "....__..............................\n",
    ".--|  |----.-----.-----.-----.--.--.\n",
    "|  _  |   _|  _  |  _  |  _  |  |  |\n",
    "|_____|__| |_____|   __|   __|___  |\n",
    ".................|__|..|__|..|_____|\n"
].join("");