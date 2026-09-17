# PROMPT MESTRE OPERATIU: SISTEMA DE GESTIÓ I RESERVES "ROIG DE COURE"

> **Instrucció d'ús:** Copia i enganxa tot el text següent en qualsevol nou xat o entorn d'intel·ligència artificial (Claude, ChatGPT, Gemini, etc.) per recrear, configurar, desplegar, mantenir o regenerar el projecte complet amb totes les funcionalitats, regles de negoci, seguretat i disseny actuals en una sola ordre.

---

```markdown
Ets un enginyer de programari sènior i dissenyador web especialitzat en sistemes autònoms i interfícies artesanes d'alta qualitat. Desenvolupa, mantén o desplega el sistema web complet de gestió, assistència i reserves per al taller de ceràmica artesanal "Roig de Coure".

Aquest projecte consta d'un backend en Python 3 pur (sense dependències externes obligatòries) amb base de dades SQLite nativa, i un frontend adaptable (responsive) en HTML5, CSS modern i JavaScript estàndard (sense frameworks pesants), tot redactat de forma íntegra en català.

L'aplicació és 100% autònoma, descarregable i desplegable a qualsevol servidor o màquina local (OVH, VPS, Docker, Render, Raspberry Pi, servidor intern o ordinador de taller) sense dependre de plataformes tancades o serveis de pagament de tercers.

Segueix estrictament els requisits funcionals, d'arquitectura, de privacitat i de disseny detallats a continuació:

---

### 1. REGLA ESTÈTICA GLOBAL I IDENTITAT DE MARCA
1. **Nom de marca**: "Roig de Coure" (títol destacat, estètica de taller de terrissaire tradicional, càlida i professional).
2. **Tipografia corporativa estricta**:
   - Logotip / Nom de marca: `Buffalo` cursiva (`var(--font-script)`).
   - Tota la resta de textos, títols, subtítols i botons: `Verdana, Geneva, Tahoma, sans-serif` (`var(--font-sans)`).
   - Prohibit canviar la lletra original o introduir fonts no demanades.
3. **ZERO REQUADRES ARRODONITS (CANTONADES RECTES OBLIGATÒRIES)**:
   - Queda terminantment prohibit l'ús de cantonades arrodonides (`border-radius: 0 !important`) a qualsevol part de la web o de l'aplicació.
   - Totes les targetes, contenidors, botons, camps de formulari, alertes, selectors, marcs i finestres modals han de tenir cantonades rectes a 90 graus.
   - L'estètica ha de transmetre sobrietat artesanal, puresa de línies, acabat d'estudi ceràmic contemporani i elegància geomètrica neta.
4. **Paleta de colors corporativa**:
   - Color primari: Roig argila / terracota intens (`#831D1D` / `#C25E3A`).
   - Color secundari i contrast: Verd ceràmic / coure oxidat (`#5E7E6F`, fons suau `#EEF5F1`).
   - Fons i targetes: Blanc pur (`#FFFFFF`), porcellana càlida (`#FAF7F5`, `#FFF8F6`) i to mat antirreflex (`#DDD7CE`).
   - Tipografia: Text principal fosc contrastat (`#2C221E`), lletra secundària neutra (`#6B7280`).
5. **REGISTRE DE ZERO ICONES I ZERO EMOJIS**:
   - No utilitzis cap icona (ni FontAwesome, ni icones genèriques, ni iconografies predissenyades) ni cap emoji o emoticona a cap part de l'aplicació (ni a la interfície, ni als botons, ni als títols, ni a les alertes, ni als missatges de confirmació).
   - L'estètica transmet sobrietat artesanal mitjançant composicions tipogràfiques netes, cantonades rectes, espaiats equilibrats i caràcters bàsics com '‹' o '›' per a la navegació entre mesos.
6. **Navegació i Menú Principal**:
   - El menú principal superior a escriptori inclou de manera obligatòria i en aquest ordre:
     `Activitats` | `Reservar` | `Val regal` | `Botiga` | `Contacte` | `Alumnes`
   - L'element `Reservar` enllaça directament a la secció de reserves en línia (`#reserves`).
   - A pantalles mòbils, la barra superior es plega en un menú d'hamburguesa net de 3 línies que es tanca en seleccionar qualsevol opció.
7. **Rigor Ortogràfic en Català (Normativa IEC)**:
   - Tota la interfície d'usuari, formularis, taules, diàlegs modals, missatges de sistema, dates, hores i codi estan rigorosament en català normatiu i impecable.
   - S'han de respectar escrupolosament totes les grafies pròpies: `Preguntes Freqüents` (amb dièresi `ü`), `Ubicació` (amb accent), `Adreça` (amb ce trencada `ç`), `Matí`, `Telèfon`, `Reserves en Línia`, `Confirmació`, `Ceràmica`.
   - Mantenir els apartats, títols, adreça i dades reals del taller (Plaça Rector Ferrer, 15, Olot). No inventar mai informació inexistent.

