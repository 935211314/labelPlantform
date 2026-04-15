@echo off
REM LabelPlantform Startup Script for Windows

echo ===================================
echo LabelPlantform Startup Script
echo ===================================

REM Check if virtual environment exists
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
)

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat

REM Install/update dependencies
echo Installing/updating dependencies...
pip install -r requirements.txt

REM Run database migrations
echo Running database migrations...
python manage.py migrate

REM Collect static files
echo Collecting static files...
python manage.py collectstatic --noinput

REM Create superuser if prompted
set /p CREATE_SUPERUSER="Do you want to create a superuser? (y/n): "
if /i "%CREATE_SUPERUSER%"=="y" (
    python manage.py createsuperuser
)

echo Starting LabelPlantform server...
python manage.py runserver 0.0.0.0:8000

pause