@echo off
chcp 65001 >nul
rem ============================================================
rem  weeqo deploy: распаковывает zip с сайтом и пушит в GitHub.
rem  Этот файл должен лежать В ПАПКЕ СКЛОНИРОВАННОГО РЕПОЗИТОРИЯ.
rem  Использование: перетащи weeqo-vXX.zip на этот .bat
rem  или из консоли: deploy.bat C:\путь\к\weeqo-vXX.zip
rem ============================================================
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  echo Перетащи zip-файл на этот .bat или запусти: deploy.bat путь\к\файлу.zip
  pause
  exit /b 1
)

if not exist ".git" (
  echo ОШИБКА: это не папка репозитория. Сначала: git clone https://github.com/ТВОЙ_ЛОГИН/weeqo.git
  pause
  exit /b 1
)

set "TMP=%TEMP%\weeqo-deploy-%RANDOM%%RANDOM%"
mkdir "%TMP%"

echo [1/4] Распаковываю %~nx1 ...
tar -xf "%~1" -C "%TMP%"
if errorlevel 1 (
  echo ОШИБКА распаковки zip.
  rmdir /S /Q "%TMP%"
  pause
  exit /b 1
)

echo [2/4] Копирую файлы поверх репозитория ...
xcopy /E /Y /Q "%TMP%\*" "%~dp0" >nul
rmdir /S /Q "%TMP%"

echo [3/4] Коммичу ...
git add -A
git commit -m "update %date% %time:~0,5%"
if errorlevel 1 (
  echo Нечего коммитить — файлы не изменились.
  pause
  exit /b 0
)

echo [4/4] Пушу на GitHub ...
git push
if errorlevel 1 (
  echo ОШИБКА push. Проверь авторизацию: gh auth login
  pause
  exit /b 1
)

echo.
echo Готово! Pages задеплоит за ~1 минуту. Обнови сайт с Ctrl+Shift+R один раз.
pause
