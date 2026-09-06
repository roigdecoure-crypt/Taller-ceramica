# PROMPT MESTRE OPERATIU: SISTEMA DE GESTIÓ I RESERVES "ROIG DE COURE"

> **Instrucció d'ús:** Copia i enganxa tot el text següent en qualsevol nou xat o entorn d'IA per recrear, configurar o regenerar el projecte complet amb totes les funcionalitats, regles de negoci i disseny actuals en una sola ordre.

---

```markdown
Ets un enginyer de programari sènior i dissenyador web. Desenvolupa o configura el sistema web complet de gestió i reserves per al taller de ceràmica artesanal "Roig de Coure".

Aquest projecte consta d'un backend en Python (amb SQLite) i un frontend responsive en HTML5, CSS modern i JavaScript pur (sense frameworks pesants), tot en català.

Segueix estrictament els següents requisits funcionals, d'arquitectura, de disseny i de privacitat:

---

### 1. REGLA ESTÈTICA GLOBAL I IDENTITAT DE MARCA
1. **Nom de marca**: "Roig de Coure" (títol prominent, estètica artesanal, elegant i càlida).
2. **Paleta de colors**: Terracota/roig argila (#831D1D / #C25E3A), tons càlids de fons (#FAF7F5, #FFF8F6, #FFFFFF), text fosc contrastat (#2C221E) i tons verds suaus per a confirmacions (#5E7E6F, #EEF5F1).
3. **REGISTRE DE ZERO ICONES**: No utilitzis cap icona (FontAwesome, SVG d'icones) ni emoticones/emojis a cap part de l'aplicació (ni a botons, ni a títols, ni a targetes, ni a avisos). Utilitza exclusivament tipografia neta, majúscules suaus, vores elegants i caràcters bàsics com '‹' o '›' per a navegació.
4. **Menú mòbil**: En pantalla mòbil (responsive), la barra de navegació superior s'ha de plegar obligatòriament en un botó hamburguesa de 3 línies que obri un menú desplegable suau que es tanqui en prémer qualsevol enllaç.
5. **Idioma**: Tota la interfície, formularis, dates i missatges han d'estar en català.

---

### 2. HORARIS DEL TALLER I REGLES D'AFORAMENT
1. **Dies de funcionament**:
   - Obert: **Dimecres a Diumenge** (10:00 h a 13:00 h i 17:00 h a 20:00 h).
   - Tancat: **Dilluns i Dimarts** (descans setmanal del taller).
2. **Aforament màxim del taller**: 12 persones simultànies en total entre totes les activitats.
3. **Activitats i límits simultanis**:
   - **Torn de terrissaire**: màxim 4 torns físics.
   - **Modelatge i escultura**: fins a 8 places (limitat pel global de 12).
   - **Pintar ceràmica**: fins a 12 places (limitat pel global de 12).
4. **Durada de les sessions**: Reserves públiques de 2 hores amb arribada flexible de 10:00 a 11:00 cada 15 minuts (10:00, 10:15, 10:30, 10:45, 11:00).

---

### 3. PÀGINA DE RESERVA PÚBLICA (`reserva.html`)
Desenvolupa un assistent de reserva pas a pas:
- **Pas 1: Tria d'activitat**:
  - Targetes per a Torn, Modelatge i Pintar ceràmica.
  - **Opció Val Regal**: Selector visible "Tinc un val regal". NO demanis número ni codi de val; només permet escollir quina activitat porta el val (Torn, Modelatge o Pintar). En marcar aquesta opció, obliga automàticament a reservar a primera hora (10:00 h a 12:00 h) amb un avís informatiu clar.
  - **Opció Sóc Alumne (Privacitat Estricta RGPD)**:
    - NO mostris mai un desplegable públic amb els noms dels altres alumnes del taller.
    - Ofereix una verificació privada individualitzada on l'alumne pot triar identificar-se:
      a) Escrivint el seu Nom i Cognoms en un camp i prement "Verificar".
      b) Escrivint el seu Codi d'Alumne (ex: TC-101 o 101, insensible a majúscules) i prement "Verificar".
    - El backend verifica l'existència (`/api/alumnes/verificar?q=...`) i només mostra la confirmació del propi alumne trobat, autocompletant les seves dades de contacte al Pas 4 i vinculant el seu `student_id` a la reserva.
- **Pas 2: Data i Franja Horària (Calendari Visual Incrustat)**:
  - NO utilitzis un simple camp `<input type="date">`. Mostra un calendari mensual visual directament incrustat a la pantalla.
  - Dies organitzats de Dl a Dg. Dilluns i Dimarts marcats com a "Tancat" (descans) i no clicables.
  - Dies passats desactivats. Dies de Dc a Dg clicables i destacats.
  - Botons de navegació de mesos ('‹', 'Avui', '›') amb bloqueig per no anar a mesos passats.
  - En fer clic a un dia, ressalta'l en fons terracota (#831D1D) amb lletra blanca i carrega instantàniament les franges de 2 hores d'aquell dia via API de disponibilitat.
  - Mostra a sota el rètol de la data seleccionada en català ("Diumenge, 6 de setembre de 2026").
- **Pas 3: Nombre de persones**:
  - Selector de places fins al màxim disponible segons l'activitat i aforament lliure en aquella franja.
- **Pas 4: Dades de contacte**:
  - Nom complet, telèfon mòbil i email per rebre la confirmació.
- **Confirmació**:
  - Pantalla d'èxit amb resum complet, botó per descarregar calendari (.ics / Google Calendar) i botó de WhatsApp directe amb el taller.

---

### 4. ESPAI ALUMNE (`alumne.html`)
- Títol de marca "Roig de Coure" gran i visible.
- Accés per codi d'alumne (ex: TC-101 o 101, insensible a majúscules/minúscules), telèfon o PIN.
- El botó d'accés ha de dir exactament "Accedir al Meu Espai" (sense enllaç a pàgina d'inici).
- Panell amb saldo d'hores contractades, hores consumides i hores disponibles.
- Targeta del paquet d'hores actiu.
- Botó d'acció amb el text exacte "Comprar Hores" (sense opció de Bizum; enllaç directe o instruccions de compra).
- Codi QR personal de l'alumne per a l'assistència al taller.
- Historial de reserves fetes i assistències registrades.

---

### 5. ESCÀNER D'ASSISTÈNCIA PRESENCIAL (`scanner.html`)
- Dissenyat per a tauletes o mòbils a l'entrada del taller per escanejar el QR de l'alumne.
- **Mode Standby Ambient Discret ("No es veu res")**:
  - En repòs, no mostris la pantalla de la càmera de seguretat oberta. Mostra una pantalla neta, fons fosc elegant amb el logotip tipogràfic discret "Roig de Coure" i un subtil indicador de l'estat de l'escàner.
  - La càmera treballa en segon pla (hidden/opacitat transparent) analitzant el flux a 20 FPS amb la llibreria `jsQR`.
  - En passar el QR per davant: detecció automàtica instantània, xiulet suau de confirmació (Web Audio API), targeta emergent verda de benvinguda amb el nom de l'alumne i les hores restants, registre automàtic al backend i retorn automàtic al mode discret després de 3 segons.
  - Botó d'opcions discret per canviar de càmera frontal/posterior.

---

### 6. PANELL D'ADMINISTRACIÓ (`admin.html`)
- Gestió global de reserves: calendari mensual i selector per dies.
- **Ubicació de la llista de reserves**: Col·loca la llista de reserves del dia seleccionat **directament a sota del calendari**.
- Disseny responsive de la taula/llista de reserves perquè s'ajusti perfectament a l'amplada del navegador sense barres de desplaçament innecessàries.
- Neteja de botons redundants a la capçalera i interfície.
- Pestañas per a: Reserves, Alumnes, Paquets d'hores, Assistències presencials, Configuració de vacances/festius i paràmetres d'aforament.
- Exportació a Excel d'alumnes i assistències.

---

### 7. BACKEND EN PYTHON I BASE DE DADES (`server.py` + SQLite)
- Servidor autònom basat en `http.server` de Python i SQLite (`ceramica.db`).
- Taules principals: `alumnes`, `paquets_hores`, `reserves`, `assistències`, `configuracio`, `dies_tancats`.
- Endpoints REST JSON:
  - `GET /api/reserves/disponibilitat?data=YYYY-MM-DD`: Càlcul dinàmic de places lliures per activitat i franja.
  - `GET /api/reserves/mes?any=YYYY&mes=MM`: Disponibilitat de tot el mes (festius, tancats, estat d'ocupació).
  - `GET /api/alumnes/verificar?q=...`: Verificació privada d'alumne per nom o codi sense retornar llistes d'altres usuaris.
  - `POST /api/reserves`: Creació de reserva amb comprovació atòmica d'aforament.
  - `POST /api/scan`: Validació de codi QR i registre immediat d'assistència.
  - `GET /api/alumnes/me?codi=...`: Consulta privada de saldo i reserves de l'alumne.
  - Endpoints d'administració d'alumnes, paquets i exportació d'assistències.
- Suport per mantenir sincronitzada qualsevol carpeta mirall del projecte (`taller-ceramica-hores/`).
- Bateria de proves unitàries a `tests/test_backend.py` per garantir que tots els fluxos crítics funcionen correctament.
```
