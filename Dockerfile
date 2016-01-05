FROM gliderlabs/alpine:3.3

# Install Node.js
RUN apk add --update nodejs

# Create app directory
RUN mkdir /droppy
WORKDIR /droppy

# Create data directory
RUN mkdir /droppy-data

# Install deps
COPY package.json /droppy/
ENV NODE_ENV=production
RUN npm install

# Copy app files
COPY server /droppy/server
COPY client /droppy/client
COPY dist /droppy/dist
COPY droppy.js /droppy/
COPY index.js /droppy/

# Run
EXPOSE 8989
CMD node droppy.js start --configdir /droppy-data

