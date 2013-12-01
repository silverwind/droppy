#droppy
Pure HTML5 multi-user cloud storage running on [node.js](http://nodejs.org/).

![droppy](http://i.imgur.com/pnWbq98.png)

###Features

* Realtime updating of all connected clients via WebSockets.
* Lightweight. Performs great, even on a Raspberry Pi.
* Drag-and-Drop uploads of multiple files in all browsers.
* Recursive directory uploads in all supported browsers (WebKit-only as of now, Mozilla is [working on it](https://bugzilla.mozilla.org/show_bug.cgi?id=846931)).
* Asynchronous uploads over XMLHTTPRequest2.
* Playback of audio files via HTML5 `<audio>`, depending on [browser format support](https://developer.mozilla.org/en-US/docs/HTML/Supported_media_formats#Browser_compatibility).
* Support for shortened and easy shareable links for unauthenticted downloads.
* Clean and almost dependency-free client-side JavaScript code (Just jQuery which I plan to remove).

##Installation
You can install droppy's self-contained directory from [npm](https://npmjs.org/package/droppy) like:
````bash
npm install droppy && mv node_modules/droppy . && rm -rf node_modules
````
Or get the latest development version through git:
````bash
git clone git://github.com/silverwind/droppy.git
````

##Running the server
Inside `droppy`'s folder run:
````bash
node droppy
````
By default, the server will listen on [https](https://localhost/). On first startup, you'll be prompted for a username and password for your first account. To list, add or remove accounts, see `node droppy help`.

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
- `useHTTPS` Whether the server should use SSL/TLS encryption.
- `useSPDY` Enables the SPDYv3 protocol. Use in conjunction with `useHTTPS`.
- `port` The listening port.
- `readInterval` The minimum time gap in milliseconds in which updates to a directory are sent.
- `filesMode` The access mask with which files are created.
- `dirMode` The access mask with which directories are created.
- `linkLength` The amount of characters in a shortlink.
- `maxOpen` The maximum number of concurrently opened files. This option is primarily there for Windows servers.
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
