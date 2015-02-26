# droppy [![NPM version](https://img.shields.io/npm/v/droppy.svg?style=flat)](https://www.npmjs.org/package/droppy) [![Dependency Status](http://img.shields.io/david/silverwind/droppy.svg?style=flat)](https://david-dm.org/silverwind/droppy) [![Downloads per month](http://img.shields.io/npm/dm/droppy.svg?style=flat)](https://www.npmjs.org/package/droppy)

droppy is a self-hosted file server with an interface similar to many desktop file managers and has capabilites to edit files on-the-fly as well as view and playback media directly in the browser. It focuses on performance and intuitive usage, and can be run directly as a web server, optionally with strong SSL/TLS encryption and SPDY support. To minimize latency, most communication is done exclusively through WebSockets. A demo is available <a target="_blank" href="http://droppy-demo.silverwind.io/#/">here</a>.

### Features
* Multi-file and folder upload
* Realtime updates through WebSockets
* Share public download links
* Zip download of folders
* Image and video gallery, audio player
* Fullscreen support for the media gallery
* Drag and drop and swipe gesture support
* Edit text files in a heavily customized CodeMirror
* Node.js/io.js backend, responsive HTML5 frontend

### Installation
```
$ [sudo] npm install -g droppy
$ droppy start
```
droppy's home folder will be created in `~/.droppy` unless the `--home` switch is provided.

By default the server listens on [http://localhost:8989/](http://localhost:8989/). On first startup, a prompt for username and password for the first account will appear.

### Configuration
Run `droppy config` to edit `config/config.json`, which is created with these defaults:
```javascript
{
  "listeners" : [
      {
          "host"     : "0.0.0.0",
          "port"     : 8989,
          "protocol" : "http"
      }
  ],
  "debug"          : false,
  "keepAlive"      : 20000,
  "linkLength"     : 5,
  "logLevel"       : 2,
  "maxFileSize"    : 0,
  "maxOpen"        : 256,
  "public"         : false,
  "timestamps"     : true,
  "updateInterval" : 1000
  "usePolling"     : false
}
```
### Options
- `listeners` {Array} - Defines on which interfaces, port and protocols the server will listen. See the details of the [listener object](#listener-object) below. `listeners` has no effect when droppy is used as a module.
- `debug` {Boolean} - When enabled, skips resource minification and enables CSS reloading.
- `keepAlive` {Number} - The interval in milliseconds in which the server sends keepalive message over the websocket. These messages add some overhead but may be needed with proxies are involved. Set to `0` to disable keepalive messages.
- `linkLength` {Number} - The amount of characters in a share link.
- `logLevel` {Number} - Logging amount. `0` is no logging, `1` is errors, `2` is info (HTTP requests), `3` is debug (Websocket communication).
- `maxFileSize` {Number} - The maximum file size in bytes a user can upload in a single file.
- `maxOpen` {Number} - The maximum number of concurrently opened files. This number should only be of concern on Windows.
- `public` {Boolean} - When enabled, no authentication is performed.
- `timestamps` {Boolean} - When enabled, adds timestamps to log output.
- `updateInterval` {Number} - Interval in which a single client can receive updates through changes in the file tree, in milliseconds.
- `usePolling` {Boolean} - On certain conditions (home mounted through NFS, or running on hosted node), realtime updates may not work. This switch should make it more reliable in these cases, at the cost of CPU cycles.

<a name="listener-object" />
### Listener Object

`listeners` defines on which interfaces, ports and protcol the server will listen. For example:

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
        "ca"       : "config/tls.ca",
        "dhparam"  : "config/tls.dhparam"
    }
]
```
The above configuration will result in:
- HTTP listening on all IPv4 and IPv6 interfaces, port 80.
- HTTPS listening on all IPv4 interfaces, port 443, with 1 year of HSTS duration, using the provided SSL/TLS files.

A listener object accepts these options:
- `host` {String/Array} - Network interface(s) to listen on. Use an array for multiple interfaces.
- `port` {Number/Array} - Port(s) to listen on. Use an array for multiple ports.
- `protocol` {String} - Protocol to use, `http` or `https`. `https` includes SPDY through NPN.
- `hsts` {Number} - Length of the [HSTS](http://en.wikipedia.org/wiki/HTTP_Strict_Transport_Security) header in seconds. Set to `0` to disable HSTS.
- `key` {String} - Path to the SSL/TLS private key file. If ommitted, uses self-generated key.
- `cert` {String} - Path to the SSL/TLS certificate file. If ommitted, uses self-signed certificate.
- `ca` {String} - Path to the SSL/TLS intermediate certificate file. Optional.
- `dhparam` {String} - Path to the SSL/TLS Diffie Hellman parameters file. Optional. If ommitted, new 2048 bit parameters will created and saved for later use.

*Note: SSL/TLS paths are relative to the home folder, but can be defined as absolute too. If your certificate file includes an intermediate certificate, it will be detected and used. There's no need to specify `ca` in this case.*

### API
droppy can be used as a module, for example with [express](http://expressjs.com/):
```js
var app    = require("express")();
var droppy = require("droppy")("droppy", {logLevel: 0});

app.use("/", droppy).listen(8989);
```
#### droppy([home], [options])
- **home** {string}: The path to droppy's home folder. Defaults to `~/.droppy`.
- **options** {object}: Custom [options](#Options). Extends [config.json](#Configuration).

Returns `function onRequest(req, res)`. All arguments are optional.

### Proxying
droppy can run behind a reverse proxy as long as WebSockets are passing through. For examples of an fitting nginx configuration, see the guides for [debian](https://github.com/silverwind/droppy/wiki/Debian-Installation) or [systemd](https://github.com/silverwind/droppy/wiki/Systemd-Installation).

### wget
For correct filenames of shared links, use `--content-disposition` or add this to `~/.wgetrc`:

```ini
content-disposition = on
```

© 2012-2015 [silverwind](https://github.com/silverwind), distributed under BSD licence
