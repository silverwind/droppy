module.exports = function (grunt) {

    "use strict";

    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        exec: {
            update_jquery: {
                cmd: 'wget http://code.jquery.com/jquery-2.0.1.js -qO src/jquery.js'
            }
        }
    });

    grunt.loadNpmTasks('grunt-exec');

    grunt.registerTask('update', [
        'exec:update_jquery'
    ]);
};