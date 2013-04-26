#Droppy
A modern HTTP/HTTPS fileserver built on [node](http://nodejs.org/) utilizing [WebSockets](https://en.wikipedia.org/wiki/WebSocket) for realtime updates. A fairly recent browser is required (For IE, that's 10).

###Installation
With [node](http://nodejs.org/) installed, run:
````
git clone https://github.com/silverwind/Droppy.git && cd Droppy && npm install
````
This will set up directory and fetch the dependancies, which are [ws](https://github.com/einaros/ws/), [formidable](https://github.com/felixge/node-formidable), [cleancss](https://github.com/GoalSmashers/clean-css), [uglifyjs](https://github.com/mishoo/UglifyJS2) and [mime](https://github.com/broofa/node-mime).

###Usage
To start the server, run either
````
node droppy
````
or just
````
./droppy.js
````

Command line arguments are available through appending `-help`. Per default, shared files will be placed in `files/` and the server will listen on [localhost:80](http://localhost/). Note: If you're running inside Cygwin, it is advisable to run node with `cmd /c node` for compatibilty reasons.

###Configuration
Configuration is done through  the `config.json` file, located in the same directory as `droppy.js`.
````javascript
{
    "useSSL"       : false,
    "port"         : 80,
    "readInterval" : 100,
    "mode"         : 644,
    "httpsKey"     : "./keys/key.pem",
    "httpsCert"    : "./keys/cert.pem",
    "db"           : "./db.json",
    "filesDir"     : "./files/",
    "resDir"       : "./res/",
    "srcDir"       : "./src/"
}
````

- `useSSL`: Whether the server should use HTTPS (SSL).
- `port`: The listening port. For HTTPS, you may want to set it to 443.
- `readInterval`: The time in milliseconds between full directory scans. Reducing it results in a little more responsiveness at the cost of more file I/O.
- `mode`: The access mode with which files are created.
- `httpsKey` and `httpsCert`: The paths to you RSA private key and SSL certificate. Only used if `useSSL` is enabled. Sample self-signed files are provided.
- `db` Location of the user database file.
- `filesDir`: The directory which serves as the server's root.
- `resDir`: The directory which contains the compiled resources and images.
- `srcDir`: The directory which contains the html/js/css sources.
