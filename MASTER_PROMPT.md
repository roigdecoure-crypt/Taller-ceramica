# PROMPT MESTRE OPERATIU: SISTEMA DE GESTIÓ I RESERVES "ROIG DE COURE"

> **Instrucció d'ús:** Copia i enganxa tot el text següent en qualsevol nou xat o entorn d'intel·ligència artificial per recrear, configurar, desplegar o regenerar el projecte complet amb totes les funcionalitats, regles de negoci, seguretat i disseny en una sola ordre.

---

```markdown
Ets un enginyer de programari sènior i dissenyador web especialitzat en sistemes autònoms i interfícies artesanes d'alta qualitat. Desenvolupa, mantén o desplega el sistema web complet de gestió, assistència i reserves per al taller de ceràmica artesanal "Roig de Coure".

Aquest projecte consta d'un backend en Python pur (sense dependències externes pesants) amb base de dades SQLite nativa, i un frontend adaptable (responsive) en HTML5, CSS modern i JavaScript estàndard, tot redactat de forma íntegra en català.

L'aplicació ha de ser 100% autònoma, descarregable i desplegable a qualsevol servidor o màquina local (VPS, Raspberry Pi, Docker, servidor intern o ordinador de taller) sense dependre de plataformes tancades o serveis de pagament de tercers.

Segueix estrictament els requisits funcionals, d'arquitectura, de privacitat i de disseny detallats a continuació:

---

### 1. REGLA ESTÈTICA GLOBAL I IDENTITAT DE MARCA
1. **Nom de marca**: "Roig de Coure" (títol destacat, estètica de taller de terrissaire tradicional, càlida i professional).
2. **Paleta de colors corporativa**:
   - Color primari: Roig argila / terracota intens (#831D1D / #C25E3A).
   - Color secundari i contrast: Verd ceràmic / coure oxidat (#5E7E6F, fons suau #EEF5F1).
   - Fons i targetes: Blanc pur (#FFFFFF), porcellana càlida (#FAF7F5, #FFF8F6) i to mat antirreflex (#DDD7CE).
   - Tipografia: Text principal fosc contrastat (#2C221E), lletra secundària neutra (#6B7280).
3. **REGISTRE DE ZERO ICONES I ZERO EMOJIS**:
   - No utilitzis cap icona (ni FontAwesome, ni icones SVG, ni iconografies predissenyades) ni cap emoji o emoticona a cap part de l'aplicació (ni a la interfície, ni als botons, ni als títols, ni a les alertes, ni als missatges de confirmació).
   - L'estètica ha de transmetre sobrietat artesanal mitjançant composicions tipogràfiques netes, vores suaus, espaiats equilibrats, badges tipogràfics i caràcters bàsics com '‹' o '›' per a la navegació entre mesos.
4. **Navegació mòbil (Responsive)**:
   - A pantalles petites, la barra de navegació superior es plega en un botó d'accés ràpid tipogràfic o menú d'hamburguesa net de 3 línies que desplega els enllaços i es tanca en seleccionar qualsevol opció.
5. **Idioma**:
   - Tota la interfície d'usuari, formularis, taules, diàlegs modals, missatges de sistema, dates, hores i codi de cara al públic han d'estar rigorosament en català.

---

### 2. ENTRADES TOTALMENT INDEPENDENTS PER A CLIENTS I ADMINISTRACIÓ
1. **Separació radical d'espais**:
   - El públic general i els alumnes no han de veure mai opcions, pestanyes, botons o estadístiques d'administració.
   - Les rutes públiques (`index.html`, `reserva.html`, `alumne.html`, `carnet.html`) estan reservades a reserves, consulta d'hores i carnet digital.
2. **Protecció per PIN d'administració**:
   - L'accés al panell de gestió (`admin.html`) està custodiat per una pantalla de bloqueig per PIN (per defecte: `1234`).
   - El PIN s'emmagatzema a la taula `configuracio` de la base de dades SQLite i es pot canviar des de la pròpia pantalla de configuració de l'administrador (`POST /api/admin/change-pin`).
   - L'endpoint de verificació (`POST /api/admin/auth`) genera una sessió autenticada local. Sense aquest PIN, les crides a les funcions de configuració i restauració queden denegades.

---

### 3. ACCÉS D'ALUMNES AMB NOM I CONTRASENYA (PIN) I SISTEMA DE RECUPERACIÓ
1. **Accés segur a l'Espai Alumne (`alumne.html`)**:
   - **Camp 1**: Identificador d'alumne. Admet codi d'alumne (ex: `231F`), nom complet (ex: `Ferran Picornell`), correu electrònic o telèfon registrat.
   - **Camp 2**: Contrasenya (PIN) numèrica o alfanumèrica associada a l'alumne a la taula `alumnes`.
   - Botó per mostrar/ocultar caràcters de la contrasenya de forma neta ("Mostrar" / "Ocultar").
2. **Sistema de Recuperació de Contrasenya / PIN (`#modal-recuperar-pwd`)**:
   - **Verificació per doble factor**: L'alumne introdueix el seu nom o codi, i el seu telèfon mòbil o correu registrat.
   - **Endpoint `POST /api/alumnes/recuperar-pin`**: Comprova que les dades coincideixin amb la fitxa a la base de dades.
   - **Visualització i accés 1-clic**: Mostra el PIN recuperat i un botó per iniciar sessió directament sense haver de tornar a escriure'l.
   - **Opció d'establir nova contrasenya**: Permet canviar el PIN des de la mateixa pantalla de recuperació o posteriorment des del botó "Canviar PIN" de l'espai privat (`POST /api/alumnes/canviar-pin`).
   - **Canal de suport immediat**: Botó d'enllaç directe amb WhatsApp oficial del taller amb text predefinit per sol·licitar assistència manual.

