#### Version 3.1.0 - 9/13/2015

- Fixed a bug where configuration could get lost when the server shuts down during a save operation.
- Extended the default self-signed certificate validity to 100 years.
- Prime generation for Perfect Forward Secrecy is now supported cross-platform.

#### Version 3.0.0 - 9/2/2015

- Deprecated `--home` option in favor of `--configdir` and `--filesdir`. The old option is still supported, but files in `<configdir>/config` will be migrated to `<configdir>`. If `--filesdir` is not given, it will default to `<configdir>/files`.
- The module API has been changed to not take a `home` option anymore. Instead, `options` now takes additional `configdir` and `filesdir`.
- Added `log` option to module API, which defines a log file.
- Empty directory and files in uploads are no longer supported because browsers and `busboy` were exhibiting all kinds of weird bugs when these were involved. They might return at a later stage, but for now, it's too much of a hack to keep supporting them.
