(function() {

"use strict";

$(document).ready(function() {
    var user = $("#user"),
        pass = $("#pass"),
        form = $("form"),
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
});

function submitForm(form, errForm) {
    $.ajax({
        type: "POST",
        url: "/login",
        data: form.serialize(),
        statusCode: {
            200: function() {
                location.reload();
            },
            401: function() {
                showError(errForm);
            }
        }
    });
}

function showError(el) {
    el.attr("class","invalid");
    el.val("Wrong username/password!");
}

function resetError(el) {
    el.attr("class","valid");
    el.val("Sign in");
}

}).call(this);