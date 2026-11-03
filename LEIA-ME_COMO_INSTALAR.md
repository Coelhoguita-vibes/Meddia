# MedDia — Pacote Completo (App Celular + Gerador de APK)

Este pacote contém a versão aprovada do **MedDia** pronta para instalar e testar no seu celular de **3 formas diferentes** (da mais simples até a geração do `.apk` nativo).

---

## Opção 1: Usar no celular agora mesmo (Sem precisar compilar nada)
1. Envie o arquivo **`MedDia_Abrir_Direto_No_Celular.html`** (que está dentro deste pacote) para o seu celular (por WhatsApp, Google Drive ou cabo USB).
2. Abra o arquivo usando o navegador **Google Chrome** (no Android) ou **Safari** (no iPhone).
3. No menu do navegador (os 3 pontinhos no canto superior), toque em **"Adicionar à tela inicial"**.
4. O MedDia ficará salvo com ícone na sua tela inicial e abrirá em tela cheia, salvando todos os seus medicamentos e marcações no aparelho!

---

## Opção 2: Gerar o arquivo `.APK` na nuvem (Sem instalar programas pesados no PC)
Este pacote já inclui uma automação pronta do **GitHub Actions** (`.github/workflows/gerar-apk.yml`) que compila o `.apk` gratuitamente nos servidores do GitHub:
1. Crie um repositório gratuito no [GitHub](https://github.com/new) e envie todos os arquivos desta pasta.
2. Clique na aba **"Actions"** do seu repositório no GitHub.
3. O fluxo **"Gerar APK Android (MedDia)"** vai rodar sozinho em cerca de 2 minutos e disponibilizar o arquivo **`MedDia-Instalador-APK`** (`app-debug.apk`) pronto para baixar e instalar no celular!

---

## Opção 3: Compilar o `.APK` no seu computador (Windows, Mac ou Linux)
Se você tiver o [Node.js](https://nodejs.org/) e o [Android Studio](https://developer.android.com/studio) instalados no computador:
- **No Windows:** dê dois cliques no arquivo **`gerar_apk.bat`**.
- **No Linux ou Mac:** execute `bash gerar_apk.sh` no terminal.
- O instalador será gerado automaticamente na pasta:
  `android/app/build/outputs/apk/debug/app-debug.apk`
