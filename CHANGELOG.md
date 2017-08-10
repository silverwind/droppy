# droppy Changelog
*This changelog only lists breaking and otherwise notable changes. See the commit log for more details*

#### Version 6.8.0 - 10/08/2017

- Added the 'droppy stop' command to kill daemonized droppy processes.

#### Version 6.7.0 - 31/07/2017

- Added an option for the default state of the "Is DL" button on sharelinks.

#### Version 6.6.0 - 20/06/2017

- Redesigned top row buttons so each view now has their own set.
- When creating users on the command line, it's now possibly to specify if they are privileged.
- Changes users on the command line should be immediately be reflected on running instances.

#### Version 6.5.0 - 10/06/2017

- Pasting images and text from the clipboard to a directory will now automatically upload the contents to a new file.

#### Version 6.4.0 - 03/06/2017

- Added the `ignorePatterns` and `watch` options.

#### Version 6.3.0 - 22/3/2017

- Now using [plyr](https://github.com/Selz/plyr) for video playback.
- Added the overlay addon to CodeMirror, which allows syntax highlighting to work better with mixed language files.

#### Version 6.2.0 - 18/3/2017

- Added support for listening on unix domain sockets.

#### Version 6.1.0 - 18/3/2017

- Added the `compression` option which is enabled by default. It very unlikely that this needs to changed, even with a reverse proxy in place as compression does not incur a performance penalty. It is suggested to turn of compression in your reverse proxy's configuration.
- It is strongly recommended to set `X-Forwarded-Proto` in your reverse proxy configuration (see [the wiki](https://github.com/silverwind/droppy/wiki)) as a future version might explicitly require this header to be present for increased browser security.

#### Version 6.0.0 - 4/2/2017

- The previous `ca` option of TLS listeners has been removed. Intermediate certificates should be concatenated in the `cert` file instead.
- Added a new `passphrase` option to TLS listeners, which is used to decrypt encrypted keys.

#### Version 5.3.0 - 6/11/2016

- New buttons to zoom images so they fit horizontally or vertically, slight redesign.

#### Version 5.2.0 - 14/10/2016

- Media gallery rewritten. Cleaner transitions and zooming support.
- Known issue: Zooming on the second view may not target the right x coordinate.

#### Version 5.1.0 - 13/09/2016

- Added read-only mode through new `readOnly` config option.

#### Version 5.0.0 - 20/7/2016

- Node.js v4.0.0 or greater is now required.
- Yesterday's version contained a breaking change for Apache reverse proxying which, which leads to this version bump. Users running droppy behind Apache should update their configuration to proxy WebSocket request to /!/socket instead of /?socket:

````diff
  RewriteEngine On
- RewriteCond %{REQUEST_URI} ^/droppy [NC]
- RewriteCond %{QUERY_STRING} socket [NC]
+ RewriteCond %{REQUEST_URI} ^/droppy/!/socket [NC]
  RewriteRule /(.*) ws://127.0.0.1:8989/$1 [P,L]
````

#### Version 4.3.0 - 19/7/2016

- Shortlinks are now 1 character shorter, e.g. `/$/hash` instead of `/?$/hash`. Old links are still supported.
- Shortlinks are now invalidated when their length changes, e.g when link length changes from 5 to 6, all links with length of 5 will be invalidated and pruned after a short while.
- Implemented a new URL scheme for resources which among other benefits results in save-as on images delivering the correct file name.

#### Version 4.2.0 - 5/15/2016

- Added the `allowFrame` option to allow the site to be put into `<frame>` or `<iframe>`.

#### Version 4.1.0 - 4/14/2016

- Added UID and GID arguments for Docker deployments

#### Version 4.0.0 - 3/29/2016

- Changed default config directory from `~/.droppy` to `~/.droppy/config`. Please move the `.json` config files to this new directory for before upgrading local installations.
- Dropped support for having `files` inside the `config` (e.g. only specifying `--configdir` or the old `--home`). If `--filesdir` is unspecified it will now fall back to the default.
- Changed the Docker mount points inside the container. `/droppy-data/files` is now `/files`, `/droppy-data` is now `/config` to match the options.
- CTRL-C should now work when using `docker run` without `-d`.

#### Version 3.9.0 - 2/27/2016

- Brotli compression is now supported, resulting in around 15% faster initial load. Works in Firefox >= 44 and Chrome with a flag enabled.
- `dev` option is now documented.

#### Version 3.8.0 - 1/4/2016

- Docker image is now available as silverwind/droppy.
- Fixed a error on startup when in a NODE_ENV=production environment.

#### Version 3.7.0 - 12/19/2015

- Client data is now precompiled and published to npm, resulting in drastically reduced startup time after installing a new version.

#### Version 3.6.0 - 11/10/2015

- Node.js 0.10 is again supported

#### Version 3.5.0 - 10/12/2015

- Fixed a semi-critical CSFR vulnerability which allowed a attacker to use an authenticated user's session.
- Increased site security by enabling CSP and making cookies inaccessible for scripts.

#### Version 3.4.0 - 10/11/2015

- Added `pollingInterval` option and disabled file system polling by default. This reduces CPU usage to practically zero when idle. If you notice issues with files getting out of sync, you enable this option by setting a timeout of a few seconds.
- Increased minimum node.js version to 0.12.0, which was necessary for unicode normalization.

#### Version 3.3.0 - 10/11/2015

- File uploads can now take longer than 2 minutes. Proxy-specific timeouts may still apply. See the [`nginx.conf` template](https://github.com/silverwind/droppy/wiki/Nginx-reverse-proxy) for a suitable nginx configuration.

#### Version 3.2.0 - 9/21/2015

- Fix a security issue, all users are advised to upgrade.

#### Version 3.1.0 - 9/13/2015

- Fixed a bug where configuration could get lost when the server shuts down during a save operation.
- Extended the default self-signed certificate validity to 100 years.
- Prime generation for Perfect Forward Secrecy is now supported cross-platform.

#### Version 3.0.0 - 9/2/2015

- Deprecated `--home` option in favor of `--configdir` and `--filesdir`. The old option is still supported, but files in `<configdir>/config` will be migrated to `<configdir>`. If `--filesdir` is not given, it will default to `<configdir>/files`.
- The module API has been changed to not take a `home` option anymore. Instead, `options` now takes additional `configdir` and `filesdir`.
- Added `log` option to module API, which defines a log file.
- Empty directory and files in uploads are no longer supported because browsers and `busboy` were exhibiting all kinds of weird bugs when these were involved. They might return at a later stage, but for now, it's too much of a hack to keep supporting them.
