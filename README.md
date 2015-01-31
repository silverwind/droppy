# droppy [![NPM version](https://img.shields.io/npm/v/droppy.svg?style=flat)](https://www.npmjs.org/package/droppy) [![Dependency Status](http://img.shields.io/david/silverwind/droppy.svg?style=flat)](https://david-dm.org/silverwind/droppy) [![Downloads per month](http://img.shields.io/npm/dm/droppy.svg?style=flat)](https://www.npmjs.org/package/droppy)

droppy is a self-hosted file server with an interface similar to many desktop file managers and has capabilites to edit files on-the-fly as well as view and playback media directly in the browser. It focuses on performance and intuitive usage, and can be run directly as a web server, optionally with strong SSL/TLS encryption and SPDY support. To minimize latency, most communication is done exclusively through WebSockets. A demo is available <a target="_blank" href="http://droppy-demo.silverwind.io/#/">here</a>.

### Features
* Multi-file and folder upload
* Share public download links
* Zip download of folders
* Image and video gallery, audio player
* Fullscreen support
* Drag and drop and swipe gesture support
* Realtime updates through WebSockets
* Edit text files in a customized CodeMirror
* Node.js/io.js backend, responsive HTML5 frontend
* Optimized for performance

### Installation
```
$ [sudo] npm install -g droppy
$ droppy start
```
By default, droppy's home folder will be created in `~/.droppy`. For how to change this path, as well as other options, see `droppy help`. To edit the config, run `droppy config` after the server has started up at least once to generate the config file.

Once intialized, the server will listen on [http://localhost:8989/](http://localhost:8989/). On first startup, a prompt for a username and password for the first account will appear.

Optionally, droppy can also be ran behind any reverse proxy, as long as WebSockets are supported. For examples of an fitting nginx configuration, see the guides for [debian](https://github.com/silverwind/droppy/wiki/Debian-Installation) or [systemd](https://github.com/silverwind/droppy/wiki/Systemd-Installation) installations.

### Configuration
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
  "timestamps"   : true
}
```
### Options
#### `listeners` *array*
Defines one or more listening sockets defined by an [`listener` object](#listener). This option has no effect when droppy is used as a module.
#### `debug` *boolean*
When enabled, skips resource minification and enables CSS reloading.
#### `keepAlive` *integer*
The interval in milliseconds in which the server sends keepalive message over the websocket. These messages add some overhead but may be needed with proxies are involved. Set to `0` to disable keepalive messages.
#### `linkLength` *integer*
The amount of characters in a share link.
#### `logLevel` *integer*
The amount of logging to show. `0` is no logging, `1` is errors, `2` is info (HTTP requests), `3` is debug (Websocket communication).
#### `maxFileSize` *integer*
The maximum file size in bytes a user can upload in a single file.
#### `maxOpen` *integer*
The maximum number of concurrently opened files. This number should only be of concern on Windows.
#### `public` *boolean*
When enabled, no authentication is performed.
#### `readInterval` *integer*
The minimum time gap in milliseconds in which updates to a single directory are sent.
#### `timestamps` *boolean*
When enabled, adds timestamps to log output.

<a name="listener" />
### Listener Object
Below is an example `listeners` object, showing off the possibilties.

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
This will result in:
* HTTP listening on all IPv4 and IPv6 interfaces, port 80.
* HTTPS listening on all IPv4 interfaces, port 443, with 1 year of HSTS duration, using the provided SSL/TLS files.
* SPDY listening on all IPv6 interfaces, ports 1443 and 2443, with HSTS disabled, using a self-signed certificate.

A listener object accepts these options:
#### `host` *string* / *array*
Network interface(s) to listen on. Use an array for multiple hosts.
#### `port` *integer* / *array*
Port(s) to listen on. Use an array for multiple ports.
#### `protocol` *string*
Protocol to use. Can be either `http`, `https` or `spdy`.
#### `hsts` *integer*
Length of the [HSTS](http://en.wikipedia.org/wiki/HTTP_Strict_Transport_Security) header in seconds. Set to `0` to disable HSTS.
#### `key` *string*
Path to the SSL/TLS private key file.
#### `cert` *string*
Path to the SSL/TLS certificate file.
#### `ca` *string*
Path to the SSL/TLS intermediate certificate file.

*Note: SSL/TLS paths are relative to the home folder, but can be defined as absolute too. If your certificate file includes an intermediate certificate, it will be detected and used. There's no need to specify `ca` in this case.*

### API
droppy can be used with [express](http://expressjs.com/):
```js
var droppy = require("droppy"),
    app = require("express")();

app.use("/", droppy("/srv/droppy", { linkLength: 8 }));
app.listen(80);
```
#### droppy([home], [options])

All arguments are optional.

- **home** *string*: The path to droppy's home folder. Defaults to `~/.droppy`.
- **options** *object*: Custom [options](#Options). Extends [config.json](#Configuration).

Returns a middleware function, `function(req, res)`.

### **wget** compatibilty
For shared links to be compatible with wget, set `content-disposition = on` in `~/.wgetrc`.

© 2012-2015 [silverwind](https://github.com/silverwind), distributed under BSD licence