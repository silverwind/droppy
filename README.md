#Droppy

A modern HTTP/HTTPS fileserver built on [node.js](http://nodejs.org/) utilizing [WebSockets](https://en.wikipedia.org/wiki/WebSocket) for realtime updates. A fairly recent browser is required (For IE, that's 10).

###Installation & Usage

First, make sure you have the required node modules installed: [formidable](https://github.com/felixge/node-formidable), [mime](https://github.com/broofa/node-mime), [socket.io](https://github.com/learnboost/socket.io). You can also use the provided shell scripts, **droppy.sh** or **droppy.bat** to install the modules and run the server.

````
npm install formidable
npm install mime
npm install socket.io
````

To start the server, execute:
````
node droppy
````

Command line arguments are available through `node droppy -help`. Per default, files will be placed in **./files/** and the server will listen on [localhost:80](http://localhost/). These and other settings can be changes in **config.json**.

Note: If you're running inside Cygwin, it is advisable to run node with `cmd /c node` for compatibilty reasons.

###config.json

````javascript
{
    "filesDir"     : "./files/",
    "resDir"       : "./res/",
    "useSSL"       : false,
    "useAuth"      : false,
    "port"         : 80,
    "readInterval" : 100,
    "httpsKey"     : "./key.pem",
    "httpsCert"    : "./cert.pem",
    "userDB"       : "./userDB.json"
}
````

- `filesDir` The directory which serves as the server's root. Can be relative or absolute.

- `resDir` The directory which contains the server's resources.

- `useSSL` Whether the server should use HTTPS (SSL). Requires both the key file, `httpsKey` and the certificate, `httpsCert` to be set.

- `useAuth` Whether to enable user authentication. If enabled, at least one user needs to exist in the database. New users are created through `node droppy -adduser username password`. The assiciated user database will be stored in a file, defined by `userDB`.

- `port` The listening port. For HTTPS, you may want to set it to 443.

- `readInterval` The time in milliseconds between full directory scans. Reducing it results in a little more responsiveness at the cost of more file I/O.

- `httpsKey` and `httpsCert` The paths to you RSA private key and SSL certificate. Only used if `useSSL` is enabled. Self-signed certificates are supported, in case you just want end-to-end encryption.

- `userDB` Location of the user database
