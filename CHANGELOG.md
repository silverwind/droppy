#### Version 3.0.0 - 7/2/2015

- Deprecated `--home` option in favor of `--configdir` and `--filesdir`. The old option is still supported, but files in `<configdir>/config` will be migrated to `<configdir>`. If `--filesdir` is not given, it will default to `<configdir>/files`.
- The module API has been changed to not take a `home` option anymore. Instead, `options` now takes additional `configdir` and `filesdir`.
- Added `log` option to module API, which defines a log file.
- Empty directory and files in uploads are no longer supported because browsers and `busboy` were exhibiting all kinds of weird bugs when these were involved. They might return at a later stage, but for now, it's too much of a hack to keep supporting them.
