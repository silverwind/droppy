"use strict";

module.exports = function (grunt) {
    grunt.initConfig({
        bump: {
            options: {
                files: ["package.json"],
                updateConfigs: [],
                commit: true,
                commitMessage: "Release v%VERSION%",
                commitFiles: ["package.json"], // "-a" for all files
                createTag: true,
                tagName: "%VERSION%",
                tagMessage: "Version %VERSION%",
                push: true,
                pushTo: "origin",
                gitDescribeOptions: "--tags --always --abbrev=1 --dirty=-d" // options to use with "$ git describe"
            }
        }
    });

    grunt.loadNpmTasks("grunt-bump");
};