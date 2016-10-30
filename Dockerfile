FROM mhart/alpine-node:latest
MAINTAINER silverwind

# Install and build modules
RUN apk add --update-cache --no-cache make gcc g++ python git && \
  npm install --production -g droppy@latest dmn && \
  cd /usr/lib/node_modules/droppy && \
  dmn clean -f && \
  npm uninstall -g dmn npm && \
  rm -rf /root/.npm && \
  rm -rf /tmp/npm* && \
  rm -rf /usr/lib/node_modules/droppy/node_modules/uws/*darwin*.node && \
  rm -rf /usr/lib/node_modules/droppy/node_modules/uws/*win32*.node && \
  rm -rf /usr/lib/node_modules/droppy/node_modules/uws/build && \
  rm -rf /usr/lib/node_modules/droppy/node_modules/lodash/fp && \
  apk del --purge make gcc g++ python git && \
  rm -rf /var/cache/apk/*

EXPOSE 8989
VOLUME ["/config", "/files"]
CMD ["/usr/lib/node_modules/droppy/docker-start.sh"]
