/* global Dropzone, io */

(function ($) {
    "use strict";

    var folderList = [], socketOpen = false, socketWait = false, isUploading = false;
    var currentFolder, socket, timeout, hoverIndex, activeFiles;

/* ============================================================================
 *  Page loading functions
 * ============================================================================
 */
    function getPage() {
        $.getJSON('/content', function (response) {
            load(response.type, response.data);
        });
    }

    // Switch the body's content with an animation
    function load(type, data) {
        $("body").append('<div id="new">' + data + '</div>');
        var newPage = $("#new");
        var oldPage = $("#page");

        if (type === "auth") {
            initAuthPage();
            switchID();
        } else {
            initMainPage();
            var navigation = $("#navigation"),
                   current = $("#current"),
                     title = $("#title");

            // Set pre-animation positions
            navigation.css("top", "-3.5em");
            current.css("top", "-1.5em");
            title.css("top", "-250px");

            oldPage.animate({"opacity": 0}, {duration: 300, queue: false});
            current.animate({"top": "2em"}, {duration: 600, queue: false});
            navigation.animate({"top": 0}, {duration: 600, queue: false, complete: function () {
                // Remove inline style caused by animation
                $(this).removeAttr("style");
                current.removeAttr("style");

                switchID();
                title.animate({"top": "-200px"}, {duration: 600, queue: false, complete: function () {
                    $(this).removeAttr("style");
                }});
            }});
        }

        // Switch ID of #new for further animation
        function switchID() {
            oldPage.remove();
            newPage.attr("id", "page");
            oldPage.removeAttr("style");
        }
    }

    $(getPage);
/* ============================================================================
 *  WebSocket functions
 * ============================================================================
 */
    function openSocket() {
        if (socketOpen) return;
        socket = io.connect(document.location.protocol + "//" + document.location.host);

        socket.on("connect", function () {
            socketOpen = true;
            // Request initial update
            updateLocation(currentFolder || "/", false);

            // Close the socket to prevent Firefox errors
            $(window).on('beforeunload', function () {
                socket.disconnect();
                socketOpen = false;
            });
        });

        socket.on("UPDATE_FILES", function (data) {
            if (isUploading) return;
            var msgData = JSON.parse(data);
            if (msgData.folder === currentFolder.replace(/&amp;/, "&")) {
                updateCrumbs(msgData.folder);
                activeFiles = msgData;
                buildHTML(msgData.data, msgData.folder);
                socketWait = false;
            }
        });

        socket.on("UPLOAD_DONE", function () {
            isUploading = false;
            sendMessage("REQUEST_UPDATE", currentFolder);
        });

        socket.on("NEW_FOLDER", function (data) {
            var msgData = JSON.parse(data);
            updateCrumbs(msgData.folder);
            activeFiles = msgData;
            buildHTML(msgData.data, msgData.folder);
            socketWait = false;
        });

        socket.on("disconnect", function () {
            socketOpen = false;

            // Restart a closed socket. Firefox closes it on every download..
            // https://bugzilla.mozilla.org/show_bug.cgi?id=858538

            if (!timeout) timeout = 50;
            if (timeout < 50 * Math.pow(2, 10)) {
                // This gives up connecting after 10 failed reconnects with increasing intervals
                window.setTimeout(function () {
                    socket.socket.connect();
                    timeout *= 2;
                }, timeout);
            }

        });

        socket.on("UNAUTHORIZED", function () {
            // Set the timeout to its maximum value to stop retries
            timeout = 51200;
        });
    }

    function sendMessage(msgType, msgData) {
        if (!socketOpen) return;
        socketWait = true;
        socket.emit(msgType, JSON.stringify(msgData));
    }
/* ============================================================================
 *  Authentication page JS
 * ============================================================================
 */
    function initAuthPage() {
        var user     = $("#user"),
            pass     = $("#pass"),
            form     = $("#loginform"),
            submit   = $("#submit"),
            remember = $("#below");

        user.focus();

        // Return submits the form
        pass.keyup(function (e) {
            if (e.keyCode === 13) {
                submitForm(form, submit);
            }
        });

        // Spacebar toggles the checkbox
        remember.keyup(function (e) {
            if (e.keyCode === 32) {
                $("#check").trigger("click");
            }
        });

        form.submit(function (e) {
            e.preventDefault();
            submitForm(form, submit);
        });

        user.focus(function () {
            resetError(submit);
        });

        pass.focus(function () {
            resetError(submit);
        });

        function submitForm(form, errForm) {
            $.ajax({
                type: "POST",
                url: "/login",
                data: form.serialize(),
                success: function (data) {
                    if (data === "OK")
                        getPage();
                    else
                        showError(errForm);
                }
            });
        }

        function showError(element) {
            element.attr("class", "invalid");
            element.val("Wrong username/password!");
        }

        function resetError(element) {
            element.attr("class", "valid");
            element.val("Sign in");
        }
    }
/* ============================================================================
 *  Main page JS
 * ============================================================================
 */
    function initMainPage() {
        // Open Websocket for initial update
        openSocket();

        // Initialize and attach plugins
        attachDropzone();
        attachForm();

        var fileInput = $(":file").wrap($("<div/>").css({
            "height"  : 0,
            "width"   : 0,
            "overflow": "hidden"
        }));

        fileInput.change(function () {
            if ($("#file").val() !== "") {
                var files = $("#file").get(0).files;
                var num = files.length;
                if (num > 0) {
                    for (var i = 0; i < num; i++) {
                        activeFiles.data[files[i].name] = {
                            size: files[i].size,
                            type: "nf"
                        };
                    }
                    buildHTML(activeFiles.data, activeFiles.folder);
                }
                isUploading = true;
                $("#uploadform").submit(); // Automatically submit the upload form once it has files attached
            }

            $("#file").val(""); // Reset file form
        });

        $("#upload").click(function () {
            fileInput.click();
        });

        // Show popup for folder creation
        $("#add-folder").click(function (e) {
            if (e.button !== 0) return;
            $("#overlay").fadeToggle(350);
            nameinput.val("");
            nameinput.focus();
            nameinput.attr("class", "valid");
        });

        var info      = $("#name-info"),
            nameinput = $("#name-input");

        // Handler for the input of the folder name
        nameinput.keyup(function (e) {
            if (e.keyCode === 27) // Escape Key
                $("#overlay").toggle();

            var input = nameinput.val();
            var valid = !input.match(/[\\*{}\/<>?|]/) && !input.match(/\.\./);
            var folderExists = folderList[input.toLowerCase()] === true;
            if (input === "") {
                nameinput.removeClass("invalid");
                info.hide();
                return;
            }

            if (!valid || folderExists) {
                nameinput.addClass("invalid");
                info.html(folderExists ? "File/Directory already exists!" : "Invalid characters in filename!");
                info.show();
                return;
            }

            nameinput.removeClass("invalid");
            info.hide();

            if (e.keyCode === 13) { // Return Key
                if (currentFolder === "/")
                    sendMessage("CREATE_FOLDER", "/" + input);
                else
                    sendMessage("CREATE_FOLDER", currentFolder + "/" + input);
                $("#overlay").fadeOut(350);
            }
        });
        /* ============================================================================
         *  Helper functions for the main page
         * ============================================================================
         */
        function attachDropzone() {
            var dropZone = new Dropzone(document.body, {
                clickable: false,
                url: "/upload",
                previewsContainer: "#preview",
                parallelUploads: 1000,
                maxFilesize: 65535
            });

            // IE8 fails on the next line - TODO: investigate
            dropZone.on("sending", function () {
                uploadInit();
            });

            dropZone.on("uploadprogress", function (file, progress, bytesSent) {
                uploadProgress(bytesSent, file.size, progress);
            });

            dropZone.on("complete", function () {
                uploadDone();
            });
        }

        function attachForm() {
            $("form").ajaxForm({
                beforeSend: function () {
                    uploadInit();
                },
                uploadProgress: function (e, bytesSent, bytesTotal, completed) {
                    uploadProgress(bytesSent, bytesTotal, completed);
                },
                complete: function () {
                    uploadDone();
                }
            });
        }

        var start, progressBars;
        var ui = $("#upload-info");
        var utl = $("#upload-time-left");
        var uperc = $("#upload-percentage");

        function uploadInit() {
            start = new Date().getTime();

            $("#content ul").children().each(function () {
                revert($(this));
            });

            progressBars = $(".progressBar");
            progressBars.show();
            progressBars.width("0%");

            uperc.html("0%");
            utl.html("");
            ui.animate({top: "-2px"}, 250);
        }

        function uploadDone() {
            progressBars.width("100%");
            uperc.html("100%");
            utl.html("finished");
            ui.animate({top: "-50px"}, 250);
        }

        function uploadProgress(bytesSent, bytesTotal, completed) {
            var progress = Math.round(completed) + "%";
            progressBars.width(progress);
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
/* ============================================================================
 *  General helpers
 * ============================================================================
 */
    // Listen for "popstate" events, which indicate the user navigated back
    window.addEventListener("popstate", function () {
        currentFolder = decodeURIComponent(window.location.pathname);
        sendMessage("SWITCH_FOLDER", currentFolder);
    });

    // Update our current location and change the URL to it
    function updateLocation(path, doSwitch) {
        if (socketWait) return; // Dont switch location in case we are still waiting for a response from the server

        currentFolder = path;
        sendMessage(doSwitch ? "SWITCH_FOLDER" : "REQUEST_UPDATE", currentFolder);
        window.history.pushState(null, null, currentFolder);
    }

    function updateCrumbs(path) {
        document.title = [path, "droppy"].join(" - ");
        var parts = path.split("/");
        parts[0] = "droppy";

        // Remove trailing empty string
        if (parts[parts.length - 1] === "") parts.pop();

        // Build the list
        var html = '<ul id="crumbs">';
        var elementPath = "";

        for (var i = 0, len = parts.length; i < len; i++) {
            if (parts[i] === "droppy") {
                html += ['<li data-path="/">', parts[i], '</li>'].join("");
            } else {
                elementPath += "/" + parts[i];
                html += ['<li data-path="', elementPath, '">', parts[i], '</li>'].join("");
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

        // Bind mouse events
        $("#crumbs li").mousedown(function (e) {
            if (e.button !== 0) return;
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
                var downloadURL = [window.location.protocol, "//", window.location.host, "/get", encodeURIComponent(id)].join("");
                var addProgress = "";

                if (fileList[file].type === "nf") {
                    addProgress = '<div class="progressBar"></div>';
                }

                list.append([
                    '<li class="data-row" data-type="file" data-id="', id, '"><span class="icon-file file-normal"></span>',
                    '<span class="data-name"><a class="filelink" href="', downloadURL, '" download="', file, '">', file, '</a></span>',
                    '<span class="data-info">', size, '</span><span class="icon-delete delete-normal"></span>',
                    '</span><span class="right-clear"></span>', addProgress, '</li>'
                ].join(""));

            } else {  // Create a folder row
                list.append([
                    '<li class="data-row" data-type="folder" data-id="', id, '"><span class="icon-folder folder-normal"></span>',
                    '<span class="data-name folder">', file, '</span>',
                    '<span class="icon-delete delete-normal"></span>',
                    '</span><span class="right-clear"></span></li>'
                ].join(""));

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

        $.each(items, function (index, item) {
            $(item).attr("data-index", index);
            list.append(item);
        });

        $("#content").html(list); // Load generated list into view

        // Functionality to invert images on hover below. Chrome doesn't seem to trigger the
        // mouseenter event when content is replaced behind a un-moving cursor, so we keep track
        // of the last hovered element and restore the hover class accordingly.

        // Reset hover state when mouse leaves the list or the new folder is empty
        $("#content ul").mouseleave(function () {
            hoverIndex = -1;
        });

        if (items.length === 0)  hoverIndex = -1;

        //  Invert the row in which the mouse was before the reload
        if (hoverIndex >= 0) {
            invert($("#content ul").children('li[data-index="' + hoverIndex + '"]'));
        }

        // Bind mouse events for swapping images. Text and Background are switched in CSS
        $("#content ul li").mouseover(function () {
            invert($(this));
            hoverIndex = $(this).data("index");
        });

        $("#content ul li").mouseout(function () {
            revert($(this));
        });
        // Bind mouse event to switch into a folder
        $(".data-name.folder").mousedown(function (e) {
            if (e.button !== 0) return;

            var destination = $(this).parent().data("id").replace("&amp;", "&");
            updateLocation(destination, true);
        });

        // Bind mouse event to delete a file/folder
        $(".icon-delete").mousedown(function (e) {
            if (e.button !== 0 || socketWait) return;
            sendMessage("DELETE_FILE", $(this).parent().data("id"));
        });

    }

    // Invert and highlight a list entry
    function invert(li) {
        li.addClass("highlight");
        li.children(".icon-file").removeClass("file-normal").addClass("file-invert");
        li.children(".icon-folder").removeClass("folder-normal").addClass("folder-invert");
        li.children(".icon-delete").removeClass("delete-normal").addClass("delete-invert");
    }

    // Revert highlight state of a list entry
    function revert(li) {
        li.removeClass("highlight");
        li.children(".icon-file").removeClass("file-invert").addClass("file-normal");
        li.children(".icon-folder").removeClass("folder-invert").addClass("folder-normal");
        li.children(".icon-delete").removeClass("delete-invert").addClass("delete-normal");
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
}(jQuery));
