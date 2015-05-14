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
            deploy : {
                command: [
                    'if git ls-remote demo -ne 0 &>/dev/null; then git push -f demo master; fi',
                    'if git ls-remote droppy -ne 0 &>/dev/null; then git push -f droppy master; fi',
                ].join(";")
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
    grunt.registerTask("patch",  ["jshint", "bump", "shell:push", "shell:publish", "shell:deploy"]);
    grunt.registerTask("minor",  ["jshint", "bump:minor", "shell:push", "shell:publish", "shell:deploy"]);
    grunt.registerTask("major",  ["jshint", "bump:major", "shell:push", "shell:publish", "shell:deploy"]);
    grunt.registerTask("deploy", ["shell:deploy"]);
    grunt.registerTask("jshint", ["jshint"]);

    grunt.loadNpmTasks("grunt-bump");
    grunt.loadNpmTasks("grunt-shell");
    grunt.loadNpmTasks("grunt-contrib-jshint");
};
