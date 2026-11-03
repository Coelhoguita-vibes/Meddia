#!/usr/bin/env bash
set -e
echo "===================================================="
echo "  MedDia - Gerador Automático de APK (Capacitor)"
echo "===================================================="
npm install
npx cap add android
npx cap sync android
cd android
chmod +x ./gradlew
./gradlew assembleDebug
echo ""
echo "Pronto! Seu APK foi gerado em:"
echo "android/app/build/outputs/apk/debug/app-debug.apk"
