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
npm list | findstr ws@ > NUL
if %ERRORLEVEL%==1 (
    echo ### Installing socket.io
    npm install socket.io
    call :SecondCheck
)

:SecondCheck
npm list | findstr mime@ > NUL
if %ERRORLEVEL%==1 (
    echo ### Installing mime
    npm install mime
    call :ThirdCheck
)

:ThirdCheck
npm list | findstr formidable@ > NUL
if %ERRORLEVEL%==1 (
    echo ### Installing formidable
    npm install formidable@latest
    call :Run
)

:Run
echo ### Droppy: starting up...
node droppy