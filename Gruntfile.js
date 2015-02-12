"use strict";

module.exports = function (grunt) {
    grunt.initConfig({
        bump: {
            options: {
                files: ["package.json"],
                commit: true,
                commitMessage: "Release %VERSION%",
                commitFiles: ["package.json"],
                createTag: true,
                tagName: "%VERSION%",
                tagMessage: "Version %VERSION%",
                push: false
            }
        },
        shell: {
            options: {
                stdout: true,
                stderr: true,
                failOnError: true
            },
            push: {
                command: "git push -u --tags origin master"
            },
            publish: {
                command: "npm publish"
            },
            update: {
                command: "npm-check-updates -u"
            },
            modules: {
                command: "rm -rf node_modules && npm install"
            },
            heroku : {
                command: "git push -u -f --tags heroku master && heroku logs -t"
            }
        },
        jshint: {
            options: {
                jshintrc: true
            },
            all: [
                "*.js",
                "server/**/*.js",
                "client/client.js"
            ]
        }
    });

    grunt.registerTask("update", ["shell:update", "shell:modules"]);
    grunt.registerTask("patch",  ["jshint", "bump", "shell:push", "shell:publish", "shell:heroku"]);
    grunt.registerTask("minor",  ["jshint", "bump:minor", "shell:push", "shell:publish", "shell:heroku"]);
    grunt.registerTask("major",  ["jshint", "bump:major", "shell:push", "shell:publish", "shell:heroku"]);
    grunt.registerTask("deploy", ["shell:heroku"]);
    grunt.registerTask("jshint", ["jshint"]);

    grunt.loadNpmTasks("grunt-bump");
    grunt.loadNpmTasks("grunt-shell");
    grunt.loadNpmTasks("grunt-contrib-jshint");
};
