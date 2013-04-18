(function() {

"use strict";

$(document).ready(function() {
    var user = $("#user"),
        pass = $("#pass"),
        form = $("form"),
        info = $("#info");

    user.focus();

    pass.keyup(function(e){
        if(e.keyCode === 13) {
            form.submit();
        }
    });

    pass.focus(function(){
        info.html("&nbsp;");
    });

    user.focus(function(){
        info.html("&nbsp;");
    });

    form.submit(function(e) {
        e.preventDefault();
        $.ajax({
            type: "POST",
            url: "/",
            data: form.serialize(),
            statusCode: {
                200: function() {
                    location.reload();
                },
                401: function() {
                    info.html("Wrong user name or password!");
                    user.val("");
                    pass.val("");
                }
            }
        });

        return false;
    });
});

}).call(this);