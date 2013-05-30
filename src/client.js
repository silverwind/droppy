/* globals Modernizr */
(function ($, window, document) {
    "use strict";

    var debug; // live css reload and debug logging - this is set by the server
    var hasAnimations = Modernizr.cssanimations;
    var smallScreen = $(window).width() < 640;

    var currentData, currentFolder, giveUp, hasLoggedOut, isAnimating,
        isUploading, savedParts, socket, socketWait;

    initVariables(); // Separately init the variables so we can init them on demand

// ============================================================================
//  jQuery extensions / requestAnimationFrame
// ============================================================================
    // Add the dataTransfer property to the "drop" event.
    $.event.props.push("dataTransfer");

    // Set a class on freshly inserted elements, once the DOM has fully loaded it
    $.fn.setClass = function (newclass) {
        if (hasAnimations) {
            // Set the new class as a data attribute on the matched tag(s)
            this.css("animation", "nodeInserted 0.001s");
            this.data("newclass", newclass);
        } else {
            // If we don't support animations, fallback to a simple timeout
            setTimeout(function () {
                this.attr("class", newclass);
            }, 30);
        }
        return this;
    };

    if (hasAnimations) {
        // Listen for the animation event for our pseudo-animation
        var listener = function (event) {
            if (event.animationName === "nodeInserted") {
                var target = $(event.target);
                // Set the class stored in the data attribute and clean up
                target.attr("class", target.data("newclass"));
                target.removeAttr("data-newclass").removeAttr("style");
            }
        };
        document.addEventListener("animationstart", listener, false);
        document.addEventListener("webkitAnimationStart", listener, false);
        document.addEventListener("MSAnimationStart", listener, false);
        document.addEventListener("oanimationstart", listener, false);
    }

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
            url: "/content",
            success: function (data, textStatus, request) {
                load(request.getResponseHeader("X-Page-Type"), data);
            }
        });
    }

    // Switch the page content with an animation
    // TODO: Clean up and avoid animate()
    function load(type, data) {
        $("body").append('<div id="newpage">' + data + '</div>');
        requestAnimation(function () {
            var newPage = $("#newpage"), oldPage = $("#page");
            var login = $("#login-form");
            switch (type) {
            case "main":
                oldPage.attr("class", "out");
                login.animate({"opacity": 0}, {duration: 250, queue: false});
                login.animate({"top": smallScreen ? "20%" : "70%"}, {duration: 250, queue: false });
                setTimeout(function () {
                    $("#navigation").attr("class", "in");
                    setTimeout(function () {
                        $("#about-trigger").fadeIn(100);
                        $("content").removeAttr("class");
                        finalize();
                        initMainPage();
                    }, 250);
                }, 250);
                break;
            case "auth":
                oldPage.attr("class", "out");
                login.css("top", smallScreen ? "20%" : "70%");
                login.css("opacity", 0);
                $("#navigation").addClass("farout");
                setTimeout(function () {
                    login.animate({"opacity": 1}, {duration: 250, queue: false});
                    login.animate({"top": smallScreen ? "0%" : "50%"}, {duration: 250, queue: false, complete : function () {
                        finalize();
                        initAuthPage();
                        if (hasLoggedOut) {
                            setTimeout(function () {
                                $("#login-info").attr("class", "info");
                                $("#login-info").html("Logged out!");
                                $("#login-info").fadeIn(250);
                            }, 250);
                        }
                    }});
                }, 250);
                break;
            }

            // Switch ID of #newpage for further animation
            function finalize() {
                oldPage.remove();
                newPage.attr("id", "page");
            }
        });
    }

