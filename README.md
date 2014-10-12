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
    "timestamps"   : true
}
```
Note: Options marked with [1] are not used when used as a module.

###Options
####`host` *string* / *array*
Network interface(s) to listen on.
####`port` *string* / *array*
Port(s) to listen on.
####`public` *boolean*
When enabled, no authentication is performed.
####`debug` *boolean*
When enabled, skips resource minification and enables CSS reloading.
####`timestamps` *boolean*
When enabled, adds timestamps to log output.
####`useTLS` *boolean*
When enabled, uses TLS encryption. When set, droppy will look for certificate files stored in `~/.droppy/config`: `tls.key`, `tls.cert`, `tls.ca`. If neither of these files are provided, droppy will use a self-signed certificate.
####`useSPDY` *boolean*
Enables the SPDYv3 protocol. Depends on `useTLS`.
####`useHSTS` *boolean*
Enables the [HSTS](https://en.wikipedia.org/wiki/HTTP_Strict_Transport_Security) header with 1 year caching time. Depends on `useTLS`.
####`readInterval` *integer*
The minimum time gap in milliseconds in which updates to a single directory are sent.
####`keepAlive` *integer*
The interval in milliseconds in which the server sends keepalive message over the websocket. These messages add some overhead but may be needed with proxies are involved. Set to `0` to disable keepalive messages.
####`linkLength` *integer*
The amount of characters in a shortlink.
####`logLevel` *integer*
The amount of logging to show. `0` is no logging, `1` is errors, `2` is info ( HTTP requests), `3` is debug (socket communication).
####`maxOpen` *integer*
The maximum number of concurrently opened files. This number should only be of concern on Windows.
####`maxFileSize` *integer*
The maximum file size in bytes a user can upload in a single file.
####`zipLevel` *interger*
The level of compression for zip files. Ranging from 0 (no compression) to 9 (maximum compression).

###API
####droppy([home], [options])

All arguments are optional.

- **home** *string*: The path to droppy's home folder. Defaults to `~/.droppy`.
- **options** *object*: Custom [options](#Options). Extends [config.json](#Configuration).

Returns a middleware function, `function(req, res)`.

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

###**wget** compatibilty
For shared links to be compatible with wget, set `content-disposition = on` in `~/.wgetrc`.

###LICENCE
BSD © [silverwind](https://github.com/silverwind)
