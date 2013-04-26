/* global $, Dropzone */
(function() {
"use strict";

var folderList = [], isUploading = false, currentFolder = "/";
var bar, info, nameinput, percent, progress, start, socket;

/* ============================================================================
 *  Page loading functions
 * ============================================================================
 */
function getPage() {
    $.getJSON('/content', function(response) {
        animatedLoad("page", "body", response.data);
        // Load the appropriate Javascript for that page
        switch(response.type) {
            case "main":
                $(initMainPage);
                break;
            case "auth":
                $(initAuth);
                break;
        }
    });
}

// Switch an element's content with an animation
function animatedLoad(oldElement, container, data) {
    $(container).css("overflow","hidden");
    $(container).append('<div id="new">' + data + '</div>');
    var newElement = $("#new");
    newElement.css("margin-left", "100%");
    newElement.css("opacity", 0);
    newElement.animate({
        "margin-left" : 0,
        "opacity" : 1
    },{
        duration: 500,
        queue: false,
    complete: function() {
        $(container).css("overflow","visible");
        $("#" + oldElement).remove();
        newElement.attr("id", oldElement);
    }});
    $("#" + oldElement).animate({
       "margin-left" : "-100%",
       "opacity" : 0
    },{
        duration: 500,
        queue: false
    });
}

$(getPage);
/* ============================================================================
 *  WebSocket functions
 * ============================================================================
 */
function openSocket() {
    if (document.location.protocol === "https:")
        socket = new WebSocket('wss://' + document.location.host);
    else
        socket = new WebSocket('ws://' + document.location.host);

    socket.onopen = function() {
        // Request initial update
        sendMessage("REQUEST_UPDATE", currentFolder);
    };

    socket.onmessage = function (event) {
        var msg = JSON.parse(event.data);
        if (msg.type === "UPDATE_FILES") {
            if (isUploading) return;
            if (msg.folder === currentFolder.replace(/&amp;/,"&")) {
                $("#content").html(buildHTML(msg.data, msg.folder));
            }
        }
    };
    socket.onclose = function() {
        // Restart a closed socket. Firefox closes it on every download..
        // https://bugzilla.mozilla.org/show_bug.cgi?id=858538
        setTimeout(openSocket,300);
    };
}

function sendMessage(msgType, msgData) {
    socket.send(JSON.stringify({
        type: msgType,
        data: msgData
    }));
}
/* ============================================================================
 *  Authentication page JS
 * ============================================================================
 */
function initAuth() {
    var user   = $("#user"),
        pass   = $("#pass"),
        form   = $("form"),
        submit = $("#submit");

    user.focus();

    pass.keyup(function(e){
        if(e.keyCode === 13) {
            submitForm(form, submit);
        }
    });

    submit.click(function() {
        submitForm(form, submit);
    });

    user.focus(function() {
        resetError(submit);
    });

    pass.focus(function() {
        resetError(submit);
    });

    function submitForm(form, errForm) {
        $.ajax({
            type: "POST",
            url: "/login",
            data: form.serialize(),
            statusCode: {
                200: function() {
                    getPage();
                },
                401: function() {
                    showError(errForm);
                }
            }
        });
    }

    function showError(element) {
        element.attr("class","invalid");
        element.val("Wrong username/password!");
    }

    function resetError(element) {
        element.attr("class","valid");
        element.val("Sign in");
    }
}
/* ============================================================================
 *  Main page JS
 * ============================================================================
 */

function initMainPage() {
    // Opening the socket on onpageshow has the benefit that it works after
    // a user returns to the page through the back button.
    $("body").attr("onpageshow", function() {
        openSocket();
    });

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
    $("body").on("click", ".folderlink", function(e) {
        e.preventDefault();

        var destination = $(this).html();
        if (currentFolder !== "/" ) destination = "/" + destination;
        currentFolder += destination;
        sendMessage("SWITCH_FOLDER", currentFolder);
    });

    // Go back up
    $("body").on("click", ".backlink", function(e) {
        e.preventDefault();

        var match = currentFolder.match(/.*(\/)/)[0];
        match = match.substring(0,match.length - 1);
        if (!match.match(/\//)) match = "/";
        currentFolder = match;
        sendMessage("SWITCH_FOLDER", currentFolder);
    });

    // Delete a folder
    $("body").on("click", ".delete", function(e) {
        e.preventDefault();
        sendMessage("DELETE_FILE", $(this).parent().parent().data("id"));
    });

    // Automatically submit a form once it's data changed
    $("form").change(function() {
        $("form").submit();
        $("#file").val(""); // Reset file form
    });

    // Show popup for folder creation
    $("#add-folder").click(function (){
        $("#overlay").fadeToggle(350);
        nameinput.val("");
        nameinput.focus();
        nameinput.attr("class","valid");
    });

    // Handler for the input of the folder name
    nameinput.keyup(function(e){
        if (e.keyCode === 27) // Escape Key
            $("#overlay").toggle();

        var input = nameinput.val();
        var valid = !input.match(/[\\*{}\/<>?|]/) && !input.match(/\.\./);
        var folderExists = folderList[input.toLowerCase()] === true;
        if (input === "" ) {
            nameinput.attr("class","valid");
            info.html("&nbsp;");
            return;
        }

        if (!valid){
            nameinput.attr("class","invalid");
            info.html("Invalid character(s) in filename!");
            return;
        }

        if (folderExists) {
            nameinput.attr("class","invalid");
            info.html("File/Directory already exists!");
            return;
        }

        nameinput.attr("class","valid");
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
    function attachDropzone(){
        var dropZone = new Dropzone(document.body, {clickable: false, url: "/upload"});
        dropZone.on("sending", function() {
            uploadInit();
        });
        dropZone.on("uploadprogress", function(file, progress) {
            var bytesTotal = file.size;
            var bytesSent = file.size * progress/100;
            uploadProgress(bytesSent, bytesTotal, progress);
        });
        dropZone.on("complete", function() {
            uploadDone();
        });
    }
    function attachForm() {
        $("form").ajaxForm({
            beforeSend: function() {
                uploadInit();
            },
            uploadProgress: function(e, bytesSent, bytesTotal, completed) {
                uploadProgress(bytesSent, bytesTotal, completed);
            },
            complete: function() {
                uploadDone();
            }
        });
    }
    function uploadInit() {
        progress.fadeIn(600);
        bar.width("0%");
        percent.html("");
        isUploading = true;
        start = new Date().getTime();
    }
    function uploadDone(){
        bar.width("100%");
        percent.html("finished");
        progress.fadeOut(600);
        isUploading = false;
    }
    function uploadProgress(bytesSent, bytesTotal, completed) {
        var perc = Math.round(completed) + "%";
        bar.width(perc);

        // Calculate estimated time left
        var elapsed = (new Date().getTime()) - start;
        var estimate = bytesTotal / (bytesSent / elapsed);
        var secs = (estimate - elapsed) / 1000;
        if ( secs > 120) {
            percent.html("less than " + Math.floor((secs/60)+1) + " minutes left");
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
function buildHTML(fileList,root) {
    // TODO: Clean up this mess
    var htmlFiles = "", htmlDirs = "", htmlBack = "";
    //root.replace(/\//g,"<span class='black'>/</span>");

    $("#current").html(root);
    folderList = [];

    if (root !== "/") {
        htmlBack = [
            '<div class="folderrow">',
            '<img class="icon" src="res/dir.png" width="16px" height="16px" alt="Directory">',
            '<a class="backlink" href="">..</a></div><div class="right"></div>'
        ].join("");
    }

    for (var file in fileList) {
        if (fileList.hasOwnProperty(file)) {

            var name = file;
            var type = fileList[file].type;
            var size = convertToSI(fileList[file].size);

            var id;
            if (root === "/")
                id = "/" + name;
            else
                id = root + "/" + name;

            if (type === "f") {
                //Create a file row
                htmlFiles += [
                    '<div class="filerow" data-id="',id,'"><img class="icon" src="res/file.png" width="16px" height="16px" alt="File">',
                    '<div class="filename"><a class="filelink" href="',escape("/get" + id),'">',name,'</a></div>',
                    '<div class="fileinfo">',size,'<span class="spacer"></span><a class="delete" href="">&#x2716;</a></div>',
                    '<div class="right"></div></div>'
                ].join("");

            } else if (type === "d") {
                //Create a folder row
                htmlDirs += [
                    '<div class="folderrow" data-id="',id,'"><img class="icon" src="res/dir.png" width="16px" height="16px" alt="Directory">',
                    '<div class="foldername"><a class="folderlink" href="">',name,'</a></div>',
                    '<div class="folderinfo"><span class="spacer"></span><a class="delete" href="">&#x2716;</a></div>',
                    '<div class="right"></div></div>'
                ].join("");

                //Add to list of active folders
                folderList[name.toLowerCase()] = true;
            }

        }
    }
    return htmlBack + htmlDirs + htmlFiles;
}
function convertToSI(bytes) {
    var kib = 1024,
        mib = kib * 1024,
        gib = mib * 1024,
        tib = gib * 1024;

    if ((bytes >= 0) && (bytes < kib))         return bytes + ' B';
    else if ((bytes >= kib) && (bytes < mib))  return (bytes / kib).toFixed(2) + ' KiB';
    else if ((bytes >= mib) && (bytes < gib))  return (bytes / mib).toFixed(2) + ' MiB';
    else if ((bytes >= gib) && (bytes < tib))  return (bytes / gib).toFixed(2) + ' GiB';
    else if (bytes >= tib)                     return (bytes / tib).toFixed(2) + ' TiB';
    else return bytes + ' B';
}

}).call(this);
