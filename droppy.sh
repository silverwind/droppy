#!/bin/bash
echo ""
echo "===================="
echo "Droppy - Fileserver"
echo "===================="
echo ""
echo ">>> Checking dependancies..."
npm list  | grep ws@ > /dev/null
if [ $? -eq 1 ]
then
	echo ">>> Installing ws"
	npm install ws@latest
fi

npm list | grep mime@ > /dev/null
if [ $? -eq 1 ]
then
	echo ">>> Installing mime"
	npm install mime@latest
fi

npm list | grep formidable@ > /dev/null
if [ $? -eq 1 ]
then
	echo ">>> Installing formidable"
	npm install formidable@latest
fi

echo ">>> Starting up..."

# If a cygwin enviroment is detected, run it with cmd
if [ `uname -o` = "Cygwin" ]
then
    cmd /c node droppy
else
    node droppy
fi
