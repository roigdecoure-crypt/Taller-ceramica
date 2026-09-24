# ESTAT ACTUAL DEL PROJECTE I INSTRUCCIONS DE CONTINUACIÓ

Aquest document resumeix l'estat exacte del projecte **Taller de Ceràmica - Roig de Coure** perquè qualsevol nova sessió (inclòs el canvi d'usuari a `roigdecoure@gmail.com`) pugui reprendre la feina sense perdre cap dada ni context.

---

## 📌 1. ÚLTIMES FEINES COMPLETADES I DESPLEGADES

1. **Gestor d'hores i minuts concrets per als paquets d'alumnes:**
   - S'ha eliminat la restricció d'hores decimals (ex: `8.5`) al modal de compra/afegir paquets.
   - Ara hi ha selectors dedicats de **Hores (0 a 100h)** i **Minuts (00, 15, 30, 45 min o camp lliure)**, amb previsualització en viu del temps total (ex: `8h 30min` = `8.50 h`).
   - Implementat a `admin.html` i `js/admin.js`.

2. **Càrrega resilient d'alumnes i prevenció de dades buides:**
   - Resolta la incidència on l'administrador no veia la llista completa d'alumnes.
   - S'ha assegurat la transmissió de les capçaleres d'autenticació a `/api/alumnes`.
   - Confirmats **395 alumnes registrats** (127 amb saldo/paquet actiu).

3. **Restriccions de tallers recurrents i bloqueig actiu:**
   - Permet bloquejar tallers per a dies concrets o de forma recurrent (ex: *Tots els dimecres només es permet pintar ceràmica*).
   - Les dates s'envien i es guarden en bloc ("batch") en una sola transacció a la base de dades SQLite.
   - Quan un taller està bloquejat per a una data/torn:
     - Les reserves públiques i des de l'àrea d'alumne queden automàticament deshabilitades ("Esgotat" / bloquejat).
     - Al formulari de **Nova Reserva d'Administrador** es mostra un avís en vermell indicant quins tallers estan bloquejats i quins permesos.
     - L'API del servidor rebutja qualsevol intent de reserva no permesa amb el codi `ACTIVITAT_RESTRINGIDA` (tret que l'administrador forci la reserva explícitament).

4. **Autenticació robusta sense tancaments de sessió inoportuns:**
   - Suport de tokens de sessió **HMAC estateless** (`roig_owner_...`), que sobreviuen als reinicis del servidor de Render sense perdre la sessió durant 30 dies.
   - Suport de la capçalera de reserva `X-Admin-PIN` perquè qualsevol acció administrativa tingui autorització garantida.
   - Gestor d'autorecuperació de sessió: si en algun moment el token caduca, apareix un avís senzill per reintroduir el PIN i reintentar l'acció automàticament.

---

## 🌐 2. ARQUITECTURA I DESPLEGAMENT EN DIRECTE

- **Frontend (Web pública i panell admin):**
  - Allotjat a **OVH Cloud** (`roigdecoure.cat` / `cluster127`).
  - Desplegament via FTP: `ftp.cluster127.hosting.ovh.net`, usuari `ppxyjun`.
  - Fitxers actualitzats a `www/` (`admin.html`, `reserva.html`, `alumne.html`, `js/admin.js`, `js/reserves-calendar.js`, `js/store.js`, imatges oficials).
  - Versió de cache busting actual: `v=12.7.18`.
  - Integració de WhatsApp Web autònom (Baileys) a cost 0,00 €/mes vinculat al telèfon de Simyo del taller (`683 633 880`).
  - Codi QR en viu al panell d'Administració > Configuració per vincular WhatsApp en 1 segon.
  - Sincronització automàtica amb Google Calendar (reserves cancel·lades s'eliminen i les confirmades mostren 🟢).

- **Backend (API REST + Servidor SQLite):**
  - Allotjat a **Render**: `https://taller-ceramica-nb96.onrender.com`.
  - Connectat automàticament al repositori GitHub: `https://github.com/roigdecoure-crypt/Taller-ceramica.git` (branca `main`).
  - Cada `git push origin main` activa el desplegament automàtic a Render.

- **Sincronització amb Google Sheets & Calendar:**
  - Integrat amb Google Apps Script per a sincronització bidireccional d'alumnes, paquets, sessions i esdeveniments de calendari.

---

## 🔑 3. CREDENCIALS I ACCESSOUS D'ADMINISTRACIÓ

- **PIN / Clau d'accés Administrador:** `669334` o `Rdc669334662`.
- **Credencials FTP OVH:**
  - Host: `ftp.cluster127.hosting.ovh.net`
  - Usuari: `ppxyjun`
  - Contrasenya: `Rdc669334662`
  - Directori arrel: `www/`
- **GitHub Remote:**
  - URL: `https://github.com/roigdecoure-crypt/Taller-ceramica.git` (autenticat via PAT)

---

## 💻 4. ENTORNS LOCALS

- **Directori de treball local:** `/Users/personal/.gemini/antigravity/scratch/taller-ceramica-hores`
- **Execució local:**
  ```bash
  python3 server.py
  # Obre el servidor a http://localhost:8080
  ```
- **Base de dades SQLite local:** `data/ceramica.db`.

---

## 🚀 5. INSTRUCCIONS PER AL NOU XAT / NOU USUARI

Quan iniciïs la nova sessió amb `roigdecoure@gmail.com`:
1. El projecte està 100% al dia i sincronitzat tant a GitHub com a OVH.
2. Pots continuar demanant qualsevol nova tasca o millora directament fent referència a aquest document `ESTAT_I_CONTINUACIO.md`.
