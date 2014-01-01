#droppy <a href="https://npmjs.org/package/droppy"><img src="https://badge.fury.io/js/droppy@2x.png" alt="NPM version" height="18"></a>
Pure HTML5 cloud storage running on [node.js](http://nodejs.org/).

![droppy](http://i.imgur.com/X08SGQd.png)

###Features
* Lightweight. Performs great, even on a Raspberry Pi.
* Realtime updating of all connected clients via WebSockets.
* Asynchronous Drag-and-Drop uploading of files.
* Fully responsive, mobile-ready CSS.
* Recursive directory uploads in WebKit/Blink.
* Download directories as ZIPs.
* Playback of audio files via HTML5 `<audio>`, depending on [browser/platform format support](https://developer.mozilla.org/en-US/docs/HTML/Supported_media_formats#Browser_compatibility).
* Support for shortened and easy shareable links for unauthenticted downloads.
* Clean and almost dependency-free client-side JavaScript code (Just jQuery which I plan to remove).

##Installation
You can install droppy's self-contained directory from [npm](https://npmjs.org/package/droppy) like:
````bash
npm install droppy && mv node_modules/droppy . && rm -rf node_modules && cd droppy
````
Or get the latest development version through git:
````bash
git clone https://github.com/silverwind/droppy.git && cd droppy && npm install
````

##Running the server
Inside droppy's directory run:
````bash
node droppy
````
By default, the server will listen on [https](https://localhost/). On first startup, you'll be prompted for a username and password for your first account. To list, add or remove accounts, either use the configuration dialog or see `node droppy help`.

##Configuration
Configuration is done through `config.json`, which is created on the first run, with these contents:
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
    "zipLevel"     : 1,
    "timestamps"   : true,
    "db"           : "./db.json",
    "filesDir"     : "./files/",
    "incomingDir"  : "./temp/incoming/",
    "resDir"       : "./res/",
    "srcDir"       : "./src/",
    "tls" : {
        "key"      : "./keys/key.pem",
        "cert"     : "./keys/cert.pem",
        "ca"       : []
    }
}
````
###General options
- **debug**: Skip resource minification and enable automatic CSS reloading when the source files change.
- **useHTTPS**: Whether the server should use SSL/TLS encryption.
- **useSPDY**: Enables the SPDYv3 protocol. Use in conjunction with **useHTTPS**.
- **port**: The listening port.
- **readInterval**: The minimum time gap in milliseconds in which updates to a directory are sent.
- **filesMode**: The access mask with which files are created.
- **dirMode**: The access mask with which directories are created.
- **linkLength**: The amount of characters in a shortlink.
- **maxOpen**: The maximum number of concurrently opened files. This option is primarily there for Windows servers.
- **zipLevel**: The level of compression for zip files. Ranging from 0 (no compression) to 9 (maximum compression).
- **timestamps**: Adds timestamps to log output. Useful if your logging facility does not provide timestamps.

###Path options
- **db**: Location of the user database file.
- **tls**: See TLS options below.
- **filesDir**: The directory which serves as the server's root.
- **incomingDir**: The directory for temporary files during uploads.
- **resDir**: The directory which contains the compiled resources and images.
- **srcDir**: The directory which contains the html/js/css sources.

###TLS options
These files are passed directly to [node's tls](http://nodejs.org/api/tls.html#tls_tls_createserver_options_secureconnectionlistener) and are used when **useHTTPS** is enabled.
- **key**: Path to your private key.
- **cert**: Path to your main certificate.
- **ca**: Path to any intermediate or root certificates you'd like to provide. These are served in the order defined in this array (or string in case of a single cert).

##Supported Browsers
- Firefox (last 2 versions)
- Chrome (last 2 versions)
- Internet Explorer 10 or higher

In case of Firefox and Chrome older version may still work, but I'm not targeting CSS code at them.

##Systemd
If you'd like to run droppy as a systemd service, there's a sample service file provided in `examples/droppy.service`