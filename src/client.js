/* globals Modernizr */
(function ($, window, document) {
    "use strict";

    var debug; // live css reload and debug logging - this variable is set by the server
    var smallScreen = $(window).width() < 640;

    var currentData, currentFolder, hasLoggedOut, isAnimating,
        isUploading, savedParts, socket, socketWait;

    initVariables(); // Separately init the variables so we can init them on demand

// ============================================================================
//  Set up a few things before we start
// ============================================================================
    // Add the dataTransfer property to the "drop" event.
    $.event.props.push("dataTransfer");

    // Shorthand for safe event listeners
    $.fn.register = function (events, callback) {
        return this.off(events).on(events, callback);
    };

    // Set a new class on an element, and make sure it is ready to be transitioned.
    $.fn.setTransitionClass = function (newclass) {
        if (Modernizr.cssanimations) {
            // Add a pseudo-animation to the element. When the "animationstart" event
            // is fired on the element, we know it is ready to be transitioned.
            this.css("animation", "nodeInserted 0.001s");

            // Set the new class as a data attribute.
            this.data("newclass", newclass);
        } else {
            // If we don't support animations, fallback to a simple timeout
            setTimeout(function () {
                this.attr("class", newclass);
            }, 30);
        }
        return this;
    };

    if (Modernizr.cssanimations) {
        // Listen for the animation event for our pseudo-animation
        ["animationstart", "webkitAnimationStart", "mozAnimationStart", "MSAnimationStart"].forEach(function (eventName) {
            document.addEventListener(eventName, function (event) {
                if (event.animationName === "nodeInserted") {
                    var target = $(event.target);
                    var newClass = target.data("newclass");
                    // Clean up our data attribute and remove the animation
                    target.removeData("newclass").css("animation", "");
                    // Set the transition class
                    target.attr("class", newClass);
                }
            }, false);
        });
    }

    // Add a modernizr test for directory input
    // [Landed] https://github.com/Modernizr/Modernizr/pull/965
    Modernizr.addTest("fileinputdirectory", function () {
        var elem = document.createElement("input"), dir = "directory";
        elem.type = "file";
        if (dir in elem) {
            return true;
        } else {
            for (var i = 0, len = Modernizr._domPrefixes.length; i < len; i++) {
                if (Modernizr._domPrefixes[i] + dir in elem) {
                    return true;
                }
            }
        }
        return false;
    });

    // Alias requestAnimationFrame
    var requestAnimation = (function () {
        return window.requestAnimationFrame || window.mozRequestAnimationFrame ||
               window.webkitRequestAnimationFrame || function (callback) { setTimeout(callback, 1000 / 60); };
    })();
// ============================================================================
//  Page loading functions
// ============================================================================
    $(getPage);

    function getPage() {
        $.ajax({
            // Append a few random characters to avoid any caching
            url: "/content/" + Math.random().toString(36).substr(2, 4),
            success: function (data, textStatus, request) {
                load(request.getResponseHeader("X-Page-Type"), data);
            },
            error: function () {
                setTimeout(getPage, 500);
            }
        });
    }

    // Switch the page content with an animation
    // TODO: Clean up
    function load(type, data) {
        $("body").append('<div id="newpage">' + data + '</div>');
        var newPage = $("#newpage"),
            oldPage = $("#page"),
            login = $("#login-form");
        if (type === "main") {
            hasLoggedOut = false;
            initMainPage();
            requestAnimation(function () {
                oldPage.attr("class", "out");
                login.removeClass("in").addClass("out");
                setTimeout(function () {
                    $("#navigation").attr("class", "in");
                    setTimeout(function () {
                        finalize();
                    }, 250);
                }, 250);
            });
        } else if (type === "auth") {
            initAuthPage();
            redraw();
            requestAnimation(function () {
                oldPage.attr("class", "out");
                $("#navigation").addClass("out");
                setTimeout(function () {
                    login.removeClass("out").addClass("in");
                    setTimeout(function () {
                        finalize();
                        if (hasLoggedOut) {
                            setTimeout(function () {
                                $("#login-info-box").attr("class", "info");
                                $("#login-info").html("Logged out!");
                                setTimeout(function () {
                                    $("#login-info-box").removeClass("info error");
                                }, 3000);
                            }, 250);
                        }
                    }, 250);
                }, 250);
            });
        }

        // Switch ID of #newpage for further animation
        function finalize() {
            oldPage.remove();
            newPage.attr("id", "page");
        }
    }

// ============================================================================
//  WebSocket functions
// ============================================================================
    var queuedData, reopen;
    function openSocket() {
        var protocol = document.location.protocol === "https:" ? "wss://" : "ws://";
        socket = new WebSocket(protocol + document.location.host + "/websocket");

        socket.onopen = function () {
            if (queuedData) {
                sendMessage();
            } else
                updateLocation(currentFolder || "/", false); // Request initial update
        };

        socket.onclose = function (event) {
            if (hasLoggedOut || event.code === 4000) return;
            if (event.code >= 1002 && event.code < 3999) {
                log("Websocket closed unexpectedly with code " + event.code + ". Reconnecting...");
                openSocket();
            } else if (reopen) {
                reopen = false;
                openSocket();
            }
        };

        socket.onmessage = function (event) {
            socketWait = false;
            var msg = JSON.parse(event.data);
            switch (msg.type) {
            case "UPDATE_FILES":
                if (isUploading) return;
                updateData(msg.folder, msg.data);
                break;
            case "UPLOAD_DONE":
                finishUpload(msg);
                break;
            case "NEW_FOLDER":
                if (isUploading) return;
                updateData(msg.folder, msg.data);
                break;
            case "UPDATE_CSS":
                if (debug) {
                    // Live reload the stylesheet(s) for easy designing
                    $('link[rel="stylesheet"]').remove();

                    var i = 0;
                    while (document.styleSheets[i])
                        document.styleSheets[i++].disabled = true;

                    var style = $('<style type="text/css"></style>');
                    style.text(msg.css).appendTo($("head"));
                }
                break;
            case "SHORTLINK":
                // TODO: UI for this
                window.prompt("Shortlink:", window.location.protocol + "//" + window.location.host + "/get/" +  msg.link);
                break;
            case "USER_LIST":
                console.log(msg.users);
                break;
            }
        };
    }

    function sendMessage(msgType, msgData) {
        if (socket.readyState === 1) { // open
            // Lock the UI while we wait for a socket response
            socketWait = true;

            // Unlock the UI in case we get no socket resonse after waiting for 1 second
            setTimeout(function () {
                socketWait = false;
            }, 1000);

            if (queuedData) {
                socket.send(queuedData);
                queuedData = false;
            } else
                socket.send(JSON.stringify({type: msgType, data: msgData}));
        } else {
            // We can't send right now, so queue up the last added message to be sent later
            queuedData = JSON.stringify({type: msgType, data: msgData});

            if (socket.readyState === 2) { // closing
                // Socket is closing, queue a re-opening
                reopen = true;
            } else if (socket.readyState === 3) { // closed
                // Socket is closed, we can re-open it right now
                openSocket();
            }
        }
    }

    // Close the socket gracefully before navigating away
    $(window).register("beforeunload", function () {
        if (socket && socket.readyState < 2)
            socket.close(1001);
    });

// ============================================================================
//  Authentication page
// ============================================================================
    var du, dp;

    function initAuthPage() {
        var loginform = $("#login-form"),
            submit    = $("#submit"),
            form      = $("#form");

        // Switch in username and password fields from a dummy form in the
        // base page. This allows password saving in all browsers. Chrome
        // additionally needs the form to submit to an actual URL, so we add
        // an iframe where Chrome can POST to.
        // Relevant bugs:
        // [Fixed: Firefox 26] https://bugzilla.mozilla.org/show_bug.cgi?id=355063
        // [Partially Fixed: Chrome 28] http://code.google.com/p/chromium/issues/detail?id=43219
        if ($("#dummy-user").length) {
            // Store a copy of the old inputs
            du = $("#dummy-user").clone();
            dp = $("#dummy-pass").clone();
            // Move the dummies in place
            $("#dummy-pass").prependTo(form);
            $("#dummy-user").prependTo(form);
        } else {
            // On further logins, restore our copies
            dp.prependTo(form);
            du.prependTo(form);
        }

        // Auto-focus the user input on load
        $("#user").focus();

        // Remove invalid class on user action
        $(".login-input").register("click keydown focus", function () {
            $("#login-info-box").removeClass("info error");
            submit.removeClass("invalid");
            loginform.removeClass("invalid");
        });

        // Return submits the form
        $(".login-input").register("keyup", function (event) {
            if (event.keyCode === 13) {
                submitForm();
            }
        });

        // Spacebar toggles the checkbox
        $("#remember").register("keyup", function (event) {
            if (event.keyCode === 32) {
                $("#check").trigger("click");
            }
        });

        // Submit the form over Ajax, but also let it submit over
        // a normal POST, which just goes into the iframe.
        form.register("submit", function () {
            submitForm();
        });

        function submitForm() {
            $.ajax({
                type: "POST",
                url: "/login",
                dataType: "json",
                data: form.serialize(),
                success: function (response) {
                    if (response === "OK") {
                        hasLoggedOut = false;
                        getPage();
                    } else {
                        $("#pass").val("");
                        $("#dummy-pass").val("");
                        submit.addClass("invalid");
                        loginform.addClass("invalid");
                        if ($("#login-info-box").hasClass("info") || $("#login-info-box").hasClass("error")) {
                            $("#login-info").addClass("shake");
                            setTimeout(function () {
                                $("#login-info").removeClass("shake");
                            }, 500);
                        } else {
                            $("#login-info-box").addClass("error");
                            $("#login-info").html("Wrong login!");
                            setTimeout(function () {
                                $("#login-info-box").removeClass("info error");
                            }, 3000);
                        }
                    }
                }
            });
        }
    }
// ============================================================================
//  Main page
// ============================================================================
    function initMainPage() {
        // Initialize the current folder, in case the user navigated to it through the URL.
        currentFolder = decodeURIComponent(window.location.pathname);

        // Open the WebSocket
        openSocket();

        // Stop dragenter and dragover from killing our drop event
        $(document.documentElement).register("dragenter", function (event) { event.preventDefault(); });
        $(document.documentElement).register("dragover", function (event) { event.preventDefault(); });
        // Catch the spacebar to avoid a scrolling bug in Firefox
        $(document.documentElement).register("keydown", function (event) { if (event.keyCode === 32) event.preventDefault(); });

        // File drop handler
        $(document.documentElement).register("drop", function (event) {
            event.stopPropagation();
            event.preventDefault();

            // Check if we support GetAsEntry();
            if (!event.dataTransfer.items || !event.dataTransfer.items[0].webkitGetAsEntry()) {
                // No support, fallback to normal File API
                upload(event.dataTransfer.files, true);
                return;
            }
            // We support GetAsEntry, go ahead and read recursively
            var obj = {};
            var cbCount = 0, cbFired = 0, dirCount = 0;
            var length = event.dataTransfer.items.length;
            for (var i = 0; i < length; i++) {
                var entry = event.dataTransfer.items[i].webkitGetAsEntry();
                if (!entry) continue;
                if (entry.isFile) {
                    cbCount++;
                    entry.file(function (file) {
                        obj[file.name] = file;
                        cbFired++;
                    }, function () { cbFired++; });
                } else if (entry.isDirectory) {
                    dirCount++;
                    (function readDirectory(entry, path) {
                        if (!path) path = entry.name;
                        obj[path] = {};
                        entry.createReader().readEntries(function (entries) {
                            for (var i = 0; i < entries.length; i++) {
                                if (entries[i].isDirectory) {
                                    dirCount++;
                                    readDirectory(entries[i], path + "/" + entries[i].name);
                                } else {
                                    cbCount++;
                                    entries[i].file(function (file) {
                                        obj[path + "/" + file.name] = file;
                                        cbFired++;
                                    }, function () { cbFired++; });
                                }
                            }
                        });
                    })(entry);
                }
            }

            // TODO: Uploading just empty folders without any files runs into the timeout
            // Possible solution would be to send the folder creations over the websocket
            // as we can't send empty FormData.
            (function wait(timeout) {
                if (timeout > 10000) {
                    log("Timeout waiting for files to be read");
                    return;
                } else {
                    if (cbCount > 0 && cbFired === cbCount) {
                        log("Got " + cbFired + " files in " + dirCount + " directories.");
                        upload(obj);
                    } else {
                        setTimeout(wait, timeout + 50, timeout + 50);
                    }
                }
            })(50);
        });

        // Re-fit path line after 100ms of no resizing
        var resizeTimeout;
        $(window).register("resize", function () {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(function () {
                smallScreen = $(window).width() < 640;
                checkPathOverflow();
            }, 100);
        });

        var fileInput = $("#file");
        fileInput.register("change", function (event) {
            if (Modernizr.fileinputdirectory && event.target.files.length > 0 && "webkitRelativePath" in event.target.files[0]) {
                var files = event.target.files;
                var obj = {};
                for (var i = 0; i < files.length; i++) {
                    var path = files[i].webkitRelativePath;
                    if (path) {
                        obj[path.substring(0, path.indexOf(files[i].name) - 1)] = {};
                        obj[path] = files[i];
                    } else {
                        obj[files[i].name] = files[i];
                    }
                }
                upload(obj);
            } else if ($("#file").val()) {
                upload($("#file").get(0).files, true);
            }
            $("#file").val(""); // Reset the input
        });

        // File upload button
        $("#upload-file").register("click", function () {
            // Remove the directory attributes so we get a file picker dialog
            if (Modernizr.inputdirectory)
                fileInput.removeAttr("directory msdirectory mozdirectory webkitdirectory");
            fileInput.click();
        });

        // Folder upload button - check if we support directory uploads
        if (Modernizr.inputdirectory) {
            // Directory uploads supported - enable the button
            $("#upload-folder").register("click", function () {
                // Set the directory attribute so we get a directory picker dialog
                fileInput.attr({
                    directory: "directory",
                    msdirectory: "msdirectory",
                    mozdirectory: "mozdirectory",
                    webkitdirectory: "webkitdirectory"
                });
                fileInput.click();
            });
        } else {
            // No directory upload support - disable the button (might be better to remove it completely)
            $("#upload-folder").css("color", "#444").attr("title", "Sorry, your browser doesn't support directory uploading yet!");
        }

        var info         = $("#create-folder-info"),
            nameinput    = $("#create-folder-input"),
            createbox    = $("#create-folder-box"),
            createButton = $("#create-folder-button"),
            indicators   = $("#create-folder-button, #create-folder-input"),
            activeFiles;

        // Show popup for folder creation
        $("#create-folder").register("click", function () {
            requestAnimation(function () {
                createbox.attr("class", createbox.attr("class") !== "in" ? "in" : "out");
                setTimeout(function () {
                    if (createbox.attr("class") === "in") {
                        toggleCatcher();
                        activeFiles = [];
                        $(".filelink, .folderlink").each(function () {
                            activeFiles.push($(this).html().toLowerCase());
                        });
                        nameinput.focus();
                    }
                }, 300);
            });
        });

        // Handler for the input of the folder name
        nameinput.register("keyup", function (event) {
            if (event.keyCode === 27) { // Escape Key
                createbox.attr("class", "out");
                toggleCatcher();
            }
            var input = nameinput.val();
            var valid = !input.match(/[\\*{}\/<>?|]/) && !input.match(/^(\.+)$/);
            var folderExists;
            for (var i = 0, len = activeFiles.length; i < len; i++)
                if (activeFiles[i] === input.toLowerCase()) {
                    folderExists = true;
                    break;
                }
            if (input === "") {
                createButton.off("click");
                indicators.removeClass("invalid");
                info.removeClass();
            } else if (!valid || folderExists) {
                createButton.off("click");
                indicators.addClass("invalid");
                info.html(folderExists ? "Already exists!" : "Invalid characters!");
                info.attr("class", "in");
            } else {
                createButton.register("click", createFolderAndHide);
                if (event.keyCode === 13) // Return Key
                    createFolderAndHide();
            }
        });

        function createFolderAndHide() {
            var folderName = (currentFolder === "/") ? "/" + nameinput.val() : currentFolder + "/" + nameinput.val();
            sendMessage("CREATE_FOLDER", folderName);
            createbox.attr("class", "out");
            toggleCatcher();

            // Clean up after creation
            createButton.off("click");
            nameinput.val("");
            indicators.removeClass("invalid");
            info.removeClass();
        }

        var aboutbox  = $("#about-box"),
            configbox = $("#config-box");

        $("#about").register("click", function () {
            requestAnimation(function () {
                aboutbox.attr("class", aboutbox.attr("class") !== "in" ? "in" : "out");
                toggleCatcher();
            });
        });

        $("#config").register("click", function () {
            requestAnimation(function () {
                configbox.attr("class", configbox.attr("class") !== "in" ? "in" : "out");
                sendMessage("GET_USERS");
                toggleCatcher();
            });
        });

        $(".user-entry").register("click", function () {
            $(this)
                .toggleClass("user-highlight");
            $(this).find(".user-edit")
                .toggleClass("edit-hidden")
                .toggleClass("edit-shown")
                .toggleClass("user-highlight");

            $(this).siblings()
                .removeClass("user-highlight");
            $(this).siblings().find(".user-edit")
                .removeClass("edit-shown")
                .addClass("edit-hidden")
                .removeClass("user-highlight");
        });

        $("#click-catcher").register("click", function () {
            $("#click-catcher").attr("class", "out");
            createbox.attr("class", "out");
            aboutbox.attr("class", "out");
            configbox.attr("class", "out");
        });

        $("#logout").register("click", function () {
            hasLoggedOut = true;
            socket && socket.close(4001);
            deleteCookie("sid");
            initVariables(); // Reset vars to their init state
            getPage();
        });

        // ============================================================================
        //  Helper functions for the main page
        // ============================================================================
        var numFiles = 0;
        function upload(data, isArray) {
            var formData = new FormData();
            numFiles = 0;
            if (!data) return;
            if (isArray) { // We got a normal File array
                if (data.length === 0) return;
                for (var i = 0, len = data.length; i < len; i++) {
                    numFiles++;
                    currentData[data[i].name] = {
                        size  : data[i].size,
                        type  : "nf",
                        mtime : new Date().getTime()
                    };
                    formData.append(data[i].name, data[i]);
                }
            } else { // We got an object for recursive folder uploads
                var addedDirs = {};
                for (var path in data) {
                    formData.append(path, data[path], path);
                    var name = (path.indexOf("/") > 1) ? path.substring(0, path.indexOf("/")) : path;
                    switch (Object.prototype.toString.call(data[path])) {
                    case "[object Object]":
                        if (!addedDirs[name] && data.hasOwnProperty(path)) {
                            currentData[name] = {
                                size : 0,
                                type : "nd"
                            };
                            addedDirs[name] = true;
                        }
                        break;
                    case "[object File]":
                        numFiles++;
                        if (!addedDirs[name]) {
                            currentData[name] = {
                                size  : data[path].size,
                                type  : "nf",
                                mtime : new Date().getTime()
                            };
                        }
                        break;
                    }
                }
            }

            // Load the new files into view, tagged
            buildHTML(currentData, currentFolder);

            // Create the XHR2
            var xhr = new XMLHttpRequest();
            xhr.upload.addEventListener("progress", uploadProgress, false);
            xhr.upload.addEventListener("load", uploadDone, false);
            xhr.upload.addEventListener("error", uploadDone, false);

            // Init the UI
            uploadInit(xhr);

            // And send the files
            isUploading = true;
            xhr.open("post", "/upload", true);
            xhr.send(formData);
        }

        var start, lastUpdate,
            timeleft = $("#upload-time-left"),
            prog     = $("#upload-bar-inner"),
            title    = $("#upload-title"),
            uperc    = $("#upload-percentage");

        function uploadInit(xhr) {
            $("#upload-cancel").register("click", function () {
                xhr.abort();
                uploadDone();
            });

            start = new Date().getTime();

            title.html(numFiles < 2 ? "Uploading..." : "Uploading " + numFiles + " files...");
            updateTitle("0%");
            uperc.html("0%");

            prog.css("width", "0%");
            timeleft.html("");
            $("#upload-info").attr("class", "in");
        }

        function uploadDone() {
            prog.css("width", "100%");
            finishUpload();
        }

        function uploadProgress(event) {
            if (!event.lengthComputable) return;

            // Update progress every 250ms at most
            if (!lastUpdate || (Number(new Date()) - lastUpdate) >= 250) {
                lastUpdate = Number(new Date());

                var bytesSent  = event.loaded,
                    bytesTotal = event.total,
                    progress   = Math.round((bytesSent / bytesTotal) * 100) + "%";

                prog.css("width", progress);
                updateTitle(progress);
                uperc.html(progress);

                // Calculate estimated time left
                var elapsed = (new Date().getTime()) - start;
                var estimate = bytesTotal / (bytesSent / elapsed);
                var secs = (estimate - elapsed) / 1000;

                if (secs > 60) {
                    timeleft.html(Math.ceil(secs / 60) + " mins left");
                } else {
                    timeleft.html(Math.ceil(secs) + " secs left");
                }
            }
        }

        // Toggle the full-screen click catching frame to exit modal dialogs
        function toggleCatcher() {
            if (aboutbox.attr("class") === "in"  ||
                createbox.attr("class") === "in" ||
                configbox.attr("class") === "in"
            ) {
                $("#click-catcher").attr("class", "in");
            } else
                $("#click-catcher").attr("class", "out");
        }
    }
// ============================================================================
//  General helpers
// ============================================================================
    // Update data as received from the server
    function updateData(folder, data) {
        if (folder !== currentFolder)
            updateLocation(folder);

        updateTitle(folder, true);
        updatePath(folder);
        currentData = data;
        buildHTML(data, folder);
    }

    // Update the page title and trim a path to its basename
    function updateTitle(text, isPath) {
        var prefix = "", suffix = "droppy";
        if (isPath) {
            var parts = text.match(/([^\/]+)/gm);
            prefix = parts ? parts[parts.length - 1] : "/";
        } else {
            prefix = text;
        }
        document.title = [prefix, suffix].join(" - ");
    }

    function finishUpload(msg) {
        isUploading = false;
        updateLocation(currentFolder, false);
        updateTitle(currentFolder, true);
        msg && updateData(msg.folder, msg.data);
        $("#upload-info").attr("class", "out");
    }

    // Listen for popstate events, which indicate the user navigated back
    $(window).register("popstate", function () {
        (function queue(time) {
            if ((!socketWait && !isAnimating) || time > 2000)
                updateLocation(decodeURIComponent(window.location.pathname), true, true);
            else
                setTimeout(queue, 50, time + 50);
        })(0);
    });

    // Update our current location and change the URL to it
    var nav;
    function updateLocation(path, doSwitch, skipPush) {
        // Queue the folder switching if we are mid-animation or waiting for the server
        (function queue(time) {
            if ((!socketWait && !isAnimating) || time > 2000) {
                // Find the direction in which we should animate
                if (path.length > currentFolder.length)
                    nav = "forward";
                else if (path.length === currentFolder.length)
                    nav = "same";
                else
                    nav = "back";

                currentFolder = path;
                sendMessage(doSwitch ? "SWITCH_FOLDER" : "REQUEST_UPDATE", currentFolder);

                // Skip the push if we're already navigating through history
                if (!skipPush) window.history.pushState(null, null, currentFolder);
            } else
                setTimeout(queue, 50, time + 50);
        })(0);
    }

    // Update the path indicator
    function updatePath(path) {
        var parts = path.split("/");
        var i = 0, len, home = "";

        parts[0] = '<span class="icon">' + home + '<span>';
        if (parts[parts.length - 1] === "") parts.pop(); // Remove trailing empty string
        var pathStr = "";
        if (savedParts) {
            i = 1; // Skip the first element as it's always the same
            while (true) {
                pathStr += "/" + parts[i];
                if (!parts[i] && !savedParts[i]) break;
                if (parts[i] !== savedParts[i]) {
                    if (savedParts[i] && !parts[i]) {
                        $("#path li").slice(i).remove();
                        break;
                    }
                    else if (parts[i] && !savedParts[i])
                        create(parts[i], pathStr);
                }
                i++;
            }
            requestAnimation(finalize);
        } else {
            // Delay initial slide-in
            setTimeout(function () {
                $(".placeholder").remove(); // Invisible placeholder so height:auto works during the initial animation
                create(parts[0]);
                for (i = 1, len = parts.length; i < len; i++) {
                    pathStr += "/" + parts[i];
                    create(parts[i], pathStr);
                }
                requestAnimation(finalize);
            }, 300);
        }

        savedParts = parts;

        function create(name, path) {
            var li = $("<li class='out'>" + name + "</li>");
            li.data("destination", path || "/");
            li.click(function () {
                updateLocation($(this).data("destination"), true);
            });

            $("#path").append(li);
        }

        function finalize() {
            $("#path li.out").setTransitionClass("in");
            setTimeout(function () {
                // Remove the class after the transition and keep the list scrolled to the last element
                $("#path li.in").removeClass();
                checkPathOverflow();
            }, 300);
        }
    }

    // Check if the path indicator overflows and scroll it if neccessary
    function checkPathOverflow() {
        var last = $("#path li:last-child");
        if (!last.position()) return;
        var margin = smallScreen ? 95 : 110;
        var space = $(window).width();
        var right = last.position().left + last.width();

        if ((right + margin) > space) {
            var needed = right - space + margin;
            requestAnimation(function () {
                $("#path").animate({"left": -needed}, {duration: 200});
            });
        } else {
            requestAnimation(function () {
                if ($("#path").css("left") !== 0)
                    $("#path").animate({"left": 0}, {duration: 200});
            });
        }
    }

    // Convert the received data into HTML
    function buildHTML(fileList, root) {
        var list = $("<ul></ul>"), downloadURL, type, size, mtime, id, tags;

        for (var file in fileList) {
            type = fileList[file].type;
            size = convertToSI(fileList[file].size);
            mtime = fileList[file].mtime ? formatTime(new Date(fileList[file].mtime)) : "";
            // mtime = "a";
            id = (root === "/") ? "/" + file : root + "/" + file;
            tags = (type === "nf" || type === "nd") ? " tag-uploading" : "";

            if (type === "f" || type === "nf") { // Create a file row
                downloadURL = window.location.protocol + "//" + window.location.host + "/get" + id;
                var spriteClass = getSpriteClass(extractExtension(file));
                list.append(
                    '<li class="data-row" data-type="file" data-id="' + id + '"><span class="' + spriteClass + '"></span>' +
                    '<a class="filelink ' + tags + '" href="' + downloadURL + '" download="' + file + '">' + file + '</a>' +
                    '<span class="icon-delete icon"></span>' +
                    '<span class="icon-link icon"></span>' +
                    '<span class="data-info">' + size + '</span>' +
                    '<span class="data-mtime">' + mtime + '</span></li>'
                );
            } else if (type === "d" || type === "nd") {  // Create a folder row
                list.append(
                    '<li class="data-row" data-type="folder" data-id="' + id + '"><span class="sprite sprite-folder"></span>' +
                    '<span class="folderlink ' + tags + '">' + file + '</span><span class="icon-delete icon"></span></li>'
                );
            }
        }

        $(list).children("li").sort(function (a, b) {
            var type = $(b).data("type").toUpperCase().localeCompare($(a).data("type").toUpperCase());
            var extension = extractExtension($(a).children(".filelink").text().toUpperCase())
                                 .localeCompare(extractExtension($(b).children(".filelink").text().toUpperCase()));
            var text = $(a).text().toUpperCase().localeCompare($(b).text().toUpperCase());
            if (type < 0)
                return -1;
            else if (type > 0)
                return 1;
            else {
                if (extension < 0)
                    return -1;
                else if (extension > 0)
                    return 1;
                else {
                    if (text < 0)
                        return -1;
                    else if (text > 0)
                        return 1;
                    else
                        return 0;
                }
            }
        }).appendTo(list);

        loadContent($(list).children("li").length > 0 ? list : false);
    }

    // Load generated list into view with an animation
    function loadContent(list) {
        var emptyPage = '<div id="empty"><div id="empty-text">There appears to be<br>nothing here. Drop files<br>into this window or<br><span id="upload-inline"><span class="icon"></span> Add files</span></div></div>';

        requestAnimation(function () {
            if (nav === "same") {
                $("#content").attr("class", "center");
                $("#content").html(list || emptyPage);
            } else {
                $("#page").append($("<section id='newcontent' class='" + nav + "'></section>"));
                $("#newcontent").html(list || emptyPage);
                isAnimating = true;
                $(".data-row").addClass("animating");
                $("#content").attr("class", (nav === "forward") ? "back" : "forward");
                $("#newcontent").setTransitionClass("center");

                // Switch classes once the transition has finished
                setTimeout(function () {
                    isAnimating = false;
                    $("#content").remove();
                    $("#newcontent").attr("id", "content");
                    $(".data-row").removeClass("animating");
                }, 250);
            }
            redraw();
            bindEvents();
            nav = "same";
        });
    }

    // Bind click events to the list elements
    function bindEvents() {
        // Upload icon on empty page
        $("#upload-inline").register("click", function () {
            $("#file").click();
        });

        // Switch into a folder
        $(".data-row[data-type='folder']").register("click", function () {
            if (socketWait) return;
            var destination = $(this).data("id");
            updateLocation(destination, true);
        });

        // Request a shortlink
        $(".icon-link").register("click", function () {
            if (socketWait) return;
            sendMessage("REQUEST_SHORTLINK", $(this).parent().data("id"));
        });

        // Delete a file/folder
        $(".icon-delete").register("click", function () {
            if (socketWait) return;
            sendMessage("DELETE_FILE", $(this).parent().data("id"));
        });
    }

    // Extract the extension from a file name
    function extractExtension(filename) {
        var dot = filename.lastIndexOf(".");
        if (dot > -1 && dot < filename.length)
            return filename.substring(dot + 1, filename.length);
        else
            return filename;
    }

    function deleteCookie(name) {
        document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:01 GMT;";
    }

    function initVariables() {
        currentData = false;
        currentFolder = false;
        isUploading = false;
        savedParts = false;
        socket = false;
        socketWait = false;
    }

    // Convert raw byte numbers to SI values
    function convertToSI(bytes) {
        var step = 0, units = ["B", "KiB", "MiB", "GiB", "TiB"];
        while (bytes >= 1024) {
            bytes /= 1024;
            step++;
        }
        return [(step === 0) ? bytes : Math.round(bytes), units[step]].join(" ");
    }

    // This seems to fix weird Webkit rendering after animations
    function redraw() {
        $("<style>").appendTo($(document.body)).remove();
    }

    // Fix console.log on IE9
    if (Function.prototype.bind && console && typeof console.log === "object") {
        console.log = Function.prototype.bind.call(console.log, console);
    }

    // Debug logging
    function log() {
        if (debug && console)
            console.log.apply(console, arguments);
    }

    // Find the corrects class for an icon sprite
    function getSpriteClass(extension) {
        for (var type in iconmap) {
            if (iconmap[type.toLowerCase()].indexOf(extension.toLowerCase()) > -1) {
                return "sprite sprite-" + type;
            }
        }
        return "sprite sprite-bin";
    }

    // Extension to Icon mappings
    var iconmap = {
        "archive":  ["bz2", "gz", "tgz"],
        "audio":    ["aif", "flac", "m4a", "mid", "mp3", "mpa", "ra", "ogg", "wav", "wma"],
        "authors":  ["authors"],
        "bin":      ["class", "o", "so"],
        "bmp":      ["bmp"],
        "c":        ["c"],
        "calc":     ["ods", "ots", "xlr", "xls", "xlsx"],
        "cd":       ["cue", "iso"],
        "copying":  ["copying", "license"],
        "cpp":      ["cpp"],
        "css":      ["css", "less", "scss", "sass"],
        "deb":      ["deb"],
        "diff":     ["diff", "patch"],
        "doc":      ["doc", "docx", "odm", "odt", "ott"],
        "draw":     ["drw"],
        "eps":      ["eps"],
        "exe":      ["bat", "cmd", "exe"],
        "gif":      ["gif"],
        "gzip":     ["gz"],
        "h":        ["h"],
        "hpp":      ["hpp"],
        "html":     ["htm", "html", "shtml"],
        "ico":      ["ico"],
        "image":    ["svg", "xpm"],
        "install":  ["install", "msi"],
        "java":     ["java"],
        "jpg":      ["jpg", "jpeg"],
        "js":       ["js"],
        "json":     ["json"],
        "log":      ["log", "changelog"],
        "makefile": ["makefile", "pom"],
        "markdown": ["markdown", "md"],
        "pdf":      ["pdf"],
        "php":      ["php"],
        "playlist": ["m3u", "m3u8", "pls"],
        "png":      ["png"],
        "pres":     ["odp", "otp", "pps", "ppt", "pptx"],
        "ps":       ["ps", "ttf", "otf", "woff", "eot"],
        "psd":      ["psd"],
        "py":       ["py"],
        "rar":      ["rar"],
        "rb":       ["rb"],
        "readme":   ["readme"],
        "rpm":      ["rpm"],
        "rss":      ["rss"],
        "rtf":      ["rtf"],
        "script":   ["conf", "csh", "ini", "ksh", "sh", "shar", "tcl"],
        "tar":      ["tar"],
        "tex":      ["tex"],
        "text":     ["text", "txt"],
        "tiff":     ["tiff"],
        "vcal":     ["vcal"],
        "video":    ["avi", "flv", "mkv", "mov", "mp4", "mpg", "rm", "swf", "vob", "wmv"],
        "xml":      ["xml"],
        "zip":      ["7z", "bz2", "jar", "lzma", "war", "z", "Z", "zip"]
    };

    function formatTime(date) {
        var day   = date.getDate(),
            month = date.getMonth() + 1,
            year  = date.getFullYear(),
            hrs   = date.getHours(),
            mins  = date.getMinutes(),
            secs  = date.getSeconds();

        month < 10 && (month = "0" + month);
        day   < 10 && (day   = "0" + day);
        hrs   < 10 && (hrs   = "0" + hrs);
        mins  < 10 && (mins  = "0" + mins);
        secs  < 10 && (secs  = "0" + secs);

        return year + "-"  + month + "-" + day + " " + hrs + ":" + mins + ":" + secs;
    }

}(jQuery, window, document));