@echo off
setlocal
echo.
echo ====================
echo Droppy - Fileserver
echo ====================
echo.
echo ### Checking dependancies...
call :FirstCheck

:FirstCheck
npm list 2>&1 | findstr socket.io > NUL
if %ERRORLEVEL%==1 (
    echo ### Installing socket.io
    npm install socket.io
    call :SecondCheck
)

:SecondCheck
npm list 2>&1 | findstr mime > NUL
if %ERRORLEVEL%==1 (
    echo ### Installing mime
    npm install mime
    call :ThirdCheck
)

:ThirdCheck
npm list 2>&1 | findstr formidable > NUL
if %ERRORLEVEL%==1 (
    echo ### Installing formidable
    npm install formidable@latest
    call :Run
)

:Run
echo ### Droppy: starting up...
node server.js