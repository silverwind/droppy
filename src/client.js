/*global CodeMirror */
"use strict";

(function ($, window, document) {
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
            theme: "base16-dark",
            indentWithTabs : false,
            indentUnit : 4,
            lineWrapping: false,
            hasLoggedOut : false
        };
        // Load prefs and set missing ones to their default
        prefs = JSON.parse(localStorage.getItem("prefs")) || {};
        for (var pref in defaults) {
            if (defaults.hasOwnProperty(pref)) {
                if (!prefs[pref]) {
                    doSave = true;
                    prefs[pref] = defaults[pref];
                }
            }
        }
        doSave && localStorage.setItem("prefs", JSON.stringify(prefs));

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
    // Add the dataTransfer property to the "drop" event.
    $.event.props.push("dataTransfer");

    // Shorthand for safe event listeners
    $.fn.register = function (events, callback) {
        return this.off(events).on(events, callback);
    };

    // Class swapping helper
    $.fn.replaceClass = function (match, replacement) {
        var classes = this[0].className.split(' '), classMatch,
            hasClass = false;
        classes = classes.filter(function (className) {
            if (className === match) return false;
            if (className === replacement) hasClass = true;

            classMatch = className.match(match);
            // filter out if the entire capture matches the entire className
            if (classMatch) return classMatch[0] !== className;
            else return true;
        });
        if (!hasClass) classes.push(replacement);
        this[0].className = classes.join(' ');
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

// ============================================================================
//  View handling
// ============================================================================
    function getView(id) {
        if (!droppy.views) updateViews();
        if (id && droppy.views[id]) return $(droppy.views[id]);
        else return $(droppy.views[0]);
    }

    function updateViews() {
        droppy.views = $(".view");
        droppy.views.each(function (index, elem) {
            elem.vId = index;
        });
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
        var newPage = $("#newpage"),
            oldPage = $("#page"),
            box     = $("#center-box");
        if (type === "main") {
            initMainPage();
            requestAnimation(function () {
                oldPage.replaceClass("in", "out");
                droppy.socketWait && showSpinner();
                finalize();
            });
        } else if (type === "auth" || type === "firstrun") {
            initAuthPage(type === "firstrun");
            requestAnimation(function () {
                oldPage.replaceClass("in", "out");
                setTimeout(function () {
                    box.removeClass("out");
                    if (type === "firstrun") {
                        $("#login-info").text("Hello! Choose your creditentials.");
                        $("#login-info-box").addClass("info");
                    } else if (droppy.get("hasLoggedOut")) {
                        $("#login-info").text("Logged out!");
                        $("#login-info-box").addClass("info");
                        droppy.set("hasLoggedOut", false);
                    }
                }, 100);
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
    var queuedData, retries = 3;
    function openSocket() {
        var protocol = document.location.protocol === "https:" ? "wss://" : "ws://";
        droppy.socket = new WebSocket(protocol + document.location.host + "/websocket");

        droppy.socket.onopen = function () {
            retries = 3; // reset retries on connection loss
            if (queuedData)
                sendMessage();
            else {
                getView(0).attr("data-type", "directory");
                updateLocation(getView(0), getView(0)[0].currentFolder || "/", false); // Request initial update
            }
        };

        // Close codes: https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent#Close_codes
        droppy.socket.onclose = function (event) {
            if (droppy.get("hasLoggedOut") || event.code === 4000) return;
            if (event.code >= 1002 && event.code < 3999) {
                if (retries > 0) {
                    openSocket();
                    retries--;
                }
            } else if (droppy.reopen) {
                droppy.reopen = false;
                openSocket();
            }
        };

        droppy.socket.onmessage = function (event) {
            droppy.socketWait = false;
            var msg = JSON.parse(event.data),
                vId = msg.vId;
            switch (msg.type) {
            case "UPDATE_FILES":
                // Ignore update if we're uploading or the view is not viewing a directory
                if ((droppy.isUploading || getView(vId).attr("data-type") !== "directory") && !getView(vId)[0].switchRequest) return;
                if (getView(vId)[0].switchRequest) {
                    getView(vId)[0].switchRequest = false;
                    $(".editor-filename").remove(); // TODO: Change to be view-relative once path is parented to view.
                }
                showSpinner();
                updateData(getView(vId), msg.folder, msg.data);
                droppy.ready = false;
                break;
            case "UPDATE_SIZES":
                droppy.views.each(function () {
                    if ($(this)[0].currentFolder === msg.folder) updateSizes($(this)[0], msg.data);
                });
                break;
            case "UPLOAD_DONE":
                if (droppy.zeroFiles.length) {
                    sendMessage(vId, "ZERO_FILES", droppy.zeroFiles);
                    droppy.zeroFiles = [];
                } else {
                    droppy.isUploading = false;
                    updateTitle(getView(vId)[0].currentFolder, true);
                    $("#upload-info").attr("class", "out");
                    hideSpinner();
                }
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
            case "SAVE_STATUS":
                hideSpinner();
                $(".editor-filename").removeClass("dirty").addClass(msg.status === 0 ? "saved" : "save-failed"); // TODO: Change to be view-relative
                setTimeout(function () { $(".editor-filename").removeClass("saved save-failed"); }, 1000); // TODO: Change to be view-relative
                break;
            }
        };
    }

    function sendMessage(vId, msgType, msgData) {
        if (droppy.socket.readyState === 1) { // open
            // Lock the UI while we wait for a socket response
            droppy.socketWait = true;

            // Unlock the UI in case we get no socket resonse after waiting for 1 second
            setTimeout(function () {
                droppy.socketWait = false;
            }, 1000);

            if (queuedData) {
                droppy.socket.send(queuedData);
                queuedData = false;
            } else
                droppy.socket.send(JSON.stringify({type: msgType, vId: vId, data: msgData}));
        } else {
            // We can't send right now, so queue up the last added message to be sent later
            queuedData = JSON.stringify({type: msgType, data: msgData});

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
                } catch (error) {}
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
        // Initialize the current folder, in case the user navigated to it through the URL.
        getView()[0].currentFolder = decodeURIComponent(window.location.pathname);

        // Open the WebSocket
        openSocket();

        var endTimer, isHovering;
        function endDrag() {
            $("#drop-preview").replaceClass("in", "out");
            isHovering = false;
        }
        function enter(event) {
            event.preventDefault(); // Stop dragenter and dragover from killing our drop event
            clearTimeout(endTimer);
            if (!isHovering) {
                $("#drop-preview").replaceClass("out", "in");
                isHovering = true;
            }
        }
        function leave() {
            clearTimeout(endTimer);
            endTimer = setTimeout(endDrag, 100);
        }

        // Drag and Drop handlers
        $(document.documentElement).register("dragenter", enter);
        $(document.documentElement).register("dragover", enter);
        $(document.documentElement).register("dragleave", leave);
        $(document.documentElement).register("dragend", leave);
        $(document.documentElement).register("drop", function (event) {
            event.stopPropagation();
            event.preventDefault();
            endDrag();

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
                upload(getView(), event.dataTransfer.files);
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
                    return;
                } else {
                    if (cbCount > 0 && cbFired === cbCount) {
                        upload(getView(), obj);
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
                checkPathOverflow();
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
                upload(getView(), obj);
            } else if ($("#file").val()) {
                upload(getView(), $("#file").get(0).files);
            }
            $("#file").val(""); // Reset the input
        });

        // File upload button
        $("#upload-file").register("click", function () {
            // Remove the directory attributes so we get a file picker dialog!
            if (droppy.detects.fileinputdirectory)
                $("#file").removeAttr("directory msdirectory mozdirectory webkitdirectory");
            $("#file").click();
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
            // No directory upload support - disable the button
            $("#upload-folder").addClass("disabled");
            $("#upload-folder").register("click", function () {
                window.alert("Sorry, your browser doesn't support directory uploading yet!");
            });
        }

        $("#create-folder").register("click", function () {
            var dummyFolder, wasEmpty, view,
                dummyHtml = '<li class="data-row new-folder" data-type="folder">' +
                                '<span class="sprite sprite-folder-open"></span>' +
                                '<span class="folder-link entry-link"></span>' +
                            '</li>';

            if ($("#empty").length > 0) {
                $("#content").html("<ul>" + getHeaderHTML() + dummyHtml + "</ul>");
                wasEmpty = true;
            } else {
                $(dummyHtml).appendTo("#content ul");
            }
            dummyFolder = $(".data-row.new-folder");
            view = dummyFolder.parents(".view");
            view.scrollTop(dummyFolder.offset().top);
            entryRename(view, dummyFolder, wasEmpty, function (success, oldVal, newVal) {
                if (success) {
                    showSpinner();
                    sendMessage(null, "CREATE_FOLDER",
                        view[0].currentFolder === "/" ? "/" + newVal : view[0].currentFolder + "/" + newVal
                    );
                }
                dummyFolder.remove();
            });
        });

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
                sendMessage(null, "GET_USERS");
                toggleCatcher();
            });
        });

        $("#user-add").register("click", function () {
            //TODO: UI
            var user = window.prompt("Username?");
            var pass = window.prompt("Password?");
            if (!user || !pass) return;
            sendMessage(null, "UPDATE_USER", {
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
                    if (entry.getAttribute("data-changed") === "true") {
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
                sendMessage(null, "UPDATE_USER", user);
            });
            configbox.attr("class", "out");
            toggleCatcher();
        });

        $("#logout").register("click", function () {
            droppy.socket && droppy.socket.close(4001);
            deleteCookie("session");
            initVariables(); // Reset vars to their init state
            droppy.set("hasLoggedOut", true);
            requestPage();
        });

        // Hide modals when clicking outside their box
        $("#click-catcher").register("click", function () {
            $("#config-box").attr("class", "out");
            $("#about-box").attr("class", "out");
            $("#entry-menu").attr("class", "out");
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
            player     = $("#audio-player")[0];

        volumeIcon.register("click", function () {
            slider.attr("class", slider.attr("class") === "" ? "in" : "");
            level.attr("class", level.attr("class") === "" ? "in" : "");
        });

        seekbar.register("click", function (event) {
            player.currentTime = player.duration * (event.clientX / window.innerWidth);
        });

        var tooltip = $("#tooltip");
        seekbar.register("mousemove", debounce(function (event) {
            if (!player.duration) return;
            var left = event.clientX;
            tooltip.css("bottom", ($(window).height() - seekbar[0].getBoundingClientRect().top + 8) + "px");
            tooltip.css("left", (left - tooltip.width() / 2 - 3), + "px");
            tooltip.attr("class", "in");
            updateTextbyId("tooltip", secsToTime(player.duration * (event.clientX / window.innerWidth)));
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
                    volume > 1 && (volume = 1);
                } else {
                    volume -= 0.05;
                    volume < 0 && (volume = 0);
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
            updateTextbyId("time-cur", secsToTime(cur));
            updateTextbyId("time-max", secsToTime(max));
        }

        function playing() {
            var matches = $(player).attr("src").match(/(.+)\/(.+)\./);
            droppy.isPlaying = true;
            updateTitle(getView()[0].currentFolder, true);
            updateTextbyId("audio-title", matches[matches.length - 1].replace(/_/g, " ").replace(/\s+/, " "));
            controls.attr("class", "in");
            fullyLoaded = false;
            droppy.audioUpdater = setInterval(updater, 100);
        }

        function stop(event) {
            if (event.type === "ended") {
                var next = $(".playing").next();
                preparePlayback($((next.length) ? next.find(".icon-play") : $("#content ul").find(".icon-play").first()));
            }
            document.getElementById("audio-title").innerHTML = "";
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

        // ============================================================================
        //  Helper functions for the main page
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
                        droppy.zeroFiles.push(filename);
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

            // Load the new files into view, tagged
            buildEntryList(view, view[0].currentData, view[0].currentFolder, true);

            // Create the XHR2 and bind the progress events
            var xhr = new XMLHttpRequest();
            xhr.upload.addEventListener("progress", uploadProgress, false);
            xhr.upload.addEventListener("load", uploadDone, false);
            xhr.upload.addEventListener("error", uploadDone, false);

            // Init the UI
            $("#upload-cancel").register("click", function () {
                xhr.abort();
                uploadCancel();
            });

            title.text(numFiles < 2 ? "Uploading..." : "Uploading " + numFiles + " files...");
            start = Date.now();
            updateTitle("0%");
            uperc.text("0%");
            prog.css("width", "0%");
            timeleft.text("");
            $("#upload-info").attr("class", "in");

            // And send the files
            droppy.isUploading = true;

            if (formLength) {
                xhr.open("POST", "/upload");
                xhr.send(formData);
            } else if (droppy.zeroFiles.length) {
                sendMessage(view[0].vId, "ZERO_FILES", droppy.zeroFiles);
            }
        }

        var start, lastUpdate,
            timeleft = $("#upload-time-left"),
            prog     = $("#upload-bar-inner"),
            title    = $("#upload-title"),
            uperc    = $("#upload-percentage");

        function uploadDone() {
            prog.css("width", "100%");
            title.text("Processing...");
            uperc.text("100%");
        }

        function uploadCancel() {
            prog.css("width", "0");
            title.text("Aborting...");
            uperc.text("");
            $(".uploading").remove();
        }

        function uploadProgress(event) {
            if (!event.lengthComputable) return;

            // Update progress every 250ms at most
            if (!lastUpdate || (Number(new Date()) - lastUpdate) >= 250) {
                lastUpdate = Number(new Date());

                var bytesSent  = event.loaded,
                    bytesTotal = event.total,
                    progress   = Math.round((bytesSent / bytesTotal) * 100) + "%",
                    speed      = convertToSI(bytesSent / ((Date.now() - start) / 1000), 2);

                prog.css("width", progress);
                updateTitle(progress);
                uperc.text(progress + " - " + speed.size + " " + speed.unit + "/s");

                // Calculate estimated time left
                var elapsed = Date.now() - start;
                var estimate = bytesTotal / (bytesSent / elapsed);
                var secs = (estimate - elapsed) / 1000;

                if (secs > 60) {
                    timeleft.text(Math.ceil(secs / 60) + " mins left");
                } else {
                    timeleft.text(Math.ceil(secs) + " secs left");
                }
            }
        }
    }
// ============================================================================
//  General helpers
// ============================================================================
    function entryRename(view, entry, wasEmpty, callback) {
        var namer, canSubmit, exists, valid, inputText;
        // Populate active files list
        droppy.activeFiles = [];
        view.find(".entry-link").each(function () {
            $(this).removeClass("editing invalid");
            droppy.activeFiles.push($(this).text().toLowerCase());
        });

        // Hide menu, click-catcher and the original link, stop any previus edits
        $("#click-catcher").trigger("mousemove");
        var link = entry.find(".entry-link");

        // Add inline elements
        namer = $('<input id="inline-namer" value="' + link.text() + '" placeholder="' + link.text() + '"/>');
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
            event.keyCode === 27 && stopEdit(); // Escape Key
            event.keyCode === 13 && submitEdit(false, callback); // Return Key
        }).register("focusout", function () {
            submitEdit(true, callback);
        }).select();

        function submitEdit(skipInvalid, callback) {
            var oldVal = namer.attr("placeholder"),
                newVal = namer.val(),
                success;
            if (canSubmit) {
                if (oldVal !== newVal) {
                    success = true;
                }
                stopEdit();
            } else if (exists && !skipInvalid) {
                namer.addClass("shake");
                setTimeout(function () {
                    namer.removeClass("shake");
                }, 500);
            } else {
                success = false;
                stopEdit();
            }
            if (typeof success === "boolean" && typeof callback === "function") callback(success, oldVal, newVal);
        }
        function stopEdit() {
            $("#inline-namer, #inline-submit").remove();
            $(".data-row.new-folder").remove();
            entry.removeClass("editing invalid");
            if (wasEmpty) loadContent(view);
        }
    }

    // Toggle the full-screen click catching frame if any modals are shown
    function toggleCatcher() {
        if ($("#about-box").hasClass("in") ||
            $("#config-box").hasClass("in") ||
            $("#entry-menu").hasClass("in")
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
                temp.setAttribute("title", "The user's password");
                temp.onkeyup = function () {
                    this.parentNode.setAttribute("data-changed", "true");
                    $(this.parentNode).addClass("changed");
                };
                entry.appendChild(temp);

                temp = createElement("input", "user-priv");
                temp.type = "checkbox";
                temp.id = "check-" + user;
                temp.checked = userList[user] ? "checked" : "";
                temp.onchange = function () {
                    this.parentNode.setAttribute("data-changed", "true");
                    $(this.parentNode).addClass("changed");
                };
                entry.appendChild(temp);

                temp = createElement("label");
                temp.setAttribute("title", "Priviledged");
                temp.setAttribute("for", "check-" + user);
                temp.innerHTML = droppy.svg.key;
                entry.appendChild(temp);

                temp = createElement("span");
                temp.innerHTML = droppy.svg.trash;
                temp.setAttribute("title", "Delete");
                temp.onclick = function () {
                    var children = this.parentNode.childNodes;
                    for (var i = 0, l = children.length; i < l; i++) {
                        if (children[i].className === "user-name") {
                            sendMessage(null, "UPDATE_USER", { name: children[i].innerHTML, pass: ""});
                            break;
                        }
                    }
                };
                entry.appendChild(temp);

                document.getElementById("userlist").appendChild(entry);
            }
        }
    }

    // Update directory size information
    function updateSizes(view, sizeData) {
        var entries, liveName, interval = 250;
        (function wait(timeout) {
            if (timeout > 4000) {
                return;
            } else if (!droppy.ready) {
                setTimeout(wait, interval, timeout + interval);
                return;
            } else {
                entries = $(view).find('.data-row[data-type="folder"]');
                if (entries.length) {
                    entries.each(function () {
                        liveName = $(this).data("id").substring(view.currentFolder.length);
                        liveName = (liveName[0] === "/") ? liveName.substring(1) : liveName;
                        $(this).find(".size").attr("data-size", sizeData[liveName] || 0);
                        if (sizeData[liveName]) {
                            var temp = convertToSI(sizeData[liveName]);
                            $(this).find(".size").text(temp.size > 0 ? temp.size : "");
                            $(this).find(".size-unit").text(temp.size > 0 ? temp.unit : "");
                        }
                    });
                } else {
                    setTimeout(wait, interval, timeout + interval);
                }
            }
        })(interval);
    }

    // Update data as received from the server
    function updateData(view, folder, data) {
        if (folder !== view[0].currentFolder)
            updateLocation(view, folder);

        if (view[0].vId === 0) {
            updateTitle(folder, true);
            updatePath(view, folder);
        }

        view[0].currentData = data;
        view.attr("data-type", "directory");
        buildEntryList(view, data, folder);
        hideSpinner();
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
        var view = getView();
        (function queue(time) {
            if ((!droppy.socketWait && !droppy.isAnimating) || time > 2000)
                updateLocation(view, decodeURIComponent(window.location.pathname), true, true);
            else
                setTimeout(queue, 50, time + 50);
        })(0);
    });

    // Update our current location and change the URL to it
    function updateLocation(view, path, doSwitch, skipPush) {
        // Queue the folder switching if we are mid-animation or waiting for the server
        (function queue(time) {
            if ((!droppy.socketWait && !droppy.isAnimating) || time > 2000) {
                showSpinner();

                // Find the direction in which we should animate
                if (view.find(".doc").length) {
                    view[0].animDirection = "back";
                } else {
                    if (path.length > view[0].currentFolder.length) view[0].animDirection = "forward";
                    else if (path.length === view[0].currentFolder.length) view[0].animDirection = "same";
                    else view[0].animDirection = "back";
                }

                view[0].currentFolder = path;
                sendMessage(view[0].vId, doSwitch ? "SWITCH_FOLDER" : "REQUEST_UPDATE", view[0].currentFolder);

                // Skip the push if we're already navigating through history
                if (!skipPush) window.history.pushState(null, null, view[0].currentFolder);
            } else
                setTimeout(queue, 50, time + 50);
        })(0);
    }

    // Update the path indicator
    function updatePath(view, path, filename) {
        var parts = path.split("/");
        var i = 0, len;

        parts[0] = droppy.svg.home;
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
                view[0].switchRequest = true; // This needs to be set so we can switch out of a editor view
                updateLocation(view, $(this).data("destination"), true);
            });

            $("#path").append(li);
            li.append(droppy.svg.triangle);
        }

        function finalize() {
            // Add filename when in editor view
            if (filename) {
                $("#path").append($("<li class='out editor-filename'>" + filename + droppy.svg.triangle + "</li>"));

            }
            $("#path li.out").setTransitionClass("out", "in");
            setTimeout(function () {
                // Remove the class after the transition and keep the list scrolled to the last element
                $("#path li.in").removeClass("in");
                checkPathOverflow();
            }, 200);
        }
    }

    // Check if the path indicator overflows and scroll it if neccessary
    function checkPathOverflow() {
        var width = 60,
            space = $(window).width(),
            pathElements = document.querySelectorAll("#path li");

        for (var i = 0, l = pathElements.length; i < l; i++) {
            width += pathElements[i].offsetWidth;
        }

        if (width > space) {
            requestAnimation(function () {
                if (droppy.detects.animation)
                    $("#path li").css({"left": space - width + "px"});
                else
                    $("#path li").animate({"left": space - width}, {duration: 200});
            });
        } else {
            requestAnimation(function () {
                if ($("#path li").css("left") !== 0)
                    $("#path li").animate({"left": 0}, {duration: 200});
            });
        }
    }

    // Convert the received data into HTML
    function buildEntryList(view, fileList, root, isUpload) {
        var list = $("<ul></ul>"), downloadURL, type, temp, size, sizeUnit, mtime, id, classes, svgIcon, bytes;
        for (var file in fileList) {
            if (fileList.hasOwnProperty(file)) {
                svgIcon = "", classes = "";
                type = fileList[file].type;
                bytes = fileList[file].size;
                temp = convertToSI(bytes);
                size = temp.size > 0 ? temp.size : "0";
                sizeUnit = temp.size > 0 ? temp.unit : "b";
                mtime = fileList[file].mtime;
                id = (root === "/") ? "/" + file : root + "/" + file;
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
                            '<span class="folder-link entry-link">' + file + '</span>' +
                            '<span class="mtime" data-timestamp="' + mtime + '">' + timeDifference(mtime) + '</span>' +
                            '<span class="size">' + size + '</span>' +
                            '<span class="size-unit">' + sizeUnit + '</span>' +
                            '<span><a class="zip" title="Create Zip" href="/~~' + id + '" download="' + file + '.zip">' + droppy.svg.zip + '</a></span>' +
                            '<span class="entry-menu" title="Actions">' + droppy.svg.menu + '</span>' +
                        '</li>'
                    );
                }
            }
        }
        list.children("li").sort(sortFunc).appendTo(list);
        loadContent(view, list.children("li").length > 0 ? list : null);
    }

    // Load generated list into view with an animation
    function loadContent(view, html) {
        var emptyPage = '<div id="empty">' + droppy.svg["upload-cloud"] + '<div class="text">Add files</div></div>',
            type = view.attr("data-type"),
            navRegex = /(forward|back|center)/,
            typeRegex = /(document|directory|media)/;
        switch (type) {
        case "document":
            view[0].animDirection = "forward";
            break;
        case "directory":
            $(getHeaderHTML()).prependTo(html);
            break;
        }
        // Set the view type as a class for styling purpose
        view.replaceClass(typeRegex, type);

        requestAnimation(function () {
            if (view[0].animDirection === "same" && type !== "document") {
                view.find("#content").attr("class", "center");
                view.find("#content").html(html || emptyPage);
            } else {
                view.append($("<div id='newcontent' class='" + view[0].animDirection + "'></div>"));
                view.find("#newcontent").html(html || emptyPage);
                droppy.isAnimating = true;
                view.find(".data-row").addClass("animating");
                view.find("#content").replaceClass(navRegex, (view[0].animDirection === "forward") ? "back" : "forward");
                view.find("#newcontent").setTransitionClass(navRegex, "center");
                // Switch classes once the transition has finished
                setTimeout(function () {
                    droppy.isAnimating = false;
                    view.find("#content").remove();
                    view.find("#newcontent").attr("id", "content");
                    view.find(".data-row").removeClass("animating");
                }, 200);
            }
            bindEvents(view);
        });
    }

    // Bind click events to the list elements
    function bindEvents(view) {
        // Upload button on empty page
        view.find("#empty").register("click", function () {
            if (droppy.detects.fileinputdirectory)
                $("#file").removeAttr("directory msdirectory mozdirectory webkitdirectory");
            $("#file").click();
        });

        // Switch into a folder
        view.find(".data-row[data-type='folder']").register("click", function () {
            if (droppy.socketWait) return;
            var destination = $(this).data("id"),
                view = $(this).parents(".view");
            updateLocation(view, destination, true);
        });

        view.find(".data-row .entry-menu").register("click", function (event) {
            event.stopPropagation();
            var entry = $(this).parent("li.data-row"),
                type = entry.find(".sprite").attr("class"),
                button = $(this);

            type = type.match(/sprite\-(\w+)/);
            if (type) type = type[1];

            $("#entry-menu")
                .attr("class", "in")
                .css({top: entry.offset().top + "px", left: (button.offset().left + button.width() - $("#entry-menu").width()) + "px" })
                .data("target", entry)
                .addClass("type-" + type);
            toggleCatcher();

            $("#click-catcher").one("mousemove", function () {
                $("#entry-menu").attr("class", "out");
                toggleCatcher();
            });
        });

        // Rename a file/folder
        $("#entry-menu .rename").register("click", function (event) {
            event.stopPropagation();
            if (droppy.socketWait) return;
            var entry = $("#entry-menu").data("target"),
                view = entry.parents(".view"), // #content-container
                vId = view[0].vId;
            entryRename(view, entry, false, function (success, oldVal, newVal) {
                if (success) {
                    showSpinner();
                    sendMessage(vId, "RENAME", { "old": oldVal, "new": newVal });
                }
            });
        });

        // Copy/cut a file/folder
        $("#entry-menu .copy, #entry-menu .cut").register("click", function (event) {
            event.stopPropagation();
            var entry = $("#entry-menu").data("target"),
                from  = entry.data("id");
            droppy.clipboard = { type: $(this).attr("class"), from: from };
            $("#click-catcher").trigger("click");
            $("#paste .filename").text(basename(from));
            $("#paste").attr("class", "in");
        });

        // Open a file/folder in browser
        $("#entry-menu .open").register("click", function (event) {
            event.stopPropagation();
            var entry = $("#entry-menu").data("target"),
                url = entry.find(".file-link").attr("href").replace(/^\/~\//, "/_/"),
                type = $("#entry-menu").attr("class").match(/type\-(\w+)/),
                win;
            if (type) {
                switch (type[1]) {
                case "html":
                case "jpg":
                case "png":
                case "gif":
                    win = window.open(url, "_blank");
                    break;
                case "audio":
                    play(url);
                    break;
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
                view = entry.parents(".view"); // #content-container
            editFile(view, entry.data("id"));
        });

        // Paste a file/folder into a folder
        $("#paste").register("click", function (event) {
            event.stopPropagation();
            if (droppy.socketWait) return;
            if (droppy.clipboard) {
                var sep = getView()[0].currentFolder === "/" ? "" : "/";
                showSpinner();
                droppy.clipboard.to = getView()[0].currentFolder + sep + basename(droppy.clipboard.from);
                sendMessage(null, "CLIPBOARD", droppy.clipboard);
            } else {
                throw "Clipboard was empty!";
            }

            droppy.clipboard = null;
            $("#click-catcher").trigger("click");
            $("#paste").attr("class", "out");
        });

        // Stop navigation when clicking on an <a>
        $(".data-row .zip, .entry-link.file").register("click", function (event) {
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
        $(".data-row .shortlink").register("click", function () {
            if (droppy.socketWait) return;
            sendMessage(null, "REQUEST_SHORTLINK", $(this).parent(".data-row").data("id"));
        });

        // Delete a file/folder
        $("#entry-menu .delete").register("click", function () {
            if (droppy.socketWait) return;
            sendMessage(null, "DELETE_FILE", $("#entry-menu").data("target").data("id"));
            $("#click-catcher").trigger("click");
        });

        $(".icon-play").register("click", function () {
            preparePlayback($(this));
        });

        $(".header-name, .header-mtime, .header-size").register("click", function () {
            sortByHeader($(this));

        });
        // Add missing titles to the SVGs
        $("#entry-menu .rename").attr("title", "Rename");
        $("#entry-menu .delete").attr("title", "Delete");

        droppy.ready = true;
        hideSpinner();
    }

    function sortByHeader(header) {
        var classes = header.attr("class").split(" ");
        for (var i = 0, len = classes.length; i < len; i++) {
            if (classes[i].indexOf("header") >= 0) {
                droppy.sorting.col = classes[i].substring("7");
                break;
            }
        }
        droppy.sorting.dir = header.hasClass("down") ? "up" : "down";
        header.attr("class", "header-" + droppy.sorting.col + " " + droppy.sorting.dir + " active");
        header.siblings().removeClass("active up down");
        $("#content ul").children("li").sort(sortFunc).appendTo($("#content ul"));
    }

    function sortFunc(a, b) {
        function compare(a, b) {
            if (typeof a === "number" && typeof b === "number") {
                return b - a;
            } else {
                return a.toString().toUpperCase().localeCompare(b.toString().toUpperCase());
            }
        }
        if (droppy.sorting.dir !== "down") {
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
    }

    function preparePlayback(playButton) {
        if (droppy.socketWait) return;
        var source = playButton.parent().parent().find(".file-link").attr("href");
        play(source, playButton);
    }

    function closeDoc(view) {
        view.attr("data-type", "directory");
        $(".editor-filename").remove(); // TODO: Change to be view-relative once path is parented to view.
        updateLocation(view, view[0].currentFolder, false, true);
    }

    function editFile(view, entryId) {
        var url = "/_" + entryId,
            filename = entryId.match(/\/(.+$)/)[1],
            editing = true, // Check if not readonly
            editor = null,
            doc = $(
            '<div class="doc' + (editing ? ' editing' : ' readonly') + '">' +
                '<div class="sidebar">' +
                    '<div class="exit">' + droppy.svg.remove + '<span>Close</span></div>' +
                    '<div class="save">' + droppy.svg.disk + '<span>Save</span></div>' +
                    '<div class="light">' + droppy.svg.bulb + '<span>Color</span></div>' +
                    '<div class="opts">' + droppy.svg.cog + '<span>Opts</span></div>' +
                '</div>' +
                '<div class="text-editor">' +
                    '<textarea></textarea>' +
                '</div>' +
            '</div>'
            ), opts = $(
            '<div class="opts-container">' +
                '<select class="indentmode">' +
                  '<option value="spaces">Spaces</option> ' +
                  '<option value="tabs">Tabs</option>' +
                '</select>' +
                '<select class="indentunit">' +
                  '<option value="2">2</option> ' +
                  '<option value="4">4</option>' +
                  '<option value="8">8</option>' +
                '</select>' +
                '<select class="wrap">' +
                  '<option value="nowrap">No Wrap</option> ' +
                  '<option value="wrap">Wrap</option>' +
                '</select>' +
            '</div>');

        view.attr("data-type", "document");
        updatePath(view, view[0].currentFolder, filename.substring(view[0].currentFolder.length));
        loadContent(view, doc);
        doc.append(opts);

        showSpinner();
        $.ajax(url, {
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
                        case "md":
                            return "markdown";
                        default:
                            return ext;
                        }
                    })();
                if (editing) {
                    doc.find(".text-editor pre").hide();
                    editor = doc.find(".text-editor textarea");
                    editor.val(data);
                    editor = CodeMirror.fromTextArea(editor[0], {
                        styleSelectedText: true,
                        showCursorWhenSelecting: true,
                        theme: droppy.get("theme"),
                        indentWithTabs: droppy.get("indentWithTabs"),
                        indentUnit: droppy.get("indentUnit"),
                        lineWrapping: droppy.get("lineWrapping"),
                        lineNumbers: true,
                        // keyMap: "sublime",
                        mode: mode
                    });
                } else {
                    // Set editor to read-only
                }
                hideSpinner();
                doc.find(".exit").register("click", function () {
                    closeDoc(view);
                });
                doc.find(".save").register("click", function () {
                    showSpinner();
                    sendMessage(view[0].vId, "SAVE_FILE", {
                        "to": entryId,
                        "value": editor.getValue()
                    });
                });
                doc.find(".light").register("click", function () {
                    if (editor.options.theme === "base16-dark") {
                        editor.setOption("theme", "base16-light");
                    } else {
                        editor.setOption("theme", "base16-dark");
                    }
                    saveEditorOptions(editor);
                });
                doc.find(".opts").register("click", function () {
                    var container =  $(".opts-container");
                    if (!container.hasClass("in"))
                        container.addClass("in");
                    else
                        container.removeClass("in");
                });
                doc.find(".indentmode").register("change", function (event) {
                    if ($(event.target).val() === "tabs")
                        editor.setOption("indentWithTabs", true);
                    else
                        editor.setOption("indentWithTabs", false);
                    saveEditorOptions(editor);
                });
                doc.find(".indentunit").register("change", function (event) {
                    editor.setOption("indentUnit", Number($(event.target).val()));
                    saveEditorOptions(editor);
                });
                doc.find(".wrap").register("change", function (event) {
                    if ($(event.target).val() === "wrap")
                        editor.setOption("lineWrapping", true);
                    else
                        editor.setOption("lineWrapping", false);
                    saveEditorOptions(editor);
                });
                editor.on("change", function () {
                    $(".editor-filename").removeClass("saved save-failed").addClass("dirty"); // TODO: Change to be view-relative
                });
            },
            error : function () {
                closeDoc(view);
            }
        });
    }

    function saveEditorOptions(editor) {
        ["theme", "indentWithTabs", "indentUnit", "lineWrapping"].forEach(function (option) {
            droppy.set(option, editor.getOption(option));
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
            player.paused ? player.play() : player.pause();
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

    // Wrapper function for setting textContent on an id
    function updateTextbyId(id, text) {
        document.getElementById(id).textContent = text;
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
        droppy.isAnimating = null;
        droppy.isPlaying = null;
        droppy.isUploading = null;
        droppy.mediaTypes = {};
        droppy.ready = null;
        droppy.reopen = null;
        droppy.savedParts = null;
        droppy.socket = null;
        droppy.socketWait = null;
        droppy.sorting = {col: "name", dir: "down"};
        droppy.svg = {};
        droppy.zeroFiles = null;
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

        hrs < 10  && (hrs  = "0" + hrs);
        mins < 10 && (mins = "0" + mins);
        secs < 10 && (secs = "0" + secs);

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

        $("<style></style>").text(css).appendTo($("head"));
    }

    function showSpinner() {
        document.getElementById("spinner").className = "";
    }

    function hideSpinner() {
        document.getElementById("spinner").className = "out";
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

    function basename(path) {
        return path.replace(/.*\//, "");
    }

    function dirname(path) {
        if (path === "/")
            return "/";
        else
            return path.replace(/\/[^\/]*$/, "");
    }
}(jQuery, window, document));
