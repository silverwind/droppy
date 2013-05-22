(function ($) {
    "use strict";

    // debug logging
    var debug = false;

    var smallScreen = $(window).width() < 640;

    // "globals"
    var folderList, socketOpen, socketWait, isUploading, hasLoggedOut, fileInput,
        currentFolder, socket, socketTimeout, activeFiles, animatingData;

    // Separetely init the variables so we can init them on demand
    initVariables();
// ============================================================================
//  Page loading functions
// ============================================================================
    function getPage() {
        $.ajax({
            url: "/content",
            success: function (data, textStatus, request) {
                load(request.getResponseHeader("X-Page-Type"), data);
            }
        });
    }

    // Switch the body's content with an animation
    function load(type, data) {
        $("body").append('<div id="new">' + data + '</div>');
        var newPage = $("#new"), oldPage = $("#page");

        switch (type) {
        case "auth":
            initAuthPage();

            var loginform = $("#login-form"),
                body      = $("body"),
                from      = smallScreen ? "20%" : "70%",
                to        = smallScreen ? "0%" : "50%";

            body.css("overflow", "hidden");
            loginform.css("top", from);
            loginform.css("opacity", 0);

            oldPage.animate({"opacity": 0}, {duration: 250, queue: false});
            loginform.animate({"opacity": 1}, {duration: 250, queue: false});
            loginform.animate({"top": to}, {duration: 250, queue: false, complete : function () {
                switchID();
                body.removeAttr("style");
                loginform.removeAttr("style");
                if (hasLoggedOut) {
                    window.setTimeout(function () {
                        $("#login-info").fadeIn(300);
                    }, 300);
                }
            }});
            break;
        case "main":
            initMainPage();
            var navigation = $("#navigation"),
                about      = $("#about");

            // Set pre-animation positions
            navigation.css("top", "-42px");
            about.css("top", "-250px");

            oldPage.animate({"opacity": 0}, {duration: 250, queue: false});
            navigation.animate({"top": 0}, {duration: 500, queue: false, complete: function () {
                switchID();

                // Remove inline style caused by animation
                navigation.removeAttr("style");
                about.animate({"top": "-200px"}, {duration: 500, queue: false, complete: function () {
                    $(this).removeAttr("style");
                }});
            }});
            break;
        }


        // Switch ID of #new for further animation
        function switchID() {
            oldPage.remove();
            newPage.attr("id", "page");
        }
    }

    $(getPage);
// ============================================================================
//  WebSocket functions
// ============================================================================
    function openSocket() {
        if (socketOpen) return;

        if (document.location.protocol === "https:")
            socket = new WebSocket('wss://' + document.location.host);
        else
            socket = new WebSocket('ws://' + document.location.host);

        socket.onopen = function () {
            socketOpen = true;
            // Request initial update
            updateLocation(currentFolder || "/", false);

            // Close the socket to prevent Firefox errors
            $(window).on('beforeunload', function () {
                socket.close();
                socketOpen = false;
            });
        };

        socket.onmessage = function (event) {
            var msg = JSON.parse(event.data);
            switch (msg.type) {

            case "UPDATE_FILES":
                if (isUploading) return;

                if (msg.folder === currentFolder.replace(/&amp;/, "&")) {
                    updateCrumbs(msg.folder);
                    activeFiles = msg.data;
                    buildHTML(msg.data, msg.folder);
                    socketWait = false;
                }
                break;
            case "UPLOAD_DONE":
                isUploading = false;
                updateTitle(currentFolder, true);
                sendMessage("REQUEST_UPDATE", currentFolder);
                break;
            case "NEW_FOLDER":
                updateCrumbs(msg.folder);
                activeFiles = msg.data;
                updateLocation(msg.folder);
                buildHTML(msg.data, msg.folder);
                socketWait = false;
                break;
            case "UNAUTHORIZED":
                // Set the socketTimeout to its maximum value to stop retries
                socketTimeout = 51200;
                break;
            }
        };

        socket.onclose = function () {
            socketOpen = false;

            // Restart a closed socket. Firefox closes it on every download..
            // https://bugzilla.mozilla.org/show_bug.cgi?id=858538

            if (!socketTimeout) socketTimeout = 50;
            if (socketTimeout < 51200) {
                // This gives up connecting after 10 failed reconnects with increasing intervals
                window.setTimeout(function () {
                    try {
                        if (!hasLoggedOut) socket.socket.connect();
                    } catch (e) {
                        log("socket error: " + e);
                    } finally {
                        socketTimeout *= 2;
                    }
                }, socketTimeout);
            }
        };
    }

    function sendMessage(msgType, msgData) {
        if (!socketOpen) return;
        startSocketWait();
        socket.send(JSON.stringify({
            type: msgType,
            data: msgData
        }));
    }

    // Wait 1 second for a socket response before unlocking the UI again
    function startSocketWait() {
        socketWait = true;
        setTimeout(function () {
            socketWait = false;
        }, 1000);
    }
// ============================================================================
//  Authentication page JS
// ============================================================================
    function initAuthPage() {
        var user      = $("#user"),
            pass      = $("#pass"),
            form      = $("#loginform"),
            submit    = $("#submit"),
            remember  = $("#remember"),
            logininfo = $("#login-info");

        user.focus();

        user.unbind("keydown").keydown(function () {
            logininfo.fadeOut(300);
        });

        // Return submits the form
        pass.unbind("keyup").keyup(function (e) {
            if (e.keyCode === 13) {
                submitForm(form, submit);
            }
        });

        // Spacebar toggles the checkbox
        remember.unbind("keyup").keyup(function (e) {
            if (e.keyCode === 32) {
                $("#check").trigger("click");
            }
        });

        form.unbind("submit").submit(function (e) {
            e.preventDefault();
            submitForm(form, submit);
        });

        user.unbind("focus").focus(function () {
            submit.removeClass("invalid");
            logininfo.fadeOut(300);
        });

        pass.unbind("focus").focus(function () {
            submit.removeClass("invalid");
            logininfo.fadeOut(300);
        });

        function submitForm(form) {
            $.ajax({
                type: "POST",
                url: "/login",
                data: form.serialize(),
                success: function (data) {
                    if (data === "OK")
                        getPage();
                    else
                        submit.attr("class", "invalid");
                }
            });
        }
    }
// ============================================================================
//  Main page JS
// ============================================================================
    function initMainPage() {
        // Open Websocket for initial update
        window.setTimeout(openSocket, 50);
        currentFolder = decodeURIComponent(window.location.pathname);
        hasLoggedOut = false;

        fileInput = $(":file").wrap($("<div/>").css({
            "height"  : 0,
            "width"   : 0,
            "overflow": "hidden"
        }));

        // Stop dragenter and dragover from killing our drop event
        $(document.documentElement).on("dragenter", function (e) { e.stopPropagation(); e.preventDefault(); });
        $(document.documentElement).on("dragover",  function (e) { e.stopPropagation(); e.preventDefault(); });

        // jQuery's event handler for drop doesn't get event.dataTransfer
        $(document.documentElement)[0].addEventListener("drop", function (event) {
            event.stopPropagation();
            event.preventDefault();
            createFormdata(event.dataTransfer.files);
        });

        fileInput.unbind("change").change(function () {
            if ($("#file").val() !== "") {
                var files = $("#file").get(0).files;
                var num = files.length;
                var formData = new FormData();
                if (num > 0) {
                    for (var i = 0; i < num; i++) {
                        activeFiles[files[i].name] = {
                            size: files[i].size,
                            type: "nf"
                        };
                        formData.append(files[i].name, files[i]);
                    }
                    buildHTML(activeFiles, activeFiles.folder);
                    createFormdata(files);
                }
                $("#file").val(""); // Reset file form
            }
        });

        $("#upload").unbind("click").click(function () {
            fileInput.click();
        });

        var info        = $("#name-info"),
            nameinput   = $("#name-input"),
            nameoverlay = $("#name-overlay");

        // Show popup for folder creation
        $("#add-folder").unbind("click").click(function () {
            nameoverlay.fadeToggle(350);
            if (nameoverlay.is(":visible"))
                nameinput.focus();
            nameinput.val("");
            nameinput.attr("class", "valid");
            info.hide();
        });

        // Handler for the input of the folder name
        nameinput.unbind("keyup").keyup(function (e) {
            if (e.keyCode === 27) // Escape Key
                nameoverlay.toggle();

            var input = nameinput.val();
            var valid = !input.match(/[\\*{}\/<>?|]/) && !input.match(/\.\./);
            var folderExists = folderList[input.toLowerCase()] === true;
            if (input === "") {
                nameinput.removeClass("invalid");
                info.fadeOut(350);
                return;
            }

            if (!valid || folderExists) {
                nameinput.addClass("invalid");
                info.html(folderExists ? "File/Directory already exists!" : "Invalid characters in filename!");
                info.fadeIn(350);
                return;
            }

            nameinput.removeClass("invalid");
            info.fadeOut(350);

            if (e.keyCode === 13) { // Return Key
                if (currentFolder === "/")
                    sendMessage("CREATE_FOLDER", "/" + input);
                else
                    sendMessage("CREATE_FOLDER", currentFolder + "/" + input);
                nameoverlay.fadeOut(350);
            }
        });

        var arrow     = $("#arrow"),
            arrowtext = $(".arrow-text"),
            about     = $("#about"),
            arrowdown = $(".arrow-text.down"),
            arrowup   = $(".arrow-text.up");

        arrowtext.unbind("click").click(function () {
            if (arrow.attr("class") === "down") {
                about.css("top", "50%");
                about.css("margin-top", "-100px");
                window.setTimeout(function () {
                    arrow.attr("class", "up");
                    arrowdown.hide();
                    arrowup.show();
                }, 400);
            } else {
                about.css("top", "-200px");
                about.css("margin-top", "0");
                window.setTimeout(function () {
                    arrow.attr("class", "down");
                    arrowup.hide();
                    arrowdown.show();
                }, 400);
            }
        });

        $("#logout").unbind("click").click(function () {
            sendMessage("LOGOUT");
            socket.close();
            deleteCookie("sid");
            hasLoggedOut = true;
            initVariables(); // Reset some vars to their init state
            getPage();
        });
        // ============================================================================
        //  Helper functions for the main page
        // ============================================================================
        function createFormdata(files) {
            if (!files) return;
            var formData = new FormData();
            for (var i = 0, len = files.length; i < len; i++) {
                formData.append(files[i].name, files[i]);
            }
            uploadFiles(formData);
        }

        function uploadFiles(formData) {
            var xhr = new XMLHttpRequest();
            uploadInit();

            xhr.open("post", "/upload", true);
            isUploading = true;

            xhr.addEventListener('error', function (event) {
                log("XHR error: " + event);
                uploadDone();
            }, false);

            xhr.upload.onprogress = function (event) {
                if (event.lengthComputable) {
                    uploadProgress(event.loaded, event.total);
                }
            };

            xhr.send(formData);

            xhr.onload = function () {
                if (this.status === 200) {
                    uploadDone();
                }
            };
        }

        var start, progressBars;
        var ui = $("#upload-info");
        var utl = $("#upload-time-left");
        var uperc = $("#upload-percentage");

        function uploadInit() {
            start = new Date().getTime();

            progressBars = $(".progressBar");
            progressBars.show();
            progressBars.width("0%");

            updateTitle("0%");
            uperc.html("0%");

            utl.html("");
            ui.animate({top: "-2px"}, 250);
        }

        function uploadDone() {
            progressBars.width("100%");

            updateTitle("100%");
            uperc.html("100%");

            utl.html("finished");
            ui.animate({top: "-50px"}, 250);
        }

        function uploadProgress(bytesSent, bytesTotal) {
            var progress = Math.round((bytesSent / bytesTotal) * 100) + "%";

            progressBars.width(progress);
            updateTitle(progress);
            uperc.html(progress);

            // Calculate estimated time left
            var elapsed = (new Date().getTime()) - start;
            var estimate = bytesTotal / (bytesSent / elapsed);
            var secs = (estimate - elapsed) / 1000;

            if (secs > 120) {
                utl.html("less than " + Math.floor((secs / 60) + 1) + " minutes left");
            } else if (secs > 60) {
                utl.html("less than 2 minutes left");
            } else if (secs < 1.5) {
                utl.html("less than a second left");
            } else {
                utl.html(Math.round(secs) + " seconds left");
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
            if (!parts)
                prefix = "/";
            else
                prefix = parts[parts.length - 1];
        } else {
            prefix = text;
        }
        document.title = [prefix, suffix].join(" - ");
    }

    // Listen for "popstate" events, which indicate the user navigated back
    $(window).unbind("popstate").bind("popstate", function () {
        currentFolder = decodeURIComponent(window.location.pathname);
        sendMessage("SWITCH_FOLDER", currentFolder);
    });

    var nav;

    // Update our current location and change the URL to it
    function updateLocation(path, doSwitch) {
        if (socketWait) return; // Dont switch location in case we are still waiting for a response from the server

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
        window.history.pushState(true, true, currentFolder);
    }

    function updateCrumbs(path) {
        updateTitle(path, true);
        var parts = path.split("/");
        parts[0] = "droppy";

        // Remove trailing empty string
        if (parts[parts.length - 1] === "") parts.pop();

        // Build the list
        var html = '<ul id="crumbs">';
        var elementPath = "";

        for (var i = 0, len = parts.length; i < len; i++) {
            if (parts[i] === "droppy") {
                html += '<li data-path="/">' + parts[i] + '</li>';
            } else {
                elementPath += "/" + parts[i];
                html += '<li data-path="' + elementPath + '">' + parts[i] + '</li>';
            }
        }

        html += '<div></div></ul>';

        var oldLen = $("#current ul li").length;

        // Load crumbs into view
        $("#current").html(html);

        // Animate last added element
        if ($("#crumbs li").length > oldLen) {
            var last = $("#crumbs li:last");
            last.css("opacity", 0);
            last.animate({"opacity" : 1}, 200);
        }

        // Folder switching by breadcrumb
        $("#crumbs li").unbind("click").click(function (e) {
            if (e.button !== 0 || animatingData) return;
            e.preventDefault();
            var destination = $(this).data("path");
            updateLocation(destination, true);
        });
    }

    function buildHTML(fileList, root) {
        var folderList = [];
        var list = $("<ul>");
        for (var file in fileList) {
            var size = convertToSI(fileList[file].size);

            var id = (root === "/") ? "/" + file : root + "/" + file;

            if (fileList[file].type === "f" || fileList[file].type === "nf") { // Create a file row
                var downloadURL = window.location.protocol + "//" + window.location.host + "/get" + encodeURIComponent(id);
                var addProgress = "";

                if (fileList[file].type === "nf") {
                    addProgress = '<div class="progressBar"></div>';
                }

                list.append(
                    '<li class="data-row" data-type="file" data-id="' + id + '"><span class="icon icon-file"></span>' +
                    '<a class="filelink" href="' + downloadURL + '" download="' + file + '">' + file + '</a>' +
                    '<span class="icon-delete icon"></span><span class="data-info">' + size + '</span>' +
                    '</span><span class="right-clear"></span>' +  addProgress + '</li>'
                );

            } else {  // Create a folder row
                list.append(
                    '<li class="data-row" data-type="folder" data-id="' + id + '"><span class="icon icon-folder"></span>' +
                    '<span class="data-name folder">' + file + '</span>' +
                    '<span class="icon-delete icon"></span>' +
                    '</span><span class="right-clear"></span></li>'
                );

                // Add to list of currently displayed folders
                folderList[name.toLowerCase()] = true;
            }
        }

        // Sort first by class, then alphabetically
        var items = $(list).children("li");
        items.sort(function (a, b) {
            var result = $(b).data("type").toUpperCase().localeCompare($(a).data("type").toUpperCase());
            if (result !== 0)
                return result;
            else
                return $(a).text().toUpperCase().localeCompare($(b).text().toUpperCase());
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
            $("#content").html('<div id="sorry"><div id="sorry-icon" class="icon"></div><div id="sorry-text-outer"><div id="sorry-text">Sorry, there appears to be nothing here. Why not start by<span id="upload-inline"><span class="icon"></span> adding files</span>?</div></div></div>');
            $("#upload-inline").unbind("click").click(function () {
                fileInput.click();
            });
            nav = "same";
        }
    }

    function loadContent(list) {
        // Load generated list into view with an animation
        if (nav === "same") {
            finalize(true);
            return;
        } else {
            var holder = $("#holder");
            animatingData = true;
            $(".data-row").addClass("animating");
            $("#content").css("overflow-y", "hidden");
            holder.append($("<section id='newcontent'></section>"));
            $("#newcontent").attr("class", nav === "forward" ? "new-right" : "new-left");
            $("#newcontent").html(list);

            holder.addClass(nav === "forward" ? "to-left" : "to-right", 200, "swing", function () {
                $("#content").remove();
                $("#newcontent").attr("id", "content");
                $("#newcontent").removeAttr("class");
                holder.removeAttr("class");
                $(".data-row").removeClass("animating");
                $("#content").css("overflow-y", "scroll");
                animatingData = false;
                finalize();
            });
        }

        function finalize(samePage) {
            if (samePage) $("#content").html(list);
            bindEvents();
            colorize();
            nav = "same";
        }
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

            if (red > 200)   red = 200;
            if (green > 200) green = 200;
            if (blue > 200)  blue = 200;

            if (red < 60)    red = 60;
            if (green < 60)  green = 60;
            if (blue < 60)   blue = 60;

            $(this).parent().children(".icon-file").css("color", "#" + red.toString(16) + green.toString(16) + blue.toString(16));
        });
    }

    function bindEvents() {

        // Bind mouse event to switch into a folder
        $(".data-row[data-type='folder']").unbind("click").click(function (e) {
            if (e.button !== 0) return;

            var destination = $(this).data("id").replace("&amp;", "&");
            updateLocation(destination, true);
        });

        // Bind mouse event to delete a file/folder
        $(".icon-delete").unbind("click").click(function (e) {
            if (e.button !== 0 || socketWait) return;
            sendMessage("DELETE_FILE", $(this).parent().data("id"));
        });
    }

    function deleteCookie(name) {
        document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:01 GMT;";
    }

    function initVariables() {
        folderList = [];
        socketOpen = false;
        socketWait = false;
        isUploading = false;
        currentFolder = false;
        socketTimeout = false;
        activeFiles = false;
    }

    function convertToSI(bytes) {
        var step = 0;
        var units = ["bytes", "KiB", "MiB", "GiB", "TiB"];

        while (bytes >= 1024) {
            bytes /= 1024;
            step++;
        }
        return [(step === 0) ? bytes : bytes.toFixed(2), units[step]].join(" ");
    }

    function log(msg) {
        if (debug) {
            console.log(msg);
        }
    }

    // get RGB color values for a given string
    // based on : https://github.com/garycourt/murmurhash-js
    function colorFromString(string) {
        var remainder, bytes, h1, h1b, c1, c2, k1, i;
        remainder = string.length & 3;
        bytes = string.length - remainder;
        h1 = 0; // Seed value
        c1 = 0xcc9e2d51;
        c2 = 0x1b873593;
        i = 0;

        while (i < bytes) {
            k1 =
              ((string.charCodeAt(i) & 0xff)) |
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

        var integer = h1 >>> 0;
        var colors = [];

        var j = 3;
        while (j) {
            colors[--j] = integer & (255);
            integer = integer >> 8;
        }
        return colors;
    }

}(jQuery));
