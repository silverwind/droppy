// vim: ts=4:sw=4
(function () {
    "use strict";
//-----------------------------------------------------------------------------
// Initialize WebSocket
    var baseURL = location.protocol + "//" + location.host;
    var socket = io.connect(baseURL);
//-----------------------------------------------------------------------------
    $(document).ready(function() {
        var bar = $("#progressBar"),
            percent = $("#percent"),
            progress = $("#progress"),
            content = $("#content");
//-----------------------------------------------------------------------------
// Mark the body as destination for file drops
        new Dropzone(document.body, {clickable: false, url: "/upload"});
//-----------------------------------------------------------------------------
// Delete calls run over xhr
        $("body").on("click", ".delete", function(e) {
            e.preventDefault();
            $.ajax({
                type: "GET",
                url: $(this).attr("href")
            });
        });
//-----------------------------------------------------------------------------
// Attach jquery.form to the form and handle progress updates
//(seems to also work on the dropzone)
        $("form").change(function() {
            $("form").submit();
        });
//-----------------------------------------------------------------------------
// Upload event handling
        $("form").ajaxForm({
            beforeSend: function() {
                progress.show();
                var perc = "0%";
                bar.width(perc);
                percent.html(perc);
            },
            uploadProgress: function(e, pos, total, completed) {
                var perc = completed + "%";
                bar.width(perc);
                percent.html(perc);
            },
            success: function() {
                var perc = "100%";
                bar.width(perc);
                percent.html(perc);
            },
            complete: function(xhr) {
                progress.hide();
            }
        });
//-----------------------------------------------------------------------------
// Handle WebSocket updates from server
        socket.on("UPDATE_FILES", function (data) {
            var json = JSON.parse(data);
            var html = buildHTML(json);
            content.html(html);
        });
//-----------------------------------------------------------------------------
// Show popup for folder creation
        $("#add-folder").click(function (){
            $("#overlay").toggle();
            $("#name").val("");
            $("#name").focus();
        });
//-----------------------------------------------------------------------------
// Handler for the input of the folder name
// TODO: Sanitize on server
        $("#name").keyup(function(e){
            var name = $("#name");
            if(e.keyCode == 27)
                $("#overlay").toggle(); // Escape Key
            var input = name.val();
            var valid = !input.match(/[\\*{}\/<>?|]/);
            if (!valid){
                $("#info-filename").show();
                name.css("background-color","#f55");
                name.css("border-color","#f00");
            } else {
                $("#info-filename").hide();
                name.css("background-color","#eee");
                name.css("border-color","#ff9147");
            }
            if(e.keyCode == 13 && input && valid) { // Return Key
                socket.emit("CREATE_FOLDER",input);
                $("#info-filename").hide();
                $("#overlay").hide();
            }
        });
//-----------------------------------------------------------------------------
//Initial update of files
        socket.emit("REQUEST_UPDATE");
    });
//-----------------------------------------------------------------------------
// Convert the fileList object into HTML
    function buildHTML(fileList) {
        var htmlFiles = "",
            htmlDirs = "",
            header = '<div class="fileheader"><div class="fileicon">Name</div><div class="filename">&nbsp;</div><div class="fileinfo">Size<span class="headerspacer">Del</span></div><div class=right></div></div>',
            i = 0,
            name,
            href;

        while(fileList[i]) {
            var file = fileList[i];
            if(file.type == "f") {
                var size = convertToSI(file.size);
                name = file.name;
                href = "/files/" + unescape(file.name);
                htmlFiles += '<div class="filerow">';
                htmlFiles += '<div class="fileicon" title="File"><img src="res/file.png" alt="File"></div>';
                htmlFiles += '<div class="filename"><a class="filelink" href="' + href + '">' + name + '</a></div>';
                htmlFiles += '<div class="fileinfo">' + size + '<span class="spacer"></span><a class="delete" href="delete/' + name + '">&#x2716;</div>';
                htmlFiles += '<div class=right></div></div>';
            } else {
                name = file.name;
                href = '#'; //TODO
                htmlDirs += '<div class="filerow">';
                htmlDirs += '<div class="fileicon" title="Directory"><img src="res/dir.png" alt="Directory"></div>';
                htmlDirs += '<div class="filename"><a class="filelink" href="' + href + '">' + name + '</a></div>';
                htmlDirs += '<div class="fileinfo">-<span class="spacer"></span><a class="delete" href="delete/' + name + '">&#x2716;</div>';
                htmlDirs += '<div class=right></div></div>';
            }
            i++;
        }
        return header + htmlDirs + htmlFiles;
    }
//-----------------------------------------------------------------------------
// Helper function for size values
    function convertToSI(bytes) {
        var suffix = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"], tier = 0;

        while(bytes >= 1024) {
            bytes /= 1024;
            tier++;
        }
        return Math.round(bytes * 10) / 10 + " " + suffix[tier];
    }
}());