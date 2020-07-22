"use strict";

function promisify(fn) {
  return function() {
    return new Promise(resolve => {
      fn(result => resolve(result));
    });
  };
}

const droppy = Object.create(null);

/* {{ templates }} */

initVariables();

// ============================================================================
//  Feature Detects
// ============================================================================
droppy.detects = {
  directoryUpload: (function() {
    const el = document.createElement("input");
    return droppy.dir.some((prop) => {
      return prop in el;
    });
  })(),
  audioTypes: (function() {
    const types = {}, el = document.createElement("audio");
    Object.keys(droppy.audioTypes).forEach((type) => {
      types[droppy.audioTypes[type]] = Boolean(el.canPlayType(droppy.audioTypes[type]).replace(/no/, ""));
    });
    return types;
  })(),
  videoTypes: (function() {
    const types = {}, el = document.createElement("video");
    Object.keys(droppy.videoTypes).forEach((type) => {
      types[droppy.videoTypes[type]] = Boolean(el.canPlayType(droppy.videoTypes[type]).replace(/no/, ""));
    });
    return types;
  })(),
  webp: document.createElement("canvas").toDataURL("image/webp").indexOf("data:image/webp") === 0,
  notification: "Notification" in window,
  mobile: /Mobi/.test(navigator.userAgent),
  safari: /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent),
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
  let duration, called = false;
  const el = this[0];

  function doCallback(event) {
    if (called) return;
    called = true;
    callback.apply(el, event);
  }

  duration = getComputedStyle(el).transitionDuration;
  duration = (duration.includes("ms")) ? parseFloat(duration) : parseFloat(duration) * 1000;

  setTimeout(() => { // Call back if "transitionend" hasn't fired in duration + 30
    doCallback({target: el}); // Just mimic the event.target property on our fake event
  }, duration + 30);

  return this.one("transitionend", doCallback);
};

