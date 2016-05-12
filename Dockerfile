FROM mhart/alpine-node:latest
MAINTAINER silverwind

# Create directories
RUN mkdir /app

# Install dependencies
WORKDIR /app
COPY package.json /app/package.json
RUN npm install --production

# Copy app files
COPY server /app/server
COPY client /app/client
COPY dist /app/dist
COPY droppy.js /app/droppy.js

# Copy startup script
COPY docker-start.sh /start.sh

# Create volume mountpoints
VOLUME ["/config", "/files"]

# Run
EXPOSE 8989
CMD ["/start.sh"]
