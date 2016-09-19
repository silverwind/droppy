FROM mhart/alpine-node:latest
MAINTAINER silverwind

# Install and build modules
RUN apk add --no-cache make gcc g++ python && \
    npm install -g droppy && \
    npm cache clean && \
    apk del make gcc g++ python;

# Create volume mountpoints
VOLUME ["/config", "/files"]

# Run
EXPOSE 8989
CMD ["/usr/lib/node_modules/droppy/docker-start.sh"]
