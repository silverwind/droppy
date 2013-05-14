#Droppy
A modern HTTP/HTTPS fileserver built on [node](http://nodejs.org/) utilizing WebSockets for realtime updates. A fairly recent browser is required (for IE, it's 10 currently, working on IE8).

###Installation
With [node](http://nodejs.org/) installed, run:
````
git clone https://github.com/silverwind/Droppy.git && cd Droppy && npm install
````
###Usage
To start the server, run either
````
node droppy
````
or just
````
./droppy.js
````
Once the server is listening, navigate to [http://localhost:80/](http://localhost/). The default login is user `droppy` with password `droppy`. To add more users, run `./droppy.js -adduser username password`. To remove users, edit db.json (for now).

###Configuration
Configuration is done through  the `config.json` file, located in the same directory as `droppy.js`.
````javascript
{
    "debug"        : false,
    "useSSL"       : false,
    "port"         : 80,
    "readInterval" : 50,
    "mode"         : "755",
    "httpsKey"     : "./keys/key.pem",
    "httpsCert"    : "./keys/cert.pem",
    "db"           : "./db.json",
    "filesDir"     : "./files/",
    "resDir"       : "./res/",
    "srcDir"       : "./src/"
}
````

- `debug`: With debug enabled, client JS/CSS resources won't be minfied.
- `useSSL`: Whether the server should use HTTPS (SSL).
- `port`: The listening port. For HTTPS, you may want to set it to 443.
- `readInterval`: The minimum interval in milliseconds in which updates to a directory are sent. In case a directory gets constantly written to, this helps to keep the amount of updates (and I/O) in check.
- `mode`: The access mode with which files are created.
- `httpsKey` and `httpsCert`: The paths to you RSA private key and SSL certificate. Only used if `useSSL` is enabled. Sample self-signed files are provided.
- `db` Location of the user database file.
- `filesDir`: The directory which serves as the server's root.
- `resDir`: The directory which contains the compiled resources and images.
- `srcDir`: The directory which contains the html/js/css sources.

###Notes
- If you're running inside Cygwin, it is advisable to run node with `cmd /c node` for compatibilty reasons.