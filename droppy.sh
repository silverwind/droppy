#!/bin/bash
echo ""
echo "===================="
echo "Droppy - Fileserver"
echo "===================="
echo ""
echo ">>> Checking dependancies..."
npm list  | grep socket.io > /dev/null
if [ $? -eq 1 ]
then
	echo ">>> Installing socket.io"
	npm install socket.io@latest
fi

npm list | grep mime > /dev/null
if [ $? -eq 1 ]
then
	echo ">>> Installing mime"
	npm install mime@latest
fi

npm list | grep formidable > /dev/null
if [ $? -eq 1 ]
then
	echo ">>> Installing formidable"
	npm install formidable@latest
fi

echo ">>> Starting up..."
node server.js
