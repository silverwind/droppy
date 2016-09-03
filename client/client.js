/* global jQuery, CodeMirror, videojs, Draggabilly, Mousetrap, fileExtension, Handlebars, Uppie, screenfull */
(function($) {
  "use strict";
  var droppy = {};

  /* {{ templates }} */

  initVariables();
// ============================================================================
//  Feature Detects
// ============================================================================
  droppy.detects = {
    directoryUpload: (function() {
      var el = document.createElement("input");
      return droppy.dir.some(function(prop) {
        if (prop in el) return true;
      });
    })(),
    audioTypes: (function() {
      var types = {}, el = document.createElement("audio");
      Object.keys(droppy.audioTypes).forEach(function(type) {
        types[droppy.audioTypes[type]] = Boolean(el.canPlayType(droppy.audioTypes[type]).replace(/no/, ""));
      });
      return types;
    })(),
    videoTypes: (function() {
      var types = {}, el = document.createElement("video");
      Object.keys(droppy.videoTypes).forEach(function(type) {
        types[droppy.videoTypes[type]] = Boolean(el.canPlayType(droppy.videoTypes[type]).replace(/no/, ""));
      });
      return types;
    })(),
    webp: document.createElement("canvas").toDataURL("image/webp").indexOf("data:image/webp") === 0,
    notification: "Notification" in window,
    mobile: /Mobi/.test(navigator.userAgent)
  };
// ============================================================================
//  Set up a few more things
// ============================================================================
  // Shorthand for safe event listeners
  $.fn.register = function(events, callback) {
    return this.off(events).on(events, callback);
  };
  $.fn.registerOne = function(events, callback) {
    return this.off(events).one(events, callback);
  };

  // Transition of freshly inserted elements
  $.fn.transition = function(oldClass, newClass) {
    if (!newClass) { newClass = oldClass; oldClass = null; }

    // Force a reflow
    // https://gist.github.com/paulirish/5d52fb081b3570c81e3a
    this.r = this[0].offsetTop;
    delete this.r;

    if (oldClass)
      this.replaceClass(oldClass, newClass);
    else
      this.addClass(newClass);

    return this;
  };

  // transitionend helper, makes sure the callback gets fired regardless if the transition gets cancelled
  $.fn.transitionend = function(callback) {
    if (!this.length) return;
    var duration, called = false, el = this[0];

    function doCallback(event) {
      if (called) return;
      called = true;
      callback.apply(el, event);
    }

    duration = getComputedStyle(el).transitionDuration;
    duration = (duration.indexOf("ms") > -1) ? parseFloat(duration) : parseFloat(duration) * 1000;

    setTimeout(function() { // Call back if "transitionend" hasn't fired in duration + 30
      doCallback({target: el}); // Just mimic the event.target property on our fake event
    }, duration + 30);

    return this.one("transitionend", doCallback);
  };

  // Class swapping helper
  $.fn.replaceClass = function(search, replacement) {
    var el, classes, matches, i = this.length, hasClass = false;
    while (--i >= 0) {
      el = this[i];
      if (el === undefined) return false;
      classes = el.className.split(" ").filter(function(className) {
        if (className === search) return false;
        if (className === replacement) hasClass = true;

        matches = search instanceof RegExp ? search.exec(className) : className.match(search);
        // filter out if the entire capture matches the entire className
        if (matches) return matches[0] !== className || matches[0] === replacement;
        else return true;
      });
      if (!hasClass) classes.push(replacement);
      if (classes.length === 0 || (classes.length === 1 && classes[0] === ""))
        el.removeAttribute("class");
      else
        el.className = classes.join(" ");
    }
    return this;
  };

  Handlebars.registerHelper("select", function(sel, opts) {
    return opts.fn(this).replace(new RegExp(' value="' + sel + '"'), "$& selected=");
  });
  Handlebars.registerHelper("is", function(a, b, opts) {
    return a === b ? opts.fn(this) : opts.inverse(this);
  });

  function svg(which) {
    return '<svg class="' + which + '"><use xlink:href="#i-' + which + '"></svg>';
  }
  Handlebars.registerHelper("svg", svg);

  if (droppy.detects.mobile)
    $("html").addClass("mobile");
  if (droppy.detects.webp)
    droppy.imageTypes.webp = "image/webp";
// ============================================================================
//  localStorage wrapper functions
// ============================================================================
  var prefs, doSave, defaults = {
    volume: .5,
    theme: "droppy",
    editorFontSize: droppy.detects.mobile ? 12 : 16,
    indentWithTabs: false,
    indentUnit: 4,
    lineWrapping: false,
    renameExistingOnUpload: false
  };

  function savePrefs(prefs) {
    try { localStorage.setItem("prefs", JSON.stringify(prefs)); } catch (e) {}
  }
  function loadPrefs() {
    return JSON.parse(localStorage.getItem("prefs") || "{}");
  }

  // Load prefs and set missing ones to their default
  prefs = loadPrefs();
  Object.keys(defaults).forEach(function(pref) {
    if (prefs[pref] === undefined) {
      doSave = true;
      prefs[pref] = defaults[pref];
    }
  });
  if (doSave) savePrefs(prefs);

  // Get a variable from localStorage
  droppy.get = function(pref) {
    prefs = loadPrefs();
    return prefs[pref];
  };

  // Save a variable to localStorage
  droppy.set = function(pref, value) {
    prefs[pref] = value;
    savePrefs(prefs);
  };
// ============================================================================
//  Entry point
// ============================================================================
  var type = $("html").data("type");
  if (type === "main") {
    initMainPage();
  } else {
    var isFirst = type === "firstrun";
    if (isFirst) $("#login-info").text("Hello! Choose your credentials.");
    initAuthPage(isFirst);
  }
// ============================================================================
//  View handling
// ============================================================================
  function getView(id) {
    return $(droppy.views[id]);
  }

  function getOtherViews(id) {
    return $(droppy.views.filter(function(_, i) { return i !== id; }));
  }

  function getActiveView() {
    return $(droppy.views[droppy.activeView]);
  }

  function newView(dest, vId) {
    var view = $(Handlebars.templates.view());
    getView(vId).remove();
    view.appendTo("#view-container");
    view[0].vId = vId;
    view[0].uId = 0;
    droppy.views[vId] = view[0];
    if (dest) updateLocation(view, dest);
    bindDropEvents(view);
    bindHoverEvents(view);
    allowDrop(view);
    checkClipboard();
    return getView(vId);
  }

  function destroyView(vId) {
    getView(vId).remove();
    droppy.views = droppy.views.filter(function(_, i) { return i !== vId; });
    sendMessage(vId, "DESTROY_VIEW");
  }
// ============================================================================
//  WebSocket handling
// ============================================================================
  function init() {
    droppy.wsRetries = 5; // reset retries on connection loss
    // Request settings when droppy.debug is uninitialized, could use another variable too.
    if (droppy.debug === null)
      sendMessage(null, "REQUEST_SETTINGS");
    if (droppy.queuedData) {
      sendMessage();
    } else {
      // Create new view with initializing
      getLocationsFromHash().forEach(function(string, index) {
        var dest = join(decodeURIComponent(string));
        if (index === 0)
          newView(dest, index);
        else if (index === 1) {
          droppy.split(dest);
        }
      });
    }
  }

  function openSocket() {
    var protocol = document.location.protocol === "https:" ? "wss://" : "ws://";
    var url = protocol + document.location.host + document.location.pathname + "!/socket";
    droppy.socket = new WebSocket(url);
    droppy.socket.onopen = function() {
      if (droppy.token) {
        init();
      } else {
        ajax("!/token").then(function(xhr) {
          droppy.token = xhr.response;
          init();
        });
      }
    };
    // Close codes: https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent#Close_codes
    droppy.socket.onclose = function(event) {
      if (event.code === 4000) return;
      if (event.code === 1011) {
        droppy.token = null;
        openSocket();
      } else if (event.code >= 1001 && event.code < 3999) {
        if (droppy.wsRetries > 0) {
          // Gracefully reconnect on abnormal closure of the socket, 1 retry every 4 seconds, 20 seconds total.
          // TODO: Indicate connection drop in the UI, especially on close code 1006
          setTimeout(function() {
            openSocket();
            droppy.wsRetries--;
          }, droppy.wsRetryTimeout);
        }
      } else if (droppy.reopen) {
        droppy.reopen = false;
        openSocket();
      }
    };
    droppy.socket.onmessage = function(event) {
      var msg = JSON.parse(event.data), vId = msg.vId, view = getView(vId);
      droppy.socketWait = false;
      msg = JSON.parse(event.data);
      switch (msg.type) {
      case "UPDATE_DIRECTORY":
        if (typeof view.data("type") === "undefined" || view[0].switchRequest) view.data("type", "directory"); // For initial loading
        if (!view.length) return;

        if (view.data("type") === "directory") {
          if (msg.folder !== getViewLocation(view)) {
            view[0].currentFile = null;
            view[0].currentFolder = msg.folder;
            if (view[0].vId === 0) setTitle(basename(msg.folder));
            replaceHistory(view, join(view[0].currentFolder, view[0].currentFile));
            updatePath(view);
          }
          view[0].switchRequest = false;
          view[0].currentData = msg.data;
          openDirectory(view);
        } else if (view.data("type") === "media") {
          view[0].currentData = msg.data;
          populateMediaCache(view, msg.data);
          updateMediaMeta(view);
          bindMediaArrows(view);
        }
        break;
      case "UPDATE_BE_FILE":
        openFile(getView(vId), msg.folder, msg.file);
        break;
      case "RELOAD":
        if (msg.css) {
          $("#css").remove();
          $("<style id='css'></style>").text(msg.css).appendTo($("head"));
        } else location.reload(true);
        break;
      case "SHARELINK":
        hideSpinner(view);
        droppy.linkCache.push({
          location: view[0].sharelinkId,
          link: msg.link,
          attachement: msg.attachement,
        });
        showLink(view, msg.link, msg.attachement);
        break;
      case "USER_LIST":
        updateUsers(msg.users);
        break;
      case "SAVE_STATUS":
        hideSpinner(view);

        var file = view.find(".path li:last-child");
        var oldStyle = file.attr("style");

        file.find("svg")[0].style.transition = "fill .2s ease";
        file.removeClass("dirty").attr("style", "transition: background .2s ease;")
          .addClass(msg.status === 0 ? "saved" : "save-failed");
        setTimeout(function() {
          file.removeClass("saved save-failed").transitionend(function() {
            $(this).attr("style", oldStyle);
            $(this).children("svg").removeAttr("style");
          });
        }, 1000);
        break;
      case "SETTINGS":
        Object.keys(msg.settings).forEach(function(setting) {
          droppy[setting] = msg.settings[setting];
        });

        $("#about-title").text("droppy " + droppy.version);
        $("#about-engine").text(droppy.engine);

        droppy.themes = droppy.themes.split("|");
        droppy.modes = droppy.modes.split("|");

        // Move own theme to top of theme list
        droppy.themes.pop();
        droppy.themes.unshift("droppy");

        // Insert plain mode on the top
        droppy.modes.unshift("plain");

        if (droppy.demo || droppy.public)
          $("#logout-button").addClass("disabled")
            .register("click", showError.bind(null, getView(0), "Signing out is disabled"));
        else
          $("#logout-button").register("click", function() {
            ajax({method: "POST", url: getRootPath() + "!/logout"}).then(function() {
              location.reload(true);
            });
          });
        break;
      case "ERROR":
        showError(view, msg.text);
        hideSpinner(view);
        break;
      }
    };
  }
  function sendMessage(vId, type, data) {
    var sendObject = {vId: vId, type: type, data: data, token: droppy.token};
    if (typeof sendObject.data === "string") {
      sendObject.data = normalize(sendObject.data);
    } else if (typeof sendObject.data === "object") {
      Object.keys(sendObject.data).forEach(function(key) {
        if (typeof sendObject.data[key] === "string") {
          sendObject.data[key] = normalize(sendObject.data[key]);
        }
      });
    }
    var json = JSON.stringify(sendObject);

    if (droppy.socket.readyState === 1) { // open
      // Lock the UI while we wait for a socket response
      droppy.socketWait = true;
      // Unlock the UI in case we get no socket resonse after waiting for 1 second
      setTimeout(function() {
        droppy.socketWait = false;
      }, 1000);
      if (droppy.queuedData) {
        droppy.socket.send(droppy.queuedData);
        droppy.queuedData = null;
      }
      droppy.socket.send(json);
    } else {
      // We can't send right now, so queue up the last added message to be sent later
      droppy.queuedData = json;
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
  $(window).register("beforeunload", function() {
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
    $("#user, #pass, .submit").register("keydown", function(event) {
      if (event.keyCode === 13) form.submit();
    });
    $(".remember").register("click", function() {
      $(".remember").toggleClass("checked");
      $("[name=remember]").attr("value", $(".remember").hasClass("checked") ? "1" : "");
    });
    form.register("submit", function(e) {
      e.preventDefault();
      ajax({
        method: "POST",
        url: getRootPath() + "!/" + (firstrun ? "adduser" : "login"),
        data: new FormData(form[0])
      }).then(function(xhr) {
        if (xhr.status === 200) {
          location.reload(true);
        } else {
          var info = $("#login-info-box");
          info.text(firstrun ? "Please fill both fields." : "Wrong login!");
          if (info.hasClass("error")) {
            info.addClass("shake");
            setTimeout(function() {
              info.removeClass("shake");
            }, 500);
          } else info.attr("class", "error");
          if (!firstrun) $("#pass").focus();
        }
      });
    });
  }
// ============================================================================
//  Main page
// ============================================================================
  function initMainPage() {
    // Open the WebSocket
    openSocket();

    // Re-fit path line after 25ms of no resizing
    $(window).register("resize", function() {
      clearTimeout(droppy.resizeTimer);
      droppy.resizeTimer = setTimeout(function() {
        $(".view").each(function() {
          checkPathOverflow($(this));
          aspectScale();
        });
      }, 25);
    });

    Mousetrap.bind("escape", function() { // escape hides modals
      toggleCatcher(false);
    }).bind("mod+s", function(e) { // stop default browser save behaviour
      e.preventDefault();
    }).bind(["space", "right", "down", "return"], function() {
      var view = getActiveView();
      if (!view || view.data("type") !== "media") return;
      swapMedia(view, "right");
    }).bind(["shift+space", "left", "up", "backspace"], function() {
      var view = getActiveView();
      if (!view || view.data("type") !== "media") return;
      swapMedia(view, "left");
    }).bind(["alt+enter", "f"], function() {
      var view = getActiveView();
      if (!view || view.data("type") !== "media") return;
      screenfull.toggle(view.find(".content")[0]);
    });

    // track active view
    $(window).on("click dblclick contextmenu", function(e) {
      var view = $(e.target).parents(".view");
      if (view.length) droppy.activeView = view[0].vId;
    });

    $(document).register(screenfull.raw.fullscreenchange, function() {
      // unfocus the fullscreen button so the space key won't un-toggle fullscreen
      document.activeElement.blur();
      $(".full svg, .fs svg").replaceWith(svg(screenfull.isFullscreen ? "unfullscreen" : "fullscreen"));
    });

    var fileInput = $("#file"), uppie = new Uppie();
    uppie(fileInput[0], function(event, fd, files) {
      event.preventDefault();
      event.stopPropagation();
      var view = getActiveView();
      upload(view, fd, files, view[0].uId += 1);
      fileInput.val("");
    });

    // File upload button
    $("#add-file-button").register("click", function() {
      if ($(this).hasClass("disabled")) return;
      // Remove the directory attributes so we get a file picker dialog!
      if (droppy.detects.directoryUpload)
        fileInput.removeAttr(droppy.dir.join(" "));
      fileInput[0].click();
    });

    // Folder upload button - check if we support directory uploads
    if (droppy.detects.directoryUpload) {
      // Directory uploads supported - enable the button
      $("#add-folder-button").register("click", function() {
        if ($(this).hasClass("disabled")) return;
        // Set the directory attribute so we get a directory picker dialog
        droppy.dir.forEach(function(prefix) {
          fileInput.attr(prefix, prefix);
        });
        if (fileInput[0].isFilesAndDirectoriesSupported) {
          fileInput[0].click();
        } else if (fileInput[0].chooseDirectory) {
          fileInput[0].chooseDirectory();
        } else {
          fileInput[0].click();
        }
      });
    } else {
      // No directory upload support - disable the button
      $("#add-folder-button").addClass("disabled").on("click", function() {
        showError(getView(0), "Your browser doesn't support directory uploading");
      });
    }

    var createButtons = $("#create-file-button, #create-folder-button");
    function createEntry() {
      var view    = getActiveView();
      if (view.data("type") !== "directory") return;
      var isFile  = this.id === "create-file-button";
      var isEmpty = view.find(".empty").length;
      var html    = Handlebars.templates[isFile ? "new-file" : "new-folder"]();

      stopEdit(view, view.find(".editing"), !view.find(".data-row").length);

      if (isEmpty)
        view.find(".content").html(Handlebars.templates["file-header"]() + html);
      else
        view.find(".content").prepend(html);

      view.find(".content")[0].scrollTop = 0;
      var dummy = $(".data-row.new-" + (isFile ? "file" : "folder"));
      entryRename(view, dummy, isEmpty, function(_success, _oldVal, newVal) {
        if (view.data("type") === "directory") showSpinner(view);
        sendMessage(view[0].vId, "CREATE_" + (isFile ? "FILE" : "FOLDER"), newVal);
      });

      $(this).one("click", function(e) {
        e.stopImmediatePropagation();
        stopEdit(view, dummy, isEmpty);
        createButtons.register("click", createEntry);
      });
    }
    createButtons.register("click", createEntry);

    var splitButton = $("#split-button"), splitting;
    droppy.split = function(dest) {
      var first, second;
      if (splitting) return;
      splitting = true;
      first = getView(0);
      if (droppy.views.length === 1) {
        first.addClass("left");
        if (typeof dest !== "string") dest = join(first[0].currentFolder, first[0].currentFile);
        second = newView(dest, 1).addClass("right");
        splitButton.attr("aria-label", "Merge views together").children("span").text("Merge");
        replaceHistory(second, join(second[0].currentFolder, second[0].currentFile));
      } else {
        destroyView(1);
        getView(0).removeClass("left");
        splitButton.attr("aria-label", "Split view in half").children("span").text("Split");
        replaceHistory(first, join(first[0].currentFolder, first[0].currentFile));
      }
      first.transitionend(function() {
        droppy.views.forEach(function(view) {
          checkPathOverflow($(view));
        });
        splitting = false;
      });
    };
    $("#split-button").register("click", droppy.split);

    $("#about-button").register("click", function() {
      $("#about-box").addClass("in");
      toggleCatcher();
    });

    $("#prefs-button").register("click", function() {
      showPrefs();
      if (droppy.priv) sendMessage(null, "GET_USERS");
    });

    initEntryMenu();
  }
  // ============================================================================
  //  Upload functions
  // ============================================================================
  function upload(view, fd, files, id) {
    if (!files || !files.length) return showError(view, "Unable to upload.");

    // Create the XHR2 and bind the progress events
    var xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", function(e) {
      if (e.lengthComputable) uploadProgress(view, id, e.loaded, e.total);
    });
    xhr.upload.addEventListener("error", function() {
      showError(view, "An error occured during upload.");
      uploadCancel(view, id);
    });
    xhr.addEventListener("readystatechange", function() {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        uploadSuccess(id);
      } else {
        if (xhr.status === 0) return; // cancelled by user
        showError(view, "Server responded with HTTP " + xhr.status);
        uploadCancel(view, id);
      }
      uploadFinish(view, id);
    });

    $(Handlebars.templates["upload-info"]({
      id: id,
      title: files.length === 1 ? basename(files[0]) : files.length + " files",
    })).appendTo(view).transition("in").find(".upload-cancel").register("click", function() {
      xhr.abort();
      uploadCancel(view, id);
    });

    view[0].isUploading = true;
    view[0].uploadStart = Date.now();

    xhr.open("POST", getRootPath() + "!/upload?vId=" + view[0].vId +
     "&to=" + encodeURIComponent(view[0].currentFolder) +
     "&r=" + (droppy.get("renameExistingOnUpload") && "1" || "0")
    );
    xhr.send(fd);
  }

  function uploadSuccess(id) {
    var info = $(".upload-info[data-id=\"" + id + "\"]");
    info.find(".upload-bar")[0].style.width = "100%";
    info.find(".upload-percentage").text("100%");
    info.find(".upload-title").text("Processing ...");
  }

  function uploadCancel(view, id) {
    uploadFinish(view, id);
    sendMessage(view[0].vId, "REQUEST_UPDATE", view[0].currentFolder);
  }

  function uploadFinish(view, id) {
    view[0].isUploading = false;
    setTitle(basename(view[0].currentFolder));
    setTimeout(function() {
      $(".upload-info[data-id=\"" + id + "\"]").removeClass("in").transitionend(function() {
        $(this).remove();
      });
    }, 250);
    showNotification("Upload finished", "Uploaded to " + view[0].currentFolder + " finished");
  }

  var lastUpdate;
  function uploadProgress(view, id, sent, total) {
    // Update progress every 100ms at most
    if (!lastUpdate || (Date.now() - lastUpdate) >= 100) {
      var info     = $(".upload-info[data-id=\"" + id + "\"]");
      var progress = (Math.round((sent / total) * 1000) / 10).toFixed(0) + "%";
      var speed    = sent / ((Date.now() - view[0].uploadStart) / 1e3);
      var elapsed, secs;

      elapsed = Date.now() - view[0].uploadStart;
      secs = ((total / (sent / elapsed)) - elapsed) / 1000;

      if (Number(view.find(".upload-info")[0].dataset.id) === id)
        setTitle(progress);
      info.find(".upload-bar")[0].style.width = progress;
      info.find(".upload-percentage").text(progress);
      info.find(".upload-time").text([
        secs > 60 ? Math.ceil(secs / 60) + " mins" : Math.ceil(secs) + " secs",
        formatBytes(Math.round(speed / 1e3) * 1e3) + "/s",
      ].join(" @ "));
      lastUpdate = Date.now();
    }
  }
// ============================================================================
//  General helpers
// ============================================================================
  function entryRename(view, entry, wasEmpty, callback) {
    var canSubmit, exists, valid, link, nameLength;
    // Populate active files list
    droppy.activeFiles = [];
    view.find(".entry-link").each(function() {
      $(this).removeClass("editing invalid");
      droppy.activeFiles.push(droppy.caseSensitive ? $(this).text() : $(this).text().toLowerCase());
    });

    // Hide menu, overlay and the original link, stop any previous edits
    toggleCatcher(false);
    link = entry.find(".entry-link");
    entry.addClass("editing");

    // Add inline element
    var renamer = $('<input type="text" class="inline-namer" value="' + link.text() +
                    '" placeholder="' + link.text() + '">').insertAfter(link);
    renamer.register("input", function() {
      var input = this.value;
      valid = !/[\\\*\{\}\/\?\|<>"]/.test(input);
      if (input === "") valid = false;
      exists = droppy.activeFiles.some(function(file) {
        if (file === (droppy.caseSensitive ? input : input.toLowerCase())) return true;
      });
      canSubmit = valid && (!exists || input === this.attr("placeholder"));
      entry[canSubmit ? "removeClass" : "addClass"]("invalid");
    }).register("blur focusout", submitEdit.bind(null, view, true, callback));

    nameLength = link.text().lastIndexOf(".");
    renamer[0].setSelectionRange(0, nameLength > -1 ? nameLength : link.text().length);
    renamer[0].focus();

    Mousetrap(renamer[0])
      .bind("escape", stopEdit.bind(null, view, entry, wasEmpty))
      .bind("return", submitEdit.bind(null, view, false, callback));

    function submitEdit(view, skipInvalid, callback) {
      var success, oldVal = renamer.attr("placeholder"), newVal = renamer.val();
      if (canSubmit) {
        if (oldVal !== newVal) success = true;
      } else if (exists && !skipInvalid) {
        renamer.addClass("shake");
        setTimeout(function() {
          renamer.removeClass("shake");
        }, 500);
      } else {
        success = false;
        stopEdit(view, entry, wasEmpty);
      }
      if (typeof success === "boolean" && typeof callback === "function") {
        callback(success, join(view[0].currentFolder, oldVal), join(view[0].currentFolder, newVal));
      }
    }
  }

  function stopEdit(view, entry, wasEmpty) {
    entry.removeClass("editing invalid");
    view.find(".inline-namer, .data-row.new-file, .data-row.new-folder").remove();
    if (wasEmpty) view.find(".content").html(Handlebars.templates.directory({entries: []}));
  }

  function toggleCatcher(show) {
    var cc = $("#overlay"), modals = ["#prefs-box", "#about-box", "#entry-menu", "#drop-select", ".info-box"];

    if (show === undefined)
      show = modals.some(function(selector) { return $(selector).hasClass("in"); });

    if (!show) {
      modals.forEach(function(selector) { $(selector)[show ? "addClass" : "removeClass"]("in"); });
      $(".data-row.active").removeClass("active");
    }

    cc.register("click", toggleCatcher.bind(null, false));
    cc[show ? "addClass" : "removeClass"]("in");
  }

  // Update the page title
  function setTitle(text) {
    document.title = (text || "/") + " - droppy";
  }

  // Listen for popstate events, which indicate the user navigated back
  $(window).register("popstate", function() {
    if (!droppy.socket) return;
    var locs = getLocationsFromHash();
    droppy.views.forEach(function(view) {
      var dest = locs[view.vId];
      view.switchRequest = true;
      setTimeout(function() { view.switchRequest = false; }, 1000);
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

    locations.forEach(function(part, i) {
      locations[i] = part.replace(/\/*$/g, "");
      if (locations[i] === "") locations[i] = "/";
    });
    return locations;
  }

  function getHashPaths(modview, dest) {
    var path = document.location.pathname;
    droppy.views.forEach(function(view) {
      view = $(view);
      if (modview && modview.is(view))
        path += "/#" + dest;
      else
        path += "/#" + getViewLocation(view);
    });
    return path.replace(/\/+/g, "/");
  }

  function pushHistory(view, dest) {
    history.pushState(null, null, getHashPaths(view, dest));
  }

  function replaceHistory(view, dest) {
    history.replaceState(null, null, getHashPaths(view, dest));
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
          if (!viewLoc || viewDest.length === viewLoc.length)
            view[0].animDirection = "center";
          else if (viewDest.length > viewLoc.length)
            view[0].animDirection = "forward";
          else
            view[0].animDirection = "back";

          sendMessage(view[0].vId, "REQUEST_UPDATE", viewDest);

          // Skip the push if we're already navigating through history
          if (!skipPush) pushHistory(view, viewDest);
        } else setTimeout(queue, 50, time + 50);
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
    var parts, oldParts, pathStr = "";
    var i = 1; // Skip the first element as it's always the same
    parts = join(view[0].currentFolder).split("/");
    if (parts[parts.length - 1] === "") parts.pop();
    if (view[0].currentFile !== null) parts.push(view[0].currentFile);
    parts[0] = svg("home"); // Replace empty string with our home icon
    if (view[0].savedParts) {
      oldParts = view[0].savedParts;
      while (parts[i] || oldParts[i]) {
        pathStr += "/" + parts[i];
        if (parts[i] !== oldParts[i]) {
          if (!parts[i] && oldParts[i] !== parts[i]) { // remove this part
            removePart(i);
          } else if (!oldParts[i] && oldParts[i] !== parts[i]) { // Add a part
            addPart(parts[i], pathStr);
          } else { // rename part
            $(view.find(".path li")[i]).html(parts[i] + svg("triangle")).data("destination", pathStr);
          }
        }
        i++;
      }
    } else {
      addPart(parts[0], "/");
      for (var len = parts.length; i < len; i++) {
        pathStr += "/" + parts[i];
        addPart(parts[i], pathStr);
      }
    }

    view.find(".path li:not(.gone)").transition("in");
    setTimeout(function() {checkPathOverflow(view); }, 400);

    view[0].savedParts = parts;

    function addPart(name, path) {
      var li = $("<li><a>" + name + "</a></li>");
      li.data("destination", path);
      li.register("click", function(event) {
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
        setTimeout(function() {checkPathOverflow(view); }, 400);
      });
      view.find(".path").append(li);
      li.append(svg("triangle"));
    }

    function removePart(i) {
      view.find(".path li").slice(i).replaceClass("in", "gone").transitionend(function() {
        $(this).remove();
      });
    }
  }

  // Check if the path indicator overflows and scroll it if neccessary
  function checkPathOverflow(view) {
    var width = 40, space = view[0].clientWidth;
    view.find(".path li.in").each(function() {
      width += $(this)[0].clientWidth;
    });
    view.find(".path li").each(function() {
      this.style.left = width > space ? (space - width) + "px" : 0;
    });
  }

  function getTemplateEntries(view, data) {
    var entries = [];
    Object.keys(data).forEach(function(name) {
      var split = data[name].split("|");
      var type  = split[0];
      var mtime = Number(split[1]) * 1e3;
      var size  = Number(split[2]);
      name = normalize(name);

      var entry = {
        name    : name,
        sortname: name.replace(/['"]/g, "_").toLowerCase(),
        type    : type,
        mtime   : mtime,
        age     : timeDifference(mtime),
        size    : size,
        psize   : formatBytes(size),
        id      : ((view[0].currentFolder === "/") ? "/" : view[0].currentFolder + "/") + name,
        sprite  : "sprite sprite-" + getSpriteClass(/[^.]*$/.exec(name)[0])
      };

      if (Object.keys(droppy.audioTypes).indexOf(fileExtension(name)) !== -1) {
        entry.classes = name.toLowerCase() === view.find(".playing").data("name") ? "playable playing" : "playable";
        entry.playable = true;
      }

      entries.push(entry);
    });
    return entries;
  }

  // Convert the received data into HTML
  function openDirectory(view) {
    var entries = getTemplateEntries(view, view[0].currentData), sortBy;

    // sorting
    if (!view[0].sortBy) view[0].sortBy = "name";
    if (!view[0].sortAsc) view[0].sortAsc = false;
    sortBy = view[0].sortBy === "name" ? "type" : view[0].sortBy;

    entries = sortByProp(entries, sortBy);
    if (view[0].sortAsc) entries.reverse();

    var sort = {type: "", mtime: "", size: ""};
    sort[sortBy] = "active " + (view[0].sortAsc ? "up" : "down");

    // Load from template
    loadContent(view, "directory", null, Handlebars.templates.directory({entries: entries, sort: sort}), function() {
      // Upload button on empty page
      view.find(".empty").register("click", function() {
        var inp = $("#file");
        if (droppy.detects.directoryUpload)
          inp.removeAttr(droppy.dir.join(" "));
        inp[0].click();
      });

      // Switch into a folder
      view.find(".folder-link").register("click", function(event) {
        if (droppy.socketWait) return;
        updateLocation(view, $(this).parents(".data-row").data("id"));
        event.preventDefault();
      });

      // Click on a file link
      view.find(".file-link").register("click", function(event) {
        if (droppy.socketWait) return;
        var view = $(event.target).parents(".view");
        openFile(view, view[0].currentFolder, $(event.target).text());
        event.preventDefault();
      });

      view.find(".data-row").each(function(index) {
        this.setAttribute("order", index);
      });

      view.find(".data-row").register("contextmenu", function(event) {
        var target = $(event.currentTarget);
        if (target.data("type") === "error") return;
        showEntryMenu(target, event.clientX, event.clientY, true);
        event.preventDefault();
      });

      view.find(".data-row .entry-menu").register("click", function(event) {
        showEntryMenu($(event.target).parents(".data-row"), event.clientX, event.clientY);
      });

      // Stop navigation when clicking on an <a>
      view.find(".data-row .zip, .data-row .download, .entry-link.file").register("click", function(event) {
        event.stopPropagation();
        if (droppy.socketWait) return;

        // Some browsers (like IE) think that clicking on an <a> is real navigation
        // and will close the WebSocket in turn. We'll reconnect if neccessary.
        droppy.reopen = true;
        setTimeout(function() {
          droppy.reopen = false;
        }, 2000);
      });

      // Request a sharelink
      view.find(".share-file").register("click", function() {
        if (droppy.socketWait) return;
        requestLink($(this).parents(".view"), $(this).parents(".data-row").data("id"), true);
      });

      view.find(".icon-play").register("click", function() {
        var view = $(this).parents(".view");

        if ($(this).parents(".data-row").hasClass("playing"))
          return;

        play(view, $(this).parents(".data-row"));
      });

      view.find(".header-name, .header-mtime, .header-size").register("click", function() {
        sortByHeader(view, $(this));
      });

      hideSpinner(view);
    });
  }

  // Load new view content
  function loadContent(view, type, mediaType, content, cb) {
    if (view[0].isAnimating) return; // Ignore mid-animation updates. TODO: queue and update on animation-end
    view.data("type", type);
    mediaType = mediaType ? " type-" + mediaType : "";
    content = '<div class="new content ' + type + mediaType + " " + view[0].animDirection + '">' + content + "</div>";
    var navRegex = /(forward|back|center)/;
    if (view[0].animDirection === "center") {
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
      getOtherViews(view[0].vId).each(function() {
        this.style.zIndex = "1";
      });
      view.find(".new").addClass(type).transition(navRegex, "center").transitionend(finish);
    }
    view[0].animDirection = "center";

    function finish() {
      view[0].isAnimating = false;
      getOtherViews(view[0].vId).each(function() {
        this.style.zIndex = "auto";
      });
      view.find(".content:not(.new)").remove();
      view.find(".new").removeClass("new");
      view.find(".data-row").removeClass("animating");
      if (view.data("type") === "directory")
        bindDragEvents(view);
      else if (view.data("type") === "media")
        bindMediaArrows(view);

      var buttons = "#add-file-button, #add-folder-button, #create-file-button, #create-folder-button";
      $(buttons)[type === "directory" ? "removeClass" : "addClass"]("disabled");
      if (cb) cb(view);
    }
  }

  function handleDrop(view, event, src, dst, spinner) {
    var dropSelect = $("#drop-select"), dragAction = view[0].dragAction;
    droppy.dragTimer.clear();
    delete view[0].dragAction;
    $(".dropzone").removeClass("in");

    if (dragAction === "copy" || event.ctrlKey || event.metaKey || event.altKey) {
      sendDrop(view, "copy", src, dst, spinner);
    } else if (dragAction === "cut" || event.shiftKey) {
      sendDrop(view, "cut", src, dst, spinner);
    } else {
      var x = event.originalEvent.clientX, y = event.originalEvent.clientY;

      // Keep the drop-select in view
      var limit = dropSelect[0].offsetWidth / 2 - 20, left;
      if (x < limit)
        left = x + limit;
      else if (x + limit > innerWidth)
        left = x - limit;
      else
        left = x;

      dropSelect[0].style.left = left + "px";
      dropSelect[0].style.top = event.originalEvent.clientY + "px";
      dropSelect.addClass("in");

      $(document.elementFromPoint(x, y)).addClass("active").one("mouseleave", function() {
        $(this).removeClass("active");
      });
      toggleCatcher(true);
      dropSelect.children(".movefile").registerOne("click", function() {
        sendDrop(view, "cut", src, dst, spinner);
        toggleCatcher(false);
      });
      dropSelect.children(".copyfile").registerOne("click", function() {
        sendDrop(view, "copy", src, dst, spinner);
        toggleCatcher(false);
      });
      dropSelect.children(".viewfile").registerOne("click", function() {
        updateLocation(view, src);
        toggleCatcher(false);
      });
      return;
    }
  }

  function sendDrop(view, type, src, dst, spinner) {
    if (src !== dst || type === "copy") {
      if (spinner) showSpinner(view);
      sendMessage(view[0].vId, "CLIPBOARD", {
        type: type,
        src: src,
        dst: dst
      });
    }
  }

  // Set drag properties for internal drag sources
  function bindDragEvents(view) {
    view.find(".data-row .entry-link").attr("draggable", "true");
    view.register("dragstart", function(event) {
      var row = $(event.target).hasClass("data-row") ? $(event.target) : $(event.target).parents(".data-row");

      if (event.ctrlKey || event.metaKey || event.altKey)
        view[0].dragAction = "copy";
      else if (event.shiftKey)
        view[0].dragAction = "cut";

      droppy.dragTimer.refresh(row.data("id"));
      event.originalEvent.dataTransfer.setData("text", JSON.stringify({
        type: row.data("type"),
        path: row.data("id")
      }));
      event.originalEvent.dataTransfer.effectAllowed = "copyMove";
      if ("setDragImage" in event.originalEvent.dataTransfer)
        event.originalEvent.dataTransfer.setDragImage(row.find(".sprite")[0], 0, 0);
    });
  }

  function DragTimer() {
    this.timer = null;
    this.data = "";
    this.isInternal = false;
    this.refresh = function(data) {
      if (typeof data === "string") {
        this.data = data;
        this.isInternal = true;
      }
      clearTimeout(this.timer);
      this.timer = setTimeout(this.clear, 1000);
    };
    this.clear = function() {
      if (!this.isInternal)
        $(".dropzone").removeClass("in");
      clearTimeout(this.timer);
      this.isInternal = false;
      this.data = "";
    };
  }
  droppy.dragTimer = new DragTimer();

  function allowDrop(el) {
    el.register("dragover", function(event) {
      event.preventDefault();
      droppy.dragTimer.refresh();
    });
  }

  function bindHoverEvents(view) {
    var dropZone = view.find(".dropzone");
    view.register("dragenter", function(event) {
      event.stopPropagation();
      droppy.activeView = view[0].vId;
      var icon, isInternal = event.originalEvent.dataTransfer.effectAllowed === "copyMove";
      if (view.data("type") === "directory" && isInternal)
        icon = "menu";
      else if (!isInternal)
        icon = "upload-cloud";
      else
        icon = "open";

      view.find(".dropzone svg").replaceWith(svg(icon));
      if (!dropZone.hasClass("in")) dropZone.addClass("in");

      getOtherViews($(event.target).parents(".view")[0].vId).find(".dropzone").removeClass("in");
    });
  }

  function bindDropEvents(view) {
    // file drop
    var uppie = new Uppie();
    uppie(view[0], function(event, fd, files) {
      if (!files.length) return;
      event.stopPropagation();
      var view = getActiveView();
      view[0].uId += 1;
      upload(view, fd, files, view[0].uId);
    });

    // drag between views
    view.register("drop", function(event) {
      var dragData, view = $(event.target).parents(".view");
      event.preventDefault();
      $(".dropzone").removeClass("in");

      if (event.originalEvent.dataTransfer.getData("text").length) { // drag between views
        event.stopPropagation();
        dragData = JSON.parse(event.originalEvent.dataTransfer.getData("text"));
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
    });
  }

  function initEntryMenu() {
    // Play an audio file
    $("#entry-menu .play").register("click", function(event) {
      var entry = $("#entry-menu").data("target");
      var view  = entry.parents(".view");
      event.stopPropagation();
      play(view, entry);
      toggleCatcher(false);
    });

    $("#entry-menu .edit").register("click", function(event) {
      var location;
      var entry = $("#entry-menu").data("target");
      var view  = entry.parents(".view");

      toggleCatcher(false);
      view[0].currentFile = entry.find(".file-link").text();
      location = join(view[0].currentFolder, view[0].currentFile);
      pushHistory(view, location);
      updatePath(view);
      openDoc(view, location);
      event.stopPropagation();
    });

    // Click on a "open" link
    $("#entry-menu .openfile").register("click", function(event) {
      var entry = $("#entry-menu").data("target");
      var view  = entry.parents(".view");

      toggleCatcher(false);
      if (entry.data("type") === "folder")
        updateLocation(view, entry.data("id"));
      else
        openFile(view, view[0].currentFolder, entry.find(".file-link").text());
      event.stopPropagation();
    });

    // Rename a file/folder
    $("#entry-menu .rename").register("click", function(event) {
      var entry = $("#entry-menu").data("target");
      var view  = entry.parents(".view");
      if (droppy.socketWait) return;

      toggleCatcher(false);
      entryRename(view, entry, false, function(success, oldVal, newVal) {
        if (success) {
          showSpinner(view);
          sendMessage(view[0].vId, "RENAME", {src: oldVal, dst: newVal});
        }
      });
      event.stopPropagation();
    });

    // Copy/cut a file/folder
    $("#entry-menu .copy, #entry-menu .cut").register("click", function(event) {
      toggleCatcher(false);
      droppy.clipboard = {type: $(this).attr("class"), src: $("#entry-menu").data("target").data("id")};
      checkClipboard();
      event.stopPropagation();
    });

    // Delete a file/folder
    $("#entry-menu .delete").register("click", function(event) {
      event.stopPropagation();
      if (droppy.socketWait) return;

      toggleCatcher(false);
      var entry = $("#entry-menu").data("target");
      showSpinner(entry.parents(".view"));
      sendMessage(null, "DELETE_FILE", entry.data("id"));
    });
  }

  // Check if there's something in the clipboard
  function checkClipboard() {
    if (droppy.clipboard) {
      $(".view").each(function() {
        var view = $(this), button = view.find(".paste-button");
        button.addClass("in").registerOne("click", function(event) {
          event.stopPropagation();
          if (droppy.socketWait) return;
          droppy.clipboard.dst = join(view[0].currentFolder, basename(droppy.clipboard.src));
          showSpinner(view);
          sendMessage(view[0].vId, "CLIPBOARD", droppy.clipboard);
          droppy.clipboard = null;
          toggleCatcher(false);
          $(".paste-button").removeClass("in");
        }).transition("in").find(".filename").text(basename(droppy.clipboard.src));
      });
    } else {
      $(".paste-button").removeClass("in");
    }
  }

  function showEntryMenu(entry, x, y, rightClick) {
    var type   = /sprite\-(\w+)/.exec(entry.find(".sprite").attr("class"))[1];
    var button = entry.find(".entry-menu");
    var menu   = $("#entry-menu");
    var top    = entry[0].getBoundingClientRect().top + document.body.scrollTop;
    var maxTop = window.innerHeight - menu[0].clientHeight;
    var left   = rightClick ? x - menu[0].clientWidth / 2 :
      button[0].getBoundingClientRect().left + document.body.scrollLeft +
      button[0].clientWidth - menu[0].clientWidth;

    menu.attr("class", "type-" + type);
    entry.addClass("active");
    toggleCatcher(true);
    menu[0].style.left = (left > 0 ? left : 0) + "px";
    menu[0].style.top = (top > maxTop ? maxTop : top) + "px";
    menu.data("target", entry).addClass("in");

    var target = document.elementFromPoint(x, y);
    target = target.tagName.toLowerCase() === "a" ? $(target) : $(target).parents("a");
    target.addClass("active").one("mouseleave", function() {
      $(this).removeClass("active");
    });
  }

  function sortByHeader(view, header) {
    view[0].sortBy = /header\-(\w+)/.exec(header[0].className)[1];
    view[0].sortAsc = header.hasClass("down");
    header.attr("class", "header-" + view[0].sortBy + " " + (view[0].sortAsc ? "up" : "down") + " active");
    header.siblings().removeClass("active up down");
    var entries = sortByProp(getTemplateEntries(view, view[0].currentData), header.attr("data-sort"));
    if (view[0].sortAsc) entries = entries.reverse();
    entries.forEach(function(_, i) {
      var entry = view.find("[data-name=\"" + entries[i].sortname + "\"]")[0];
      entry.style.order = i;
      entry.setAttribute("order", i);
    });
  }

  function closeDoc(view) {
    view[0].switchRequest = true;
    view[0].editor = null;
    updateLocation(view, view[0].currentFolder);
  }

  function openFile(view, newFolder, file) {
    var e = fileExtension(file), oldFolder = view[0].currentFolder;

    // Determine filetype and how to open it
    if (Object.keys(droppy.imageTypes).indexOf(e) !== -1) { // Image
      view[0].currentFile = file;
      view[0].currentFolder = newFolder;
      pushHistory(view, join(view[0].currentFolder, view[0].currentFile));
      updatePath(view);
      openMedia(view, oldFolder === newFolder);
    } else if (Object.keys(droppy.videoTypes).indexOf(e) !== -1) { // Video
      if (!droppy.detects.videoTypes[droppy.videoTypes[e]]) {
        showError(view, "Your browser can't play this file");
        updateLocation(view, view[0].currentFolder);
      } else {
        view[0].currentFile = file;
        view[0].currentFolder = newFolder;
        pushHistory(view, join(view[0].currentFolder, view[0].currentFile));
        updatePath(view);
        openMedia(view, oldFolder === newFolder);
      }
    } else { // Generic file, ask the server if the file has binary contents
      var filePath = join(newFolder, file);
      showSpinner(view);
      ajax({url: "!/type" + filePath, responseType: "text"}).then(function(xhr) {
        if (xhr.status !== 200) {
          showError(view, "Couldn't open or read the file");
          hideSpinner(view);
        } else if (xhr.response === "text") { // Non-Binary content
          view[0].currentFile = file;
          view[0].currentFolder = newFolder;
          pushHistory(view, filePath);
          updatePath(view);
          openDoc(view, filePath);
        } else { // Binary content - download it
          $("[name=nonav]").attr("src", "!/file" + filePath);
          hideSpinner(view);
        }
      });
    }
  }

  function populateMediaCache(view, data) {
    var extensions = Object.keys(droppy.imageTypes).concat(Object.keys(droppy.videoTypes));
    view[0].mediaFiles = [];
    Object.keys(data).forEach(function(filename) {
      var e = fileExtension(filename);
      if (typeof data[filename] === "string") {
        if (data[filename][0] !== "f") return;
      } else if (typeof data[filename] === "object") {
        if (data[filename].type !== "f") return;
      }
      if (extensions.indexOf(e) !== -1) {
        if (droppy.videoTypes[e] && !droppy.detects.videoTypes[droppy.videoTypes[e]]) return;
        view[0].mediaFiles.push(filename);
      }
    });
    view[0].mediaFiles = view[0].mediaFiles.sort(naturalSort);
    [getPrevMedia(view), getNextMedia(view)].forEach(function(filename) {
      var src = getMediaSrc(view, filename);
      if (!src) return;
      if (Object.keys(droppy.imageTypes).indexOf(fileExtension(filename)) !== -1) {
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
    var arrows = view.find(".arrow-back, .arrow-forward");
    arrows.first().register("click", swapMedia.bind(null, view, "left"));
    arrows.last().register("click", swapMedia.bind(null, view, "right"));
    arrows.register("mouseenter mousemove", function() {
      $(this).addClass("in");
    }).register("mouseleave", function() {
      $(this).removeClass("in");
    }).addClass("in");
    setTimeout(function() { arrows.removeClass("in"); }, 2000);
  }

  function swapMedia(view, dir) {
    if (view[0].tranistioning) return;
    var a        = view.find(".media-container"), b;
    var nextFile = (dir === "left") ? getPrevMedia(view) : getNextMedia(view);
    var isImage  = Object.keys(droppy.imageTypes).indexOf(fileExtension(nextFile)) !== -1;
    var src      = getMediaSrc(view, nextFile);

    if (isImage) {
      b = $("<div class='media-container new-media " + dir + "'><img src='" + src + "'></div>");
      b.find("img").one("load", aspectScale);
    } else {
      b = $("<div class='media-container new-media " + dir + "'><video src='" + src + "' id='video-" + view[0].vId + "'></div>");
      bindVideoEvents(b[0]);
    }

    a.attr("class", "media-container old-media " + (dir === "left" ? "right" : "left"));
    view[0].tranistioning = true;
    b.appendTo(view.find(".content")).transition(/(left|right)/, "").transitionend(function() {
      view[0].tranistioning = false;
      $(".new-media").removeClass("new-media").parents(".content").replaceClass(/type-(image|video)/, isImage ? "type-image" : "type-video");
      $(".old-media").remove();
      aspectScale();
      makeMediaDraggable(this, !isImage);
      view[0].currentFile = nextFile;
      populateMediaCache(view, view[0].currentData);
      replaceHistory(view, join(view[0].currentFolder, view[0].currentFile));
      updatePath(view);
      if (isImage) updateMediaMeta(view); else initVideoJS(b.find("video")[0]);
      if (view[0].vId === 0) setTitle(nextFile); // Only update the page's title from view 0
    });
  }

  function updateMediaMeta(view) {
    var meta = view.find(".meta"), img = view.find("img");
    if (!img.length) return;

    meta.find(".cur").text(view[0].mediaFiles.indexOf(view[0].currentFile) + 1);
    meta.find(".max").text(view[0].mediaFiles.length);
    meta.register("click", function() {
      view.find(".dims").toggleClass("in");
    });

    (function addSizes(meta, img) {
      var x = img.naturalWidth, y = img.naturalHeight;
      if (x && y) {
        meta.find(".x").text(x);
        meta.find(".y").text(y);
      } else setTimeout(addSizes.bind(null, meta, img), 500);
    })(meta, img[0]);
  }

  function bindVideoEvents(el) {
    var volume = droppy.get("volume");
    if (volume) el.volume = volume;
    el.addEventListener("loadedmetadata", aspectScale);
    el.addEventListener("error", aspectScale);
    el.addEventListener("volumechange", function() {
      droppy.set("volume", this.muted ? 0 : this.volume);
    });
    return el;
  }

  function getMediaSrc(view, filename) {
    var encodedId = join(view[0].currentFolder, filename).split("/");
    var i = encodedId.length - 1;
    for (;i >= 0; i--)
      encodedId[i] = encodeURIComponent(encodedId[i]);
    return "!/file" + encodedId.join("/");
  }

  function openMedia(view, sameFolder) {
    var filename = view[0].currentFile;
    var src = getMediaSrc(view, filename);
    var type = Object.keys(droppy.videoTypes).indexOf(fileExtension(filename)) !== -1 ? "video" : "image";
    if (sameFolder && view[0].currentData) {
      populateMediaCache(view, view[0].currentData);
    } else { // In case we switch into an unknown folder, request its files
      sendMessage(view[0].vId, "REQUEST_UPDATE", view[0].currentFolder);
    }
    view[0].animDirection = "forward";
    loadContent(view, "media", type, Handlebars.templates.media({type: type, src: src, vid: view[0].vId}), function(view) {
      view.find(".fs").register("click", function(event) {
        var view = $(event.target).parents(".view");
        droppy.activeView = view[0].vId;
        screenfull.toggle($(this).parents(".content")[0]);
        aspectScale();
        event.stopPropagation();
      });
      view.find("img").each(function() {
        aspectScale();
        makeMediaDraggable(this.parentNode, false);
        updateMediaMeta(view);
      });
      view.find("video").each(function() {
        var self = this;
        initVideoJS(self).then(function() {
          aspectScale();
          makeMediaDraggable(view.find(".media-container")[0], true);
          bindVideoEvents(self);
        });
      });

      if (view[0].vId === 0) setTitle(filename);
      hideSpinner(view);
    });
  }

  function openDoc(view, entryId) {
    var editor;
    showSpinner(view);
    Promise.all([
      ajax("!/file" + entryId),
      initCM(),
      loadTheme(droppy.get("theme")),
    ]).then(function(values) {
      setTitle(basename(entryId));
      setEditorFontSize(droppy.get("editorFontSize"));
      configCM(values[0].response, basename(entryId));
    }).catch(function() {
      closeDoc(view);
    });

    function configCM(data, filename) {
      loadContent(view, "document", null, Handlebars.templates.document({modes: droppy.modes}), function() {
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

        if (!CodeMirror.autoLoadMode) initModeLoad();

        var mode, fileMode = modeFromShebang(data);
        if (fileMode) {
          mode = fileMode;
        } else {
          if (["hbs", "handlebars"].indexOf(fileExtension(filename)) !== -1) {
            mode = "htmlmixed";
          } else {
            var modeInfo = CodeMirror.findModeByFileName(filename);
            mode = (!modeInfo || !modeInfo.mode || modeInfo.mode === "null") ? "plain" : modeInfo.mode;
          }
        }
        if (mode !== "plain") CodeMirror.autoLoadMode(editor, mode);
        editor.setOption("mode", mode);
        view.find(".mode-select").val(mode);

        editor.on("change", function(cm, change) {
          var view = getCMView(cm);
          if (change.origin !== "setValue")
            view.find(".path li:last-child").removeClass("saved save-failed").addClass("dirty");
        });

        function getCMView(cm) {
          return getView($(cm.getWrapperElement()).parents(".view")[0].vId);
        }

        function save(cm) {
          var view = getCMView(cm);
          showSpinner(view);
          sendMessage(view[0].vId, "SAVE_FILE", {
            to: view[0].editorEntryId,
            value: cm.getValue(view[0].lineEnding)
          });
        }

        editor.setOption("extraKeys", {
          "Tab": function(cm) {
            cm.replaceSelection(droppy.get("indentWithTabs") ?
              "\t" : Array(droppy.get("indentUnit") + 1).join(" "));
          },
          "Cmd-S": save,
          "Ctrl-S": save
        });

        // Let Mod-T through to the browser
        CodeMirror.keyMap.sublime["Cmd-T"] = false;
        CodeMirror.keyMap.sublime["Ctrl-T"] = false;

        view[0].lineEnding = dominantLineEnding(data);
        editor.setValue(data);
        editor.clearHistory();

        view.find(".exit").register("click", function() {
          closeDoc($(this).parents(".view"));
          editor = null;
        });
        view.find(".save").register("click", function() {
          save($(this).parents(".view")[0].editor);
        });
        view.find(".ww").register("click", function() {
          editor.setOption("lineWrapping", !editor.options.lineWrapping);
          droppy.set("lineWrapping", editor.options.lineWrapping);
        });
        view.find(".syntax").register("click", function() {
          var shown = view.find(".mode-select").toggleClass("in").hasClass("in");
          view.find(".syntax")[shown ? "addClass" : "removeClass"]("in");
          view.find(".mode-select").on("change", function() {
            var mode = $(this).val();
            view.find(".syntax").removeClass("in");
            view.find(".mode-select").removeClass("in");
            CodeMirror.autoLoadMode(editor, mode);
            editor.setOption("mode", mode);
          });
        });
        view.find(".find").register("click", function() {
          CodeMirror.commands.find(editor);
          view.find(".CodeMirror-search-field")[0].focus();
        });
        view.find(".full").register("click", function() {
          screenfull.toggle($(this).parents(".content")[0]);
        });
        hideSpinner(view);
      });
    }
  }

  function updateUsers(userlist) {
    if (Object.keys(userlist).length === 0) return location.reload(true);
    var box = $("#prefs-box");
    box.find(".list-user").remove();
    box.append(Handlebars.templates["list-user"](Object.keys(userlist)));
    box.find(".add-user").register("click", function() {
      var user = prompt("Username?");
      if (!user) return;
      var pass = prompt("Password?");
      if (!pass) return;
      sendMessage(null, "UPDATE_USER", {
        name: user,
        pass: pass,
        priv: true
      });
    });
    box.find(".delete-user").register("click", function(event) {
      event.stopPropagation();
      sendMessage(null, "UPDATE_USER", {
        name: $(this).parents("li").children(".username").text(),
        pass: ""
      });
    });
  }

  function showPrefs() {
    var box = $("#prefs-box");
    box.empty().append(function() {
      var i, opts = [
        {name: "theme", label: "Editor theme"},
        {name: "editorFontSize", label: "Editor font size"},
        {name: "indentWithTabs", label: "Editor indent type"},
        {name: "indentUnit", label: "Editor indent width"},
        {name: "lineWrapping", label: "Editor word wrap"},
        {name: "renameExistingOnUpload", label: "When added file exists"}
      ];

      opts.forEach(function(_, i) {
        opts[i].values = {};
        opts[i].selected = droppy.get(opts[i].name);
      });
      droppy.themes.forEach(function(t) { opts[0].values[t] = t; });
      for (i = 10; i <= 30; i += 2) opts[1].values[String(i)] = String(i);
      opts[2].values = {Tabs: true, Spaces: false};
      for (i = 1; i <= 8; i *= 2) opts[3].values[String(i)] = String(i);
      opts[4].values = {"Wrap": true, "No Wrap": false};
      opts[5].values = {Rename: true, Replace: false};
      return Handlebars.templates.options({opts: opts});
    });

    $("select.theme").register("change", function() {
      var theme = $(this).val();
      loadTheme(theme, function() {
        droppy.set("theme", theme);
        $(".view").each(function() {
          if (this.editor) this.editor.setOption("theme", theme);
        });
      });
    });

    $("select.editorFontSize").register("change", function() {
      setEditorFontSize($(this).val());
    });

    setTimeout(function() {
      box.addClass("in").transitionend(function() {
        $(this).removeAttr("style");
      });
      toggleCatcher(true);
      $("#overlay").one("click", function() {
        box.find("select").each(function() {
          var option = $(this).attr("class");
          var value  = $(this).val();

          if (value === "true") value = true;
          else if (value === "false") value = false;
          else if (/^-?\d*(\.\d+)?$/.test(value)) value = parseFloat(value);

          droppy.set(option, value);
          if (option === "indentUnit") droppy.set("tabSize", value);

          $(".view").each(function() {
            if (this.editor) {
              this.editor.setOption(option, value);
              if (option === "indentUnit") this.editor.setOption("tabSize", value);
            }
          });
        });
      });
    }, 0);
  }

  // ============================================================================
  //  Audio functions / events
  // ============================================================================

  function play(view, index) {
    var row, source, player = view.find(".audio-player")[0];

    if (typeof index === "number")
      row = view.find('.data-row[data-playindex="' + index + '"]');
    else
      row = index;

    if (!view[0].audioInitialized) {
      initAudio(view);
      view[0].audioInitialized = true;
    }

    if (!row.data("id")) {
      return endAudio(view);
    }

    source = "!/file" + row.data("id");
    view.find(".seekbar-played, .seekbar-loaded")[0].style.width = "0%";

    if (player.canPlayType(droppy.audioTypes[fileExtension(source)])) {
      player.src = source;
      player.load();
      player.play();
      onNewAudio(view);
    } else {
      return showError(view, "Your browser can't play this file");
    }

    row.addClass("playing").siblings().removeClass("playing");

    if (row.length) {
      var content = row.parents(".content-container");
      if (row[0].offsetTop < content[0].scrollTop ||
          row[0].offsetTop > content[0].scrollTop + content[0].clientHeight) {
        row[0].scrollIntoView();
      }

      var i = 0;
      row.parent().children(".playable").each(function() {
        $(this).attr("data-playindex", i++);
      });
      view[0].playlistLength = i;
    }
    view[0].playlistIndex = typeof index === "number" ? index : row.data("playindex");
  }

  function onNewAudio(view) {
    var player = view[0].querySelector(".audio-player");
    var title  = decodeURIComponent(removeExt(basename(player.src).replace(/_/g, " ").replace(/\s+/, " ")));

    view.find(".audio-bar").addClass("in");
    view.find(".audio-title").text(title);
    setTitle(title);

    (function updateBuffer() {
      var progress;
      if (player.buffered.length)
        progress = (player.buffered.end(0) / player.duration) * 100;
      view[0].querySelector(".seekbar-loaded").style.width = (progress || 0) + "%";
      if (!progress || progress < 100) setTimeout(updateBuffer, 100);
    })();

    $(player).register("timeupdate", function() {
      var cur = player.currentTime, max = player.duration;
      if (!cur || !max) return;
      view[0].querySelector(".seekbar-played").style.width = (cur / max) * 100 + "%";
      view[0].querySelector(".time-cur").textContent = secsToTime(cur);
      view[0].querySelector(".time-max").textContent = secsToTime(max);
    });
  }

  function endAudio(view) {
    view.find(".audio-player")[0].pause();
    view.find(".audio-title").html("");
    view.find(".data-row.playing").removeClass("playing");
    setTitle(basename(view[0].currentFolder));
    view.find(".audio-bar").removeClass("in");
  }

  function initAudio(view) {
    var heldVolume = false;
    var bar        = view.find(".audio-bar");
    var slider     = view.find(".volume-slider");
    var volumeIcon = view.find(".audio-bar .volume");
    var player     = view.find(".audio-player")[0];

    setVolume(droppy.get("volume"));

    player.addEventListener("ended", function(e) {
      playNext($(e.target).parents(".view"));
    });
    player.addEventListener("error", function(e) {
      playNext($(e.target).parents(".view"));
    });
    player.addEventListener("playing", function(e) {
      onNewAudio($(e.target).parents(".view"));
    });
    var updateVolume = throttle(function(event) {
      var slider = $(event.target).parents(".view").find(".volume-slider")[0];
      var left   = slider.getBoundingClientRect().left;
      var right  = slider.getBoundingClientRect().right;
      setVolume((event.pageX - left) / (right - left));
    }, 1000 / 60);
    slider.register("mousedown", function(event) {
      heldVolume = true;
      updateVolume(event);
      event.stopPropagation();
    });
    bar.register("mousemove", function(event) {
      if (heldVolume) updateVolume(event);
    });
    bar.register("mouseup", function() {
      heldVolume = false;
    });
    slider.register("click", function(event) {
      updateVolume(event);
      event.stopPropagation();
    });
    bar.register("click", function(event) {
      var time = player.duration *
        ((event.pageX - bar[0].getBoundingClientRect().left) / bar[0].clientWidth);
      if (!isNaN(parseFloat(time)) && isFinite(time))
        player.currentTime = time;
      else
        endAudio($(this).parents(".view"));
    });
    bar.find(".previous").register("click", function(event) {
      playPrev($(event.target).parents(".view"));
      event.stopPropagation();
    });
    bar.find(".next").register("click", function(event) {
      playNext($(event.target).parents(".view"));
      event.stopPropagation();
    });
    bar.find(".pause-play").register("click", function(event) {
      var icon   = $(this).children("svg");
      var player = $(this).parents(".audio-bar").find(".audio-player")[0];
      if (icon.attr("class") === "play") {
        icon.replaceWith($(svg("pause")));
        player.play();
      } else {
        icon.replaceWith($(svg("play")));
        player.pause();
      }
      event.stopPropagation();
    });

    bar.find(".stop").register("click", function(event) {
      endAudio($(this).parents(".view"));
      event.stopPropagation();
    });
    bar.find(".shuffle").register("click", function(event) {
      $(this).toggleClass("active");
      $(this).parents(".view")[0].shuffle = $(this).hasClass("active");
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
    volumeIcon.register("click", function(event) {
      slider.toggleClass("in");
      volumeIcon.toggleClass("active");
      event.stopPropagation();
    });
    function setVolume(volume) {
      if (volume > 1) volume = 1;
      if (volume < 0) volume = 0;
      player.volume = volume;
      droppy.set("volume", volume);
      if (player.volume === 0) volumeIcon.html(svg("volume-mute"));
      else if (player.volume <= 0.33) volumeIcon.html(svg("volume-low"));
      else if (player.volume <= 0.67) volumeIcon.html(svg("volume-medium"));
      else volumeIcon.html(svg("volume-high"));
      view.find(".volume-slider-inner")[0].style.width = (volume * 100) + "%";
    }
    function playRandom(view) {
      var nextIndex;
      if (view[0].playlistLength === 1) return play(view, 0);
      do {
        nextIndex = Math.floor(Math.random() * view[0].playlistLength);
      } while (nextIndex === view[0].playlistIndex);
      play(view, nextIndex);
    }
    function playNext(view) {
      if (view[0].shuffle) return playRandom(view);
      if (view[0].playlistIndex < view[0].playlistLength - 1)
        play(view, view[0].playlistIndex + 1);
      else
        play(view, 0);
    }
    function playPrev(view) {
      if (view[0].shuffle) return playRandom(view);
      if (view[0].playlistIndex === 0)
        play(view, view[0].playlistLength - 1);
      else
        play(view, view[0].playlistIndex - 1);
    }
  }

  // CodeMirror dynamic mode loading
  // based on https://github.com/codemirror/CodeMirror/blob/master/addon/mode/loadmode.js
  function initModeLoad() {
    var loading = {};
    function splitCallback(cont, n) {
      var countDown = n;
      return function() { if (--countDown === 0) cont(); };
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

    CodeMirror.requireMode = function(mode, cont) {
      if (typeof mode !== "string") mode = mode.name;
      if (CodeMirror.modes.hasOwnProperty(mode)) return ensureDeps(mode, cont);
      if (loading.hasOwnProperty(mode)) return loading[mode].push(cont);

      var script = document.createElement("script");
      script.src = "!/res/mode/" + mode;
      var others = document.getElementsByTagName("script")[0];
      others.parentNode.insertBefore(script, others);
      var list = loading[mode] = [cont];
      var count = 0;
      var poll = setInterval(function() {
        if (++count > 100) return clearInterval(poll);
        if (CodeMirror.modes.hasOwnProperty(mode)) {
          clearInterval(poll);
          loading[mode] = null;
          ensureDeps(mode, function() {
            for (var i = 0; i < list.length; ++i) list[i]();
          });
        }
      }, 200);
    };

    CodeMirror.autoLoadMode = function(instance, mode) {
      if (!CodeMirror.modes.hasOwnProperty(mode)) {
        CodeMirror.requireMode(mode, function() {
          instance.setOption("mode", instance.getOption("mode"));
        });
      }
    };
  }

  function modeFromShebang(text) {
    // extract first line, trim and remove flags
    text = (text || "").split(/\n/)[0].trim().split(" ").filter(function(e) {
      return !/^-+/.test(e);
    }).join(" ");

    // shell scripts
    if (/^#!.*\b(ba|c|da|k|fi|tc|z)?sh$/.test(text)) return "shell";

    // map binary name to CodeMirror mode
    var mode, exes = {
      dart: "dart", lua: "lua", node: "javascript", perl: "perl", php: "php",
      python: "python", ruby: "ruby", swift: "swift", tclsh: "tcl"
    };
    Object.keys(exes).some(function(exe) {
      if (new RegExp("^#!.*\\b" + exe + "$").test(text)) return (mode = exes[exe]);
    });
    return mode;
  }

  // draggabilly
  function makeMediaDraggable(el, isVideo) {
    if ($(el).hasClass("draggable")) return;
    $(el).attr("class", "media-container draggable");
    var instance = new Draggabilly(el, isVideo ? {axis: "x", handle: "video"} : {axis: "x"});
    instance.on("dragEnd", function() {
      var view      = $(instance.element).parents(".view");
      var threshold = droppy.detects.mobile ? 0.15 : 0.075;
      if ((Math.abs(instance.position.x) / instance.element.clientWidth) > threshold) {
        swapMedia(view, instance.position.x > 0 ? "left" : "right");
      } else {
        $(instance.element).removeAttr("style");
      }
    });
  }

  // video.js
  function initVideoJS(el) {
    return new Promise(function(resolve) {
      Promise.all([
        loadStyle("vjs-css", "!/res/lib/vjs.css"),
        loadScript("vjs-js", "!/res/lib/vjs.js"),
      ]).then(function() {
        (function verify() {
          if (!("videojs" in window)) return setTimeout(verify, 200);
          if (!el.classList.contains("video-js")) el.classList.add("video-js", "vjs-default-skin");
          if (droppy.get("volume") === 0) el.muted = true;
          var container = $(el).parents(".media-container")[0];
          videojs.options.flash.swf = "!/res/lib/vjs.swf";
          videojs(el, {
            controls: true,
            autoplay: !droppy.detects.mobile,
            preload : "auto",
            loop    : "loop",
            width   : container.clientWidth,
            heigth  : container.clientHeight
          }, resolve).on("ready", function() {
            this.volume(droppy.get("volume"));
          }).on("volumechange", function() {
            droppy.set("volume", this.muted() ? 0 : this.volume());
          });
        })();
      });
    });
  }

  // CodeMirror
  function initCM() {
    return new Promise(function(resolve) {
      Promise.all([
        loadStyle("cm-css", "!/res/lib/cm.css"),
        loadScript("cm-js", "!/res/lib/cm.js"),
      ]).then(function() {
        (function verify() {
          if (!("CodeMirror" in window)) return setTimeout(verify, 200);
          resolve();
        })();
      });
    });
  }

  function initVariables() {
    droppy.activeFiles = [];
    droppy.activeView = 0;
    droppy.debug = null;
    droppy.demo = null;
    droppy.linkCache = [];
    droppy.public = null;
    droppy.queuedData = null;
    droppy.reopen = null;
    droppy.resizeTimer = null;
    droppy.socket = null;
    droppy.socketWait = null;
    droppy.token = null;
    droppy.views = [];
    droppy.wsRetries = 5;
    droppy.wsRetryTimeout = 4000;

    droppy.dir = ["directory", "webkitdirectory", "allowdirs"];

    // Extension to icon mappings
    droppy.iconMap = {
      archive  : ["bz2", "gz", "tgz"],
      audio    : ["aac", "aif", "aiff", "flac", "m4a", "m4p", "mid", "mp1", "mp2", "mp3", "mpa", "ra", "ogg", "oga", "opus", "wav", "wma"],
      authors  : ["authors"],
      bin      : ["class", "o", "so"],
      bmp      : ["bmp"],
      c        : ["c"],
      calc     : ["ods", "ots", "xlr", "xls", "xlsx", "csv"],
      cd       : ["cue", "iso"],
      copying  : ["copying", "license"],
      cpp      : ["cpp", "cc", "cxx"],
      css      : ["css", "less", "scss", "sass"],
      deb      : ["deb"],
      diff     : ["diff", "patch"],
      doc      : ["doc", "docx", "odm", "odt", "ott"],
      draw     : ["drw"],
      eps      : ["eps"],
      exe      : ["bat", "cmd", "exe", "com"],
      gif      : ["gif"],
      gzip     : ["gz"],
      h        : ["h", "hh", "hxx"],
      hpp      : ["hpp"],
      html     : ["htm", "html", "shtml", "hbs", "handlebars"],
      ico      : ["ico"],
      image    : ["svg", "xpm", "webp"],
      install  : ["install", "msi"],
      java     : ["java", "jar"],
      jpg      : ["jpg", "jpeg"],
      js       : ["js", "jsx", "es", "es6", "dart", "ls"],
      json     : ["json", "gyp"],
      log      : ["log", "changelog"],
      makefile : ["makefile", "pom", "reg"],
      markdown : ["markdown", "md"],
      pdf      : ["pdf"],
      php      : ["php"],
      playlist : ["m3u", "m3u8", "pls"],
      png      : ["png", "apng"],
      pres     : ["odp", "otp", "pps", "ppt", "pptx"],
      ps       : ["ps", "ttf", "otf", "eot", "woff", "woff2"],
      psd      : ["psd"],
      py       : ["py"],
      rar      : ["rar"],
      rb       : ["rb"],
      readme   : ["readme"],
      rpm      : ["rpm"],
      rss      : ["rss"],
      rtf      : ["rtf"],
      script   : ["csh", "ini", "ksh", "sh", "shar", "tcl"],
      sql      : ["sql", "dump"],
      tar      : ["tar"],
      tex      : ["tex"],
      text     : ["text", "txt", "conf", "cfg"],
      tiff     : ["tiff"],
      vcal     : ["vcal"],
      video    : ["avi", "flv", "mkv", "mov", "mp4", "mpg", "mpeg", "m4v", "mpg", "ogv", "ogx", "rm", "swf", "vob", "wmv", "webm"],
      xml      : ["xml"],
      zip      : ["7z", "bz2", "lzma", "war", "z", "zip", "xz"]
    };

    droppy.audioTypes = {
      aac  : "audio/aac",
      flac : "audio/flac",
      m4a  : "audio/mp4",
      m4p  : "application/mp4",
      mp1  : "audio/mpeg",
      mp2  : "audio/mpeg",
      mp3  : "audio/mpeg",
      mpa  : "audio/mpeg",
      mpeg : "audio/mpeg",
      mpg  : "audio/mpeg",
      oga  : "audio/ogg",
      ogg  : "audio/ogg",
      opus : "audio/ogg",
      wav  : "audio/wav"
    };

    droppy.videoTypes = {
      mp4  : "video/mp4", // can be audio/mp4 too
      m4v  : "video/mp4",
      ogv  : "video/ogg",
      ogx  : "application/ogg",
      webm : "video/webm" // can be audio/webm too
    };

    droppy.imageTypes = {
      jpg  : "image/jpeg",
      jpeg : "image/jpeg",
      gif  : "image/gif",
      png  : "image/png",
      apng : "image/png",
      svg  : "image/svg+xml",
      bmp  : "image/bmp",
      ico  : "image/x-icon"
    };
  }

  function requestLink(view, location, attachement, cb) {
    view[0].sharelinkId = location;
    var found = droppy.linkCache.some(function(entry) {
      if (entry.location === location && entry.attachement === attachement) {
        if (cb)
          cb(entry.link);
        else
          showLink(view, entry.link, attachement);
        return true;
      }
    });
    if (!found) {
      showSpinner(view);
      sendMessage(view[0].vId, "REQUEST_SHARELINK", {
        location   : location,
        attachement: attachement
      });
    }
  }

  function timeDifference(previous) {
    var msPerMinute = 60 * 1000;
    var msPerHour   = msPerMinute * 60;
    var msPerDay    = msPerHour * 24;
    var msPerMonth  = msPerDay * 30;
    var msPerYear   = msPerDay * 365;
    var elapsed     = Date.now() - parseInt(previous);
    var result      = "";

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

  function secsToTime(secs) {
    var mins, hrs, time = "";
    secs = parseInt(secs);
    hrs  = Math.floor(secs / 3600);
    mins = Math.floor((secs - (hrs * 3600)) / 60);
    secs = secs - (hrs * 3600) - (mins * 60);

    if (hrs < 10)  hrs  = "0" + hrs;
    if (mins < 10) mins = "0" + mins;
    if (secs < 10) secs = "0" + secs;

    if (hrs !== "00") time = (hrs + ":");
    return time + mins + ":" + secs;
  }

  setInterval(function() {
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

  function loadScript(id, url) {
    return new Promise(function(resolve) {
      if (!document.getElementById(id)) {
        var script = document.createElement("script");
        script.onload = resolve;
        script.setAttribute("id", id);
        script.setAttribute("src", url);
        document.querySelector("head").appendChild(script);
      } else resolve();
    });
  }

  function loadStyle(id, url) {
    return new Promise(function(resolve) {
      if (!document.getElementById(id)) {
        ajax(url).then(function(xhr) {
          var style = document.createElement("style");
          style.setAttribute("id", id);
          style.textContent = xhr.response;
          document.querySelector("head").appendChild(style);
          resolve();
        });
      } else resolve();
    });
  }

  function loadTheme(theme) {
    return new Promise(function(resolve) {
      loadStyle("theme-" + theme.replace(/[^a-z0-9\-]/gim, ""), "!/res/theme/" + theme).then(resolve);
    });
  }

  function setEditorFontSize(size) {
    [].slice.call(document.styleSheets).some(function(sheet) {
      if (sheet.ownerNode.id === "css") {
        [].slice.call(sheet.cssRules).some(function(rule) {
          if (rule.selectorText === ".content div.CodeMirror") {
            rule.style.fontSize = size + "px";
            return true;
          }
        });
        return true;
      }
    });
  }

  function showSpinner(view) {
    if (!view.find(".spinner").length)
      view.find(".path").append(svg("spinner"));

    view.find(".spinner").attr("class", "spinner in");

    // HACK: Safeguard so a view won't get stuck in loading state
    if (view.data("type") === "directory") {
      clearTimeout(view[0].stuckTimeout);
      view[0].stuckTimeout = setTimeout(function() {
        sendMessage(view[0].vId, "REQUEST_UPDATE", getViewLocation(view));
      }, 2000);
    }
  }

  function hideSpinner(view) {
    var spinner = view.find(".spinner");
    if (spinner.length) spinner.attr("class", "spinner");
    if (view[0].stuckTimeout) clearTimeout(view[0].stuckTimeout);
  }

  function showError(view, text) {
    var box = view.find(".info-box");
    clearTimeout(droppy.errorTimer);
    box.find(".icon svg").replaceWith(svg("exclamation"));
    box.children("span").text(text);
    box.attr("class", "info-box error in");
    droppy.errorTimer = setTimeout(function() {
      box.removeClass("in");
    }, 4000);
  }

  function showLink(view, link, attachement) {
    toggleCatcher(true);
    var box  = view.find(".info-box");
    var out  = box.find(".link-out");
    var copy = box.find(".copy-link");
    var dl   = box.find(".dl-link");
    dl[attachement ? "addClass" : "removeClass"]("checked");

    var select = function() {
      var range = document.createRange(), selection = getSelection();
      range.selectNodeContents(out[0]);
      selection.removeAllRanges();
      selection.addRange(range);
    };

    var getFullLink = function(hash) {
      return location.protocol + "//" + location.host + location.pathname + "$/" + hash;
    };

    out.text(getFullLink(link));
    out.register("copy", function() {
      setTimeout(toggleCatcher.bind(null, false), 500);
    });
    box.find(".icon svg").replaceWith(svg("link"));
    box.attr("class", "info-box link in").transitionend(function() {
      select();
    });

    copy.register("click", function() {
      var done;
      select();
      try { done = document.execCommand("copy"); } catch (e) {}
      copy.attr("aria-label", done === true ? "Copied!" : "Copy failed");
    }).on("mouseleave", function() {
      copy.attr("aria-label", "Copy to clipboard");
    });

    dl.register("click", function() {
      $(this).toggleClass("checked");
      requestLink($(this).parents(".view"), view[0].sharelinkId, $(this).hasClass("checked"), function(link) {
        out.text(getFullLink(link));
      });
    });
  }

  function showNotification(msg, body) {
    if (droppy.detects.notification && document.hidden) {
      var show = function(msg, body) {
        var opts = {icon: "!/res/logo192.png"};
        if (body) opts.body = body;
        var n = new Notification(msg, opts);
        n.onshow = function() { // Compat: Chrome
          var self = this;
          setTimeout(function() { self.close(); }, 4000);
        };
      };
      if (Notification.permission === "granted") {
        show(msg, body);
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission(function(permission) {
          if (!("permission" in Notification)) Notification.permission = permission;
          if (permission === "granted") show(msg, body);
        });
      }
    }
  }

  // Media up/down-scaling while maintaining aspect ratio.
  function aspectScale() {
    $(".media-container").each(function() {
      var container = $(this);
      container.find("img").each(function() {
        var dims = {
          w: this.naturalWidth || this.videoWidth || this.clientWidth,
          h: this.naturalHeight || this.videoHeight || this.clientHeight
        };
        var space = {
          w: container[0].clientWidth,
          h: container[0].clientHeight
        };
        if (dims.w > space.w || dims.h > space.h) {
          $(this).removeAttr("style"); // Let CSS handle the downscale
        } else {
          if (dims.w / dims.h > space.w / space.h) {
            this.style.width  = "100%";
            this.style.height = "auto";
          } else {
            this.style.width  = "auto";
            this.style.height = "100%";
          }
        }
      });
    });
  }

  function throttle(func, threshold) {
    if (!threshold) threshold = 250;
    var last, deferTimer;
    return function() {
      var now = Date.now(), args = arguments;
      if (last && now < last + threshold) {
        clearTimeout(deferTimer);
        deferTimer = setTimeout(function() {
          last = now;
          func.apply(this, args);
        }, threshold);
      } else {
        last = now;
        func.apply(this, args);
      }
    };
  }

  function getSpriteClass(extension) {
    for (var type in droppy.iconMap) {
      if (droppy.iconMap[type.toLowerCase()].indexOf(extension.toLowerCase()) > -1) return type;
    }
    return "bin";
  }

  function formatBytes(num) {
    if (num < 1000) return num + " B";
    var units = ["B", "kB", "MB", "GB", "TB", "PB"];
    var exp = Math.min(Math.floor(Math.log(num) / Math.log(1000)), units.length - 1);
    return (num / Math.pow(1000, exp)).toPrecision(3) + " " + units[exp];
  }

  function sortCompare(a, b) {
    if (typeof a === "number" && typeof b === "number")
      return b - a;
    else if (typeof a === "string" && typeof b === "string")
      return naturalSort(a.replace(/['"]/g, "_").toLowerCase(), b.replace(/['"]/g, "_").toLowerCase());
    else
      return 0;
  }

  function sortByProp(entries, prop) {
    return entries.sort(function(a, b) {
      var result = sortCompare(a[prop], b[prop]);
      if (result === 0) result = sortCompare(a.sortname, b.sortname);
      return result;
    });
  }

  function naturalSort(a, b) {
    var x = [], y = [];
    function strcmp(a, b) { return a > b ? 1 : a < b ? -1 : 0; }
    a.replace(/(\d+)|(\D+)/g, function(_, a, b) { x.push([a || 0, b]); });
    b.replace(/(\d+)|(\D+)/g, function(_, a, b) { y.push([a || 0, b]); });
    while (x.length && y.length) {
      var xx = x.shift();
      var yy = y.shift();
      var nn = (xx[0] - yy[0]) || strcmp(xx[1], yy[1]);
      if (nn) return nn;
    }
    if (x.length) return -1;
    if (y.length) return 1;
    return 0;
  }

  function ajax(opts) {
    if (typeof opts === "string") opts = {url: opts};
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.responseType = opts.responseType || "";
      xhr.open(opts.method || "GET", opts.url);
      xhr.onload = resolve.bind(null, xhr);
      xhr.onerror = reject.bind(null, xhr);
      xhr.send(opts.data);
    });
  }

  function removeExt(filename) {
    return filename.substring(0, filename.lastIndexOf("."));
  }

  // Get the path to droppy's root, ensuring a trailing slash
  function getRootPath() {
    var p = location.pathname;
    return p[p.length - 1] === "/" ? p : p + "/";
  }

  // turn /path/to/file to file
  function basename(path) {
    return path.replace(/^.*\//, "");
  }

  // turn /path/to to file
  function dirname(path) {
    return path.replace(/\\/g, "/").replace(/\/[^\/]*$/, "") || "/";
  }

  // detect dominant line ending style (CRLF vs LF)
  function dominantLineEnding(str) {
    var numCRLF = (str.match(/\r\n/gm) || []).length;
    // emulating negative lookbehind by reversing the string
    var numLF = (str.split("").reverse().join("").match(/\n(?!(\r))/gm) || []).length;
    return (numCRLF > numLF) ? "\r\n" : "\n";
  }

  // Join and clean up paths (can also take a single argument to just clean it up)
  function join() {
    var i, l, parts = [], newParts = [];
    for (i = 0, l = arguments.length; i < l; i++) {
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

  function normalize(str) {
    return String.prototype.normalize ? str.normalize() : str;
  }
})(jQuery);
