FROM mhart/alpine-node:latest

# Create app directory
RUN mkdir /droppy
WORKDIR /droppy

# Create data directory
RUN mkdir /droppy-data

# Install deps
COPY package.json /droppy/package.json
ENV NODE_ENV=production
RUN npm install

# Copy app files
COPY server /droppy/server
COPY client /droppy/client
COPY dist /droppy/dist
COPY droppy.js /droppy/droppy.js

# Run
EXPOSE 8989
CMD node droppy.js start --configdir /droppy-data

