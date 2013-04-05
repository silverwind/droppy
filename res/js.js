// vim: ts=4:sw=4
(function () {
	"use strict";

	var baseURL = location.protocol + "//" + location.host;
	var socket = io.connect(baseURL);
	var isUploading = false;

	$(document).ready(function() {
		new Dropzone(document.body, {clickable: false,url: "/upload"});

		socket.on('UPDATE_FILES', function (data) {
			if (!isUploading)
				$("#content").html(data);
		});

		socket.on("UPLOAD_PROGRESS", function(perc) {
			isUploading = true;
			$("#progress").show();
			$("#progressBar").width(perc + "%");
			if(perc == 100) {
				$("#progress").hide();
				isUploading = false;
			}
		});

		$("#add-folder").click(function (){
			$("#overlay").toggle();
			$("#name").val("");
			$("#name").focus();
		});

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
}());