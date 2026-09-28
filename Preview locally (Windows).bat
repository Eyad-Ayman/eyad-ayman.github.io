@echo off
title Eyad Ayman - local preview
rem Double-click to preview the portfolio and EYAD STUDIO on http://localhost
rem (opening index.html directly as a file breaks fetch, fonts and modules).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-preview\server.ps1"
if errorlevel 1 pause
