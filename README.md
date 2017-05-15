<p align="center">
  <img src="https://cdn.rawgit.com/silverwind/droppy/master/client/images/readme-logo.svg"/>
</p>
<p align="center">
  <a href="https://www.npmjs.org/package/droppy"><img src="https://img.shields.io/npm/v/droppy.svg"></a>
  <a href="https://raw.githubusercontent.com/silverwind/droppy/master/LICENSE"><img src="https://img.shields.io/badge/licence-bsd-blue.svg"></a>
  <a href="https://www.npmjs.org/package/droppy"><img src="https://img.shields.io/npm/dm/droppy.svg"></a>
  <a href="https://travis-ci.org/silverwind/droppy"><img src="https://api.travis-ci.org/silverwind/droppy.svg?style=flat"></a>
</p>

droppy is a self-hosted file storage server with a web interface and capabilites to edit files and view media directly in the browser. It is particularly well-suited to be run on low-end hardware like the Raspberry Pi.

## Features (try the <a target="_blank" href="https://droppy.silverwind.io">demo</a>)
* Fully responsive HTML5 interface
* Realtime updates of file system changes
* Directory upload support
* Drag & drop support for file operations
* Side-by-Side mode
* Shareable public download links
* Zip download of directories
* Powerful text editor with themes and broad language support
* Image and video gallery with full touch support
* Audio player with seek support
* Fullscreen support for editor and gallery
* Supports installing to the homescreen

## General Information
Two directories will be used. droppy is a well-behaved app and will not write anywhere else:

- `config`: defaults to `~/.droppy/config`, override with `-c /some/dir`
- `files`: default `~/.droppy/files` override with `-f /some/dir`

droppy maintains a in-memory representation of the `files` directory. If you're on slow storage and/or serving 100k+ files, the indexing on startup will take some time.

