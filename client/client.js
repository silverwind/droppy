/* global jQuery, CodeMirror, plyr, Mousetrap, fileExtension, Handlebars, Uppie, screenfull, PhotoSwipe, PhotoSwipeUI_Default */
/* eslint-disable no-var, prefer-const */
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
    mobile: /Mobi/.test(navigator.userAgent),
    safari: /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent),
  };
  // ============================================================================
  //  Set up a few more things
  // ============================================================================
  // Shorthand for safe event listeners
  $.fn.reg = function() {
    return this.off.apply(this, arguments).on.apply(this, arguments);
  };
  $.fn.regOne = function() {
    return this.off.apply(this, arguments).one.apply(this, arguments);
  };

  // Transition of freshly inserted elements
  $.fn.transition = function(oldClass, newClass) {
    if (!newClass) { newClass = oldClass; oldClass = null; }

    // Force a reflow
    // https://gist.github.com/paulirish/5d52fb081b3570c81e3a
    this.r = this[0].offsetTop;
    delete this.r;

    if (oldClass) {
      this.replaceClass(oldClass, newClass);
    } else {
      this.addClass(newClass);
    }

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
      if (classes.length === 0 || (classes.length === 1 && classes[0] === "")) {
        el.removeAttribute("class");
      } else {
        el.className = classes.join(" ");
      }
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
    // Manually clone instead of <use> because of a weird bug with media arrows in Firefox
    var svg = document.getElementById("i-" + which).cloneNode(true);
    svg.setAttribute("class", svg.id.replace("i-", ""));
    svg.removeAttribute("id");

    // Edge doesn't support outerHTML on SVG
    var html = svg.outerHTML || document.createElement("div").appendChild(svg).parentNode.innerHTML;
    return html.replace(/(?!<\/)?symbol/g, "svg");
  }
  Handlebars.registerHelper("svg", svg);

  if (droppy.detects.mobile) {
    document.documentElement.classList.add("mobile");
  } if (droppy.detects.webp) {
    droppy.imageTypes.webp = "image/webp";
  }
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
    loop: true,
    autonext: false,
    renameExistingOnUpload: false,
  };

  function savePrefs(prefs) {
    try {
      localStorage.setItem("prefs", JSON.stringify(prefs));
    } catch (err) {
      console.error(err);
    }
  }
  function loadPrefs() {
    var ret;
    try {
      ret = JSON.parse(localStorage.getItem("prefs"));
      if (!ret) throw new Error();
    } catch (err) {
      // saved will be 'null' for Safari in private browsing mode
      ret = defaults;
    }
    return ret;
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
  var type = document.body.dataset.type;
  if (type === "m") {
    render("main");
    initMainPage();
  } else {
    render("login", {first: type === "f"});
    initAuthPage(type === "f");
  }
  // ============================================================================
  //  <main> renderer
  // ============================================================================
  function render(page, args) {
    $("main").replaceWith(Handlebars.templates[page](args));
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
    droppy.views[vId] = view[0];

    if (droppy.views.length > 1) {
      droppy.views.forEach(function(view) {
        $(view).addClass(view.vId === 0 ? "left" : "right");
        $(view).find(".newview svg").replaceWith(svg("window-cross"));
        $(view).find(".newview")[0].setAttribute("aria-label", "Close this view");
      });
    }

    view.appendTo("main");
    view[0].vId = vId;
    view[0].uploadId = 0;

    if (dest) updateLocation(view, dest);
    initButtons(view);
    bindDropEvents(view);
    bindHoverEvents(view);
    allowDrop(view);
    checkClipboard();

    droppy.views.forEach(function(view) {
      checkPathOverflow($(view));
      if (view.ps) view.ps.updateSize(true);
    });

    return getView(vId);
  }

  function destroyView(vId) {
    getView(vId).remove();
    droppy.views = droppy.views.filter(function(_, i) { return i !== vId; });
    droppy.views.forEach(function(view) {
      $(view).removeClass("left right");
      $(view).find(".newview svg").replaceWith(svg("window"));
      $(view).find(".newview")[0].setAttribute("aria-label", "Create new view");
      checkPathOverflow($(view));
      view.vId = 0;
      if (view.ps) view.ps.updateSize(true);
    });
    sendMessage(vId, "DESTROY_VIEW");
  }
  // ============================================================================
  //  WebSocket handling
  // ============================================================================
  function init() {
    droppy.wsRetries = 5; // reset retries on connection loss
    if (!droppy.initialized) sendMessage(null, "REQUEST_SETTINGS");
    if (droppy.queuedData) {
      sendMessage();
    } else {
      // Create new view with initializing
      getLocationsFromHash().forEach(function(string, index) {
        var dest = join(decodeURIComponent(string));
        newView(dest, index);
      });
    }
  }

  function openSocket() {
    droppy.socket = new WebSocket(
      location.origin.replace(/^http/, "ws") + location.pathname + "!/socket"
    );
    droppy.socket.onopen = function() {
      if (droppy.token) {
        init();
      } else {
        ajax({url: "!/token", headers: {"x-app": "droppy"}}).then(function(res) {
          return res.text();
        }).then(function(text) {
          droppy.token = text;
          init();
        });
      }
    };
    // https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent#Close_codes
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
        if (typeof view[0].dataset.type === "undefined" || view[0].switchRequest) {
          view[0].dataset.type = "directory"; // For initial loading
        }
        if (!view.length) return;
        if (view[0].dataset.type === "directory") {
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
        } else if (view[0].dataset.type === "media") {
          view[0].currentData = msg.data;
          // TODO: Update media array
        }
        break;
      case "UPDATE_BE_FILE":
        openFile(getView(vId), msg.folder, msg.file);
        break;
      case "RELOAD":
        if (msg.css) {
          $("#css").remove();
          $("<style id='css'>" + msg.css + "</style>").appendTo($("head"));
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
        file.removeClass("dirty").addClass(msg.status === 0 ? "saved" : "save-failed");
        setTimeout(function() {
          file.removeClass("saved save-failed");
        }, 3000);
        break;
      case "SETTINGS":
        Object.keys(msg.settings).forEach(function(setting) {
          droppy[setting] = msg.settings[setting];
        });

        $("#about-title")[0].textContent = "droppy " + droppy.version;
        $("#about-engine")[0].textContent = droppy.engine;

        droppy.themes = droppy.themes.split("|");
        droppy.modes = droppy.modes.split("|");

        // Move own theme to top of theme list
        droppy.themes.pop();
        droppy.themes.unshift("droppy");

        // Insert plain mode on the top
        droppy.modes.unshift("plain");

        if (droppy.dev) {
          window.droppy = droppy;
        }
        if (droppy.readOnly) {
          document.documentElement.classList.add("readonly");
        }
        if (droppy.demo || droppy.public) {
          document.documentElement.classList.add("public");
        }
        break;
      case "MEDIA_FILES":
        loadMedia(view, msg.files);
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

  // ============================================================================
  //  Authentication page
  // ============================================================================
  function initAuthPage(firstrun) {
    $("#remember").reg("click", function() {
      $(this).toggleClass("checked");
    });
    $("#form").reg("submit", function(e) {
      e.preventDefault();
      ajax({
        method: "POST",
        url: firstrun ? "!/adduser" : "!/login",
        data: {
          username: $("#user")[0].value,
          password: $("#pass")[0].value,
          remember: $("#remember").hasClass("checked"),
          path: getRootPath(),
        }
      }).then(function(res) {
        if (res.status === 200) {
          render("main");
          initMainPage();
        } else {
          var info = $("#login-info-box");
          info.textContent = firstrun ? "Please fill both fields." : "Wrong login!";
          if (info.hasClass("error")) {
            info.addClass("shake");
            setTimeout(function() {
              info.removeClass("shake");
            }, 500);
          } else info[0].className = "error";
          if (!firstrun) $("#pass")[0].focus();
        }
      });
    });
  }
  // ============================================================================
  //  Main page
  // ============================================================================
  function initMainPage() {
    droppy.initialized = false;
    // Open the WebSocket
    openSocket();

    // Re-fit path line after 25ms of no resizing
    $(window).reg("resize", function() {
      clearTimeout(droppy.resizeTimer);
      droppy.resizeTimer = setTimeout(function() {
        $(".view").each(function() {
          checkPathOverflow($(this));
        });
      }, 25);
    });

    Mousetrap.bind("escape", function() { // escape hides modals
      toggleCatcher(false);
    }).bind("mod+s", function(e) { // stop default browser save behaviour
      e.preventDefault();
    }).bind(["space", "down", "right", "return"], function() {
      var view = getActiveView();
      if (view[0].dataset.type === "media") view[0].ps.next();
    }).bind(["shift+space", "up", "left", "backspace"], function() {
      var view = getActiveView();
      if (view[0].dataset.type === "media") view[0].ps.prev();
    }).bind(["alt+enter", "f"], function() {
      var view = getActiveView();
      if (!view || view[0].dataset.type !== "media") return;
      screenfull.toggle(view.find(".content")[0]);
    });

    // track active view
    $(window).on("click dblclick contextmenu", function(e) {
      var view = $(e.target).parents(".view");
      if (!view.length) return;
      droppy.activeView = view[0].vId;
      toggleButtons(view, view[0].dataset.type);
    });

    // handle pasting text and images in directory view
    window.addEventListener("paste", function(e) {
      var view = getActiveView();
      if (view[0].dataset.type !== "directory") return;
      var cd = e.clipboardData;
      if (cd.items) { // modern browsers
        arr(cd.items).forEach(function(item) {
          var texts = [];
          var images = [];
          if (item.kind === "string") {
            item.getAsString(function(text) {
              texts.push(new Blob([text], {type: "text/plain"}));
            });
          } else if (item.kind === "file" && /^image/.test(item.type)) {
            images.push(item.getAsFile());
          }
          // if a image is found, don't upload additional text blobs
          if (images.length) {
            images.forEach(function(image) {
              uploadBlob(view, image);
            });
          } else {
            texts.forEach(function(text) {
              uploadBlob(view, text);
            });
          }
        });
      } else { // Safari specific
        if (cd.types.indexOf("text/plain") !== -1) {
          var blob = new Blob([cd.getData("Text")], {type: "text/plain"});
          uploadBlob(view, blob);
          $(".ce").empty();
          if (droppy.savedFocus) droppy.savedFocus.focus();
        } else {
          var start = performance.now();
          (function findImages() {
            var images = $(".ce img");
            if (!images.length && performance.now() - start < 5000) {
              return setTimeout(findImages, 25);
            }
            images.each(function() {
              urlToPngBlob(this.src, function(blob) {
                uploadBlob(view, blob);
                $(".ce").empty();
                if (droppy.savedFocus) droppy.savedFocus.focus();
              });
            });
          })();
        }
      }
    });

    // Hacks for Safari to be able to paste
    if (droppy.detects.safari) {
      $("body").append('<div class="ce" contenteditable>');
      window.addEventListener("keydown", function(e) {
        if (e.metaKey && e.which === 86 /* V */) {
          if (e.target.nodeName.toLowerCase() !== "input") {
            droppy.savedFocus = document.activeElement;
            $(".ce")[0].focus();
          }
        }
      });
    }

    screenfull.on("change", function() {
      // unfocus the fullscreen button so the space key won't un-toggle fullscreen
      document.activeElement.blur();
      $("svg.fullscreen, svg.unfullscreen").replaceWith(
        svg(screenfull.isFullscreen ? "unfullscreen" : "fullscreen")
      );
    });

    droppy.fileInput = $("#file")[0];
    (new Uppie())(droppy.fileInput, function(event, fd, files) {
      event.preventDefault();
      event.stopPropagation();
      var view = getActiveView();
      if (!validateFiles(files, view)) return;
      upload(view, fd, files);
      droppy.fileInput.value = "";
    });

    initEntryMenu();
  }
  // ============================================================================
  //  Upload functions
  // ============================================================================
  function uploadBlob(view, blob) {
    var fd = new FormData();
    var name = "Pasted ";
    if (/^image/.test(blob.type)) {
      name += "Image " + dateFilename() + "." + imgExtFromMime(blob.type);
    } else {
      name += "Text " + dateFilename() + ".txt";
    }
    fd.append("files[]", blob, name);
    upload(view, fd, [name]);
  }

  function upload(view, fd, files) {
    if (!files || !files.length) return showError(view, "Unable to upload.");
    var id = view[0].uploadId += 1;
    var xhr = new XMLHttpRequest();

    // Render upload bar
    $(Handlebars.templates["upload-info"]({
      id: id,
      title: files.length === 1 ? basename(files[0]) : files.length + " files",
    })).appendTo(view).transition("in").find(".upload-cancel").reg("click", function() {
      xhr.abort();
      uploadCancel(view, id);
    });

    // Create the XHR2 and bind the progress events
    xhr.upload.addEventListener("progress", throttle(function(e) {
      if (e.lengthComputable) uploadProgress(view, id, e.loaded, e.total);
    }, 100));
    xhr.upload.addEventListener("error", function() {
      showError(view, "An error occurred during upload.");
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

    view[0].isUploading = true;
    view[0].uploadStart = performance.now();

    xhr.open("POST", getRootPath() + "!/upload?vId=" + view[0].vId +
     "&to=" + encodeURIComponent(view[0].currentFolder) +
     "&r=" + (droppy.get("renameExistingOnUpload") && "1" || "0")
    );
    xhr.responseType = "text";
    xhr.send(fd);
  }

  function uploadSuccess(id) {
    var info = $('.upload-info[data-id="' + id + '"]');
    info.find(".upload-bar")[0].style.width = "100%";
    info.find(".upload-percentage")[0].textContent = "100%";
    info.find(".upload-title")[0].textContent = "Processing ...";
  }

  function uploadCancel(view, id) {
    uploadFinish(view, id);
    sendMessage(view[0].vId, "REQUEST_UPDATE", view[0].currentFolder);
  }

  function uploadFinish(view, id) {
    view[0].isUploading = false;
    setTitle(basename(view[0].currentFolder));
    $('.upload-info[data-id="' + id + '"]').removeClass("in").transitionend(function() {
      $(this).remove();
    });
    showNotification("Upload finished", "Uploaded to " + view[0].currentFolder + " finished");
  }

  function uploadProgress(view, id, sent, total) {
    if (!view[0].isUploading) return;
    var info = $('.upload-info[data-id="' + id + '"]');
    var progress = (Math.round((sent / total) * 1000) / 10).toFixed(0) + "%";
    var now = performance.now();
    var speed = sent / ((now - view[0].uploadStart) / 1e3);
    var elapsed, secs;

    elapsed = now - view[0].uploadStart;
    secs = ((total / (sent / elapsed)) - elapsed) / 1000;

    if (Number(view.find(".upload-info")[0].dataset.id) === id) setTitle(progress);
    info.find(".upload-bar")[0].style.width = progress;
    info.find(".upload-percentage")[0].textContent = progress;
    info.find(".upload-time")[0].textContent = [
      secs > 60 ? Math.ceil(secs / 60) + " mins" : Math.ceil(secs) + " secs",
      formatBytes(Math.round(speed / 1e3) * 1e3) + "/s",
    ].join(" @ ");
  }

  // ============================================================================
  //  General helpers
  // ============================================================================
  function entryRename(view, entry, wasEmpty, callback) {
    // Populate active files list
    var activeFiles = []; // TODO: Update when files change
    entry.siblings(".data-row").each(function() { // exclude existing entry for case-only rename
      $(this).removeClass("editing invalid");
      var name = droppy.caseSensitive ? this.dataset.name : this.dataset.name.toLowerCase();
      if (name) activeFiles.push(name);
    });

    // Hide menu, overlay and the original link, stop any previous edits
    toggleCatcher(false);
    var link = entry.find(".entry-link");
    var linkText = link[0].textContent;
    var canSubmit = validFilename(linkText, droppy.platform);
    entry.addClass("editing");

    // Add inline element
    var renamer = $('<input type="text" class="inline-namer" value="' + linkText +
                    '" placeholder="' + linkText + '">').insertAfter(link);
    renamer.reg("input", function() {
      var input = this.value;
      var valid = validFilename(input, droppy.platform);
      var exists = activeFiles.some(function(file) {
        if (file === (droppy.caseSensitive ? input : input.toLowerCase())) return true;
      });
      canSubmit = valid && !exists;
      entry[canSubmit ? "removeClass" : "addClass"]("invalid");
    }).reg("blur focusout", submitEdit.bind(null, view, true, callback));

    var nameLength = linkText.lastIndexOf(".");
    renamer[0].setSelectionRange(0, nameLength > -1 ? nameLength : linkText.length);
    renamer[0].focus();

    Mousetrap(renamer[0])
      .bind("escape", stopEdit.bind(null, view, entry, wasEmpty))
      .bind("return", submitEdit.bind(null, view, false, callback));

    function submitEdit(view, skipInvalid, callback) {
      var success;
      var oldVal = renamer[0].getAttribute("placeholder");
      var newVal = renamer[0].value;
      if (canSubmit) {
        success = true;
        stopEdit(view, entry, wasEmpty);
      } else if (!skipInvalid) {
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

    if (show === undefined) {
      show = modals.some(function(selector) { return $(selector).hasClass("in"); });
    }

    if (!show) {
      modals.forEach(function(selector) { $(selector)[show ? "addClass" : "removeClass"]("in"); });
      $(".data-row.active").removeClass("active");
    }

    cc.reg("click", toggleCatcher.bind(null, false));
    cc[show ? "addClass" : "removeClass"]("in");
  }

  // Update the page title
  function setTitle(text) {
    document.title = (text || "/") + " - droppy";
  }

  // Listen for popstate events, which indicate the user navigated back
  $(window).reg("popstate", function() {
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
    if (view[0].currentFolder === undefined) {
      return ""; // return an empty string so animDirection gets always set to 'forward' on launch
    } else {
      return join(view[0].currentFolder, view[0].currentFile);
    }
  }

  function getLocationsFromHash() {
    var locations = location.hash.split("#");
    locations.shift();

    if (locations.length === 0) {
      locations.push("");
    }

    locations.forEach(function(part, i) {
      locations[i] = part.replace(/\/*$/g, "");
      if (locations[i] === "") locations[i] = "/";
    });
    return locations;
  }

  function getHashPaths(modview, dest) {
    var path = location.pathname;
    droppy.views.forEach(function(view) {
      view = $(view);
      if (modview && modview.is(view)) {
        path += "/#" + dest;
      } else {
        path += "/#" + getViewLocation(view);
      }
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
          if (!viewLoc || viewDest.length === viewLoc.length) {
            view[0].animDirection = "center";
          } else if (viewDest.length > viewLoc.length) {
            view[0].animDirection = "forward";
          } else {
            view[0].animDirection = "back";
          }

          sendMessage(view[0].vId, "REQUEST_UPDATE", viewDest);

          // Skip the push if we're already navigating through history
          if (!skipPush) pushHistory(view, viewDest);
        } else setTimeout(queue, 50, time + 50);
      })(time);
    }
    if (view === null) {
      // Only when navigating backwards
      for (var i = destination.length - 1; i >= 0; i--) {
        if (destination[i].length && getViewLocation(getView(i)) !== destination[i]) {
          sendReq(getView(i), destination[i], 0);
        }
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
            var part = $(view.find(".path li")[i]);
            part.html("<a>" + parts[i] + "</a>" + svg("triangle"));
            part[0].dataset.destination = pathStr;
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
      li[0].dataset.destination = path;
      li.reg("click", function(event) {
        var view = $(event.target).parents(".view");
        if (droppy.socketWait) return;
        if ($(this).is(":last-child")) {
          if ($(this).parents(".view")[0].dataset.type === "directory") {
            updateLocation(view, this.dataset.destination);
          }
        } else {
          view[0].switchRequest = true; // This is set so we can switch out of a editor view
          updateLocation(view, this.dataset.destination);
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

  // Check if the path indicator overflows and scroll it if necessary
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
        sprite  : getSpriteClass(fileExtension(name))
      };

      if (Object.keys(droppy.audioTypes).indexOf(fileExtension(name)) !== -1) {
        var playing = view.find(".playing"), classes = "playable";
        if (playing.length && name.toLowerCase() === playing[0].dataset.name) {
          classes += " playable";
        }
        entry.classes = classes;
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

    entries = sortArrayByProp(entries, sortBy);
    if (view[0].sortAsc) entries.reverse();

    var sort = {type: "", mtime: "", size: ""};
    sort[sortBy] = "active " + (view[0].sortAsc ? "up" : "down");

    var html = Handlebars.templates.directory({entries: entries, sort: sort});
    loadContent(view, "directory", null, html).then(function() {
      // Upload button on empty page
      view.find(".empty").reg("click", function() {
        var inp = $("#file");
        if (droppy.detects.directoryUpload) {
          droppy.dir.forEach(function(attr) {
            inp[0].removeAttribute(attr);
          });
        }
        inp[0].click();
      });

      // Switch into a folder
      view.find(".folder-link").reg("click", function(event) {
        if (droppy.socketWait) return;
        updateLocation(view, $(this).parents(".data-row")[0].dataset.id);
        event.preventDefault();
      });

      // Click on a file link
      view.find(".file-link").reg("click", function(event) {
        if (droppy.socketWait) return;
        var view = $(event.target).parents(".view");
        openFile(view, view[0].currentFolder, event.target.textContent, this);
        event.preventDefault();
      });

      view.find(".data-row").each(function(index) {
        this.setAttribute("order", index);
      });

      view.find(".data-row").reg("contextmenu", function(event) {
        var target = $(event.currentTarget);
        if (target[0].dataset.type === "error") return;
        showEntryMenu(target, event.clientX, event.clientY);
        event.preventDefault();
      });

      view.find(".data-row .entry-menu").reg("click", function(event) {
        showEntryMenu($(event.target).parents(".data-row"), event.clientX, event.clientY);
      });

      // Stop navigation when clicking on an <a>
      view.find(".data-row .zip, .data-row .download, .entry-link.file").reg("click", function(event) {
        event.stopPropagation();
        if (droppy.socketWait) return;

        // Some browsers (like IE) think that clicking on an <a> is real navigation
        // and will close the WebSocket in turn. We'll reconnect if necessary.
        // Firefox is not affected as long as the <a> bears a `download` attribute,
        // if it's missing it will disconnect a WebSocket as long as
        // https://bugzilla.mozilla.org/show_bug.cgi?id=896666 is not fixed.
        droppy.reopen = true;
        setTimeout(function() {
          droppy.reopen = false;
        }, 2000);
      });

      // Request a sharelink
      view.find(".share-file").reg("click", function() {
        if (droppy.socketWait) return;
        requestLink($(this).parents(".view"), $(this).parents(".data-row")[0].dataset.id, true);
      });

      view.find(".icon-play").reg("click", function() {
        var view = $(this).parents(".view");

        if ($(this).parents(".data-row").hasClass("playing")) {
          return;
        }

        play(view, $(this).parents(".data-row"));
      });

      view.find(".header-name, .header-mtime, .header-size").reg("click", function() {
        sortByHeader(view, $(this));
      });

      hideSpinner(view);
    });
  }

  // Load new view content
  function loadContent(view, type, mediaType, content) {
    return new Promise(function(resolve) {
      if (view[0].isAnimating) return; // Ignore mid-animation updates. TODO: queue and update on animation-end
      view[0].dataset.type = type;
      mediaType = mediaType ? " type-" + mediaType : "";
      content = '<div class="new content ' + type + mediaType + " " + view[0].animDirection + '">' + content + "</div>";
      var navRegex = /(forward|back|center)/;
      if (view[0].animDirection === "center") {
        view.find(".content").replaceClass(navRegex, "center").before(content);
        view.find(".new").addClass(type);
        finish();
      } else {
        view.children(".content-container").append(content);
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
        if (view[0].dataset.type === "directory") {
          bindDragEvents(view);
        }
        toggleButtons(view, type);
        resolve();
      }
    });
  }

  function toggleButtons(view, type) {
    view.find(".af, .ad, .cf, .cd")[type === "directory" ? "removeClass" : "addClass"]("disabled");
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
      if (x < limit) {
        left = x + limit;
      } else if (x + limit > innerWidth) {
        left = x - limit;
      } else {
        left = x;
      }

      dropSelect[0].style.left = left + "px";
      dropSelect[0].style.top = event.originalEvent.clientY + "px";
      dropSelect.addClass("in");

      $(document.elementFromPoint(x, y)).addClass("active").one("mouseleave", function() {
        $(this).removeClass("active");
      });
      toggleCatcher(true);
      dropSelect.children(".movefile").regOne("click", function() {
        sendDrop(view, "cut", src, dst, spinner);
        toggleCatcher(false);
      });
      dropSelect.children(".copyfile").regOne("click", function() {
        sendDrop(view, "copy", src, dst, spinner);
        toggleCatcher(false);
      });
      dropSelect.children(".viewfile").regOne("click", function() {
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
    view.find(".data-row .entry-link").each(function() {
      this.setAttribute("draggable", "true");
    });
    view.reg("dragstart", function(event) {
      var row = $(event.target).hasClass("data-row") ? $(event.target) : $(event.target).parents(".data-row");

      if (event.ctrlKey || event.metaKey || event.altKey) {
        view[0].dragAction = "copy";
      } else if (event.shiftKey) {
        view[0].dragAction = "cut";
      }

      droppy.dragTimer.refresh(row[0].dataset.id);
      event.originalEvent.dataTransfer.setData("text", JSON.stringify({
        type: row[0].dataset.type,
        path: row[0].dataset.id,
      }));
      event.originalEvent.dataTransfer.effectAllowed = "copyMove";
      if ("setDragImage" in event.originalEvent.dataTransfer) {
        event.originalEvent.dataTransfer.setDragImage(row.find(".sprite")[0], 0, 0);
      }
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
      if (!this.isInternal) {
        $(".dropzone").removeClass("in");
      }
      clearTimeout(this.timer);
      this.isInternal = false;
      this.data = "";
    };
  }
  droppy.dragTimer = new DragTimer();

  function allowDrop(el) {
    el.reg("dragover", function(e) {
      e.preventDefault();
      droppy.dragTimer.refresh();
    });
  }

  function bindHoverEvents(view) {
    var dropZone = view.find(".dropzone");
    view.reg("dragenter", function(event) {
      event.stopPropagation();
      droppy.activeView = view[0].vId;
      var icon, isInternal = event.originalEvent.dataTransfer.effectAllowed === "copyMove";
      if (view[0].dataset.type === "directory" && isInternal) {
        icon = "menu";
      } else if (!isInternal) {
        icon = "upload-cloud";
      } else {
        icon = "open";
      }

      view.find(".dropzone svg").replaceWith(svg(icon));
      if (!dropZone.hasClass("in")) dropZone.addClass("in");

      getOtherViews($(event.target).parents(".view")[0].vId).find(".dropzone").removeClass("in");
    });
  }

  function bindDropEvents(view) {
    // file drop
    (new Uppie())(view[0], function(event, fd, files) {
      var view = getActiveView();
      if (droppy.readOnly) return showError(view, "Files are read-only.");
      if (!files.length) return;
      event.stopPropagation();
      if (!validateFiles(files, view)) return;
      upload(view, fd, files);
    });

    // drag between views
    view.reg("drop", function(event) {
      var dragData = event.originalEvent.dataTransfer.getData("text");
      var view = $(event.target).parents(".view");
      event.preventDefault();
      $(".dropzone").removeClass("in");

      if (!dragData) return;

      event.stopPropagation();
      dragData = JSON.parse(dragData);
      if (view[0].dataset.type === "directory") { // dropping into a directory view
        handleDrop(view, event, dragData.path, join(view[0].currentFolder, basename(dragData.path)), true);
      } else { // dropping into a document/media view
        if (dragData.type === "folder") {
          view[0].dataset.type = "directory";
          updateLocation(view, dragData.path);
        } else {
          if (join(view[0].currentFolder, view[0].currentFile) !== dragData.path) {
            openFile(view, dirname(dragData.path), basename(dragData.path));
          }
        }
      }
    });
  }

  function initButtons(view) {
    // File upload button
    view.find(".af").reg("click", function() {
      if ($(this).hasClass("disabled")) return;
      // Remove the directory attributes so we get a file picker dialog
      if (droppy.detects.directoryUpload) {
        droppy.dir.forEach(function(attr) {
          droppy.fileInput.removeAttribute(attr);
        });
      }
      droppy.fileInput.click();
    });

    // Folder upload button - check if we support directory uploads
    if (droppy.detects.directoryUpload) {
      // Directory uploads supported - enable the button
      view.find(".ad").reg("click", function() {
        if ($(this).hasClass("disabled")) return;
        // Set the directory attribute so we get a directory picker dialog
        droppy.dir.forEach(function(attr) {
          droppy.fileInput.setAttribute(attr, attr);
        });
        if (droppy.fileInput.isFilesAndDirectoriesSupported) {
          droppy.fileInput.click();
        } else if (droppy.fileInput.chooseDirectory) {
          droppy.fileInput.chooseDirectory();
        } else {
          droppy.fileInput.click();
        }
      });
    } else {
      // No directory upload support - disable the button
      view.find(".ad").addClass("disabled").on("click", function() {
        showError(getView(0), "Your browser doesn't support directory uploading");
      });
    }

    view.find(".cf, .cd").reg("click", function() {
      if ($(this).hasClass("disabled")) return;
      var view = getActiveView();
      var content = view.find(".content");
      var isFile = this.classList.contains("cf");
      var isEmpty = Boolean(view.find(".empty").length);
      var html = Handlebars.templates[isFile ? "new-file" : "new-folder"]();

      stopEdit(view, view.find(".editing"), isEmpty);
      if (isEmpty) content.html(Handlebars.templates["file-header"]());
      content.prepend(html);
      content[0].scrollTop = 0;
      var dummy = $(".data-row.new-" + (isFile ? "file" : "folder"));
      entryRename(view, dummy, isEmpty, function(success, _oldVal, newVal) {
        if (!success) return;
        if (view[0].dataset.type === "directory") showSpinner(view);
        sendMessage(view[0].vId, "CREATE_" + (isFile ? "FILE" : "FOLDER"), newVal);
      });
    });

    view.find(".newview").reg("click", function() {
      if (droppy.views.length === 1) {
        var dest = join(view[0].currentFolder, view[0].currentFile);
        replaceHistory(newView(dest, 1), dest);
      } else {
        destroyView(view[0].vId);
        replaceHistory(view, join(view[0].currentFolder, view[0].currentFile));
      }
    });

    view.find(".about").reg("click", function() {
      $("#about-box").addClass("in");
      toggleCatcher();
    });

    view.find(".prefs").reg("click", function() {
      showPrefs();
      if (droppy.priv) sendMessage(null, "GET_USERS");
    });

    view.find(".logout").reg("click", function() {
      ajax({
        method: "POST",
        url: "!/logout",
        data: {
          path: getRootPath(),
        },
      }).then(function() {
        droppy.socket.close(4000);
        render("login");
        initAuthPage();
      });
    });
  }

  function initEntryMenu() {
    // Play an audio file
    $("#entry-menu .play").reg("click", function(event) {
      event.stopPropagation();
      var entry = droppy.menuTarget, view = entry.parents(".view");
      play(view, entry);
      toggleCatcher(false);
    });

    $("#entry-menu .edit").reg("click", function(event) {
      event.stopPropagation();
      var entry = droppy.menuTarget, view = entry.parents(".view");
      toggleCatcher(false);
      view[0].currentFile = entry.find(".file-link")[0].textContent;
      var location = join(view[0].currentFolder, view[0].currentFile);
      pushHistory(view, location);
      updatePath(view);
      openDoc(view, location);
    });

    // Click on a "open" link
    $("#entry-menu .openfile").reg("click", function(event) {
      event.stopPropagation();
      var entry = droppy.menuTarget, view = entry.parents(".view");
      toggleCatcher(false);
      if (entry[0].dataset.type === "folder") {
        updateLocation(view, entry[0].dataset.id);
      } else {
        openFile(view, view[0].currentFolder, entry.find(".file-link")[0].textContent);
      }
    });

    // Rename a file/folder
    $("#entry-menu .rename").reg("click", function(event) {
      event.stopPropagation();
      var entry = droppy.menuTarget, view = entry.parents(".view");
      if (droppy.socketWait) return;
      entryRename(view, entry, false, function(success, oldVal, newVal) {
        if (success && newVal !== oldVal) {
          showSpinner(view);
          sendMessage(view[0].vId, "RENAME", {src: oldVal, dst: newVal});
        }
      });
    });

    // Copy/cut a file/folder
    $("#entry-menu .copy, #entry-menu .cut").reg("click", function(event) {
      event.stopPropagation();
      toggleCatcher(false);
      droppy.clipboard = {
        type: this.className,
        src: droppy.menuTarget[0].dataset.id
      };
      checkClipboard();
    });

    // Delete a file/folder
    $("#entry-menu .delete").reg("click", function(event) {
      var entry = droppy.menuTarget, view = entry.parents(".view");
      event.stopPropagation();
      if (droppy.socketWait) return;

      toggleCatcher(false);
      showSpinner(view);
      sendMessage(view[0].vId, "DELETE_FILE", entry[0].dataset.id);
    });
  }

  // Check if there's something in the clipboard
  function checkClipboard() {
    if (droppy.clipboard) {
      $(".view").each(function() {
        var view = $(this), button = view.find(".paste-button");
        button.addClass("in").regOne("click", function(event) {
          event.stopPropagation();
          if (droppy.socketWait) return;
          droppy.clipboard.dst = join(view[0].currentFolder, basename(droppy.clipboard.src));
          showSpinner(view);
          sendMessage(view[0].vId, "CLIPBOARD", droppy.clipboard);
          droppy.clipboard = null;
          toggleCatcher(false);
          $(".paste-button").removeClass("in");
        }).transition("in");
      });
    } else {
      $(".paste-button").removeClass("in");
    }
  }

  function showEntryMenu(entry, x, y) {
    var menu = $("#entry-menu");
    var maxTop = window.innerHeight - menu[0].clientHeight - 4;
    var maxLeft = window.innerWidth - menu[0].clientWidth - 4;
    var top = entry[0].getBoundingClientRect().top + document.body.scrollTop;
    var left = x - menu[0].clientWidth / 2;
    var spriteClass = entry.find(".sprite")[0].className;

    menu[0].className = "type-" + /sprite-(\w+)/.exec(spriteClass)[1];
    entry.addClass("active");
    toggleCatcher(true);
    menu[0].style.left = (left > 0 ? (left > maxLeft ? maxLeft : left) : 0) + "px";
    menu[0].style.top = (top > maxTop ? maxTop : top) + "px";
    droppy.menuTarget = entry;
    menu[0].classList.add("in");

    var target = document.elementFromPoint(x, y);
    target = target.tagName.toLowerCase() === "a" ? $(target) : $(target).parents("a");
    target.addClass("active").one("mouseleave", function() {
      $(this).removeClass("active");
    });
  }

  function sortByHeader(view, header) {
    view[0].sortBy = /header-(\w+)/.exec(header[0].className)[1];
    view[0].sortAsc = header.hasClass("down");
    header[0].className = "header-" + view[0].sortBy + " " + (view[0].sortAsc ? "up" : "down") + " active";
    header.siblings().removeClass("active up down");
    var entries = sortArrayByProp(getTemplateEntries(view, view[0].currentData), header[0].dataset.sort);
    if (view[0].sortAsc) entries = entries.reverse();
    entries.forEach(function(_, i) {
      var entry = view.find('[data-name="' + entries[i].sortname + '"]')[0];
      entry.style.order = i;
      entry.setAttribute("order", i);
    });
  }

  function closeDoc(view) {
    view[0].switchRequest = true;
    view[0].editor = null;
    updateLocation(view, view[0].currentFolder);
  }

  function openFile(view, newFolder, file, ref) {
    var e = fileExtension(file);

    // Determine filetype and how to open it
    if (Object.keys(droppy.imageTypes).indexOf(e) !== -1) { // Image
      view[0].currentFile = file;
      view[0].currentFolder = newFolder;
      pushHistory(view, join(view[0].currentFolder, view[0].currentFile));
      updatePath(view);
      openMedia(view);
    } else if (Object.keys(droppy.videoTypes).indexOf(e) !== -1) { // Video
      if (!droppy.detects.videoTypes[droppy.videoTypes[e]]) {
        showError(view, "Your browser can't play this file");
        updateLocation(view, view[0].currentFolder);
      } else {
        view[0].currentFile = file;
        view[0].currentFolder = newFolder;
        pushHistory(view, join(view[0].currentFolder, view[0].currentFile));
        updatePath(view);

        // if there is audio playing, stop it
        if (view[0].audioInitialized) {
          endAudio(view);
        }

        openMedia(view);
      }
    } else if (Object.keys(droppy.audioTypes).indexOf(e) !== -1) { // Audio
      if (ref) {
        play(view, $(ref).parents(".data-row"));
      }
    } else { // Generic file, ask the server if the file has binary contents
      var filePath = join(newFolder, file);
      showSpinner(view);
      ajax({url: "!/type" + filePath}).then(function(res) {
        return res.text();
      }).then(function(text) {
        if (text === "text") { // Text content
          view[0].currentFile = file;
          view[0].currentFolder = newFolder;
          pushHistory(view, filePath);
          updatePath(view);
          openDoc(view, filePath);
        } else { // Binary content - download it
          download(filePath);
          hideSpinner(view);
        }
      }).catch(function() {
        showError(view, "Couldn't load the file. Maybe disable your ad-blocker?");
        hideSpinner(view);
      });
    }
  }

  function download(path) {
    var a = document.createElement("a");
    a.download = basename(path); // to keep websocket alive
    a.href = "!/dl" + path;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function getMediaSrc(view, filename) {
    var encodedId = join(view[0].currentFolder, filename).split("/");
    var i = encodedId.length - 1;
    for (;i >= 0; i--) {
      encodedId[i] = encodeURIComponent(encodedId[i]);
    }
    return "!/file" + encodedId.join("/");
  }

  function openMedia(view) {
    sendMessage(view[0].vId, "GET_MEDIA", {
      dir: view[0].currentFolder,
      exts: {
        img: Object.keys(droppy.imageTypes),
        vid: Object.keys(droppy.videoTypes),
      },
    });
  }

  function loadMedia(view, files) {
    var startIndex;
    // turn filenames into URLs and obtain index of current file
    files.forEach(function(file, i) {
      if (file.src === view[0].currentFile) startIndex = i;
      file.src = getMediaSrc(view, file.src);
      file.filename = basename(decodeURIComponent(file.src));
      if (file.video) {
        delete file.video;
        file.html = Handlebars.templates.video({
          vid: view[0].vId,
          src: file.src,
        });
        delete file.src;
      }
    });
    Promise.all([
      loadStyle("ps-css", "!/res/lib/ps.css"),
      loadScript("ps-js", "!/res/lib/ps.js"),
    ]).then(function() {
      view[0].animDirection = "forward";
      var html = Handlebars.templates.media({
        autonext: droppy.get("autonext") ? "on " : "",
        loop: droppy.get("loop") ? "on " : "",
      });

      loadContent(view, "media", type, html).then(function() {
        var el = view.find(".pswp")[0];
        view[0].ps = new PhotoSwipe(el, PhotoSwipeUI_Default, files, {
          arrowKeys: false,
          barsSize: {top:0, bottom:0},
          bgOpacity: 1,
          captionEl: false,
          clickToCloseNonZoomable: false,
          closeElClasses: [],
          closeOnScroll: false,
          closeOnVerticalDrag: false,
          escKey: false,
          getDoubleTapZoom: function(_, item) {
            return item.initialZoomLevel * 2;
          },
          hideAnimationDuration: 0,
          history: false,
          index: startIndex,
          maxSpreadZoom: 16,
          modal: false,
          pinchToClose: false,
          shareButtons: [],
          shareEl: false,
          showAnimationDuration: 0,
          spacing: 0,
          timeToIdle: 2500,
          timeToIdleOutside: 2500,
        });

        var autonext = view.find(".autonext");
        var loop = view.find(".loop");
        autonext.reg("click", function() {
          var on = !droppy.get("autonext");
          droppy.set("autonext", on);
          autonext[on ? "addClass" : "removeClass"]("on");
        });
        loop.reg("click", function() {
          var on = !droppy.get("loop");
          droppy.set("loop", on);
          loop[on ? "addClass" : "removeClass"]("on");
        });

        // needed for plyr seeking
        view[0].ps.listen("preventDragEvent", function(e, _isDown, preventObj) {
          preventObj.prevent = e.target.classList.contains("pswp__img");
        });
        view[0].ps.listen("afterChange", function() {
          // clear possible focus on buttons so spacebar works as expected
          var focused = document.activeElement;
          if ($(focused).hasClass("pswp__button")) focused.blur();

          view[0].currentFile = this.currItem.filename;
          var imgButtons = view.find(".fit-h, .fit-v");
          var videoButtons = view.find(".loop, .autonext");
          if (this.currItem.html) { // video
            initVideo($(this.currItem.container).find("video")[0]);
            imgButtons.addClass("hidden");
            videoButtons.removeClass("hidden");
          } else { // image
            imgButtons.removeClass("hidden");
            videoButtons.addClass("hidden");

            // pause invisible videos
            view.find("video").each(function() {
              this.pause();
            });
          }
          setTitle(this.currItem.filename.replace(/\..*/g, ""));
          replaceHistory(view, join(view[0].currentFolder, view[0].currentFile));
          updatePath(view);
        });
        view[0].ps.listen("preventDragEvent", function(_, isDown) {
          view.find(".pswp__container")[0].classList[isDown ? "add" : "remove"]("no-transition");
        });
        view[0].ps.listen("destroy", function() {
          view[0].switchRequest = true;
          view[0].ps = null;
          updateLocation(view, view[0].currentFolder);
        });

        var dur = 300;
        function middle(ps) {
          return {x: ps.viewportSize.x / 2, y: ps.viewportSize.y / 2};
        }
        // fit zoom buttons
        view[0].ps.zoomed = {h: false, v: false};
        function fitH() {
          var vw = view[0].ps.viewportSize.x, iw = view[0].ps.currItem.w;
          var initial = view[0].ps.currItem.initialZoomLevel;
          var level = view[0].ps.zoomed.h ? initial : vw / iw;
          view[0].ps.zoomTo(level, middle(view[0].ps), dur);
          view[0].ps.zoomed.v = false;
          view[0].ps.zoomed.h = !view[0].ps.zoomed.h;
        }
        function fitV() {
          var vh = view[0].ps.viewportSize.y, ih = view[0].ps.currItem.h;
          var initial = view[0].ps.currItem.initialZoomLevel;
          var level = view[0].ps.zoomed.v ? initial : vh / ih;
          view[0].ps.zoomTo(level, middle(view[0].ps), dur);
          view[0].ps.zoomed.h = false;
          view[0].ps.zoomed.v = !view[0].ps.zoomed.v;
        }
        view.find(".fit-h").reg("click", fitH);
        view.find(".fit-v").reg("click", fitV);
        view[0].ps.listen("afterChange", function() {
          if (view[0].ps.zoomed.h) {
            view[0].ps.zoomed.h = false;
            fitH(0);
          } else if (view[0].ps.zoomed.v) {
            view[0].ps.zoomed.v = false;
            fitV(0);
          }
        });
        view.find(".zoom-in").reg("click", function(e) {
          var level = view[0].ps.getZoomLevel() * 2;
          view[0].ps.zoomTo(level, middle(view[0].ps), dur);
          $(e.target).parents(".pswp").addClass("pswp--zoomed-in");
        });
        view.find(".zoom-out").reg("click", function() {
          var level = view[0].ps.getZoomLevel() / 2;
          view[0].ps.zoomTo(level, middle(view[0].ps), dur);
        });

        view[0].ps.init();
        hideSpinner(view);
      });
    });
  }

  function openDoc(view, entryId) {
    var editor;
    showSpinner(view);
    Promise.all([
      ajax("!/file" + entryId),
      loadStyle("cm-css", "!/res/lib/cm.css"),
      loadScript("cm-js", "!/res/lib/cm.js"),
      loadTheme(droppy.get("theme")),
    ]).then(function(values) {
      (function verify() {
        if (!("CodeMirror" in window)) return setTimeout(verify, 200);
        setTitle(basename(entryId));
        setEditorFontSize(droppy.get("editorFontSize"));
        values[0].text().then(function(text) {
          configCM(text, basename(entryId));
        });
      })();
    }).catch(function(err) {
      showError(view, err);
      closeDoc(view);
    });

    function configCM(text, filename) {
      var html = Handlebars.templates.document({modes: droppy.modes});
      loadContent(view, "document", null, html).then(function() {
        view[0].editorEntryId = entryId;
        view[0].editor = editor = CodeMirror(view.find(".document")[0], {
          autofocus: true,
          dragDrop: false,
          indentUnit: droppy.get("indentUnit"),
          indentWithTabs: droppy.get("indentWithTabs"),
          keyMap: "sublime",
          lineNumbers: true,
          lineWrapping: droppy.get("lineWrapping"),
          mode: "text/plain",
          readOnly: droppy.readOnly,
          showCursorWhenSelecting: true,
          styleActiveLine: true,
          styleSelectedText: true,
          tabSize: droppy.get("indentUnit"),
          theme: droppy.get("theme"),
        });

        if (!CodeMirror.autoLoadMode) initModeLoad();

        var mode, fileMode = modeFromShebang(text);
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
        view.find(".mode-select")[0].value = mode;

        editor.on("change", function(cm, change) {
          var view = getCMView(cm);
          if (change.origin !== "setValue") {
            view.find(".path li:last-child").removeClass("saved save-failed").addClass("dirty");
          }
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

        view[0].lineEnding = dominantLineEnding(text);
        editor.setValue(text);
        editor.clearHistory();

        view.find(".exit").reg("click", function() {
          closeDoc($(this).parents(".view"));
          editor = null;
        });
        view.find(".save").reg("click", function() {
          save($(this).parents(".view")[0].editor);
        });
        view.find(".ww").reg("click", function() {
          editor.setOption("lineWrapping", !editor.options.lineWrapping);
          droppy.set("lineWrapping", editor.options.lineWrapping);
        });
        view.find(".syntax").reg("click", function() {
          var shown = view.find(".mode-select").toggleClass("in").hasClass("in");
          view.find(".syntax")[shown ? "addClass" : "removeClass"]("in");
          view.find(".mode-select").on("change", function() {
            view.find(".syntax").removeClass("in");
            view.find(".mode-select").removeClass("in");
            CodeMirror.autoLoadMode(editor, this.value);
            editor.setOption("mode", this.value);
          });
        });
        view.find(".find").reg("click", function() {
          CodeMirror.commands.find(editor);
          view.find(".CodeMirror-search-field")[0].focus();
        });
        view.find(".full").reg("click", function() {
          screenfull.toggle($(this).parents(".content")[0]);
        });
        hideSpinner(view);
      });
    }
  }

  function updateUsers(userlist) {
    if (Object.keys(userlist).length === 0) {
      toggleCatcher(false);
      render("login", {first: true});
      initAuthPage(true);
      return;
    }
    var box = $("#prefs-box");
    box.find(".list-user").remove();
    box.append(Handlebars.templates["list-user"]({users: userlist}));
    box.find(".add-user").reg("click", function() {
      var user = prompt("Username?");
      if (!user) return;
      var pass = prompt("Password?");
      if (!pass) return;
      var priv = confirm("Privileged User?");
      sendMessage(null, "UPDATE_USER", {
        name: user,
        pass: pass,
        priv: priv
      });
    });
    box.find(".delete-user").reg("click", function(event) {
      event.stopPropagation();
      sendMessage(null, "UPDATE_USER", {
        name: $(this).parents("li").children(".username").text().trim(),
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

    $("select.theme").reg("change", function() {
      var theme = this.value;
      loadTheme(theme, function() {
        droppy.set("theme", theme);
        $(".view").each(function() {
          if (this.editor) this.editor.setOption("theme", theme);
        });
      });
    });

    $("select.editorFontSize").reg("change", function() {
      setEditorFontSize(this.value);
    });

    setTimeout(function() {
      box.addClass("in").transitionend(function() {
        this.removeAttribute("style");
      });
      toggleCatcher(true);
      $("#overlay").one("click", function() {
        box.find("select").each(function() {
          var option = this.className;
          var value  = this.value;

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

    if (typeof index === "number") {
      row = view.find('.data-row[data-playindex="' + index + '"]');
    } else {
      row = index;
    }

    if (!view[0].audioInitialized) {
      initAudio(view);
      view[0].audioInitialized = true;
    }

    if (!row[0].dataset.id) {
      return endAudio(view);
    }

    source = "!/file" + row[0].dataset.id;
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
        this.setAttribute("data-playindex", i++);
      });
      view[0].playlistLength = i;
    }
    view[0].playlistIndex = typeof index === "number" ? index : Number(row[0].dataset.playindex);
  }

  function onNewAudio(view) {
    var player = view[0].querySelector(".audio-player");
    var title  = decodeURIComponent(removeExt(basename(player.src).replace(/_/g, " ").replace(/\s+/, " ")));

    view.find(".audio-bar").addClass("in");
    view.find(".audio-title")[0].textContent = title;
    setTitle(title);

    (function updateBuffer() {
      var progress;
      if (player.buffered.length) {
        progress = (player.buffered.end(0) / player.duration) * 100;
      }
      view[0].querySelector(".seekbar-loaded").style.width = (progress || 0) + "%";
      if (!progress || progress < 100) setTimeout(updateBuffer, 100);
    })();

    $(player).reg("timeupdate", function() {
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
    slider.reg("mousedown", function(event) {
      heldVolume = true;
      updateVolume(event);
      event.stopPropagation();
    });
    bar.reg("mousemove", function(event) {
      if (heldVolume) updateVolume(event);
    });
    bar.reg("mouseup", function() {
      heldVolume = false;
    });
    slider.reg("click", function(event) {
      updateVolume(event);
      event.stopPropagation();
    });
    bar.reg("click", function(event) {
      var time = player.duration *
        ((event.pageX - bar[0].getBoundingClientRect().left) / bar[0].clientWidth);
      if (!isNaN(parseFloat(time)) && isFinite(time)) {
        player.currentTime = time;
      } else {
        endAudio($(this).parents(".view"));
      }
    });
    bar.find(".previous").reg("click", function(event) {
      playPrev($(event.target).parents(".view"));
      event.stopPropagation();
    });
    bar.find(".next").reg("click", function(event) {
      playNext($(event.target).parents(".view"));
      event.stopPropagation();
    });
    bar.find(".pause-play").reg("click", function(event) {
      var icon   = $(this).children("svg");
      var player = $(this).parents(".audio-bar").find(".audio-player")[0];
      if (icon[0].className === "play") {
        icon.replaceWith($(svg("pause")));
        player.play();
      } else {
        icon.replaceWith($(svg("play")));
        player.pause();
      }
      event.stopPropagation();
    });

    bar.find(".stop").reg("click", function(event) {
      endAudio($(this).parents(".view"));
      event.stopPropagation();
    });
    bar.find(".shuffle").reg("click", function(event) {
      $(this).toggleClass("active");
      $(this).parents(".view")[0].shuffle = $(this).hasClass("active");
      event.stopPropagation();
    });
    function onWheel(event) {
      if ((event.wheelDelta || -event.detail) > 0) {
        setVolume(player.volume + 0.1);
      } else {
        setVolume(player.volume - 0.1);
      }
    }
    slider[0].addEventListener("mousewheel", onWheel);
    slider[0].addEventListener("DOMMouseScroll", onWheel);
    volumeIcon[0].addEventListener("mousewheel", onWheel);
    volumeIcon[0].addEventListener("DOMMouseScroll", onWheel);
    volumeIcon.reg("click", function(event) {
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
      if (view[0].playlistIndex < view[0].playlistLength - 1) {
        play(view, view[0].playlistIndex + 1);
      } else {
        play(view, 0);
      }
    }
    function playPrev(view) {
      if (view[0].shuffle) return playRandom(view);
      if (view[0].playlistIndex === 0) {
        play(view, view[0].playlistLength - 1);
      } else {
        play(view, view[0].playlistIndex - 1);
      }
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
        if (!CodeMirror.modes.hasOwnProperty(deps[i])) {
          missing.push(deps[i]);
        }
      }
      if (!missing.length) return cont();
      var split = splitCallback(cont, missing.length);
      for (var j = 0; j < missing.length; ++j) {
        CodeMirror.requireMode(missing[j], split);
      }
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

  // video.js
  function initVideo(el) {
    var view = $(el).parents(".view");
    Promise.all([
      loadStyle("plyr-css", "!/res/lib/plyr.css"),
      loadScript("plyr-js", "!/res/lib/plyr.js"),
    ]).then(function() {
      (function verify() {
        if (!("plyr" in window)) {
          return setTimeout(verify, 200);
        }

        // pause other loaded videos in this view
        view.find("video").each(function() {
          if (this !== el) this.pause();
        });

        var player = plyr.setup(el, {
          controls: ["play", "progress", "current-time", "mute", "volume"],
          iconUrl: "!/res/lib/plyr.svg",
          blankUrl: "!/res/lib/blank.mp4",
          autoplay: !droppy.detects.mobile,
          volume: droppy.get("volume") * 10,
          keyboardShortcuts: {focused: true, global: true},
          tooltips: {controls: false, seek: true},
          disableContextMenu: false,
          storage: {enabled: false},
          fullscreen: {enable: false},
          hideControls: true,
        })[0];

        player.on("ready", function() {
          // stop drags from propagating outside the control bar
          $(view).find(".plyr__controls").on("mousemove", function(e) {
            if (e.originalEvent && e.originalEvent.buttons !== 0) {
              e.stopPropagation();
            }
          });
        });

        player.on("ended", function() {
          if (droppy.get("loop")) {
            player.play();
          } else if (droppy.get("autonext")) {
            view[0].ps.next();
          }
        });

        function onError() {
          showError(view, "Your browser can't play this file");
        }
        player.getMedia().onerror = onError;
        player.on("error", onError);

        // skip initial volume set
        setTimeout(function() {
          player.on("volumechange", function() {
            droppy.set("volume", player.isMuted() ? 0 : player.getVolume());
          });
        }, 0);
      })();
    });
  }

  function initVariables() {
    droppy.activeView = 0;
    droppy.demo = null;
    droppy.fileInput = null;
    droppy.initialized = null;
    droppy.linkCache = [];
    droppy.menuTarget = null;
    droppy.public = null;
    droppy.queuedData = null;
    droppy.reopen = null;
    droppy.resizeTimer = null;
    droppy.savedFocus = null;
    droppy.socket = null;
    droppy.socketWait = null;
    droppy.token = null;
    droppy.views = [];
    droppy.wsRetries = 5;
    droppy.wsRetryTimeout = 4000;

    droppy.dir = ["directory", "webkitdirectory", "allowdirs"];

    // Extension to icon mappings
    droppy.iconMap = {
      archive  : ["bz2", "tgz"],
      audio    : ["aac", "aif", "aiff", "flac", "m4a", "m4p", "mid", "mp1", "mp2", "mp3", "mpa", "ra", "ogg", "oga", "opus", "wav", "wma"],
      authors  : ["authors"],
      bin      : ["class", "o", "so", "pyc"],
      bmp      : ["bmp", "xbm"],
      c        : ["c"],
      calc     : ["ods", "ots", "xlr", "xls", "xlsx", "csv", "tsv"],
      cd       : ["cue", "iso"],
      copying  : ["copying", "license"],
      cpp      : ["cpp", "cc", "cxx"],
      css      : ["css", "less", "scss", "sass"],
      deb      : ["deb"],
      diff     : ["diff", "patch"],
      doc      : ["doc", "docx", "odm", "odt", "ott"],
      draw     : ["drw"],
      eps      : ["eps", "ai"],
      exe      : ["bat", "cmd", "exe", "com"],
      gif      : ["gif", "gifv"],
      gzip     : ["gz", "gzip"],
      h        : ["h", "hh", "hxx"],
      hpp      : ["hpp"],
      html     : ["htm", "html", "shtml", "phtml", "hbs", "handlebars"],
      ico      : ["ico"],
      image    : ["svg", "xpm", "webp", "tga", "mng"],
      install  : ["install", "msi", "apk", "dmg"],
      java     : ["java", "jar", "scala", "sc"],
      jpg      : ["jpg", "jpeg", "jp2", "jpx"],
      js       : ["js", "jsx", "es", "es6", "dart", "ls"],
      json     : ["json", "gyp"],
      log      : ["log", "changelog"],
      makefile : ["makefile", "pom", "reg", "am", "BSDmakefile"],
      markdown : ["markdown", "md", "mdown", "mkd"],
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
      script   : ["sh", "csh", "ksh", "bash", "zsh", "fish", "shar", "configure"],
      source   : ["ini", "properties", "conf", "cfg", "config", "lisp", "ovpn", "lua", "yaml", "yml", "toml", "pl", "tcl"],
      sql      : ["sql", "dump"],
      tar      : ["tar"],
      tex      : ["tex"],
      text     : ["text", "txt"],
      tiff     : ["tiff", "tif"],
      vcal     : ["vcal"],
      video    : ["avi", "flv", "mkv", "mov", "mp4", "mpg", "mpeg", "m4v", "mpg", "ogv", "ogx", "rm", "swf", "vob", "wmv", "webm", "h264"],
      xml      : ["xml"],
      zip      : ["7z", "bz2", "lzma", "war", "z", "zip", "xz", "xip", "dms", "apk", "xpi", "cab"]
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
      wav  : "audio/wav",
    };

    droppy.videoTypes = {
      m4v  : "video/mp4",
      mkv  : "video/webm", // video/webm over video/x-matroska for better browser compat
      mp4  : "video/mp4", // can be audio/mp4 too
      ogv  : "video/ogg",
      ogx  : "application/ogg",
      webm : "video/webm", // can be audio/webm too
    };

    /* order is significant for mime -> ext conversion */
    droppy.imageTypes = {
      png  : "image/png",
      apng : "image/png",
      bmp  : "image/bmp",
      gif  : "image/gif",
      ico  : "image/x-icon",
      jpg  : "image/jpeg",
      jpeg : "image/jpeg",
      svg  : "image/svg+xml",
    };
  }

  function requestLink(view, location, attachement, cb) {
    view[0].sharelinkId = location;
    var found = droppy.linkCache.some(function(entry) {
      if (entry.location === location && entry.attachement === attachement) {
        if (cb) {
          cb(entry.link);
        } else {
          showLink(view, entry.link, attachement);
        }
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

  function timeDifference(prev) {
    if (typeof prev !== "number") return "unknown";
    var diff = (Date.now() - Number(prev)) / 1000;
    var future = diff < 0, value, unit;
    diff = Math.abs(diff);
    [
      [60, 1, "sec"], [3600, 60, "min"], [86400, 3600, "hour"],
      [2592000, 86400, "day"], [31536000, 2592000, "month"],
      [Infinity, 31536000, "year"]
    ].some(function(data) {
      if (diff < data[0]) {
        value = diff / data[1];
        unit = data[2];
        return true;
      }
    });
    value = Math.round(value);
    if (diff <= 20) return "just now"; // acount for 20s clock skew
    unit += (value > 1 ? "s" : "");
    return [future ? "in" : "", value, unit, !future ? "ago" : ""].join(" ").trim();
  }

  function secsToTime(secs) {
    var mins, hrs, time = "";
    secs = parseInt(secs);
    hrs = Math.floor(secs / 3600);
    mins = Math.floor((secs - (hrs * 3600)) / 60);
    secs = secs - (hrs * 3600) - (mins * 60);

    if (hrs < 10) hrs = "0" + hrs;
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
        var reltime = timeDifference(Number(timestamp));
        if (reltime) dates[i].innerHTML = reltime;
      }
    }
  }, 1000);

  function loadScript(id, url) {
    if (document.getElementById(id)) return noop;
    return ajax(url).then(function(res) {
      return res.text();
    }).then(function(text) {
      var script = document.createElement("script");
      script.setAttribute("id", id);
      script.textContent = text;
      document.querySelector("head").appendChild(script);
    });
  }

  function loadStyle(id, url) {
    if (document.getElementById(id)) return noop();
    return ajax(url).then(function(res) {
      return res.text();
    }).then(function(text) {
      var style = document.createElement("style");
      style.setAttribute("id", id);
      style.textContent = text;
      document.querySelector("head").appendChild(style);
    });
  }

  function loadTheme(theme) {
    return loadStyle("theme-" + theme.replace(/[^a-z0-9-]/gim, ""), "!/res/theme/" + theme);
  }

  function setEditorFontSize(size) {
    arr(document.styleSheets).some(function(sheet) {
      if (sheet.ownerNode.id === "css") {
        arr(sheet.cssRules).some(function(rule) {
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
    if (!view.find(".spinner").length) {
      view.find(".path").append(svg("spinner"));
    }

    view.find(".spinner")[0].setAttribute("class", "spinner in");

    // HACK: Safeguard so a view won't get stuck in loading state
    if (view[0].dataset.type === "directory") {
      if (view[0].stuckTimeout) clearTimeout(view[0].stuckTimeout);
      view[0].stuckTimeout = setTimeout(function() {
        sendMessage(view[0].vId, "REQUEST_UPDATE", getViewLocation(view));
      }, 2000);
    }
  }

  function hideSpinner(view) {
    var spinner = view.find(".spinner");
    if (spinner.length) spinner[0].setAttribute("class", "spinner");
    if (view[0].stuckTimeout) clearTimeout(view[0].stuckTimeout);
  }

  function showError(view, text) {
    if (!Object.keys(view).length) return alert(text);
    var box = view.find(".info-box");
    clearTimeout(droppy.errorTimer);
    box.find(".icon svg").replaceWith(svg("exclamation"));
    box.children("span")[0].textContent = text;
    box[0].className = "info-box error in";
    droppy.errorTimer = setTimeout(function() {
      box.removeClass("in");
    }, 5000);
  }

  function showLink(view, link, attachement) {
    toggleCatcher(true);
    clearTimeout(droppy.errorTimer);
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

    out[0].textContent = getFullLink(link);
    out.reg("copy", function() {
      setTimeout(toggleCatcher.bind(null, false), 100);
    });
    box.find(".icon svg").replaceWith(svg("link"));
    box[0].className = "info-box link in";
    box.transitionend(function() {
      select();
    });

    copy.reg("click", function() {
      var done;
      select();
      try { done = document.execCommand("copy"); } catch (err) {}
      copy[0].setAttribute("aria-label", done === true ? "Copied!" : "Copy failed");
    }).on("mouseleave", function() {
      copy[0].setAttribute("aria-label", "Copy to clipboard");
    });

    dl.reg("click", function() {
      $(this).toggleClass("checked");
      requestLink($(this).parents(".view"), view[0].sharelinkId, $(this).hasClass("checked"), function(link) {
        out[0].textContent = getFullLink(link);
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

  function throttle(func, threshold) {
    if (!threshold) threshold = 250;
    var last, deferTimer;
    return function() {
      var cur = performance.now(), args = arguments;
      if (last && cur < last + threshold) {
        clearTimeout(deferTimer);
        deferTimer = setTimeout(function() {
          last = cur;
          func.apply(this, args);
        }, threshold);
      } else {
        last = cur;
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

  function naturalSortWithNumbers(a, b) {
    function strcmp(a, b) { return a > b ? 1 : a < b ? -1 : 0; }
    if (typeof a === "number" && typeof b === "number") {
      return b - a;
    } else if (typeof a === "string" && typeof b === "string") {
      a = a.replace(/['"]/g, "_").toLowerCase();
      b = b.replace(/['"]/g, "_").toLowerCase();
      // natural sort algorithm start
      var x = [], y = [];
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
      // natural sort algorithm end
    } else return 0;
  }

  function sortArrayByProp(arr, prop) {
    return arr.sort(function(a, b) {
      var result = naturalSortWithNumbers(a[prop], b[prop]);
      if (result === 0) result = naturalSortWithNumbers(a.sortname, b.sortname);
      return result;
    });
  }

  function ajax(opts) {
    if (typeof opts === "string") opts = {url: opts};

    var headers = new Headers(opts.headers || {});
    if (opts.data) {
      headers.append("content-type", "application/json");
    }

    return fetch(getRootPath() + opts.url, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.data ? JSON.stringify(opts.data) : undefined,
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
    }).catch(function(err) { // request failed
      showError(getActiveView(), err.message);
    });
  }

  function validateFiles(files, view) {
    return files.every(function(file) {
      if (validPath(file)) {
        return true;
      } else {
        showError(view, "Invalid file path: " + file);
        return false;
      }
    });
  }

  function validPath(path) {
    return path.split("/").every(function(name) {
      if (!name) return true;
      return validFilename(name);
    });
  }

  function validFilename(name) {
    if (!name || name.length > 255) {
      return false;
    } if (/[<>:"|?*\x00-\x1F]/.test(name)) { // eslint-disable-line no-control-regex
      return false;
    } if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)) {
      return false;
    } if (/^\.\.?$/.test(name)) {
      return false;
    } else {
      return true;
    }
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
    return path.replace(/\\/g, "/").replace(/\/[^/]*$/, "") || "/";
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
      if ((i === 0 && parts[i] === "") || parts[i] !== "") {
        newParts.push(parts[i]);
      }
    }
    return newParts.join("/") || "/";
  }

  function normalize(str) {
    return String.prototype.normalize ? str.normalize() : str;
  }

  function noop() {
    return Promise.resolve();
  }

  function dateFilename() {
    var now   = new Date();
    var day   = now.getDate();
    var month = now.getMonth() + 1;
    var year  = now.getFullYear();
    var hrs   = now.getHours();
    var mins  = now.getMinutes();
    var secs  = now.getSeconds();

    if (month < 10) month = "0" + month;
    if (day < 10) day = "0" + day;
    if (hrs < 10) hrs = "0" + hrs;
    if (mins < 10) mins = "0" + mins;
    if (secs < 10) secs = "0" + secs;
    return year + "-" + month + "-" + day + " " + hrs + "." + mins + "." + secs;
  }

  function arr(arrLike) {
    if (!arrLike) return [];
    return [].slice.call(arrLike);
  }

  function urlToPngBlob(url, cb) {
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function() {
      var canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      var binary = atob(canvas.toDataURL("image/png").split(",")[1]);
      var len = binary.length;
      var bytes = new Uint8Array(len);
      for (var i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
      cb(new Blob([bytes.buffer], {type: "image/png"}));
    };
    img.src = url;
  }

  function imgExtFromMime(mime) {
    var ret;
    Object.keys(droppy.imageTypes).some(function(ext) {
      if (mime === droppy.imageTypes[ext]) {
        ret = ext;
        return true;
      }
    });
    return ret;
  }
})(jQuery);
