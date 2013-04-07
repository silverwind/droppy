// vim: ts=4:sw=4
(function () {
	"use strict";

	var baseURL = location.protocol + "//" + location.host;
	var socket = io.connect(baseURL);

	$(document).ready(function() {
		new Dropzone(document.body, {clickable: false,url: "/upload"});
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

		socket.on("UPDATE_FILES", function (data) {
			$("#content").html(data);
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