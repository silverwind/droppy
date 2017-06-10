FROM mhart/alpine-node:latest
MAINTAINER silverwind

# Install and build modules
RUN apk add --update-cache --no-cache --virtual deps curl make gcc g++ python git && \
  # install global modules
  yarn global add droppy@latest --production --global-folder /yarn && \
  # remove yarn
  rm -rf /usr/local/share/yarn && \
  rm -rf /usr/local/bin/yarn && \
  rm -rf /usr/local/bin/yarnpkg && \
  rm -rf /usr/local/share/.cache && \
  # remove npm
  npm uninstall -g npm && \
  rm -rf /root/.npm && \
  rm -rf /tmp/npm* && \
  rm -rf /root/.node-gyp && \
  # remove caches
  rm -rf /tmp/v8* && \
  rm -rf /root/.config && \
  # fix permissions in /yarn which assumes root will start the app
  find /yarn -type d -exec chmod 0755 {} + && \
  find /yarn -type f -exec chmod 0644 {} + && \
  chmod 0755 /yarn/node_modules/droppy/docker-start.sh && \
  chmod 0755 /yarn/node_modules/droppy/droppy.js && \
  # remove unnecessary module files
  rm -rf /yarn/node_modules/uws/*darwin*.node && \
  rm -rf /yarn/node_modules/uws/*win32*.node && \
  rm -rf /yarn/node_modules/uws/*linux_4*.node && \
  rm -rf /yarn/node_modules/uws/build && \
  rm -rf /yarn/node_modules/lodash/fp && \
  rm -rf /yarn/node_modules/lodash/_* && \
  rm -rf /yarn/node_modules/lodash/*.min.js && \
  rm -rf /yarn/node_modules/lodash/core.js && \
  # cleanup apk cache
  apk del --purge deps && \
  rm -rf /var/cache/apk/*

EXPOSE 8989
VOLUME ["/config", "/files"]
CMD ["/yarn/node_modules/droppy/docker-start.sh"]
