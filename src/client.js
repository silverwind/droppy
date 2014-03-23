/*global CodeMirror */
/*jshint evil: true, expr: true, regexdash: true, bitwise: true, trailing: false, sub: true, eqeqeq: true,
  forin: true, freeze: true, loopfunc: true, laxcomma: true, indent: false, white: true, nonew: true, newcap: true,
  undef: true, unused: true, globalstrict: true, browser: true, quotmark: false, jquery: true, devel: true */
(function ($, window, document) {
    "use strict";
    var droppy = {};
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
//  localStorage wrapper functions
// ============================================================================
    $(function () {
        var prefs, doSave, defaults = {
            volume : 0.5,
            theme: "mdn-like",
            indentWithTabs : false,
            indentUnit : 4,
            lineWrapping: false,
            hasLoggedOut : false,
            clickAction: "download",
            renameExistingOnUpload: false
        };
        // Load prefs and set missing ones to their default
        prefs = JSON.parse(localStorage.getItem("prefs")) || {};
        for (var pref in defaults) {
            if (defaults.hasOwnProperty(pref)) {
                if (prefs[pref] === undefined) {
                    doSave = true;
                    prefs[pref] = defaults[pref];
                }
            }
        }
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
//  Set up a few more things
// ============================================================================
    // Add the dataTransfer property to the drag-and-drop events
    $.event.props.push("dataTransfer");

    // Shorthand for safe event listeners
    $.fn.register = function (events, callback) {
        return this.off(events).on(events, callback);
    };

    // Class swapping helper
    $.fn.replaceClass = function (match, replacement) {
        var classes = this[0].className.split(" "), classMatch,
            hasClass = false;
        classes = classes.filter(function (className) {
            if (className === match) return false;
            if (className === replacement) hasClass = true;

            classMatch = className.match(match);
            // filter out if the entire capture matches the entire className
            if (classMatch) return classMatch[0] !== className || classMatch[0] === replacement;
            else return true;
        });
        if (!hasClass) classes.push(replacement);
        this[0].className = classes.join(" ");
        return this;
    };

    // Set a new class on an element, and make sure it is ready to be transitioned.
    $.fn.setTransitionClass = function (oldclass, newclass) {
        if (typeof newclass === "undefined") {
            newclass = oldclass;
            oldclass = null;
        }
        if (droppy.detects.animation) {
            // Add a pseudo-animation to the element. When the "animationstart" event
            // is fired on the element, we know it is ready to be transitioned.
            this.css("animation", "nodeInserted 0.001s");

            // Set the new and oldclass as data attributes.
            if (oldclass) this.data("oldclass", oldclass);
            this.data("newclass", newclass);
        } else {
            // If we don't support animations, fallback to a simple timeout
            setTimeout(function () {
                if (oldclass) this.replaceClass(oldclass, newclass);
                else this.addClass(newclass);
            }, 30);
        }
        return this;
    };

    if (droppy.detects.animation) {
        var animStart = function (event) {
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
        };
        // Listen for the animation event for our pseudo-animation
        ["animationstart", "mozAnimationStart", "webkitAnimationStart", "MSAnimationStart"].forEach(function (eventName) {
            document.addEventListener(eventName, animStart, false);
        });
    }

    // Alias requestAnimationFrame
    var requestAnimation = (function () {
        return window.requestAnimationFrame ||
               window.mozRequestAnimationFrame ||
               window.webkitRequestAnimationFrame ||
               function (callback) { setTimeout(callback, 1000 / 60); };
    })();

    // UA check for https://bugzilla.mozilla.org/show_bug.cgi?id=878058
    if (navigator && navigator.userAgent && navigator.userAgent.toLowerCase().indexOf("firefox") > -1)
        $("html").addClass("firefox");
// ============================================================================
//  Map touch events to mouse events when necessary
// ============================================================================
    if ("ontouchstart" in document.documentElement) {
        $(function () {
            function touchHandler(event) {
                var touch = event.changedTouches[0],
                    simulatedEvent = document.createEvent("MouseEvent");
                simulatedEvent.initMouseEvent({
                    touchstart: "mousedown",
                    touchmove: "mousemove",
                    touchend: "mouseup"
                }[event.type], true, true, window, 1,
                    touch.screenX, touch.screenY,
                    touch.clientX, touch.clientY, false,
                    false, false, false, 0, null);
                touch.target.dispatchEvent(simulatedEvent);
                event.preventDefault();
            }
            document.addEventListener("touchstart", touchHandler, true);
            document.addEventListener("touchmove", touchHandler, true);
            document.addEventListener("touchend", touchHandler, true);
            document.addEventListener("touchcancel", touchHandler, true);
        });
    }
// ============================================================================
//  View handling
// ============================================================================
    function getView(id) {
        if (id) {
            return $(droppy.views[id]);
        } else {
            var view;
            droppy.views.every(function (el) { // get first element not undefined
                view = el;
            });
            return $(view);
        }
    }

    function newView(dest, vId) {
        var view = $("<div class=\"view\">" +
                        "<ul class=\"path\"></ul>" +
                        "<div class=\"content\"></div>" +
                        "<div class=\"dropzone\">" + droppy.svg["up-arrow"] + "</div>" +
                    "</div>");
        destroyView(vId);
        view.appendTo("#view-container");
        view[0].vId = vId;
        view[0].currentFolder = "/";
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
    // Load both the content for the site and svg data, and continue loading once both requests finish
    $(getPage);

    function getPage() {
        $.when($.ajax("/!/content/" + Math.random().toString(36).substr(2, 4)), $.ajax("/!/svg")).then(function (dataReq, svgReq) {
            droppy.svg = JSON.parse(svgReq[0]);
            loadPage(dataReq[2].getResponseHeader("X-Page-Type"), prepareSVG(dataReq[0]));
        });
    }
    // Switch the page content with an animation
    function loadPage(type, data) {
        $("body").append('<div id="newpage">' + data + '</div>');
        var newPage = $("#newpage"), oldPage = $("#page");
        if (type === "main") {
            initMainPage();
            initEntryMenu();
            requestAnimation(function () {
                oldPage.replaceClass("in", "out");
                if (droppy.socketWait) showSpinner();
                finalize();
            });
        } else if (type === "auth" || type === "firstrun") {
            initAuthPage(type === "firstrun");
            requestAnimation(function () {
                oldPage.replaceClass("in", "out");
                $("#center-box").removeClass("out");
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

    function requestPage(reload) {
        // This page reload on login should be removed at some point in the future, it's here for these reasons:
        //  - Chrome won't offer password saving without it
        //  - There's a bug with the view not getting properly re-initialized after a logout/login, this works around it
        if (reload)
            window.location.reload(false);
        else
            getPage();
    }

// ============================================================================
//  WebSocket functions
// ============================================================================
    var retries = 5, retryTimeout = 4000;
    function openSocket() {
        var protocol = document.location.protocol === "https:" ? "wss://" : "ws://";
        droppy.socket = new WebSocket(protocol + document.location.host + "/websocket");
        droppy.socket.onopen = function () {
            retries = 5; // reset retries on connection loss
            // Request settings when droppy.debug is uninitialized, could use another variable too.
            if (droppy.debug === null) droppy.socket.send(JSON.stringify({type: "REQUEST_SETTINGS"}));
            if (droppy.queuedData)
                sendMessage();
            else {
                // Create new view with initiallizing
                newView(normalizePath(decodeURIComponent(window.location.pathname)), 0);
                if (window.location.hash.length)
                    droppy.split(normalizePath(decodeURIComponent(window.location.hash.slice(1))));
            }
        };

        // Close codes: https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent#Close_codes
        droppy.socket.onclose = function (event) {
            if (droppy.get("hasLoggedOut") || event.code === 4000) return;
            if (event.code >= 1002 && event.code < 3999) {
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
            if (event.data === "ping") // respond to server keepAlive
                return droppy.socket.send("pong");
            else
                droppy.socketWait = false;
            var msg = JSON.parse(event.data),
                vId = msg.vId,
                view;
            switch (msg.type) {
            case "UPDATE_DIRECTORY":
                view = getView(vId);
                if ((!view || view[0].isUploading) && !view[0].switchRequest) return;
                view[0].switchRequest = false;
                if (msg.sizes) {
                    addSizes(view, msg.folder, msg.data);
                } else {
                    showSpinner(view);
                    if ((msg.folder !== getViewLocation(view)) || !view[0].loaded) {
                        view[0].loaded === true; // Ensure to update path on the first load
                        if (view[0].vId === 0)
                            updateTitle(msg.folder, true);
                        view[0].currentFile = null;
                        view[0].currentFolder = msg.folder;
                        updatePath(view);
                    }
                    view[0].currentData = msg.data;
                    view.attr("data-type", "directory");
                    openDirectory(view);
                }
                break;
            case "UPDATE_BE_FILE":
                view = getView(vId);
                view[0].currentFolder = msg.folder;
                view[0].currentFile = msg.file;
                updatePath(view);
                openFile(view);
                break;
            case "UPLOAD_DONE":
                view = getView(vId);
                if (droppy.zeroFiles.length) {
                    sendMessage(vId, "ZERO_FILES", droppy.zeroFiles);
                    droppy.zeroFiles = [];
                } else {
                    view[0].isUploading = false;
                    updateTitle(getView(vId)[0].currentFolder, true);
                    view.find(".upload-info").setTransitionClass("in", "out");
                    view.find(".data-row.uploading").removeClass("uploading");
                    setTimeout(function () {
                        view.find(".upload-bar-inner").removeAttr("style");
                    }, 200);
                    view.find(".icon-uploading").remove();
                    hideSpinner(view);
                }
                break;
            case "UPDATE_CSS":
                reloadCSS(msg.css);
                break;
            case "SHORTLINK":
                var box = $("#info-box");
                box.attr("class", "info in");
                box.children("h1").text("Shortlink");
                box.children("span").text(window.location.protocol + "//" + window.location.host + "/$/" +  msg.link);
                toggleCatcher();
                // Select the span for to user to copy
                box.children("span").on("click", function () {
                    var selection = window.getSelection(),
                    range = document.createRange();
                    range.selectNodeContents(box.children("span")[0]);
                    selection.removeAllRanges();
                    selection.addRange(range);
                });
                break;
            case "USER_LIST":
                if (!$("#options-box").hasClass("in"))
                    showOptions(msg.users);
                else
                    updateUsers(msg.users);
                break;
            case "SAVE_STATUS":
                view = getView(vId);
                hideSpinner(view);
                view.find(".path li:last-child").removeClass("dirty").addClass(msg.status === 0 ? "saved" : "save-failed"); // TODO: Change to be view-relative
                setTimeout(function () { view.find(".path li:last-child").removeClass("saved save-failed"); }, 1000); // TODO: Change to be view-relative
                break;
            case "SETTINGS":
                droppy.debug = msg.settings.debug;
                droppy.demoMode = msg.settings.demoMode;
                droppy.noLogin = msg.settings.noLogin;
                if (droppy.demoMode || droppy.noLogin)
                    $("#logout-button").addClass("disabled").attr("title", "Signing out is disabled.");
                else
                    $("#logout-button").register("click", function () {
                        if (droppy.socket) droppy.socket.close(4001);
                        deleteCookie("session");
                        initVariables(); // Reset vars to their init state
                        droppy.set("hasLoggedOut", true);
                        requestPage();
                    });
                break;
            case "ERROR":
                var box = $("#info-box");
                box.attr("class", "error in");
                box.children("h1").text("Error");
                box.children("span").text(msg.text);
                setTimeout(function () {
                    box.removeAttr("class");
                }, 4000);
                hideSpinner(getView(vId));
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
                form.submit();
            }
        });

        // Spacebar toggles the checkbox
        $("#remember").register("keyup", function (event) {
            if (event.keyCode === 32) {
                $("#remember > input").trigger("click");
            }
        });

        submit.register("click", function () { form.submit(); });
        form.register("submit", function () {
            $.ajax({
                type: "POST",
                url: (firstrun ? "/adduser" : "/login"),
                dataType: "json",
                data: form.serialize(),
                complete: function (response) {
                    if (response.status  === 202) {
                        requestPage(true);
                    } else if (response.status === 401) {
                        submit.addClass("invalid");
                        loginform.addClass("invalid");
                        $("#login-info").text(firstrun ? "Please fill both fields." : "Wrong login!");
                        if (!firstrun) $("#pass").val("").focus();
                        if ($("#login-info-box").hasClass("error")) {
                            $("#login-info").addClass("shake");
                            setTimeout(function () {
                                $("#login-info").removeClass("shake");
                            }, 500);
                        }
                        $("#login-info-box").attr("class", "error");
                    }
                },
            });
        });
    }
// ============================================================================
//  Main page
// ============================================================================
    function initMainPage() {
        // Open the WebSocket
        openSocket();

        // Re-fit path line after 100ms of no resizing
        var resizeTimeout;
        $(window).register("resize", function () {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(function () {
                $(".view").each(function () {
                    checkPathOverflow($(this));
                });
            }, 100);
        });

        var fileInput = $("#file");
        fileInput.register("change", function (event) {
            if (droppy.detects.fileinputdirectory && event.target.files.length > 0 && "webkitRelativePath" in event.target.files[0]) {
                var files = event.target.files;
                var obj = {};
                for (var i = 0; i < files.length; i++) {
                    var path = files[i].webkitRelativePath, name = files[i].name;
                    if (path) {
                        if (name === ".")
                            obj[path] = {};
                        else
                            obj[path] = files[i];
                    } else {
                        obj[files[i].name] = files[i];
                    }
                }
                upload(getView(), obj); // TODO: view relative
            } else if ($("#file").val()) {
                upload(getView(), $("#file").get(0).files);
            }
            $("#file").val(""); // Reset the input
        });

        // File upload button
        $("#upload-file-button").register("click", function () {
            // Remove the directory attributes so we get a file picker dialog!
            if (droppy.detects.fileinputdirectory)
                $("#file").removeAttr("directory msdirectory mozdirectory webkitdirectory");
            $("#file").click();
        });

        // Folder upload button - check if we support directory uploads
        if (droppy.detects.fileinputdirectory) {
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
            $("#upload-folder-button")
                .addClass("disabled")
                .attr("title", "Sorry, your browser doesn't support directory uploading yet!");
        }

        $("#create-folder-button").register("click", function () {
            var dummyFolder, wasEmpty,
                view = getView(), // TODO: Create folder in last active view
                dummyHtml = '<li class="data-row new-folder" data-type="folder">' +
                                '<span class="sprite sprite-folder-open"></span>' +
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

        $("#split-button").register("click", function () { split(); });

        var split = droppy.split = function (dest) {
            var first, second, button;
            button = $("#split-button");
            button.off("click");
            first = getView(0);
            if (droppy.views.length === 1) {
                first.addClass("left");
                if (typeof dest !== "string")
                    if (first[0].currentFile)
                        dest = fixRootPath(first[0].currentFolder + "/" + first[0].currentFile);
                    else
                        dest = fixRootPath(first[0].currentFolder);
                second = newView(dest, 1).addClass("right");
                button.children(".button-text").text("Merge");
                button.attr("title", "Merge views back into a single one");
            } else {
                destroyView(1);
                window.history.replaceState(null, null, first[0].currentFolder); // removes the hash
                getView(0).removeClass("left");
                button.children(".button-text").text("Split");
                button.attr("title", "Split the view in half");
            }
            first.one("transitionend webkitTransitionEnd msTransitionEnd", function (event) {
                button.register("click", split);
                event.stopPropagation();
            });
        };

        $("#about-button").register("click", function () {
            requestAnimation(function () {
                $("#about-box").attr("class", $("#about-box").attr("class") !== "in" ? "in" : "out");
                toggleCatcher();
            });
        });

        $("#options-button").register("click", function () {
            sendMessage(null, "GET_USERS");
        });

        // Hide modals when clicking outside their box
        $("#click-catcher").register("click", function () {
            $("#options-box").replaceClass("in", "out");
            $("#about-box").replaceClass("in", "out");
            $("#entry-menu").replaceClass("in", "out");
            $("#info-box").removeAttr("class");
            toggleCatcher();
        });

        // ============================================================================
        //  Audio functions / events
        // ============================================================================

        var slider     = $("#volume-slider"),
            volumeIcon = $("#volume-icon"),
            controls   = $("#audio-controls"),
            seekbar    = $("#seekbar"),
            level      = $("#volume-level"),
            tooltip    = $("#tooltip"),
            player     = $("#audio-player")[0];

        volumeIcon.register("click", function () {
            slider.attr("class", slider.attr("class") === "" ? "in" : "");
            level.attr("class", level.attr("class") === "" ? "in" : "");
        });

        seekbar.register("click", function (event) {
            player.currentTime = player.duration * (event.clientX / window.innerWidth);
        });

        seekbar.register("mousemove", debounce(function (event) {
            if (!player.duration) return;
            var left = event.clientX;
            tooltip.css("bottom", ($(window).height() - seekbar[0].getBoundingClientRect().top + 8) + "px");
            tooltip.css("left", (left - tooltip.width() / 2 - 3), + "px");
            tooltip.attr("class", "in");
            tooltip.text(secsToTime(player.duration * (event.clientX / window.innerWidth)));
        }), 50);

        seekbar.register("mouseleave", debounce(function () {
            tooltip.removeAttr("class");
        }), 50);

        function onWheel(event) {
            setVolume(event.wheelDelta || -event.detail);
            slider.attr("class", "in");
            level.attr("class", "in");
        }

        volumeIcon[0].addEventListener("mousewheel", onWheel, false);
        volumeIcon[0].addEventListener("DOMMouseScroll", onWheel, false);
        slider[0].addEventListener("mousewheel", onWheel, false);
        slider[0].addEventListener("DOMMouseScroll", onWheel, false);

        player.volume = droppy.get("volume");
        slider.val(player.volume * 100);

        var volumeTimeout;
        function setVolume(delta) {
            clearTimeout(volumeTimeout);
            volumeTimeout = setTimeout(function () {
                slider.attr("class", "");
                level.attr("class", "");
            }, 2000);
            var volume = player.volume;
            if (typeof delta === "number") {
                if (delta > 0) {
                    volume += 0.05;
                    if (volume > 1) volume = 1;
                } else {
                    volume -= 0.05;
                    if (volume < 0) volume = 0;
                }
            } else {
                volume = slider.val() / 100;
            }

            player.volume = volume;
            droppy.set("volume", volume);
            slider.val(volume * 100);
            level.text(Math.round(volume * 100) + "%");

            if (player.volume === 0) volumeIcon.html(droppy.svg["volume-mute"]);
            else if (player.volume <= 0.33) volumeIcon.html(droppy.svg["volume-low"]);
            else if (player.volume <= 0.67) volumeIcon.html(droppy.svg["volume-medium"]);
            else volumeIcon.html(droppy.svg["volume-high"]);
        }

        slider.register("input", setVolume);
        setVolume();

        var played = $("#seekbar-played"),
            loaded = $("#seekbar-loaded"),
            fullyLoaded;

        function updater() {
            var cur  = player.currentTime,
                max  = player.duration;

            if (player.buffered && !fullyLoaded) {
                var loadProgress = player.buffered.end(0) / max * 100;
                loaded.css("width", loadProgress  + "%");
                if (loadProgress === 100) fullyLoaded = true;
            }

            if (!cur || !max) return;
            played.css("width", (cur  / max * 100)  + "%");
            $("#time-cur").text(secsToTime(cur));
            $("#time-max").text(secsToTime(max));
        }

        function playing() {
            var matches = $(player).attr("src").match(/(.+)\/(.+)\./);
            droppy.isPlaying = true;
            updateTitle(getView()[0].currentFolder, true);
            $("#audio-title").text(matches[matches.length - 1].replace(/_/g, " ").replace(/\s+/, " "));
            controls.attr("class", "in");
            fullyLoaded = false;
            droppy.audioUpdater = setInterval(updater, 100);
        }

        function stop(event) {
            if (event.type === "ended") {
                var next = $(".playing").next();
                preparePlayback($((next.length) ? next.find(".icon-play") : $(".content ul").find(".icon-play").first()));
            }
            $("#audio-title").html("");
            if (droppy.audioUpdater) {
                clearInterval(droppy.audioUpdater);
                droppy.audioUpdater = null;
            }
            droppy.isPlaying = false;
            updateTitle(getView()[0].currentFolder, true);
            setTimeout(function () {
                if (!droppy.isPlaying) {
                    controls.attr("class", "out");
                }
            }, 500);
        }

        // Playback events : http://www.w3.org/wiki/HTML/Elements/audio#Media_Events
        player.addEventListener("pause", stop);
        player.addEventListener("ended", stop);
        player.addEventListener("playing", playing);
    }
    // ============================================================================
    //  Upload functions
    // ============================================================================
    var numFiles, formLength;
    function upload(view, data) {
        var formData = new FormData();

        droppy.zeroFiles = [];
        numFiles = 0;
        formLength = 0;
        if (!data) return;
        if (Object.prototype.toString.call(data) !== "[object Object]") { // We got a FileList
            if (data.length === 0) return;
            for (var i = 0, len = data.length; i < len; i++) {
                var filename = encodeURIComponent(data[i].name);
                numFiles++;
                getView()[0].currentData[filename] = {
                    size  : data[i].size,
                    type  : "nf",
                    mtime : Date.now()
                };
                // Don't include Zero-Byte files as uploads will freeze in IE if we attempt to upload them
                // https://github.com/silverwind/droppy/issues/10
                if (data[i].size === 0) {
                    droppy.zeroFiles.push((view[0].currentFolder === "/") ? "/" + filename : view[0].currentFolder + "/" + filename);
                } else {
                    formLength++;
                    formData.append(filename, data[i], filename);
                }
            }
        } else { // We got an object for recursive folder uploads
            var addedDirs = {};
            for (var path in data) {
                if (data.hasOwnProperty(path)) {
                    formLength++;
                    formData.append(path, data[path], encodeURIComponent(path));
                    var name = (path.indexOf("/") > 1) ? path.substring(0, path.indexOf("/")) : path;
                    switch (Object.prototype.toString.call(data[path])) {
                    case "[object Object]":
                        if (!addedDirs[name] && data.hasOwnProperty(path)) {
                            view[0].currentData[name] = {
                                size : 0,
                                type : "nd",
                                mtime : Date.now()
                            };
                            addedDirs[name] = true;
                        }
                        break;
                    case "[object File]":
                        numFiles++;
                        if (!addedDirs[name]) {
                            view[0].currentData[name] = {
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

        // Load the new files into view
        openDirectory(view, true);

        // Create the XHR2 and bind the progress events
        var xhr = new XMLHttpRequest();
        xhr.upload.addEventListener("progress", function (event) { uploadProgress(view, event); }, false);
        xhr.upload.addEventListener("load", function () { uploadDone(view); }, false);
        xhr.upload.addEventListener("error", function () { uploadDone(view); }, false);

        // Init the UI
        uploadInit(view, numFiles);
        $(".upload-cancel").register("click", function () {
            xhr.abort();
            uploadCancel(view);
        });

        // And send the files
        view[0].isUploading = true;

        if (formLength) {
            xhr.open("POST", "/upload?" + $.param({
                vId : view[0].vId,
                to  : encodeURIComponent(view[0].currentFolder),
                r   : droppy.get("renameExistingOnUpload")
            }));
            xhr.send(formData);
        } else if (droppy.zeroFiles.length) {
            sendMessage(view[0].vId, "ZERO_FILES", droppy.zeroFiles);
        }
    }
    var start, lastUpdate;
    function uploadInit(view, numFiles) {
        var uploadInfo = '<section class="upload-info out">' +
                '<div class="upload-bar">' +
                    '<div class="upload-bar-inner"></div>' +
                '</div>' +
                '<span class="upload-status">' +
                    '<span class="upload-title"></span>' +
                    '<span class="upload-speed"></span>' +
                '</span>' +
                '<span class="upload-time">' +
                    droppy.svg.time +
                    '<span class="upload-time-left"></span>' +
                    '</span>' +
                '<span class="upload-cancel">' +
                    droppy.svg.remove +
                    '<span>Cancel Upload<span>' +
                '</span>' +
            '</section>';

        start = Date.now();
        if (!view.find(".upload-info").length) view.append(uploadInfo);
        view.find(".upload-info").setTransitionClass("out", "in");
        view.find(".upload-title").text("Uploading " + numFiles + " file" + (numFiles > 1 ? "s" : ""));
        view.find(".upload-bar-inner").css("width", "0%");
        view.find(".upload-time-left").text("");
        view.find(".upload-speed").text("");
        updateTitle("0%");
    }

    function uploadDone(view) {
        view.find(".upload-bar-inner").css("width", "100%");
        view.find(".upload-title").text("Processing...");
    }

    function uploadCancel(view) {
        view.find(".upload-bar-inner").css("width", "0");
        view.find(".upload-title").text("Aborting...");
        $(".uploading").remove(); // Remove preview elements
    }

    function uploadProgress(view, event) {
        if (!event.lengthComputable) return;

        // Update progress every 250ms at most
        if (!lastUpdate || (Date.now() - lastUpdate) >= 250) {
            var bytesSent  = event.loaded,
                bytesTotal = event.total,
                progress   = Math.round((bytesSent / bytesTotal) * 100) + "%",
                speed      = convertToSI(bytesSent / ((Date.now() - start) / 1000), 2),
                elapsed, secs;

            updateTitle(progress);
            view.find(".upload-bar-inner").css("width", progress);
            view.find(".upload-speed").text(speed.size + " " + speed.unit + "/s");

            // Calculate estimated time left
            elapsed = Date.now() - start;
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
            droppy.activeFiles.push($(this).text().toLowerCase());
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
            exists = false;
            for (var i = 0, len = droppy.activeFiles.length; i < len; i++)
                if (droppy.activeFiles[i] === inputText.toLowerCase()) { exists = true; break; }
            canSubmit = valid && (!exists || inputText === namer.attr("placeholder"));
            // TODO: Better indicator of what's wrong
            if (!canSubmit)
                entry.addClass("invalid");
            else
                entry.removeClass("invalid");
        }).register("keyup", function (event) {
            if (event.keyCode === 27) stopEdit(view); // Escape Key
            if (event.keyCode === 13) submitEdit(view, false, callback); // Return Key
        }).register("focusout", function () {
            submitEdit(view, true, callback);
        });

        nameLength = link.text().lastIndexOf(".");
        namer[0].setSelectionRange(0, nameLength > -1 ? nameLength : link.text().length);
        namer[0].focus();

        function submitEdit(view, skipInvalid, callback) {
            var oldVal = namer.attr("placeholder"),
                newVal = namer.val(),
                success;
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
                var oldPath = view[0].currentFolder === "/" ? "/" + oldVal : view[0].currentFolder + "/" + oldVal,
                    newPath = view[0].currentFolder === "/" ? "/" + newVal : view[0].currentFolder + "/" + newVal;
                callback(success, oldPath, newPath);
            }

        }
        function stopEdit(view) {
            view.find(".inline-namer").remove();
            view.find(".data-row.new-folder").remove();
            entry.removeClass("editing invalid");
            if (wasEmpty) loadContent(view);
        }
    }

    // Toggle the full-screen click catching frame if any modals are shown
    function toggleCatcher() {
        if ($("#about-box").hasClass("in") ||
            $("#options-box").hasClass("in") ||
            $("#info-box").hasClass("in") ||
            $("#entry-menu").hasClass("in")
        ) {
            $("#click-catcher").attr("class", "in");
        } else
            $("#click-catcher").attr("class", "out");
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
        if (droppy.isPlaying) prefix = "\u266B " + prefix; // Unicode audio note to indicate playback in a tab
        document.title = [prefix, suffix].join(" - ");
    }

    // Listen for popstate events, which indicate the user navigated back
    $(window).register("popstate", function () {
        // In recent Chromium builds, this can fire on first page-load, before we even have our socket connected.
        if (!droppy.socket) return;
        updateLocation(null, [decodeURIComponent(window.location.pathname), decodeURIComponent(window.location.hash.slice(1))], true);
    });

    function getViewLocation(view) {
        if (view[0].currentFolder === undefined)
            return ""; // return an empty string so animDirection gets always set to 'forward' on launch
        else
            return fixRootPath(view[0].currentFolder + (view[0].currentFile ? "/" + view[0].currentFile : ""));
    }

    // Update our current location and change the URL to it
    function updateLocation(view, destination, skipPush) {
        if (typeof destination.length !== "number") throw "Destination needs to be string or array";
        // Queue the folder switching if we are mid-animation or waiting for the server
        function sendReq(view, viewDest, time) {
            (function queue(time) {
                if ((!droppy.socketWait && !view[0].isAnimating) || time > 2000) {
                    showSpinner(view);
                    var viewLoc = getViewLocation(view);
                    // Find the direction in which we should animate
                    if (viewDest.length > viewLoc.length) view[0].animDirection = "forward";
                    else if (viewDest.length === viewLoc.length) view[0].animDirection = "center";
                    else view[0].animDirection = "back";
                    sendMessage(view[0].vId, "REQUEST_UPDATE", viewDest);

                    // Skip the push if we're already navigating through history
                    if (!skipPush) {
                        var newDest;
                        if (view[0].vId === 0) newDest = viewDest + window.location.hash;
                        else newDest = window.location.pathname + "#" + viewDest;
                        window.history.pushState(null, null, newDest);
                    }
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
        var parts, oldParts, pathStr = "", i = 0, len;
        parts = normalizePath(fixRootPath(view[0].currentFolder)).split("/");
        if (parts[parts.length - 1] === "") parts.pop();
        if (view[0].currentFile !== null) parts.push(view[0].currentFile);
        parts[0] = droppy.svg.home; // Replace empty string with our home icon
        if (view[0].savedParts) {
            i = 1; // Skip the first element as it's always the same
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
                        $(view.find(".path li")[i]).html(parts[i] + droppy.svg.triangle);
                    }
                }
                i++;
            }
            finalize();
        } else {
            addPart(parts[0], "/");
            for (i = 1, len = parts.length; i < len; i++) {
                pathStr += "/" + parts[i];
                addPart(parts[i], pathStr);
            }
            finalize();
        }

        view[0].savedParts = parts;

        function addPart(name, path) {
            var li = $("<li class='out'>" + name + "</li>");
            li.data("destination", path);
            li.click(function (event) {
                if (droppy.socketWait) return;
                var view = $(event.target).parents(".view");
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
            toRemove.setTransitionClass("in", "out gone");
            toRemove.one("transitionend webkitTransitionEnd msTransitionEnd", function (event) {
                $(event.target).remove();
            });
        }

        function finalize() {
            view.find(".path li.out:not(.gone)").setTransitionClass("out", "in");
            setTimeout(function () {checkPathOverflow(view); }, 400);
        }
    }

    // Check if the path indicator overflows and scroll it if neccessary
    function checkPathOverflow(view) {
        var width = 40,
            space = view.width(),
            pathElements = view.find(".path li.in");

        for (var i = 0, l = pathElements.length; i < l; i++) {
            width += pathElements[i].offsetWidth;
        }

        if (width > space) {
            view.find(".path li").animate({"left": space - width + "px"}, {duration: 200});
        } else {
            view.find(".path li").animate({"left": 0}, {duration: 200});
        }
    }

    // Convert the received data into HTML
    function openDirectory(view, isUpload) {
        var downloadURL, type, temp, size, sizeUnit, mtime, id, classes, svgIcon, bytes,
            folder = view[0].currentFolder,
            fileList = view[0].currentData,
            list = $("<ul></ul>");

        for (var file in fileList) {
            if (fileList.hasOwnProperty(file)) {
                svgIcon = "", classes = "";
                type = fileList[file].type;
                bytes = fileList[file].size;
                if (!bytes && droppy.sizeCache[folder] && droppy.sizeCache[folder][file])
                    bytes = droppy.sizeCache[folder][file];
                temp = convertToSI(bytes);
                size = temp.size > 0 ? temp.size : "0";
                sizeUnit = temp.size > 0 ? temp.unit : "b";
                mtime = fileList[file].mtime;
                id = (folder === "/") ? "/" + file : folder + "/" + file;
                if (type === "nf" || type === "nd") {
                    svgIcon = '<span class="icon-uploading">' + droppy.svg["up-arrow"] + '</span>';
                    classes += " uploading";
                } else if (/^.+\.(mp3|ogg|wav|wave|webm)$/i.test(file)) {
                    svgIcon = '<span class="icon-play">' + droppy.svg.play + '</span>';
                    classes += " playable";
                }
                if (type === "f" || type === "nf") { // Create a file row
                    var ext = getExt(file), spriteClass = getSpriteClass(ext);
                    downloadURL = "/~" + id;
                    if (!droppy.mediaTypes[ext]) droppy.mediaTypes[ext] = fileList[file].mime;
                    if (isUpload) file = decodeURIComponent(file);
                    list.append(
                        '<li class="data-row' + classes + '" data-type="file" data-id="' + id + '">' +
                            '<span class="' + spriteClass + '">' + svgIcon + '</span>' +
                            '<a class="file-link entry-link" href="' + downloadURL + '" download="' + file + '">' + file + '</a>' +
                            '<span class="mtime" data-timestamp="' + mtime + '">' + timeDifference(mtime) + '</span>' +
                            '<span class="size" data-size="' + (bytes || 0) + '">' + size + '</span>' +
                            '<span class="size-unit">' + sizeUnit + '</span>' +
                            '<span class="shortlink" title="Create Shortlink">' + droppy.svg.link + '</span>' +
                            '<span class="entry-menu" title="Actions">' + droppy.svg.menu + '</span>' +
                        '</li>'
                    );
                } else if (type === "d" || type === "nd") {  // Create a folder row
                    if (isUpload) file = decodeURIComponent(file);
                    list.append(
                        '<li class="data-row' + classes + '" data-type="folder" data-id="' + id + '">' +
                            '<span class="sprite sprite-folder">' + svgIcon + '</span>' +
                            '<a class="folder-link entry-link">' + file + '</a>' +
                            '<span class="mtime" data-timestamp="' + mtime + '">' + timeDifference(mtime) + '</span>' +
                            '<span class="size" data-size="' + (bytes || "") + '">' + size + '</span>' +
                            '<span class="size-unit">' + sizeUnit + '</span>' +
                            '<span><a class="zip" title="Create Zip" href="/~~' + id + '" download="' + file + '.zip">' + droppy.svg.zip + '</a></span>' +
                            '<span class="entry-menu" title="Actions">' + droppy.svg.menu + '</span>' +
                        '</li>'
                    );
                }
            }
        }
        list.children("li").sort(sortFunc).appendTo(list);
        var content = contentWrap(view).html(
            '<div class="paste-button ' + (droppy.clipboard ? "in" : "out") + '">' + droppy.svg.paste +
                '<span>Paste <span class="filename">' + (droppy.clipboard ? basename(droppy.clipboard.from) : "") + '</span> here</span>' +
            '</div>');
        if (list.children("li").length)
            content.append(list.prepend(getHeaderHTML()));
        else
            content.append('<div class="empty">' + droppy.svg["upload-cloud"] + '<div class="text">Add files</div></div>');
        loadContent(view, content);
        // Upload button on empty page
        content.find(".empty").register("click", function () {
            if (droppy.detects.fileinputdirectory)
                $("#file").removeAttr("directory msdirectory mozdirectory webkitdirectory");
            $("#file").click();
        });
        // Switch into a folder
        content.find(".data-row[data-type='folder']").register("click", function (event) {
            event.preventDefault();
            if (droppy.socketWait) return;
            var destination = $(this).data("id");
            updateLocation(view, destination);
        });

        content.find(".data-row .entry-menu").register("click", function (event) {
            event.stopPropagation();
            var entry = $(this).parent("li.data-row"),
                type = entry.find(".sprite").attr("class"),
                button = $(this);

            type = type.match(/sprite\-(\w+)/);
            if (type) type = type[1];

            // Show a download entry when the click action is not download
            if (droppy.get("clickAction") !== "download" && entry.attr("data-type") === "file") {
                type = "download";
                $("#entry-menu").find(".download").attr("download", entry.children(".file-link").attr("download"));
                $("#entry-menu").find(".download").attr("href", entry.children(".file-link").attr("href"));
            }

            $("#entry-menu")
                .attr("class", "in")
                .css("left", (button.offset().left + button.width() - $("#entry-menu").width()) + "px")
                .data("target", entry)
                .addClass("type-" + type);

            var menuMaxTop = $(document).height() - $("#entry-menu").height(),
                menuTop = entry.offset().top;
            if (menuTop > menuMaxTop) menuTop = menuMaxTop;
            $("#entry-menu").css("top", menuTop + "px");
            toggleCatcher();

            $("#click-catcher").one("mousemove", function () {
                $("#entry-menu").attr("class", "out");
                toggleCatcher();
            });
        });
        // Paste a file/folder into a folder
        content.find(".paste-button").register("click", function (event) {
            event.stopPropagation();
            if (droppy.socketWait) return;
            if (droppy.clipboard) {
                showSpinner(view);
                droppy.clipboard.to = fixRootPath(view[0].currentFolder + "/" + basename(droppy.clipboard.from));
                sendMessage(view[0].vId, "CLIPBOARD", droppy.clipboard);
            } else {
                throw "Clipboard was empty!";
            }

            droppy.clipboard = null;
            $("#click-catcher").trigger("click");
            $(this).replaceClass("in", "out");
        });
        // Stop navigation when clicking on an <a>
        content.find(".data-row .zip, .entry-link.file").register("click", function (event) {
            event.stopPropagation();
            if (droppy.socketWait) return;

            // Some browsers (like IE) think that clicking on an <a> is real navigation
            // and will close the WebSocket in turn. We'll reconnect if neccessary.
            droppy.reopen = true;
            setTimeout(function () {
                droppy.reopen = false;
            }, 2000);
        });
        // Request a shortlink
        content.find(".data-row .shortlink").register("click", function () {
            if (droppy.socketWait) return;
            sendMessage(null, "REQUEST_SHORTLINK", $(this).parent(".data-row").data("id"));
        });
        content.find(".icon-play").register("click", function () {
            preparePlayback($(this));
        });
        content.find(".header-name, .header-mtime, .header-size").register("click", function () {
            sortByHeader(view, $(this));
        });
        setClickAction();
        hideSpinner(view);
    }

    // Load generated list into view with an animation
    function loadContent(view, content) {
        var type = view.attr("data-type"),
            navRegex = /(forward|back|center)/;
        if (view[0].animDirection === "center" && type !== "document") {
            view.find(".content").replaceClass(navRegex, "center");
            view.find(".content").before(content);
            view.find(".new").attr("data-root", view[0].currentFolder);
            view.find(".new").addClass(type);
            finish();
        } else {
            view.append(content);
            view.find(".new").attr("data-root", view[0].currentFolder);
            view[0].isAnimating = true;
            view.find(".data-row").addClass("animating");
            view.find(".content").replaceClass(navRegex, (view[0].animDirection === "forward") ? "back" : (view[0].animDirection === "back") ? "forward" : "center");
            view.find(".new").setTransitionClass(navRegex, "center");
            view.find(".new").addClass(type); // Add view type class for styling purposes
            view.find(".new").one("transitionend webkitTransitionEnd msTransitionEnd", function (event) {
                if ($(event.originalEvent.target).hasClass("new"))
                    finish();
            });
        }
        view[0].animDirection = "center";

        function finish() {
            view[0].isAnimating = false;
            view.find(".content").each(function () {
                if (!$(this).hasClass("new")) $(this).remove();
            });
            view.find(".new").removeClass("new");
            view.find(".data-row").removeClass("animating");
            if ($(view).attr("data-type") === "directory") {
                bindDragEvents(view);
                bindHoverEvents(view);
                bindDropEvents(view);
            } else if ($(view).attr("data-type") === "document" || $(view).attr("data-type") === "image") {
                bindDropEvents(view);
            }
        }
    }

    function sendDropData(view, event, from, to, spinner) {
        var type = (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) ? "copy" : "cut",
        clip = { type: type, from: from, to  : to };
        if (clip.from !== clip.to || clip.type === "copy") {
            if (spinner) showSpinner(view);
            sendMessage(view[0].vId, "CLIPBOARD", clip);
        }
    }

    // Set drag properties for internal drag sources
    function bindDragEvents(view) {
        view.find(".data-row").each(function () {
            var row = $(this);
            row.attr("draggable", "true");
            row.parents(".view").register("dragstart", function (event) {
                var src = $(event.target).parents(".data-row").data("id") || $(event.target).data("id"),
                    img = $(event.target).siblings(".sprite")[0] || $(event.target).children(".sprite")[0];
                event.dataTransfer.setData("text", src);
                event.dataTransfer.effectAllowed = "copyMove";
                if ("setDragImage" in event.dataTransfer)
                    event.dataTransfer.setDragImage(img, 0, 0);
            });
        });
    }

    // Hover evenets for upload arrows
    function bindHoverEvents(view) {
        view.find(".data-row").each(function () {
            var row = $(this);
            bindHover(row.children("a"), false, function (el, event, enter) {
                if (!enter) return el.removeClass("drop-hover");
                if (event.dataTransfer.effectAllowed === "copyMove") { // internal source
                    event.stopPropagation();
                    if (enter && el.parents(".data-row").attr("data-type") === "folder") {
                        el.addClass("drop-hover");
                        el.parents(".view").find(".dropzone").replaceClass("in", "out");
                    } else {
                        el.parents(".view").find(".dropzone").replaceClass("out", "in");
                    }
                }
            }, true);
        });
        bindHover(view, false, function (el, event, enter) {
            el.find(".dropzone").replaceClass(enter ? "out" : "in", enter ? "in" : "out");
        });
    }

    // Bind hover events to an element
    function bindHover(el, stopProp, callback) {
        var isHovering, endTimer;
        function enter(event) {
            event.preventDefault(); // Allow the event
            if (stopProp) event.stopPropagation(); // Optionally stop bubbling
            clearTimeout(endTimer);
            if (!isHovering) {
                isHovering = true;
                callback(el, event, true);
            }
        }
        function leave(event) {
            if (stopProp) event.stopPropagation();
            clearTimeout(endTimer);
            endTimer = setTimeout(end, 50);
        }
        function end(event) {
            isHovering = false;
            callback(el, event, false);
        }
        el.register("dragenter dragover", enter);
        el.register("dragleave dragend", leave);
    }

    function bindDropEvents(view) {
        $(".data-row").each(function () {
            var row = $(this);
            if (row.attr("data-type") === "folder") {
                row.children("a").register("drop", function (event) {
                    $(event.target).removeClass("drop-hover");
                    var from = event.dataTransfer.getData("text"),
                        to = $(event.target).attr("data-id") || $(event.target).parents(".data-row").attr("data-id");

                    to = fixRootPath(to + "/" + basename(from));
                    if (from) sendDropData(view, event, from, to);
                    event.preventDefault();
                    event.stopPropagation();
                });
            }
        });
        $(document.documentElement).register("drop", function () {
            $(".data-row > a").removeClass("drop-hover");
        });
        view.register("drop", function (event) {
            event.preventDefault();
            event.stopPropagation();
            view.find(".dropzone").replaceClass("in", "out");
            var items = event.dataTransfer.items,
                fileItem = null,
                entryFunc = null,
                dragData = event.dataTransfer.getData("text");

            if (dragData) { // It's a drag between views
                if (view.attr("data-type") === "directory") { // dropping into a directory view
                    sendDropData(view, event, dragData, fixRootPath(view[0].currentFolder + "/" + basename(dragData)), true);
                } else if (view.attr("data-type") === "document" || view.attr("data-type") === "image") { // dropping into a document view
                    view[0].currentFolder = dirname(dragData);
                    view[0].currentFile = basename(dragData);
                    view[0].editNew = true;
                    updatePath(view);
                    openFile(view);
                }
                return;
            }
            // At this point, it's a file drop

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
                upload(view, event.dataTransfer.files);
                return;
            }

            // We support GetAsEntry, go ahead and read recursively
            var obj = {};
            var cbCount = 0, cbFired = 0, dirCount = 0,
                rootFileFunction = function (file) {
                    obj[file.name] = file;
                    cbFired++;
                },
                childFileFunction = function (path) {
                    return function (file) {
                        obj[path + "/" + file.name] = file;
                        cbFired++;
                    };
                },
                increaseFired =  function () { cbFired++; },
                readDirectory = function (entry, path) {
                    if (!path) path = entry.name;
                    obj[path] = {};
                    entry.createReader().readEntries(function (entries) {
                        for (var i = 0; i < entries.length; i++) {
                            if (entries[i].isDirectory) {
                                dirCount++;
                                readDirectory(entries[i], path + "/" + entries[i].name);
                            } else {
                                cbCount++;
                                entries[i].file(childFileFunction(path), increaseFired);
                            }
                        }
                    });
                };
            var length = event.dataTransfer.items.length;
            for (var i = 0; i < length; i++) {
                var entry = event.dataTransfer.items[i][entryFunc]();
                if (!entry) continue;
                if (entry.isFile) {
                    cbCount++;
                    entry.file(rootFileFunction, increaseFired);
                } else if (entry.isDirectory) {
                    dirCount++;
                    readDirectory(entry);
                }
            }

            // TODO: Uploading just empty folders without any files runs into the timeout
            // Possible solution would be to send the folder creations over the websocket
            // as we can't send empty FormData.
            (function wait(timeout) {
                if (timeout > 10000) {
                    return;
                } else {
                    if (cbCount > 0 && cbFired === cbCount) {
                        upload(view, obj);
                    } else {
                        setTimeout(wait, timeout + 50, timeout + 50);
                    }
                }
            })(50);
        });
    }

    function initEntryMenu() {
        // Rename a file/folder
        $("#entry-menu .rename").register("click", function (event) {
            event.stopPropagation();
            if (droppy.socketWait) return;
            var entry = $("#entry-menu").data("target"),
                view = entry.parents(".view"),
                vId = view[0].vId;
            entryRename(view, entry, false, function (success, oldVal, newVal) {
                if (success) {
                    showSpinner(view);
                    sendMessage(vId, "RENAME", { "old": oldVal, "new": newVal });
                }
            });
        });

        // Copy/cut a file/folder
        $("#entry-menu .copy, #entry-menu .cut").register("click", function (event) {
            event.stopPropagation();
            var entry = $("#entry-menu").data("target"),
                view = entry.parents(".view"),
                from  = entry.data("id");
            droppy.clipboard = { type: $(this).attr("class"), from: from };
            $("#click-catcher").trigger("click");
            view.find(".paste-button .filename").text(basename(from));
            view.find(".paste-button").replaceClass("out", "in");
        });

        // Open a file/folder in browser
        $("#entry-menu .open").register("click", function (event) {
            event.stopPropagation();
            var entry = $("#entry-menu").data("target"),
                url = entry.find(".file-link").attr("href").replace(/^\/~\//, "/_/"),
                type = $("#entry-menu").attr("class").match(/type\-(\w+)/),
                view = entry.parents(".view"),
                win;
            if (type) {
                switch (type[1]) {
                case "html":
                    win = window.open(url, "_blank");
                    break;
                case "audio":
                    play(url);
                    break;
                default:
                    updateLocation(view, fixRootPath(view[0].currentFolder + "/" + entry.find(".file-link").text()));
                }
            }
            $("#click-catcher").trigger("click");
            if (win) win.focus();
        });

        // Edit a file/folder in a text editor
        $("#entry-menu .edit").register("click", function (event) {
            event.stopPropagation();
            $("#click-catcher").trigger("click");
            var entry = $("#entry-menu").data("target"),
                view = entry.parents(".view");
            updateLocation(view, fixRootPath(view[0].currentFolder + "/" + entry.find(".file-link").text()));
        });

        // Delete a file/folder
        $("#entry-menu .delete").register("click", function () {
            if (droppy.socketWait) return;
            sendMessage(null, "DELETE_FILE", $("#entry-menu").data("target").data("id"));
            $("#click-catcher").trigger("click");
        });
    }

    function sortByHeader(view, header) {
        droppy.sorting.col = header[0].className.match(/header\-(\w+)/)[1];
        droppy.sorting.asc = header.hasClass("down");
        header.attr("class", "header-" + droppy.sorting.col + " " + (droppy.sorting.asc ? "up" : "down") + " active");
        header.siblings().removeClass("active up down");
        var sortedEntries = view.find(".content ul li").sort(sortFunc);
        for (var index = sortedEntries.length - 1; index >= 0; index--) {
            $(sortedEntries[index]).css({
                "order": index,
                "-ms-flex-order": String(index),
            });
        }
    }

    function sortFunc(a, b) {
        if (droppy.sorting.asc) {
            var temp = a;
            a = b;
            b = temp;
        }
        if (droppy.sorting.col === "name") {
            var type = compare($(b).data("type"), $(a).data("type")),
                text = compare($(a).find(".entry-link").text(), $(b).find(".entry-link").text().toUpperCase());
            return (type !== 0) ? type : text;
        } else if (droppy.sorting.col === "mtime") {
            return compare($(a).find(".mtime").data("timestamp"), $(b).find(".mtime").data("timestamp"));
        } else if (droppy.sorting.col === "size") {
            return compare($(a).find(".size").data("size"), $(b).find(".size").data("size"));
        }

        function compare(a, b) {
            if (typeof a === "number" && typeof b === "number") {
                return b - a;
            } else {
                try {
                    return a.toString().toUpperCase().localeCompare(b.toString().toUpperCase());
                } catch (undefError) {
                    return -1;
                }
            }
        }
    }

    // Click on a file link
    function setClickAction() {
        if (droppy.get("clickAction") !== "download") {
            // TODO: Use a common function with the entry menu
            $(".file-link").register("click", function (event) {
                var view = $(event.target).parents(".view");
                if (droppy.socketWait) return;
                event.preventDefault();
                updateLocation(view, fixRootPath(view[0].currentFolder + "/" + $(event.target).text()));

            });
        } else {
            $(".file-link").off("click");
        }
    }


    function preparePlayback(playButton) {
        if (droppy.socketWait) return;
        var source = playButton.parent().parent().find(".file-link").attr("href");
        play(source, playButton);
    }

    function closeDoc(view) {
        view[0].switchRequest = true;
        view[0].editor = null;
        updateLocation(view, view[0].currentFolder);
    }

    function openFile(view) {
        // Determine filetype and how to open it
        var path = getViewLocation(view),
            fileext = path.match(/[^\/\.]+$/)[0].toLowerCase();
        switch (fileext) {
            case "jpg":
            case "gif":
            case "png":
                openImage(view);
                break;
            default:
                openDoc(view);
        }
    }
    function openImage(view) {
        view.attr("data-type", "image");
        var filename = view[0].currentFile,
            entryId = fixRootPath(view[0].currentFolder + "/" + filename).split("/"),
            i = entryId.length - 1;
        for (;i >= 0; i--)
            entryId[i] = encodeURIComponent(entryId[i]);
        var url = "/_" + entryId.join("/"),
            previewer = $(
            '<div class="previewer image">' +
                '<div class="media-container">' +
                    '<img src=' + url + '></img>' +
                '</div>' +
            '</div>'
            );
        loadContent(view, contentWrap(view).append(previewer));
        hideSpinner(view);
    }
    function openDoc(view) {
        view.attr("data-type", "document");
        var filename = view[0].currentFile,
            entryId = view[0].currentFolder + "/" + filename,
            url = "/_" + entryId,
            readOnly = false, // Check if not readonly
            editor = null,
            doc = $(
                '<ul class="sidebar">' +
                    '<li class="exit">' + droppy.svg.remove + '<span>Close</span></li>' +
                    '<li class="save">' + droppy.svg.disk + '<span>Save</span></li>' +
                    '<li class="ww">' + droppy.svg.wordwrap + '<span>Wrap</span></li>'  +
                '</ul>' +
                '<div class="doc' + (readOnly ? ' readonly' : ' editing') + '">' +
                    '<div class="text-editor">' +
                        '<textarea></textarea>' +
                    '</div>' +
                '</div>'
            );
        loadContent(view, contentWrap(view).append(doc));
        showSpinner(view);
        $.ajax({
            type: "GET",
            url: url,
            dataType: "text",
            success : function (data) {
                // TODO: Load CodeMirror Mode from mimetype/(fileext for js)
                // $.getScript()
                var ext = filename.match(/[^\.]+$/)[0].toLowerCase(),
                    mode = (function () {
                        // If extension is different than modetype
                        switch (ext) {
                        case "coffee":
                        case "litcoffee":
                            return "coffeescript";
                        case "js":
                            return "javascript";
                        case "json":
                            return { name: "javascript", json : true };
                        case "html":
                            return "htmlmixed";
                        case "ai":
                        case "svg":
                            return "xml";
                        case "md":
                            return "markdown";
                        default:
                            return ext;
                        }
                    })();
                view[0].editor = editor = CodeMirror.fromTextArea(doc.find(".text-editor textarea")[0], {
                    styleSelectedText: true,
                    readOnly: true,
                    showCursorWhenSelecting: true,
                    theme: droppy.get("theme"),
                    indentWithTabs: droppy.get("indentWithTabs"),
                    indentUnit: droppy.get("indentUnit"),
                    lineWrapping: droppy.get("lineWrapping"),
                    lineNumbers: true,
                    autofocus: true,
                    keyMap: "sublime",
                    mode: mode
                });
                $(".sidebar").attr("style", "right: calc(.75em + " + (view.find(".CodeMirror-vscrollbar").width()) + "px)");
                doc.find(".exit").register("click", function () {
                    closeDoc(view);
                    editor = null;
                });
                doc.find(".save").register("click", function () {
                    showSpinner(view);
                    sendMessage(view[0].vId, "SAVE_FILE", {
                        "to": entryId,
                        "value": editor.getValue()
                    });
                });
                doc.find(".ww").register("click", function () {
                    if (editor.options.lineWrapping) {
                        editor.setOption("lineWrapping", false);
                        droppy.set("lineWrapping", false);

                    } else {
                        editor.setOption("lineWrapping", true);
                        droppy.set("lineWrapping", true);
                    }
                });
                setTimeout(function () {
                    editor.setOption("readOnly", readOnly);
                    editor.setValue(data);
                    editor.clearHistory();
                    editor.refresh();
                    editor.on("change", function () {
                        if (!view[0].editNew) {
                            view.find(".path li:last-child").removeClass("saved save-failed").addClass("dirty");
                        }
                    });
                    editor.on("keyup", function () {
                        view[0].editNew = false;
                    });
                    // Keyboard shortcuts
                    $(window).register("keydown", function (e) {
                        if (editor && (e.metaKey || e.ctrlKey)) {
                            // s - save
                            if (e.keyCode === 83) {
                                e.preventDefault();
                                showSpinner(view);
                                sendMessage(view[0].vId, "SAVE_FILE", {
                                    "to": entryId,
                                    "value": editor.getValue()
                                });
                                return false;
                            }
                        }
                    });
                    hideSpinner(view);
                }, 1000);
            },
            error : function () {
                closeDoc(view);
            }
        });
    }

    function createOptions() {
        var list = $("<ul>");
        list.append(createSelect("indentWithTabs", "Indentation Mode", [true, false], ["Tabs", "Spaces"]));
        list.append(createSelect("indentUnit", "Indentation Unit", [2, 4, 8], [2, 4, 8]));
        list.append(createSelect("theme", "Editor Theme", ["mdn-like", "base16-dark", "xq-light"], ["mdn-like", "base16-dark", "xq-light"]));
        list.append(createSelect("lineWrapping", "Wordwrap Mode", [true, false], ["Wrap", "No Wrap"]));
        list.append(createSelect("clickAction", "File Click Action", ["download", "view"], ["Download", "View"]));
        list.append(createSelect("renameExistingOnUpload", "Upload Mode", [true, false], ["Rename", "Replace"]));
        list.prepend("<h1>Options</h1>");
        return $("<div class='list-options'>").append(list);

        function createSelect(option, label, values, valueNames) {
            var output = "";
            output += '<label>' + label + '</label>';
            output += '<div><select class="' + option + '">';
            values.forEach(function (value, i) {
                if (droppy.get(option) === value)
                    output += '<option value="' + value + '" selected>' + valueNames[i] + '</option>';
                else
                    output += '<option value="' + value + '">' + valueNames[i] + '</option>';
            });
            output += '</select></div>';
            return '<li>' + output + '</li>';
        }
    }

    function createUserList(users) {
        var output = "<div class='list-user'><h1>User List</h1>";
        output += "<ul>";
        Object.keys(users).forEach(function (user) {
            output += '<li><span class="username">' + user + "</span>" + droppy.svg.remove + '</li>';
        });
        output += "</ul>";
        output += "<div class='add-user'>" + droppy.svg.plus + "Add User</div>";
        output += "</div>";
        return output;
    }

    function updateUsers(userlist) {
        $("#options-box").find(".list-user").empty().append(createUserList(userlist));
        bindUserlistEvents();
    }

    function showOptions(userlist) {
        var $box = $("#options-box");
        $box.empty().append(createOptions);
        if (Object.keys(userlist).length > 0) {
            $box.append(createUserList(userlist));
            $box.replaceClass("single", "double");
        } else {
            $box.replaceClass("double", "single");
        }
        bindUserlistEvents();
        $("#options-box").replaceClass("out", "in");
        toggleCatcher();
        $("#click-catcher").one("click", function () {
            $box.find("select").each(function () {
                var option = $(this).attr("class"), value  = $(this).val();

                if (value === "true") value = true;
                else if (value === "false") value = false;
                else value = parseFloat(value) || value;

                droppy.set(option, value);
                $(".view").each(function () {
                    if (this.editor) this.editor.setOption(option, value);
                });
            });
            setClickAction(); // Set click actions here so it applies immediately after a change
        });
    }

    function bindUserlistEvents() {
        $(".add-user").register("click", function () {
            var user = window.prompt("Username?"),
                pass = window.prompt("Password?");
            if (!user || !pass) return;
            sendMessage(null, "UPDATE_USER", {
                name: user,
                pass: pass,
                priv: true
            });
        });
        $(".list-user .remove").on("click", function (event) {
            event.stopPropagation();
            sendMessage(null, "UPDATE_USER", {
                name: $(this).parents("li").children(".username").text(),
                pass: ""
            });
        });
    }

    function play(source, playButton) {
        var player = document.getElementById("audio-player");

        if (!player.canPlayType(droppy.mediaTypes[getExt(source)])) {
            window.alert("Sorry, your browser can't play this file.");
            return;
        }

        $(".file-link").parent().removeClass("playing").removeClass("paused");
        $(".icon-play").html(droppy.svg.play);

        if (decodeURI(player.src).indexOf(source) > 0) {
            if (player.paused) player.play();
            else player.pause();
        } else {
            player.src = source;
            player.load();
            player.play();
        }
        if (playButton) {
            if (player.paused) {
                playButton.parent().parent().removeClass("playing").addClass("paused");
            } else {
                playButton.parent().parent().removeClass("paused").addClass("playing");
            }
            playButton.html(player.paused ? droppy.svg.play : droppy.svg.pause);
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
        droppy.activeFiles = [];
        droppy.audioUpdater = null;
        droppy.debug = null;
        droppy.demoMode = null;
        droppy.isPlaying = null;
        droppy.mediaTypes = {};
        droppy.noLogin = null;
        droppy.queuedData = null;
        droppy.reopen = null;
        droppy.sizeCache = {};
        droppy.socket = null;
        droppy.socketWait = null;
        droppy.sorting = {col: "name", dir: "down"};
        droppy.svg = {};
        droppy.views = [];
        droppy.zeroFiles = null;
    }

    // Add directory sizes
    function addSizes(view, folder, data) {
        var bytes, name;
        view.children(".content").each(function () {
            if ($(this).data("root") === folder) {
                droppy.sizeCache[folder] = {};
                $(this).find(".folder-link").each(function () {
                    name = $(this).text();
                    bytes = data[name].size;
                    if (bytes && bytes > 0) {
                        // cache the  size information
                        droppy.sizeCache[folder][name] = bytes;
                        setSize(this, bytes);
                    } else {
                        // Try to load from cache
                        if (droppy.sizeCache[folder] && droppy.sizeCache[folder][name])
                            setSize(this, droppy.sizeCache[folder][name]);
                    }
                });
            }
        });
    }

    function setSize(el, bytes) {
        var temp = convertToSI(bytes);
        $(el).siblings(".size").attr("data-size", bytes).text(temp.size);
        $(el).siblings(".size-unit").text(temp.unit);
    }

    // Convert raw byte numbers to SI values
    function convertToSI(bytes, decimals) {
        var step = 0, units = ["b", "k", "M", "G", "T"];
        while (bytes >= 1024) {
            bytes /= 1024;
            step++;
        }
        if (!decimals) {
            return {
                size: (step === 0) ? bytes : Math.round(bytes),
                unit: units[step]
            };
        } else {
            return {
                size: (step === 0) ? bytes : (bytes).toFixed(decimals),
                unit: units[step]
            };
        }
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

    function getHeaderHTML() {
        return '<div class="file-header">' +
                    '<span class="header-name" class="down">Name' + droppy.svg.triangle + '</span>' +
                    '<span class="header-mtime" class="up">Modified' + droppy.svg.triangle + '</span>' +
                    '<span class="header-size" class="up">Size' + droppy.svg.triangle + '</span>' +
                    '<span class="header-spacer"></span>' +
                '</div>';
    }

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
            retval = "just now";
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

    function reloadCSS(css) {
        if (!droppy.debug) return;
        $('link[rel="stylesheet"]').remove();

        var i = 0;
        while (document.styleSheets[i])
            document.styleSheets[i++].disabled = true;

        $("<style></style>").text(css).appendTo($("head"));
    }

    function showSpinner(view) {
        var spinner;
        if (!view.find(".spinner").length)
            view.find(".path").append('<div class="spinner"></div>');

        spinner = view.find(".spinner");
        if (spinner.hasClass("out")) spinner.removeClass("out");

        // HACK: Safeguard so a view won't get stuck in loading state
        if (view.attr("data-type") === "directory") {
            clearTimeout(view[0].stuckTimeout);
            view[0].stuckTimeout = setTimeout(function () {
                sendMessage(view[0].vId, "REQUEST_UPDATE", getViewLocation(view));
            }, 5000);
        }
    }

    function hideSpinner(view) {
        var spinner = view.find(".spinner");
        if (spinner.length && !spinner.hasClass("out"))
            spinner.addClass("out");
        if (view[0].stuckTimeout) clearTimeout(view[0].stuckTimeout);
    }

    function debounce(func, wait) {
        var timeout, result;
        return function () {
            var context = this, args = arguments;
            clearTimeout(timeout);
            timeout = setTimeout(function () {
                timeout = null;
                result = func.apply(context, args);
            }, wait);
            return result;
        };
    }

    // removes starting "//" or prepends "/"
    function fixRootPath(p) {
        return p.replace(/^\/*(.*)$/g, "/$1").replace("//", "/");
    }

    // Normalize path from /dir/ to /dir, stripping a trailing slash
    function normalizePath(p) {
        if (p[p.length - 1] === "/") p = p.substring(0, p.length - 1);
        return p || "/";
    }

    // turn /path/to/file to file
    function basename(path) {
        return path.replace(/^.*\//, "");
    }
    // turn /path/to/file to /path/to
    function dirname(path) {
        if (path === "/")
            return "/";
        else
            return path.replace(/\/[^\/]*$/, "");
    }
}(jQuery, window, document));