---

### 4. HORARIS, CALENDARI I REGLES D'AFORAMENT
1. **Horari d'obertura del taller**:
   - Obert: **Dimecres a Diumenge** (matins de 10:00 h a 13:00 h i tardes de 17:00 h a 20:00 h).
   - Tancat: **Dilluns i Dimarts** (descans del taller).
2. **Capacitat màxima simultània**: 12 persones en total a la sala entre totes les activitats combinades.
3. **Activitats i aforaments parcials**:
   - **Torn de terrissaire**: màxim 4 torns físics.
   - **Modelatge i escultura**: fins a 8 places (sense superar el total de 12 places del taller).
   - **Pintar ceràmica**: fins a 12 places (sense superar el total de 12 places del taller).
4. **Sessions públiques**: Durada estàndard de 2 hores amb torns d'entrada escalonats de 10:00 a 11:00 cada 15 minuts (10:00, 10:15, 10:30, 10:45, 11:00).
5. **Calendari visual interactiu**:
   - El calendari obre net sense dates preseleccionades forçades ni etiquetes confuses.
   - Cada dia mostra l'estat d'ocupació real (ex: `12 ll.`, `8 ll.`, `Tancat`, `Festiu`).
   - En seleccionar un dia disponible, s'il·lumina clarament i es desplega a sota la secció d'horaris amb un botó per "Canviar de dia" per poder rectificar fàcilment.

---

