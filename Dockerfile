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
  yarn global add droppy@latest dmn@latest --production && \
  # cleanup node modules
  cd /root/.config/yarn/global && \
  dmn clean -f && \
  yarn global remove dmn && \
  # remove yarn
  rm -rf /root/.cache/yarn && \
  rm -rf /opt && \
  # remove unnecessary module files
  rm -rf /root/.config/yarn/global/node_modules/uws/*darwin*.node && \
  rm -rf /root/.config/yarn/global/node_modules/uws/*win32*.node && \
  rm -rf /root/.config/yarn/global/node_modules/uws/*linux_4*.node && \
  rm -rf /root/.config/yarn/global/node_modules/uws/build && \
  rm -rf /root/.config/yarn/global/node_modules/lodash/fp && \
  rm -rf /root/.config/yarn/global/node_modules/lodash/_* && \
  rm -rf /root/.config/yarn/global/node_modules/lodash/*.min.js && \
  rm -rf /root/.config/yarn/global/node_modules/lodash/core.js && \
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
CMD ["/root/.config/yarn/global/node_modules/droppy/docker-start.sh"]
