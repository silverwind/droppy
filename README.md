Droppy
=======
A simple HTTP fileserver built on [node.js](http://nodejs.org/).

First, make sure you have the required node modules installed: [formidable](https://github.com/felixge/node-formidable), [mime](https://github.com/broofa/node-mime), [socket.io](https://github.com/learnboost/socket.io):

    npm install formidable
    npm install mime
    npm install socket.io

To start the server, execute server.js with node (or use the included bat file on windows):

    node server.js

Files will be placed in **./files/**. The server will listen on [localhost:80](http://localhost/). These two settings can be changed on the first few lines in the source.
