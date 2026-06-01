@echo off
REM This script starts both the backend and frontend servers

echo ========================================
echo Starting IT Request Response System
echo ========================================
echo.

REM Start backend in a new window
echo Starting Backend Server on port 3000...
start "ITRS Backend" cmd /k "cd backend-ts && npm run dev"

REM Wait a moment for backend to start
timeout /t 2 /nobreak

REM Start frontend in a new window
echo Starting Frontend Server on port 5173...
start "ITRS Frontend" cmd /k "cd frontend-ts && npm run dev"

echo.
echo ========================================
echo Services Starting...
echo.
echo Backend:  http://localhost:3000
echo Frontend: http://localhost:5173
echo.
echo Close the command windows to stop services.
echo ========================================
