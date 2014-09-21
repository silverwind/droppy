#droppy [![NPM version](https://img.shields.io/npm/v/droppy.svg?style=flat)](https://www.npmjs.org/package/droppy) [![Dependency Status](http://img.shields.io/david/silverwind/droppy.svg?style=flat)](https://david-dm.org/silverwind/droppy) [![Downloads per month](http://img.shields.io/npm/dm/droppy.svg?style=flat)](https://www.npmjs.org/package/droppy)


> Personal file server with a modern web interface

###Features 
* Lightweight node.js backend, HTML5 frontend <img src="https://silverwind.github.io/droppy/logo.svg" width="240" height="240" align="right">
* Responsive Layout
* Realtime updating of all clients 
* Asynchronous uploads. Directory uploads in Chrome 
* Zip download of directories
* Edit text files in CodeMirror
* Share public shortlinks to files/folders
* Picture gallery, Video streaming, Audio player
* Drag and Drop support

Screenshots <a target="_blank" href="http://i.imgur.com/izxnfAN.png">#1</a>, <a target="_blank" href="http://i.imgur.com/Ziv79rJ.png">#2</a>, <a target="_blank" href="http://i.imgur.com/ISlCyuw.png">#3</a>. Also check out this <a target="_blank" href="http://droppy-demo.silverwind.io/#!/#!/">demo</a>.

###Standalone Usage
```bash
$ [sudo] npm install -g droppy
$ droppy start
```
This will install droppy's home folder to `~/.droppy`. Append `--home <home>` to the command to define this path yourself. Once ready, navigate to [http://localhost:8989/](http://localhost:8989/). On first startup, you'll be prompted for a username and password for your first account.

If you want to install a permanent server, follow the guides for [debian](https://github.com/silverwind/droppy/wiki/Debian-Installation) or [systemd](https://github.com/silverwind/droppy/wiki/Systemd-Installation).
###Module Usage - Express
droppy can be used with [express](http://expressjs.com/):
```js
var droppy = require("droppy"),
    app = require("express")();

app.use("/", droppy("/srv/droppy", { linkLength: 8 }));
app.listen(80);
```
###Configuration
`config.json` inside `~/.droppy/config` can be edited with `droppy config` or by hand and is created with these defaults:
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
    "public"       : false,
    "demoMode"     : false,
    "timestamps"   : true
}
```
Note: Options marked with [1] are not used when used as a module.

###Options
- `host`: The host address to listen on. Can take an array of hosts.
- `port`: The port to listen on. Can take an array of ports.
- `debug`: When enabled, skips resource minification and enables automatic CSS reloading when the source files change.
- `useTLS`: When enabled, the server should use SSL/TLS encryption. When set, droppy uses certificate files in `~/.droppy/config`, `tls.key`, `tls.cert`, `tls.ca`. Replace them with your real ones if you want to run TLS or SPDY.
- `useSPDY`: Enables the SPDYv3 protocol. Depends on `useTLS`.
- `useHSTS`: Enables the [HSTS](https://en.wikipedia.org/wiki/HTTP_Strict_Transport_Security) header with 1 year caching time. Depends on `useTLS`.
- `readInterval`: The minimum time gap in milliseconds in which updates to a single directory are sent.
- `keepAlive`: The interval in milliseconds in which the server sends keepalive message over the websocket. This obviously adds some overhead, but may be needed to keep clients connected when proxies are involved. Set to `0` to disable keepalive messages.
- `linkLength`: The amount of characters in a shortlink.
- `logLevel`: The amount of logging to show. `0` is no logging, `1` is errors, `2` is info ( HTTP requests), `3` is debug (socket communication).
- `maxOpen`: The maximum number of concurrently opened files. This number is primarily of concern for Windows servers.
- `maxFileSize`: The maximum file size in bytes a user can upload in a single file.
- `zipLevel`: The level of compression for zip files. Ranging from 0 (no compression) to 9 (maximum compression).
- `public`: When enabled, the client skips the user authentication.
- `demoMode`: When enabled, the server will regularly clean out all files and restore samples.
- `timestamps`: When enabled, adds timestamps to log output.

###API
####droppy([home], [options])

Returns an `onRequest` function, taking `req` and `res`. All arguments are optional.

- `home`: The path to droppy's home folder. Defaults to `~/.droppy`.
- `options`: The [options](#options) object. Defaults to the configuration object.

###CLI
For available CLI commands see
```bash
$ droppy help
```
To update droppy, run
```bash
$ [sudo] droppy update
```

###Browser Support
Regular testing is done on Firefox, Chrome and Safari on Desktops as well as Chrome and Firefox on Android. IE receives very limited testing, and 10 is required for basic functionality. IOS Safari is largely untested, but should work reasonably well.

###ProTips
- For shortlinks to be compatible with `wget`, set `content-disposition = on` in `~/.wgetrc`.
