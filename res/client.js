// vim: ts=4:sw=4
(function() {

"use strict";

var folderList    = [],
    isUploading   = false,
    currentFolder = "/";

var bar, content, info, name, percent, progress, loc, start;

// Initialize WebSocket
var baseURL = location.protocol + "//" + location.host;
var socket = io.connect(baseURL);

// DOM is ready
$(document).ready(function() {
    // Cache elements
    bar = $("#progressBar"),
    content = $("#content"),
    info = $("#info-filename"),
    name = $("#nameinput"),
    percent = $("#percent"),
    progress = $("#progress"),
    loc = $("#current");

    // Initialize and attach plugins
    attachDropzone();
    attachForm();

    // Set location
    loc.html(styleLoc(currentFolder));

    // Change delete links to xhr
    $("body").on("click", ".delete", function(e) {
        e.preventDefault();
        $.ajax({
            type: "GET",
            url: $(this).attr("href")
        });
    });

    // Switch into a folder
    $("body").on("click", ".folderlink", function(e) {
        e.preventDefault();

        var destination = $(this).html();
        if (currentFolder !== "/" ) destination = "/" + destination;

        currentFolder += destination;
        loc.html(styleLoc(currentFolder));

        socket.emit("SWITCH_FOLDER", currentFolder);
    });

    // Go back up
    $("body").on("click", ".backlink", function(e) {
        e.preventDefault();

        var match = currentFolder.match(/.*(\/)/)[0];
        match = match.substring(0,match.length - 1);
        if (!match.match(/\//)) match = "/";

        currentFolder = match;
        loc.html(styleLoc(currentFolder));

        socket.emit("SWITCH_FOLDER", currentFolder);
    });

    // Automatically submit a form once it's data changed
    $("form").change(function() {
        $("form").submit();
        $("#file").val("");
    });

    // Handle WebSocket updates from server
    socket.on("UPDATE_FILES", function (data) {
        if (!isUploading) {
            var json = JSON.parse(data);
            if(json[0] === currentFolder.replace(/&amp;/,"&")) { //The client stores "&"" as the html escape code
                var html = buildHTML(json);
                content.html(html);
            }
        }
    });

    // Show popup for folder creation
    $("#add-folder").click(function (){
        $("#overlay").toggle();
        name.val("");
        name.focus();
        name.attr("class","valid");
    });

    // Handler for the input of the folder name
    // TODO: Sanitize on server
    name.keyup(function(e){
        if(e.keyCode === 27) // Escape Key
            $("#overlay").toggle();

        var input = name.val();
        var valid = !input.match(/[\\*{}\/<>?|]/) && !input.match(/\.\./);
        var folderExists = folderList[input] === true;

        if (input === "" ) {
            name.attr("class","valid");
            info.html("");
            info.hide();
            return;
        }

        if (!valid){
            name.attr("class","invalid");
            info.html("Invalid character(s) in filename!");
            info.show();
            return;
        }

        if (folderExists) {
            name.attr("class","invalid");
            info.html("File/Directory already exists!");
            info.show();
            return;
        }

        name.attr("class","valid");
        info.html("");
        info.hide();

        if(e.keyCode === 13) { // Return Key
            if (currentFolder === "/")
                socket.emit("CREATE_FOLDER","/" + input);
            else
                socket.emit("CREATE_FOLDER",currentFolder + "/" + input);
            $("#overlay").hide();
        }
    });

    //Request initial update of files
    socket.emit("REQUEST_UPDATE",currentFolder);
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
// Initialize upload by resetting a few things
function uploadInit() {
        progress.show();
        bar.width("0%");
        percent.html("");
        isUploading = true;
        start = new Date().getTime();
}
//-----------------------------------------------------------------------------
// Update the progress bar and the time left
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
// Initialize a few things before starting the upload
function uploadDone(){
    bar.width("100%");
    percent.html("finished");
    progress.fadeOut(800);
    isUploading = false;
}
//-----------------------------------------------------------------------------
// Set the path indicator
function styleLoc(path){
    return path.replace(/\//g,"<span class='black'>/</span>");
}
//-----------------------------------------------------------------------------
// Convert the received fileList object into HTML
function buildHTML(fileList) {
    var htmlFiles = "", htmlDirs = "", htmlBack = "";
    var htmlheader = '<div class="fileheader"><div class="filename">Name</div><div class="fileinfo">Size<span class="headerspacer">Del</span></div><div class=right></div></div>';
    var name, href, delhref, root;

    folderList = [];
    root = fileList[0];

    if(root !== "/") {
        htmlBack += '<div class="folderrow">';
        htmlBack += '<div class="foldericon" title="Up one directory"><img src="res/dir.png" width="16px" height="16px" alt="Directory"></div>';
        htmlBack += '<div class="filename"><a class="backlink" href="">..</a></div>';
        htmlBack += '<div class="folderinfo"></div>';
        htmlBack += '<div class=right></div></div>';
    }
    var i = 1;
    while(fileList[i]) {

        var entry = fileList[i];
        name = entry.name;

        if (currentFolder === "/")
            delhref = "/delete/" +  name;
        else
            delhref = "/delete" + currentFolder + "/" +  name;

        if(entry.type === "f") {
            //Create a file row
            var size = convertToSI(entry.size);
            href = "/files" + root + "/" + entry.name;
            htmlFiles += '<div class="filerow">';
            htmlFiles += '<div class="fileicon" title="File"><img src="res/file.png" width="16px" height="16px" alt="File"></div>';
            htmlFiles += '<div class="filename"><a class="filelink" href="' + escape(href) + '">' + name + '</a></div>';
            htmlFiles += '<div class="fileinfo">' + size + '<span class="spacer"></span><a class="delete" href="' + escape(delhref) + '">&#x2716;</a></div>';
            htmlFiles += '<div class=right></div></div>';
        } else {
            //Create a folder row
            htmlDirs += '<div class="folderrow">';
            htmlDirs += '<div class="foldericon" title="Directory"><img src="res/dir.png" width="16px" height="16px" alt="Directory"></div>';
            htmlDirs += '<div class="foldername"><a class="folderlink" href="">' + name + '</a></div>';
            htmlDirs += '<div class="folderinfo"><span class="spacer"></span><a class="delete" href="' + escape(delhref) + '">&#x2716;</a></div>';
            htmlDirs += '<div class=right></div></div>';
        }
        folderList[name] = true;
        i++;
    }
    return htmlheader + htmlBack + htmlDirs + htmlFiles;
}
//-----------------------------------------------------------------------------
// Helper function for size values
function convertToSI(bytes)
{
    var kib = 1024;
    var mib = kib * 1024;
    var gib = mib * 1024;
    var tib = gib * 1024;

    if ((bytes >= 0) && (bytes < kib)) {
        return bytes + ' B';
    } else if ((bytes >= kib) && (bytes < mib)) {
        return (bytes / kib).toFixed(2) + ' KiB';
    } else if ((bytes >= mib) && (bytes < gib)) {
        return (bytes / mib).toFixed(2) + ' MiB';
    } else if ((bytes >= gib) && (bytes < tib)) {
        return (bytes / gib).toFixed(2) + ' GiB';
    } else if (bytes >= tib) {
        return (bytes / tib).toFixed(2) + ' TiB';
    } else {
        return bytes + ' B';
    }
}

}());