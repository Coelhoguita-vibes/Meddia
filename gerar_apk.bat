@echo off
echo ====================================================
echo   MedDia - Gerador Automatico de APK (Capacitor)
echo ====================================================
echo.
echo 1. Instalando dependencias do Capacitor...
call npm install
echo.
echo 2. Criando projeto nativo Android...
call npx cap add android
call npx cap sync android
echo.
echo 3. Compilando o arquivo APK...
cd android
call gradlew.bat assembleDebug
echo.
echo ====================================================
echo Pronto! Seu APK foi gerado em:
echo android\app\build\outputs\apk\debug\app-debug.apk
echo ====================================================
pause
