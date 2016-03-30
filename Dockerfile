FROM mhart/alpine-node:latest
MAINTAINER silverwind

# Create directories
RUN mkdir /config
RUN mkdir /files
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

# Run
EXPOSE 8989
CMD ["node", "droppy.js", "start", "--configdir",  "/config" , "--filesdir",  "/files", "--color"]
