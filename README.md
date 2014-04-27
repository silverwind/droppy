#droppy <a href="https://npmjs.org/package/droppy"><img src="https://badge.fury.io/js/droppy@2x.png" alt="NPM version" height="18"></a>
Personal cloud storage, running on node.js. Demos available: [ #1](http://droppy-demo.silverwind.io/#/) (Heroku) [ #2](http://droppy-demo-2.silverwind.io/#/) (Nodejitsu).

![Main View](http://i.imgur.com/izxnfAN.png)
![Editor](http://i.imgur.com/Ziv79rJ.png)
![Images](http://i.imgur.com/ISlCyuw.png)

###Features
* Lightweight. Performs great, even on a Raspberry Pi.
* Fully responsive, mobile-ready CSS.
* Realtime updating of all connected clients via WebSockets.
* Asynchronous multi-file uploads. Recursive directory uploads in Chrome.
* Download directories as ZIPs.
* Edit text-based files in CodeMirror, a feature-rich editor.
* Basic file system operations: Cut, Copy, Rename, Delete, Create directory.
* Drag and Drop support for uploads and filesystem operations. Hold CMD/CTRL to copy, Shift to move.
* Playback of audio and video files [supported](https://developer.mozilla.org/en-US/docs/HTML/Supported_media_formats#Browser_compatibility) by the `<audio>` and `<video>` elements.
* Support for shortened links to share file downloads with your friends without them needing to log in.

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
By default, the server will listen on [port 8989](http://localhost:8989/). On first startup, you'll be prompted for a username and password for your first account. To list, add or remove accounts, either use the configuration dialog or see `node droppy help`.

##Configuration
Configuration is done through `config.json`, which is created on the first run, with these defaults:
````javascript
{
    "debug"        : false,
    "useTLS"       : false,
    "useSPDY"      : false,
    "useHSTS"      : false,
    "listenHost"   : "0.0.0.0",
    "listenPort"   : 8989,
    "readInterval" : 250,
    "keepAlive"    : 20000,
    "linkLength"   : 3,
    "logLevel"     : 2,
    "maxOpen"      : 256,
    "maxFileSize"  : 0,
    "zipLevel"     : 1,
    "noLogin"      : false,
    "demoMode"     : false,
    "timestamps"   : true,
    "db"           : "./db.json",
    "filesDir"     : "./files/",
    "tempDir"      : "./temp/",
    "tlsKey"       : "./key.pem",
    "tlsCert"      : "./cert.pem",
    "tlsCA"        : "./ca.pem"
}
````
###General options
- `debug`: Skip resource minification and enable automatic CSS reloading when the source files change.
- `useTLS`: Whether the server should use SSL/TLS encryption.
- `useSPDY`: Enables the SPDYv3 protocol. Depends on `useTLS`.
- `useHSTS`: Enables the [HSTS](https://en.wikipedia.org/wiki/HTTP_Strict_Transport_Security) header with 1 year caching time. Depends on `useTLS`.
- `listenHost`: The host address to listen on.
- `listenPort`: The port to listen on.
- `readInterval`: The minimum time gap in milliseconds in which updates to a single directory are sent.
- `keepAlive`: The interval in milliseconds in which the server sends keepalive message over the websocket. This obviously adds some overhead, but may be needed to keep clients connected when proxies are involved. Set to `0` to disable keepalive messages.
- `linkLength`: The amount of characters in a shortlink.
- `logLevel`: The amount of logging to show. `0` is no logging, `1` is errors, `2` is info ( HTTP requests), `3` is debug (socket communication).
- `maxOpen`: The maximum number of concurrently opened files. This number is primarily of concern for Windows servers.
- `maxFileSize`: The maximum file size in bytes a user can upload in a single file.
- `zipLevel`: The level of compression for zip files. Ranging from 0 (no compression) to 9 (maximum compression).
- `noLogin`: When enabled, the client skips the login page, making the server essentially public.
- `demoMode`: When enabled, the server will regularly clean out all files and restore samples.
- `timestamps`: Adds timestamps to log output. Useful if your logging facility does not provide timestamps.

###Path options
- `db`: Location of the database file.
- `filesDir`: The directory which serves as the server's root.
- `tempDir`: The directory for temporary files during uploads.

###TLS options
These paths are passed directly to [node's tls](http://nodejs.org/api/tls.html#tls_tls_createserver_options_secureconnectionlistener) when `useTLS` is enabled. All files are required in PEM format.

- `tlsKey`: Path to your private key.
- `tlsCert`: Path to your certificate.
- `tlsCA`: An optional intermediate (CA) certificate.

##Supported Browsers
- Firefox (last 2 versions)
- Chrome (last 2 versions)
- Internet Explorer 10 or higher (not regularly tested)

In case of Firefox and Chrome older version may still work, but I'm not targeting CSS code at them.

##Systemd
If you'd like to run droppy as a systemd service, you can use this sample service file:

````ini
# systemd service file for droppy
# replace /path/to/droppy with your actual path and User/Group with the intended user to run as
[Unit]
Description=droppy
After=network.target

[Service]
ExecStart=/bin/env node /path/to/droppy/droppy.js --color
WorkingDirectory=/path/to/droppy/
Restart=always
StandardOutput=syslog
User=http
Group=http
SyslogIdentifier=droppy

[Install]
WantedBy=multi-user.target
````
