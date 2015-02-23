/*global CodeMirror, prettyBytes, videojs, Draggabilly */

(function ($, window, document) {
    "use strict";
    var droppy = {};

    /* The lines below will get replaced during compilation by the server */
    /* {{ svg }} */
    /* {{ templates }} */

    initVariables();
// ============================================================================
//  Feature Detects
// ============================================================================
    droppy.detects = {
        inputDirectory: (function () {
            var el = document.createElement("input");
            return droppy.prefixes.directory.some(function (prop) {
                if (prop in el) return true;
            });
        })(),
        fullscreen: (function () {
            return droppy.prefixes.fullscreenEnabled.some(function (prop) {
                if (prop in document) return true;
            });
        })(),
        audioTypes: (function () {
            var types = {},
                el    = document.createElement("audio");
            Object.keys(droppy.audioTypes).forEach(function (type) {
                types[droppy.audioTypes[type]] = Boolean(el.canPlayType(droppy.audioTypes[type]).replace(/no/, ""));
            });
            return types;
        })(),
        videoTypes: (function () {
            var types = {},
                el    = document.createElement("video");
            Object.keys(droppy.videoTypes).forEach(function (type) {
                types[droppy.videoTypes[type]] = Boolean(el.canPlayType(droppy.videoTypes[type]).replace(/no/, ""));
            });
            return types;
        })(),
        webp: document.createElement("canvas").toDataURL("image/webp").indexOf("data:image/webp") === 0,
        notification: "Notification" in window,
        mobile: (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i).test(navigator.userAgent),
        mac: /Mac/.test(navigator.platform)
    };
// ============================================================================
//  Set up a few more things
// ============================================================================
    // Add the dataTransfer property to the drag-and-drop events
    $.event.props.push("dataTransfer");

    // Disable jQuery's appending of _=timestamp parameter to script requests
    $.ajaxSetup({ cache: true });

    // Shorthand for safe event listeners
    $.fn.register = function (events, callback) {
        return this.off(events).on(events, callback);
    };

    // transitionend helper, makes sure the callback gets fired regardless if the transition gets cancelled
    $.fn.end = function (callback) {
        var duration,
            called = false,
            el = this[0];

        function doCallback(event) {
            if (called) return;
            called = true;
            callback.apply(el, event);
        }

        duration = window.getComputedStyle(this[0]).transitionDuration;
        duration = (duration.indexOf("ms") > -1) ? parseFloat(duration) : parseFloat(duration) * 1000;

        setTimeout(function () { // Call back if "transitionend" hasn't fired in duration + 30
            doCallback({target: el}); // Just mimic the event.target property on our fake event
        }, duration + 30);

        return this.one("transitionend", doCallback);
    };

    // Class swapping helper
    $.fn.replaceClass = function (search, replacement) {
        var elem, classes, matches,
            i = this.length,
            hasClass = false;
        while(--i >= 0) {
            elem = this[i];
            if (typeof elem === "undefined") return false;
            classes = elem.className.split(" ").filter(function (className) {
                if (className === search) return false;
                if (className === replacement) hasClass = true;

                matches = search instanceof RegExp ? search.exec(className) : className.match(search);
                // filter out if the entire capture matches the entire className
                if (matches) return matches[0] !== className || matches[0] === replacement;
                else return true;
            });
            if (!hasClass) classes.push(replacement);
            if (classes.length === 0 || (classes.length === 1 && classes[0] === ""))
                elem.removeAttribute("class");
            else
                elem.className = classes.join(" ");
        }
        return this;
    };

    // Set a new class on an element, and make sure it is ready to be transitioned.
    $.fn.setTransitionClass = function (oldclass, newclass) {
        if (typeof newclass === "undefined") {
            newclass = oldclass;
            oldclass = null;
        }
        // Add a pseudo-animation to the element. When the "animationstart" event
        // is fired on the element, we know it is ready to be transitioned.
        this.css("animation", "nodeInserted 0.001s");

        // Set the new and oldclass as data attributes.
        if (oldclass) this.data("oldclass", oldclass);
        this.data("newclass", newclass);
        return this;
    };

    // Listen for the animation event for our pseudo-animation
    droppy.prefixes.animationstart.forEach(function (eventName) {
        document.addEventListener(eventName, function (event) {
            if (event.animationName === "nodeInserted") {
                var target = $(event.target),
                    newClass = target.data("newclass"),
                    oldClass = target.data("oldclass");
                // Clean up our data attribute and remove the animation
                target.removeData("newclass").css("animation", "");

                // Set transition classes
                if (oldClass) target.removeData("oldclass").replaceClass(oldClass, newClass);
                else target.addClass(newClass);
            }
        });
    });

    // Alias requestAnimationFrame
    var raf = (function () {
        return window.requestAnimationFrame ||
               window.mozRequestAnimationFrame ||
               window.webkitRequestAnimationFrame ||
               function (callback) { setTimeout(callback, 1000 / 60); };
    })();

    if (navigator.userAgent.toLowerCase().indexOf("firefox") > -1)
        $("html").addClass("firefox"); // https://bugzilla.mozilla.org/show_bug.cgi?id=878058
    if (droppy.detects.mobile)
        $("html").addClass("mobile");
    if (!droppy.detects.fullscreen)
        $("html").addClass("nofullscreen");
    if (droppy.detects.webp)
        droppy.imageTypes.webp = "image/webp";
// ============================================================================
//  localStorage wrapper functions
// ============================================================================
    $(function () {
        var prefs, doSave, defaults = {
            volume : 0.5,
            videoVolume : 0.5,
            theme: "droppy",
            indentWithTabs : false,
            indentUnit : 4,
            lineWrapping: false,
            hasLoggedOut : false,
            renameExistingOnUpload: false
        };
        // Load prefs and set missing ones to their default
        prefs = JSON.parse(localStorage.getItem("prefs")) || {};
        Object.keys(defaults).forEach(function (pref) {
            if (prefs[pref] === undefined) {
                doSave = true;
                prefs[pref] = defaults[pref];
            }
        });
        if (doSave) localStorage.setItem("prefs", JSON.stringify(prefs));

        // Get a variable from localStorage
        droppy.get = function (pref) {
            prefs = JSON.parse(localStorage.getItem("prefs"));
            return prefs[pref];
        };

        // Save a variable to localStorage
        droppy.set = function (pref, value) {
            prefs[pref] = value;
            localStorage.setItem("prefs", JSON.stringify(prefs));
        };
    });
// ============================================================================
//  View handling
// ============================================================================
    function getView(id) {
        var view;
        if (id) {
            return $(droppy.views[id]);
        } else {
            droppy.views.every(function (el) { // get first element not undefined
                view = el;
            });
            return $(view);
        }
    }

    function getOtherViews(id) {
        return $(droppy.views.filter(function (el, index) { return index !== id; }));
    }

    function newView(dest, vId) {
        var view = $("<div class='view'>" +
                        "<ul class='path'></ul>" +
                        "<div class='content-container'><div class='content'></div></div>" +
                        "<div class='dropzone'></div>" +
                        "<div class='info-box'><svg></svg><span></span><input></div>" +
                        "<div class='audio-bar out'>" +
                          "<div class='audio-icon volume'>" + droppy.svg["volume-medium"] + "</div>" +
                          "<div class='volume-slider out'>" +
                            "<div class='volume-slider-inner'></div>" +
                          "</div>" +
                          "<div class='audio-icon previous'>" + droppy.svg.previous + "</div>" +
                          "<div class='audio-icon pause-play'>" + droppy.svg.pause + "</div>" +
                          "<div class='audio-icon stop'>" + droppy.svg.stop + "</div>" +
                          "<div class='audio-icon shuffle'>" + droppy.svg.shuffle + "</div>" +
                          "<div class='audio-icon next'>" + droppy.svg.next + "</div>" +
                          "<div class='audio-title'></div>" +
                          "<div class='time'>" +
                            "<span class='time-cur'></span>" +
                            "<span> / </span>" +
                            "<span class='time-max'></span>" +
                          "</div>" +
                          "<div class='seekbar'>" +
                            "<div class='seekbar-played'></div>" +
                            "<div class='seekbar-loaded'></div>" +
                          "</div>" +
                          "<audio class='audio-player' preload='none'></audio>" +
                        "</div>" +
                    "</div>");
        getView(vId).remove();
        view.appendTo("#view-container");
        view[0].vId = vId;
        droppy.views[vId] = view[0];
        if (dest) updateLocation(view, dest);
        return getView(vId);
    }
    function destroyView(vId) {
        getView(vId).remove();
        droppy.views = droppy.views.filter(function (view, index) { // Remove view from views array
            return index !== vId;
        });
        sendMessage(vId, "DESTROY_VIEW");
    }

    function contentWrap(view) {
        return $('<div class="new content ' + view[0].animDirection + '"></div>');
    }

// ============================================================================
//  Page loading functions
// ============================================================================
    $(getPage);

    // Load HTML and replace SVG placeholders
    function getPage() {
        $.get("?!/content").then(function (data, textStatus, xhr) {
            loadPage(xhr.getResponseHeader("X-Page-Type"), prepareSVG(data));
        });
    }

    // Switch the page content with an animation
    function loadPage(type, data) {
        var newPage, oldPage;
        $("body").append('<div id="newpage">' + data + '</div>');
        newPage = $("#newpage");
        oldPage = $("#page");
        if (type === "main") {
            initMainPage();
            initEntryMenu();
            raf(function () {
                oldPage.replaceClass("in", "out").end(function () {
                    $("#navigation").removeAttr("class"); // remove out class
                });
                finalize();
            });
        } else if (type === "auth" || type === "firstrun") {
            initAuthPage(type === "firstrun");
            raf(function () {
                oldPage.replaceClass("in", "out").end(function () {
                    $("#login-box").replaceClass("out", "in"); // remove out class
                });
                if (type === "firstrun") {
                    $("#login-info").text("Hello! Choose your creditentials.");
                    $("#login-info-box").addClass("info");
                } else if (droppy.get("hasLoggedOut")) {
                    $("#login-info").text("Logged out!");
                    $("#login-info-box").addClass("info");
                    droppy.set("hasLoggedOut", false);
                }
                finalize();
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
    var retries = 5, retryTimeout = 4000;
    function openSocket() {
        var protocol = document.location.protocol === "https:" ? "wss://" : "ws://";
        droppy.socket = new WebSocket(protocol + document.location.host + "/?socket");
        droppy.socket.onopen = function () {
            retries = 5; // reset retries on connection loss
            // Request settings when droppy.debug is uninitialized, could use another variable too.
            if (droppy.debug === null) droppy.socket.send(JSON.stringify({type: "REQUEST_SETTINGS"}));
            else if (droppy.debug) location.reload(); // if in debug mode reload to see changes to client.js
            if (droppy.queuedData)
                sendMessage();
            else {
                // Create new view with initializing
                getLocationsFromHash().forEach(function (string, index) {
                    var dest = join(decodeURIComponent(string));
                    if (index === 0)
                        newView(dest, index);
                    else if (index === 1) {
                        droppy.split(dest);
                    }
                });
            }
        };

        // Close codes: https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent#Close_codes
        droppy.socket.onclose = function (event) {
            if (droppy.get("hasLoggedOut") || event.code === 4000) return;
            if (event.code >= 1001 && event.code < 3999) {
                if (retries > 0) {
                    // Gracefully reconnect on abnormal closure of the socket, 1 retry every 4 seconds, 20 seconds total.
                    // TODO: Indicate connection drop in the UI, especially on close code 1006
                    setTimeout(function () {
                        openSocket();
                        retries--;
                    }, retryTimeout);
                }
            } else if (droppy.reopen) {
                droppy.reopen = false;
                openSocket();
            }
        };

        droppy.socket.onmessage = function (event) {
            var view, msg, vId;

            if (event.data === "ping") // respond to server keepalive
                return droppy.socket.send("pong");
            else
                droppy.socketWait = false;

            msg = JSON.parse(event.data);
            vId = msg.vId;
            switch (msg.type) {
            case "UPDATE_DIRECTORY":
                view = getView(vId);
                if (typeof view.data("type") === "undefined" || view[0].switchRequest) view.data("type", "directory"); // For initial loading
                if (!view.length || view[0].isUploading) return;
                if (view.data("type") === "directory") {
                    if (msg.folder !== getViewLocation(view)) {
                        view[0].currentFile = null;
                        view[0].currentFolder = msg.folder;
                        if (view[0].vId === 0) updateTitle(basename(msg.folder));
                        updatePath(view);
                    }
                    view[0].switchRequest = false;
                    view[0].currentData = msg.data;
                    openDirectory(view);
                } else if (view.data("type") === "image" || view.data("type") === "video") {
                    view[0].currentData = msg.data;
                    populateMediaCache(view, msg.data);
                    bindMediaArrows(view);
                }
                break;
            case "UPDATE_BE_FILE":
                openFile(getView(vId), msg.folder, msg.file);
                break;
            case "UPLOAD_DONE":
                view = getView(vId);
                if (droppy.emptyFiles.length)
                    sendEmptyFiles(view);
                else if (droppy.emptyFolders.length)
                    sendEmptyFolders(view);
                else
                    uploadFinish(view);
                break;
            case "RELOAD":
                if (msg.css) {
                    $("#css").remove();
                    $("<style id='css'></style>").text(msg.css).appendTo($("head"));
                } else window.location.reload(true);
                break;
            case "SHARELINK":
                showLinkBox(getView(vId), msg.link);
                toggleCatcher();
                break;
            case "USER_LIST":
                if ($("#prefs-box").hasClass("in")) updateUsers(msg.users);
                break;
            case "SAVE_STATUS":
                view = getView(vId);
                hideSpinner(view);

                var file = view.find(".path li:last-child");
                var oldStyle = file.attr("style");

                file.find("svg").css("transition", "fill .2s ease");
                file.removeClass("dirty").attr("style", "transition: background .2s ease;")
                    .addClass(msg.status === 0 ? "saved" : "save-failed");
                setTimeout(function () {
                    file.removeClass("saved save-failed").end(function () {
                        $(this).attr("style", oldStyle);
                        $(this).children("svg").removeAttr("style");
                    });
                }, 1000);
                break;
            case "SETTINGS":
                Object.keys(msg.settings).forEach(function (setting) {
                    droppy[setting] = msg.settings[setting];
                });

                // Move own theme to top of theme list
                droppy.themes.pop();
                droppy.themes.unshift("droppy");

                // Insert plain mode on the top
                droppy.modes.unshift("plain");

                if (droppy.demoMode || droppy.public)
                    $("#logout-button").addClass("disabled").attr("title", "Signing out is disabled.");
                else
                    $("#logout-button").register("click", function () {
                        droppy.set("hasLoggedOut", true);
                        if (droppy.socket) droppy.socket.close(4001);
                        deleteCookie("session");
                        window.history.pushState(null, null, getRootPath());
                        window.location.reload(true);
                    });
                break;
            case "ERROR":
                view = getView(vId);
                showError(view, msg.text);
                hideSpinner(view);
                break;
            }
        };
    }
    function sendMessage(vId, type, data) {
        var sendObject = { vId: vId, type: type, data: data};
        if (droppy.socket.readyState === 1) { // open
            // Lock the UI while we wait for a socket response
            droppy.socketWait = true;

            // Unlock the UI in case we get no socket resonse after waiting for 1 second
            setTimeout(function () {
                droppy.socketWait = false;
            }, 1000);

            if (droppy.queuedData) {
                droppy.socket.send(droppy.queuedData);
                droppy.queuedData = null;
            }
            droppy.socket.send(JSON.stringify(sendObject));
        } else {
            // We can't send right now, so queue up the last added message to be sent later
            droppy.queuedData = JSON.stringify(sendObject);

            if (droppy.socket.readyState === 2) { // closing
                // Socket is closing, queue a re-opening
                droppy.reopen = true;
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
            } catch (error) {
                try {
                    droppy.socket.close();
                } catch (closeError) {}
            }
        }
    });

// ============================================================================
//  Authentication page
// ============================================================================
    function initAuthPage(firstrun) {
        var form = $("#form");

        $("#user").focus();

        $("#pass").register("keydown", function (event) {
            if (event.keyCode === 13) form.submit();
        });

        $(".remember").register("click", function () {
            $(".remember").toggleClass("checked");
            $("[name=remember]").attr("value", $(".remember").hasClass("checked") ? "1" : "");
        });

        $(".submit").register("click", function () {
            form.submit();
        });

        $("#form").register("submit", function () {
            $.post(getRootPath() + (firstrun ? "adduser" : "login"), form.serialize(), null, "json").always(function (xhr) {
                if (xhr.status  === 202) {
                    window.location.reload(true);
                } else if (xhr.status === 401) {
                    $("#login-info").text(firstrun ? "Please fill both fields." : "Wrong login!");
                    $("#login-info-box").attr("class", "error");
                    if (!firstrun) $("#pass").val("").focus();
                }
            });
            return false;
        });
    }
// ============================================================================
//  Main page
// ============================================================================
    function initMainPage() {
        // Open the WebSocket
        openSocket();

        // Global events
        $(window)
            // Re-fit path line after 100ms of no resizing
            .register("resize", function () {
                clearTimeout(droppy.resizeTimer);
                droppy.resizeTimer = setTimeout(function () {
                    $(".view").each(function () {
                        checkPathOverflow($(this));
                        aspectScale();
                    });
                }, 100);
            })
            // Bind escape for hiding modals
            .register("keydown", function (event) {
                if (event.keyCode === 27)
                    $("#click-catcher").click();
            })
            // Stop CTRL-S from showing a save dialog
            .register("keydown", function (event) {
                if (event.keyCode === 83 && (event[droppy.detects.mac ? "metaKey" : "ctrlKey"])) event.preventDefault();
            });

        // fullscreen event
        droppy.prefixes.fullscreenchange.forEach(function (eventName) {
            $(document).register(eventName, function () {
                var view, fse = fullScreenElement();
                document.activeElement.blur(); // unfocus the fullscreen button so the space key won't un-toggle fullscreen
                if (fse) {
                    view = $(fse).parents(".view");
                    addKey(32, function (e) { swapMedia(view, e.shiftKey ? "left" : "right"); });
                    addKey([37, 38], function () { swapMedia(view, "left");  });
                    addKey([39, 40], function () { swapMedia(view, "right"); });
                    view.find(".fs").html(droppy.svg.unfullscreen);
                    view.find(".full svg").replaceWith(droppy.svg.unfullscreen);
                } else {
                    removeKey([32, 37, 38, 39, 40]);
                    $(".fs").html(droppy.svg.fullscreen);
                    $(".full svg").replaceWith(droppy.svg.fullscreen);
                }
            });
        });

        if ("MutationObserver" in window) {
            new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    if (mutation.attributeName === "class") {
                        var action = $("#click-catcher").hasClass("in") ? "addClass" : "removeClass";
                        $("#navigation, .path, .content-container, .audio-bar")[action]("blur");
                    }
                });
            }).observe(document.querySelector("#click-catcher"), {attributes: true});
        }

        var fileInput = $("#file");
        fileInput.register("change", function (event) {
            var files, path, name,
                view = getView(fileInput[0].targetView),
                obj  = {};

            uploadInit(view);
            if (droppy.detects.inputDirectory && event.target.files.length > 0 && "webkitRelativePath" in event.target.files[0]) {
                files = event.target.files;
                for (var i = 0; i < files.length; i++) {
                    path = files[i].webkitRelativePath;
                    name = files[i].name;
                    if (path) {
                        obj[path] = files[i];
                    } else {
                        obj[name] = files[i];
                    }
                }
                upload(view, obj); // TODO: view relative
            } else if (fileInput.val()) {
                upload(view, fileInput.get(0).files);
            }
            fileInput.val(""); // Reset the input
        });

        // File upload button
        $("#upload-file-button").register("click", function () {
            // Remove the directory attributes so we get a file picker dialog!
            if (droppy.detects.inputDirectory)
                fileInput.removeAttr("directory msdirectory mozdirectory webkitdirectory");
            fileInput.click();
        });

        // Folder upload button - check if we support directory uploads
        if (droppy.detects.inputDirectory) {
            // Directory uploads supported - enable the button
            $("#upload-folder-button").register("click", function () {
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
            // No directory upload support - disable the button
            $("#upload-folder-button").addClass("disabled").on("click", function () {
                showError(getView(0), "Sorry, your browser doesn't support directory uploading.");
            });
        }

        $("#create-folder-button").register("click", function () {
            var dummyFolder, wasEmpty,
                view      = getView(), // TODO: Create folder in last active view
                dummyHtml = '<li class="data-row new-folder" data-type="folder">' +
                                '<span class="sprite sprite-folder"></span>' +
                                '<a class="folder-link entry-link"></a>' +
                            '</li>';

            if (view.find(".empty").length > 0) {
                view.find(".content").html("<ul>" + getHeaderHTML() + dummyHtml + "</ul>");
                wasEmpty = true;
            } else {
                view.find(".content ul").prepend(dummyHtml);
            }
            dummyFolder = $(".data-row.new-folder");
            view.find(".content").scrollTop(0);
            entryRename(view, dummyFolder, wasEmpty, function (success, oldVal, newVal) {
                if (success) {
                    showSpinner(view);
                    sendMessage(view[0].vId, "CREATE_FOLDER", newVal);
                }
                dummyFolder.remove();
            });
        });

        $("#create-file-button").register("click", function () {
            var dummyFile, wasEmpty,
                view      = getView(), // TODO: Create folder in last active view
                dummyHtml = '<li class="data-row new-file" data-type="file">' +
                                '<span class="sprite sprite-default"></span>' +
                                '<a class="file-link entry-link"></a>' +
                            '</li>';

            if (view.find(".empty").length > 0) {
                view.find(".content").html("<ul>" + getHeaderHTML() + dummyHtml + "</ul>");
                wasEmpty = true;
            } else {
                view.find(".content ul").prepend(dummyHtml);
            }
            dummyFile = $(".data-row.new-file");
            view.find(".content").scrollTop(0);
            entryRename(view, dummyFile, wasEmpty, function (success, oldVal, newVal) {
                if (success) {
                    showSpinner(view);
                    sendMessage(view[0].vId, "CREATE_FILE", newVal);
                }
                dummyFile.remove();
            });
        });

        $("#split-button").register("click", function () { split(); });

        var split = droppy.split = function (dest) {
            var first, second, button;
            button = $("#split-button");
            button.off("click");
            first = getView(0);
            if (droppy.views.length === 1) {
                first.addClass("left");
                if (typeof dest !== "string")
                    dest = join(first[0].currentFolder, first[0].currentFile);
                second = newView(dest, 1).addClass("right");
                button.children("span").text("Merge");
                button.attr("title", "Merge views back into a single one");
                replaceHistory(second, join(second[0].currentFolder, second[0].currentFile));
            } else {
                destroyView(1);
                getView(0).removeClass("left");
                button.children("span").text("Split");
                button.attr("title", "Split the view in half");
                replaceHistory(first, join(first[0].currentFolder, first[0].currentFile));
            }
            first.end(function () {
                button.register("click", split);
                droppy.views.forEach(function (view) {
                    checkPathOverflow($(view));
                });
            });
        };

        $("#about-button").register("click", function () {
            raf(function () {
                $("#about-box").attr("class", $("#about-box").attr("class") !== "in" ? "in" : "out");
                toggleCatcher();
            });
        });

        $("#prefs-button").register("click", function () {
            showPrefs();
            sendMessage(null, "GET_USERS");
        });

        // Hide modals when clicking outside their box
        $("#click-catcher").register("click", function () {
            $("#prefs-box").replaceClass("in", "out");
            $("#about-box").replaceClass("in", "out");
            $("#entry-menu").replaceClass("in", "out");
            $("#drop-select").removeAttr("class");
            $(".info-box").replaceClass("in", "out");
            toggleCatcher();
        });
    }
    // ============================================================================
    //  Upload functions
    // ============================================================================
    function upload(view, data) {
        var formData = new FormData(),
            numFiles = 0,
            formLength = 0;
        if (!data) return;
        droppy.emptyFiles   = [];
        droppy.emptyFolders = [];
        if (Object.prototype.toString.call(data) !== "[object Object]") { // We got a FileList
            if (data.length === 0) return;
            for (var i = 0, len = data.length; i < len; i++) {
                if (isOverLimit(view, data[i].size)) return;
                numFiles++;
                // Don't include Zero-Byte files as uploads will freeze in IE if we attempt to upload them
                // https://github.com/silverwind/droppy/issues/10
                if (data[i].size === 0) {
                    droppy.emptyFiles.push(join(view[0].currentFolder, data[i].name));
                } else {
                    formLength++;
                    formData.append(data[i].name, data[i], encodeURIComponent(data[i].name));
                }
            }
        } else { // We got an object for recursive folder uploads
            var addedDirs = {};
            Object.keys(data).forEach(function (entry) {
                var name = rootDir(entry);
                if (Object.prototype.toString.call(data[entry]) === "[object File]") {
                    if (isOverLimit(view, data[entry].size)) return;
                    numFiles++;
                    formLength++;
                    formData.append(entry, data[entry], encodeURIComponent(entry));
                } else {
                    if (!addedDirs[name]) {
                        view[0].currentData[name] = {size: 0, type: "nd", mtime: Date.now()};
                        addedDirs[name] = true;
                    }
                    // All folders are empty object, filter them
                    if (!$.isEmptyObject(data[entry])) {
                        formLength++;
                        formData.append(entry, data[entry], encodeURIComponent(entry));
                    } else {
                        var skip = Object.keys(data).some(function (el) {
                            return new RegExp(entry + "\/").test(el);
                        });
                        if (!skip) {
                            droppy.emptyFolders.push(join(view[0].currentFolder, entry));
                        }
                    }
                }
            });
        }

        // Load the new files into view
        openDirectory(view, true);

        // Create the XHR2 and bind the progress events
        var xhr = new XMLHttpRequest();
        xhr.upload.addEventListener("progress", function (event) { uploadProgress(view, event); });
        xhr.upload.addEventListener("error", function (event) {
            if (event && event.message) console.info(event.message);
            showError(view, "An error occured during upload");
            uploadCancel(view);
        });
        xhr.addEventListener("readystatechange", function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status === 200) {
                uploadDone(view);
            } else {
                showError(view, "Server responded with HTTP " + xhr.status);
                uploadCancel(view);
            }
        });

        $(".upload-cancel").register("click", function () {
            xhr.abort();
            uploadCancel(view);
        });

        view[0].isUploading   = true;
        view[0].uploadStart   = Date.now();
        view[0].uploadText    = numFiles + " file" + (numFiles > 1 ? "s" : "");
        view[0].uploadSuccess = false;
        view.find(".upload-title").text("Uploading " + view[0].uploadText);

        if (formLength) {
            xhr.open("POST", getRootPath() + "upload?" + $.param({
                vId : view[0].vId,
                to  : encodeURIComponent(view[0].currentFolder),
                r   : droppy.get("renameExistingOnUpload")
            }));
            xhr.send(formData);
        } else {
            if (droppy.emptyFiles.length)   sendEmptyFiles(view);
            if (droppy.emptyFolders.length) sendEmptyFolders(view);
        }

        function isOverLimit(view, size) {
            if (droppy.maxFileSize > 0 && size > droppy.maxFileSize) {
                showError(view, "Maximum file size for uploads is " + prettyBytes(droppy.maxFileSize) + ".");
                uploadCancel(view);
                return true;
            }
            return false;
        }
    }

    function sendEmptyFiles(view) {
        sendMessage(view[0].vId, "CREATE_FILES", {files: droppy.emptyFiles, isUpload: true});
        droppy.emptyFiles = [];
    }

    function sendEmptyFolders(view) {
        sendMessage(view[0].vId, "CREATE_FOLDERS", {folders: droppy.emptyFolders, isUpload: true});
        droppy.emptyFolders = [];
    }

    function uploadInit(view) {
        var uploadInfo = '<div class="upload-info out">' +
                '<div class="upload-bar"></div>' +
                '<span class="upload-title"></span>' +
                '<span class="upload-speed">' +
                    droppy.svg.speed +
                    '<span></span>' +
                '</span>' +
                '<span class="upload-time">' +
                    droppy.svg.time +
                    '<span class="upload-time-left"></span>' +
                '</span>' +
                '<span class="upload-cancel">' +
                    droppy.svg.remove +
                    '<span>Cancel</span>' +
                '</span>' +
            '</div>';

        if (!view.find(".upload-info").length) view.append(uploadInfo);
        view.find(".upload-info").setTransitionClass("out", "in");
        view.find(".upload-bar").css("width", "0%");
        view.find(".upload-time-left, .upload-speed > span").text("");
        view.find(".upload-title").text("Reading files ...");
        updateTitle("0%");
    }

    function uploadDone(view) {
        view.find(".upload-bar").css("width", "100%");
        view.find(".upload-title").text("Processing ...");
        view[0].uploadSuccess = true;
    }

    function uploadCancel(view) {
        uploadFinish(view);
        sendMessage(view[0].vId, "REQUEST_UPDATE", view[0].currentFolder);
    }

    function uploadFinish(view) {
        view[0].isUploading = false;
        hideSpinner(view);
        updateTitle(basename(view[0].currentFolder));
        view.find(".upload-info").setTransitionClass("in", "out");
        view.find(".data-row.uploading").removeClass("uploading");
        view.find(".icon-uploading").remove();
        if (view[0].uploadSuccess) {
            showNotification("Upload finished", "Uploaded " + view[0].uploadText + " to " + view[0].currentFolder);
            view[0].uploadSuccess = false;
        }
        setTimeout(function () {
            view.find(".upload-bar").removeAttr("style");
        }, 200);
    }

    var lastUpdate;
    function uploadProgress(view, event) {
        if (!event.lengthComputable) return;

        // Update progress every 250ms at most
        if (!lastUpdate || (Date.now() - lastUpdate) >= 250) {
            var bytesSent  = event.loaded,
                bytesTotal = event.total,
                progress   = Math.round((bytesSent / bytesTotal) * 100) + "%",
                speed      = prettyBytes(bytesSent / ((Date.now() - view[0].uploadStart) / 1000)),
                elapsed, secs;

            updateTitle(progress);
            view.find(".upload-bar").css("width", progress);
            view.find(".upload-speed > span").text(speed + "/s");

            // Calculate estimated time left
            elapsed = Date.now() - view[0].uploadStart;
            secs = ((bytesTotal / (bytesSent / elapsed)) - elapsed) / 1000;

            if (secs > 60)
                view.find(".upload-time-left").text(Math.ceil(secs / 60) + " mins");
            else
                view.find(".upload-time-left").text(Math.ceil(secs) + " secs");

            lastUpdate = Date.now();
        }
    }
// ============================================================================
//  General helpers
// ============================================================================
    function entryRename(view, entry, wasEmpty, callback) {
        var canSubmit, exists, valid, inputText, link, namer, nameLength;
        // Populate active files list
        droppy.activeFiles = [];
        view.find(".entry-link").each(function () {
            $(this).removeClass("editing invalid");
            droppy.activeFiles.push(droppy.caseSensitive ? $(this).text() : $(this).text().toLowerCase());
        });

        // Hide menu, click-catcher and the original link, stop any previous edits
        $("#click-catcher").trigger("mousemove");
        link = entry.find(".entry-link");

        // Add inline elements
        namer = $('<input class="inline-namer" value="' + link.text() + '" placeholder="' + link.text() + '">');
        link.after(namer);
        entry.addClass("editing");

        link.next().register("input", function () {
            inputText = namer.val();
            valid = !/[\\\*\{\}\/\?\|<>"]/.test(inputText);
            if (inputText === "") valid = false;
            exists = droppy.activeFiles.some(function (file) {
                if (file === (droppy.caseSensitive ? inputText : inputText.toLowerCase())) return true;
            });
            canSubmit = valid && (!exists || inputText === namer.attr("placeholder"));
            // TODO: Better indicator of what's wrong
            if (!canSubmit)
                entry.addClass("invalid");
            else
                entry.removeClass("invalid");
        }).register("keydown", function (event) {
            if (event.keyCode === 27) stopEdit(view); // Escape Key
            if (event.keyCode === 13) submitEdit(view, false, callback); // Return Key
        }).register("focusout", function () {
            submitEdit(view, true, callback);
        });

        nameLength = link.text().lastIndexOf(".");
        namer[0].setSelectionRange(0, nameLength > -1 ? nameLength : link.text().length);
        namer[0].focus();

        function submitEdit(view, skipInvalid, callback) {
            var success,
                oldVal = namer.attr("placeholder"),
                newVal = namer.val();
            if (canSubmit) {
                if (oldVal !== newVal) {
                    success = true;
                }
                stopEdit(view);
            } else if (exists && !skipInvalid) {
                namer.addClass("shake");
                setTimeout(function () {
                    namer.removeClass("shake");
                }, 500);
            } else {
                success = false;
                stopEdit(view);
            }
            if (typeof success === "boolean" && typeof callback === "function") {
                callback(success, join(view[0].currentFolder, oldVal), join(view[0].currentFolder, newVal));
            }
        }
        function stopEdit(view) {
            view.find(".inline-namer").remove();
            view.find(".data-row.new-file").remove();
            view.find(".data-row.new-folder").remove();
            entry.removeClass("editing invalid");
            if (wasEmpty) view.find(".content").html('<div class="empty">' +
                droppy.svg["upload-cloud"] + '<div class="text">Add files</div></div>');
        }
    }

    // Toggle the full-screen click catching frame if any modals are shown
    function toggleCatcher() {
        if ($("#about-box").hasClass("in") ||
            $("#prefs-box").hasClass("in") ||
            $(".info-box").hasClass("in") ||
            $("#entry-menu").hasClass("in") ||
            $("#drop-select").hasClass("in")
        ) {
            $("#click-catcher").attr("class", "in");
        } else {
            $("#click-catcher").attr("class", "out");
        }
    }

    // Update the page title
    function updateTitle(text) {
        document.title = text || "droppy";
    }

    // Listen for popstate events, which indicate the user navigated back
    $(window).register("popstate", function () {
        if (!droppy.socket) return;
        var locs = getLocationsFromHash();
        droppy.views.forEach(function (view) {
            var dest = locs[view.vId];
            view.switchRequest = true;
            setTimeout(function () { view.switchRequest = false; }, 1000);
            if (dest) updateLocation($(view), dest, true);
        });
    });

    function getViewLocation(view) {
        if (view[0].currentFolder === undefined)
            return ""; // return an empty string so animDirection gets always set to 'forward' on launch
        else
            return join(view[0].currentFolder, view[0].currentFile);
    }

    function getLocationsFromHash() {
        var locations = document.location.hash.split("#");
        locations.shift();

        if (locations.length === 0)
            locations.push("");

        locations.forEach(function (part, i) {
            locations[i] = part.replace(/\/*$/g, "");
            if (locations[i] === "") locations[i] = "/";
        });
        return locations;
    }

    function getHashPaths(modview, dest) {
        var hash = "";
        droppy.views.forEach(function (view) {
            view = $(view);
            if (modview && modview.is(view))
                hash += "/#" + dest;
            else
                hash += "/#" + getViewLocation(view);
        });
        return hash.replace(/\/+/g, "/");
    }

    function pushHistory(view, dest) {
        window.history.pushState(null, null, getHashPaths(view, dest));
    }

    function replaceHistory(view, dest) {
        window.history.replaceState(null, null, getHashPaths(view, dest));
    }

    // Update our current location and change the URL to it
    function updateLocation(view, destination, skipPush) {
        if (typeof destination.length !== "number") throw new Error("Destination needs to be string or array");
        // Queue the folder switching if we are mid-animation or waiting for the server
        function sendReq(view, viewDest, time) {
            (function queue(time) {
                if ((!droppy.socketWait && !view[0].isAnimating) || time > 2000) {
                    var viewLoc = getViewLocation(view);
                    showSpinner(view);
                    // Find the direction in which we should animate
                    if (!viewLoc)
                        view[0].animDirection = "center";
                    else if (viewDest.length > viewLoc.length)
                        view[0].animDirection = "forward";
                    else if (viewDest.length === viewLoc.length)
                        view[0].animDirection = "center";
                    else
                        view[0].animDirection = "back";
                    sendMessage(view[0].vId, "REQUEST_UPDATE", viewDest);

                    // Skip the push if we're already navigating through history
                    if (!skipPush) pushHistory(view, viewDest);
                } else
                    setTimeout(queue, 50, time + 50);
            })(time);
        }
        if (view === null) {
            // Only when navigating backwards
            for (var i = destination.length - 1; i >= 0; i--) {
                if (destination[i].length && getViewLocation(getView(i)) !== destination[i])
                    sendReq(getView(i), destination[i], 0);
            }
        } else if (droppy.views[view[0].vId]) sendReq(view, destination, 0);
    }

    // Update the path indicator
    function updatePath(view) {
        var parts, oldParts,
            pathStr = "",
            i = 1; // Skip the first element as it's always the same
        parts = join(view[0].currentFolder).split("/");
        if (parts[parts.length - 1] === "") parts.pop();
        if (view[0].currentFile !== null) parts.push(view[0].currentFile);
        parts[0] = droppy.svg.home; // Replace empty string with our home icon
        if (view[0].savedParts) {
            oldParts = view[0].savedParts;
            while (true) {
                pathStr += "/" + parts[i];
                if (!parts[i] && !oldParts[i]) break;
                if (parts[i] !== oldParts[i]) {
                    if (!parts[i] && oldParts[i] !== parts[i]) { // remove this part
                        removePart(i);
                    } else if (!oldParts[i] && oldParts[i] !== parts[i]) { // Add a part
                        addPart(parts[i], pathStr);
                    } else { // rename part
                        $(view.find(".path li")[i]).html(parts[i] + droppy.svg.triangle).data("destination", pathStr);
                    }
                }
                i++;
            }
            finalize();
        } else {
            addPart(parts[0], "/");
            for (var len = parts.length; i < len; i++) {
                pathStr += "/" + parts[i];
                addPart(parts[i], pathStr);
            }
            finalize();
        }

        view[0].savedParts = parts;

        function addPart(name, path) {
            var li = $("<li class='out'><a>" + name + "</a></li>");
            li.data("destination", path);
            li.register("click", function (event) {
                var view = $(event.target).parents(".view");
                if (droppy.socketWait) return;
                if ($(this).is(":last-child")) {
                    if ($(this).parents(".view").data("type") === "directory") {
                        updateLocation(view, $(this).data("destination"));
                    }
                } else {
                    view[0].switchRequest = true; // This is set so we can switch out of a editor view
                    updateLocation(view, $(this).data("destination"));
                }
                setTimeout(function () {checkPathOverflow(view); }, 400);
            });
            view.find(".path").append(li);
            li.append(droppy.svg.triangle);
        }

        function removePart(i) {
            var toRemove = view.find(".path li").slice(i);
            toRemove.setTransitionClass("in", "out gone").end(function () {
                $(this).remove();
            });
        }

        function finalize() {
            view.find(".path li.out:not(.gone)").setTransitionClass("out", "in");
            setTimeout(function () {checkPathOverflow(view); }, 400);
        }
    }

    // Check if the path indicator overflows and scroll it if neccessary
    function checkPathOverflow(view) {
        var width = 40, space = view.width();

        view.find(".path li.in").each(function () {
            width += $(this)[0].offsetWidth;
        });

        if (width > space) {
            raf(function () {
                view.find(".path li").animate({"left": space - width + "px"}, {duration: 200});
            });
        } else {
            raf(function () {
                view.find(".path li").animate({"left": 0}, {duration: 200});
            });
        }
    }
    // Convert the received data into HTML
    function openDirectory(view, isUpload) {
        // Apply directory size cache
        if (droppy.sizeCache[view[0].currentFolder]) {
            Object.keys(view[0].currentData).forEach(function (name) {
                var currentEntry = view[0].currentData[name];
                if (currentEntry.type === "d" && currentEntry.size === 0 && droppy.sizeCache[view[0].currentFolder][name])
                    view[0].currentData[name].size = droppy.sizeCache[view[0].currentFolder][name];
            });
        }

        if (!view[0].sortBy) view[0].sortBy = "name";
        if (!view[0].sortAsc) view[0].sortAsc = false;

        // Create HTML from template
        var content = contentWrap(view).html(droppy.templates.views.directory({
            entries  : view[0].currentData,
            folder   : view[0].currentFolder,
            isUpload : isUpload,
            sortBy   : view[0].sortBy,
            sortAsc  : view[0].sortAsc,
            clipboardBasename: droppy.clipboard ? basename(droppy.clipboard.from) : ""
        }));
        // Load it
        loadContent(view, content);

        // Upload button on empty page
        content.find(".empty").register("click", function (event) {
            var view = $(event.target).parents(".view"), fileInput = $("#file");
            fileInput[0].targetView = view[0].vId;
            if (droppy.detects.inputDirectory)
                fileInput.removeAttr("directory mozdirectory webkitdirectory msdirectory");
            fileInput.click();
        });

        // Switch into a folder
        content.find(".folder-link").register("click", function (event) {
            if (droppy.socketWait) return;
            updateLocation(view, $(this).parents(".data-row").data("id"));
            event.preventDefault();
        });

        // Click on a file link
        content.find(".file-link").register("click", function (event) {
            if (droppy.socketWait) return;
            var view = $(event.target).parents(".view");
            openFile(view, view[0].currentFolder, $(event.target).text());
            event.preventDefault();
        });

        content.find(".data-row").each(function (index) {
            this.setAttribute("order", index);
        });

        content.find(".data-row").register("contextmenu", function (event) {
            var target = $(event.target), targetRow;
            if (target.attr("class") === ".data-row")
                targetRow = target;
            else
                targetRow = target.parents(".data-row");
            if (targetRow.data("type") === "error") return;
            showEntryMenu(targetRow, event.clientX);
            event.preventDefault();
            event.stopPropagation();
        });

        content.find(".data-row .entry-menu").register("click", function (event) {
            showEntryMenu($(event.target).parents(".data-row"));
            event.preventDefault();
            event.stopPropagation();
        });

        // Stop navigation when clicking on an <a>
        content.find(".data-row .zip, .data-row .download, .entry-link.file").register("click", function (event) {
            event.stopPropagation();
            if (droppy.socketWait) return;

            // Some browsers (like IE) think that clicking on an <a> is real navigation
            // and will close the WebSocket in turn. We'll reconnect if neccessary.
            droppy.reopen = true;
            setTimeout(function () {
                droppy.reopen = false;
            }, 2000);
        });

        // Request a sharelink
        content.find(".sharelink").register("click", function () {
            if (droppy.socketWait) return;
            sendMessage($(this).parents(".view")[0].vId, "REQUEST_SHARELINK", $(this).parent(".data-row").data("id"));
        });

        content.find(".icon-play").register("click", function () {
            var view = $(this).parents(".view");

            if ($(this).parents(".data-row").hasClass("playing"))
                return;

            if (!view[0].audioInitialized) {
                initAudio(view);
                view[0].audioInitialized = true;
            }

            play(view, $(this).parents(".data-row").data("id"));
        });

        content.find(".header-name, .header-mtime, .header-size").register("click", function () {
            sortByHeader(view, $(this));
        });

        hideSpinner(view);
    }

    // Load new view content
    function loadContent(view, content, callback) {
        if (view[0].isAnimating) return; // Ignore mid-animation updates. TODO: queue and update on animation-end
        var type = view.data("type"),
            navRegex = /(forward|back|center)/;
        if (view[0].animDirection === "center" && type === "directory") {
            view.find(".content").replaceClass(navRegex, "center").before(content);
            view.find(".new").addClass(type).data("root", view[0].currentFolder);
            finish();
        } else {
            view.children(".content-container").append(content);
            view.find(".new").data("root", view[0].currentFolder);
            view[0].isAnimating = true;
            view.find(".data-row").addClass("animating");
            view.find(".content:not(.new)").replaceClass(navRegex, (view[0].animDirection === "forward") ?
                "back" : (view[0].animDirection === "back") ? "forward" : "center");
            view.find(".new").addClass(type).setTransitionClass(navRegex, "center").end(finish);
        }
        view[0].animDirection = "center";

        function finish() {
            view[0].isAnimating = false;
            view.find(".content:not(.new)").remove();
            view.find(".new").removeClass("new");
            view.find(".data-row").removeClass("animating");
            if (view.data("type") === "directory") {
                bindDragEvents(view);
            } else if (view.data("type") === "image" || view.data("type") === "video") {
                bindMediaArrows(view);
            }
            bindHoverEvents(view);
            bindDropEvents(view);
            allowDrop(view);
            if (callback) callback(view);
        }
    }

    function handleDrop(view, event, from, to, spinner) {
        var catcher = $("#click-catcher"),
            dropSelect = $("#drop-select");
        droppy.dragTimer.clear();
        $(".drop-hover").removeClass("drop-hover");
        $(".dropzone").removeClass("in");

        var dragAction = view[0].dragAction;
        delete view[0].dragAction;

        if (dragAction === "copy" || event.ctrlKey || event.metaKey || event.altKey) {
            sendDrop(view, "copy", from, to, spinner);
        } else if (dragAction === "cut" || event.shiftKey) {
            sendDrop(view, "cut", from, to, spinner);
        } else {
            // Keep the drop-select in view
            var limit = dropSelect[0].offsetWidth / 2 - 20, left;
            if (event.originalEvent.clientX < limit)
                left = event.originalEvent.clientX + limit;
            else if ((event.originalEvent.clientX + limit) > window.innerWidth)
                left = event.originalEvent.clientX - limit;
            else
                left = event.originalEvent.clientX;

            dropSelect.attr("class", "in").css({
                left: left,
                top:  event.originalEvent.clientY
            });
            toggleCatcher();
            dropSelect.children(".movefile").off("click").one("click", function () {
                sendDrop(view, "cut", from, to, spinner);
                catcher.off("mousemove").trigger("click");
            });
            dropSelect.children(".copyfile").off("click").one("click", function () {
                sendDrop(view, "copy", from, to, spinner);
                catcher.off("mousemove").trigger("click");
            });
            dropSelect.children(".viewfile").off("click").one("click", function () {
                updateLocation(view, from);
                catcher.off("mousemove").trigger("click");
            });
            return;
        }
    }

    function sendDrop(view, type, from, to, spinner) {
        if (from !== to || type === "copy") {
            if (spinner) showSpinner(view);
            sendMessage(view[0].vId, "CLIPBOARD", {
                type: type,
                from: from,
                to:   to
            });
        }
    }

    // Set drag properties for internal drag sources
    function bindDragEvents(view) {
        view.find(".data-row .entry-link").attr("draggable", "true");
        view.register("dragstart", function (event) {
            var row = $(event.target).hasClass("data-row") ? $(event.target) : $(event.target).parents(".data-row");

            if (event.ctrlKey || event.metaKey || event.altKey)
                view[0].dragAction = "copy";
            else if (event.shiftKey)
                view[0].dragAction = "cut";

            droppy.dragTimer.refresh(row.data("id"));
            event.dataTransfer.setData("text", JSON.stringify({
                type: row.attr("data-type"),
                path: row.data("id")
            }));
            event.dataTransfer.effectAllowed = "copyMove";
            if ("setDragImage" in event.dataTransfer)
                event.dataTransfer.setDragImage(row.find(".sprite")[0], 0, 0);
        });
    }
    droppy.dragTimer = new (function () {
        var dt = function () {};
        dt.prototype.timer = null;
        dt.prototype.data = "";
        dt.prototype.isInternal = false;
        dt.prototype.refresh = function (data) {
            if (typeof data === "string") {
                this.data = data;
                this.isInternal = true;
            }
            clearTimeout(this.timer);
            this.timer = setTimeout(this.clear, 1000);
        };
        dt.prototype.clear = function () {
            if (!this.isInternal)
                $(".dropzone").removeClass("in");
            clearTimeout(this.timer);
            this.isInternal = false;
            this.data = "";
        };
        return dt;
    }())();

    function allowDrop(el) {
        el.register("dragover", function (event) {
            event.preventDefault();
            droppy.dragTimer.refresh();
        });
    }

    // Hover events for upload arrows
    function bindHoverEvents(view) {
        var dropZone = view.find(".dropzone");
        view.register("dragenter", function (event) {
            event.stopPropagation();
            var row,
                target = $(event.target);
            if (droppy.dragTimer.isInternal) { // internal source
                if (target.hasClass("folder-link")) {
                    row = target.parent();
                    event.preventDefault();
                    if (!row.hasClass("drop-hover")) {
                        if (row.attr("data-id") !== droppy.dragTimer.data) {
                            $(".drop-hover").removeClass("drop-hover");
                            row.addClass("drop-hover");
                        }
                        dropZone.removeClass("in");
                    }
                } else {
                    view.find(".drop-hover").removeClass("drop-hover");
                    if (!dropZone.hasClass("in")) dropZone.addClass("in");
                    getOtherViews(target.parents(".view")[0].vId).find(".dropzone").removeClass("in");
                }
            } else { // external source
                if (target.hasClass("directory") || target.parents().hasClass("directory")) {
                    if (!dropZone.hasClass("in")) dropZone.addClass("in");
                    getOtherViews(target.parents(".view")[0].vId).find(".dropzone").removeClass("in");
                } else {
                    $(".dropzone").removeClass("in");
                }
            }
        });
        view.register("dragleave", function (event) {
            var row,
                target = $(event.target);
            if (droppy.dragTimer.isInternal) { // internal source
                if (target.hasClass("folder-link")) {
                    row = target.parent();
                    if (row.hasClass("drop-hover")) {
                        row.removeClass("drop-hover");
                    }
                }
            }
            event.stopPropagation();
        });
    }

    function bindDropEvents(view) {
        view.find(".data-row").each(function () {
            var from, to, row = $(this);
            if (row.attr("data-type") === "folder") {
                row.register("drop", function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    $(".drop-hover").removeClass("drop-hover");
                    $(".dropzone").removeClass("in");
                    from = JSON.parse(event.dataTransfer.getData("text")).path;
                    to = join(row.attr("data-id"), basename(from));
                    if (from) handleDrop(view, event, from, to);
                });
            }
        });
        view.register("drop", function (event) {
            var dragData,
                view = $(event.target).parents(".view"),
                items = event.dataTransfer.items;

            event.preventDefault();
            event.stopPropagation();
            $(".dropzone").removeClass("in");

            if (event.dataTransfer.getData("text").length) { // It's a drag between views
                dragData = JSON.parse(event.dataTransfer.getData("text"));
                if (view.data("type") === "directory") { // dropping into a directory view
                    handleDrop(view, event, dragData.path, join(view[0].currentFolder, basename(dragData.path)), true);
                } else { // dropping into a document/media view
                    if (dragData.type === "folder") {
                        view.data("type", "directory");
                        updateLocation(view, dragData.path);
                    } else {
                        if (join(view[0].currentFolder, view[0].currentFile) !== dragData.path)
                            openFile(view, dirname(dragData.path), basename(dragData.path));
                    }
                }
                return;
            }

            // At this point, it's a external file drop
            var fileItem = null, entryFunc = null;

            // Don't allow dropping external files into a media view. We might allow this in the future, but it
            // needs some additional logic to request the uploaded file, and would only work intuitively for single files.
            if (view.data("type") !== "directory") return;

            uploadInit(view);

            // Try to find the supported getAsEntry function
            if (items && items[0]) {
                fileItem = (items[0].type === "text/uri-list") ? items[1] : items[0];
                for (var f = 0; f < droppy.prefixes.getAsEntry.length; f++) {
                    var func = droppy.prefixes.getAsEntry[f];
                    if (fileItem[func]) {
                        entryFunc = func;
                        break;
                    }
                }
            }

            // Check if we support getAsEntry();
            if (!items || !fileItem[entryFunc]()) {
                // No support, fallback to normal File API
                uploadInit(view);
                upload(view, event.dataTransfer.files);
                return;
            }

            // We support GetAsEntry, go ahead and read recursively
            var obj = {};

            // Calls the DirectoryReader until no more new files are returned
            function readEntries(entry, reader, oldEntries, cb) {
                var dirReader = reader || entry.createReader();
                dirReader.readEntries(function (entries) {
                    var newEntries = oldEntries ? oldEntries.concat(entries) : entries;
                    if (entries.length) {
                        setTimeout(function () {
                            readEntries(entry, dirReader, newEntries, cb);
                        }, 0);
                    }
                    else {
                        cb(newEntries);
                    }
                });
            }

            function readDirectory(entry, path, dirPromise) {
                if (!path) path = entry.name;
                obj[path] = {};
                readEntries(entry, undefined, undefined, function (entries) {
                    var promises = []; // Create a new set of promises for each directory
                    entries.forEach(function (entry) {
                        var promise = $.Deferred();
                        promises.push(promise);
                        if (entry.isFile) {
                            (function (entry, promise, path) {
                                entry.file(function (file) {
                                    obj[path + "/" + file.name] = file;
                                    promise.resolve();
                                }, function () { promise.resolve(); });
                            })(entry, promise, path);
                        } else {
                            readDirectory(entry, path + "/" + entry.name, promise);
                        }
                    });
                    $.when.apply($, promises).done(function () { // Level is done
                        dirPromise.resolve();
                    });
                });
            }

            var rootPromises = [];
            for (var i = 0; i < event.dataTransfer.items.length; i++) {
                var entry = event.dataTransfer.items[i][entryFunc](),
                    promise = $.Deferred();
                if (!entry) continue;
                rootPromises.push(promise);
                if (entry.isFile) {
                    (function (entry, promise) {
                        entry.file(function (file) {
                            obj[file.name] = file;
                            promise.resolve();
                        }, function () { promise.resolve(); });
                    })(entry, promise);
                } else if (entry.isDirectory) {
                    readDirectory(entry, null, promise);
                }
            }
            $.when.apply($, rootPromises).done(function () {
                upload(view, obj);
            });
        });
    }

    function initEntryMenu() {
        // Play an audio file
        $("#entry-menu .play").register("click", function (event) {
            var entry = $("#entry-menu").data("target"),
                view  = entry.parents(".view");

            event.stopPropagation();
            play(view, entry.data("id"));
            $("#click-catcher").trigger("click");
        });

        $("#entry-menu .edit").register("click", function (event) {
            var location,
                entry = $("#entry-menu").data("target"),
                view  = entry.parents(".view");

            $("#click-catcher").trigger("click");

            view[0].currentFile = entry.find(".file-link").text();
            location = join(view[0].currentFolder, view[0].currentFile);
            pushHistory(view, location);
            updatePath(view);
            openDoc(view, location);
            event.stopPropagation();
        });

        // Click on a "open" link
        $("#entry-menu .openfile").register("click", function (event) {
            var entry  = $("#entry-menu").data("target"),
                view   = entry.parents(".view");
            $("#click-catcher").trigger("click");
            openFile(view, view[0].currentFolder, entry.find(".file-link").text());
            event.stopPropagation();
        });

        // Rename a file/folder
        $("#entry-menu .rename").register("click", function (event) {
            var entry = $("#entry-menu").data("target"),
                view  = entry.parents(".view");
            if (droppy.socketWait) return;
            $("#click-catcher").trigger("click");
            entryRename(view, entry, false, function (success, oldVal, newVal) {
                if (success) {
                    showSpinner(view);
                    sendMessage(view[0].vId, "RENAME", { "old": oldVal, "new": newVal });
                }
            });
            event.stopPropagation();
        });

        // Copy/cut a file/folder
        $("#entry-menu .copy, #entry-menu .cut").register("click", function (event) {
            var entry = $("#entry-menu").data("target");
            droppy.clipboard = { type: $(this).attr("class"), from: entry.data("id") };
            $("#click-catcher").trigger("click");
            $(".view").each(function () {
                var view = $(this);
                if (!view.children(".paste-button").length) {
                    view.append(
                        '<div class="paste-button ' + (droppy.clipboard ? "in" : "out") + '">' + droppy.svg.paste +
                            '<span>Paste <span class="filename">' +
                                (droppy.clipboard ? basename(droppy.clipboard.from) : "") +
                            '</span></span>' +
                            droppy.svg.triangle +
                        '</div>');
                } else {
                    $(".paste-button .filename").text(basename(droppy.clipboard.from));
                }
                view.find(".paste-button").one("click", function (event) {
                    event.stopPropagation();
                    if (droppy.socketWait) return;
                    if (droppy.clipboard) {
                        showSpinner(view);
                        droppy.clipboard.to = join(view[0].currentFolder, basename(droppy.clipboard.from));
                        sendMessage(view[0].vId, "CLIPBOARD", droppy.clipboard);
                    } else {
                        throw new Error("Clipboard was empty!");
                    }
                    droppy.clipboard = null;
                    $("#click-catcher").trigger("click");
                    $(".paste-button").replaceClass("in", "out");
                });
                $(".paste-button").setTransitionClass("out", "in");
            });
            event.stopPropagation();
        });

        // Delete a file/folder
        $("#entry-menu .delete").register("click", function (event) {
            event.stopPropagation();
            if (droppy.socketWait) return;
            var entry = $("#entry-menu").data("target");
            showSpinner(entry.parents(".view"));
            sendMessage(null, "DELETE_FILE", entry.data("id"));
            $("#click-catcher").trigger("click");
        });
    }

    function showEntryMenu(entry, x) {
        var menuTop, menuMaxTop,
            type = /sprite\-(\w+)/.exec(entry.find(".sprite").attr("class"))[1],
            button = entry.find(".entry-menu"),
            menu = $("#entry-menu"),
            emWidth = parseFloat($("#entry-menu").css("font-size")); // width of 1em

        menu.attr("class", "in").data("target", entry).addClass("type-" + type);
        if (x)
            menu.css("left", (x + emWidth - menu.width()) + "px");
        else
            menu.css("left", (button.offset().left + button.width() - menu.width()) + "px");

        menuMaxTop = $(document).height() - $("#entry-menu").height();
        menuTop = entry.offset().top;
        if (menuTop > menuMaxTop) menuTop = menuMaxTop;
        menu.css("top", menuTop + "px");
        toggleCatcher();

        $("#click-catcher").one("click", function () {
            menu.attr("class", "out");
            toggleCatcher();
        });
    }

    function sortByHeader(view, header) {
        view[0].sortBy = /header\-(\w+)/.exec(header[0].className)[1];
        view[0].sortAsc = header.hasClass("down");
        header.attr("class", "header-" + view[0].sortBy + " " + (view[0].sortAsc ? "up" : "down") + " active");
        header.siblings().removeClass("active up down");
        var sortedEntries = droppy.templates.fn.sortKeysByProperty(view[0].currentData, header.attr("data-sort"));
        if (view[0].sortAsc) sortedEntries = sortedEntries.reverse();
        for (var index = sortedEntries.length - 1; index >= 0; index--) {
            view.find("[data-name='" + sortedEntries[index].replace(/['"]/g,"_") + "']:first").css({
                "order": index,
                "-ms-flex-order": String(index)
            }).attr("order", index);
        }
    }

    droppy.templates.fn.compare = function (a, b) {
        if (typeof a === "number" && typeof b === "number") {
            return b - a;
        } else {
            return naturalSort(a, b);
        }
    };
    // Compare by property, then by key
    droppy.templates.fn.compare2 = function (entries, property) {
        var result;
        return function (a, b) {
            result = droppy.templates.fn.compare(entries[a][property], entries[b][property]);
            if (result === 0) result = droppy.templates.fn.compare(a, b);
            return result;
        };
    };
    droppy.templates.fn.sortKeysByProperty = function (entries, by) {
        return Object.keys(entries).sort(droppy.templates.fn.compare2(entries, by));
    };

    function closeDoc(view) {
        view[0].switchRequest = true;
        view[0].editor = null;
        updateLocation(view, view[0].currentFolder);
    }

    function openFile(view, newFolder, file) {
        var ext = getExt(file),
            oldFolder = view[0].currentFolder;

        // Determine filetype and how to open it
        if (Object.keys(droppy.imageTypes).indexOf(ext) !== -1) { // Image
            view[0].currentFile = file;
            view[0].currentFolder = newFolder;
            pushHistory(view, join(view[0].currentFolder, view[0].currentFile));
            updatePath(view);
            openMedia(view, "image", oldFolder === newFolder);
        } else if (Object.keys(droppy.videoTypes).indexOf(ext) !== -1) { // Video
            if (!droppy.detects.videoTypes[droppy.videoTypes[ext]]) {
                showError(view, "Sorry, your browser can't play this file.");
                updateLocation(view, view[0].currentFolder);
            } else {
                view[0].currentFile = file;
                view[0].currentFolder = newFolder;
                pushHistory(view, join(view[0].currentFolder, view[0].currentFile));
                updatePath(view);
                openMedia(view, "video", oldFolder === newFolder);
            }
        } else { // Generic file, ask the server if the file has binary contents
            var entryId = join(newFolder, file);
            $.ajax({
                type: "GET",
                url: "??" + entryId,
                dataType: "text"
            }).done(function (data, textStatus, request) {
                if (request.status !== 200) {
                    showError(view, "Couldn't open or read the file.");
                    hideSpinner(view);
                } else if (data === "text") { // Non-Binary content
                    view[0].currentFile = file;
                    view[0].currentFolder = newFolder;
                    pushHistory(view, entryId);
                    updatePath(view);
                    openDoc(view, entryId);
                } else { // Binary content - download it
                    // Downloading into an iframe to avoid navigation
                    $("<iframe class='dl'>").css("display", "none").appendTo("body").attr("src", "?~" + entryId);
                    setTimeout(function () { $("iframe.dl").remove(); }, 1000);
                    hideSpinner(view);
                }
            });
        }
    }

    function populateMediaCache(view, data) {
        var extensions = Object.keys(droppy.imageTypes).concat(Object.keys(droppy.videoTypes));
        view[0].mediaFiles = [];
        Object.keys(data).forEach(function (filename) {
            var ext = getExt(filename);
            if (data[filename].type !== "f") return;
            if (extensions.indexOf(ext) !== -1) {
                if (droppy.videoTypes[ext] && !droppy.detects.videoTypes[droppy.videoTypes[ext]]) return;
                view[0].mediaFiles.push(filename);
            }
        });
        view[0].mediaFiles = view[0].mediaFiles.sort(naturalSort);
        [getPrevMedia(view), getNextMedia(view)].forEach(function (filename) {
            var src = getMediaSrc(view, filename);
            if (!src) return;
            if (Object.keys(droppy.imageTypes).indexOf(getExt(filename)) !== -1) {
                (document.createElement("img")).src = src;
            }
        });
    }

    function getPrevMedia(view) {
        var curr = view[0].mediaFiles.indexOf(view[0].currentFile);
        if (curr > 0)
            return view[0].mediaFiles[curr - 1];
        else
            return view[0].mediaFiles[view[0].mediaFiles.length - 1];
    }

    function getNextMedia(view) {
        var curr = view[0].mediaFiles.indexOf(view[0].currentFile);
        if (curr < (view[0].mediaFiles.length - 1))
            return view[0].mediaFiles[curr + 1];
        else
            return view[0].mediaFiles[0];
    }

    function bindMediaArrows(view) {
        if (droppy.detects.mobile) return; // Using swipe on mobile
        var forward = view.find(".arrow-forward"),
            back    = view.find(".arrow-back"),
            arrows  = view.find(".arrow-back, .arrow-forward");

        back.register("click", function ()    { swapMedia(view, "left");  });
        forward.register("click", function () { swapMedia(view, "right"); });

        arrows
            .register("mouseenter mousemove", function () { if (!$(this).hasClass("in")) $(this).addClass("in"); })
            .register("mouseleave", function () { $(this).removeClass("in"); });

        // Show arrows for three seconds so they won't have to be discovered
        arrows.addClass("in");
        setTimeout(function () {arrows.removeClass("in"); }, 3000);
    }

    function swapMedia(view, dir) {
        var b, a = view.find(".media-wrapper"),
            nextFile = (dir === "left") ? getPrevMedia(view) : getNextMedia(view),
            isImage = Object.keys(droppy.imageTypes).indexOf(getExt(nextFile)) !== -1,
            src = getMediaSrc(view, nextFile);

        if (isImage) {
            b = $("<div class='media-wrapper new-media " + dir + "'><img src='" + src + "'></div>");
            b.find("img").one("load", function () {
                aspectScale();
            });
        } else {
            b = $("<div class='media-wrapper new-media " + dir + "'><video src='" + src + "' id='video-" + view[0].vId + "'></div>");
            b = $(bindVideoEvents(b[0]));
        }

        a.attr("class", dir === "left" ? "media-wrapper right" : "media-wrapper left");
        b.appendTo(view.find(".media-container"));
        b.setTransitionClass(/(left|right)/, "").end(function () {
            b.removeClass("new-media");
            a.remove();
            if (!isImage) initVideoJS(b.find("video")[0]);
            makeMediaDraggable(b[0]);
            $(b[0]).parents(".content").replaceClass(/(image|video)/, isImage ? "image" : "video");
            view[0].currentFile = nextFile;
            populateMediaCache(view, view[0].currentData);
            replaceHistory(view, join(view[0].currentFolder, view[0].currentFile));
            updatePath(view);
            if (view[0].vId === 0) updateTitle(nextFile); // Only update the page's title from view 0
        });
    }

    // Media up/down-scaling while maintaining aspect ratio.
    function aspectScale() {
        $(".media-container").each(function () {
            var container = $(this);
            container.find("img, video").each(function () {
                var dims  = {
                        w: this.naturalWidth || this.videoWidth || this.clientWidth,
                        h: this.naturalHeight || this.videoHeight || this.clientHeight
                    },
                    space = {
                        w: container.width(),
                        h: container.height()
                    };
                if (dims.w > space.w || dims.h > space.h) {
                    $(this).css({width: "", height: ""}); // Let CSS handle the downscale
                } else {
                    if (dims.w / dims.h > space.w / space.h) {
                        $(this).css({width: "100%", height: "auto"});
                    } else {
                        $(this).css({width: "auto", height: "100%"});
                    }
                }
            });
        });
    }

    function bindVideoEvents(el) {
        var volume = droppy.get("videoVolume");
        if (volume) el.volume = volume;
        el.addEventListener("loadedmetadata", aspectScale);
        el.addEventListener("volumechange", function () {
            droppy.set("videoVolume", this.volume);
        });
        el.addEventListener("error", function (event) {
            console.error(event);
            aspectScale();
        });
        return el;
    }

    function getMediaSrc(view, filename) {
        var encodedId = join(view[0].currentFolder, filename).split("/"),
            i = encodedId.length - 1;
        for (;i >= 0; i--)
            encodedId[i] = encodeURIComponent(encodedId[i]);
        return "?_" + encodedId.join("/");
    }

    function openMedia(view, type, sameFolder) {
        var previewer,
            filename  = view[0].currentFile;
        view.data("type", type);
        previewer = $(droppy.templates.views.media({
            type: type,
            src: getMediaSrc(view, filename),
            vid: view[0].vId
        }));
        if (sameFolder && view[0].currentData) {
            populateMediaCache(view, view[0].currentData);
        } else { // In case we switch into an unknown folder, request its files
            sendMessage(view[0].vId, "REQUEST_UPDATE", view[0].currentFolder);
        }
        view[0].animDirection = "center";
        loadContent(view, contentWrap(view).append(previewer), function (view) {
            view.find(".fs").register("click", function () {
                toggleFullscreen($(this).parents(".content")[0]);
            });
            view.find(".media-container img").each(function () {
                aspectScale();
                makeMediaDraggable(this.parentNode);
            });
            view.find(".media-container video").each(function () {
                initVideoJS(this, function () {
                    makeMediaDraggable(view.find(".media-wrapper")[0]);
                    bindVideoEvents(view.find("video")[0]);
                });
            });

            if (view[0].vId === 0) updateTitle(filename);
            hideSpinner(view);
        });
    }

    function openDoc(view, entryId) {
        showSpinner(view);
        var editor, doc = $(droppy.templates.views.document({modes: droppy.modes}));
        view.data("type", "document");
        view[0].animDirection = "center";

        $.ajax({
            type: "GET",
            url: "?_" + entryId,
            dataType: "text"
        }).done(function (data) {
            var filename = basename(entryId);
            updateTitle(filename);
            loadTheme(droppy.get("theme"), function () {
                loadCM(data, filename);
            });
        }).fail(function () {
            closeDoc(view);
        });

        function loadCM(data, filename) {
            loadContent(view, contentWrap(view).append(doc), function () {
                view[0].editorEntryId = entryId;
                view[0].editor = editor = CodeMirror(view.find(".document")[0], {
                    autofocus: true,
                    dragDrop: false,
                    indentUnit: droppy.get("indentUnit"),
                    indentWithTabs: droppy.get("indentWithTabs"),
                    keyMap: "sublime",
                    lineNumbers: true,
                    lineWrapping: droppy.get("lineWrapping"),
                    showCursorWhenSelecting: true,
                    styleSelectedText: true,
                    styleActiveLine: true,
                    tabSize: droppy.get("indentUnit"),
                    theme: droppy.get("theme"),
                    mode: "text/plain"
                });
                doc.find(".exit").register("click", function () {
                    closeDoc($(this).parents(".view"));
                    editor = null;
                });
                doc.find(".save").register("click", function () {
                    var view = $(this).parents(".view");
                    showSpinner(view);
                    sendMessage(view[0].vId, "SAVE_FILE", {
                        "to": entryId,
                        "value": editor.getValue()
                    });
                });
                doc.find(".ww").register("click", function () {
                    editor.setOption("lineWrapping", !editor.options.lineWrapping);
                    droppy.set("lineWrapping", !editor.options.lineWrapping);
                });
                doc.find(".syntax").register("click", function () {
                    var shown = view.find(".mode-select").toggleClass("in").hasClass("in");
                    view.find(".syntax")[shown ? "addClass" : "removeClass"]("in");
                    view.find(".mode-select").on("change", function () {
                        var mode = $(this).val();
                        CodeMirror.autoLoadMode(editor, mode);
                        editor.setOption("mode", mode);
                        view.find(".syntax").removeClass("in");
                        view.find(".mode-select").removeClass("in");
                    });
                });
                doc.find(".find").register("click", function () {
                    CodeMirror.commands.find(editor);
                    view.find(".CodeMirror-search-field").eq(0).focus();
                });
                doc.find(".full").register("click", function () {
                    toggleFullscreen($(this).parents(".content")[0]);
                });

                // Disable New-Tab browser shortcut in keymap
                CodeMirror.keyMap.sublime[droppy.detects.mac ? "Cmd-T" : "Ctrl-T"] = false;

                var called = false;
                view.find(".content").end(function () {
                    if (called) return;
                    called = true;
                    editor.setValue(data);

                    if (!CodeMirror.autoLoadMode) initModeLoad();
                    var modeInfo = CodeMirror.findModeByFileName(filename);
                    if (modeInfo) {
                        CodeMirror.autoLoadMode(editor, modeInfo.mode);
                        editor.setOption("mode", modeInfo.mode);
                        view.find(".mode-select").val(modeInfo.mode);
                    } else {
                        view.find(".mode-select").val("plain");
                    }

                    editor.on("change", function (cm, change) {
                        var view = getCMView(cm);
                        if (change.origin !== "setValue")
                            view.find(".path li:last-child").removeClass("saved save-failed").addClass("dirty");
                    });
                    editor.on("keydown", function (cm, event) { // Keyboard shortcuts
                        if (event.keyCode === 83 && (event[droppy.detects.mac ? "metaKey" : "ctrlKey"])) { // CTRL-S / CMD-S
                            var view = getCMView(cm);
                            event.preventDefault();
                            showSpinner(view);
                            sendMessage(view[0].vId, "SAVE_FILE", {
                                "to": view[0].editorEntryId,
                                "value": cm.getValue()
                            });
                        }
                    });
                    editor.clearHistory();
                    editor.refresh();
                    hideSpinner(view);
                    function getCMView(cm) {
                        return getView($(cm.getWrapperElement()).parents(".view")[0].vId);
                    }
                });
            });
        }
    }

    function createUserList(users) {
        var output = "<div class='list-user'>";
        Object.keys(users).forEach(function (user) {
            output += '<li><span class="username">' + user + "</span>" + droppy.svg.trash + '</li>';
        });
        output += "</ul>";
        output += "<div class='add-user'>" + droppy.svg.plus + "Add User</div>";
        output += "</div>";
        return output;
    }

    function updateUsers(userlist) {
        var list, box = $("#prefs-box");

        if (Object.keys(userlist).length > 0) {
            box.find(".list-user").remove();
            box.append(createUserList(userlist));
            list = box.find(".list-user");
            list.find(".add-user").register("click", function () {
                var user = window.prompt("Username?"),
                    pass = window.prompt("Password?");
                if (!user || !pass) return;
                sendMessage(null, "UPDATE_USER", {
                    name: user,
                    pass: pass,
                    priv: true
                });
            });
            list.find(".trash").register("click", function (event) {
                event.stopPropagation();
                sendMessage(null, "UPDATE_USER", {
                    name: $(this).parents("li").children(".username").text(),
                    pass: ""
                });
            });
        }
    }

    function showPrefs() {
        var box = $("#prefs-box");
        box.empty().append(function () {
            return $("<div class='list-prefs'>").append(droppy.templates.options({
                droppy: droppy,
                prefs: [
                    ["indentWithTabs", "Indentation Mode", [true, false], ["Tabs", "Spaces"]],
                    ["indentUnit", "Indentation Unit", [2, 4, 8], [2, 4, 8]],
                    ["theme", "Editor Theme", droppy.themes, droppy.themes],
                    ["lineWrapping", "Wordwrap Mode", [true, false], ["Wrap", "No Wrap"]],
                    ["renameExistingOnUpload", "Upload Mode", [true, false], ["Rename", "Replace"]]
                ]
            }));
        });

        $("select.theme").register("change", function () {
            var theme = $(this).val();
            loadTheme(theme, function () {
                droppy.set("theme", theme);
                $(".view").each(function () {
                    if (this.editor) this.editor.setOption("theme", theme);
                });
            });
        });

        $("#prefs-box").replaceClass("out", "in");
        toggleCatcher();
        $("#click-catcher").one("click", function () {
            box.find("select").each(function () {
                var option = $(this).attr("class"),
                    value  = $(this).val();

                if (value === "true") value = true;
                else if (value === "false") value = false;
                else if (/^-?\d*(\.\d+)?$/.test(value)) value = parseFloat(value);

                droppy.set(option, value);
                if (option === "indentUnit") droppy.set("tabSize", value);

                $(".view").each(function () {
                    if (this.editor) {
                        this.editor.setOption(option, value);
                        if (option === "indentUnit") this.editor.setOption("tabSize", value);
                    }
                });
            });
        });
    }

    // ============================================================================
    //  Audio functions / events
    // ============================================================================

    function play(view, path) {
        var content, paths,
            row    = view.find(".data-row[data-id='" + path + "']"),
            player = view.find(".audio-player")[0],
            source = "?_" + path;

        view.find(".seekbar-played").css("width", "0%");
        view.find(".seekbar-loaded").css("width", "0%");

        if (player.canPlayType(droppy.audioTypes[getExt(source)])) {
            player.src = source;
            onNewAudio(view);
            player.load();
            player.play();
        } else {
            return showError(view, "Sorry, your browser can't play this file.");
        }
        if (row.length) {
            content = row.parents(".content");
            paths   = [];

            row.addClass("playing").siblings().removeClass("playing");
            if ((row[0].offsetTop < content.scrollTop()) ||
                (row[0].offsetTop + row[0].offsetHeight > content.scrollTop() + content.height())) {
                row.parents(".content").scrollTop(row[0].offsetTop - 2); // keep played element in view
            }
            row.parent().children(".playable").each(function () {
                paths.push($(this).data("id"));
            });
            view[0].playlist = paths;
            view[0].playlistIndex = paths.indexOf(path);
        } else {
            view[0].playlistIndex = view[0].playlist.indexOf(path);
        }
    }

    function onNewAudio(view) {
        var player     = view.find(".audio-player")[0],
            seekPlayed = view.find(".seekbar-played"),
            seekLoaded = view.find(".seekbar-loaded"),
            timeCur    = view.find(".time-cur"),
            timeMax    = view.find(".time-max"),
            title      = basename(player.src).replace(/\..+$/, "").replace(/_/g, " ").replace(/\s+/, " ");

        title = decodeURIComponent(title);
        view.find(".audio-bar").replaceClass("out", "in");
        view.find(".audio-title").text(title);
        updateTitle(title);

        view[0].audioUpdater = setInterval(function updater() {
            var progress, cur = player.currentTime, max = player.duration;

            if (player.buffered.length) {
                progress = player.buffered.end(0) / max * 100;
                seekLoaded.css("width", progress + "%");
                if (progress === 100) clearInterval(view[0].audioUpdater);
            }
            if (cur && max) {
                seekPlayed.css("width", (cur / max * 100)  + "%");
                timeCur.text(secsToTime(cur));
                timeMax.text(secsToTime(max));
            }
        }, 1000 / 60);
    }

    function initAudio(view) {
        var updateVolume, heldVolume = false,
            bar        = view.find(".audio-bar"),
            slider     = view.find(".volume-slider"),
            volumeIcon = view.find(".audio-bar .volume"),
            player     = view.find(".audio-player")[0];

        setVolume(droppy.get("volume"));

        player.addEventListener("ended", function ended(event) {
            var view = $(event.target).parents(".view");
            playNext(view);
        });
        player.addEventListener("playing", function playing(event) {
            onNewAudio($(event.target).parents(".view"));
        });
        updateVolume = throttle(function (event) {
            var slider = $(event.target).parents(".view").find(".volume-slider")[0],
                left   = slider.getBoundingClientRect().left,
                right  = slider.getBoundingClientRect().right,
                x      = event.pageX;

            setVolume((x - left) / (right - left));
        }, 1000 / 60);
        slider.register("mousedown", function (event) {
            heldVolume = true;
            updateVolume(event);
            event.stopPropagation();
        });
        bar.register("mousemove", function (event) {
            if (heldVolume) updateVolume(event);
        });
        bar.register("mouseup", function () {
            heldVolume = false;
        });
        slider.register("click", function (event) {
            updateVolume(event);
            event.stopPropagation();
        });
        bar.register("click", function (event) {
            player.currentTime = player.duration * ((event.pageX - bar.offset().left) / bar.innerWidth());
        });
        bar.find(".previous").register("click", function (event) {
            playPrev($(event.target).parents(".view"));
            event.stopPropagation();
        });
        bar.find(".next").register("click", function (event) {
            playNext($(event.target).parents(".view"));
            event.stopPropagation();
        });
        bar.find(".pause-play").register("click", function (event) {
            var icon   = $(this).children("svg"),
                player = $(this).parents(".audio-bar").find(".audio-player")[0];
            if (icon.attr("class") === "play") {
                icon.replaceWith($(droppy.svg.pause));
                player.play();
            } else {
                icon.replaceWith($(droppy.svg.play));
                player.pause();
            }
            event.stopPropagation();
        });
        bar.find(".stop").register("click", function (event) {
            var view   = $(this).parents(".view"),
                player = view.find(".audio-player")[0];
            player.pause();
            view.find(".audio-title").html("");
            view.find(".data-row.playing").removeClass("playing");
            if (view[0].audioUpdater) {
                clearInterval(view[0].audioUpdater);
                view[0].audioUpdater = null;
            }
            updateTitle(basename(getView()[0].currentFolder));
            bar.replaceClass("in", "out");
            event.stopPropagation();
        });
        bar.find(".shuffle").register("click", function (event) {
            var view = $(this).parents(".view");
            $(this).toggleClass("active");
            view[0].shuffle = $(this).hasClass("active");
            event.stopPropagation();
        });
        function onWheel(event) {
            if ((event.wheelDelta || -event.detail) > 0)
                setVolume(player.volume + 0.1);
            else
                setVolume(player.volume - 0.1);
        }
        slider[0].addEventListener("mousewheel", onWheel);
        slider[0].addEventListener("DOMMouseScroll", onWheel);
        volumeIcon[0].addEventListener("mousewheel", onWheel);
        volumeIcon[0].addEventListener("DOMMouseScroll", onWheel);
        volumeIcon.register("click", function (event) {
            slider.replaceClass(/in|out/, slider.hasClass("in") ? "out" : "in");
            volumeIcon.toggleClass("active");
            event.stopPropagation();
        });
        function setVolume(volume) {
            if (volume > 1) volume = 1;
            if (volume < 0) volume = 0;
            player.volume = volume;
            droppy.set("volume", volume);
            if (player.volume === 0) volumeIcon.html(droppy.svg["volume-mute"]);
            else if (player.volume <= 0.33) volumeIcon.html(droppy.svg["volume-low"]);
            else if (player.volume <= 0.67) volumeIcon.html(droppy.svg["volume-medium"]);
            else volumeIcon.html(droppy.svg["volume-high"]);
            view.find(".volume-slider-inner").width((volume * 100) + "%");
        }
        function playRandom(view) {
            var nextIndex;
            if (view[0].playlist.length === 1) return play(view, view[0].playlist[0]);
            do {
                nextIndex = Math.floor(Math.random() * view[0].playlist.length);
            } while (nextIndex === view[0].playlistIndex);
            play(view, view[0].playlist[nextIndex]);
        }
        function playNext(view) {
            if (view[0].shuffle) return playRandom(view);
            if (view[0].playlistIndex < view[0].playlist.length - 1)
                play(view, view[0].playlist[view[0].playlistIndex + 1]);
            else
                play(view, view[0].playlist[0]);
        }
        function playPrev(view) {
            if (view[0].shuffle) return playRandom(view);
            if (view[0].playlistIndex === 0)
                play(view, view[0].playlist[view[0].playlist.length - 1]);
            else
                play(view, view[0].playlist[view[0].playlistIndex - 1]);
        }
    }

    // CodeMirror dynamic mode loading
    // based on https://github.com/codemirror/CodeMirror/blob/master/addon/mode/loadmode.js
    function initModeLoad() {
        var loading = {};
        function splitCallback(cont, n) {
            var countDown = n;
            return function () { if (--countDown === 0) cont(); };
        }
        function ensureDeps(mode, cont) {
            var deps = CodeMirror.modes[mode].dependencies;
            if (!deps) return cont();
            var missing = [];
            for (var i = 0; i < deps.length; ++i) {
                if (!CodeMirror.modes.hasOwnProperty(deps[i]))
                    missing.push(deps[i]);
            }
            if (!missing.length) return cont();
            var split = splitCallback(cont, missing.length);
            for (var j = 0; j < missing.length; ++j)
                CodeMirror.requireMode(missing[j], split);
        }

        CodeMirror.requireMode = function (mode, cont) {
            if (typeof mode !== "string") mode = mode.name;
            if (CodeMirror.modes.hasOwnProperty(mode)) return ensureDeps(mode, cont);
            if (loading.hasOwnProperty(mode)) return loading[mode].push(cont);

            var script = document.createElement("script");
            script.src = "?!/mode/" + mode;
            var others = document.getElementsByTagName("script")[0];
            others.parentNode.insertBefore(script, others);
            var list = loading[mode] = [cont];
            var count = 0, poll = setInterval(function () {
                if (++count > 100) return clearInterval(poll);
                if (CodeMirror.modes.hasOwnProperty(mode)) {
                    clearInterval(poll);
                    loading[mode] = null;
                    ensureDeps(mode, function () {
                        for (var i = 0; i < list.length; ++i) list[i]();
                    });
                }
            }, 200);
        };

        CodeMirror.autoLoadMode = function (instance, mode) {
            if (!CodeMirror.modes.hasOwnProperty(mode)) {
                CodeMirror.requireMode(mode, function () {
                    instance.setOption("mode", instance.getOption("mode"));
                });
            }
        };
    }

    // draggabilly
    function makeMediaDraggable(el) {
        if ($(el).hasClass("draggable")) return;
        var draggie = new Draggabilly(el, {axis: "x"});
        $(el).attr("class", "media-wrapper draggable");
        draggie.on("dragEnd", function (instance) {
            var view = $(instance.element).parents(".view"),
                dragThreshold = droppy.detects.mobile ? 0.15 : 0.075;
            if ((Math.abs(instance.position.x) / instance.element.clientWidth) > dragThreshold) {
                swapMedia(view, instance.position.x > 0 ? "left" : "right");
            } else {
                $(instance.element).removeAttr("style");
            }
        });
    }

    // video.js
    function initVideoJS(el, cb) {
        if (!$("#vjs-css").length) {
            $.get("?!/lib/video.js/vjs.css").then(function (data) {
                $('<style id="vjs-css"></style>').appendTo("head");
                $("#vjs-css").text(data.replace(/font\//gm, "?!/lib/video.js/font/"));
            });
        }
        loadScript("vjs-js", "?!/lib/video.js/vjs.js", function init() {
            if (!window.videojs)
                throw new Error("videojs undefined");

            if (!el.classList.contains("video-js"))
                el.classList.add("video-js", "vjs-default-skin");

            videojs.options.flash.swf = "?!/lib/video.js/vjs.swf";
            videojs(el, {
                "controls" : true,
                "autoplay" : droppy.detects.mobile ? false : true,
                "preload"  : "auto",
                "loop"     : "loop",
                "width"    : $(el).parents(".media-container")[0].clientWidth,
                "heigth"   : $(el).parents(".media-container")[0].clientHeight
            }, cb);
        });
    }

    // Extract the extension from a file name
    function getExt(filename) {
        if (!filename) return "";
        var parts = filename.split(".");
        if (parts.length === 1 || (parts[0] === "" && parts.length === 2)) return "";
        return parts.pop().toLowerCase();
    }

    function deleteCookie(name) {
        document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:01 GMT;";
    }

    function initVariables() {
        droppy.activeFiles = [];
        droppy.debug = null;
        droppy.demoMode = null;
        droppy.public = null;
        droppy.queuedData = null;
        droppy.reopen = null;
        droppy.resizeTimer = null;
        droppy.sizeCache = {};
        droppy.socket = null;
        droppy.socketWait = null;
        droppy.views = [];
        droppy.emptyFiles = null;
        droppy.emptyFolders = null;
        droppy.keyBindings = {};

        droppy.prefixes = {
            animation         : ["animation", "-moz-animation", "-webkit-animation", "-ms-animation"],
            directory         : ["directory", "mozdirectory", "webkitdirectory", "msdirectory"],
            animationstart    : ["animationstart", "mozAnimationStart", "webkitAnimationStart", "MSAnimationStart"],
            getAsEntry        : ["getAsEntry", "webkitGetAsEntry", "mozGetAsEntry", "MSGetAsEntry"],
            requestFullscreen : ["requestFullscreen", "mozRequestFullScreen", "webkitRequestFullscreen", "msRequestFullscreen"],
            fullscreenchange  : ["fullscreenchange", "mozfullscreenchange", "webkitfullscreenchange", "msfullscreenchange" ],
            fullscreenElement : ["fullscreenElement", "mozFullScreenElement", "webkitFullscreenElement", "msFullscreenElement"],
            fullscreenEnabled : ["fullscreenEnabled", "mozFullScreenEnabled", "webkitFullscreenEnabled", "msFullscreenEnabled"],
            exitFullscreen    : ["exitFullscreen", "mozCancelFullScreen", "webkitExitFullscreen", "msExitFullscreen"]
        };

        // Extension to icon mappings
        droppy.iconMap = {
            "archive":  ["bz2", "gz", "tgz"],
            "audio":    ["aac", "aif", "aiff", "flac", "m4a", "mid", "mp1", "mp2", "mp3", "mpa", "ra", "ogg", "oga", "opus", "wav", "wma"],
            "authors":  ["authors"],
            "bin":      ["class", "o", "so"],
            "bmp":      ["bmp"],
            "c":        ["c"],
            "calc":     ["ods", "ots", "xlr", "xls", "xlsx"],
            "cd":       ["cue", "iso"],
            "copying":  ["copying", "license"],
            "cpp":      ["cpp", "cc", "cxx"],
            "css":      ["css", "less", "scss", "sass"],
            "deb":      ["deb"],
            "diff":     ["diff", "patch"],
            "doc":      ["doc", "docx", "odm", "odt", "ott"],
            "draw":     ["drw"],
            "eps":      ["eps"],
            "exe":      ["bat", "cmd", "exe"],
            "gif":      ["gif"],
            "gzip":     ["gz"],
            "h":        ["h", "hh"],
            "hpp":      ["hpp"],
            "html":     ["htm", "html", "shtml"],
            "ico":      ["ico"],
            "image":    ["svg", "xpm", "webp"],
            "install":  ["install", "msi"],
            "java":     ["java"],
            "jpg":      ["jpg", "jpeg"],
            "js":       ["js", "es", "dart"],
            "json":     ["json", "gyp"],
            "log":      ["log", "changelog"],
            "makefile": ["makefile", "pom"],
            "markdown": ["markdown", "md"],
            "pdf":      ["pdf"],
            "php":      ["php"],
            "playlist": ["m3u", "m3u8", "pls"],
            "png":      ["png", "apng"],
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
            "script":   ["csh", "ini", "ksh", "sh", "shar", "tcl"],
            "sql":      ["sql", "dump"],
            "tar":      ["tar"],
            "tex":      ["tex"],
            "text":     ["text", "txt", "conf", "cfg"],
            "tiff":     ["tiff"],
            "vcal":     ["vcal"],
            "video":    ["avi", "flv", "mkv", "mov", "mp4", "mpg", "mpeg", "m4v", "mpg", "ogv", "rm", "swf", "vob", "wmv", "webm"],
            "xml":      ["xml"],
            "zip":      ["7z", "bz2", "jar", "lzma", "war", "z", "Z", "zip"]
        };

        droppy.audioTypes = {
            "aac" : "audio/aac",
            "m4a" : "audio/mp4",
            "mp1" : "audio/mpeg",
            "mp2" : "audio/mpeg",
            "mp3" : "audio/mpeg",
            "mpa" : "audio/mpeg",
            "mpg" : "audio/mpeg",
            "mpeg": "audio/mpeg",
            "ogg" : "audio/ogg",
            "oga" : "audio/ogg",
            "opus": "audio/ogg",
            "wav" : "audio/wav"
        };

        droppy.videoTypes = {
            "mp4" : "video/mp4", // can be audio/mp4 too
            "m4v" : "video/mp4",
            "ogv" : "video/ogg",
            "webm": "video/webm" // can be audio/webm too
        };

        droppy.imageTypes = {
            "jpg" : "image/jpeg",
            "jpeg": "image/jpeg",
            "gif" : "image/gif",
            "png" : "image/png",
            "apng": "image/png",
            "svg" : "image/svg+xml",
            "bmp" : "image/bmp",
            "ico" : "image/x-icon"
        };
    }

    // SVG preprocessing
    function prepareSVG(html) {
        var tmp;
        // Populate droppy.svg
        Object.keys(droppy.svg).forEach(function (name) {
            tmp = $("<div>" + droppy.svg[name] + "</div>");
            tmp.find("svg").attr("class", name);
            droppy.svg[name] = tmp.html();
        });
        // Replace <svg>'s in the html source with the full svg data
        tmp = $("<div>" + html + "</div>");
        tmp.find("svg").replaceWith(function () {
            return $(droppy.svg[$(this).attr("class")]);
        });
        return tmp.html();
    }

    // Find the corrects class for an icon sprite
    function getSpriteClass(extension) {
        for (var type in droppy.iconMap) {
            if (droppy.iconMap[type.toLowerCase()].indexOf(extension.toLowerCase()) > -1) {
                return "sprite sprite-" + type;
            }
        }
        return "sprite sprite-bin";
    }
    droppy.templates.fn.getSpriteClass = getSpriteClass;

    function getHeaderHTML() {
        return '<div class="file-header">' +
                    '<span class="header-name" class="down">Name' + droppy.svg.triangle + '</span>' +
                    '<span class="header-mtime" class="up">Modified' + droppy.svg.triangle + '</span>' +
                    '<span class="header-size" class="up">Size' + droppy.svg.triangle + '</span>' +
                    '<span class="header-spacer"></span>' +
                '</div>';
    }

    function fullScreenElement() {
        var el;
        droppy.prefixes.fullscreenElement.some(function (prop) {
            if (prop in document) {
                el = document[prop];
            }
        });
        return el;
    }

    function toggleFullscreen(el) {
        if (!fullScreenElement()) {
            droppy.prefixes.requestFullscreen.some(function (prop) {
                if (prop in el) el[prop]();
            });
        } else {
            droppy.prefixes.exitFullscreen.some(function (method) {
                if (method in document) return document[method]();
            });
        }
    }

    function addKey(keyCode, callback) {
        keyCode = Array.isArray(keyCode) ? keyCode : [keyCode];
        keyCode.forEach(function (key) { droppy.keyBindings[key] = callback; });
        setBindings();
    }
    function removeKey(keyCode) {
        keyCode = Array.isArray(keyCode) ? keyCode : [keyCode];
        keyCode.forEach(function (key) { delete droppy.keyBindings[key]; });
        setBindings();
    }
    function setBindings() {
        document[Object.keys(droppy.keyBindings) > 0 ? "addEventListener" : "removeEventListener"]("keydown", function (e) {
            var func = droppy.keyBindings[e.keyCode];
            if (func) func(e);
        });
    }

    function timeDifference(previous) {
        var msPerMinute = 60 * 1000,
            msPerHour   = msPerMinute * 60,
            msPerDay    = msPerHour * 24,
            msPerMonth  = msPerDay * 30,
            msPerYear   = msPerDay * 365,
            elapsed     = Date.now() - parseInt(previous),
            result      = "";

        if (elapsed < 0) elapsed = 0;
        if (elapsed < msPerMinute) {
            result = "just now";
        } else if (elapsed < msPerHour) {
            result = Math.round(elapsed / msPerMinute);
            result += (result === 1) ? " min ago" : " mins ago";
        } else if (elapsed < msPerDay) {
            result = Math.round(elapsed / msPerHour);
            result += (result === 1) ? " hour ago" : " hours ago";
        } else if (elapsed < msPerMonth) {
            result = Math.round(elapsed / msPerDay);
            result += (result === 1) ? " day ago" : " days ago";
        } else if (elapsed < msPerYear) {
            result = Math.round(elapsed / msPerMonth);
            result += (result === 1) ? " month ago" : " months ago";
        } else {
            result = Math.round(elapsed / msPerYear);
            result += (result === 1) ? " year ago" : " years ago";
        }
        if (isNaN(elapsed)) result = "unknown";
        return result;
    }
    droppy.templates.fn.timeDifference = timeDifference;

    function secsToTime(secs) {
        var mins, hrs, time = "";
        secs = parseInt(secs, 10);
        hrs  = Math.floor(secs / 3600);
        mins = Math.floor((secs - (hrs * 3600)) / 60);
        secs = secs - (hrs * 3600) - (mins * 60);

        if (hrs < 10)  hrs  = "0" + hrs;
        if (mins < 10) mins = "0" + mins;
        if (secs < 10) secs = "0" + secs;

        if (hrs !== "00") time = (hrs + ":");
        return time + mins + ":" + secs;
    }

    setInterval(function () {
        var dates = document.getElementsByClassName("mtime");
        if (!dates) return;
        for (var i = 0; i < dates.length; i++) {
            var timestamp = dates[i].getAttribute("data-timestamp");
            if (timestamp) {
                var reltime = timeDifference(timestamp);
                if (reltime) dates[i].innerHTML = reltime;
            }
        }
    }, 5000);

    function loadScript(id, url, cb) {
        if (!document.getElementById(id)) {
            var script = document.createElement("script");
            script.onload = cb;
            script.setAttribute("id", id);
            script.setAttribute("src", url);
            document.querySelector("head").appendChild(script);
        } else {
            cb();
        }
    }

    function loadTheme(theme, cb) {
        var className = theme.replace(/[^a-z]/gim, "");
        if (!$("." + className).length) {
            $.get("?!/theme/" + theme).then(function (data) {
                $('<style class="' + className + '">' + data + '</style>').appendTo("head");
                cb();
            });
        } else cb();
    }

    function showSpinner(view) {
        var spinner;
        if (!view.find(".spinner").length)
            view.find(".path").append('<div class="spinner"></div>');

        spinner = view.find(".spinner");
        if (spinner.hasClass("out")) spinner.removeClass("out");

        // HACK: Safeguard so a view won't get stuck in loading state
        if (view.data("type") === "directory") {
            clearTimeout(view[0].stuckTimeout);
            view[0].stuckTimeout = setTimeout(function () {
                sendMessage(view[0].vId, "REQUEST_UPDATE", getViewLocation(view));
            }, 2000);
        }
    }

    function hideSpinner(view) {
        var spinner = view.find(".spinner");
        if (spinner.length && !spinner.hasClass("out"))
            spinner.addClass("out");
        if (view[0].stuckTimeout) clearTimeout(view[0].stuckTimeout);
    }

    function showError(view, text) {
        var box = view.find(".info-box");
        box.find("svg").replaceWith(droppy.svg.exclamation);
        box.children("span").text(text);
        box.attr("class", "info-box error in");
        setTimeout(function () {
            box.replaceClass("in", "out");
        }, 3000);
    }

    function showLinkBox(view, link) {
        var box   = view.find(".info-box"),
            input = box.find("input");
        box.find("svg").replaceWith(droppy.svg.link);
        input
            .val(window.location.protocol + "//" + window.location.host + window.location.pathname + "?$/" +  link)
            .register("keydown", function (event) {
                if (event.keyCode === 27 || event.keyCode === 13)
                    $("#click-catcher").click();
            });
        box.attr("class", "info-box link in").end(function () {
            input[0].select();
        });
    }

    function showNotification(msg, body) {
        if (droppy.detects.notification) {
            var show = function (msg, body) {
                var opts = {icon: "?!/logo192.png"};
                if (body) opts.body = body;
                var n = new Notification(msg, opts);
                n.onshow = function () { // Compat: Chrome
                    var self = this;
                    setTimeout(function () { self.close(); }, 4000);
                };
            };
            if (Notification.permission === "granted") {
                show(msg, body);
            } else if (Notification.permission !== "denied") {
                Notification.requestPermission(function (permission) {
                    if (!("permission" in Notification)) Notification.permission = permission;
                    if (permission === "granted") show(msg, body);
                });
            }
        }
    }

    function throttle(func, threshhold) {
        if (!threshhold) threshhold = 250;
        var last, deferTimer;
        return function () {
            var now = Date.now(),
                args = arguments;
            if (last && now < last + threshhold) {
                clearTimeout(deferTimer);
                deferTimer = setTimeout(function () {
                    last = now;
                    func.apply(this, args);
                }, threshhold);
            } else {
                last = now;
                func.apply(this, args);
            }
        };
    }

    function naturalSort(a, b) {
        var x = [],
            y = [];
        function strcmp(a, b) { return a > b ? 1 : a < b ? -1 : 0; }
        a.replace(/(\d+)|(\D+)/g, function ($0, $1, $2) { x.push([$1 || 0, $2]); });
        b.replace(/(\d+)|(\D+)/g, function ($0, $1, $2) { y.push([$1 || 0, $2]); });
        while (x.length && y.length) {
            var xx = x.shift();
            var yy = y.shift();
            var nn = (xx[0] - yy[0]) || strcmp(xx[1], yy[1]);
            if (nn) return nn;
        }
        if (x.length) return -1;
        if (y.length) return +1;
        return 0;
    }

    // Get the path to droppy's root, ensuring a trailing slash
    function getRootPath() {
        var p = window.location.pathname;
        return p[p.length - 1] === "/" ? p : p + "/";
    }

    // turn /path/to/file to file
    function basename(path) {
        return path.replace(/^.*\//, "");
    }

    // turn /path/to/file to path
    function rootDir(path) {
        return path.replace(/^\//, "").replace(/\/.+$/, "");
    }

    // turn /path/to to file
    function dirname(path) {
        return path.replace(/\\/g, "/").replace(/\/[^\/]*$/, "");
    }

    // Join and clean up paths (can also take a single argument to just clean it up)
    function join() {
        var parts = [],
            newParts = [];
        for (var i = 0, l = arguments.length; i < l; i++) {
            if (typeof arguments[i] === "string") {
                parts = parts.concat(arguments[i].split("/"));
            }
        }
        for (i = 0, l = parts.length; i < l; i++) {
            if ((i === 0 && parts[i] === "") || parts[i] !== "")
                newParts.push(parts[i]);
        }
        return newParts.join("/") || "/";
    }
}(jQuery, window, document));
