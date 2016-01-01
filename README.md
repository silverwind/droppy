# droppy [![](https://img.shields.io/npm/v/droppy.svg)](https://www.npmjs.org/package/droppy) [![](https://img.shields.io/badge/licence-bsd-blue.svg)](https://raw.githubusercontent.com/silverwind/droppy/master/LICENSE) [![](http://img.shields.io/npm/dm/droppy.svg)](https://www.npmjs.org/package/droppy)

droppy is a self-hosted file storage server with an interface similar to desktop file managers and has capabilites to edit files as well as view media directly in the browser. It focuses on performance and intuitive usage. It can run both standalone or through express. To provide realtime updates, most communication is done through WebSockets. A demo is available <a target="_blank" href="https://droppy.silverwind.io">here</a>.

### Features
* Fully responsive HTML5 interface
* Multi-file and folder upload
* Realtime updates of changes
* Share public download links
* Zip download of folders
* Image and video gallery, audio player
* Drag & drop and swipe gesture support
* Fullscreen support
* Edit text files in a heavily customized CodeMirror
* Supports latest node.js/io.js (min: 0.10) and all modern browsers

### Install
```
$ [sudo] npm install -g droppy
$ droppy start
```
Alternatively, `git` can be used to install to a non-global location:
```
$ git clone https://github.com/silverwind/droppy.git
$ cd droppy
$ npm install
$ node droppy.js start
```

To store configuration and files, these two directories will be used:

- `~/.droppy`: configuration directory. Override with `--configdir <dir>`.
- `~/.droppy/files`: files directory. Override with `--filesdir <dir>`.

By default, the server listens on port 8989 on all interfaces. On first login, a prompt for username and password for the first account will appear. Additional accounts can be created in the options interface or the command line.

### Configure
Run `droppy config` to edit `config/config.json`, which is created with these defaults:
```javascript
{
  "listeners" : [
      {
          "host"     : ["0.0.0.0", "::"],
          "port"     : 8989,
          "protocol" : "http"
      }
  ],
  "public"          : false,
  "timestamps"      : true,
  "linkLength"      : 5,
  "logLevel"        : 2,
  "maxFileSize"     : 0,
  "updateInterval"  : 1000,
  "pollingInterval" : 0,
  "keepAlive"       : 20000
}
```
### Options
- `listeners` *Array* - Defines on which network interfaces, port and protocols the server will listen. See [listener options](#listener-options) below. `listeners` has no effect when droppy is used as a module.
- `public` *Boolean* - When enabled, no authentication is performed.
- `timestamps` *Boolean* - When enabled, adds timestamps to log output.
- `linkLength` *Number* - The amount of characters in a share link.
- `logLevel` *Number* - Logging amount. `0` is no logging, `1` is errors, `2` is info (HTTP requests), `3` is debug (Websocket communication).
- `maxFileSize` *Number* - The maximum file size in bytes a user can upload in a single file.
- `updateInterval` *Number* - Interval in milliseconds which a single client can receive update messages through changes in the file system.
- `pollingInterval` *Number* - Interval in milliseconds which the file system is polled for changes, which may be necessary on network drives and other non-standard situations. This is CPU-intensive! Corresponds to chokidar's [usePolling](https://github.com/paulmillr/chokidar#performance) option. Set to `0` to disable polling.
- `keepAlive` *Number* - Interval in milliseconds in which the server sends keepalive message over the websocket. These messages add some overhead but may be needed with proxies are involved. Set to `0` to disable keepalive messages.

<a name="listener-options" />
#### Listener Options

`listeners` defines on which interfaces, ports and protcol(s) the server will listen. For example:

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
        "key"      : "~/certs/tls.key",
        "cert"     : "~/certs/tls.crt",
        "ca"       : "~/certs/tls.ca",
        "dhparam"  : "~/certs/tls.dhparam",
        "hsts"     : 31536000
    }
]
```
The above configuration will result in:
- HTTP listening on all IPv4 and IPv6 interfaces, port 80.
- HTTPS listening on all IPv4 interfaces, port 443, with 1 year of HSTS duration, using the provided SSL/TLS files.

A listener object accepts these options:
- `host` *String/Array* - Network interface(s) to listen on. Required.
- `port` *Number/Array* - Network port(s) to listen on. Required.
- `protocol` *String* - Protocol to use, `http` or `https`. Required.

For SSL/TLS these additional options are available:
- `key` *String* - Path to PEM-encoded SSL/TLS private key file. Required.
- `cert` *String* - Path to PEM-encoded SSL/TLS certificate file. Required.
- `ca` *String* - Path to PEM-encoded SSL/TLS intermediate certificate file.
- `dhparam` *String* - Path to PEM-encoded SSL/TLS Diffie-Hellman parameters file. If not provided, new 2048 bit parameters will generated and saved for future use.
- `hsts` *Number* - Length of the [HSTS](http://en.wikipedia.org/wiki/HTTP_Strict_Transport_Security) header in seconds. Set to `0` to disable HSTS.

*Note: Unless given absolute, SSL/TLS paths are relative to the config folder. If your certificate file includes an concatenated intermediate certificate, it will be detected and used, there's no need to specify `ca` in this case.*

### API
droppy can be used with [express](https://github.com/strongloop/express) like this:
```js
var app    = require("express")();
var droppy = require("droppy")({
  configdir: "~/droppy/config"
  filesdir: "~/droppy/files",
  log: "~/droppy/log",
  logLevel: 0
});

app.use("/", droppy).listen(process.env.PORT || 8989);
```
See the [commented express example](https://github.com/silverwind/droppy/blob/master/examples/express.js) for a working example.

#### droppy([options])
- **options** {object}: [Options](#Options). Extends [config.json](#Configuration). In addition to above listed options, `configdir`, `filesdir` and `log` are present on the API.

Returns `function onRequest(req, res)`. All arguments are optional.

### Installation guides
- [Installation as systemd service](https://github.com/silverwind/droppy/wiki/Systemd-Installation)
- [Installation as debian initscript](https://github.com/silverwind/droppy/wiki/Debian-Installation)
- [Reverse proxying through nginx](https://github.com/silverwind/droppy/wiki/Nginx-reverse-proxy)

### Note about wget
For correct filenames of shared links, use `--content-disposition` or add this to `~/.wgetrc`:

```ini
content-disposition = on
```

### Note about startup performance
droppy is currently optimized for a moderate amount of files. To aid in performance, all directories are read into memory once on startup. The downside of this is that the startup will take considerable time on slow storage with hunderts of thousands of files present.

© [silverwind](https://github.com/silverwind), distributed under BSD licence.
