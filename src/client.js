/* global Dropzone, io */

(function ($) {
    "use strict";

    var folderList = [], currentFolder = "/", socketOpen = false;
    var bar, info, nameinput, percent, progress, start, socket, timeout, hoverIndex;

/* ============================================================================
 *  Page loading functions
 * ============================================================================
 */
    function getPage() {
        $.getJSON('/content', function (response) {
            animatedLoad("page", "body", response.data, function () {
                // Load the appropriate Javascript for the received page
                switch (response.type) {
                case "main":
                    initMainPage();
                    break;
                case "auth":
                    initAuthPage();
                    break;
                }
            });
        });
    }

    // Switch an element's content with an animation
    function animatedLoad(oldElement, container, data, callback) {
        $(container).css("overflow", "hidden");
        $(container).append('<div id="new">' + data + '</div>');
        var newElement = $("#new");
        newElement.css("opacity", 0);
        newElement.animate({
            "opacity" : 1
        }, {
            duration: 400,
            queue: false,
            complete: function () {
                $(container).css("overflow", "visible");
                $("#" + oldElement).remove();
                newElement.attr("id", oldElement);
                callback();
            }
        });
        $("#" + oldElement).animate({
            "opacity" : 0
        }, {
            duration: 400,
            queue: false
        });
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
            sendMessage("REQUEST_UPDATE", currentFolder);

            // Close the socket to prevent Firefox errors
            $(window).on('beforeunload', function () {
                socket.disconnect();
                socketOpen = false;
            });
        });

        socket.on("UPDATE_FILES", function (data) {
            var msgData = JSON.parse(data);
            if (msgData.folder === currentFolder.replace(/&amp;/, "&")) {
                updateCrumbs(msgData.folder);
                buildHTML(msgData.data, msgData.folder);
            }
        });

        socket.on("NEW_FOLDER", function (data) {
            var msgData = JSON.parse(data);
            updateCrumbs(msgData.folder);
            buildHTML(msgData.data, msgData.folder);
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

        socket.on("error", function (error) {
            if (typeof error === "object" && Object.keys(error).length > 0)
                console.log(JSON.stringify(error, null, 4));
            else if (typeof error === "string" && error !== "")
                console.log(error);
        });
    }

    function sendMessage(msgType, msgData) {
        if (!socketOpen) return;
        socket.emit(msgType, JSON.stringify(msgData));
    }
/* ============================================================================
 *  Authentication page JS
 * ============================================================================
 */
    function initAuthPage() {
        var user   = $("#user"),
            pass   = $("#pass"),
            form   = $("form"),
            submit = $("#submit"),
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

        submit.click(function () {
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
        openSocket();

        // Cache elements
        bar = $("#progressBar"),
        info = $("#info"),
        nameinput = $("#nameinput"),
        percent = $("#percent"),
        progress = $("#progress"),

        // Initialize and attach plugins
        attachDropzone();
        attachForm();

        // Switch into a folder
        $("#content").on("mousedown", ".folderlink", function (e) {
            if (e.button !== 0) return;
            e.preventDefault();

            var destination = $(this).html();
            if (currentFolder !== "/") destination = "/" + destination;
            currentFolder += destination;
            sendMessage("SWITCH_FOLDER", currentFolder);
        });

        // Jump to a folder using the breadcrumbs
        $("body").on("mousedown", ".navlink", function (e) {
            if (e.button !== 0) return;
            e.preventDefault();
            var destination = $(this).data("path");
            currentFolder = destination;
            sendMessage("SWITCH_FOLDER", currentFolder);
        });

        // Delete a file/folder
        $("body").on("mousedown", ".icon-delete", function (e) {
            if (e.button !== 0) return;
            e.preventDefault();
            sendMessage("DELETE_FILE", $(this).parent().data("id"));
        });

        // Automatically submit a form once it's data changed
        $("form").change(function () {
            $("form").submit();
            $("#file").val(""); // Reset file form
        });

        // Show popup for folder creation
        $("#add-folder").mousedown(function (e) {
            if (e.button !== 0) return;
            $("#overlay").fadeToggle(350);
            nameinput.val("");
            nameinput.focus();
            nameinput.attr("class", "valid");
        });

        // Handler for the input of the folder name
        nameinput.keyup(function (e) {
            if (e.keyCode === 27) // Escape Key
                $("#overlay").toggle();

            var input = nameinput.val();
            var valid = !input.match(/[\\*{}\/<>?|]/) && !input.match(/\.\./);
            var folderExists = folderList[input.toLowerCase()] === true;
            if (input === "") {
                nameinput.attr("class", "valid");
                info.html("&nbsp;");
                return;
            }

            if (!valid) {
                nameinput.attr("class", "invalid");
                info.html("Invalid character(s) in filename!");
                return;
            }

            if (folderExists) {
                nameinput.attr("class", "invalid");
                info.html("File/Directory already exists!");
                return;
            }

            nameinput.attr("class", "valid");
            info.html("&nbsp;");

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
        function uploadInit() {
            bar.width("0%");
            percent.html("");
            progress.fadeIn(300);
            start = new Date().getTime();
        }
        function uploadDone() {
            bar.width("100%");
            percent.html("finished");
            progress.fadeOut(300);
        }
        function uploadProgress(bytesSent, bytesTotal, completed) {
            var perc = Math.round(completed) + "%";
            bar.width(perc);

            // Calculate estimated time left
            var elapsed = (new Date().getTime()) - start;
            var estimate = bytesTotal / (bytesSent / elapsed);
            var secs = (estimate - elapsed) / 1000;
            if (secs > 120) {
                percent.html("less than " + Math.floor((secs / 60) + 1) + " minutes left");
            } else if (secs > 60) {
                percent.html("less than 2 minute left");
            } else {
                percent.html(Math.round(secs) + " seconds left");
            }
        }
    }
/* ============================================================================
 *  General helpers
 * ============================================================================
 */
    function updateCrumbs(path) {
        document.title = ["droppy", path].join(" - ");
        var parts = path.split("/");
        parts[0] = "droppy";

        // Remove trailing empty string
        if (parts[parts.length - 1] === "") parts.pop();

        // Build the list
        var html = '<ul id="crumbs">';
        var elementPath = "";

        for (var i = 0, len = parts.length; i < len; i++) {
            if (parts[i] === "droppy") {
                html += ['<li><a class="navlink" data-path="/" href="">', parts[i], '</a></li>'].join("");
            } else {
                elementPath += "/" + parts[i];
                html += ['<li><a class="navlink" data-path="', elementPath, '" href="">', parts[i], '</a></li>'].join("");
            }
        }

        html += '</ul>';

        var oldLen = $("#current ul li").length;
        $("#current").html(html);
        if ($("#current ul li").length > oldLen) {
            var last = $("#current ul li:last-child");
            last.css("margin-top", -100);
            last.css("opacity", 0);
            $("#current ul li:last-child").animate({
                "margin-top" : 0,
                "opacity" : 1
            }, {
                duration: 250
            });
        }

    }

    function buildHTML(fileList, root) {
        var folderList = [];

        var list = $("<ul>");

        for (var file in fileList) {
            var size = convertToSI(fileList[file].size);

            var id = (root === "/") ? "/" + file : root + "/" + file;

            if (fileList[file].type === "f") { //Create a file row
                list.append([
                    '<li class="data-row" data-id="', id, '"><span class="icon-file file-normal"></span>',
                    '<span class="data-name"><a class="filelink" href="', encodeURIComponent("get" + id), '" download="', file, '">', file, '</a></span>',
                    '<span class="data-info">', size, '</span><span class="icon-delete delete-normal"></span>',
                    '</span><span class="right-clear"></span>',
                    '</li>'
                ].join(""));

            } else {  //Create a folder row
                list.append([
                    '<li class="sort-first data-row" data-id="', id, '"><span class="icon-folder folder-normal"></span>',
                    '<span class="data-name"><a class="folderlink" href="">', file, '</a></span>',
                    '<span class="icon-delete delete-normal"></span>',
                    '</span><span class="right-clear"></span></li>'
                ].join(""));

                //Add to list of currently displayed folders
                folderList[name.toLowerCase()] = true;
            }

        }

        // Sort first by class, then alphabetically
        var items = list.children("li");
        items.sort(function (a, b) {
            var result = $(b).attr("class").toUpperCase().localeCompare($(a).attr("class").toUpperCase());
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

        $("#content ul").mouseout(function () {
            hoverIndex = -1;
        });

        if (hoverIndex >= 0)
            invertImages($("#content ul").children('li[data-index="' + hoverIndex + '"]'));

        $("#content ul").children("li").mouseenter(function () {
            invertImages($(this));
            hoverIndex = $(this).attr("data-index");
        });

        $("#content ul").children("li").mouseleave(function () {
            revertImages($(this));
        });

        function invertImages(li) {
            li.children(".icon-file").removeClass("file-normal").addClass("file-invert");
            li.children(".icon-folder").removeClass("folder-normal").addClass("folder-invert");
            li.children(".icon-delete").removeClass("delete-normal").addClass("delete-invert");
        }

        function revertImages(li) {
            li.children(".icon-file").removeClass("file-invert").addClass("file-normal");
            li.children(".icon-folder").removeClass("folder-invert").addClass("folder-normal");
            li.children(".icon-delete").removeClass("delete-invert").addClass("delete-normal");
        }

    }

    function convertToSI(bytes) {
        var kib = 1024,
            mib = kib * 1024,
            gib = mib * 1024,
            tib = gib * 1024;

        if ((bytes >= 0) && (bytes < kib))         return bytes + ' Bytes';
        else if ((bytes >= kib) && (bytes < mib))  return (bytes / kib).toFixed(2) + ' KiB';
        else if ((bytes >= mib) && (bytes < gib))  return (bytes / mib).toFixed(2) + ' MiB';
        else if ((bytes >= gib) && (bytes < tib))  return (bytes / gib).toFixed(2) + ' GiB';
        else if (bytes >= tib)                     return (bytes / tib).toFixed(2) + ' TiB';
        else return bytes + ' Bytes';
    }
}(jQuery));