// Class swapping helper
$.fn.replaceClass = function(search, replacement) {
  let el, classes, matches, i = this.length, hasClass = false;
  while (--i >= 0) {
    el = this[i];
    if (el === undefined) return false;
    classes = el.className.split(" ").filter((className) => {
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
  return opts.fn(this).replace(new RegExp(` value="${sel}"`), "$& selected=");
});
Handlebars.registerHelper("is", function(a, b, opts) {
  return a === b ? opts.fn(this) : opts.inverse(this);
});

function svg(which) {
  // Manually clone instead of <use> because of a weird bug with media arrows in Firefox
  const svg = document.getElementById(`i-${which}`).cloneNode(true);
  svg.setAttribute("class", svg.id.replace("i-", ""));
  svg.removeAttribute("id");

  // Edge doesn't support outerHTML on SVG
  const html = svg.outerHTML || document.createElement("div").appendChild(svg).parentNode.innerHTML;
  return html.replace(/(?!<\/)?symbol/g, "svg");
}
Handlebars.registerHelper("svg", svg);

if (droppy.detects.mobile) {
  document.documentElement.classList.add("mobile");
}

if (droppy.detects.webp) {
  droppy.imageTypes.webp = "image/webp";
}
// ============================================================================
//  localStorage wrapper functions
// ============================================================================
let prefs, doSave;
const defaults = {
  volume: .5,
  theme: "droppy",
  editorFontSize: droppy.detects.mobile ? 12 : 16,
  indentWithTabs: false,
  indentUnit: 4,
  lineWrapping: false,
  loop: true,
  autonext: false,
  sharelinkDownload: true,
  sortings: {},
};

function savePrefs(prefs) {
  try {
    localStorage.setItem("prefs", JSON.stringify(prefs));
  } catch (err) {
    console.error(err);
  }
}
function loadPrefs() {
  let prefs;
  try {
    prefs = JSON.parse(localStorage.getItem("prefs"));
  } catch {}

  return prefs || defaults;
}

// Load prefs and set missing ones to their default
prefs = loadPrefs();
Object.keys(defaults).forEach((pref) => {
  if (prefs[pref] === undefined) {
    doSave = true;
    prefs[pref] = defaults[pref];
  }
});
if (doSave) savePrefs(prefs);

droppy.get = function(pref) {
  prefs = loadPrefs();
  return prefs[pref];
};

droppy.set = function(pref, value) {
  prefs[pref] = value;
  savePrefs(prefs);
};

droppy.del = function(pref) {
  delete prefs[pref];
  savePrefs(prefs);
};
// ============================================================================
//  Entry point
// ============================================================================
const type = document.body.dataset.type;
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
  return $(droppy.views.filter((_, i) => { return i !== id; }));
}

function getActiveView() {
  return $(droppy.views[droppy.activeView]);
}

function newView(dest, vId) {
  const view = $(Handlebars.templates.view());
  getView(vId).remove();
  droppy.views[vId] = view[0];

  if (droppy.views.length > 1) {
    droppy.views.forEach((view) => {
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

  droppy.views.forEach((view) => {
    checkPathOverflow($(view));
    if (view.ps) view.ps.updateSize(true);
  });

  return getView(vId);
}

function destroyView(vId) {
  getView(vId).remove();
  droppy.views = droppy.views.filter((_, i) => { return i !== vId; });
  droppy.views.forEach((view) => {
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
    getLocationsFromHash().forEach((string, index) => {
      const dest = join(decodeURIComponent(string));
      newView(dest, index);
    });
  }
}

function openSocket() {
  droppy.socket = new WebSocket(
    `${window.location.origin.replace(/^http/, "ws") + window.location.pathname}!/socket`
  );

  droppy.socket.addEventListener("open", (_event) => {
    if (droppy.token) {
      init();
    } else {
      ajax({url: "!/token", headers: {"x-app": "droppy"}}).then((res) => {
        return res.text();
      }).then((text) => {
        droppy.token = text;
        init();
      });
    }
  });
  // https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent#Close_codes
  droppy.socket.addEventListener("close", (event) => {
    if (event.code === 4000) return;
    if (event.code === 1011) {
      droppy.token = null;
      openSocket();
    } else if (event.code >= 1001 && event.code < 3999) {
      if (droppy.wsRetries > 0) {
        // Gracefully reconnect on abnormal closure of the socket, 1 retry every 4 seconds, 20 seconds total.
        // TODO: Indicate connection drop in the UI, especially on close code 1006
        setTimeout(() => {
          openSocket();
          droppy.wsRetries--;
        }, droppy.wsRetryTimeout);
      }
    } else if (droppy.reopen) {
      droppy.reopen = false;
      openSocket();
    }
  });
  droppy.socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    const vId = msg.vId;
    const view = getView(vId);

    droppy.socketWait = false;

    switch (msg.type) {
      case "UPDATE_DIRECTORY": {
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
          openDirectory(view, view[0].currentData);
        } else if (view[0].dataset.type === "media") {
          view[0].currentData = msg.data;
        // TODO: Update media array
        }
        break;
      }
      case "UPDATE_BE_FILE": {
        openFile(getView(vId), msg.folder, msg.file);
        break;
      }
      case "RELOAD": {
        if (msg.css) {
          $("#css").remove();
          $(`<style id='css'>${msg.css}</style>`).appendTo($("head"));
        } else window.location.reload(true);
        break;
      }
      case "SHARELINK": {
        hideSpinner(view);
        if (view.find(".info-box.link.in").length) {
          view.find(".link-out")[0].textContent = getFullLink(msg.link);
        } else {
          showLink(view, msg.link, msg.attachement);
        }
        break;
      }
      case "USER_LIST": {
        updateUsers(msg.users);
        break;
      }
      case "SAVE_STATUS": {
        hideSpinner(view);
        const file = view.find(".path li:last-child");
        file.removeClass("dirty").addClass(msg.status === 0 ? "saved" : "save-failed");
        setTimeout(() => {
          file.removeClass("saved save-failed");
        }, 3000);
        break;
      }
      case "SETTINGS": {
        Object.keys(msg.settings).forEach((setting) => {
          droppy[setting] = msg.settings[setting];
        });

        $("#about-title")[0].textContent = `droppy ${droppy.version}`;
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
        if (droppy.public) {
          document.documentElement.classList.add("public");
        }
        if (!droppy.watch) {
          document.documentElement.classList.add("nowatch");
        }
        break;
      }
      case "MEDIA_FILES": {
        loadMedia(view, msg.files);
        break;
      }
      case "SEARCH_RESULTS": {
        openDirectory(view, msg.results, true);
        break;
      }
      case "ERROR": {
        showError(view, msg.text);
        hideSpinner(view);
        break;
      }
    }
  });
}
function sendMessage(vId, type, data) {
  const sendObject = {vId, type, data, token: droppy.token};
  if (typeof sendObject.data === "string") {
    sendObject.data = normalize(sendObject.data);
  } else if (typeof sendObject.data === "object") {
    Object.keys(sendObject.data).forEach((key) => {
      if (typeof sendObject.data[key] === "string") {
        sendObject.data[key] = normalize(sendObject.data[key]);
      }
    });
  }
  const json = JSON.stringify(sendObject);

  if (droppy.socket.readyState === 1) { // open
    // Lock the UI while we wait for a socket response
    droppy.socketWait = true;
    // Unlock the UI in case we get no socket resonse after waiting for 1 second
    setTimeout(() => {
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
  $("#remember").off("click").on("click", function() {
    $(this).toggleClass("checked");
  });
  $("#form").off("submit").on("submit", (e) => {
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
    }).then((res) => {
      if (res.status === 200) {
        render("main");
        initMainPage();
      } else {
        const info = $("#login-info-box");
        info.textContent = firstrun ? "Please fill both fields." : "Wrong login!";
        if (info.hasClass("error")) {
          info.addClass("shake");
          setTimeout(() => {
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
  $(window).off("resize").on("resize", () => {
    clearTimeout(droppy.resizeTimer);
    droppy.resizeTimer = setTimeout(() => {
      $(".view").each(function() {
        checkPathOverflow($(this));
      });
    }, 25);
  });

  Mousetrap.bind("escape", () => { // escape hides modals
    toggleCatcher(false);
  }).bind("mod+s", (e) => { // stop default browser save behaviour
    e.preventDefault();
  }).bind(["space", "down", "right", "return"], () => {
    const view = getActiveView();
    if (view[0].dataset.type === "media") view[0].ps.next();
  }).bind(["shift+space", "up", "left", "backspace"], () => {
    const view = getActiveView();
    if (view[0].dataset.type === "media") view[0].ps.prev();
  }).bind(["alt+enter", "f"], () => {
    const view = getActiveView();
    if (!view || view[0].dataset.type !== "media") return;
    screenfull.toggle(view.find(".content")[0]);
  });

  // track active view
  $(window).on("click dblclick contextmenu", (e) => {
    const view = $(e.target).parents(".view");
    if (!view.length) return;
    droppy.activeView = view[0].vId;
    toggleButtons(view, view[0].dataset.type);
  });

  // handle pasting text and images in directory view
  window.addEventListener("paste", async e => {
    const view = getActiveView();
    if (view[0].dataset.type !== "directory") return;
    if (e.clipboardData && e.clipboardData.items) { // modern browsers
      const texts = [];
      const images = [];

      for (const item of e.clipboardData.items) {
        if (item.kind === "file" || item.type.includes("image")) {
          images.push(item.getAsFile());
        }
      }

      // this API is weirdly implemented in Chrome. A pasted image consists of two items,
      // if the text item is read first, the image item will not be available.
      for (const item of e.clipboardData.items) {
        if (item.kind === "string") {
          const text = await promisify(item.getAsString.bind(item))();
          texts.push(new Blob([text], {type: "text/plain"}));
        }
      }

      // if a image is found, don't upload additional text blobs
      if (images.length) {
        images.forEach(image => uploadBlob(view, image));
      } else {
        texts.forEach((text) => uploadBlob(view, text));
      }
    } else if (e.clipboardData.types) { // Safari specific
      if (e.clipboardData.types.includes("text/plain")) {
        const blob = new Blob([e.clipboardData.getData("Text")], {type: "text/plain"});
        uploadBlob(view, blob);
        $(".ce").empty();
        if (droppy.savedFocus) droppy.savedFocus.focus();
      } else {
        const start = performance.now();
        (function findImages() {
          const images = $(".ce img");
          if (!images.length && performance.now() - start < 5000) {
            return setTimeout(findImages, 25);
          }
          images.each(function() {
            urlToPngBlob(this.src, (blob) => {
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
    window.addEventListener("keydown", (e) => {
      if (e.metaKey && e.key === "v") {
        if (e.target.nodeName.toLowerCase() !== "input") {
          droppy.savedFocus = document.activeElement;
          $(".ce")[0].focus();
        }
      }
    });
  }

  screenfull.on("change", () => {
    // unfocus the fullscreen button so the space key won't un-toggle fullscreen
    document.activeElement.blur();
    $("svg.fullscreen, svg.unfullscreen").replaceWith(
      svg(screenfull.isFullscreen ? "unfullscreen" : "fullscreen")
    );
  });

  initEntryMenu();
}
// ============================================================================
//  Upload functions
// ============================================================================
function uploadBlob(view, blob) {
  const fd = new FormData();
  let name = "pasted-";
  if (blob.type.startsWith("image")) {
    name += `image-${dateFilename()}.${imgExtFromMime(blob.type)}`;
  } else {
    name += `text-${dateFilename()}.txt`;
  }
  fd.append("files[]", blob, name);
  upload(view, fd, [name]);
}

function upload(view, fd, files) {
  let rename = false;
  if (view[0].currentData && Object.keys(view[0].currentData).length) {
    let conflict = false;
    const existingFiles =  Object.keys(view[0].currentData);
    files.some((file) => {
      if (existingFiles.includes(file)) {
        conflict = true;
        return true;
      }
    });
    if (conflict) {
      rename = !window.confirm("Some of the uploaded files already exist. Overwrite them?");
    }
  }

  if (!files || !files.length) return showError(view, "Unable to upload.");
  const id = view[0].uploadId += 1;
  const xhr = new XMLHttpRequest();

  // Render upload bar
  $(Handlebars.templates["upload-info"]({
    id,
    title: files.length === 1 ? basename(files[0]) : `${files.length} files`,
  })).appendTo(view).transition("in").find(".upload-cancel").off("click").on("click", () => {
    xhr.abort();
    uploadCancel(view, id);
  });

  // Create the XHR2 and bind the progress events
  xhr.upload.addEventListener("progress", throttle(e => {
    if (e && e.lengthComputable) uploadProgress(view, id, e.loaded, e.total);
  }, 100));
  xhr.upload.addEventListener("error", () => {
    showError(view, "An error occurred during upload.");
    uploadCancel(view, id);
  });
  xhr.addEventListener("readystatechange", () => {
    if (xhr.readyState !== 4) return;
    if (xhr.status === 200) {
      uploadSuccess(id);
    } else if (xhr.status === 400) { // generic client error
      uploadCancel(view, id);
    } else {
      if (xhr.status === 0) return; // cancelled by user
      showError(view, `Server responded with HTTP ${xhr.status}`);
      uploadCancel(view, id);
    }
    uploadFinish(view, id);
  });

  view[0].isUploading = true;
  view[0].uploadStart = performance.now();

  xhr.open("POST", `${getRootPath()}!/upload?vId=${view[0].vId
  }&to=${encodeURIComponent(view[0].currentFolder)
  }&rename=${rename ? "1" : "0"}`
  );
  xhr.responseType = "text";
  xhr.send(fd);
}

function uploadSuccess(id) {
  const info = $(`.upload-info[data-id="${id}"]`);
  info.find(".upload-bar")[0].style.width = "100%";
  info.find(".upload-percentage")[0].textContent = "100%";
  info.find(".upload-title")[0].textContent = "Processing ...";
}

function uploadCancel(view, id) {
  uploadFinish(view, id, true);
}

function uploadFinish(view, id, cancelled) {
  view[0].isUploading = false;
  setTitle(basename(view[0].currentFolder));
  $(`.upload-info[data-id="${id}"]`).removeClass("in").transitionend(function() {
    $(this).remove();
  });
  if (!cancelled) {
    showNotification("Upload finished", `Upload to ${view[0].currentFolder} has finished!`);
  }
}

function uploadProgress(view, id, sent, total) {
  if (!view[0].isUploading) return;
  const info = $(`.upload-info[data-id="${id}"]`);
  const progress = `${(Math.round((sent / total) * 1000) / 10).toFixed(0)}%`;
  const now = performance.now();
  const speed = sent / ((now - view[0].uploadStart) / 1e3);
  const elapsed = now - view[0].uploadStart;
  const secs = ((total / (sent / elapsed)) - elapsed) / 1000;

  if (Number(view.find(".upload-info")[0].dataset.id) === id) setTitle(progress);
  info.find(".upload-bar")[0].style.width = progress;
  info.find(".upload-percentage")[0].textContent = progress;
  info.find(".upload-time")[0].textContent = [
    secs > 60 ? `${Math.ceil(secs / 60)} mins` : `${Math.ceil(secs)} secs`,
    `${formatBytes(Math.round(speed / 1e3) * 1e3)}/s`,
  ].join(" @ ");
}

// ============================================================================
//  General helpers
// ============================================================================
function entryRename(view, entry, wasEmpty, callback) {
  // Populate active files list
  const activeFiles = []; // TODO: Update when files change
  entry.siblings(".data-row").each(function() { // exclude existing entry for case-only rename
    $(this).removeClass("editing invalid");
    const name = droppy.caseSensitive ? this.dataset.name : this.dataset.name.toLowerCase();
    if (name) activeFiles.push(name);
  });

  // Hide menu, overlay and the original link, stop any previous edits
  toggleCatcher(false);
  const link = entry.find(".entry-link");
  const linkText = link[0].textContent;
  let canSubmit = validFilename(linkText, droppy.platform);
  entry.addClass("editing");

  // Add inline element
  const renamer = $(`<input type="text" class="inline-namer" value="${linkText
  }" placeholder="${linkText}">`).insertAfter(link);
  renamer.off("input").on("input", function() {
    const input = this.value;
    const valid = validFilename(input, droppy.platform);
    const exists = activeFiles.some((file) => {
      return file === (droppy.caseSensitive ? input : input.toLowerCase());
    });
    canSubmit = valid && !exists;
    entry[canSubmit ? "removeClass" : "addClass"]("invalid");
  }).off("blur focusout").on("blur focusout", submitEdit.bind(null, view, true, callback));

  const nameLength = linkText.lastIndexOf(".");
  renamer[0].setSelectionRange(0, nameLength > -1 ? nameLength : linkText.length);
  renamer[0].focus();

  Mousetrap(renamer[0])
    .bind("escape", stopEdit.bind(null, view, entry, wasEmpty))
    .bind("return", submitEdit.bind(null, view, false, callback));

  function submitEdit(view, skipInvalid, callback) {
    let success;
    const oldVal = renamer[0].getAttribute("placeholder");
    const newVal = renamer[0].value;
    if (canSubmit) {
      success = true;
      stopEdit(view, entry, wasEmpty);
    } else if (!skipInvalid) {
      renamer.addClass("shake");
      setTimeout(() => {
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
  const cc = $("#overlay"), modals = ["#prefs-box", "#about-box", "#entry-menu", "#drop-select", ".info-box"];

  if (show === undefined) {
    show = modals.some((selector) => { return $(selector).hasClass("in"); });
  }

  if (!show) {
    modals.forEach((selector) => { $(selector)[show ? "addClass" : "removeClass"]("in"); });
    $(".data-row.active").removeClass("active");
  }

  cc.off("click").on("click", toggleCatcher.bind(null, false));
  cc[show ? "addClass" : "removeClass"]("in");
}

// Update the page title
function setTitle(text) {
  document.title = `${text || "/"} - droppy`;
}

// Listen for popstate events, which indicate the user navigated back
$(window).off("popstate").on("popstate", () => {
  if (!droppy.socket) return;
  const locs = getLocationsFromHash();
  droppy.views.forEach((view) => {
    const dest = locs[view.vId];
    view.switchRequest = true;
    setTimeout(() => { view.switchRequest = false; }, 1000);
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
  const locations = window.location.hash.split("#");
  locations.shift();

  if (locations.length === 0) {
    locations.push("");
  }

  locations.forEach((part, i) => {
    locations[i] = part.replace(/\/*$/g, "");
    if (locations[i] === "") locations[i] = "/";
  });
  return locations;
}

function getHashPaths(modview, dest) {
  let path = window.location.pathname;
  droppy.views.forEach((view) => {
    view = $(view);
    if (modview && modview.is(view)) {
      path += `/#${dest}`;
    } else {
      path += `/#${getViewLocation(view)}`;
    }
  });
  return path.replace(/\/+/g, "/");
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
        const viewLoc = getViewLocation(view);
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
    for (let i = destination.length - 1; i >= 0; i--) {
      if (destination[i].length && getViewLocation(getView(i)) !== destination[i]) {
        sendReq(getView(i), destination[i], 0);
      }
    }
  } else if (droppy.views[view[0].vId]) sendReq(view, destination, 0);
}

// Update the path indicator
function updatePath(view) {
  let oldParts, pathStr = "";
  let i = 1; // Skip the first element as it's always the same
  const parts = join(view[0].currentFolder).split("/");

  if (parts[parts.length - 1] === "") parts.pop();
  if (view[0].currentFile !== null) parts.push(view[0].currentFile);
  parts[0] = svg("home"); // Replace empty string with our home icon
  if (view[0].savedParts) {
    oldParts = view[0].savedParts;
    while (parts[i] || oldParts[i]) {
      pathStr += `/${parts[i]}`;
      if (parts[i] !== oldParts[i]) {
        if (!parts[i] && oldParts[i] !== parts[i]) { // remove this part
          removePart(i);
        } else if (!oldParts[i] && oldParts[i] !== parts[i]) { // Add a part
          addPart(parts[i], pathStr);
        } else { // rename part
          const part = $(view.find(".path li")[i]);
          part.html(`<a>${parts[i]}</a>${svg("triangle")}`);
          part[0].dataset.destination = pathStr;
        }
      }
      i++;
    }
  } else {
    addPart(parts[0], "/");
    for (let len = parts.length; i < len; i++) {
      pathStr += `/${parts[i]}`;
      addPart(parts[i], pathStr);
    }
  }

  view.find(".path li:not(.gone)").transition("in");
  setTimeout(() => {checkPathOverflow(view); }, 400);

  view[0].savedParts = parts;

  function addPart(name, path) {
    const li = $(`<li><a>${name}</a></li>`);
    li[0].dataset.destination = path;
    li.off("click").on("click", function(event) {
      const view = $(event.target).parents(".view");
      if (droppy.socketWait) return;
      if ($(this).is(":last-child")) {
        if ($(this).parents(".view")[0].dataset.type === "directory") {
          updateLocation(view, this.dataset.destination);
        }
      } else {
        view[0].switchRequest = true; // This is set so we can switch out of a editor view
        updateLocation(view, this.dataset.destination);
      }
      setTimeout(() => {checkPathOverflow(view); }, 400);
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
  let width = 40;
  const space = view[0].clientWidth;
  view.find(".path li.in").each(function() {
    width += $(this)[0].clientWidth;
  });
  view.find(".path li").each(function() {
    this.style.left = width > space ? `${space - width}px` : 0;
  });
}

function getTemplateEntries(view, data) {
  const entries = [];
  Object.keys(data).forEach((name) => {
    const split = data[name].split("|");
    const type  = split[0];
    const mtime = Number(split[1]) * 1e3;
    const size  = Number(split[2]);
    name = normalize(name);

    const entry = {
      name,
      sortname: name.replace(/['"]/g, "_").toLowerCase(),
      type,
      mtime,
      age: timeDifference(mtime),
      size,
      psize: formatBytes(size),
      id: ((view[0].currentFolder === "/") ? "/" : `${view[0].currentFolder}/`) + name,
      sprite: getSpriteClass(fileExtension(name)),
      classes: "",
    };

    if (Object.keys(droppy.audioTypes).includes(fileExtension(name))) {
      entry.classes = "playable";
      entry.playable = true;
    } else if (Object.keys(droppy.videoTypes).includes(fileExtension(name))) {
      entry.classes = "viewable viewable-video";
      entry.viewableVideo = true;
    } else if (Object.keys(droppy.imageTypes).includes(fileExtension(name))) {
      entry.classes = "viewable viewable-image";
      entry.viewableImage = true;
    } else if (fileExtension(name) === "pdf") {
      entry.classes = "viewable viewable-pdf";
      entry.viewablePdf = true;
    }

    entries.push(entry);
  });
  return entries;
}

// Convert the received data into HTML
function openDirectory(view, data, isSearch) {
  let entries = view[0].templateEntries = getTemplateEntries(view, data || []);
  clearSearch(view);

  // sorting
  const sortings = droppy.get("sortings");
  const savedSorting = sortings[view[0].currentFolder];

  view[0].sortBy = savedSorting ? savedSorting.sortBy : "name";
  view[0].sortAsc = savedSorting ? savedSorting.sortAsc : false;

  const sortBy = view[0].sortBy === "name" ? "type" : view[0].sortBy;

  entries = sortArrayByProp(entries, sortBy);
  if (view[0].sortAsc) entries.reverse();

  const sort = {type: "", mtime: "", size: ""};
  sort[sortBy] = `active ${view[0].sortAsc ? "up" : "down"}`;

  const html = Handlebars.templates.directory({entries, sort, isSearch});
  loadContent(view, "directory", null, html).then(() => {
    // Upload button on empty page
    view.find(".empty").off("click").on("click", (e) => {
      const view = $(e.target).parents(".view");
      const inp = view.find(".file");
      if (droppy.detects.directoryUpload) {
        droppy.dir.forEach((attr) => {
          inp[0].removeAttribute(attr);
        });
      }
      inp[0].click();
    });

    // Switch into a folder
    view.find(".folder-link").off("click").on("click", function(e) {
      if (droppy.socketWait) return;
      updateLocation(view, $(this).parents(".data-row")[0].dataset.id);
      e.preventDefault();
    });

    // Click on a file link
    view.find(".file-link").off("click").on("click", function(e) {
      if (droppy.socketWait) return;
      const view = $(e.target).parents(".view");
      openFile(view, view[0].currentFolder, e.target.textContent.trim(), {ref: this});
      e.preventDefault();
    });

    view.find(".data-row").each(function(index) {
      this.setAttribute("order", index);
    });

    view.find(".data-row").off("contextmenu").on("contextmenu", (e) => {
      const target = $(e.currentTarget);
      if (target[0].dataset.type === "error") return;
      showEntryMenu(target, e.clientX, e.clientY);
      e.preventDefault();
    });

    view.find(".data-row .entry-menu").off("click").on("click", (e) => {
      showEntryMenu($(e.target).parents(".data-row"), e.clientX, e.clientY);
    });

    // Stop navigation when clicking on an <a>
    view.find(".data-row .zip, .data-row .download, .entry-link.file").off("click").on("click", (e) => {
      e.stopPropagation();
      if (droppy.socketWait) return;

      // Some browsers (like IE) think that clicking on an <a> is real navigation
      // and will close the WebSocket in turn. We'll reconnect if necessary.
      // Firefox is not affected as long as the <a> bears a `download` attribute,
      // if it's missing it will disconnect a WebSocket as long as
      // https://bugzilla.mozilla.org/show_bug.cgi?id=896666 is not fixed.
      droppy.reopen = true;
      setTimeout(() => {
        droppy.reopen = false;
      }, 2000);
    });

    view.find(".share-file").off("click").on("click", function() {
      if (droppy.socketWait) return;
      requestLink(
        $(this).parents(".view"),
        $(this).parents(".data-row")[0].dataset.id,
        droppy.get("sharelinkDownload")
      );
    });

    view.find(".delete-file").off("click").on("click", function() {
      if (droppy.socketWait) return;
      showSpinner(view);
      sendMessage(view[0].vId, "DELETE_FILE", $(this).parents(".data-row")[0].dataset.id);
    });

    view.find(".icon-play, .icon-view").off("click").on("click", function() {
      $(this).parents(".data-row").find(".file-link")[0].click();
    });

    view.find(".header-name, .header-mtime, .header-size").off("click").on("click", function() {
      sortByHeader(view, $(this));
    });

    hideSpinner(view);
  });
}

// Load new view content
function loadContent(view, type, mediaType, content) {
  return new Promise(((resolve) => {
    if (view[0].isAnimating) return; // Ignore mid-animation updates. TODO: queue and update on animation-end
    view[0].dataset.type = type;
    mediaType = mediaType ? ` type-${mediaType}` : "";
    content = `<div class="new content ${type}${mediaType} ${view[0].animDirection}">${content}</div>`;
    const navRegex = /(forward|back|center)/;
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
  }));
}

function toggleButtons(view, type) {
  view.find(".af, .ad, .cf, .cd")[type === "directory" ? "removeClass" : "addClass"]("disabled");
}

function handleDrop(view, event, src, dst, spinner) {
  const dropSelect = $("#drop-select"), dragAction = view[0].dragAction;
  droppy.dragTimer.clear();
  delete view[0].dragAction;
  $(".dropzone").removeClass("in");

  if (dragAction === "copy" || event.ctrlKey || event.metaKey || event.altKey) {
    sendDrop(view, "copy", src, dst, spinner);
  } else if (dragAction === "cut" || event.shiftKey) {
    sendDrop(view, "cut", src, dst, spinner);
  } else {
    const x = event.originalEvent.clientX, y = event.originalEvent.clientY;

    // Keep the drop-select in view
    const limit = dropSelect[0].offsetWidth / 2 - 20;
    let left;

    if (x < limit) {
      left = x + limit;
    } else if (x + limit > window.innerWidth) {
      left = x - limit;
    } else {
      left = x;
    }

    dropSelect[0].style.left = `${left}px`;
    dropSelect[0].style.top = `${event.originalEvent.clientY}px`;
    dropSelect.addClass("in");

    $(document.elementFromPoint(x, y)).addClass("active").one("mouseleave", function() {
      $(this).removeClass("active");
    });
    toggleCatcher(true);
    dropSelect.children(".movefile").off("click").one("click", () => {
      sendDrop(view, "cut", src, dst, spinner);
      toggleCatcher(false);
    });
    dropSelect.children(".copyfile").off("click").one("click", () => {
      sendDrop(view, "copy", src, dst, spinner);
      toggleCatcher(false);
    });
    dropSelect.children(".viewfile").off("click").one("click", () => {
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
      type,
      src,
      dst
    });
  }
}

// Set drag properties for internal drag sources
function bindDragEvents(view) {
  view.find(".data-row .entry-link").each(function() {
    this.setAttribute("draggable", "true");
  });
  view.off("dragstart").on("dragstart", (event) => {
    const row = $(event.target).hasClass("data-row") ? $(event.target) : $(event.target).parents(".data-row");

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
  el.off("dragover").on("dragover", (e) => {
    e.preventDefault();
    droppy.dragTimer.refresh();
  });
}

function bindHoverEvents(view) {
  const dropZone = view.find(".dropzone");
  view.off("dragenter").on("dragenter", (event) => {
    event.stopPropagation();
    droppy.activeView = view[0].vId;
    const isInternal = event.originalEvent.dataTransfer.effectAllowed === "copyMove";

    let icon;
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
  (new Uppie())(view[0], (e, fd, files) => {
    if (!files.length) return;
    if (droppy.readOnly) return showError(view, "Files are read-only.");
    e.stopPropagation();
    if (!validateFiles(files, view)) return;
    upload(view, fd, files);
  });

  // drag between views
  view.off("drop").on("drop", (e) => {
    const view = $(e.target).parents(".view");
    let dragData = e.originalEvent.dataTransfer.getData("text");
    e.preventDefault();
    $(".dropzone").removeClass("in");
    if (!dragData) return;
    e.stopPropagation();
    dragData = JSON.parse(dragData);
    if (view[0].dataset.type === "directory") { // dropping into a directory view
      handleDrop(view, e, dragData.path, join(view[0].currentFolder, basename(dragData.path)), true);
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
  // Init upload <input>
  view[0].fileInput = view.find(".file")[0];
  (new Uppie())(view[0].fileInput, (e, fd, files) => {
    const view = $(e.target).parents(".view");
    e.preventDefault();
    e.stopPropagation();
    if (!validateFiles(files, view)) return;
    upload(view, fd, files);
    view[0].fileInput.value = "";
  });

  // File upload button
  view.off("click", ".af").on("click", ".af", function(e) {
    if ($(this).hasClass("disabled")) return;
    const view = $(e.target).parents(".view");
    // Remove the directory attributes so we get a file picker dialog
    if (droppy.detects.directoryUpload) {
      droppy.dir.forEach((attr) => {
        view[0].fileInput.removeAttribute(attr);
      });
    }
    view[0].fileInput.click();
  });

  // Disable the button when no directory upload is supported
  if (droppy.detects.directoryUpload) {
    view.find(".ad").addClass("disabled");
  }

  // Directory upload button
  view.off("click", ".ad").on("click", ".ad", function(e) {
    const view = $(e.target).parents(".view");
    if ($(this).hasClass("disabled")) {
      showError(getView(0), "Your browser doesn't support directory uploading");
    } else {
      // Set the directory attribute so we get a directory picker dialog
      droppy.dir.forEach((attr) => {
        view[0].fileInput.setAttribute(attr, attr);
      });

      // Click the button to trigger a dialog
      if (view[0].fileInput.isFilesAndDirectoriesSupported) {
        view[0].fileInput.click();
      } else if (view[0].fileInput.chooseDirectory) {
        view[0].fileInput.chooseDirectory();
      } else {
        view[0].fileInput.click();
      }
    }
  });

  view.off("click", ".cf, .cd").on("click", ".cf, .cd", function(e) {
    if ($(this).hasClass("disabled")) return;
    const view = $(e.target).parents(".view");
    const content = view.find(".content");
    const isFile = this.classList.contains("cf");
    const isEmpty = Boolean(view.find(".empty").length);
    const html = Handlebars.templates[isFile ? "new-file" : "new-folder"]();

    stopEdit(view, view.find(".editing"), isEmpty);
    if (isEmpty) content.html(Handlebars.templates["file-header"]());
    content.prepend(html);
    content[0].scrollTop = 0;
    const dummy = $(`.data-row.new-${isFile ? "file" : "folder"}`);
    entryRename(view, dummy, isEmpty, (success, _oldVal, newVal) => {
      if (!success) return;
      if (view[0].dataset.type === "directory") showSpinner(view);
      sendMessage(view[0].vId, `CREATE_${isFile ? "FILE" : "FOLDER"}`, newVal);
    });
  });

  view.off("click", ".newview").on("click", ".newview", () => {
    if (droppy.views.length === 1) {
      const dest = join(view[0].currentFolder, view[0].currentFile);
      replaceHistory(newView(dest, 1), dest);
    } else {
      destroyView(view[0].vId);
      replaceHistory(view, join(view[0].currentFolder, view[0].currentFile));
    }
  });

  view.off("click", ".about").on("click", ".about", () => {
    $("#about-box").addClass("in");
    toggleCatcher();
  });

  view.off("click", ".prefs").on("click", ".prefs", () => {
    showPrefs();
    if (droppy.priv) sendMessage(null, "GET_USERS");
  });

  view.off("click", ".reload").on("click", ".reload", () => {
    if (droppy.socketWait) return;
    showSpinner(view);
    sendMessage(view[0].vId, "RELOAD_DIRECTORY", {
      dir: view[0].currentFolder
    });
  });

  view.off("click", ".logout").on("click", ".logout", () => {
    ajax({
      method: "POST",
      url: "!/logout",
      data: {
        path: getRootPath(),
      },
    }).then(() => {
      droppy.socket.close(4000);
      render("login");
      initAuthPage();
    });
  });

  // Search Box
  function doSearch(e) {
    if (e.target.value && String(e.target.value).trim()) {
      sendMessage(view[0].vId, "SEARCH", {
        query: e.target.value,
        dir: view[0].currentFolder,
      });
    } else {
      openDirectory(view, view[0].currentData);
    }
  }
  view.off("click", ".search.toggled-off").on("click", ".search.toggled-off", function() {
    const search = $(this);
    search.removeClass("toggled-off").addClass("toggled-on");
    setTimeout(() => {
      search.find("input")[0].focus();
    }, 0);
  });
  view.off("click", ".search.toggled-on svg").on("click", ".search.toggled-on svg", function() {
    const view = $(this).parents(".view");
    openDirectory(view, view[0].currentData);
  });
  view.off("keyup", ".search input").on("keyup", ".search input", function(e) {
    if (e.keyCode === 27/* escape */) {
      const view = $(this).parents(".view");
      openDirectory(view, view[0].currentData);
      this.value = "";
      $(this).parent().removeClass("toggled-on").addClass("toggled-off");
    } else if (e.keyCode === 13/* return */) {
      doSearch(e);
    }
  });
  view.off("input", ".search input").on("input", ".search input", debounce(doSearch, 1000));
  view.off("click", ".globalsearch input").on("click", ".globalsearch input", (e) => {
    e.stopPropagation();
  });
}

function initEntryMenu() {
  // Play an audio file
  $("#entry-menu .play").off("click").on("click", (event) => {
    event.stopPropagation();

    const entry = $(`.data-row[data-id="${droppy.menuTargetId}"]`);
    const view = entry.parents(".view");

    play(view, entry);
    toggleCatcher(false);
  });

  $("#entry-menu .edit").off("click").on("click", (event) => {
    event.stopPropagation();

    const entry = $(`.data-row[data-id="${droppy.menuTargetId}"]`);
    const view = entry.parents(".view");

    toggleCatcher(false);
    openFile(view, view[0].currentFolder, entry.find(".file-link")[0].textContent, {text: true});
  });

  // Click on a "open" link
  $("#entry-menu .openfile").off("click").on("click", (event) => {
    event.stopPropagation();

    const entry = $(`.data-row[data-id="${droppy.menuTargetId}"]`);
    const view = entry.parents(".view");

    toggleCatcher(false);
    if (entry[0].dataset.type === "folder") {
      updateLocation(view, entry[0].dataset.id);
    } else {
      openFile(view, view[0].currentFolder, entry.find(".file-link")[0].textContent);
    }
  });

  // Rename a file/folder
  $("#entry-menu .rename").off("click").on("click", (event) => {
    event.stopPropagation();
    if (droppy.socketWait) return;

    const entry = $(`.data-row[data-id="${droppy.menuTargetId}"]`);
    const view = entry.parents(".view");

    entryRename(view, entry, false, (success, oldVal, newVal) => {
      if (success && newVal !== oldVal) {
        showSpinner(view);
        sendMessage(view[0].vId, "RENAME", {src: oldVal, dst: newVal});
      }
    });
  });

  $("#entry-menu .share").off("click").on("click", (event) => {
    event.stopPropagation();
    if (droppy.socketWait) return;

    const entry = $(`.data-row[data-id="${droppy.menuTargetId}"]`);
    const view = entry.parents(".view");

    toggleCatcher(false);

    requestLink(
      view,
      entry[0].dataset.id,
      droppy.get("sharelinkDownload")
    );
  });

  // Copy/cut a file/folder
  $("#entry-menu .copy, #entry-menu .cut").off("click").on("click", function(event) {
    event.stopPropagation();
    toggleCatcher(false);
    droppy.clipboard = {
      type: this.className,
      src: droppy.menuTargetId
    };
    checkClipboard();
  });

  // Delete a file/folder
  $("#entry-menu .delete").off("click").on("click", (event) => {
    event.stopPropagation();
    if (droppy.socketWait) return;

    const entry = $(`.data-row[data-id="${droppy.menuTargetId}"]`);
    const view = entry.parents(".view");

    toggleCatcher(false);
    showSpinner(view);
    sendMessage(view[0].vId, "DELETE_FILE", entry[0].dataset.id);
  });
}

// Check if there's something in the clipboard
function checkClipboard() {
  if (droppy.clipboard) {
    $(".view").each(function() {
      const view = $(this), button = view.find(".paste-button");
      button.addClass("in").off("click").one("click", (event) => {
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

function saveFile(text, filename) {
  const blob = new Blob([text]);
  const a = document.createElement("a");
  a.setAttribute("href", URL.createObjectURL(blob, {type: "text/plain"}));
  a.setAttribute("download", filename);
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 0);
}

function clearSearch(view) {
  if (!view.find(".search-input").is(":focus")) {
    view.find(".search").removeClass("toggled-on").addClass("toggled-off");
    view.find(".search input")[0].value = null;
  }
}

function showEntryMenu(entry, x, y) {
  const menu = $("#entry-menu");
  const maxTop = window.innerHeight - menu[0].clientHeight - 4;
  const maxLeft = window.innerWidth - menu[0].clientWidth - 4;
  const top = entry[0].getBoundingClientRect().top + document.body.scrollTop;
  const left = x - menu[0].clientWidth / 2;
  const spriteClass = entry.find(".sprite")[0].className;

  menu[0].className = `type-${/sprite-(\w+)/.exec(spriteClass)[1]}`;
  entry.addClass("active");
  toggleCatcher(true);
  menu[0].style.left = `${left > 0 ? (left > maxLeft ? maxLeft : left) : 0}px`;
  menu[0].style.top = `${top > maxTop ? maxTop : top}px`;
  droppy.menuTargetId = entry[0].dataset.id;
  menu[0].classList.add("in");

  let target = document.elementFromPoint(x, y);
  target = target.tagName.toLowerCase() === "a" ? $(target) : $(target).parents("a");
  target.addClass("active").one("mouseleave", function() {
    $(this).removeClass("active");
  });
}

function sortByHeader(view, header) {
  view[0].sortBy = /header-(\w+)/.exec(header[0].className)[1];
  view[0].sortAsc = header.hasClass("down");
  header[0].className = `header-${view[0].sortBy} ${view[0].sortAsc ? "up" : "down"} active`;
  header.siblings().removeClass("active up down");
  let entries = sortArrayByProp(view[0].templateEntries, header[0].dataset.sort);
  if (view[0].sortAsc) entries = entries.reverse();
  entries.forEach((_, i) => {
    const entry = view.find(`[data-name="${entries[i].sortname}"]`)[0];
    entry.style.order = i;
    entry.setAttribute("order", i);
  });

  // save sorting to localStorage
  const sortings = droppy.get("sortings");
  sortings[view[0].currentFolder] = {sortBy: view[0].sortBy, sortAsc: view[0].sortAsc};
  droppy.set("sortings", sortings);
}

function closeDoc(view) {
  view[0].switchRequest = true;
  view[0].editor = null;
  updateLocation(view, view[0].currentFolder);
}

function openFile(view, newFolder, file, opts) {
  opts = opts || {};
  clearSearch(view);
  const e = fileExtension(file);

  // Fix newFolder and file variables if file includes the dir path
  if (file.includes("/")) {
    newFolder = join(view[0].currentFolder, dirname(file));
    file = basename(file);
  }

  // Early exit for open-as-text
  if (opts.text) {
    view[0].currentFile = file;
    view[0].currentFolder = newFolder;
    pushHistory(view, join(newFolder, file));
    updatePath(view);
    openDoc(view, join(newFolder, file));
    return;
  }

  // Determine filetype and how to open it
  if (Object.keys(droppy.imageTypes).includes(e)) { // Image
    view[0].currentFile = file;
    view[0].currentFolder = newFolder;
    pushHistory(view, join(view[0].currentFolder, view[0].currentFile));
    updatePath(view);
    openMedia(view);
  } else if (Object.keys(droppy.videoTypes).includes(e)) { // Video
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
  } else if (Object.keys(droppy.audioTypes).includes(e)) { // Audio
    if (opts.ref) {
      play(view, $(opts.ref).parents(".data-row"));
    }
  } else if (e === "pdf") {
    view[0].currentFile = file;
    view[0].currentFolder = newFolder;
    pushHistory(view, join(view[0].currentFolder, view[0].currentFile));
    updatePath(view);
    openMedia(view);
  } else { // Generic file, ask the server if the file has binary contents
    const filePath = join(newFolder, file);
    showSpinner(view);
    ajax({url: `!/type${filePath}`}).then((res) => {
      return res.text();
    }).then((text) => {
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
    }).catch(() => {
      showError(view, "Couldn't load the file. Maybe disable your ad-blocker?");
      hideSpinner(view);
    });
  }
}

function download(path) {
  const a = document.createElement("a");
  a.download = basename(path); // to keep websocket alive
  a.href = `!/dl${path}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function getMediaSrc(view, filename) {
  const encodedId = join(view[0].currentFolder, filename).split("/");
  let i = encodedId.length - 1;
  for (;i >= 0; i--) {
    encodedId[i] = encodeURIComponent(encodedId[i]);
  }
  return `!/file${encodedId.join("/")}`;
}

function openMedia(view) {
  sendMessage(view[0].vId, "GET_MEDIA", {
    dir: view[0].currentFolder,
    exts: {
      img: Object.keys(droppy.imageTypes),
      vid: Object.keys(droppy.videoTypes),
      pdf: ["pdf"],
    },
  });
}

function middle(ps) {
  return {x: ps.viewportSize.x / 2, y: ps.viewportSize.y / 2};
}

function loadMedia(view, files) {
  let startIndex;
  // turn filenames into URLs and obtain index of current file
  files.forEach((file, i) => {
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
    } else if (file.pdf) {
      delete file.pdf;
      file.html = Handlebars.templates.pdf({
        vid: view[0].vId,
        src: file.src,
      });
      delete file.src;
    }
  });
  Promise.all([
    loadStyle("ps-css", "!/res/lib/ps.css"),
    loadScript("ps-js", "!/res/lib/ps.js"),
  ]).then(() => {
    view[0].animDirection = "forward";
    const html = Handlebars.templates.media({
      autonext: droppy.get("autonext") ? "on " : "",
      loop: droppy.get("loop") ? "on " : "",
    });
    loadContent(view, "media", type, html).then(() => {
      const el = view.find(".pswp")[0];
      const fadeTime = droppy.detects.mobile ? 3500 : 2500;  // TODO: match to plyr
      view[0].ps = new PhotoSwipe(el, PhotoSwipeUI_Default, files, {
        arrowKeys: false,
        barsSize: {top: 0, bottom: 0},
        bgOpacity: 1,
        captionEl: false,
        clickToCloseNonZoomable: false,
        closeElClasses: [],
        closeOnScroll: false,
        closeOnVerticalDrag: false,
        escKey: false,
        getDoubleTapZoom(_, item) {
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
        timeToIdle: fadeTime,
        timeToIdleOutside: fadeTime,
      });

      const autonext = view.find(".autonext");
      const loop = view.find(".loop");
      autonext.off("click").on("click", () => {
        const on = !droppy.get("autonext");
        droppy.set("autonext", on);
        autonext[on ? "addClass" : "removeClass"]("on");
      });
      loop.off("click").on("click", () => {
        const on = !droppy.get("loop");
        droppy.set("loop", on);
        loop[on ? "addClass" : "removeClass"]("on");
      });

      // needed for plyr seeking
      view[0].ps.listen("preventDragEvent", (e, _isDown, preventObj) => {
        if (!e || !e.target) return;
        preventObj.prevent = e.target.classList.contains("pswp__img");
      });
      view[0].ps.listen("afterChange", function() {
        // clear possible focus on buttons so spacebar works as expected
        const focused = document.activeElement;
        if ($(focused).hasClass("pswp__button")) focused.blur();

        view[0].currentFile = this.currItem.filename;
        const imgButtons = view.find(".fit-h, .fit-v");
        const videoButtons = view.find(".loop, .autonext");
        const zoomButtons = view.find(".zoom-in, .zoom-out");

        let type;
        if (/\.pdf$/.test(this.currItem.filename)) {
          type = "pdf";
        } else if (this.currItem.html) {
          type = "video";
        } else {
          type = "image";
        }

        if (type === "pdf") {
          initPDF($(this.currItem.container).find(".pdf-container"));
          imgButtons.addClass("hidden");
          videoButtons.addClass("hidden");
          zoomButtons.removeClass("hidden");
          this.currItem.container.parentNode.style.overflow = "auto"; // allow pdf scrolling
          this.currItem.container.style.transformOrigin = "center top"; // center zoom out
          view.find("video").each(function() { this.pause(); });
        } else if (type === "video") {
          initVideo($(this.currItem.container).find("video")[0]);
          imgButtons.addClass("hidden");
          videoButtons.removeClass("hidden");
          zoomButtons.addClass("hidden");
        } else if (type === "image") {
          imgButtons.removeClass("hidden");
          videoButtons.addClass("hidden");
          zoomButtons.removeClass("hidden");
          view.find("video").each(function() { this.pause(); });
        }

        setTitle(this.currItem.filename.replace(/\..*/g, ""));
        replaceHistory(view, join(view[0].currentFolder, view[0].currentFile));
        updatePath(view);
      });
      view[0].ps.listen("preventDragEvent", (_, isDown) => {
        view.find(".pswp__container")[0].classList[isDown ? "add" : "remove"]("no-transition");
      });
      view[0].ps.listen("destroy", () => {
        view[0].switchRequest = true;
        view[0].ps = null;
        updateLocation(view, view[0].currentFolder);
      });

      // fit zoom buttons
      view[0].ps.zoomed = {h: false, v: false};
      function fitH() {
        const vw = view[0].ps.viewportSize.x, iw = view[0].ps.currItem.w;
        const initial = view[0].ps.currItem.initialZoomLevel;
        const level = view[0].ps.zoomed.h ? initial : vw / iw;
        view[0].ps.zoomTo(level, middle(view[0].ps), 0);
        view[0].ps.zoomed.v = false;
        view[0].ps.zoomed.h = !view[0].ps.zoomed.h;
      }
      function fitV() {
        const vh = view[0].ps.viewportSize.y, ih = view[0].ps.currItem.h;
        const initial = view[0].ps.currItem.initialZoomLevel;
        const level = view[0].ps.zoomed.v ? initial : vh / ih;
        view[0].ps.zoomTo(level, middle(view[0].ps), 0);
        view[0].ps.zoomed.h = false;
        view[0].ps.zoomed.v = !view[0].ps.zoomed.v;
      }
      view.find(".fit-h").off("click").on("click", fitH);
      view.find(".fit-v").off("click").on("click", fitV);
      view[0].ps.listen("afterChange", () => {
        if (view[0].ps.zoomed.h) {
          view[0].ps.zoomed.h = false;
          fitH(true);
        } else if (view[0].ps.zoomed.v) {
          view[0].ps.zoomed.v = false;
          fitV(true);
        }
      });
      view.find(".zoom-in").off("click").on("click", (e) => {
        const level = view[0].ps.getZoomLevel() * 1.5;
        view[0].ps.zoomTo(level, middle(view[0].ps), 250);
        $(e.target).parents(".pswp").addClass("pswp--zoomed-in");
      });
      view.find(".zoom-out").off("click").on("click", () => {
        const level = view[0].ps.getZoomLevel() / 1.5;
        view[0].ps.zoomTo(level, middle(view[0].ps), 250);
      });

      view[0].ps.init();
      hideSpinner(view);
    });
  });
}

function initPDF(container) {
  const quality = 8; // TODO: config option

  loadScript("pdf-js", "!/res/lib/pdf.js").then(() => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "!/res/lib/pdf.worker.js";
    pdfjsLib.getDocument(container.data("src")).promise.then((pdf) => {
      const availableWidth = container[0].parentNode.clientWidth;
      const availableHeight = container[0].parentNode.clientHeight;
      let maxWidth = 0;
      let maxHeight = 0;

      const promises = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        promises.push(pdf.getPage(i).then((page) => {
          const vp = page.getViewport({scale: 1});
          const ratioX = availableWidth / vp.width;
          const ratioY = availableHeight / vp.height;
          const scale = Math.min(ratioX, ratioY);
          const viewport = page.getViewport({scale: scale * quality});
          const pageWidth = viewport.width / quality;
          const pageHeight = viewport.height / quality;

          const canvas = document.createElement("canvas");
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          canvas.style.width = `${pageWidth}px`;
          canvas.style.height = `${pageHeight}px`;
          container.append(canvas);

          if (pageWidth > maxWidth) maxWidth = pageWidth;
          if (pageHeight > maxHeight) maxHeight = pageHeight;

          page.render({
            canvasContext: canvas.getContext("2d"),
            viewport
          });
        }));
      }

      Promise.all(promises).then(() => {
        container[0].style.width = `${maxWidth}px`;
        container[0].style.height = `${maxHeight}px`;
        container[0].parentNode.style.display = "flex";
        container[0].parentNode.style.justifyContent = "center";
        container[0].parentNode.style.alignItems = "center";
      });
    });
  });
}

function getCMView(cm) {
  return getView($(cm.getWrapperElement()).parents(".view")[0].vId);
}

function saveCM(cm) {
  const view = getCMView(cm);
  showSpinner(view);
  sendMessage(view[0].vId, "SAVE_FILE", {
    to: view[0].editorEntryId,
    value: cm.getValue(view[0].lineEnding)
  });
}

function openDoc(view, entryId) {
  let editor;
  showSpinner(view);
  Promise.all([
    ajax(`!/file${entryId}`),
    loadStyle("cm-css", "!/res/lib/cm.css"),
    loadScript("cm-js", "!/res/lib/cm.js"),
    loadTheme(droppy.get("theme")),
  ]).then((values) => {
    (function verify() {
      if (!("CodeMirror" in window)) return setTimeout(verify, 200);
      setTitle(basename(entryId));
      setEditorFontSize(droppy.get("editorFontSize"));
      values[0].text().then((text) => {
        configCM(text, basename(entryId));
      });
    })();
  }).catch((err) => {
    showError(view, err);
    closeDoc(view);
  });

  function configCM(text, filename) {
    const html = Handlebars.templates.document({modes: droppy.modes});
    loadContent(view, "document", null, html).then(() => {
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

      const fileMode = modeFromShebang(text);

      let mode;
      if (fileMode) {
        mode = fileMode;
      } else {
        const modeInfo = CodeMirror.findModeByFileName(filename);
        mode = (!modeInfo || !modeInfo.mode || modeInfo.mode === "null") ? "plain" : modeInfo.mode;
      }
      if (mode !== "plain") CodeMirror.autoLoadMode(editor, mode);
      editor.setOption("mode", mode);
      view.find(".mode-select")[0].value = mode;

      editor.on("change", (cm, change) => {
        const view = getCMView(cm);
        if (change.origin !== "setValue") {
          view.find(".path li:last-child").removeClass("saved save-failed").addClass("dirty");
        }
      });

      editor.setOption("extraKeys", {
        "Tab"(cm) {
          cm.replaceSelection(droppy.get("indentWithTabs") ?
            "\t" : new Array(droppy.get("indentUnit") + 1).join(" "));
        },
        "Cmd-S": saveCM,
        "Ctrl-S": saveCM
      });

      // Let Mod-T through to the browser
      CodeMirror.keyMap.sublime["Cmd-T"] = false;
      CodeMirror.keyMap.sublime["Ctrl-T"] = false;

      CodeMirror.keyMap.sublime["Cmd-A"] = "selectAll";
      CodeMirror.keyMap.sublime["Ctrl-A"] = "selectAll";
      CodeMirror.keyMap.sublime["Cmd-Space"] = "toggleCommentIndented";
      CodeMirror.keyMap.sublime["Ctrl-Space"] = "toggleCommentIndented";

      view[0].lineEnding = dominantLineEnding(text);
      editor.setValue(text);
      editor.clearHistory();

      view.find(".exit").off("click").on("click", function() {
        closeDoc($(this).parents(".view"));
        editor = null;
      });
      view.find(".save").off("click").on("click", function() {
        saveCM($(this).parents(".view")[0].editor);
      });
      view.find(".dl").off("click").on("click", () => {
        saveFile(editor.getValue(), view[0].currentFile);
      });
      view.find(".ww").off("click").on("click", () => {
        editor.setOption("lineWrapping", !editor.options.lineWrapping);
        droppy.set("lineWrapping", editor.options.lineWrapping);
      });
      view.find(".syntax").off("click").on("click", () => {
        const shown = view.find(".mode-select").toggleClass("in").hasClass("in");
        view.find(".syntax")[shown ? "addClass" : "removeClass"]("in");
        view.find(".mode-select").on("change", function() {
          view.find(".syntax").removeClass("in");
          view.find(".mode-select").removeClass("in");
          CodeMirror.autoLoadMode(editor, this.value);
          editor.setOption("mode", this.value);
        });
      });
      view.find(".find").off("click").on("click", () => {
        CodeMirror.commands.find(editor);
        const searchField = view.find(".CodeMirror-search-field");
        if (searchField && searchField[0]) searchField[0].focus();
      });
      view.find(".full").off("click").on("click", function() {
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
  const box = $("#prefs-box");
  box.find(".list-user").remove();
  box.append(Handlebars.templates["list-user"]({users: userlist}));
  box.find(".add-user").off("click").on("click", () => {
    const user = prompt("Username?");
    if (!user) return;
    const pass = prompt("Password?");
    if (!pass) return;
    const priv = window.confirm("Privileged User?");
    sendMessage(null, "UPDATE_USER", {
      name: user,
      pass,
      priv
    });
  });
  box.find(".delete-user").off("click").on("click", function(event) {
    event.stopPropagation();
    sendMessage(null, "UPDATE_USER", {
      name: $(this).parents("li").children(".username").text().trim(),
      pass: ""
    });
  });
}

function showPrefs() {
  const box = $("#prefs-box");
  box.empty().append(() => {
    const opts = [
      {name: "theme", label: "Editor theme"},
      {name: "editorFontSize", label: "Editor font size"},
      {name: "indentWithTabs", label: "Editor indent type"},
      {name: "indentUnit", label: "Editor indent width"},
      {name: "lineWrapping", label: "Editor word wrap"},
      {name: "sharelinkDownload", label: "Sharelink download"},
    ];

    let i;
    opts.forEach((_, i) => {
      opts[i].values = {};
      opts[i].selected = droppy.get(opts[i].name);
    });
    droppy.themes.forEach((t) => { opts[0].values[t] = t; });
    for (i = 10; i <= 30; i += 2) opts[1].values[String(i)] = String(i);
    opts[2].values = {"Tabs": true, "Spaces": false};
    for (i = 1; i <= 8; i *= 2) opts[3].values[String(i)] = String(i);
    opts[4].values = {"Wrap": true, "No Wrap": false};
    opts[5].values = {"Default On": true, "Default Off": false};
    return Handlebars.templates.options({opts});
  });

  $("select.theme").off("change").on("change", function() {
    const theme = this.value;
    loadTheme(theme, () => {
      droppy.set("theme", theme);
      $(".view").each(function() {
        if (this.editor) this.editor.setOption("theme", theme);
      });
    });
  });

  $("select.editorFontSize").off("change").on("change", function() {
    setEditorFontSize(this.value);
  });

  setTimeout(() => {
    box.addClass("in").transitionend(function() {
      this.removeAttribute("style");
    });
    toggleCatcher(true);
    $("#overlay").one("click", () => {
      box.find("select").each(function() {
        const option = this.className;
        let value  = this.value;

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
  const player = view.find(".audio-player")[0];

  let row;
  if (typeof index === "number") {
    row = view.find(`.data-row[data-playindex="${index}"]`);
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

  const source = `!/file${row[0].dataset.id}`;
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
    const content = row.parents(".content-container");
    if (row[0].offsetTop < content[0].scrollTop ||
        row[0].offsetTop > content[0].scrollTop + content[0].clientHeight) {
      row[0].scrollIntoView();
    }

    let i = 0;
    row.parent().children(".playable").each(function() {
      this.dataset.playindex = i++;
    });
    view[0].playlistLength = i;
  }
  view[0].playlistIndex = typeof index === "number" ? index : Number(row[0].dataset.playindex);
}

function onNewAudio(view) {
  const player = view[0].querySelector(".audio-player");
  const title  = decodeURIComponent(removeExt(basename(player.src).replace(/_/g, " ").replace(/\s+/, " ")));

  view.find(".audio-bar").addClass("in");
  view.find(".audio-title")[0].textContent = title;
  setTitle(title);

  (function updateBuffer() {
    let progress;
    if (player.buffered.length) {
      progress = (player.buffered.end(0) / player.duration) * 100;
    }
    view[0].querySelector(".seekbar-loaded").style.width = `${progress || 0}%`;
    if (!progress || progress < 100) setTimeout(updateBuffer, 100);
  })();

  $(player).off("timeupdate").on("timeupdate", () => {
    const cur = player.currentTime, max = player.duration;
    if (!cur || !max) return;
    view[0].querySelector(".seekbar-played").style.width = `${(cur / max) * 100}%`;
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

function playRandom(view) {
  let nextIndex;
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

function initAudio(view) {
  let heldVolume = false;
  const bar = view.find(".audio-bar");
  const slider = view.find(".volume-slider");
  const volumeIcon = view.find(".audio-bar .volume");
  const player = view.find(".audio-player")[0];

  setVolume(droppy.get("volume"));

  player.addEventListener("ended", (e) => {
    playNext($(e.target).parents(".view"));
  });
  player.addEventListener("error", (e) => {
    playNext($(e.target).parents(".view"));
  });
  player.addEventListener("playing", (e) => {
    onNewAudio($(e.target).parents(".view"));
  });
  const updateVolume = throttle(event => {
    const slider = $(event.target).parents(".view").find(".volume-slider")[0];
    const left = slider.getBoundingClientRect().left;
    const right = slider.getBoundingClientRect().right;
    setVolume((event.pageX - left) / (right - left));
  }, 1000 / 60);
  slider.off("mousedown").on("mousedown", (event) => {
    heldVolume = true;
    updateVolume(event);
    event.stopPropagation();
  });
  bar.off("mousemove").on("mousemove", (event) => {
    if (heldVolume) updateVolume(event);
  });
  bar.off("mouseup").on("mouseup", () => {
    heldVolume = false;
  });
  slider.off("click").on("click", (event) => {
    updateVolume(event);
    event.stopPropagation();
  });
  bar.off("click").on("click", function(event) {
    const time = player.duration *
      ((event.pageX - bar[0].getBoundingClientRect().left) / bar[0].clientWidth);
    if (!Number.isNaN(parseFloat(time)) && Number.isFinite(time)) {
      player.currentTime = time;
    } else {
      endAudio($(this).parents(".view"));
    }
  });
  bar.find(".previous").off("click").on("click", (event) => {
    playPrev($(event.target).parents(".view"));
    event.stopPropagation();
  });
  bar.find(".next").off("click").on("click", (event) => {
    playNext($(event.target).parents(".view"));
    event.stopPropagation();
  });
  bar.find(".pause-play").off("click").on("click", function(event) {
    const icon   = $(this).children("svg");
    const player = $(this).parents(".audio-bar").find(".audio-player")[0];
    if (icon[0].getAttribute("class") === "play") {
      icon.replaceWith($(svg("pause")));
      player.play();
    } else {
      icon.replaceWith($(svg("play")));
      player.pause();
    }
    event.stopPropagation();
  });

  bar.find(".stop").off("click").on("click", function(event) {
    endAudio($(this).parents(".view"));
    event.stopPropagation();
  });
  bar.find(".shuffle").off("click").on("click", function(event) {
    $(this).toggleClass("active");
    $(this).parents(".view")[0].shuffle = $(this).hasClass("active");
    event.stopPropagation();
  });

  function setVolume(view, volume) {
    if (volume > 1) volume = 1;
    if (volume < 0) volume = 0;
    player.volume = volume;
    droppy.set("volume", volume);
    if (player.volume === 0) volumeIcon.html(svg("volume-mute"));
    else if (player.volume <= 0.33) volumeIcon.html(svg("volume-low"));
    else if (player.volume <= 0.67) volumeIcon.html(svg("volume-medium"));
    else volumeIcon.html(svg("volume-high"));
    view.find(".volume-slider-inner")[0].style.width = `${volume * 100}%`;
  }

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
  volumeIcon.off("click").on("click", (event) => {
    slider.toggleClass("in");
    volumeIcon.toggleClass("active");
    event.stopPropagation();
  });
}

function splitCallback(cont, n) {
  let countDown = n;
  return function() { if (--countDown === 0) cont(); };
}

// CodeMirror dynamic mode loading
// based on https://github.com/codemirror/CodeMirror/blob/master/addon/mode/loadmode.js
function initModeLoad() {
  const loading = {};
  function ensureDeps(mode, cont) {
    const deps = CodeMirror.modes[mode].dependencies;
    if (!deps) return cont();
    const missings = [];
    for (const dep of deps) {
      if (!(dep in CodeMirror.modes)) {
        missings.push(dep);
      }
    }
    if (!missings.length) return cont();
    const split = splitCallback(cont, missings.length);
    for (const missing of missings) {
      CodeMirror.requireMode(missing, split);
    }
  }

  CodeMirror.requireMode = function(mode, cont) {
    if (typeof mode !== "string") mode = mode.name;
    if (mode in CodeMirror.modes) return ensureDeps(mode, cont);
    if (mode in loading) return loading[mode].push(cont);

    const script = document.createElement("script");
    script.src = `!/res/mode/${mode}`;
    const others = document.getElementsByTagName("script")[0];
    others.parentNode.insertBefore(script, others);
    const list = loading[mode] = [cont];
    let count = 0;
    const poll = setInterval(() => {
      if (++count > 100) return clearInterval(poll);
      if (mode in CodeMirror.modes) {
        clearInterval(poll);
        loading[mode] = null;
        ensureDeps(mode, () => {
          for (let i = 0; i < list.length; ++i) list[i]();
        });
      }
    }, 200);
  };

  CodeMirror.autoLoadMode = function(instance, mode) {
    if (!(mode in CodeMirror.modes)) {
      CodeMirror.requireMode(mode, () => {
        instance.setOption("mode", instance.getOption("mode"));
      });
    }
  };
}

function modeFromShebang(text) {
  // extract first line, trim and remove flags
  text = (text || "").split(/\n/)[0].trim().split(" ").filter((e) => {
    return !/^-+/.test(e);
  }).join(" ");

  // shell scripts
  if (/^#!.*\b(ba|c|da|k|fi|tc|z)?sh$/.test(text)) return "shell";

  // map binary name to CodeMirror mode
  let mode;
  const exes = {
    dart: "dart", lua: "lua", node: "javascript", perl: "perl", php: "php",
    python: "python", ruby: "ruby", swift: "swift", tclsh: "tcl"
  };
  Object.keys(exes).some((exe) => {
    if (new RegExp(`^#!.*\\b${exe}$`).test(text)) return (mode = exes[exe]);
  });
  return mode;
}

// video.js
function initVideo(el) {
  const view = $(el).parents(".view");
  Promise.all([
    loadStyle("plyr-css", "!/res/lib/plyr.css"),
    loadScript("plyr-js", "!/res/lib/plyr.js"),
  ]).then(() => {
    (function verify() {
      if (!("Plyr" in window)) {
        return setTimeout(verify, 200);
      }

      // pause other loaded videos in this view
      view.find("video").each(function() {
        if (this !== el) this.pause();
      });

      const player = new Plyr(el, {
        controls: ["play", "volume", "progress", "current-time", "mute", "captions"],
        iconUrl: "!/res/lib/plyr.svg",
        blankUrl: "!/res/lib/blank.mp4",
        autoplay: !droppy.detects.mobile,
        volume: droppy.get("volume"),
        muted: droppy.get("volume") === 0,
        keyboardShortcuts: {focused: true, global: true},
        tooltips: {controls: false, seek: true},
        disableContextMenu: false,
        storage: {enabled: false},
        fullscreen: {enable: false},
        hideControls: true,
      });

      player.on("ready", () => {
        // stop drags from propagating outside the control bar
        $(view).find(".plyr__controls").on("mousemove", (e) => {
          if (e.originalEvent && e.originalEvent.buttons !== 0) {
            e.stopPropagation();
          }
        });
      });

      player.on("ended", () => {
        if (droppy.get("loop")) {
          player.play();
        } else if (droppy.get("autonext")) {
          view[0].ps.next();
        }
      });

      player.on("error", (err) => {
        console.error(err);
        showError(view, "Your browser can't play this file");
      });

      player.on("volumechange", () => {
        droppy.set("volume", player.muted ? 0 : player.volume);
      });
    })();
  });
}

function initVariables() {
  droppy.activeView = 0;
  droppy.initialized = null;
  droppy.menuTargetId = null;
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
    archive: ["bz2", "tgz"],
    audio: ["aac", "aif", "aiff", "f4a", "flac", "m4a", "m4b", "m4p", "m4p", "m4r", "mka", "mid", "mp1", "mp2", "mp3", "mpa", "mpeg", "ra", "ogg", "oga", "opus", "wav", "wma"],
    authors: ["authors"],
    bin: ["class", "o", "so", "pyc", "node"],
    bmp: ["bmp", "xbm"],
    c: ["c"],
    calc: ["ods", "ots", "xlr", "xls", "xlsx", "csv", "tsv"],
    cd: ["cue", "iso"],
    copying: ["copying", "license"],
    cpp: ["cpp", "cc", "cxx"],
    css: ["css", "less", "scss", "sass"],
    deb: ["deb"],
    diff: ["diff", "patch"],
    doc: ["doc", "docx", "odm", "odt", "ott"],
    draw: ["drw"],
    eps: ["eps", "ai"],
    exe: ["bat", "cmd", "exe", "com"],
    gif: ["gif", "gifv"],
    gzip: ["gz", "gzip"],
    h: ["h", "hh", "hxx"],
    hpp: ["hpp"],
    html: ["htm", "html", "shtml", "phtml", "hbs", "handlebars"],
    ico: ["ico"],
    image: ["svg", "xpm", "webp", "tga", "mng"],
    install: ["install", "msi", "apk", "dmg"],
    java: ["java", "jar", "scala", "sc"],
    jpg: ["jpg", "jpeg", "jp2", "jpx"],
    js: ["js", "jsx", "es", "es6", "dart", "ls", "ts", "tsx"],
    json: ["json", "gyp", "bson"],
    log: ["log", "changelog"],
    makefile: ["makefile", "pom", "reg", "am", "BSDmakefile"],
    markdown: ["markdown", "md", "mdown", "mkd"],
    pdf: ["pdf"],
    php: ["php", "php3", "php4", "php5", "php7"],
    playlist: ["m3u", "m3u8", "pls"],
    png: ["png", "apng"],
    pres: ["odp", "otp", "pps", "ppt", "pptx"],
    ps: ["ps", "ttf", "otf", "eot", "woff", "woff2"],
    psd: ["psd"],
    py: ["py"],
    rar: ["rar"],
    rb: ["rb"],
    readme: ["readme"],
    rpm: ["rpm", "cpio"],
    rss: ["rss"],
    rtf: ["rtf"],
    script: ["sh", "csh", "ksh", "bash", "zsh", "fish", "shar", "configure"],
    source: ["ini", "properties", "conf", "cfg", "config", "lisp", "ovpn", "lua", "yaml", "yml", "toml", "pl", "tcl", "r"],
    sql: ["sql", "dump"],
    tar: ["tar"],
    tex: ["tex"],
    text: ["text", "txt"],
    tiff: ["tiff", "tif"],
    vcal: ["vcal"],
    video: ["avi", "flv", "mkv", "mov", "mp4", "mpg", "3g2", "3gp", "f4v", "flv", "m4v", "m4v", "mk3d", "ogv", "ogx", "rm", "swf", "vob", "wmv", "webm", "h264"],
    xml: ["xml", "wsdl"],
    zip: ["7z", "bz2", "lzma", "war", "z", "zip", "xz", "xip", "dms", "apk", "xpi", "cab"]
  };

  droppy.audioTypes = {
    aac: "audio/aac",
    aif: "audio/x-aiff",
    aifc: "audio/x-aiff",
    aiff: "audio/x-aiff",
    f4a: "video/mp4",
    flac: "audio/flac",
    m4a: "audio/mp4",
    m4b: "audio/mpeg",
    m4p: "application/mp4",
    m4r: "audio/mpeg",
    mka: "audio/x-matroska",
    mp1: "audio/mpeg",
    mp2: "audio/mpeg",
    mp3: "audio/mpeg",
    mpa: "audio/mpeg",
    mpeg: "audio/mpeg",
    mpg: "audio/mpeg",
    oga: "audio/ogg",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    wav: "audio/wav",
    wma: "audio/mpeg",
  };

  droppy.videoTypes = {
    "3g2": "video/mp4",
    "3gp": "video/mp4",
    f4v: "video/mp4",
    flv: "video/mp4",
    m4v: "video/mp4",
    mk3d: "video/webm", // video/webm over video/x-matroska for better browser compat
    mkv: "video/webm", // video/webm over video/x-matroska for better browser compat
    mov: "video/mp4",
    mp4: "video/mp4", // can be audio/mp4 too
    ogv: "video/ogg",
    ogx: "application/ogg",
    webm: "video/webm", // can be audio/webm too
  };

  /* order is significant for mime -> ext conversion */
  droppy.imageTypes = {
    png: "image/png",
    apng: "image/png",
    bmp: "image/bmp",
    gif: "image/gif",
    ico: "image/x-icon",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    svg: "image/svg+xml",
  };
}

function requestLink(view, location, attachement) {
  view[0].sharelinkId = location;
  showSpinner(view);
  sendMessage(view[0].vId, "REQUEST_SHARELINK", {
    location,
    attachement
  });
}

function timeDifference(prev) {
  if (typeof prev !== "number") return "unknown";
  let diff = (Date.now() - Number(prev)) / 1000;
  const future = diff < 0;
  let value, unit;
  diff = Math.abs(diff);
  [
    [60, 1, "sec"], [3600, 60, "min"], [86400, 3600, "hour"],
    [2592000, 86400, "day"], [31536000, 2592000, "month"],
    [Infinity, 31536000, "year"]
  ].some((data) => {
    if (diff < data[0]) {
      value = diff / data[1];
      unit = data[2];
      return true;
    }
  });
  value = Math.round(value);
  if (diff <= 3) return "just now"; // acount for 3s clock skew
  unit += (value > 1 ? "s" : "");
  return [future ? "in" : "", value, unit, !future ? "ago" : ""].join(" ").trim();
}

function secsToTime(secs) {
  let mins, hrs, time = "";
  secs = parseInt(secs);
  hrs = Math.floor(secs / 3600);
  mins = Math.floor((secs - (hrs * 3600)) / 60);
  secs = secs - (hrs * 3600) - (mins * 60);

  if (hrs < 10) hrs = `0${hrs}`;
  if (mins < 10) mins = `0${mins}`;
  if (secs < 10) secs = `0${secs}`;

  if (hrs !== "00") time = (`${hrs}:`);
  return `${time + mins}:${secs}`;
}

setInterval(() => {
  const dates = document.getElementsByClassName("mtime");
  if (!dates) return;
  for (const date of dates) {
    const timestamp = date.getAttribute("data-timestamp");
    if (timestamp) {
      const reltime = timeDifference(Number(timestamp));
      if (reltime) date.innerHTML = reltime;
    }
  }
}, 1000);

function loadScript(id, url) {
  if (document.getElementById(id)) return Promise.resolve();
  return ajax(url).then((res) => {
    return res.text();
  }).then((text) => {
    const script = document.createElement("script");
    script.setAttribute("id", id);
    script.textContent = text;
    document.querySelector("head").appendChild(script);
  });
}

function loadStyle(id, url) {
  if (document.getElementById(id)) return Promise.resolve();
  return ajax(url).then((res) => {
    return res.text();
  }).then((text) => {
    const style = document.createElement("style");
    style.setAttribute("id", id);
    style.textContent = text;
    document.querySelector("head").appendChild(style);
  });
}

function loadTheme(theme) {
  return loadStyle(`theme-${theme.replace(/[^a-z0-9-]/gim, "")}`, `!/res/theme/${theme}`);
}

function setEditorFontSize(size) {
  arr(document.styleSheets).some((sheet) => {
    if (sheet.ownerNode.id === "css") {
      arr(sheet.cssRules).some((rule) => {
        if (rule.selectorText === ".content div.CodeMirror") {
          rule.style.fontSize = `${size}px`;
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
    view[0].stuckTimeout = setTimeout(() => {
      sendMessage(view[0].vId, "REQUEST_UPDATE", getViewLocation(view));
    }, 2000);
  }
}

function hideSpinner(view) {
  const spinner = view.find(".spinner");
  if (spinner.length) spinner[0].setAttribute("class", "spinner");
  if (view[0].stuckTimeout) clearTimeout(view[0].stuckTimeout);
}

function showError(view, text) {
  if (!Object.keys(view).length) return alert(text);
  const box = view.find(".info-box");
  clearTimeout(droppy.errorTimer);
  box.find(".icon svg").replaceWith(svg("exclamation"));
  box.children("span")[0].textContent = text;
  box[0].className = "info-box error in";
  droppy.errorTimer = setTimeout(() => {
    box.removeClass("in");
  }, 5000);
}

function showLink(view, link, attachement) {
  toggleCatcher(true);
  clearTimeout(droppy.errorTimer);
  const box  = view.find(".info-box");
  const out  = box.find(".link-out");
  const copy = box.find(".copy-link");
  const dl   = box.find(".dl-link");
  dl[attachement ? "addClass" : "removeClass"]("checked");

  const select = function() {
    const range = document.createRange(), selection = getSelection();
    range.selectNodeContents(out[0]);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  out[0].textContent = getFullLink(link);
  out.off("copy").on("copy", () => {
    setTimeout(toggleCatcher.bind(null, false), 100);
  });
  box.find(".icon svg").replaceWith(svg("link"));
  box[0].className = "info-box link in";
  box.transitionend(() => {
    select();
  });

  copy.off("click").on("click", () => {
    let done;
    select();
    try { done = document.execCommand("copy"); } catch {}
    copy[0].setAttribute("aria-label", done === true ? "Copied!" : "Copy failed");
  }).on("mouseleave", () => {
    copy[0].setAttribute("aria-label", "Copy to clipboard");
  });

  dl.off("click").on("click", function() {
    $(this).toggleClass("checked");
    requestLink($(this).parents(".view"), view[0].sharelinkId, $(this).hasClass("checked"));
  });
}

function showNotification(msg, body) {
  if (droppy.detects.notification && document.hidden) {
    const show = function(msg, body) {
      const opts = {icon: "!/res/logo192.png"};
      if (body) opts.body = body;
      const n = new Notification(msg, opts);
      n.addEventListener("show", function() { // Compat: Chrome
        const self = this;
        setTimeout(() => { self.close(); }, 4000);
      });
    };
    if (Notification.permission === "granted") {
      show(msg, body);
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission((permission) => {
        if (!("permission" in Notification)) Notification.permission = permission;
        if (permission === "granted") show(msg, body);
      });
    }
  }
}

function debounce(func, wait, immediate) {
  let timeout;
  return function(...args) {
    const later = () => {
      timeout = null;
      if (!immediate) func(...args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func(...args);
  };
}

function throttle(func, threshold) {
  if (!threshold) threshold = 250;
  let last, deferTimer;
  return function(...args) {
    const cur = performance.now();
    if (last && cur < last + threshold) {
      clearTimeout(deferTimer);
      deferTimer = setTimeout(() => {
        last = cur;
        func(...args);
      }, threshold);
    } else {
      last = cur;
      func(...args);
    }
  };
}

function getFullLink(hash) {
  return `${window.location.origin}${window.location.pathname}$/${hash}`;
}

function getSpriteClass(ext) {
  let type = "bin";
  Object.keys(droppy.iconMap).forEach(fileType => {
    if (droppy.iconMap[fileType].includes(ext.toLowerCase())) {
      type = fileType;
    }
  });
  return type;
}

function formatBytes(num) {
  if (num < 1000) return `${num} B`;
  const units = ["B", "kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const exp = Math.min(Math.floor(Math.log10(num) / 3), units.length - 1);
  return `${String((Number((num / (1000 ** exp)).toPrecision(3))))} ${units[exp]}`;
}

function strcmp(a, b) {
  return a > b ? 1 : a < b ? -1 : 0;
}

function naturalSortWithNumbers(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    return b - a;
  } else if (typeof a === "string" && typeof b === "string") {
    a = a.replace(/['"]/g, "_").toLowerCase();
    b = b.replace(/['"]/g, "_").toLowerCase();
    // natural sort algorithm start
    const x = [], y = [];
    a.replace(/(\d+)|(\D+)/g, (_, a, b) => { x.push([a || 0, b]); });
    b.replace(/(\d+)|(\D+)/g, (_, a, b) => { y.push([a || 0, b]); });
    while (x.length && y.length) {
      const xx = x.shift();
      const yy = y.shift();
      const nn = (xx[0] - yy[0]) || strcmp(xx[1], yy[1]);
      if (nn) return nn;
    }
    if (x.length) return -1;
    if (y.length) return 1;
    return 0;
    // natural sort algorithm end
  } else return 0;
}

function sortArrayByProp(arr, prop) {
  return arr.sort((a, b) => {
    let result = naturalSortWithNumbers(a[prop], b[prop]);
    if (result === 0) result = naturalSortWithNumbers(a.sortname, b.sortname);
    return result;
  });
}

function ajax(opts) {
  if (typeof opts === "string") opts = {url: opts};

  const headers = new Headers(opts.headers || {});
  if (opts.data) {
    headers.append("content-type", "application/json");
  }

  return fetch(getRootPath() + opts.url, {
    method: opts.method || "GET",
    headers,
    body: opts.data ? JSON.stringify(opts.data) : undefined,
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
  }).catch((err) => { // request failed
    showError(getActiveView(), err.message);
  });
}

function validateFiles(files, view) {
  return files.every((file) => {
    if (validPath(file)) {
      return true;
    } else {
      showError(view, `Invalid file path: ${file}`);
      return false;
    }
  });
}

function validPath(path) {
  return path.split("/").every((name) => {
    if (!name) return true;
    return validFilename(name);
  });
}

function validFilename(name) {
  if (!name || name.length > 255) return false;
  if (/[<>:"|?*\x00-\x1F]/.test(name)) return false;
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)) return false;
  if (/^\.\.?$/.test(name)) return false;
  return true;
}

function removeExt(filename) {
  return filename.substring(0, filename.lastIndexOf("."));
}

// Get the path to droppy's root, ensuring a trailing slash
function getRootPath() {
  const p = window.location.pathname;
  return p[p.length - 1] === "/" ? p : `${p}/`;
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
  const numCRLF = (str.match(/\r\n/gm) || []).length;
  // emulating negative lookbehind by reversing the string
  const numLF = (str.split("").reverse().join("").match(/\n(?!(\r))/gm) || []).length;
  return (numCRLF > numLF) ? "\r\n" : "\n";
}

// Join and clean up paths (can also take a single argument to just clean it up)
function join(...args) {
  let i, l, parts = [];
  const newParts = [];
  for (i = 0, l = args.length; i < l; i++) {
    if (typeof args[i] === "string") {
      parts = parts.concat(args[i].split("/"));
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

function pad(num) {
  return num < 10 ? `0${num}` : `${num}`;
}

function dateFilename() {
  const now = new Date();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const hrs = now.getHours();
  const mins = now.getMinutes();
  const secs = now.getSeconds();

  return `${year}-${pad(month)}-${pad(day)}-${pad(hrs)}-${pad(mins)}-${pad(secs)}`;
}

function arr(arrLike) {
  if (!arrLike) return [];
  return [].slice.call(arrLike);
}

function urlToPngBlob(url, cb) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.addEventListener("load", () => {
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const binary = atob(canvas.toDataURL("image/png").split(",")[1]);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    cb(new Blob([bytes.buffer], {type: "image/png"}));
  });
  img.src = url;
}

function imgExtFromMime(mime) {
  let ret;
  Object.keys(droppy.imageTypes).some((ext) => {
    if (mime === droppy.imageTypes[ext]) {
      ret = ext;
      return true;
    }
  });
  return ret;
}
