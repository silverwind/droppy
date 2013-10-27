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
    "timestamps"   : true,
    "httpsKey"     : "./keys/key.pem",
    "httpsCert"    : "./keys/cert.pem",
    "db"           : "./db.json",
    "filesDir"     : "./files/",
    "incomingDir"  : "./incoming/",
    "resDir"       : "./res/",
    "srcDir"       : "./src/"
}
````

###General options
- `debug` Skip resource minification and enable automatic CSS reloading.
- `useHTTPS` Whether the server should use HTTPS.
- `port` The listening port. For HTTPS, you may want to set it to 443.
- `readInterval` The minimum time gap in milliseconds in which updates to a directory are sent.
- `filesMode` The access mask with which files are created.
- `dirMode` The access mask with which directories are created.
- `linkLength` The amount of characters in a shortlink to a file.
- `maxOpen` The maximum number of concurrently opened files. 256 seems safe for Windows. On Unix, you can probably go higher.
- `timestamps` Adds timestamps to log output. Useful if your logging facility does not provide timestamps.
- `httpsKey` Path to your openSSL private key. Used in conjunction with `useHTTPS`.
- `httpsCert` Path to your openSSL cert(s). Used in conjunction with `useHTTPS`.

###Path options
- `db` Location of the user database file.
- `filesDir` The directory which serves as the server's root.
- `incomingDir` The directory which serves as the server's root.
- `resDir` The directory which contains the compiled resources and images.
- `srcDir` The directory which contains the html/js/css sources.
