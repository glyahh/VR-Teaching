@echo off
setlocal
for %%I in ("%~dp0..\..") do set "REPO_ROOT=%%~fI"
set "COURSE_DIR="
for /d %%D in ("%REPO_ROOT%\*") do (
  if exist "%%~fD\harness\launch-course.mjs" set "COURSE_DIR=%%~fD"
)
if not defined COURSE_DIR (
  echo Cannot locate course launcher script under "%REPO_ROOT%".
  exit /b 1
)
where node >nul 2>nul
if %errorlevel%==0 (
  node "%COURSE_DIR%\harness\launch-course.mjs" %*
  exit /b %errorlevel%
)
for %%F in ("%COURSE_DIR%\*.html") do (
  start "" "%%~fF"
  exit /b 0
)
echo Node.js 22+ is required when offline HTML is not pre-built.
exit /b 1
