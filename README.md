#droppy
A modern, [node](http://nodejs.org/)-based file server web application utilizing WebSockets for realtime updates. It supports dropping one or more files into the window, and with Chrome, directories can be recursively uploaded.

![droppy](http://i.imgur.com/VZlJ1UY.png)

##Installation
With [node](http://nodejs.org/) installed, run:
````
git clone https://github.com/silverwind/droppy.git && cd droppy && npm install
````
##Usage
To start the server, run either
````
node droppy
````
or just
````
./droppy.js
````
By default, the server will listen on [port 80](http://localhost/), which can be changed in config.json. The default login is user `droppy` with password `droppy`. To add more users, run `./droppy.js -adduser username password`. To remove users, edit db.json (for now).

##Supported Browsers
- Firefox (last 2 versions)
- Chrome (last 2 versions)
- Internet Explorer 10 or higher

In case of Chrome and Firefox, slightly older versions may work resonably well.
##Configuration
Configuration is done through the `config.json` file, located in the same directory as `droppy.js`.
````javascript
{
    "debug"        : true,
    "useSSL"       : false,
    "port"         : 80,
    "readInterval" : 50,
    "filesMode"    : "644",
    "dirMode"      : "755",
    "linkLength"   : 3,
    "maxOpen"      : 256,
    "httpsKey"     : "./keys/key.pem",
    "httpsCert"    : "./keys/cert.pem",
    "db"           : "./db.json",
    "filesDir"     : "./files/",
    "resDir"       : "./res/",
    "srcDir"       : "./src/"
}
````

- `debug`: With debug enabled, client JS/CSS resources won't be minfied and the stylesheet will get refreshed automatically when changed on the server.
- `useSSL`: Whether the server should use HTTPS (SSL).
- `port`: The listening port. For HTTPS, you may want to set it to 443.
- `readInterval`: The minimum interval in milliseconds in which updates to a directory are sent. In case a directory gets constantly written to, this helps to keep the amount of updates (and I/O) in check.
- `filesMode`: The access mask with which files are created.
- `dirMode`: The access mask with which directories are created.
- `linkLength` : The amount of characters in a shortened link to a file
- `maxOpen` : The maximum number of concurrently opened files. 256 seems safe for Windows. On Linux, you can probably go higher.
- `httpsKey` and `httpsCert`: The paths to you RSA private key and SSL certificate. Only used if `useSSL` is enabled. Sample self-signed files are provided.
- `db` Location of the user database file.
- `filesDir`: The directory which serves as the server's root.
- `resDir`: The directory which contains the compiled resources and images.
- `srcDir`: The directory which contains the html/js/css sources.