// ============================================================================
//  WebSocket functions
// ============================================================================
    function openSocket() {
        if (socket.readyState < 2 || giveUp) return;

        if (document.location.protocol === "https:")
            socket = new WebSocket("wss://" + document.location.host);
        else
            socket = new WebSocket("ws://" + document.location.host);

        socket.onopen = function () {
            // Request initial update
            updateLocation(currentFolder || "/", false);
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
                isUploading = false;
                updateTitle(currentFolder, true); // Reset title
                $(".progressBar").css("width", 0); // Reset progress bars
                $(".progressBar").hide();
                updateData(msg.folder, msg.data);
                break;
            case "NEW_FOLDER":
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
            case "UNAUTHORIZED":
                // Set hasLoggedOut to stop reconnects, will get cleared on login
                hasLoggedOut = true;
                break;
            }

            function updateData(folder, data) {
                if (folder !== currentFolder.replace(/&amp;/, "&")) {
                    updateLocation(msg.folder);
                }
                updatePath(msg.folder);
                currentData = data;
                buildHTML(data, folder);
            }
        };

        socket.onclose = function () {
            if (hasLoggedOut) return;
            // Restart a closed socket in case it unexpectedly closes,
            // and give up after 20 seconds of increasingly higher intervals.
            // Related: https://bugzilla.mozilla.org/show_bug.cgi?id=858538
            (function retry(timeout) {
                if (socket.readyState < 2) return;
                if (timeout > 20000) {
                    giveUp = true;
                    log("Gave up reconnecting after 20 seconds");
                    return;
                } else {
                    openSocket();
                    setTimeout(retry, timeout * 1.5, timeout + 1.5);
                }
            })(200);
        };
    }

    function sendMessage(msgType, msgData) {
        (function queue() {
            if (socket.readyState === 1) {
                socketWait = true;

                // Unlock the UI in case we get no socket resonse after waiting for 2 seconds
                setTimeout(function () {
                    socketWait = false;
                }, 2000);

                socket.send(JSON.stringify({
                    type: msgType,
                    data: msgData
                }));
            } else {
                if (!giveUp) setTimeout(queue, 50);
            }
        })();
    }
// ============================================================================
//  Authentication page JS
// ============================================================================
    function initAuthPage() {
        var form      = $("#form"),
            loginform = $("#login-form"),
            logininfo = $("#login-info"),
            pass      = $("#pass"),
            remember  = $("#remember"),
            submit    = $("#submit"),
            user      = $("#user");

        user.focus();

        // Return submits the form
        pass.off("keyup").on("keyup", function (e) {
            if (e.keyCode === 13) {
                submitForm(form, submit);
            }
        });

        // Spacebar toggles the checkbox
        remember.off("keyup").on("keyup", function (e) {
            if (e.keyCode === 32) {
                $("#check").trigger("click");
            }
        });

        form.off("submit").on("submit", function (e) {
            e.preventDefault();
            submitForm(form, submit);
        });

        user.off("focus").on("focus", function () {
            submit.removeClass("invalid");
            loginform.removeClass("invalid");
            logininfo.fadeOut(300);
        });

        user.off("click keydown").on("click keydown", function () {
            logininfo.fadeOut(300);
        });

        pass.off("focus").on("focus", function () {
            submit.removeClass("invalid");
            loginform.removeClass("invalid");
            logininfo.fadeOut(300);
        });

        function submitForm(form) {
            $.ajax({
                type: "POST",
                url: "/login",
                data: form.serialize(),
                success: function (response) {
                    if (response === "OK") {
                        hasLoggedOut = false;
                        getPage();
                    } else {
                        submit.attr("class", "invalid");
                        loginform.attr("class", "invalid");
                        if ($("#login-info").is(":visible")) {
                            $("#login-info").addClass("shake");
                            setTimeout(function () {
                                $("#login-info").removeClass("shake");
                            }, 500);
                        }
                        $("#login-info").addClass("error");
                        $("#login-info").html("Wrong login!");
                        $("#login-info").fadeIn(300);
                    }
                }
            });
        }
    }
