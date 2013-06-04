/* globals Modernizr */
(function ($, window, document) {
    "use strict";

    var debug; // live css reload and debug logging - this variable is set by the server
    var smallScreen = $(window).width() < 640;

    var currentData, currentFolder, hasLoggedOut, isAnimating,
        isUploading, savedParts, socket, socketWait;

    initVariables(); // Separately init the variables so we can init them on demand

// ============================================================================
//  jQuery / modernizr extensions, requestAnimationFrame
// ============================================================================
    // Add the dataTransfer property to the "drop" event.
    $.event.props.push("dataTransfer");

    // Set a class on freshly inserted elements, once the DOM has fully loaded it
    $.fn.setClass = function (newclass) {
        if (Modernizr.cssanimations) {
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

    if (Modernizr.cssanimations) {
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

    // Add a modernizr test for directory input
    Modernizr.addTest("inputdirectory", function () {
        var input = document.createElement("input");
        input.type = "file";
        return "webkitdirectory" in input || "mozdirectory" in input ||
               "msdirectory" in input || "odirectory" in input || "directory" in input;
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
            url: "/content",
            success: function (data, textStatus, request) {
                load(request.getResponseHeader("X-Page-Type"), data);
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
            requestAnimation(function () {
                oldPage.attr("class", "out");
                login.removeClass("in").addClass("out");
                setTimeout(function () {
                    $("#navigation").attr("class", "in");
                    setTimeout(function () {
                        initMainPage();
                        finalize();
                    }, 250);
                }, 250);
            });
        } else if (type === "auth") {
            requestAnimation(function () {
                oldPage.attr("class", "out");
                $("#navigation").addClass("farout");
                setTimeout(function () {
                    login.removeClass("out").addClass("in");
                    setTimeout(function () {
                        initAuthPage();
                        finalize();
                        if (hasLoggedOut) {
                            setTimeout(function () {
                                $("#login-info").attr("class", "info");
                                $("#login-info").html("Logged out!");
                                $("#login-info").fadeIn(250);
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
        socket = new WebSocket(protocol + document.location.host + "/");
        socket.onopen    = function (event) { onOpen(event);    };
        socket.onclose   = function (event) { onClose(event);   };
        socket.onmessage = function (event) { onMessage(event); };

        function onOpen() {
            if (queuedData) {
                sendMessage();
            } else
                updateLocation(currentFolder || "/", false); // Request initial update
        }

        function onClose(event) {
            if (hasLoggedOut || event.code === 4000) return;
            if (event.code >= 1002 && event.code < 3999) {
                log("Websocket closed unexpectedly with code " + event.code + ". Reconnecting...");
                openSocket();
            } else if (reopen) {
                openSocket();
                reopen = false;
            }
        }

        function onMessage(event) {
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
            case "FILE_LINK":
                // TODO: UI for this
                window.prompt("Download Link:", window.location.protocol + "//" + window.location.host + "/get/" +  msg.link);
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
        }
    }

    function sendMessage(msgType, msgData) {
        if (socket.readyState === 1) { // open
            socketWait = true;

            setTimeout(function () {
                socketWait = false; // Unlock the UI in case we get no socket resonse after waiting for 1 second
            }, 1000);

            if (queuedData) {
                socket.send(queuedData);
                queuedData = false;
            } else
                socket.send(JSON.stringify({type: msgType, data: msgData}));
        } else if (socket.readyState === 0) { // connecting
            queuedData = JSON.stringify({type: msgType, data: msgData});
        } else if (socket.readyState === 2) { // closing
            queuedData = JSON.stringify({type: msgType, data: msgData});
            reopen = true;
        } else if (socket.readyState === 3) { // closed
            openSocket();
        }
    }
// ============================================================================
//  Authentication page JS
// ============================================================================
    function initAuthPage() {
        var form      = $("#form"),
            loginform = $("#login-form"),
            logininfo = $("#login-info"),
            submit    = $("#submit");

        $("#user").focus();

        // Remove invalid class on user action
        $("#user, #pass").off("click keydown focus").on("click keydown focus", function () {
            submit.removeClass("invalid");
            loginform.removeClass("invalid");
            logininfo.fadeOut(300);
        });

        // Return submits the form
        $("#user, #pass").off("keyup").on("keyup", function (e) {
            if (e.keyCode === 13) {
                submitForm();
            }
        });

        // Spacebar toggles the checkbox
        $("#remember").off("keyup").on("keyup", function (e) {
            if (e.keyCode === 32) {
                $("#check").trigger("click");
            }
        });

        // Submit the form over xhr
        form.off("submit").on("submit", function (e) {
            e.preventDefault();
            submitForm();
        });

        function submitForm() {
            $.ajax({
                type: "POST",
                url: "/login",
                data: form.serialize(),
                success: function (response) {
                    if (response === "OK") {
                        hasLoggedOut = false;
                        getPage();
                    } else {
                        submit.addClass("invalid");
                        loginform.addClass("invalid");
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
        currentFolder = decodeURIComponent(window.location.pathname);
        hasLoggedOut = false;

        // Open the WebSocket
        openSocket();

        // Close the socket gracefully
        $(window).off("beforeunload").on("beforeunload", function () {
            if (socket && socket.close && socket.readyState < 2)
                socket.close(1001);
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
        $(window).off("resize").on("resize", function () {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(function () {
                smallScreen = $(window).width() < 640;
                checkPathWidth();
            }, 100);
        });

        var fileInput = $("#file");
        fileInput.off("change").on("change", function () {
            if (fileInput.val()) {
                upload($("#file").get(0).files, true);
                fileInput.val(""); // Reset the input element
            }
        });

        // Set the correct attributes on our file input before redirecting the click
        $("#upload-file").off("click").on("click", function () {
            if (Modernizr.inputdirectory) {
                fileInput.removeAttr("directory");
                fileInput.removeAttr("msdirectory");
                fileInput.removeAttr("mozdirectory");
                fileInput.removeAttr("webkitdirectory");
            }
            fileInput.click();
        });

        if (Modernizr.inputdirectory) {
            // Set the attributes for directory uploads, so we get a directory picker dialog.
            $("#upload-folder").off("click").on("click", function () {
                fileInput.attr("directory",       "directory");
                fileInput.attr("msdirectory",     "msdirectory");
                fileInput.attr("mozdirectory",    "mozdirectory");
                fileInput.attr("webkitdirectory", "webkitdirectory");
                fileInput.click();
            });
        } else {
            $("#upload-folder").css("color", "#444").attr("title", "Sorry, your browser doesn't support directory uploading yet!");
        }

        var info        = $("#name-info"),
            nameinput   = $("#name-input"),
            createbox   = $("#create-folder-box"),
            activeFiles;

        // Show popup for folder creation
        $("#create-folder").off("click").on("click", function () {
            activeFiles = [];
            $(".filelink, .folderlink").each(function () {
                activeFiles.push($(this).html().toLowerCase());
            });
            nameinput.val("");
            nameinput.removeClass("invalid");
            createbox.removeClass("invalid");
            info.hide();
            requestAnimation(function () {
                createbox.setClass(createbox.attr("class") !== "in" ? "in" : "out");
                setTimeout(function () {
                    nameinput.focus();
                }, 300);
            });
        });

        // Handler for the input of the folder name
        nameinput.off("keyup").on("keyup", function (e) {
            if (e.keyCode === 27) createbox.setClass("out"); // Escape Key
            var input = nameinput.val();
            var valid = !input.match(/[\\*{}\/<>?|]/) && !input.match(/\.\./);
            var folderExists;
            for (var i = 0, len = activeFiles.length; i < len; i++)
                if (activeFiles[i] === input.toLowerCase()) folderExists = true;
            if (input === "") {
                nameinput.removeClass();
                createbox.removeClass("valid invalid");
                info.fadeOut(300);
            } else if (!valid || folderExists) {
                nameinput.removeClass("valid").addClass("invalid");
                createbox.addClass("invalid");
                info.html(folderExists ? "File or folder already exists!" : "Invalid character(s) in filename!");
                info.fadeIn(300);
            } else {
                createbox.removeClass("invalid").addClass("valid");
                nameinput.removeClass("invalid").addClass("valid");
                info.fadeOut(300);
                if (e.keyCode === 13) { // Return Key
                    if (currentFolder === "/")
                        sendMessage("CREATE_FOLDER", "/" + input);
                    else
                        sendMessage("CREATE_FOLDER", currentFolder + "/" + input);
                    createbox.removeClass("in").addClass("out");
                }
            }
        });

        $("#about").off("click").on("click", function () {
            requestAnimation(function () {
                $("#about-box").setClass($("#about-box").attr("class") !== "in" ? "in" : "out");
            });
        });

        $("#logout").off("click").on("click", function () {
            hasLoggedOut = true;
            socket.close(4001);
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

        var start, progressBars, lastUpdate,
            infobox  = $("#upload-info"),
            timeleft = $("#upload-time-left"),
            uperc    = $("#upload-percentage");

        function uploadInit() {
            start = new Date().getTime();

            progressBars = $(".progressBar");
            progressBars.width("0%");
            progressBars.show();

            updateTitle("0%");
            uperc.html("0%");

            timeleft.html("");
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

            // Update progress every 250ms at most
            if (!lastUpdate || (Number(new Date()) - lastUpdate) >= 250) {
                lastUpdate = Number(new Date());

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

                if (secs > 60) {
                    timeleft.html(Math.ceil(secs / 60) + " minutes left");
                } else {
                    timeleft.html(Math.ceil(secs) + " seconds left");
                }
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

                // Skip the push if we're already navigation through history
                if (!skipPush) window.history.pushState(null, null, currentFolder);
            } else
                setTimeout(queue, 50, time + 50);
        })(0);
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

    function buildHTML(fileList, root) {
        var list = $("<ul></ul>"), downloadURL, type, size, id, progressBar;
        for (var file in fileList) {
            type = fileList[file].type;
            size = convertToSI(fileList[file].size);
            id = (root === "/") ? "/" + file : root + "/" + file;
            progressBar = (type === "nf" || type === "nd") ? '<div class="progressBar"></div>' : "";

            if (type === "f" || type === "nf") { // Create a file row
                downloadURL = window.location.protocol + "//" + window.location.host + "/get" + encodeURIComponent(id);
                var spriteClass = getSpriteClass(getFileExtension(file));
                list.append(
                    '<li class="data-row" data-type="file" data-id="' + id + '"><span class="' + spriteClass + '"></span>' +
                    '<a class="filelink" href="' + downloadURL + '" download="' + file + '">' + file + '</a>' +
                    '<span class="icon-delete icon"></span>' +
                    '<span class="icon-link icon"></span>' +
                    '<span class="data-info">' + size + '</span>' + progressBar + '</li>'
                );
            } else if (type === "d" || type === "nd") {  // Create a folder row
                list.append(
                    '<li class="data-row" data-type="folder" data-id="' + id + '"><span class="sprite sprite-folder"></span>' +
                    '<span class="folderlink">' + file + '</span><span class="icon-delete icon"></span>' + progressBar + '</li>'
                );
            }
        }
        $(list).children("li").sort(function (a, b) {
            var type = $(b).data("type").toUpperCase().localeCompare($(a).data("type").toUpperCase());
            var extension = getFileExtension($(a).children(".filelink").text().toUpperCase())
                                 .localeCompare(getFileExtension($(b).children(".filelink").text().toUpperCase()));
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

        if ($(list).children("li").length > 0)
            loadContent(list);
        else {
            loadContent(false);
        }
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
                $("#newcontent").setClass("center");

                // Switch classes once the transition has finished
                setTimeout(function () {
                    isAnimating = false;
                    $("#content").remove();
                    $("#newcontent").attr("id", "content");
                    $(".data-row").removeClass("animating");
                }, 250);
            }
            bindEvents();
            nav = "same";
        });
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

        // Reconnect socket on Firefox < 23
        $(".filelink").off("click").on("click", function () {
            reopen = true;
        });

        // Upload icon on empty page
        $("#upload-inline").off("click").on("click", function () {
            $("#file").click();
        });

        // Switch into a folder
        $(".data-row[data-type='folder']").off("click").on("click", function () {
            if (socketWait) return;
            var destination = $(this).data("id").replace("&amp;", "&");
            updateLocation(destination, true);
        });

        // Request a public link
        $(".icon-link").off("click").on("click", function () {
            if (socketWait) return;
            sendMessage("REQUEST_LINK", $(this).parent().data("id"));
        });

        // Delete a file/folder
        $(".icon-delete").off("click").on("click", function () {
            if (socketWait) return;
            sendMessage("DELETE_FILE", $(this).parent().data("id"));
        });
    }

    function getFileExtension(filename) {
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

    function convertToSI(bytes) {
        var step = 0, units = ["bytes", "KiB", "MiB", "GiB", "TiB"];
        while (bytes >= 1024) {
            bytes /= 1024;
            step++;
        }
        return [(step === 0) ? bytes : Math.round(bytes), units[step]].join(" ");
    }

    if (Function.prototype.bind && console && typeof console.log === "object") {
        console.log = Function.prototype.bind.call(console.log, console);
    }

    function log() {
        if (debug && console)
            console.log.apply(console, arguments);
    }

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

    function getSpriteClass(extension) {
        for (var type in iconmap) {
            if (iconmap[type.toLowerCase()].indexOf(extension.toLowerCase()) > -1) {
                return "sprite sprite-" + type;
            }
        }
        return "sprite sprite-bin";
    }
}(jQuery, window, document));