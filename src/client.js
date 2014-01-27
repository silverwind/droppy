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
        $.when($.ajax("/!/content/" + Math.random().toString(36).substr(2, 4)), $.ajax("/!/svg"))
            .then(function (dataReq, svgReq) {
                droppy.svg = JSON.parse(svgReq[0]);
                loadPage(dataReq[2].getResponseHeader("X-Page-Type"), addSVG(dataReq[0]));
            });
    }
    // {"add-folder":{"data":"<svg>","info":{"width":"32","height":"32"}}}
    function addSVG(html) {
        var tmp;

        Object.keys(droppy.svg).forEach(function (name) {
            tmp = $("<div>" + droppy.svg[name] + "</div>");
            tmp.find("svg").attr("class", "svg-loaded " + name);
            droppy.svg[name] = tmp.html();
        });

        tmp = $("<div>" + html + "</div>");
        tmp.find("svg").replaceWith(function () {
            return $(droppy.svg[$(this).attr("class")]);
        });

        return tmp.html();
    }

    // Switch the page content with an animation
    function loadPage(type, data) {
        $("body").append('<div id="newpage">' + data + '</div>');
        var newPage = $("#newpage"),
            oldPage = $("#page"),
            box     = $("#center-box");
        if (type === "main") {
            droppy.hasLoggedOut = false;
            initMainPage();
            requestAnimation(function () {
                oldPage.attr("class", "out");
                $("#navigation")[0].addEventListener('transitionend', function () {
                    droppy.socketWait && showSpinner();
                }, false);
                $("#navigation").attr("class", "in");
                finalize();
            });
        } else if (type === "auth" || type === "firstrun") {
            initAuthPage(type === "firstrun");
            requestAnimation(function () {
                oldPage.attr("class", "out");
                $("#navigation").addClass("out");
                setTimeout(function () {
                    box.removeClass("out");
                    if (type === "firstrun") {
                        $("#login-info").text("Hello! Choose your creditentials.");
                        $("#login-info-box").attr("class", "info");
                    } else if (droppy.hasLoggedOut) {
                        $("#login-info").text("Logged out!");
                        $("#login-info-box").attr("class", "info");
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

    function requestPage() {
        // Ugly hack to let Chrome offer a password saving dialog
        // http://code.google.com/p/chromium/issues/detail?id=43219
        if (/Chrome/.test(navigator.userAgent)) {
            window.location.reload(false);
        } else {
            getPage();
        }
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
            else
                updateLocation(droppy.currentFolder || "/", false); // Request initial update
        };

        // Close codes: https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent#Close_codes
        droppy.socket.onclose = function (event) {
            if (droppy.hasLoggedOut || event.code === 4000) return;
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
            var msg = JSON.parse(event.data);
            switch (msg.type) {
            case "UPDATE_FILES":
                if (droppy.isUploading) return;
                updateData(msg.folder, msg.data);
                droppy.ready = false;
                break;
            case "UPDATE_SIZES":
                var entries, liveName, interval = 250;
                (function wait(timeout) {
                    if (timeout > 4000) {
                        return;
                    } else if (!droppy.ready) {
                        setTimeout(wait, interval, timeout + interval);
                        return;
                    } else {
                        entries = $('.data-row[data-type="folder"]');
                        if (entries.length) {
                            entries.each(function () {
                                liveName = $(this).data("id").substring(msg.folder.length);
                                liveName = (liveName[0] === "/") ? liveName.substring(1) : liveName;
                                if (msg.data[liveName]) {
                                    var temp = convertToSI(msg.data[liveName]);
                                    $(this).find(".size").text(temp.size > 0 ? temp.size : "");
                                    $(this).find(".size-unit").text(temp.size > 0 ? temp.unit : "");
                                }
                            });
                        } else {
                            setTimeout(wait, interval, timeout + interval);
                        }
                    }
                })(interval);

                break;
            case "UPLOAD_DONE":
                if (droppy.zeroFiles.length) {
                    sendMessage("ZERO_FILES", droppy.zeroFiles);
                    droppy.zeroFiles = [];
                } else {
                    droppy.isUploading = false;
                    updateLocation(droppy.currentFolder, false);
                    updateTitle(droppy.currentFolder, true);
                    $("#upload-info").removeClass("in").removeClass("in-space");
                    hideSpinner();
                }
                break;
            case "NEW_FOLDER":
                if (droppy.isUploading) return;
                updateData(msg.folder, msg.data);
                hideSpinner();
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
                        requestPage();
                        droppy.hasLoggedOut = false;
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
        droppy.currentFolder = decodeURIComponent(window.location.pathname);

        // Open the WebSocket
        openSocket();

        // Stop dragenter and dragover from killing our drop event
        $(document.documentElement).register("dragenter", function (event) { event.preventDefault(); });
        $(document.documentElement).register("dragover", function (event) { event.preventDefault(); });

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
                upload(event.dataTransfer.files);
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
                upload($("#file").get(0).files);
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

        var info         = $("#editbox-info"),
            editInput    = $("#editbox-input"),
            editbox      = $("#edit-box"),
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
                    info.text(exists ? "Already exists!" : "Invalid characters!");
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
                showSpinner();
                sendMessage("CREATE_FOLDER",
                    droppy.currentFolder === "/" ? "/" + editInput.val() : droppy.currentFolder + "/" + editInput.val()
                );
            } else if (editbox.data("type") === "rename") {
                showSpinner();
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
                sendMessage("UPDATE_USER", user);
            });
            configbox.attr("class", "out");
            toggleCatcher();
        });

        $("#logout").register("click", function () {
            droppy.socket && droppy.socket.close(4001);
            deleteCookie("session");
            initVariables(); // Reset vars to their init state
            droppy.hasLoggedOut = true;
            window.location.reload(false);
            requestPage();
        });

        // Hide modals when clicking outside their box
        $("#click-catcher").register("click", function () {
            $("#config-box").attr("class", "out");
            $("#edit-box").attr("class", "out");
            $("#about-box").attr("class", "out");
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
            player     = document.getElementById("audio-player");

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
            tooltip.attr("class", "");
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

        player.volume = localStorage.getItem("volume") || 0.5;
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
            localStorage.setItem("volume", volume);
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
            updateTitle(droppy.currentFolder, true);
            updateTextbyId("audio-title", matches[matches.length - 1].replace(/_/g, " ").replace(/\s+/, " "));
            $("#content, #newcontent").addClass("squeeze");
            controls.removeClass("out");
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
            updateTitle(droppy.currentFolder, true);
            setTimeout(function () {
                if (!droppy.isPlaying) {
                    controls.addClass("out");
                    $("#content, #newcontent").removeClass("squeeze");
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
        function upload(data) {
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
                    droppy.currentData[filename] = {
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
                                droppy.currentData[name] = {
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
            $("#upload-info").addClass($("#audio-controls").hasClass("out") ? "in" : "in-space");

            // And send the files
            droppy.isUploading = true;

            if (formLength) {
                xhr.open("POST", "/upload");
                xhr.send(formData);
            } else if (droppy.zeroFiles.length) {
                sendMessage("ZERO_FILES", droppy.zeroFiles);
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
    function showEditBox(type, prefill) {
        var box = $("#edit-box"), input = $("#editbox-input"), lastDot;

        droppy.activeFiles = [];
        $(".filelink, .folderlink").each(function () {
            droppy.activeFiles.push($(this).text().toLowerCase());
        });

        box.data("type", type);
        if (prefill) input.val(prefill);

        if (type === "create-folder") {
            $("#editbox-name").text("Create");
            input.attr("placeholder", "Folder Name");
        } else if (type === "rename") {
            $("#editbox-name").text("Rename");
            input.attr("placeholder", prefill);
        }

        requestAnimation(function () {
            box.attr("class", box.attr("class") !== "in" ? "in" : "out");
            toggleCatcher();
            setTimeout(function () {
                input.focus();
                if (type === "rename") {
                    lastDot = input.val().lastIndexOf(".");
                    if (lastDot > 0) input[0].setSelectionRange(0, lastDot);
                }
            }, 200);
        });
    }

    // Toggle the full-screen click catching frame if any modals are shown
    function toggleCatcher() {
        if ($("#about-box").attr("class")  === "in" ||
            $("#edit-box").attr("class")   === "in" ||
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
                showSpinner();

                // Find the direction in which we should animate
                if (path.length > droppy.currentFolder.length) nav = "forward";
                else if (path.length === droppy.currentFolder.length) nav = "same";
                else nav = "back";

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
        var width = 60,
            space = $(window).width(),
            pathElements = document.querySelectorAll("#path li");

        for (var i = 0, l = pathElements.length; i < l; i++) {
            width += pathElements[i].offsetWidth;
        }

        if (width > space) {
            requestAnimation(function () {
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
    function buildHTML(fileList, root, isUpload) {
        var list = $("<ul></ul>"), downloadURL, type, temp, size, sizeUnit, mtime, id, tags, audio;

        for (var file in fileList) {
            if (fileList.hasOwnProperty(file)) {
                type = fileList[file].type;
                temp = convertToSI(fileList[file].size);
                size = temp.size > 0 ? temp.size : "0";
                sizeUnit = temp.size > 0 ? temp.unit : "b";
                mtime = fileList[file].mtime;
                id = (root === "/") ? "/" + file : root + "/" + file;
                tags = (type === "nf" || type === "nd") ? " tag-uploading" : "";

                if (type === "f" || type === "nf") { // Create a file row
                    var ext = getExt(file), spriteClass = getSpriteClass(ext);
                    downloadURL = "/~" + id;
                    audio = /^.+\.(mp3|ogg|wav|wave|webm)$/.test(file) ? '<span class="icon-play">' + droppy.svg.play + '</span>' : "";
                    if (!droppy.mediaTypes[ext]) droppy.mediaTypes[ext] = fileList[file].mime;
                    if (isUpload) file = decodeURIComponent(file);
                    list.append(
                        '<li class="data-row' + (audio ? ' playable"' : '"') + ' data-type="file" data-id="' + id + '">' +
                            '<span class="' + spriteClass + '">' + audio + '</span>' +
                            '<a class="filelink' + tags + '" href="' + downloadURL + '" download="' + file + '">' + file + '</a>' +
                            '<span class="mtime" data-timestamp="' + mtime + '">' + timeDifference(mtime) + '</span>' +
                            '<span class="size">' + size + '</span>' +
                            '<span class="size-unit">' + sizeUnit + '</span>' +
                            '<span class="shortlink">' + droppy.svg.link + '</span>' +
                            '<span class="edit">' + droppy.svg.pencil + '</span>' +
                            '<span class="delete">' + droppy.svg.trash + '</span>' +
                        '</li>'
                    );
                } else if (type === "d" || type === "nd") {  // Create a folder row
                    if (isUpload) file = decodeURIComponent(file);
                    list.append(
                        '<li class="data-row" data-type="folder" data-id="' + id + '">' +
                            '<span class="sprite sprite-folder"></span>' +
                            '<span class="folderlink ' + tags + '">' + file + '</span>' +
                            '<span class="mtime" data-timestamp="' + mtime + '">' + timeDifference(mtime) + '</span>' +
                            '<span class="size">' + size + '</span>' +
                            '<span class="size-unit">' + sizeUnit + '</span>' +
                            '<span><a class="zip" title="Create Zip" href="/~~' + id + '" download="' + file + '.zip">' + droppy.svg.zip + '</a></span>' +
                            '<span class="edit">' + droppy.svg.pencil + '</span>' +
                            '<span class="delete">' + droppy.svg.trash + '</span>' +
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
    function loadContent(html) {
        var emptyPage = '<div id="empty">' + droppy.svg["upload-cloud"] + '<div class="text">Add files</div></div>';

        $('<div class="header"><span class="header-name">Name</span><span class="header-mtime">Modified</span><span class="header-size">Size</span></div>').prependTo(html);

        requestAnimation(function () {
            if (nav === "same") {
                $("#content").attr("class", "center");
                $("#content").html(html || emptyPage);
            } else {
                $("#page").append($("<section id='newcontent' class='" + nav + "'></section>"));
                $("#newcontent").html(html || emptyPage);
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
        // Upload button on empty page
        $("#empty").register("click", function () {
            if (droppy.detects.fileinputdirectory)
                $("#file").removeAttr("directory msdirectory mozdirectory webkitdirectory");
            $("#file").click();
        });

        // Switch into a folder
        $(".data-row[data-type='folder']").register("click", function () {
            if (droppy.socketWait) return;
            var destination = $(this).data("id");
            updateLocation(destination, true);
        });

        // Rename a file/folder
        $(".data-row .edit").register("click", function (event) {
            if (droppy.socketWait) return;
            showEditBox("rename", $(this).parent().find(".filelink, .folderlink").text());
            event.stopPropagation();
        });

        // Stop navigation when clicking on an <a>
        $(".data-row .zip, .filelink").register("click", function (event) {
            if (droppy.socketWait) return;
            event.stopPropagation();

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
            sendMessage("REQUEST_SHORTLINK", $(this).parent().data("id"));
        });

        // Delete a file/folder
        $(".data-row .delete").register("click", function () {
            if (droppy.socketWait) return;
            sendMessage("DELETE_FILE", $(this).parent().data("id"));
        });

        $(".icon-play").register("click", function () {
            preparePlayback($(this));
        });

        // Add missing titles to the SVGs
        $(".data-row .shortlink").attr("title", "Create Shortink");
        $(".data-row .edit").attr("title", "Rename");
        $(".data-row .delete").attr("title", "Delete");

        droppy.ready = true;
        hideSpinner();
    }

    function preparePlayback(playButton) {
        if (droppy.socketWait) return;
        var source = playButton.parent().parent().find(".filelink").attr("href");
        play(source, playButton);
    }

    function play(source, playButton) {
        var player = document.getElementById("audio-player");

        if (!player.canPlayType(droppy.mediaTypes[getExt(source)])) {
            window.alert("Sorry, your browser can't play this file.");
            return;
        }

        $(".filelink").parent().removeClass("playing").removeClass("paused");
        $(".icon-play").html(droppy.svg.play);

        if (decodeURI(player.src).indexOf(source) > 0) {
            player.paused ? player.play() : player.pause();
        } else {
            player.src = source;
            player.load();
            player.play();
        }

        if (player.paused) {
            playButton.parent().parent().removeClass("playing").addClass("paused");
        } else {
            playButton.parent().parent().removeClass("paused").addClass("playing");
        }
        playButton.html(player.paused ? droppy.svg.play : droppy.svg.pause);
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
        droppy.debug = null;  // live css reload and debug logging - this variable is set by the server
        droppy.activeFiles = [];
        droppy.audioUpdater = null;
        droppy.currentData = null;
        droppy.currentFolder = null;
        droppy.hasLoggedOut = null;
        droppy.isAnimating = null;
        droppy.isPlaying = null;
        droppy.isUploading = null;
        droppy.mediaTypes = {};
        droppy.ready = null;
        droppy.reopen = null;
        droppy.savedParts = null;
        droppy.socket = null;
        droppy.socketWait = null;
        droppy.svg = {},
        droppy.zeroFiles;
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
}(jQuery, window, document));