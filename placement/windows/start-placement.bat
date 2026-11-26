@echo off
rem 42gAvaterMaker: serve this folder at http://localhost:8642/ (this PC only) so MetaMask can connect.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local-server.ps1"
pause
