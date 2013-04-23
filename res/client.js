// vim: ts=4:sw=4
(function() {

"use strict";

var folderList    = [],
    isUploading   = false,
    isUnloading   = false,
    currentFolder = "/";

var bar, content, info, name, percent, progress, loc, start;

//-----------------------------------------------------------------------------
// WebSocket functions
var ws;
// Open a new socket connection
function openSocket() {
    if (document.location.protocol === "https:")
        ws = new WebSocket('wss://' + window.document.location.host);
    else
        ws = new WebSocket('ws://' + window.document.location.host);

    ws.onopen = function() {
        console.log("onopen");
        // Request initial update
        sendMessage("REQUEST_UPDATE", currentFolder);
    };

    // Handle incoming socket message
    ws.onmessage = function (event) {
        console.log("onmessage");
        var msg = JSON.parse(event.data);
        if (msg.type === "UPDATE_FILES") {
            if (isUploading) return;
            if(msg.folder === currentFolder.replace(/&amp;/,"&")) {
                content.html(buildHTML(msg.data, msg.folder));
            }
        }
    };
    ws.onclose = function() {
        console.log("onclose");
        // Restart a closed socket. Firefox closes it on every download..
        // https://bugzilla.mozilla.org/show_bug.cgi?id=858538
        if(!isUnloading) setTimeout(openSocket,300);
    };
}

// Send a socket message
function sendMessage(msgType, msgData) {
    ws.send(JSON.stringify({
        type: msgType,
        data: msgData
    }));
}

// Try to close the socket when the user navigates away to avoid errors
// (This doesn't seem to always trigger in time)
$(window).unload(function() {
    isUnloading = true;
    ws.close();
});
//-----------------------------------------------------------------------------
$(document).ready(function() {
    // Cache elements
    bar = $("#progressBar"),
    content = $("#content"),
    info = $("#info"),
    name = $("#nameinput"),
    percent = $("#percent"),
    progress = $("#progress"),
    loc = $("#current");

    // Open a WS
    openSocket();

    // Initialize and attach plugins
    attachDropzone();
    attachForm();

    // Delete a folder
    $("body").on("click", ".delete", function(e) {
        e.preventDefault();
        sendMessage("DELETE_FILE", $(this).parent().parent().data("id"));
    });

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

    // Automatically submit a form once it's data changed
    $("form").change(function() {
        $("form").submit();
        $("#file").val(""); // Reset file form
    });

    // Show popup for folder creation
    $("#add-folder").click(function (){
        $("#overlay").fadeToggle(350);
        name.val("");
        name.focus();
        name.attr("class","valid");
    });

    //TODO: Keybindings
    //$('body').keyup(function(event) {
    //    alert(event.which);
    //});

    // Handler for the input of the folder name
    // TODO: Sanitize on server
    name.keyup(function(e){
        if(e.keyCode === 27) // Escape Key
            $("#overlay").toggle();

        var input = name.val();
        var valid = !input.match(/[\\*{}\/<>?|]/) && !input.match(/\.\./);
        var folderExists = folderList[input.toLowerCase()] === true;
        if (input === "" ) {
            name.attr("class","valid");
            info.html("&nbsp;");
            return;
        }

        if (!valid){
            name.attr("class","invalid");
            info.html("Invalid character(s) in filename!");
            return;
        }

        if (folderExists) {
            name.attr("class","invalid");
            info.html("File/Directory already exists!");
            return;
        }

        name.attr("class","valid");
        info.html("&nbsp;");

        if(e.keyCode === 13) { // Return Key
            if (currentFolder === "/")
                sendMessage("CREATE_FOLDER", "/" + input);
            else
                sendMessage("CREATE_FOLDER", currentFolder + "/" + input);
            $("#overlay").fadeOut(350);
        }
    });
});
//-----------------------------------------------------------------------------
// Mark the body as destination for file drops; Define upload events
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
//-----------------------------------------------------------------------------
// Attach jquery.form to all forms; Define upload events
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

//-----------------------------------------------------------------------------
// Upload helper functions
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

    // Set progress bar width
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
//-----------------------------------------------------------------------------
// Convert the received fileList object into HTML
// TODO: Clean up this mess
function buildHTML(fileList,root) {
    var htmlFiles = "", htmlDirs = "", htmlBack = "";
    var htmlheader = '<div id="current">' + root.replace(/\//g,"<span class='black'>/</span>") + '</div>';
    folderList = [];

    if(root !== "/") {
        htmlBack += '<div class="folderrow">';
        htmlBack += '<div class="foldericon" title="Go up one directory"><img src="res/dir.png" width="16px" height="16px" alt="Directory"></div>';
        htmlBack += '<div class="filename"><a class="backlink" href="">..</a></div>';
        htmlBack += '<div class="folderinfo"></div>';
        htmlBack += '<div class="right"></div></div>';
    }

    for(var file in fileList) {
        if (fileList.hasOwnProperty(file)) {

            var name = file;
            var type = fileList[file].type;
            var size = convertToSI(fileList[file].size);

            var id;
            if (root === "/")
                id = "/" + name;
            else
                id = root + "/" + name;

            var href = "/get" + id;

            if (type === "f") {
                //Create a file row
                htmlFiles += '<div class="filerow" data-id="' + id + '">';
                htmlFiles += '<div class="fileicon" title="File"><img src="res/file.png" width="16px" height="16px" alt="File"></div>';
                htmlFiles += '<div class="filename"><a class="filelink" href="' + escape(href) + '">' + name + '</a></div>';
                htmlFiles += '<div class="fileinfo">' + size + '<span class="spacer"></span><a class="delete" href="">&#x2716;</a></div>';
                htmlFiles += '<div class="right"></div></div>';

            } else if (type === "d") {
                //Create a folder row
                htmlDirs += '<div class="folderrow" data-id="' + id + '">';
                htmlDirs += '<div class="foldericon" title="Directory"><img src="res/dir.png" width="16px" height="16px" alt="Directory"></div>';
                htmlDirs += '<div class="foldername"><a class="folderlink" href="">' + name + '</a></div>';
                htmlDirs += '<div class="folderinfo"><span class="spacer"></span><a class="delete" href="">&#x2716;</a></div>';
                htmlDirs += '<div class="right"></div></div>';
                //Add to list of active folders
                folderList[name.toLowerCase()] = true;
            }

        }
    }
    return htmlheader + htmlBack + htmlDirs + htmlFiles;
}
//-----------------------------------------------------------------------------
// Helper function for size values
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