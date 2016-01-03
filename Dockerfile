FROM gliderlabs/alpine:3.3

# Install Node.js
RUN apk add --update nodejs

# Create app directory
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# Copy app files
COPY server /usr/src/app/server
COPY client /usr/src/app/client
COPY dist /usr/src/app/dist
COPY droppy.js /usr/src/app/
COPY index.js /usr/src/app/
COPY package.json /usr/src/app/

# Install deps
ENV NODE_ENV=production
RUN npm install

# Run
EXPOSE 8989
CMD node droppy.js start --configdir /root --filesdir /root/files

