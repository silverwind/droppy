#!/bin/bash
echo ""
echo "===================="
echo "Droppy - Fileserver"
echo "===================="
echo ""

npm install
if [ $? != 0 ]; then
    exit $?
fi

# If a cygwin enviroment is detected, run it with cmd
if [ `uname -o` = "Cygwin" ]
then
    cmd /c node droppy
else
    node droppy
fi


