FROM node:alpine
MAINTAINER silverwind

# Copy files
COPY ["client", "/droppy/client"]
COPY ["server", "/droppy/server"]
COPY ["dist", "/droppy/dist"]
COPY ["droppy.js", "index.js", "docker-start.sh", "README.md", "LICENSE", "package.json", "/droppy/"]

# Install build dependencies and and build modules
RUN cd /droppy && \
  npm install --production --no-package-lock --no-audit --no-bin-links --ignore-scripts && \
  find /droppy -type d -exec chmod 0755 {} + && \
  find /droppy -type f -exec chmod 0644 {} + && \
  chmod 0755 /droppy/docker-start.sh && \
  chmod 0755 /droppy/droppy.js && \
  mkdir -p /root/.droppy && \
  ln -s /config /root/.droppy/config && \
  ln -s /files /root/.droppy/files && \
  ln -s /droppy/droppy.js /usr/bin/droppy && \
  rm -rf \
    /droppy/node_modules/babel-polyfill \
    /droppy/node_modules/babel-runtime \
    /droppy/node_modules/core-js \
    /droppy/node_modules/moment/min \
    /droppy/node_modules/plyr/dist/*.map \
    /droppy/node_modules/plyr/src \
    /droppy/node_modules/raven-js \
    /root/.config \
    /root/.node-gyp \
    /root/.npm \
    /tmp/* \
    /usr/lib/node_modules \
    /usr/local/lib/node_modules \
    /usr/local/share/.cache

EXPOSE 8989
VOLUME ["/config", "/files"]
CMD ["/droppy/docker-start.sh"]
