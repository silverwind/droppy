// vim: ts=4:sw=4
(function() {
"use strict";

var entries = [],
    isUploading = false,
    start;

// Initialize WebSocket
var baseURL = location.protocol + "//" + location.host;
var socket = io.connect(baseURL);

// DOM is ready
$(document).ready(function() {
    var bar = $("#progressBar"),
        content = $("#content"),
        info = $("#info-filename"),
        name = $("#nameinput"),
        percent = $("#percent"),
        progress = $("#progress");

    // Mark the body as destination for file drops
    new Dropzone(document.body, {clickable: false, url: "/upload"});

    // Change delete links to xhr
    $("body").on("click", ".delete", function(e) {
        e.preventDefault();
        $.ajax({
            type: "GET",
            url: $(this).attr("href")
        });
    });

    // Disable folder links (for now)
    $("body").on("click", ".folderlink", function(e) {
        e.preventDefault();
    });

    // Automatically submit a form once it's data changed
    $("form").change(function() {
        $("form").submit();
    });

    // Attach jquery.form to all forms; Define upload events
    $("form").ajaxForm({
        beforeSend: function() {
            // Initialize a few things
            progress.show();
            bar.width("0%");
            percent.html("");
            isUploading = true;
            start = new Date().getTime();
        },
        uploadProgress: function(e, pos, total, completed) {
            // Set progress bar width
            bar.width(completed + "%");

            // Calculate estimated time left
            var elapsed = (new Date().getTime()) - start;
            var estimate = total / (pos / elapsed);
            var secs = (estimate - elapsed) / 1000;
            if ( secs > 120) {
                percent.html("less than " + Math.floor((secs/60)+1) + " minutes left");
            } else if (secs > 60) {
                percent.html("less than 2 minute left");
            } else {
                percent.html(Math.round(secs) + " seconds left");
            }
        },
        success: function() {
            bar.width("100%");
            percent.html("finished");
        },
        complete: function(xhr) {
            progress.fadeOut(800);
            isUploading = false;
        }
    });

    // Handle WebSocket updates from server
    socket.on("UPDATE_FILES", function (data) {
        if (!isUploading) {
            var json = JSON.parse(data);
            var html = buildHTML(json);
            content.html(html);
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
        if(e.keyCode == 27) // Escape Key
            $("#overlay").toggle();

        var input = name.val();
        var valid = !input.match(/[\\*{}\/<>?|]/);
        var folderExists = entries[input] === true;

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

        if(e.keyCode == 13) { // Return Key
            socket.emit("CREATE_FOLDER",input);
            $("#overlay").hide();
        }
    });

    //Request initial update of files
    socket.emit("REQUEST_UPDATE");
});
//-----------------------------------------------------------------------------
// Convert the received fileList object into HTML
function buildHTML(fileList) {
    var htmlFiles = "",
        htmlDirs = "",
        header = '<div class="fileheader"><div class="fileicon">Name</div><div class="filename">&nbsp;</div><div class="fileinfo">Size<span class="headerspacer">Del</span></div><div class=right></div></div>',
        i = 0,
        name,
        href;

    entries = [];

    while(fileList[i]) {
        var entry = fileList[i];
        name = entry.name;
        if(entry.type == "f") {
            //Create a file row
            var size = convertToSI(entry.size);
            href = "/files/" + entry.name;
            htmlFiles += '<div class="filerow">';
            htmlFiles += '<div class="fileicon" title="File"><img src="res/file.png" width="16px" height="16px" alt="File"></div>';
            htmlFiles += '<div class="filename"><a class="filelink" href="' + escape(href) + '">' + name + '</a></div>';
            htmlFiles += '<div class="fileinfo">' + size + '<span class="spacer"></span><a class="delete" href="delete/' + escape(name) + '">&#x2716;</div>';
            htmlFiles += '<div class=right></div></div>';
        } else {
            //Create a folder row
            href = ''; //TODO
            htmlDirs += '<div class="folderrow">';
            htmlDirs += '<div class="foldericon" title="Directory"><img src="res/dir.png" width="16px" height="16px" alt="Directory"></div>';
            htmlDirs += '<div class="foldername"><a class="folderlink" href="' + escape(href) + '">' + name + '</a></div>';
            htmlDirs += '<div class="folderinfo">-<span class="spacer"></span><a class="delete" href="delete/' + escape(name) + '">&#x2716;</div>';
            htmlDirs += '<div class=right></div></div>';
        }
        entries[name] = true;
        i++;
    }
    return header + htmlDirs + htmlFiles;
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