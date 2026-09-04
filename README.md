# 🏺 Aplicació Web i Mòbil de Control d'Hores i Assistència per al Taller de Ceràmica

Sistema integral per al control d'entrades i sortides d'alumnes amb **codi QR** i manual, còmput exacte del temps en format **`H:m:s`**, gestió i auto-adquisició de **paquets d'hores amb Stripe**, carnets imprimibles i arquitectura híbrida amb **SQLite** i sincronització amb **Google Sheets**.

---

## 🌐 Com Publicar l'Aplicació a Internet 24/7 (Opció Núvol Gratuïta)

Perquè l'aplicació funcioni **les 24 hores del dia des de qualsevol mòbil (amb 4G/5G) i amb el Mac apagat**:

L'aplicació ja està preparada amb els fitxers de configuració (`render.yaml`, `Procfile`, `Dockerfile`, `requirements.txt`) per a **[Render.com](https://render.com)** (servidor gratuït):

1. **Pujar el codi al teu compte de GitHub**:
   ```bash
   cd /Users/personal/.gemini/antigravity/scratch/taller-ceramica-hores
   # Si crees un repositori a github.com:
   git remote add origin https://github.com/EL_TEU_USUARI/taller-ceramica.git
   git branch -M main
   git push -u origin main
   ```
2. **Desplegar a Render**:
   - Entra a [render.com](https://render.com) (inicia sessió gratuïtament amb el teu compte de GitHub).
   - Fes clic a **New +** > **Web Service**.
   - Selecciona el repositori `taller-ceramica`.
   - Render detectarà automàticament la configuració (`render.yaml`). Fes clic a **Create Web Service**.
3. **Ja està!**
   - En 1 minut tindràs una adreça pública i segura **HTTPS** (ex: `https://taller-ceramica.onrender.com`).
   - Com que té **HTTPS**, la càmera del mòbil Android funcionarà de manera nativa i sense avisos de seguretat.
   - Els alumnes podran consultar el saldo i **comprar hores amb Stripe des de casa seva a qualsevol hora**.

---

## 🚀 Com Executar l'Aplicació Localment al Mac

### Opció A: Amb Servidor Local Python (Recomanat per a multi-dispositiu)
Al terminal del vostre Mac, executeu:
```bash
cd /Users/personal/.gemini/antigravity/scratch/taller-ceramica-hores
python3 server.py
```
El servidor mostrarà les adreces d'accés:
- 🛠️ **Panell d'Administració:** [http://localhost:8080/admin.html](http://localhost:8080/admin.html)
- 📷 **Escàner QR (Tauleta/Android):** [http://localhost:8080/scanner.html](http://localhost:8080/scanner.html)
- 👤 **Portal de l'Alumne:** [http://localhost:8080/alumne.html](http://localhost:8080/alumne.html)
- 🌐 **Des de mòbils o tauletes a la mateixa WiFi:** `http://<LA_TEVA_IP_LOCAL>:8080` (el mateix terminal us indicarà la vostra IP exacta).

### Opció B: Obrir directament al navegador (Sense servidor)
Podeu fer doble clic directament sobre qualsevol dels arxius `.html` (`index.html`, `admin.html`, `scanner.html`, `alumne.html`). L'aplicació funcionarà automàticament en mode local (`localStorage`).

---

## 📱 Com Instal·lar l'App al Mòbil Android (PWA)

1. Connecta el mòbil Android a la mateixa xarxa WiFi del taller i obre Google Chrome.
2. Introdueix l'adreça de l'escàner (ex: `http://192.168.1.X:8080/scanner.html`).
3. Apareixerà el botó **"📲 Instal·lar App"** a la barra inferior, o bé pots tocar el menú de 3 punts de Chrome i triar:
   > **"Afegeix a la pantalla d'inici"** o **"Instal·la l'aplicació"**.
4. Es crearà una icona del taller a l'escriptori del mòbil. S'executa a **pantalla completa** sense barres de navegador, exactament com una aplicació nativa d'Android.

---

## 💳 Configuració de Stripe (Articles ja configurats)

1. Accedeix al teu tauler de [Stripe Dashboard](https://dashboard.stripe.com/).
2. A l'apartat de **Productes** / **Payment Links** (Enllaços de pagament), copia l'enllaç de cadascun dels teus articles (ex: `https://buy.stripe.com/abc...`).
3. Obre el Panell d'Administració (`admin.html`), ves a **⚙️ Configuració** i enganxa els enllaços als camps:
   - *Enllaç Stripe: Pack 5 Hores*
   - *Enllaç Stripe: Pack 10 Hores*
   - *Enllaç Stripe: Pack 20 Hores*
4. Fes clic a **Desar Configuració**.
5. A partir d'aquest moment, quan un alumne entri al seu portal (`alumne.html`), podrà clicar "Comprar amb Stripe" i les hores se li sumaran automàticament al seu compte en completar el pagament!

---

## 📊 Sincronització amb Google Sheets

1. Crea un full de càlcul a [Google Sheets (sheets.new)](https://sheets.new).
2. Al menú superior, ves a: **Extensions** > **Apps Script**.
3. Esborra el codi existent i enganxa el contingut de l'arxiu **`google_apps_script.js`**.
4. Fes clic a **Implementar** (Deploy) > **Nova implementació** (New deployment) > tipus **Aplicació Web**.
5. Configura l'accés com a **"Tothom"** (Anyone) i copia l'URL generat (acaba en `/exec`).
6. Al panell d'administració (`admin.html`), ves a **⚙️ Configuració**, enganxa l'URL al camp de Google Sheets i desa.
7. Prem el botó **"📊 Sincronitzar amb Google Sheets"** sempre que vulguis actualitzar el full al núvol.

---

## 📋 Resum de Funcionalitats

| Funcionalitat | Descripció |
| :--- | :--- |
| **Alta d'Alumnes** | Registre amb Nom, Cognom, Telèfon, Email i assignació automàtica de codi únic (ex: `TC-101`). |
| **Carnet d'Alumne amb QR** | Disseny estàndard de targeta de soci (85x54mm) imprimible i descarregable amb QR d'alta resolució. |
| **Còmput `H:m:s`** | Càlcul de segons amb format `HH:MM:SS` i càlcul automàtic del saldo restant (Comprat - Gastat). |
| **Escàner QR Android** | Reconeixement amb càmera de mòbil o tauleta, amb efectes sonors diferents per a entrada i sortida. |
| **Tancar Cicle Oblidat** | Si un alumne no passa el QR en marxar, el professor pot forçar el tancament amb 1h30 estàndard o indicant l'hora real. |
| **Auto-compra d'Hores** | Els alumnes poden comprar hores des del seu mòbil amb Stripe o Bizum amb suma immediata al compte. |
| **Panell 360°** | Tauler en directe amb cronòmetres actius dels alumnes que estan treballant al taller ara mateix. |
| **Còpies de Seguretat** | Exportació a JSON complet i a arxiu CSV per obrir amb Excel. |
