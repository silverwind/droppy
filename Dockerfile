FROM mhart/alpine-node:latest
MAINTAINER silverwind

# Install and build modules
RUN apk add --update-cache --no-cache --virtual deps curl make gcc g++ python git && \
  # add yarn
  mkdir -p /opt && \
  curl -sL https://yarnpkg.com/latest.tar.gz | tar xz -C /opt && \
  mv /opt/dist /opt/yarn && \
  ln -s /opt/yarn/bin/yarn /usr/local/bin && \
  # install global modules
  yarn global add droppy@latest dmn@latest --production --global-folder /yarn && \
  # cleanup node modules
  cd /yarn && \
  dmn clean -f && \
  yarn global remove dmn --global-folder /yarn && \
  # remove yarn
  rm -rf /root/.cache/yarn && \
  rm -rf /opt && \
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
  # remove npm
  npm uninstall -g npm && \
  rm -rf /root/.npm && \
  rm -rf /tmp/npm* && \
  rm -rf /root/.node-gyp && \
  # cleanup apk
  apk del --purge deps && \
  rm -rf /var/cache/apk/*

EXPOSE 8989
VOLUME ["/config", "/files"]
CMD ["/yarn/node_modules/droppy/docker-start.sh"]