---

### 2. HORARIS DEL TALLER, TORNS I REGLES D'AFORAMENT
1. **Dies d'obertura del taller**:
   - Obert: **Dimecres a Diumenge** (obertura setmanal habitual).
   - Tancat: **Dilluns i Dimarts** (descans del taller).
2. **Torns diaris independents de 2 hores**:
   - **Torn de Matí (10:00 h a 13:00 h)**: Arribades esglaonades cada 15 minuts a les `10:00`, `10:15`, `10:30`, `10:45` i `11:00`. (Sessions de 2 hores: finalitzen de 12:00 a 13:00).
   - **Torn de Tarda (17:00 h a 20:00 h)**: Arribades esglaonades cada 15 minuts a les `17:00`, `17:15`, `17:30`, `17:45` i `18:00`. (Sessions de 2 hores: finalitzen de 19:00 a 20:00).
3. **Aforament màxim independent per torn**:
   - **12 places màximes per torn** (12 al matí i 12 a la tarda de manera totalment independent: les reserves del matí no consumeixen places de la tarda).
4. **Límits físics per activitat**:
   - **Torn de terrissaire**: màxim **4 torns físics** simultanis per torn (com que cada sessió dura 2 hores, hi ha un màxim absolut de 4 places de torn en tot el torn de matí i 4 en el torn de tarda; els intervals de 15 minuts serveixen per esglaonar l'arribada, no per afegir nous torns).
   - **Modelatge i escultura**: fins a 8 places simultànies (limitat per l'aforament del taller).
   - **Pintar ceràmica**: fins a 12 places simultànies (limitat per l'aforament del taller).

---

### 3. PÀGINA WEB PÚBLICA I DE RESERVA (`index.html` i `reserva.html`)
1. **Pàgina d'Inici (`index.html`)**:
   - Filosofia artesanal, descripció de cursos, torns, packs i tarifes.
   - Disseny amb cantonades rectes (`border-radius: 0`), fons càlid, tipografia Verdana neta i Buffalo per al logotip.
   - Menú de navegació: `Activitats`, `Reservar`, `Val regal`, `Botiga`, `Contacte`, `Alumnes`.
   - Calendari integrat de disponibilitat immediata amb selecció de torn (Matí / Tarda) i selector d'hora d'arribada (10:00 a 11:00 al matí, 17:00 a 18:00 a la tarda).
   - Formulari de reserva ràpida amb connexió directa a la base de dades i WhatsApp.
2. **Assistent de Reserva Pas a Pas (`reserva.html`)**:
   - **Pas 1: Activitat**: Torn, Modelatge o Pintar ceràmica.
     - *Opció Val Regal*: Permet triar l'activitat sense necessitat d'introduir número de val; assigna automàticament la sessió al primer torn de matí amb nota informativa.
     - *Opció Sóc Alumne (Privacitat Estricta RGPD)*: Sense desplegables públics de noms. Verificació individual per nom complet o codi d'alumne via `GET /api/alumnes/verificar?q=...`. Autocompleta les dades de l'alumne trobat i vincula el seu `student_id`.
   - **Pas 2: Data i Torn (Calendari Visual Incrustat)**:
     - Calendari mensual visual incrustat (sense inputs date genèrics).
     - Dilluns i dimarts marcats com a tancats. Dies passats inhabilitats.
     - En fer clic a un dia disponible, desplega les targetes de torns (Matí 10:00-13:00 i Tarda 17:00-20:00) amb les places lliures reals per activitat.
     - Desplegable d'hora d'arribada dinàmic: si es tria matí, mostra 10:00 a 11:00; si es tria tarda, mostra 17:00 a 18:00.
   - **Pas 3: Nombre de places**:
     - Selector numèric limitat pel màxim d'aforament restant disponible per a l'activitat i el torn triat.
   - **Pas 4: Dades de contacte i Confirmació**:
     - Nom complet, telèfon mòbil i email.
     - Pantalla de confirmació amb resum complet, descàrrega d'esdeveniment `.ics` per a agendes i botó directe de contacte per WhatsApp amb el taller.

---

### 4. ESPAI ALUMNE I CARNET DIGITAL (`alumne.html` i `carnet.html`)
1. **Accés segur a l'Espai Alumne (`alumne.html`)**:
   - Accés per identificador (codi `231F`, nom, telèfon o email) i contrasenya / PIN personal.
   - Botó per mostrar/ocultar contrasenya.
2. **Recuperació de Contrasenya (PIN)**:
   - Verificació per doble factor (identificador + telèfon o correu registrat).
   - Mostra el PIN recuperat amb accés en 1 clic i opció de canviar-lo directament.
   - Canal d'ajuda directe a WhatsApp del taller.
3. **Balanç d'hores en temps real**:
   - Comptabilitat exacta al segon expressada en format `HH:MM:SS`.
   - Hores contractades en paquets, hores consumides en sessions i saldo restant disponible.
4. **Compra de Paquets d'Hores**:
   - Botó directe "Comprar Hores" vinculat als enllaços de pagament Stripe segons l'edat de l'alumne (Adults o Infantil, amb tall configurable als 12 anys).
5. **Carnet Digital de l'Alumne amb Codi QR (`carnet.html`)**:
   - Codi identificador personal per al fitxatge presencial al taller.
   - **Suport per a Apple Watch**: Generació de passis `.pkpass` per a l'Apple Wallet de l'iPhone i rellotge.
   - **Suport per a Wear OS / Pixel Watch / Galaxy Watch (Mode Mat OLED)**:
     - Descàrrega d'imatge 1:1 en alta resolució (600x600 px).
     - Fons negre AMOLED pur (`#181514`) que manté els píxels apagats per estalviar bateria.
     - Targeta de porcellana ceràmica mat antirreflex (`#DDD7CE`) amb QR negre d'alt contrast dissenyada per evitar reflexos de llum a l'escàner del taller.

---

### 5. ESCÀNER D'ASSISTÈNCIA AMBIENT DISCRET (`scanner.html`)
1. **Mode Standby Discret ("No es veu res")**:
   - En repòs no mostra la imatge de la càmera a la pantalla de la recepció. Presenta una pantalla fosca artesanal amb el logotip "Roig de Coure" i un indicador subtil de funcionament.
   - La càmera treballa en segon pla analitzant a 20 FPS amb la llibreria `jsQR`.
2. **Detecció automàtica i registre instantani**:
   - En apropar el QR des de mòbil, paper o rellotge: lectura immediata, xiulet suau acústic (Web Audio API), targeta emergent amb cantonades rectes amb el nom de l'alumne, tipus d'acció (Entrada o Sortida) i hores restants.
   - Retorn automàtic al mode discret després de 3 segons.
3. **Gestió de cicles oblidats**:
   - Si un alumne entra i no fitxa la sortida, la sessió roman com a oberta sense bloquejar el sistema.
   - L'administració pot tancar-la manualment o aplicar la durada estàndard per defecte (ex: `02:00:00`).

---

### 6. PANELL D'ADMINISTRACIÓ (`admin.html`)
1. **Seguretat i accés**:
   - Custodiat per una pantalla de bloqueig per PIN (per defecte: `1234`, configurable des del panell).
2. **Barra superior i navegació**:
   - Botó d'acció ràpida **+ Nou Alumne** i botó corporatiu **+ Nova Reserva** integrats a la capçalera amb suport responsive.
   - Menú lateral net (sense signes duplicats).
3. **Gestió d'Alumnes i Fitxa 360° Integrada**:
   - En fer clic a qualsevol fila de la taula d'alumnes s'obre la fitxa completa de l'alumne a la mateixa pantalla, sense modals molestos.
   - Selector de data de naixement que calcula automàticament l'edat en temps real i assigna la tarifa (Adult / Infantil).
   - Pestanyes integrades: Reserves, Sessions/Assistència i Compres de paquets.
   - Botons d'acció directa: Nova reserva per a l'alumne, afegir compra, marcar entrada/sortida i carnet digital.
4. **Gestió de Reserves i Calendari**:
   - Calendari mensual interactiu amb llista de reserves del dia situada **directament a sota del calendari**.
   - Modal de Nova Reserva amb selector de torn de Matí (10:00 a 11:00) i Tarda (17:00 a 18:00).
   - **Reserves Recurrents (Sèries periòdiques)**:
     - Freqüències: Setmanal (+7 dies), Quinzenal (+14 dies) o Mensual (+1 mes).
     - Presets de 4, 8, 12 sessions o personalitzat (fins a 26).
     - Salt automàtic de dies tancats (dilluns, dimarts i festius).
     - Previsualització en temps real d'aforament (`POST /api/reserves/recurrent-preview`).
     - Cancel·lació individual o cancel·lació completa de sèrie en 1 clic (`POST /api/reserves/cancel-serie`).
   - Casella de control de presència ràpida (`Visited`) per marcar l'assistència dels alumnes a classe.
5. **Còpies de seguretat atòmiques (Snapshots SQLite)**:
   - Captures completes de la base de dades amb `sqlite3.backup` a la carpeta `data/snapshots/`.
   - Còpia automàtica diària (retenció de 30 dies) i generació manual en qualsevol moment.
   - Descàrrega directa del fitxer `.db` i restauració segura amb còpia prèvia d'emergència automàtica.

---

### 7. BACKEND EN PYTHON I MODEL DE DADES (`server.py` + SQLite)
1. **Servidor HTTP lleuger**:
   - Desenvolupat sobre `http.server.HTTPServer` i `BaseHTTPRequestHandler` amb gestió multi-fil (`threading`).
2. **Esquema principal de taules SQLite (`ceramica.db`)**:
   - `alumnes`: `id`, `nom`, `cognoms`, `telefon`, `email`, `pin`, `edat`, `data_naixement`, `data_alta`, `actiu`, `notes`.
   - `paquets_hores`: `id`, `student_id`, `data`, `hores`, `segons`, `concepte`, `preu`, `metode_pagament`, `notes`.
   - `sessions`: `id`, `student_id`, `data`, `entrada`, `sortida`, `durada_segons`, `format_hms`, `tipus`, `estat`, `notes`.
   - `reserves`: `id`, `student_id`, `student_nom`, `data`, `hora_inici`, `hora_fi`, `franja`, `activitat`, `activitat_id`, `places`, `telefon`, `email`, `estat`, `hores`, `notes`, `recurrent_id`, `calendar_event_id`, `created_at`.
   - `activitats`: `id`, `nom`, `capacitat_max`, `icon`, `color`, `activa`.
   - `configuracio`: `clau`, `valor`.
   - `dies_festius`: `id`, `data_inici`, `data_fi`, `nom`, `motiu`.
   - `restriccions_activitats`: `id`, `data_inici`, `data_fi`, `tipus_abast`, `activitats_permeses`, `activitats_bloquejades`, `motiu`.
3. **Endpoints REST JSON principals**:
   - `GET /api/reserves/disponibilitat?data=YYYY-MM-DD`: Càlcul independent de matí i tarda per a cada franja i activitat.
   - `GET /api/reserves/mes?any=YYYY&mes=MM`: Disponibilitat de tot el mes.
   - `POST /api/reserves`: Creació atòmica de reserva amb comprovació d'aforament per torn.
   - `POST /api/reserves/recurrent-preview`: Previsualització de sèries periòdiques.
   - `POST /api/reserves/recurrent`: Creació de sèries recurrents.
   - `POST /api/reserves/cancel-serie`: Cancel·lació atòmica de sèries completes.
   - `POST /api/scan`: Validació de codi QR i registre immediat d'assistència.
   - `GET /api/alumnes/verificar?q=...`: Verificació privada d'alumne sense exposar dades de tercers.
   - `POST /api/admin/auth` i `POST /api/admin/change-pin`: Seguretat del panell d'administració.
   - `GET /api/admin/snapshots`, `POST /api/admin/snapshots`, `POST /api/admin/restore-snapshot`: Gestió de còpies de seguretat.
   - `POST /api/alumnes/recuperar-pin` i `POST /api/alumnes/canviar-pin`: Gestió de credencials.

---

### 8. INTEGRACIONS EXTERNES
1. **Google Sheets i Google Calendar**:
   - Sincronització bidireccional asíncrona amb Google Apps Script.
   - Registre automàtic d'alumnes, paquets, sessions i reserves.
   - Hidratació inicial automàtica que protegeix i garanteix la persistència de les franges de matí (`M1`) i tarda (`T1`).
2. **WhatsApp Notificacions (Meta Cloud API Oficial)**:
   - Enviament directe a través de l'API oficial de Meta.
   - Plantilles de confirmació immediata de reserva, recordatori a 48 hores i recordatori el mateix dia al matí.
3. **Passarel·la de pagament Stripe**:
   - Enllaços de compra directa d'hores per a Adults i Infantil.

---

### 9. BATERIA DE PROVES UNITÀRIES
- Suite completa `tests/test_backend.py` amb 34 proves unitàries que cobreixen:
  - Càlcul de segons a hores (`HH:MM:SS`) i balanços d'hores.
  - Cicles de fitxatge, entrades i tancaments per oblit.
  - Disponibilitat, aforament independent de matí i tarda i límits d'activitats.
  - Generació, previsualització i cancel·lació de reserves recurrents.
  - Còpies de seguretat (snapshots) i restauració de la base de dades.
  - Alta d'alumnes amb edat calculada per data de naixement.
  - Execució satisfactòria del 100% de les proves amb `python -m unittest discover tests`.
```
