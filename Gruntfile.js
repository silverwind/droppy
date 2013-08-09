module.exports = function (grunt) {
    "use strict";

    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        exec: {
            update_jquery: {
                cmd: 'wget --no-check-certificate https://code.jquery.com/jquery-2.0.3.js -qO src/jquery.js'
            },
            cleanup_npm: {
                cmd: 'rm -rf node_modules'
            },
            update_npm: {
                cmd: 'npm install --save'
            }
        }
    });

    grunt.loadNpmTasks('grunt-exec');

    grunt.registerTask('update', [
        'exec:update_jquery',
        'exec:cleanup_npm',
        'exec:update_npm'
    ]);
};