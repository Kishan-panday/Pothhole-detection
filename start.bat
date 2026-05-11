@echo off
REM Road Condition Detector - Startup Script for Windows

cls
echo.
echo ==========================================
echo   Road Condition Detector - Setup
echo ==========================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed!
    echo Please download and install Node.js from: https://nodejs.org
    pause
    exit /b 1
)

REM Check if MongoDB is running
echo Checking MongoDB connection...
timeout /t 2 /nobreak >nul

REM Install dependencies
echo.
echo Installing Node.js dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

REM Start the server
echo.
echo ==========================================
echo   Starting Road Condition Detector...
echo ==========================================
echo.
echo Server will be available at: http://localhost:5000
echo.
echo (Press Ctrl+C to stop the server)
echo.

node server.js

pause