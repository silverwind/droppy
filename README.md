#Droppy

A simple HTTP fileserver built on [node.js](http://nodejs.org/).

First, make sure you have the required node modules installed: [formidable](https://github.com/felixge/node-formidable), [mime](https://github.com/broofa/node-mime), [socket.io](https://github.com/learnboost/socket.io). You can also use the provided shell scripts **droppy.sh** or **droppy.bat** to set up dependancies and start the server.

    npm install formidable
    npm install mime
    npm install socket.io

To start the server, execute server.js with node:

    node server.js

Files will be placed in **./files/**. The server will listen on [localhost:80](http://localhost/). These and other settings can be changes in **config.json**:

###config.json

````javascript
{
    "filesDir"  : "./files/",
    "port"      : 80,
    "useSSL"    : false,
    "httpsKey"  : "./key.pem",
    "httpsCert" : "./cert.pem"
}
````

######"filesDir"
The directory which serves as the server's root. Can be relative or absolute.

######"port"
The listening port.

######"useSSL"
If the server should use HTTPS (SSL). Requires both the key file, `"httpsKey"` and the certificate, `"httpsCert"` to be set.
