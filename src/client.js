"use strict";

(function ($, window, document) {
    var droppy = {};
    droppy.debug = null;  // live css reload and debug logging - this variable is set by the server
    initVariables();
// ============================================================================
//  Feature Detects
// ============================================================================
    droppy.detects = {
        animation : (function () {
            var props = ["animation", "-moz-animation", "-webkit-animation", "-ms-animation"],
                   el = document.createElement("div");
            while (props.length) {
                if (props.pop() in el.style) return true;
            }
            return false;
        })(),
        fileinputdirectory : (function () {
            var props = ["directory", "mozdirectory", "webkitdirectory", "msdirectory"],
                   el = document.createElement("input");
            while (props.length) {
                if (props.pop() in el) return true;
            }
            return false;
        })()
    };
// ============================================================================
//  Set up a few more things
// ============================================================================
    // Add the dataTransfer property to the "drop" event.
    $.event.props.push("dataTransfer");

    // Shorthand for safe event listeners
    $.fn.register = function (events, callback) {
        return this.off(events).on(events, callback);
    };

    // Set a new class on an element, and make sure it is ready to be transitioned.
    $.fn.setTransitionClass = function (newclass) {
        if (droppy.detects.animation) {
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

    if (droppy.detects.animation) {
        // Listen for the animation event for our pseudo-animation
        ["animationstart", "mozAnimationStart", "webkitAnimationStart", "MSAnimationStart"].forEach(function (eventName) {
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

    // Alias requestAnimationFrame
    var requestAnimation = (function () {
        return window.requestAnimationFrame ||
               window.mozRequestAnimationFrame ||
               window.webkitRequestAnimationFrame ||
               function (callback) { setTimeout(callback, 1000 / 60); };
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
    function load(type, data) {
        $("body").append('<div id="newpage">' + data + '</div>');
        var newPage = $("#newpage"),
            oldPage = $("#page"),
            box     = $("#center-box");
        if (type === "main") {
            droppy.hasLoggedOut = false;
            initMainPage();
            requestAnimation(function () {
                oldPage.attr("class", "out");
                $("#navigation").attr("class", "in");
                finalize();
            });
        } else if (type === "auth" || type === "firstrun") {
            initAuthPage(type === "firstrun");
            requestAnimation(function () {
                oldPage.attr("class", "out");
                $("#navigation").addClass("out");
                box.removeClass("out");
                finalize();
                if (type === "firstrun") {
                    $("#login-info").html("Hello! Choose your creditentials.");
                    $("#login-info-box").attr("class", "info");
                } else if (droppy.hasLoggedOut) {
                    $("#login-info").html("Logged out!");
                    $("#login-info-box").attr("class", "info");
                }
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
        droppy.socket = new WebSocket(protocol + document.location.host + "/websocket");

        droppy.socket.onopen = function () {
            if (queuedData) {
                sendMessage();
            } else
                updateLocation(droppy.currentFolder || "/", false); // Request initial update
        };

        droppy.socket.onclose = function (event) {
            if (droppy.hasLoggedOut || event.code === 4000) return;
            if (event.code >= 1002 && event.code < 3999) {
                log("Websocket closed unexpectedly with code " + event.code + ". Reconnecting...");
                openSocket();
            } else if (reopen) {
                reopen = false;
                openSocket();
            }
        };

        droppy.socket.onmessage = function (event) {
            droppy.socketWait = false;
            var msg = JSON.parse(event.data);
            log(document.domain + " -> " + msg.type);
            switch (msg.type) {
            case "UPDATE_FILES":
                if (droppy.isUploading) return;
                updateData(msg.folder, msg.data);
                break;
            case "UPLOAD_DONE":
                finishUpload(msg);
                break;
            case "NEW_FOLDER":
                if (droppy.isUploading) return;
                updateData(msg.folder, msg.data);
                break;
            case "UPDATE_CSS":
                reloadCSS(msg.css);
                break;
            case "SHORTLINK":
                //TODO: UI
                window.prompt("Shortlink:", window.location.protocol + "//" + window.location.host + "/$/" +  msg.link);
                break;
            case "USER_LIST":
                populateUserList(msg.users);
                break;
            case "MIME_TYPE":
                droppy.mimeTypes[getExt(msg.req)] = msg.mime;
                break;
            }
        };
    }

    function sendMessage(msgType, msgData) {
        if (droppy.socket.readyState === 1) { // open
            // Lock the UI while we wait for a socket response
            droppy.socketWait = true;

            // Unlock the UI in case we get no socket resonse after waiting for 1 second
            setTimeout(function () {
                droppy.socketWait = false;
            }, 1000);

            log(document.domain + " <- " + msgType);

            if (queuedData) {
                droppy.socket.send(queuedData);
                queuedData = false;
            } else
                droppy.socket.send(JSON.stringify({type: msgType, data: msgData}));
        } else {
            // We can't send right now, so queue up the last added message to be sent later
            queuedData = JSON.stringify({type: msgType, data: msgData});

            if (droppy.socket.readyState === 2) { // closing
                // Socket is closing, queue a re-opening
                reopen = true;
            } else if (droppy.socket.readyState === 3) { // closed
                // Socket is closed, we can re-open it right now
                openSocket();
            }
        }
    }

    // Close the socket gracefully before navigating away
    $(window).register("beforeunload", function () {
        if (droppy.socket && droppy.socket.readyState < 2) {
            // 1001 aka CLOSE_GOING_AWAY is a valid status code, though Firefox still throws an INVALID_ACCESS_ERR
            // https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent#Close_codes
            try {
                droppy.socket.close(1001);
            } catch (error) {}
        }

    });

// ============================================================================
//  Authentication page
// ============================================================================
    function initAuthPage(firstrun) {
        var loginform = $("#center-box"),
            submit    = $("#submit"),
            form      = $("#form");

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
                $("#remember > input").trigger("click");
            }
        });

        submit.register("click", function () { form.submit(); });
        form.register("submit", submitForm);

        function submitForm() {
            if (firstrun) {
                $.ajax({
                    type: "POST",
                    url: "/adduser",
                    dataType: "json",
                    data: form.serialize(),
                    success: function (response) {
                        if (response === "OK") {
                            droppy.hasLoggedOut = false;
                            getPage();
                        } else {
                            submit.addClass("invalid");
                            loginform.addClass("invalid");
                            $("#login-info").html("Creditentials not acceptable.");
                            $("#login-info-box").attr("class", "error");
                        }
                    }
                });
            } else {
                $.ajax({
                    type: "POST",
                    url: "/login",
                    dataType: "json",
                    data: form.serialize(),
                    success: function (response) {
                        if (response === "OK") {
                            droppy.hasLoggedOut = false;
                            getPage();
                        } else {
                            $("#pass").val("");
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
                            }
                        }
                    }
                });
            }
        }
    }
// ============================================================================
//  Main page
// ============================================================================
    function initMainPage() {
        // Initialize the current folder, in case the user navigated to it through the URL.
        droppy.currentFolder = decodeURIComponent(window.location.pathname);

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

            var items = event.dataTransfer.items,
                fileItem = null,
                entryFunc = null;

            // Try to find the supported getAsEntry function
            if (items && items[0]) {
                fileItem = (items[0].type === "text/uri-list") ? items[1] : items[0];
                var funcs = ["getAsEntry", "webkitGetAsEntry", "mozGetAsEntry", "MSGetAsEntry"];
                for (var f = 0; f < funcs.length; f++) {
                    if (fileItem[funcs[f]]) {
                        entryFunc = funcs[f];
                        break;
                    }
                }
            }

            // Check if we support getAsEntry();
            if (!items || !fileItem[entryFunc]()) {
                // No support, fallback to normal File API
                upload(event.dataTransfer.files, true);
                return;
            }

            // We support GetAsEntry, go ahead and read recursively
            var obj = {};
            var cbCount = 0, cbFired = 0, dirCount = 0;
            var length = event.dataTransfer.items.length;
            for (var i = 0; i < length; i++) {
                var entry = event.dataTransfer.items[i][entryFunc]();
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
                droppy.smallScreen = $(window).width() < 640;
                checkPathOverflow();
            }, 100);
        });

        var fileInput = $("#file");
        fileInput.register("change", function (event) {
            if (droppy.detects.fileinputdirectory && event.target.files.length > 0 && "webkitRelativePath" in event.target.files[0]) {
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
            if (droppy.detects.fileinputdirectory)
                fileInput.removeAttr("directory msdirectory mozdirectory webkitdirectory");
            fileInput.click();
        });

        // Folder upload button - check if we support directory uploads
        if (droppy.detects.fileinputdirectory) {
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
            $("#upload-folder").css("color", "#666").attr("title", "Sorry, your browser doesn't support directory uploading yet!");
        }

        var info         = $("#editbox-info"),
            editInput    = $("#editbox-input"),
            editbox      = $("#editbox"),
            editSubmit   = $("#editbox-submit"),
            indicators   = $("#editbox-submit, #editbox-input");

        // Show popup for folder creation
        $("#create-folder").register("click", function () {
            showEditBox("create-folder");
        });

        // Input validation preview, the server performs the same regex
        editInput.register("input", function () {
            var canSubmit, exists, valid, input = $(this).val();
            valid = !/[\\\*\{\}\/\?\|<>"]/.test(input);
            for (var i = 0, len = droppy.activeFiles.length; i < len; i++)
                if (droppy.activeFiles[i] === input.toLowerCase()) { exists = true; break; }
            canSubmit = valid && !exists;
            editbox.data("canSubmit", canSubmit ? "true" : "false");
            if (canSubmit) {
                indicators.removeClass();
                info.removeClass();
                editSubmit.register("click", submitEdit);
            } else {
                indicators.attr("class", input.length > 0 ? "invalid" : "");
                if (exists) {
                    info.html(exists ? "Already exists!" : "Invalid characters!");
                    info.attr("class", "in");
                }
                editSubmit.off("click");
            }
        });

        // Key handlers for the modal edit box
        editInput.register("keyup", function (event) {
            if (event.keyCode === 27) { // Escape Key
                cleanupAndHideEditbox();
            }
            if (event.keyCode === 13) { // Return Key
                submitEdit();
            }
        });

        function submitEdit() {
            if (editbox.data("canSubmit") !== "true") return;
            if (editbox.data("type") === "create-folder") {
                sendMessage("CREATE_FOLDER",
                    droppy.currentFolder === "/" ? "/" + editInput.val() : droppy.currentFolder + "/" + editInput.val()
                );
            } else if (editbox.data("type") === "rename") {
                sendMessage("RENAME", {
                    "old": editInput.attr("placeholder"),
                    "new": editInput.val()
                });
            }
            cleanupAndHideEditbox();
        }

        function cleanupAndHideEditbox() {
            editbox.attr("class", "out");
            toggleCatcher();
            editSubmit.off("click");
            editInput.val("");
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

        $("#user-add").register("click", function () {
            //TODO: UI
            var user = window.prompt("Username?");
            var pass = window.prompt("Password?");
            if (!user || !pass) return;
            sendMessage("UPDATE_USER", {
                name: user,
                pass: pass,
                priv: true
            });
        });

        $("#save-users").register("click", function () {
            var users = [], entry, user, isChanged;
            var entries = document.getElementsByClassName("user-entry");
            for (var i = 0, l = entries.length; i < l; i++) {
                entry = entries[i];
                user = {};
                isChanged = false;
                for (var j = 0, k = entry.childNodes.length; j < k; j++) {
                    if (entry.dataset.changed === "true") {
                        if      (entry.childNodes[j].className === "user-name") user.name = entry.childNodes[j].innerHTML;
                        else if (entry.childNodes[j].className === "user-pass") user.pass = entry.childNodes[j].value;
                        else if (entry.childNodes[j].className === "user-priv") user.priv = entry.childNodes[j].checked;
                        if (user.pass && user.pass.length > 0) {
                            isChanged = true;
                        }
                    }
                }
                if (isChanged) users.push(user);
            }

            users.forEach(function (user) {
                sendMessage("UPDATE_USER", user);
            });
            hideModals();
        });

        $("#click-catcher").register("click", hideModals);

        function hideModals() {
            $("#click-catcher").attr("class", "out");
            editbox.attr("class", "out");
            aboutbox.attr("class", "out");
            configbox.attr("class", "out");
        }

        $("#logout").register("click", function () {
            droppy.socket && droppy.socket.close(4001);
            deleteCookie("session");
            initVariables(); // Reset vars to their init state
            droppy.hasLoggedOut = true;
            getPage();
        });

        var slider     = $("#volume-slider"),
            volumeIcon = $("#volume-icon"),
            controls   = $("#audio-controls");

        volumeIcon.register("click", function () {
            requestAnimation(function () {
                slider.attr("class", slider.attr("class") !== "in" ? "in" : "out");
            });
        });

        function onWheel(event) {
            setVolume(event.wheelDelta || -event.detail);
        }

        volumeIcon[0].addEventListener("mousewheel", onWheel, false);
        volumeIcon[0].addEventListener("DOMMouseScroll", onWheel, false);

        var player = document.getElementById("audio-player");
        player.volume = localStorage.getItem("volume") || 0.2;
        slider.attr("value", player.volume * 100);

        function setVolume(delta) {
            var volume = player.volume;
            if (typeof delta === "number") {
                if (delta > 0) {
                    volume += 0.05;
                    volume > 1 && (volume = 1);
                } else {
                    volume -= 0.05;
                    volume < 0 && (volume = 0);
                }
            } else {
                volume = slider.val() / 100;
            }

            player.volume = volume;
            localStorage.setItem("volume", volume);
            slider.attr("value", volume * 100);

            if (player.volume === 0) volumeIcon.html("");
            else if (player.volume <= 0.33) volumeIcon.html("");
            else if (player.volume <= 0.67) volumeIcon.html("");
            else volumeIcon.html("");
        }

        slider.register("input", setVolume);
        setVolume();

        // Playback events : http://www.w3.org/wiki/HTML/Elements/audio#Media_Events
        function stop() {
            document.getElementById("audio-title").innerHTML = "";
            controls.addClass("out");
            $("#content, #newcontent").removeClass("squeeze");
        }
        player.addEventListener("pause", stop);
        player.addEventListener("ended", stop);
        player.addEventListener("play", function () {
            var matches = $(player).attr("src").match(/(.+)\/(.+)\./);
            var songname = matches[matches.length - 1].replace(/_/g, " ").replace(/\s+/, " ");
            document.getElementById("audio-title").innerHTML = songname;
            controls.removeClass("out");
            $("#content, #newcontent").addClass("squeeze");
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
                    var filename = encodeURIComponent(data[i].name);
                    numFiles++;
                    droppy.currentData[filename] = {
                        size  : data[i].size,
                        type  : "nf",
                        mtime : Date.now()
                    };
                    formData.append(filename, data[i], filename);
                }
            } else { // We got an object for recursive folder uploads
                var addedDirs = {};
                for (var path in data) {
                    if (data.hasOwnProperty(path)) {
                        formData.append(path, data[path], encodeURIComponent(path));
                        var name = (path.indexOf("/") > 1) ? path.substring(0, path.indexOf("/")) : path;
                        switch (Object.prototype.toString.call(data[path])) {
                        case "[object Object]":
                            if (!addedDirs[name] && data.hasOwnProperty(path)) {
                                droppy.currentData[name] = {
                                    size : 0,
                                    type : "nd"
                                };
                                addedDirs[name] = true;
                            }
                            break;
                        case "[object File]":
                            numFiles++;
                            if (!addedDirs[name]) {
                                droppy.currentData[name] = {
                                    size  : data[path].size,
                                    type  : "nf",
                                    mtime : Date.now()
                                };
                            }
                            break;
                        }
                    }
                }
            }

            // Load the new files into view, tagged
            buildHTML(droppy.currentData, droppy.currentFolder, true);

            // Create the XHR2 and bind the progress events
            var xhr = new XMLHttpRequest();
            xhr.upload.addEventListener("progress", uploadProgress, false);
            xhr.upload.addEventListener("load", uploadDone, false);
            xhr.upload.addEventListener("error", uploadDone, false);

            // Init the UI
            $("#upload-cancel").register("click", function () { xhr.abort(); uploadDone(); });
            title.html(numFiles < 2 ? "Uploading..." : "Uploading " + numFiles + " files...");
            start = Date.now();
            updateTitle("0%");
            uperc.html("0%");
            prog.css("width", "0%");
            timeleft.html("");
            $("#upload-info").addClass($("#audio-controls").hasClass("out") ? "in" : "in-space");

            // And send the files
            droppy.isUploading = true;
            xhr.open("POST", "/upload");
            xhr.send(formData);
        }

        var start, lastUpdate,
            timeleft = $("#upload-time-left"),
            prog     = $("#upload-bar-inner"),
            title    = $("#upload-title"),
            uperc    = $("#upload-percentage");

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
                    progress   = Math.round((bytesSent / bytesTotal) * 100) + "%",
                    speed      = convertToSI(bytesSent / ((Date.now() - start) / 1000), 2) + "/s";
                prog.css("width", progress);
                updateTitle(progress);
                uperc.html(progress + " - " + speed);

                // Calculate estimated time left
                var elapsed = Date.now() - start;
                var estimate = bytesTotal / (bytesSent / elapsed);
                var secs = (estimate - elapsed) / 1000;

                if (secs > 60) {
                    timeleft.html(Math.ceil(secs / 60) + " mins left");
                } else {
                    timeleft.html(Math.ceil(secs) + " secs left");
                }
            }
        }
    }
// ============================================================================
//  General helpers
// ============================================================================
    function showEditBox(type, prefill) {
        var box = $("#editbox"), input = $("#editbox-input");

        droppy.activeFiles = [];
        $(".filelink, .folderlink").each(function () {
            droppy.activeFiles.push($(this).html().toLowerCase());
        });

        box.data("type", type);
        if (prefill) input.val(prefill);

        if (type === "create-folder")
            input.attr("placeholder", "Folder Name");
        else if (type === "rename")
            input.attr("placeholder", prefill);

        requestAnimation(function () {
            box.attr("class", box.attr("class") !== "in" ? "in" : "out");
            toggleCatcher();
            setTimeout(function () { input.focus(); }, 400);
        });
    }

    // Toggle the full-screen click catching frame to exit modal dialogs
    function toggleCatcher() {
        if ($("#about-box").attr("class")  === "in" ||
            $("#editbox").attr("class")    === "in" ||
            $("#config-box").attr("class") === "in"
        ) {
            $("#click-catcher").attr("class", "in");
        } else
            $("#click-catcher").attr("class", "out");
    }

    function populateUserList(userList) {
        var temp, entry;
        document.getElementById("userlist").innerHTML = "";
        for (var user in userList) {
            if (userList.hasOwnProperty(user)) {
                entry = createElement("li", "user-entry");
                entry.appendChild(createElement("span", "user-name", user));

                temp = createElement("input", "user-pass");
                temp.type = "password";
                temp.setAttribute("title", "Set the user's password");
                temp.onkeyup = function () {
                    this.parentNode.dataset.changed = "true";
                    $(this.parentNode).addClass("changed");
                };
                entry.appendChild(temp);

                temp = createElement("input", "user-priv");
                temp.type = "checkbox";
                temp.id = "check-" + user;
                temp.checked = userList[user] ? "checked" : "";
                temp.onchange = function () {
                    this.parentNode.dataset.changed = "true";
                    $(this.parentNode).addClass("changed");
                };
                entry.appendChild(temp);

                temp = createElement("label", "icon");
                temp.setAttribute("title", "Privileded Users can create other users.");
                temp.setAttribute("for", "check-" + user);
                temp.checked = userList[user] ? "checked" : "";
                entry.appendChild(temp);

                temp = createElement("span", "user-delete icon", "");
                temp.setAttribute("title", "Delete the user.");
                temp.onclick = function () {
                    var children = this.parentNode.childNodes;
                    for (var i = 0, l = children.length; i < l; i++) {
                        if (children[i].className === "user-name") {
                            sendMessage("UPDATE_USER", { name: children[i].innerHTML, pass: ""});
                            break;
                        }
                    }
                };
                entry.appendChild(temp);

                document.getElementById("userlist").appendChild(entry);
            }
        }
    }
    // Update data as received from the server
    function updateData(folder, data) {
        if (folder !== droppy.currentFolder)
            updateLocation(folder);

        updateTitle(folder, true);
        updatePath(folder);
        droppy.currentData = data;
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
        droppy.isUploading = false;
        updateLocation(droppy.currentFolder, false);
        updateTitle(droppy.currentFolder, true);
        msg && updateData(msg.folder, msg.data);
        $("#upload-info").removeClass("in").removeClass("in-space");
    }

    // Listen for popstate events, which indicate the user navigated back
    $(window).register("popstate", function () {
        (function queue(time) {
            if ((!droppy.socketWait && !droppy.isAnimating) || time > 2000)
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
            if ((!droppy.socketWait && !droppy.isAnimating) || time > 2000) {
                // Find the direction in which we should animate
                if (path.length > droppy.currentFolder.length)
                    nav = "forward";
                else if (path.length === droppy.currentFolder.length)
                    nav = "same";
                else
                    nav = "back";

                droppy.currentFolder = path;
                sendMessage(doSwitch ? "SWITCH_FOLDER" : "REQUEST_UPDATE", droppy.currentFolder);

                // Skip the push if we're already navigating through history
                if (!skipPush) window.history.pushState(null, null, droppy.currentFolder);
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
        if (droppy.savedParts) {
            i = 1; // Skip the first element as it's always the same
            while (true) {
                pathStr += "/" + parts[i];
                if (!parts[i] && !droppy.savedParts[i]) break;
                if (parts[i] !== droppy.savedParts[i]) {
                    if (droppy.savedParts[i] && !parts[i]) {
                        $("#path li").slice(i).remove();
                        break;
                    }
                    else if (parts[i] && !droppy.savedParts[i])
                        createPart(parts[i], pathStr);
                }
                i++;
            }
            requestAnimation(finalize);
        } else {
            // Delay initial slide-in
            setTimeout(function () {
                $(".placeholder").remove(); // Invisible placeholder so height:auto works during the initial animation
                createPart(parts[0]);
                for (i = 1, len = parts.length; i < len; i++) {
                    pathStr += "/" + parts[i];
                    createPart(parts[i], pathStr);
                }
                requestAnimation(finalize);
            }, 300);
        }

        droppy.savedParts = parts;

        function createPart(name, path) {
            var li = $("<li class='out'>" + name + "</li>");
            li.data("destination", path || "/");
            li.click(function () {
                updateLocation($(this).data("destination"), true);
            });

            $("#path").append(li);
            li.append('<svg class="arrow" viewBox="0 0 100 100"><polyline points="0,0 0,100 60,50"/></svg>');
        }

        function finalize() {
            $("#path li.out").setTransitionClass("in");
            setTimeout(function () {
                // Remove the class after the transition and keep the list scrolled to the last element
                $("#path li.in").removeClass();
                checkPathOverflow();
            }, 200);
        }
    }

    // Check if the path indicator overflows and scroll it if neccessary
    function checkPathOverflow() {
        var last = $("#path li:last-child");
        if (!last.position()) return;
        var margin = droppy.smallScreen ? 95 : 110;
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
    function buildHTML(fileList, root, isUpload) {
        var list = $("<ul></ul>"), downloadURL, type, size, mtime, id, tags, audio;

        for (var file in fileList) {
            if (fileList.hasOwnProperty(file)) {
                type = fileList[file].type;
                size = convertToSI(fileList[file].size);
                mtime = fileList[file].mtime;
                id = (root === "/") ? "/" + file : root + "/" + file;
                tags = (type === "nf" || type === "nd") ? " tag-uploading" : "";

                if (type === "f" || type === "nf") { // Create a file row
                    downloadURL = "/~" + id;
                    audio = /^.+\.(mp3|ogg|wav|wave|webm)$/.test(file) ? '<span class="icon-play icon"></span>' : "";
                    var spriteClass = getSpriteClass(getExt(file));
                    if (isUpload) file = decodeURIComponent(file);
                    list.append(
                        '<li class="data-row" data-type="file" data-id="' + id + '">' +
                            '<span class="' + spriteClass + '"></span>' +
                            '<a class="filelink ' + tags + '" href="' + downloadURL + '" download="' + file + '">' + file + '</a>' +
                            '<span class="icon-delete icon"></span>' +
                            '<span class="icon-rename icon"></span>' +
                            '<span class="icon-link icon"></span>' +
                            '<span class="data-info">' + size + '</span>' +
                            '<span class="data-mtime" data-timestamp="' + mtime + '">' + timeDifference(mtime) + '</span>' +
                            audio +
                        '</li>'
                    );
                } else if (type === "d" || type === "nd") {  // Create a folder row
                    if (isUpload) file = decodeURIComponent(file);
                    list.append(
                        '<li class="data-row" data-type="folder" data-id="' + id + '">' +
                            '<span class="sprite sprite-folder"></span>' +
                            '<span class="folderlink ' + tags + '">' + file + '</span>' +
                            '<span class="icon-delete icon"></span>' +
                            '<span class="icon-rename icon"></span>' +
                        '</li>'
                    );
                }
            }
        }

        $(list).children("li").sort(function (a, b) {
            var type = $(b).data("type").toUpperCase().localeCompare($(a).data("type").toUpperCase());
            var extension = getExt($(a).children(".filelink").text().toUpperCase())
                                 .localeCompare(getExt($(b).children(".filelink").text().toUpperCase()));
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
                droppy.isAnimating = true;
                $(".data-row").addClass("animating");
                $("#content").attr("class", (nav === "forward") ? "back" : "forward");
                $("#newcontent").setTransitionClass("center");

                // Switch classes once the transition has finished
                setTimeout(function () {
                    droppy.isAnimating = false;
                    $("#content").remove();
                    $("#newcontent").attr("id", "content");
                    $(".data-row").removeClass("animating");
                }, 200);
            }
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
            if (droppy.socketWait) return;
            var destination = $(this).data("id");
            updateLocation(destination, true);
        });

        // Rename a file/folder
        $(".icon-rename").register("click", function (event) {
            if (droppy.socketWait) return;
            showEditBox("rename", $(this).parent().find(".filelink, .folderlink").html());
            event.stopPropagation();
        });

        // Request a shortlink
        $(".icon-link").register("click", function () {
            if (droppy.socketWait) return;
            sendMessage("REQUEST_SHORTLINK", $(this).parent().data("id"));
        });

        // Delete a file/folder
        $(".icon-delete").register("click", function () {
            if (droppy.socketWait) return;
            sendMessage("DELETE_FILE", $(this).parent().data("id"));
        });

        $(".icon-play").register("click", function (event) {
            preparePlayback($(event.target));
        });

        function preparePlayback(playButton) {
            if (droppy.socketWait) return;

            var source = playButton.parent().find(".filelink").attr("href"),
                ext    = getExt(source);

            if (droppy.mimeTypes[ext]) {
                play(source, playButton);
            } else {
                // Request the mime type from the server if we don't know it yet
                sendMessage("GET_MIME", ext);
                // Wait for the server's respone
                Object.defineProperty(droppy.mimeTypes, ext, {
                    val: undefined,
                    get: function () { return this.val; },
                    set: function (v) { this.val = v; play(source, playButton); }
                });
            }
        }

        function play(source, playButton) {
            var player    = $("#audio-player").get(0),
                iconPlay  = "",
                iconPause = "";

            if (!player.canPlayType(droppy.mimeTypes[getExt(source)])) {
                window.alert("Sorry, your browser can't play this file.");
                return;
            }

            player.onended = function () {
                var next = $(".playing").parent().next();
                preparePlayback($((next.length) ? next.find(".icon-play") : $("#content ul").find(".icon-play").first()));
            };

            resetClasses();
            $(".icon-play").text(iconPlay);
            playButton.addClass("active");

            if (player.paused)
                loadAndPlay();
             else
                (decodeURI(player.src).indexOf(source) > 0) ? pause() : loadAndPlay();

            function loadAndPlay() {
                player.src = source;
                player.load();
                player.play();
                playButton.text(iconPause);
                playButton.parent().addClass("playing-row");
                playButton.parent().find(".filelink").addClass("playing");
            }
            function pause() {
                player.pause();
                playButton.text(iconPlay);
                resetClasses();
            }

            function resetClasses() {
                $(".filelink").removeClass("playing");
                $(".icon-play").removeClass("active");
                $(".data-row").removeClass("playing-row");
            }
        }
    }

    // Extract the extension from a file name
    function getExt(filename) {
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
        droppy.smallScreen = $(window).width() < 640;
        droppy.activeFiles = [];
        droppy.currentData = null;
        droppy.currentFolder = null;
        droppy.hasLoggedOut = null;
        droppy.isAnimating = null;
        droppy.isUploading = null;
        droppy.savedParts = null;
        droppy.socket = null;
        droppy.socketWait = null;
        droppy.mimeTypes = {};
    }

    // Convert raw byte numbers to SI values
    function convertToSI(bytes, decimals) {
        var step = 0, units = ["B", "KB", "MB", "GB", "TB"];
        while (bytes >= 1024) {
            bytes /= 1024;
            step++;
        }
        if (!decimals)
            return [(step === 0) ? bytes : Math.round(bytes), units[step]].join(" ");
        else
            return [(step === 0) ? bytes : (bytes).toFixed(decimals), units[step]].join(" ");
    }

    // Debug logging
    function log() {
        if (droppy.debug) {
            var args = Array.prototype.slice.call(arguments);
            console.log(args.join(" "));
        }
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

    function timeDifference(previous) {
        var msPerMinute = 60 * 1000,
            msPerHour = msPerMinute * 60,
            msPerDay = msPerHour * 24,
            msPerMonth = msPerDay * 30,
            msPerYear = msPerDay * 365,
            elapsed = Date.now() - previous,
            retval = "";

        if (elapsed < 0) elapsed = 0;
        if (elapsed < msPerMinute) {
            retval = Math.round(elapsed / 1000);
            retval += (retval === 1) ? " sec ago" : " secs ago";
        } else if (elapsed < msPerHour) {
            retval = Math.round(elapsed / msPerMinute);
            retval += (retval === 1) ? " min ago" : " mins ago";
        } else if (elapsed < msPerDay) {
            retval = Math.round(elapsed / msPerHour);
            retval += (retval === 1) ? " hour ago" : " hours ago";
        } else if (elapsed < msPerMonth) {
            retval = Math.round(elapsed / msPerDay);
            retval += (retval === 1) ? " day ago" : " days ago";
        } else if (elapsed < msPerYear) {
            retval = Math.round(elapsed / msPerMonth);
            retval += (retval === 1) ? " month ago" : " months ago";
        } else {
            retval = Math.round(elapsed / msPerYear);
            retval += (retval === 1) ? " year ago" : " years ago";
        }
        return retval;
    }

    setInterval(function () {
        var dates = document.getElementsByClassName("data-mtime");
        for (var i = 0; i < dates.length; i++)
            if (dates[i].dataset.timestamp) {
                var reltime = timeDifference(dates[i].dataset.timestamp);
                if (reltime) dates[i].innerHTML = reltime;
            }
    }, 1000);

    function createElement(type, className, text) {
        var el = document.createElement(type);
        if (className) el.className = className;
        if (text) el.appendChild(document.createTextNode(text));
        return el;
    }

    function reloadCSS(css) {
        if (!droppy.debug) return;
        $('link[rel="stylesheet"]').remove();

        var i = 0;
        while (document.styleSheets[i])
            document.styleSheets[i++].disabled = true;

        var style = $('<style type="text/css"></style>');
        style.text(css).appendTo($("head"));
    }
}(jQuery, window, document));