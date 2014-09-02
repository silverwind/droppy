#droppy [![NPM version](https://img.shields.io/npm/v/droppy.svg)](https://www.npmjs.org/package/droppy) [![Dependency Status](https://david-dm.org/silverwind/droppy.svg)](https://david-dm.org/silverwind/droppy)
> File server with a speedy web interface

###Features
* Lightweight. Performs great, even on a Raspberry Pi.
* Fully responsive, mobile-ready CSS.
* Realtime updating of all connected clients via WebSockets.
* Asynchronous multi-file uploads. Directory uploads in Chrome.
* Download directories as zips.
* Edit text files in CodeMirror, a full-featured editor.
* Share shortened links to files with your friends, without them needing to log in.
* View media (images, video) in a gallery, play audio in it's own player.
* File system operations: Cut, Copy, Rename, Delete, Create directory.
* Drag and Drop support uploads and filesystem operations.

Screenshots <a target="_blank" href="http://i.imgur.com/izxnfAN.png">#1</a>, <a target="_blank" href="http://i.imgur.com/Ziv79rJ.png">#2</a>, <a target="_blank" href="http://i.imgur.com/ISlCyuw.png">#3</a>. Also check out this <a target="_blank" href="http://droppy-demo.silverwind.io/#!/#!/">demo</a>.

###Standalone Usage
```bash
$ [sudo] npm install -g droppy
$ droppy start
```
This will install droppy's home folder to `~/.droppy`. Once the server is ready, navigate to [http://localhost:8989/](http://localhost:8989/). On first startup, you'll be prompted for a username and password for your first account.

There's a few more CLI commands available, see
```bash
$ droppy help
```
To update droppy, run
```bash
$ [sudo] droppy update
```
###Module Usage - Express
You can use droppy as an [express](http://expressjs.com/) middleware:
```js
var express = require("express"),
    droppy  = require("droppy"),
    app     = express();

app.use("/", droppy(home, [options]));
app.listen(80, function() {
    console.log("Listening on 0.0.0.0:80.");
});
```
- `home`: The path to droppy's home folder. Will be created if necessary.
- `options`: An optional [options](#options) object.
##Configuration
`config.json` is created in the home folder with these defaults:
```javascript
{
    "host"         : "0.0.0.0",         // [1]
    "port"         : 8989,              // [1]
    "debug"        : false,
    "useTLS"       : false,             // [1]
    "useSPDY"      : false,             // [1]
    "useHSTS"      : false,             // [1]
    "readInterval" : 250,
    "keepAlive"    : 20000,
    "linkLength"   : 3,
    "logLevel"     : 2,
    "maxOpen"      : 256,
    "maxFileSize"  : 0,
    "zipLevel"     : 1,
    "noLogin"      : false,
    "demoMode"     : false,
    "timestamps"   : true
}
```
Note: Options marked with [1] are not used when used as a module.

###General options
- `port`: The port to listen on. Can take an array of ports.
- `host`: The host address to listen on. Can take an array of hosts.
- `debug`: Skip resource minification and enable automatic CSS reloading when the source files change.
- `useTLS`: Whether the server should use SSL/TLS encryption. When set, droppy uses certificate files in `~/.droppy/config`, `tls.key`, `tls.cert`, `tls.ca`. Replace them with your real ones if you want to run TLS or SPDY.
- `useSPDY`: Enables the SPDYv3 protocol. Depends on `useTLS`.
- `useHSTS`: Enables the [HSTS](https://en.wikipedia.org/wiki/HTTP_Strict_Transport_Security) header with 1 year caching time. Depends on `useTLS`.
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

###Supported Browsers
- Firefox (last 2 versions)
- Chrome (last 2 versions)
- Internet Explorer 10 or higher (not regularly tested)

###Installation as a daemon/service
- [Debian](//github.com/silverwind/droppy/wiki/Debian-Installation)
- [Systemd](//github.com/silverwind/droppy/wiki/Systemd-Installation)

###ProTips
- For shortlinks to be compatible with `wget`, set `content-disposition = on` in `~/.wgetrc`.
- Listen on ports < 1024 as regular user `setcap 'cap_net_bind_service=+ep' $(which node)`
