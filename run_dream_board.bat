@echo off
chcp 65001 > nul
title 나의 꿈보드 (Dream Board) 실행기

echo ==========================================================
echo           ✨ 나의 생생한 꿈보드 (Dream Board) ✨
echo ==========================================================
echo.

cd /d "%~dp0"

:: 1. Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] Python이 설치되어 있지 않거나 PATH에 등록되지 않았습니다.
    pause
    exit /b 1
)

:: 2. Set environment variables
if exist "%USERPROFILE%\.gemini_key" (
    set /p GEMINI_API_KEY=<"%USERPROFILE%\.gemini_key"
)
set "PYTHONPATH=%~dp0"

:: 3. Install requirements if needed
echo [1/3] 필수 패키지 확인 중...
python -c "import fastapi, uvicorn, PIL, httpx" >nul 2>&1
if %errorlevel% neq 0 (
    echo 필요한 패키지를 설치합니다. 잠시만 기다려 주세요...
    pip install -r requirements.txt
)

:: 4. Start Server and Open Browser
echo.
echo [2/3] 꿈보드 웹서버를 시작합니다 (http://localhost:8000)...
echo [3/3] 브라우저가 자동으로 열립니다!
echo.
echo ==========================================================
echo  서버를 종료하려면 이 창에서 Ctrl + C 를 누르세요.
echo ==========================================================
echo.

start "" "http://localhost:8000"
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
pause
