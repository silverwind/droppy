module.exports = function(grunt) {

  "use strict";

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    exec: {
      update_jquery: {
        cmd: 'wget http://ajax.googleapis.com/ajax/libs/jquery/1/jquery.js -qO res/jquery.js'
      },
      update_form: {
        cmd: 'wget https://github.com/malsup/form/raw/master/jquery.form.js --no-check-certificate -qO res/jquery.form.js'
      },
      update_dropzone: {
        cmd: 'wget https://github.com/enyo/dropzone/raw/master/downloads/dropzone.js --no-check-certificate -qO res/dropzone.js'
      },
      uglify: {
        cmd: 'uglifyjs res/jquery.js res/jquery.form.js res/dropzone.js -m -c -o res/libraries.js'
      }
    }
  });

  grunt.loadNpmTasks('grunt-exec');

  grunt.registerTask('update', [
    'exec:update_jquery',
    'exec:update_form',
    'exec:update_dropzone',
    'exec:uglify'
  ]);
};