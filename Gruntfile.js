module.exports = function (grunt) {

    "use strict";

    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        exec: {
            update_jquery: {
                cmd: 'wget http://ajax.googleapis.com/ajax/libs/jquery/1/jquery.js -qO src/jquery.js'
            },
            update_form: {
                cmd: 'wget https://raw.github.com/malsup/form/master/jquery.form.js --no-check-certificate -qO src/jquery.form.js'
            },
            update_dropzone: {
                cmd: 'wget https://raw.github.com/enyo/dropzone/master/downloads/dropzone.js --no-check-certificate -qO src/dropzone.js'
            }
        }
    });

    grunt.loadNpmTasks('grunt-exec');

    grunt.registerTask('update', [
        'exec:update_jquery',
        'exec:update_form',
        'exec:update_dropzone'
    ]);
};