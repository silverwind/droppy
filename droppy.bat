@echo off
setlocal
echo Droppy: checking dependancies...
call :FirstCheck

:FirstCheck
npm list | findstr socket.io 2>&1
set RESULT=%ERRORLEVEL%
if %RESULT%==1 (
    npm install socket.io
    call :SecondCheck
)

:SecondCheck
npm list | findstr mime 2>&1
set RESULT=%ERRORLEVEL%
if %RESULT%==1 (
    npm install mime
    call :ThirdCheck
)

:ThirdCheck
npm list | findstr formidable 2>&1
set RESULT=%ERRORLEVEL%
if %RESULT%==1 (
    npm install formidable@latest
    call :Run
)

:Run
echo Droppy: starting up...
node server.js