## Installation
### Local Installation :package:
With [`Node.js`](https://nodejs.org) >= 4.0.0 installed, run:

```sh
$ sudo npm install -g droppy
$ droppy start -c /srv/droppy/config -f /srv/droppy/files
```
To update, run

```sh
$ sudo npm update -g droppy
```

### Docker installation :whale:

To pull [the image](https://hub.docker.com/r/silverwind/droppy/) and start the container:
```sh
$ docker run --name droppy -p 127.0.0.1:8989:8989 silverwind/droppy
```
This method uses automatic volumes for `/config` and `/files` which can be overridden through `-v /srv/droppy/config:/config` and `-v /srv/droppy/files:/files`. If you're using existing files, it's advisable to use `-e UID=1000 -e GID=1000` to get new files written with correct ownership.

To update a docker installation, run
```sh
$ docker pull silverwind/droppy
$ docker stop droppy && docker rm droppy
$ docker run --name droppy -p 127.0.0.1:8989:8989 silverwind/droppy
```

### docker-compose
Alternatively, you can use the example [`docker-compose.yml`](https://github.com/silverwind/droppy/blob/master/examples/docker-compose.yml):

```sh
$ curl -O https://raw.githubusercontent.com/silverwind/droppy/master/examples/docker-compose.yml
$ docker-compose up
```
This example `docker-compose.yml` uses the subdirectories `config` and `files` of the current working directory for storing data.

## Configuration
By default, the server listens on all IPv4 and IPv6 interfaces on port 8989. On first startup, a prompt to create login data for the first account will appear. Once it's created, login credentials are enforced. Additional accounts can be created in the options interface or the command line. Configuration is done in `config/config.json`, which is created with these defaults:

```javascript
{
  "listeners" : [
    {
      "host": ["0.0.0.0", "::"],
      "port": 8989,
      "protocol": "http"
    }
  ],
  "public": false,
  "timestamps": true,
  "linkLength": 5,
  "logLevel": 2,
  "maxFileSize": 0,
  "updateInterval": 1000,
  "pollingInterval": 0,
  "keepAlive": 20000,
  "allowFrame": false,
  "readOnly": false
}
```

## Options
- `listeners` *Array* - Defines on which network interfaces, port and protocols the server will listen. See [listener options](#listener-options) below. `listeners` has no effect when droppy is used as a module.
- `public` *boolean* - When enabled, no user authentication is performed.
- `timestamps` *boolean* - When enabled, adds timestamps to log output.
- `linkLength` *number* - The amount of characters in a shared link.
- `logLevel` *number* - Logging amount. `0` is no logging, `1` is errors, `2` is info (HTTP requests), `3` is debug (Websocket communication).
- `maxFileSize` *number* - The maximum file size in bytes a user can upload in a single file.
- `updateInterval` *number* - Interval in milliseconds in which a single client can receive update messages through changes in the file system.
- `pollingInterval` *number* - Interval in milliseconds in which the file system is polled for changes, which is likely **necessary for files on external or network-mapped drives**. This is CPU-intensive! Corresponds to chokidar's [usePolling](https://github.com/paulmillr/chokidar#performance) option. `0` disables polling.
- `keepAlive` *number* - Interval in milliseconds in which the server sends keepalive message over the websocket, which may be necessary with proxies. `0` disables keepalive messages.
- `allowFrame` *boolean* - Allow the page to be loaded into a `<frame>` or `<iframe>`.
- `readOnly` *boolean* - All served files will be treated as being read-only.
- `compression` *boolean* - Whether to serve brotli/gzip compressed static content. Default: `true`. Note that compression incurs no performance penalty because pre-compressed artifacts are included in the distribution.
- `dev` *boolean* - Enable developer mode, skipping resource minification and enabling live reload.

<a name="listener-options"></a>
### Listener Options

`listeners` defines on which network interfaces, ports and protocol(s) the server will listen. For example:

```javascript
"listeners": [
  {
    "host": [ "0.0.0.0", "::" ],
    "socket": "/tmp/droppy",
    "port": 80,
    "protocol": "http"
  },
  {
    "host": "0.0.0.0",
    "port": 443,
    "protocol": "https",
    "key": "~/certs/example.com.key",
    "cert": "~/certs/example.com.crt",
    "dhparam": "~/certs/example.com.dh",
    "hsts": 31536000
  }
]
```
The above configuration will result in:

- HTTP listening on all IPv4 and IPv6 interfaces, port 80 and on the unix domain socket `/tmp/droppy`.
- HTTPS listening on all IPv4 interfaces, port 443, with 1 year of HSTS duration, using the provided TLS files.

A listener object accepts these options:

- `host` *string/Array* - Network interface(s) to listen on. Required when `port` is given.
- `port` *number/string/Array* - Network port(s) to listen on. Required when `host` is given.
- `socket` *string/Array* - Unix domain socket(s) to listen on.
- `protocol` *string* - Protocol to use, `http` or `https`. Required.

For TLS the following additional options are available. Paths can be given relative to the configuration directory and `~` is resolved as expected.

- `cert` *string* - Path to PEM-encoded TLS certificate file, which can include additional intermediate certificates concatenated after the main certificate. Required.
- `key` *string* - Path to PEM-encoded TLS private key file. Required.
- `dhparam` *string* - Path to PEM-encoded TLS Diffie-Hellman parameters file. If not provided, new 2048 bit parameters will generated on launch and saved for future use.
- `passphrase` *string* - Passphrase for the TLS private key in case it is encrypted.
- `hsts` *number* - Length of the [HSTS](http://en.wikipedia.org/wiki/HTTP_Strict_Transport_Security) header in seconds. Set to `0` to disable HSTS.

## API
droppy can be used with frameworks like [express](https://github.com/strongloop/express):
```js
var app    = require("express")();
var droppy = require("droppy")({
  configdir: "~/droppy/config"
  filesdir: "~/droppy/files",
  log: "~/droppy/log",
  logLevel: 0
});

app.use("/", droppy);
app.listen(process.env.PORT || 8989);
```
See the [express example](https://github.com/silverwind/droppy/blob/master/examples/express.js) for a working example.

### droppy([options])
- `options` *Object*: [Options](#Options). Extends [config.json](#Configuration). In addition to above listed options, `configdir`, `filesdir` and `log` are present on the API.

Returns `function onRequest(req, res)`. All arguments are optional.

## Additional Installation guides
- [Systemd-based distributions](https://github.com/silverwind/droppy/wiki/Systemd-Installation)
- [Debian (Pre-Jessie)](https://github.com/silverwind/droppy/wiki/Debian-Installation-(Pre-Jessie))
- [Nginx reverse proxy](https://github.com/silverwind/droppy/wiki/Nginx-reverse-proxy)
- [Apache reverse proxy](https://github.com/silverwind/droppy/wiki/Apache-reverse-proxy)

## Downloading from the command line
To download shared links with `curl` and `wget` to the correct filename:
````sh
$ curl -OJ url
$ wget --content-disposition url
````

# Development
To start a live-reloading dev server:
````sh
$ git clone https://github.com/silverwind/droppy && cd droppy
$ npm i
$ node droppy start --dev
````
The [Makefile](https://github.com/silverwind/droppy/blob/master/Makefile) has a few tasks for updating dependencies, pushing docker images, see the comment above for dependencies of those tasks.

© [silverwind](https://github.com/silverwind), distributed under BSD licence.
