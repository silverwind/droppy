(function () {
	var baseURL = location.protocol + "//" + location.host;
	var socket = io.connect(baseURL);

	$(document).ready(function() {

		socket.on('UPDATE_FILES', function (data) {
			$("#content").html(data)
		});

		socket.on("UPLOAD_PROGRESS", function(percentage){
			$("#progressBar").width() = percentage + "%";
		});

		//Initial update of files
		socket.emit("REQUEST_UPDATE");
	});
}());