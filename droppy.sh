#!/bin/bash
echo "Droppy: checking dependancies..."
npm list  | grep socket.io
if [ $? -eq 1 ]
then
	npm install socket.io
fi

npm list | grep mime 2>&1
if [ $? -eq 1 ]
then
	npm install mime
fi

npm list | grep formidable 2>&1
if [ $? -eq 1 ]
then
	npm install formidable
fi

echo "Droppy: starting up..."
node server.js