### 5. PÀGINA DE RESERVA PÚBLICA (`reserva.html`)
1. **Flux de reserva en 4 passos**:
   - **Pas 1: Activitat**: Torn, Modelatge o Pintar peces.
     - *Opció Val Regal*: Selecciona l'activitat sense demanar codi complex; fixa automàticament l'hora a les 10:00 h.
     - *Opció Sóc Alumne (RGPD Estricte)*: Verificació privada individualitzada (cerca per nom o codi sense exposar llistes d'altres usuaris a la xarxa). Vincula el `student_id` a la reserva.
   - **Pas 2: Data i Torn**: Calendari mensual incrustat amb comprovació atòmica de places lliures per franja i activitat.
   - **Pas 3: Nombre d'assistents**: Selector de places limitat per l'aforament restant disponible.
   - **Pas 4: Dades de contacte**: Nom complet, telèfon mòbil i correu electrònic.
2. **Confirmació**:
   - Pantalla de resum complet amb codi de reserva, descàrrega de fitxer `.ics` per a agendes i confirmació directa via WhatsApp.

---

### 6. ESPAI DE L'ALUMNE I CARNET DIGITAL (`alumne.html` i `carnet.html`)
1. **Comptabilitat i saldo d'hores en temps real**:
   - Balanç calculat directament al segon i expressat en format `HH:MM:SS`.
   - Hores adquirides mitjançant paquets, hores consumides i saldo restant disponible.
2. **Targeta de paquet actiu**:
   - Detall del pack contractat i botó directe "Comprar Hores" redirigit als enllaços de pagament Stripe segons l'edat de l'alumne (Adults o Infantil).
3. **Gestió de reserves de l'alumne**:
   - Llistat de les properes sessions i historial d'assistències passades.
4. **Carnet d'alumne amb codi QR**:
   - Codi identificador personal per a lectura ràpida a l'entrada i sortida.
   - Opcions de descàrrega per a mòbils i rellotges intel·ligents.

---

### 7. ESCÀNER D'ASSISTÈNCIA AMBIENT DISCRET (`scanner.html`)
1. **Filosofia de disseny "No es veu res" (Mode Standby Elegant)**:
   - En repòs, no mostra la pantalla oberta de la càmera de videovigilància. Presenta un fons fosc càlid amb el rètol tipogràfic "Roig de Coure" i un punt d'estat suau.
   - La càmera analitza en segon pla mitjançant la llibreria `jsQR` (a 20 fotogrames per segon).
2. **Interacció en detectar el QR**:
   - Lectura instantània en apropar el carnet des del mòbil, paper o rellotge.
   - Xiulet acústic suau generat mitjançant la Web Audio API (sense arxius d'àudio externs).
   - Targeta emergent de benvinguda amb el nom de l'alumne, tipus d'acció (Entrada o Sortida) i el balanç d'hores actualitzat.
   - Retorn automàtic al mode ambient discret després de 3 segons d'inactivitat.
3. **Gestió de cicles oblidats**:
   - Si un alumne entra i oblida registrar la sortida, la sessió queda registrada com a oberta sense bloquejar el sistema.
   - L'administració pot forçar la sortida aplicant la durada estàndard de la sessió (ex: 01:30:00) o establint l'hora exacta des del panell.

---

### 8. PANELL D'ADMINISTRACIÓ I RESERVES RECURRENTS (`admin.html`)
1. **Gestió d'alumnes i compres**:
   - Alta, edició, baixa i consulta de la fitxa completa d'alumnes.
   - Inserció manual de paquets d'hores (efectiu, Stripe o transferència) i sessions presencials manuals.
2. **Reserves Recurrents (Sèries periòdiques)**:
   - Creació de reserves individuals o recurrents des del modal d'administració.
   - Freqüències admeses: **Setmanal** (+7 dies), **Quinzenal** (+14 dies) o **Mensual** (+1 mes).
   - Presets de sessions: **4s (1 mes)**, **8s (2 mesos)**, **12s (3 mesos)** o selecció lliure (de 2 a 26 sessions).
   - **Salt automàtic de dies tancats i festius**: Algorisme `calculate_recurring_dates` que omet dilluns, dimarts o dates bloquejades al calendari per garantir que l'alumne gaudeixi de totes les sessions contractades.
   - **Previsualització en temps real (`POST /api/reserves/recurrent-preview`)**: Comprova l'aforament global i de l'activitat per a cadascuna de les dates calculades.
   - **Vinculació per `recurrent_id`**: Cada sèrie rep un identificador comú (`REC-...`).
   - **Gestió diària i cancel·lació flexible**:
     - Cada cita mostra la insígnia `Recurrent`.
     - L'administrador pot cancel·lar una sessió concreta o prémer `"Cancel·lar Sèrie"` per cancel·lar atòmicament totes les sessions futures de la sèrie (`POST /api/reserves/cancel-serie`).
3. **Control d'assistència presencial (`Visited`)**:
   - Casella de verificació directa a la llista del dia per marcar alumnes i clients que han assistit a classe.

---

### 9. SISTEMA DE CÒPIES DE SEGURETAT (SNAPSHOTS SQLITE) I RESTAURACIÓ
1. **Captures diàries atòmiques**:
   - Ús de l'API de còpia en línia de SQLite (`sqlite3.backup`) que genera fitxers `.db` complets sense interrompre lectures ni escriptures.
   - Desats a la carpeta de seguretat `data/snapshots/` amb nomenclatura temporal `snapshot_YYYYMMDD_HHMMSS.db`.
   - Còpia automàtica diària amb retenció dels darrers 30 dies.
2. **Gestió des de l'administració (`GET /api/admin/snapshots` i `POST /api/admin/snapshots`)**:
   - Visualització de la data, hora i mida de cada captura.
   - Botó per generar una captura manual en qualsevol moment.
   - Opció de descarregar el fitxer de base de dades localment a l'ordinador.
3. **Mecanisme de restauració segura (`POST /api/admin/restore-snapshot`)**:
   - Abans de restaurar qualsevol snapshot anterior, el sistema genera automàticament una còpia de seguretat d'emergència de l'estat present (`pre_restore_backup_...`).
   - Substitució atòmica de la base de dades sense corrupció d'índexs ni pèrdua de consistència.

---

### 10. COMPATIBILITAT AMB TELÈFONS MÒBILS I RELLOTGES INTEL·LIGENTS
1. **Telèfons mòbils (iOS i Android)**:
   - Disseny adaptable amb controls de visualització adequats a totes les mides de pantalla.
   - Formularis amb font &ge; 16px per evitar zooms no desitjats a Safari mòbil.
   - Modals amb desplaçament vertical autònom (`max-height: 90vh; overflow-y: auto`) perquè cap botó d'acció quedi tapat pel teclat o la barra de navegació inferior.
   - Botons tàctils amb superfícies mínimes de 44x44px.
   - Suport com a Progressive Web App (PWA) instal·lable a la pantalla d'inici amb `manifest.json`.
2. **Apple Watch**:
   - Generació de passis oficials Apple Wallet (`.pkpass`) que s'afegeixen a l'iPhone i es repliquen automàticament a l'aplicació Wallet nativa de l'Apple Watch per a lectura directa des del canell.
3. **Wear OS / Google Pixel Watch / Samsung Galaxy Watch (Mode Mat OLED)**:
   - Descàrrega d'imatge quadrada en proporció 1:1 d'alta resolució (600x600 px).
   - **Fons negre AMOLED pur (`#181514`)**: manté els píxels de la pantalla apagats en rellotges rodons o quadrats, allargant la bateria.
   - **Targeta ceràmica mat antirreflex (`#DDD7CE`)**: mòduls de codi QR en negre d'alt contrast sobre fons mat inspirat en la porcellana, dissenyat per absorbir els reflexos de la llum del taller i garantir una lectura fiable a l'escàner.

---

### 11. INTEGRACIONS EXTERNES
1. **Google Sheets i Google Calendar**:
   - Sincronització bidireccional mitjançant una Web App de Google Apps Script.
   - Cada reserva s'afegeix al calendari configurat (per defecte: `reserves`) i es registra al full de càlcul compartit per a consulta externa.
   - Hidratació inicial opcional de la base de dades des del full de càlcul.
2. **WhatsApp Notificacions (Meta Cloud API Oficial)**:
   - Enviament directe a través de l'API oficial de Meta (sense intermediaris de pagament).
   - Missatges de confirmació en formalitzar la reserva, recordatori previ a 48 hores i recordatori el mateix dia a les 8:00 AM.
3. **Passarel·la de pagament Stripe**:
   - Enllaços de pagament independents per a tarifes d'Adults i Infantil segons l'edat de l'alumne (tall a 12 anys).

---

### 12. ARQUITECTURA DEL SERVIDOR (`server.py`) I MODEL DE DADES
1. **Servidor HTTP lleuger**:
   - Desenvolupat sobre `http.server.HTTPServer` i `BaseHTTPRequestHandler`.
   - Manipulació de concurrència i connexió a SQLite amb `threading` i connexions tancades de forma neta.
2. **Esquema principal de taules SQLite**:
   - `alumnes`: `id`, `nom`, `cognoms`, `telefon`, `email`, `pin`, `edat`, `data_alta`, `actiu`.
   - `paquets_hores`: `id`, `student_id`, `data`, `hores`, `segons`, `concepte`, `preu`, `metode_pagament`.
   - `sessions`: `id`, `student_id`, `data`, `entrada`, `sortida`, `durada_segons`, `format_hms`, `tipus`, `estat`, `notes`.
   - `reserves`: `id`, `student_id`, `student_nom`, `data`, `hora_inici`, `hora_fi`, `franja`, `activitat`, `activitat_id`, `places`, `telefon`, `email`, `estat`, `hores`, `notes`, `recurrent_id`, `calendar_event_id`, `created_at`.
   - `configuracio`: `clau`, `valor`.
   - `dies_tancats`: `data`, `motiu`.
3. **Endpoints clau de l'API REST**:
   - `GET /api/reserves/disponibilitat?data=YYYY-MM-DD`
   - `GET /api/reserves/mes?any=YYYY&mes=MM`
   - `POST /api/reserves`
   - `POST /api/reserves/recurrent-preview`
   - `POST /api/reserves/recurrent`
   - `POST /api/reserves/cancel-serie`
   - `POST /api/admin/auth`
   - `POST /api/admin/change-pin`
   - `GET /api/admin/snapshots`
   - `POST /api/admin/snapshots`
   - `POST /api/admin/restore-snapshot`
   - `POST /api/alumnes/recuperar-pin`
   - `POST /api/alumnes/canviar-pin`
   - `POST /api/scan`
   - `GET /api/alumnes/me?codi=...`

---

### 13. BATERIA DE PROVES UNITÀRIES I D'INTEGRACIÓ
- El projecte inclou la suite `tests/test_backend.py` amb un mínim de 27 proves unitàries que cobreixen:
  - Formatatge exacte de segons a hores (`HH:MM:SS`).
  - Balanços i descomptes d'hores d'alumnes.
  - Cicles de fitxatge complets i tancament forçat per oblit.
  - Disponibilitat i càlcul d'aforaments límit.
  - Autenticació d'alumnes i recuperació de contrasenya (PIN).
  - Generació, previsualització i cancel·lació de reserves recurrents en bloc.
  - Còpies de seguretat SQLite (snapshots) i restauració íntegra.
  - Totes les proves han d'executar-se i aprovar-se satisfactòriament amb l'ordre `python3 -m unittest discover tests`.
```
