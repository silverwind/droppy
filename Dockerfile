FROM alpine
MAINTAINER silverwind

# Copy files
COPY ["client", "/droppy/client"]
COPY ["server", "/droppy/server"]
COPY ["dist", "/droppy/dist"]
COPY ["droppy.js", "index.js", "docker-start.sh", "README.md", "LICENSE", "package.json", "/droppy/"]

# Install build dependencies and and build modules
RUN apk add --update-cache --no-cache --virtual deps curl make gcc g++ python git yarn && \
  apk add --no-cache nodejs && \
  cd /droppy && \
  yarn install --non-interactive --no-progress --prod --no-lockfile && \
  rm -rf /usr/local/share/yarn && \
  rm -rf /usr/local/bin/yarn && \
  rm -rf /usr/local/bin/yarnpkg && \
  rm -rf /usr/local/share/.cache && \
  rm -rf /usr/lib/node_modules && \
  rm -rf /root/.npm && \
  rm -rf /tmp/npm* && \
  rm -rf /root/.node-gyp && \
  rm -rf /tmp/v8* && \
  rm -rf /root/.config && \
  find /droppy -type d -exec chmod 0755 {} + && \
  find /droppy -type f -exec chmod 0644 {} + && \
  chmod 0755 /droppy/docker-start.sh && \
  chmod 0755 /droppy/droppy.js && \
  rm -rf /droppy/node_modules/uws/*darwin*.node && \
  rm -rf /droppy/node_modules/uws/*win32*.node && \
  rm -rf /droppy/node_modules/uws/*linux_4*.node && \
  rm -rf /droppy/node_modules/uws/src && \
  rm -rf /droppy/node_modules/uws/build && \
  rm -rf /droppy/node_modules/lodash/fp && \
  rm -rf /droppy/node_modules/lodash/_* && \
  rm -rf /droppy/node_modules/lodash/*.min.js && \
  rm -rf /droppy/node_modules/lodash/core.js && \
  rm -rf /droppy/node_modules/plyr/dist/*.map && \
  apk del --purge deps && \
  rm -rf /var/cache/apk/* && \
  mkdir -p /root/.droppy && \
  ln -s /config /root/.droppy/config && \
  ln -s /files /root/.droppy/files && \
  ln -s /droppy/droppy.js /usr/bin/droppy

EXPOSE 8989
VOLUME ["/config", "/files"]
CMD ["/droppy/docker-start.sh"]
