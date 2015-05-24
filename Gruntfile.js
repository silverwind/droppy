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
            deploy: {
                command: [
                    "if git ls-remote demo -ne 0 &>/dev/null; then git push -f demo master; fi",
                    "if git ls-remote droppy -ne 0 &>/dev/null; then git push -f droppy master; fi"
                ].join(";")
            },
            lint: {
                command: "eslint --reset --color --quiet server client *.js"
            }
        }
    });

    grunt.registerTask("update", ["shell:update", "shell:modules"]);
    grunt.registerTask("patch",  ["shell:lint", "bump", "shell:push", "shell:publish", "shell:deploy"]);
    grunt.registerTask("minor",  ["shell:lint", "bump:minor", "shell:push", "shell:publish", "shell:deploy"]);
    grunt.registerTask("major",  ["shell:lint", "bump:major", "shell:push", "shell:publish", "shell:deploy"]);
    grunt.registerTask("deploy", ["shell:deploy"]);
    grunt.registerTask("lint",   ["shell:lint"]);

    grunt.loadNpmTasks("grunt-bump");
    grunt.loadNpmTasks("grunt-shell");
};
