// vim: ts=4:sw=4
(function () {
	"use strict";

	var baseURL = location.protocol + "//" + location.host;
	var socket = io.connect(baseURL);

	$(document).ready(function() {
		new Dropzone(document.body, {clickable: false,url: "/upload"});
//-----------------------------------------------------------------------------
		$("body").on("click", ".delete", function(e) {
			e.preventDefault();
			$.ajax({
				type: "GET",
				url: $(this).attr("href")
			});
		});
//-----------------------------------------------------------------------------
//Attach jquery.form and handle progress updates
		$("form").change(function() {
			$("form").submit();
		});

		var bar = $("#progressBar");
		var percent = $("#percent");

		$("form").ajaxForm({
			beforeSend: function() {
				$("#progress").show();
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
				$("#progress").hide();
			}
		});
//-----------------------------------------------------------------------------
		socket.on("UPDATE_FILES", function (data) {
			var json = JSON.parse(data);
			var html = getFileList(json);
			$("#content").html(html);
		});
//-----------------------------------------------------------------------------
		$("#add-folder").click(function (){
			$("#overlay").toggle();
			$("#name").val("");
			$("#name").focus();
		});
//-----------------------------------------------------------------------------
		$("#name").keyup(function(e){
			if(e.keyCode == 27) $("#overlay").toggle(); // Escape Key
			var input = $("#name").val();
			var valid = !input.match(/[\\*{}\/<>?|]/);
			if (!valid){
				$("#info-filename").show();
				$("#name").css("background-color","#f55");
				$("#name").css("border-color","#f00");
			} else {
				$("#info-filename").hide();
				$("#name").css("background-color","#eee");
				$("#name").css("border-color","#ff9147");
			}
			if(e.keyCode == 13 && input && valid) { // Return Key
				socket.emit("CREATE_FOLDER",input);
				$("#info-filename").hide();
				$("#overlay").hide();
			}
		});

		//Initial update of files
		socket.emit("REQUEST_UPDATE");
	});
//-----------------------------------------------------------------------------
	function getFileList(fileList) {
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
	function convertToSI(bytes) {
		var suffix = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"], tier = 0;

		while(bytes >= 1024) {
			bytes /= 1024;
			tier++;
		}
		return Math.round(bytes * 10) / 10 + " " + suffix[tier];
	}
}());