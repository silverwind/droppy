Droppy
=======
A simple HTTP fileserver built on [node.js](http://nodejs.org/).

First, make sure you have [formidable](https://github.com/felixge/node-formidable) installed:

    npm install formidable

To start the server, execute server.js with node:

    node server.js

Files will be placed in **./files/**. The server will listen on [127.0.0.1:80](http://127.0.0.1/). These two settings can be changed on the first few lines in the source.