// ============================================================================
//  Main page JS
// ============================================================================
    function initMainPage() {
        // Open Websocket for initial update
        setTimeout(openSocket, 50);
        currentFolder = decodeURIComponent(window.location.pathname);
        hasLoggedOut = false;

        // Close the socket gracefully
        $(window).off("beforeunload").on("beforeunload", function () {
            if (socket.close && socket.readyState < 2)
                socket.close();
        });

        // Stop dragenter and dragover from killing our drop event
        $(document.documentElement).off("dragenter").on("dragenter", function (e) { e.preventDefault(); });
        $(document.documentElement).off("dragover").on("dragover", function (e) { e.preventDefault(); });

        // File drop handler
        $(document.documentElement).off("drop").on("drop", function (event) {
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
        $(window).resize(function () {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(function () {
                smallScreen = $(window).width() < 640;
                checkPathWidth();
            }, 100);
        });

        var fileInput = $("#file");

        // Hide our file input form by wrapping it in a 0 x 0 div
        fileInput.wrap($("<div/>").css({
            "height"  : 0,
            "width"   : 0,
            "overflow": "hidden"
        }));

        fileInput.off("change").on("change", function () {
            if ($("#file").val() !== "") {
                upload($("#file").get(0).files, true);
                $("#file").val(""); // Reset the form
            }
        });

        // Redirect the upload button click to the real, hidden form
        $("#upload").off("click").on("click", function () {
            fileInput.click();
        });

        var info        = $("#name-info"),
            nameinput   = $("#name-input"),
            nameoverlay = $("#name-overlay"),
            activeFiles;

        // Show popup for folder creation
        $("#add-folder").off("click").on("click", function () {
            activeFiles = [];
            $(".filelink, .folderlink").each(function () {
                activeFiles.push($(this).html().toLowerCase());
            });
            nameinput.val("");
            nameinput.removeClass("invalid");
            nameoverlay.removeClass("invalid");
            info.hide();
            toggleOverlay();
        });

        function toggleOverlay() {
            if (nameoverlay.attr("class") === "out") {
                nameoverlay.css("visibility", "visible");
                nameoverlay.attr("class", "in");
                setTimeout(function () {
                    nameinput.focus();
                }, 300);
            } else {
                nameoverlay.attr("class", "out");
                setTimeout(function () {
                    nameoverlay.css("visibility", "hidden");
                }, 300);
            }
        }

        // Handler for the input of the folder name
        nameinput.off("keyup").on("keyup", function (e) {
            if (e.keyCode === 27) toggleOverlay(); // Escape Key
            var input = nameinput.val();
            var valid = !input.match(/[\\*{}\/<>?|]/) && !input.match(/\.\./);
            var folderExists;
            for (var i = 0, len = activeFiles.length; i < len; i++)
                if (activeFiles[i] === input.toLowerCase()) folderExists = true;
            if (input === "") {
                nameinput.removeClass();
                nameoverlay.removeClass("valid invalid");
                info.fadeOut(300);
            } else if (!valid || folderExists) {
                nameinput.removeClass("valid").addClass("invalid");
                nameoverlay.addClass("invalid");
                info.html(folderExists ? "File or folder already exists!" : "Invalid character(s) in filename!");
                info.fadeIn(300);
            } else {
                nameoverlay.removeClass("invalid").addClass("valid");
                nameinput.removeClass("invalid").addClass("valid");
                info.fadeOut(300);
                if (e.keyCode === 13) { // Return Key
                    if (currentFolder === "/")
                        sendMessage("CREATE_FOLDER", "/" + input);
                    else
                        sendMessage("CREATE_FOLDER", currentFolder + "/" + input);
                    nameoverlay.removeClass("in").addClass("out");
                }
            }
        });

        var about = $("#about");

        $("#about-trigger").off("click").on("click", function () {
            if (about.attr("class") !== "in") {
                setTimeout(function () {
                    about.setClass("in");
                }, 50);

            } else {
                about.attr("class", "out");
            }
        });

        $("#logout").off("click").on("click", function () {
            sendMessage("LOGOUT");
            hasLoggedOut = true;
            socket.close();
            $("#about-trigger").hide();
            deleteCookie("sid");
            initVariables(); // Reset vars to their init state
            getPage();
        });
        // ============================================================================
        //  Helper functions for the main page
        // ============================================================================
        function upload(data, isArray) {
            var formData = new FormData();
            if (!data) return;
            if (isArray) { // We got a normal File array
                if (data.length === 0) return;
                for (var i = 0, len = data.length; i < len; i++) {
                    currentData[data[i].name] = { size: data[i].size, type: "nf" };
                    formData.append(data[i].name, data[i]);
                }
            } else { // We got an object for recursive folder uploads
                var addedDirs = {};
                for (var path in data) {
                    formData.append(path, data[path], path);
                    var name = (path.indexOf("/") > 1) ? path.substring(0, path.indexOf("/")) : path;
                    switch (Object.prototype.toString.call(data[path])) {
                    case "[object Object]":
                        if (!addedDirs[name]) {
                            currentData[name] = { size: 0, type: "nd" };
                            addedDirs[name] = true;
                        }
                        break;
                    case "[object File]":
                        if (!addedDirs[name]) {
                            currentData[name] = { size: data[path].size, type: "nf" };
                        }
                        break;
                    }
                }
            }

            // Load the preview progress bars and init the UI
            buildHTML(currentData, currentData.folder);
            uploadInit();

            // Create the XHR2
            var xhr = new XMLHttpRequest();
            xhr.upload.addEventListener("progress", uploadProgress, false);
            xhr.upload.addEventListener("load", uploadDone, false);
            xhr.upload.addEventListener("error", uploadDone, false);

            // And send the files
            isUploading = true;
            xhr.open("post", "/upload", true);
            xhr.send(formData);
        }

        var start, progressBars,
            infobox  = $("#upload-info"),
            timeleft = $("#upload-time-left"),
            uperc    = $("#upload-percentage");

        function uploadInit() {
            start = new Date().getTime();

            progressBars = $(".progressBar");
            progressBars.show();
            progressBars.width("0%");

            updateTitle("0%");
            uperc.html("0%");

            timeleft.html("");
            $("#about").hide();
            infobox.attr("class", "in");
        }

        function uploadDone() {
            progressBars.width("100%");

            updateTitle("100%");
            uperc.html("100%");

            timeleft.html("finished");
            infobox.attr("class", "out");
        }

        function uploadProgress(event) {
            if (!event.lengthComputable) return;

            var bytesSent  = event.loaded,
                bytesTotal = event.total,
                progress   = Math.round((bytesSent / bytesTotal) * 100) + "%";

            progressBars.width(progress);
            updateTitle(progress);
            uperc.html(progress);

            // Calculate estimated time left
            var elapsed = (new Date().getTime()) - start;
            var estimate = bytesTotal / (bytesSent / elapsed);
            var secs = (estimate - elapsed) / 1000;

            if (secs > 120) {
                timeleft.html(Math.floor((secs / 60) + 1) + " minutes left");
            } else if (secs > 60) {
                timeleft.html("2 minutes left");
            } else {
                timeleft.html(Math.round(secs) + " seconds left");
            }
        }
    }
// ============================================================================
//  General helpers
// ============================================================================
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

    // Listen for "popstate" events, which indicate the user navigated back
    $(window).off("popstate").on("popstate", function () {
        currentFolder = decodeURIComponent(window.location.pathname);
        sendMessage("SWITCH_FOLDER", currentFolder);
    });

    // Update our current location and change the URL to it
    var nav, retryTimout;
    function updateLocation(path, doSwitch) {
        if (socketWait) return; // Dont switch location in case we are still waiting for a response from the server

        // Queue the folder switching if we are in an animation
        if (isAnimating) {
            if (retryTimout > 1000) return;
            retryTimout += 25;
            setTimeout(updateLocation, retryTimout, path, doSwitch);
        } else {
            retryTimout = 0;
        }

        // Find the direction in which we should animate
        if (path.length > currentFolder.length)
            nav = "forward";
        else if (path.length === currentFolder.length)
            nav = "same";
        else
            nav = "back";

        currentFolder = path;
        sendMessage(doSwitch ? "SWITCH_FOLDER" : "REQUEST_UPDATE", currentFolder);

        // pushState causes Chrome's UI to flicker
        // http://code.google.com/p/chromium/issues/detail?id=50298
        window.history.pushState(null, null, currentFolder);
    }

    function updatePath(path) {
        updateTitle(path, true);
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
            finalize();
        } else {
            // Delay initial slide-in
            setTimeout(function () {
                $(".placeholder").remove(); // Invisible placeholder so height:auto works during the initial animation
                create(parts[0]);
                for (i = 1, len = parts.length; i < len; i++) {
                    pathStr += "/" + parts[i];
                    create(parts[i], pathStr);
                }

                finalize();
            }, 300);
        }

        savedParts = parts;

        function create(name, path) {
            var li = $("<li class='out'>" + name + "</li>");
            if (!path)
                li.data("destination", "/");
            else {
                li.data("destination", path);
            }
            li.click(function () {
                updateLocation($(this).data("destination"), true);
            });

            $("#path").append(li);
        }

        function finalize() {
            $("#path li.out").setClass("in");
            setTimeout(function () {
                // Remove the class after the transition and keep the list scrolled to the last element
                $("#path li.in").removeClass();
                checkPathWidth();
            }, 300);
        }
    }

    function checkPathWidth() {
        var last = $("#path li:last-child");
        if (!last.position()) return;
        var margin = smallScreen ? 95 : 110;
        var space = $(window).width();
        var right = last.position().left + last.width();

        if ((right + margin) > space) {
            var needed = right - space + margin;
            $("#path").animate({"left": -needed}, {duration: 200});
        } else {
            if ($("#path").css("left") !== 0)
                $("#path").animate({"left": 0}, {duration: 200});
        }
    }

    function buildHTML(fileList, root) {
        var list = $("<ul></ul>");
        for (var file in fileList) {
            var downloadURL,
                type = fileList[file].type,
                size = convertToSI(fileList[file].size),
                id = (root === "/") ? "/" + file : root + "/" + file,
                addProgress = (type === "nf" || type === "nd") ? '<div class="progressBar"></div>' : "";

            if (type === "f" || type === "nf") { // Create a file row
                downloadURL = window.location.protocol + "//" + window.location.host + "/get" + encodeURIComponent(id);
                list.append(
                    '<li class="data-row" data-type="file" data-id="' + id + '"><span class="icon icon-file"></span>' +
                    '<a class="filelink" href="' + downloadURL + '" download="' + file + '">' + file + '</a>' +
                    '<span class="icon-delete icon"></span><span class="data-info">' + size + '</span>' + addProgress + '</li>'
                );
            } else if (type === "d" || type === "nd") {  // Create a folder row
                list.append(
                    '<li class="data-row" data-type="folder" data-id="' + id + '"><span class="icon icon-folder"></span>' +
                    '<span class="folderlink">' + file + '</span><span class="icon-delete icon"></span>' + addProgress + '</li>'
                );
            }
        }

        // Sort first by class, then alphabetically
        var items = $(list).children("li");
        items.sort(function (a, b) {
            var result = $(b).data("type").toUpperCase().localeCompare($(a).data("type").toUpperCase());
            return result ? result : $(a).text().toUpperCase().localeCompare($(b).text().toUpperCase());
        });

        var count = 0;
        $.each(items, function (index, item) {
            $(item).attr("data-index", index);
            list.append(item);
            count++;
        });

        if (count > 0)
            loadContent(list);
        else {
            loadContent(false);
        }
    }

    // Load generated list into view with an animation
    function loadContent(list) {
        var emptyPage = '<div id="empty"><div id="empty-text">There appears to be<br>nothing here. Drop files<br>into this window or<br><span id="upload-inline"><span class="icon"></span> Add files</span></div></div>';
        if (nav === "same") {
            $("#content").attr("class", "center");
            if (list) {
                $("#content").html(list);
            } else {
                $("#content").html(emptyPage);
            }
            finalize();
        } else {
            $("#page").append($("<section id='newcontent' class='" + nav + "'></section>"));
            if (list) {
                $("#newcontent").html(list);
            } else {
                $("#newcontent").html(emptyPage);
                $("#upload-inline").on("click", function () {
                    $("#file").click();
                });
            }
            isAnimating = true;
            $(".data-row").addClass("animating");
            $("#content").attr("class", (nav === "forward") ? "back" : "forward");
            $("#newcontent").setClass("center");

            // Switch classes once the transition has finished
            setTimeout(function () {
                isAnimating = false;
                $("#content").remove();
                $("#newcontent").attr("id", "content");
                $(".data-row").removeClass("animating");
            }, 250);
            finalize();
        }

        function finalize() {
            bindEvents();
            colorize();
            nav = "same";
        }
    }

    function bindEvents() {
        /* TODO: file moving
        $(".data-row").draggable({
            addClasses: false,
            axis: "y",
            cursor: "move",
            delay: 200,
            revert: true,
            scroll: true
        }); */

        // Bind mouse event to switch into a folder
        $(".data-row[data-type='folder']").off("click").on("click", function (e) {
            if (e.button !== 0) return;
            var destination = $(this).data("id").replace("&amp;", "&");
            updateLocation(destination, true);
        });
        // Bind mouse event to delete a file/folder
        $(".icon-delete").off("click").on("click", function (e) {
            if (e.button !== 0 || socketWait) return;
            sendMessage("DELETE_FILE", $(this).parent().data("id"));
        });
    }

    function colorize() {
        $(".filelink").each(function () {
            var filename = $(this).attr("download");
            var colors = [], dot = filename.lastIndexOf(".");

            if (dot > -1 && dot < filename.length)
                colors = colorFromString(filename.substring(dot + 1, filename.length));
            else
                colors = colorFromString(filename);

            var red   = colors[0];
            var green = colors[1];
            var blue  = colors[2];

            if (red > 180)   red = 180;
            if (green > 180) green = 180;
            if (blue > 180)  blue = 180;

            if (red < 60)    red = 60;
            if (green < 60)  green = 60;
            if (blue < 60)   blue = 60;

            $(this).parent().children(".icon-file").css("color", "#" + red.toString(16) + green.toString(16) + blue.toString(16));
        });
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

    function convertToSI(bytes) {
        var step = 0, units = ["bytes", "KiB", "MiB", "GiB", "TiB"];
        while (bytes >= 1024) {
            bytes /= 1024;
            step++;
        }
        return [(step === 0) ? bytes : bytes.toFixed(2), units[step]].join(" ");
    }

    // get RGB color values for a given string
    // based on https://github.com/garycourt/murmurhash-js
    function colorFromString(string) {
        var remainder, bytes, h1, h1b, c1, c2, k1, i;
        remainder = string.length & 3;
        bytes = string.length - remainder;
        h1 = 0; // Seed value
        c1 = 0xcc9e2d51;
        c2 = 0x1b873593;
        i = 0;

        while (i < bytes) {
            k1 = ((string.charCodeAt(i) & 0xff)) |
                 ((string.charCodeAt(++i) & 0xff) << 8) |
                 ((string.charCodeAt(++i) & 0xff) << 16) |
                 ((string.charCodeAt(++i) & 0xff) << 24);
            ++i;
            k1 = ((((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16))) & 0xffffffff;
            k1 = (k1 << 15) | (k1 >>> 17);
            k1 = ((((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16))) & 0xffffffff;
            h1 ^= k1;
            h1 = (h1 << 13) | (h1 >>> 19);
            h1b = ((((h1 & 0xffff) * 5) + ((((h1 >>> 16) * 5) & 0xffff) << 16))) & 0xffffffff;
            h1 = (((h1b & 0xffff) + 0x6b64) + ((((h1b >>> 16) + 0xe654) & 0xffff) << 16));
        }
        k1 = 0;
        switch (remainder) {
            case 3: k1 ^= (string.charCodeAt(i + 2) & 0xff) << 16;
            case 2: k1 ^= (string.charCodeAt(i + 1) & 0xff) << 8;
            case 1: k1 ^= (string.charCodeAt(i) & 0xff);
            k1 = (((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16)) & 0xffffffff;
            k1 = (k1 << 15) | (k1 >>> 17);
            k1 = (((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16)) & 0xffffffff;
            h1 ^= k1;
        }
        h1 ^= string.length;
        h1 ^= h1 >>> 16;
        h1 = (((h1 & 0xffff) * 0x85ebca6b) + ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16)) & 0xffffffff;
        h1 ^= h1 >>> 13;
        h1 = ((((h1 & 0xffff) * 0xc2b2ae35) + ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16))) & 0xffffffff;
        h1 ^= h1 >>> 16;

        var result = h1 >>> 0;
        var colors = [];
        var j = 3;
        while (j) {
            colors[--j] = result & (255);
            result = result >> 8;
        }
        return colors;
    }

    function log(msg) {
        if (debug) console.log(msg);
    }

}(jQuery, window, document));