#droppy
Pure HTML5 file-server web application running on [node](http://nodejs.org/).

![droppy](http://i.imgur.com/9dupKrP.png)

###Features

* Realtime updating of all connected clients via WebSockets.
* Drop uploads of multiple files in all browsers.
* Recursive directory uploads in Webkit browsers.
* Asynchronous uploads over XMLHTTPRequest2.
* Playback of audio files via HTML5 `<audio>`, depending on [browser format support](https://developer.mozilla.org/en-US/docs/HTML/Supported_media_formats#Browser_compatibility).
* Generation of shortened and easy shareable links for quick and unauthenticted downloads.
* Clean and almost dependency-free JavaScript code.

##Installation
With [node](http://nodejs.org/download/) installed, run:
````bash
npm install droppy
````
The above will install droppy in `node_modules/droppy` which is a self-contained directory.

##Running the server
Inside `node_modules/droppy` run:
````bash
./droppy.js
````
By default, the server will listen on [https](https://localhost/). On first startup, a user `droppy` with password `droppy` will be created. To add users, run `./droppy.js -adduser [user] [pass]`. To remove users, you'll have to edit `db.json` (until user management is implemented).

##Configuration
Configuration is done through `config.json`
````javascript
{
    "debug"        : false,
    "useHTTPS"     : true,
    "useSPDY"      : false,
    "port"         : 443,
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
- `debug` Skip resource minification and enable automatic CSS reloading when the source files change.
- `useHTTPS` Whether the server should use HTTPS.
- `useSPDY` Enables the SPDY protocol, in conjunction with `useHTTPS`.
- `port` The listening port. For HTTPS, you may want to set it to 443.
- `readInterval` The minimum time gap in milliseconds in which updates to a directory are sent.
- `filesMode` The access mask with which files are created.
- `dirMode` The access mask with which directories are created.
- `linkLength` The amount of characters in a shortlink to a file.
- `maxOpen` The maximum number of concurrently opened files. 256 seems safe for Windows. On Unix, you can probably go higher.
- `timestamps` Adds timestamps to log output. Useful if your logging facility does not provide timestamps.

###Path options
- `httpsKey` Path to your openSSL private key. Used in conjunction with `useHTTPS`.
- `httpsCert` Path to your openSSL cert(s). Used in conjunction with `useHTTPS`.
- `db` Location of the user database file.
- `filesDir` The directory which serves as the server's root.
- `incomingDir` The directory which serves as the server's root.
- `resDir` The directory which contains the compiled resources and images.
- `srcDir` The directory which contains the html/js/css sources.

##Supported Browsers
- Firefox (last 2 versions)
- Chrome (last 2 versions)
- Internet Explorer 10 or higher

In case of Firefox and Chrome older version may still work, but I'm not targeting CSS code at them.
