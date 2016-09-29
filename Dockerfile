FROM mhart/alpine-node:latest
MAINTAINER silverwind
WORKDIR /

# Install and build modules
RUN apk add --no-cache make gcc g++ python git && \
  npm install --production --g droppy@latest dmn && \
  cd /usr/lib/node_modules/droppy && dmn clean -f && npm uninstall -g dmn && \
  rm -rf /root/.npm && \
  apk del make gcc g++ python git


EXPOSE 8989
VOLUME ["/config", "/files"]
CMD ["/usr/lib/node_modules/droppy/docker-start.sh"]
