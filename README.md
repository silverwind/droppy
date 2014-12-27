#droppy [![NPM version](https://img.shields.io/npm/v/droppy.svg?style=flat)](https://www.npmjs.org/package/droppy) [![Dependency Status](http://img.shields.io/david/silverwind/droppy.svg?style=flat)](https://david-dm.org/silverwind/droppy) [![Downloads per month](http://img.shields.io/npm/dm/droppy.svg?style=flat)](https://www.npmjs.org/package/droppy)
> Personal file server with a modern web interface

Demo available <a target="_blank" href="http://droppy-demo.silverwind.io/#/">here</a>.

###Features
* Lightweight node.js backend, HTML5 frontend <img src="https://silverwind.github.io/droppy/logo.svg" width="240" height="240" align="right">
* Responsive layout
* Realtime updating of all clients
* Async uploads, folder uploads in supported browsers
* Zip download of folders
* Edit text-based files in CodeMirror
* Share public download links to files and folders
* Image and video gallery, audio player
* Drag and drop support for gallery and move/copy operations

###Standalone Usage
```
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
`config.json` inside `~/.droppy/config` can be edited by running `droppy config` and is created with these defaults:
```javascript
{
  "listeners" : [
      {
          "host"     : "0.0.0.0",
          "port"     : 8989,
          "protocol" : "http"
      }
  ],
  "debug"        : false,
  "keepAlive"    : 20000,
  "linkLength"   : 5,
  "logLevel"     : 2,
  "maxFileSize"  : 0,
  "maxOpen"      : 256,
  "public"       : false,
  "readInterval" : 250,
  "timestamps"   : true,
  "zipLevel"     : 1
}
```
###Options
####`listeners` *array*
Defines one or more listening sockets defined by an [`listener` object](#listener). This option has no effect when droppy is used as a module.
####`debug` *boolean*
When enabled, skips resource minification and enables CSS reloading.
####`keepAlive` *integer*
The interval in milliseconds in which the server sends keepalive message over the websocket. These messages add some overhead but may be needed with proxies are involved. Set to `0` to disable keepalive messages.
####`linkLength` *integer*
The amount of characters in a share link.
####`logLevel` *integer*
The amount of logging to show. `0` is no logging, `1` is errors, `2` is info (HTTP requests), `3` is debug (Websocket communication).
####`maxFileSize` *integer*
The maximum file size in bytes a user can upload in a single file.
####`maxOpen` *integer*
The maximum number of concurrently opened files. This number should only be of concern on Windows.
####`public` *boolean*
When enabled, no authentication is performed.
####`readInterval` *integer*
The minimum time gap in milliseconds in which updates to a single directory are sent.
####`timestamps` *boolean*
When enabled, adds timestamps to log output.
####`zipLevel` *integer*
The level of compression for zip files. Ranging from `0` (no compression) to `9` (maximum compression).

<a name="listener" />
###Listener Object
Below is an example `listeners` object, showing off the possibilties.

This will result in:
* HTTP listening on all IPv4 and IPv6 interfaces, port 80.
* HTTPS listening on all IPv4 interfaces, port 443, with 1 year of HSTS duration, using the provided SSL/TLS files.
* SPDY listening on all IPv6 interfaces, ports 1443 and 2443, with HSTS disabled, using a self-signed certificate.

```javascript
"listeners": [
    {
        "host"     : [ "0.0.0.0", "::" ],
        "port"     : 80,
        "protocol" : "http"
    },
    {
        "host"     : "0.0.0.0",
        "port"     : 443,
        "protocol" : "https",
        "hsts"     : 31536000,
        "key"      : "config/tls.key",
        "cert"     : "config/tls.crt",
        "ca"       : "config/tls.ca"
    },
    {
        "host"     : "::",
        "port"     : [1443, 2443],
        "protocol" : "spdy",
        "hsts"     : 0
    }
]
```

A listener object accepts these options:
####`host` *string* / *array*
Network interface(s) to listen on. Use an array for multiple hosts.
####`port` *integer* / *array*
Port(s) to listen on. Use an array for multiple ports.
####`protocol` *string*
Protocol to use. Can be either `http`, `https` or `spdy`.
####`hsts` *integer*
Length of the [HSTS](http://en.wikipedia.org/wiki/HTTP_Strict_Transport_Security) in seconds. Set to `0` to disable HSTS.
####`key` *string*
Path to the SSL/TLS private key file.
####`cert` *string*
Path to the SSL/TLS certificate file.
####`ca` *string*
Path to the SSL/TLS intermediate certificate file.

*Note: SSL/TLS paths are relative to the home folder, but can be defined as absolute too. If your certificate file includes an intermediate certificate, it will be detected and used. There's no need to specify `ca` in this case.*

###API
####droppy([home], [options])

All arguments are optional.

- **home** *string*: The path to droppy's home folder. Defaults to `~/.droppy`.
- **options** *object*: Custom [options](#Options). Extends [config.json](#Configuration).

Returns a middleware function, `function(req, res)`.

###CLI
For available CLI commands see
```
$ droppy help
```
To update droppy, run
```
$ [sudo] droppy update
```

###Browser Support
Regular testing is done on Firefox, Chrome and Safari on Desktops as well as Chrome and Firefox on Android. IE receives very limited testing, and 10 is required for basic functionality. IOS Safari is largely untested, but should work reasonably well.

###**wget** compatibilty
For shared links to be compatible with wget, set `content-disposition = on` in `~/.wgetrc`.

###LICENCE
BSD © [silverwind](https://github.com/silverwind)
