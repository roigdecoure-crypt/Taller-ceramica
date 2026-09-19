# Auditoría técnica integral — Taller de Cerámica (Roig de Coure)

**Fecha:** 12/09/2026 · **Alcance:** todo el directorio del proyecto: `server.py`, frontend (`admin.html`, `alumne.html`, `reserva.html`, `scanner.html`, `index.html`, `carnet.html`, `js/*`, `css/*`), `sw.js` y manifests PWA, esquema y **datos reales** de `data/ceramica.db`, configuración de despliegue y tests.
**Método:** lectura directa del código y consulta a la base de datos real. Cada hallazgo cita **archivo:línea** con evidencia. Los nueve hallazgos críticos se re-verificaron uno a uno tras la inspección.

---

## 0. Resumen ejecutivo

El sistema es funcional y está pensado para producción (WAL, backups diarios, 1.600 líneas de tests, PWA, escáner QR, cobros). Pero **la autorización es decorativa**: se decide en el navegador y el backend acepta escrituras sin credenciales. El resultado es que hoy, con la aplicación publicada, cualquier persona en Internet puede descargar toda la base de datos, regalarse horas de taller, fichar por otros y borrar o restaurar datos.

Lo más grave, en orden:

1. **La base de datos completa es descargable sin autenticación**: `GET /data/ceramica.db` (el servidor sirve todo el árbol del proyecto como estático) y `GET /api/admin/backups/download?file=ceramica.db` (`server.py:3191-3213`). Dentro: 394 alumnos con **PIN en texto plano** y los tokens de Square y WhatsApp.
2. **Fail-open en la autorización**: las rutas hacen `if role == 'staff': 403`; sin token, `role` es `None` y **pasa**. Afecta a `/api/config`, `/api/festius`, `/api/admin/backups/restore`…
3. **Webhook de Square sin verificar firma** (`server.py:4107-4164`): un POST falsificado crea paquetes de horas, confirma reservas como pagadas y emite vales regalo.
4. **Horas gratis desde el cliente**: `?payment=success&pack=999` en el portal del alumno acredita horas (`js/alumne.js:190-199`) y `POST /api/paquets` no pide credenciales (`server.py:4858-4905`).
5. **Toma de control de cuentas de alumno**: `/api/alumnes/canviar-pin` cambia el PIN de cualquiera si se omite `current_pin` (`server.py:4397, 4410`); `/api/alumnes/registre` lo sobrescribe si coincide el email (`4475-4479`); `/api/alumnes/recuperar-pin` **devuelve el PIN en claro** (`2493-2494`).
6. **XSS almacenado contra el panel de administración** desde el autorregistro público, los vales regalo y los artículos: roba `roig_admin_token` del `localStorage` (`js/admin.js:226, 298-304, 6664, 6727`).
7. **Puerta trasera en el cliente**: con PIN `1234` y un error de red, el panel se desbloquea como *Propietario* (`js/admin.js:4746-4763`).
8. **El aforo por actividad y los días cerrados se saltan desde el cliente** con `forcar_aforament: true` (`server.py:5035`, `js/reserves-calendar.js:1080`).
9. **Integridad**: el cliente se degrada en silencio a `localStorage` devolviendo `ok:true` (`js/store.js:1330-1386`), y en Render el disco es efímero (`render.yaml`, sin `disk:`), así que la base de datos y los backups se pierden en cada despliegue.

---

## 1. Arquitectura global y estructura del código

| Componente | Líneas | Observación |
|---|---:|---|
| `server.py` | **6.731** | Backend completo: HTTP + API + SQL + plantillas HTML + integraciones |
| `js/admin.js` | **7.609** | Panel de administración, un único ámbito global |
| `admin.html` | 3.093 | Vistas y diálogos |
| `reserva.html` | 2.381 | Reserva pública **con su propio frontend autónomo** |
| `js/store.js` | 2.058 | Capa de datos híbrida API/localStorage |
| `js/alumne.js` | 1.826 | Portal del alumno |
| `js/reserves-calendar.js` | 1.300 | Calendario y reservas (portales) |
| `tests/test_backend.py` | 1.612 | Tests sobre la base **real** |
| `alumne.html` | 1.160 | Portal (incluye un script que desregistra el SW) |
| `index.html` | 1.090 | Web pública |
| `carnet.html` | 654 | Carnet imprimible |
| `js/scanner.js` / `scanner.html` | 386 / 207 | Escáner QR |
| `sw.js` | 93 | Service Worker |

### 1.1 Diagnóstico

- **Monolito de un solo archivo.** `class CeramicsRequestHandler` (líneas **2982-6693**, ~3.700 líneas) contiene `do_GET` (3011-3555) y `do_POST` (**3557-6693**): dos cadenas `if/elif path == ...` con **73 rutas**. Lógica de negocio, SQL, HTTP y hasta plantillas HTML conviven en el mismo bloque.
- **Dos implementaciones paralelas del mismo flujo.** `reserva.html` define su propio `ROIG_API_BASE` y su propio calendario/disponibilidad/POST (`reserva.html:1167-1169`), mientras `js/reserves-calendar.js` + `js/store.js` se cargan en `alumne.html:1154-1155` y `admin.html:3089-3090`. La misma regla de negocio está escrita dos veces contra `POST /api/reserves`.
- **Efectos secundarios en el import.** `init_db()` y `create_daily_snapshot_if_needed()` se ejecutan al importar (`server.py:945-946`); los tests hacen `import server` (`tests/test_backend.py:18`) y su `setUp` llama a `server.init_db()` y **borra filas de `data/ceramica.db`** (22-38). No hay base de datos de test.
- **Presentación dentro del backend:** `generate_carnet_svg` (364-469), `generar_targeta_val_regal_html` (2729-2982) y `generate_pkpass` (2496-2622).
- **Configuración dispersa** entre `DEFAULT_ACTIVITATS` (1462), `DEFAULT_FRANGES`, `FESTIUS_CATALUNYA` (1856-1871), el diccionario de `init_db` (752-789) y constantes sueltas; migraciones como `try: ALTER TABLE … except: pass` (546-575, 793-807) sin versión de esquema.
- **Autorización como decoración:** el rol vive en el navegador (`js/admin.js:57, 4677`) y el CSS lo oculta (`css/admin.css:2021-2024`); solo 3 sitios del cliente leen `roig_admin_role` (`js/admin.js:2415-2416, 7544-7548`; `admin.html:42-45`).

### 1.2 Oportunidades de modularización

1. **Partir `server.py` por dominio** (`api/auth`, `api/alumnes`, `api/reserves`, `api/aforament`, `api/pagos`, `api/sync`) con un router tabla `(método, ruta) → handler`.
2. **Middleware de autorización fail-closed** aplicado por defecto, con lista blanca explícita de rutas públicas. Elimina de golpe la clase de fallo más grave.
3. **Capa de datos única** (`db.py`): conexión por hilo, esquema versionado, índices declarados, `PRAGMA foreign_keys=ON`.
4. **Unificar la reserva**: una sola implementación de calendario/disponibilidad para portales y web pública.
5. **Módulos ES** en el frontend para dividir `admin.js` (7.609 líneas) por vistas.
6. **Sacar las plantillas** (carnet, vale, pkpass) del código Python.

---

## 2. Seguridad y gestión de identidad

### 2.1 Lo que está bien (conservar)

- **PBKDF2-HMAC-SHA256** con salt de 16 bytes, 100.000 iteraciones y `secrets.compare_digest` (`server.py:142-149, 160-168`).
- **Tokens de admin** de 256 bits (`token_urlsafe(32)`), persistidos con caducidad por rol (owner 72 h, staff 24 h) y limpieza de caducados (`173-190`).
- **OTP de recuperación** hecho con criterio: 6 dígitos con `secrets.randbelow`, guardado **hasheado**, caducidad de 15 min, un solo uso e invalidación de los anteriores (`4284-4295, 4340-4356`).
- **Sin inyección SQL**: las cuatro `f-string` sobre SQL son seguras (`561` lista fija; `1288-1295` placeholders generados; `5577-5597` fragmentos constantes + parámetros). El resto está parametrizado.
- **Path traversal** contenido al descargar backups (`os.path.basename` + filtro `.db`, `3194-3211`).

### 2.2 Hallazgos

| # | Sev. | Hallazgo | Evidencia |
|---|---|---|---|
| S1 | **Crítica** | La base de datos se sirve como archivo estático: para todo lo que no empieza por `/api/` se delega en `SimpleHTTPRequestHandler` con `directory=BASE_DIR`, sin lista negra de `/data/` → `GET /data/ceramica.db`, `/server.py` y `/data/backups/*.db` responden el archivo. `robots.txt` solo lo pide, no lo impide. | `server.py:2984, 3016-3036`; `robots.txt:6-9` |
| S2 | **Crítica** | `GET /api/admin/backups/download?file=ceramica.db` entrega la base completa **sin credenciales**. | `server.py:3191-3213` |
| S3 | **Crítica** | **Autorización fail-open**: `role = get_request_role(...)` + `if role == 'staff': 403`. Sin cabecera, `role is None` → permitido. Afecta a `/api/admin/change-pin` (4166), `/api/admin/backups` (4188), `/api/admin/backups/restore` (4200), `/api/activitats-info` (6307), `/api/config` (6321), `/api/festius` (6340), `/api/restriccions-activitats` (6381). | `server.py:269-292, 4166-4204, 6321-6381` |
| S4 | **Crítica** | Rutas de escritura **sin ninguna comprobación**: `/api/alumnes`, `/api/checkin`, `/api/tancar-cicle`, `/api/paquets`, `/api/sessions/manual`, `/api/reserves`, `/api/reserves/recurrent`, `/api/reserves/update-serie`, `/api/reserves/update-horari`, `/api/reserves/config-aforament`, `/api/activitats`, `/api/import`, `/api/sync/hydrate`, `/api/vals-regal/*`, `/api/articles`, `/api/checkout/*`. | `server.py:4565, 4643, 4771, 4858, 4907, 4966, 5357, 5653, 5870, 6099, 6136, 6431, 6511, 3634, 3686-3788, 3861-4107` |
| S5 | **Crítica** | **Webhook de Square sin firma**: acepta `type`/`data.object.payment` del cuerpo y actúa (marca reservas pagadas, inserta paquetes, emite vales). La clave `square_webhook_signature_key` existe pero no se usa. | `server.py:4107-4164`; `788` |
| S6 | **Crítica** | `POST /api/import` sin auth **reemplaza filas y toda la tabla `configuracio`**, incluidas `owner_password_hash`/`admin_pin` → toma de control administrativa. | `server.py:6431-6482, 6465-6466` |
| S7 | **Crítica** | `GET /api/alumnes` hace `SELECT *` y devuelve **el PIN en claro** de todos los alumnos con teléfono y email; `GET /api/alumnes/{id}` devuelve la ficha completa (alumno + paquetes + sesiones + reservas). `GET /api/export` vuelca la base entera excluyendo solo `admin_pin`. | `server.py:3218, 3285-3324, 3512-3541 (3529)` |
| S8 | **Crítica** | `GET /api/config` **no pide autenticación** y devuelve todo menos 3 claves: salen `whatsapp_meta_token`, `square_access_token` y `square_webhook_signature_key`. El panel los pinta en inputs. | `server.py:3476-3482`; `js/admin.js:822, 844, 1609, 7435` |
| S9 | **Crítica** | **Horas gratis desde el cliente**: `POST /api/paquets` acredita las horas que le pidan sin credenciales; el portal las acredita leyendo `?payment=success&pack=N` de la URL. | `server.py:4858-4905`; `js/alumne.js:190-199, 1504-1513`; `js/store.js:684-696` |
| S10 | **Crítica** | **Cambio de PIN ajeno**: `current_pin` es opcional (`data.get('current_pin') or None`); si se omite, no se valida nada y se reescribe `pin` + `password_hash` de cualquier alumno. | `server.py:4397, 4410-4420` |
| S11 | **Crítica** | **XSS almacenado contra el panel**: nombre/cognoms/teléfono/email (del autorregistro público), vales regalo (`nom_destinatari`, `nom_comprador`, `missatge`) y artículos (`nom`, `descripcio`) se insertan con `innerHTML` sin escapar; `showToast` también. Permite robar `roig_admin_token`. | `js/admin.js:226, 298-304, 6664, 6681-6682, 6727-6728, 6973, 3515-3518, 515-518, 92`; origen en `server.py:4431-4438, 3951-3959, 3634-3665` |
| S12 | **Crítica** | `POST /api/alumnes/registre`: si coincide email (o el alumno no tenía), **sobrescribe el PIN** → toma de control de la cuenta. `/api/alumnes/recuperar-pin` **devuelve el PIN en claro** tras validar solo teléfono/email, datos que exponen S7/S13. | `server.py:4473-4479`; `2472-2494 (2493)`; `4373-4391` |
| S13 | **Alta** | `/api/alumnes/verificar` (sin auth) confirma existencia de alumnos y devuelve nombre, teléfono y email → enumeración previa al ataque. | `server.py:3229-3253` |
| S14 | **Alta** | **PIN de alumno en texto plano** y **login por PIN de 4 dígitos sin límite de intentos**. Estado real: **393 de 394 alumnos con PIN en claro, 0 con `password_hash`**. Por defecto el PIN es el número de alumno. | `server.py:2451, 4354, 4605-4606, 4611-4622, 2439-2470`; datos verificados |
| S15 | **Alta** | **Puerta trasera en el cliente**: si el backend falla y el PIN es `1234`, el panel se desbloquea como *owner* (flags en `localStorage`, oculta la pantalla de bloqueo y carga los datos). | `js/admin.js:4746-4763` |
| S16 | **Alta** | El token de admin **no se envía** en la mayoría de `fetch` del panel (solo `Store.getAdminAuthHeaders` lo añade); combinado con S3, el panel entero opera sin credenciales y el servidor lo acepta. | `js/admin.js:4719-4726, 1737, 4811, 4875, 6566, 6783, 6870, 6906, 6930, 6967, 7091, 7132, 7181, 7292, 7379, 7422`; `js/store.js:841-849` |
| S17 | **Alta** | **SVG del carnet sin escapar** (`nom`, `cognoms`, `id`): el archivo se descarga como `image/svg+xml` y ejecuta el script al abrirlo. | `js/admin.js:5250-5259, 5265-5270` |
| S18 | **Alta** | `escapeHtml` dentro de atributos `onclick` (el HTML decodifica `&#039;` antes de compilar el JS) y otros handlers inline sin escapar → auto-XSS desde ids editables. | `js/admin.js:6334, 6337, 6341, 6690, 6693, 6697, 6735, 6741, 6747` |
| S19 | **Alta** | Roles aplicados **solo por CSS** (`body.role-staff .staff-hidden{display:none}`); las funciones sensibles (`loadSnapshotsList`, `openConfigModal`, `handleDeleteTaller`, `guardarNouValRegalManual`…) no comprueban rol y están en `window`. | `css/admin.css:2021-2024`; `js/admin.js:4628-4629, 7207-7213` |
| S20 | **Alta** | Recuperación de contraseña **sin rate limiting ni bloqueo** (disparo ilimitado de OTP y sin contador de intentos) y la respuesta revela `student_id`, nombre y teléfono enmascarado. | `server.py:4255-4322, 4324-4371` |
| S21 | **Alta** | El **PIN del alumno se envía a un tercero** (Google Apps Script) desde el cliente con `mode:'no-cors'` y la URL está hardcodeada también en el backend, que la reescribe en cada arranque. | `js/store.js:337, 343-354`; `server.py:769, 890, 950` |
| S22 | **Alta** | Bypass de pago: sin Square configurado, `/api/checkout/paga-senyal` marca la reserva como *"PAGA I SENYAL PAGADA DEMO"* y la confirma; es alcanzable sin auth. El portal también permite simular el pago. | `server.py:3888-3898`; `js/alumne.js:1473-1483` |
| S23 | **Media** | Tokens sin revocación: no hay `logout` que los borre, viven en claro en `auth_tokens` (6 activos) y `admin_pin`/`owner` se guardan en texto plano en `configuracio`. | `server.py:173-190, 3619, 4183, 783` |
| S24 | **Media** | `verify_password` acepta comparación en texto plano si el hash no lleva prefijo `pbkdf2:`. | `server.py:157-159` |
| S25 | **Media** | Credencial por defecto `'1234'` para owner y staff, también documentada en el manual. | `server.py:244-255, 843-846, 783`; `manual-admin.html:331` |
| S26 | **Media** | Escalada de privilegios: `/api/admin/change-pin` valida `oldPin` con `verify_admin_pin` (acepta el PIN de staff) y luego escribe la contraseña de **owner**. | `server.py:4171-4185, 264-267` |
| S27 | **Media** | `get_request_role` acepta el PIN de admin en el cuerpo de cualquier petición y ejecuta PBKDF2 (100 k iteraciones) por intento → agotamiento de CPU. | `server.py:287-291` |
| S28 | **Media** | Datos personales y secretos en el repositorio: URL de Apps Script hardcodeada, teléfono real de un alumno sembrado en `init_db`, e imágenes promocionales con datos del taller. | `server.py:769, 890, 910-913` |
| S29 | **Baja** | CORS `*` en todas las respuestas; `js/api-config.js` y `js/store.js` permiten redirigir el backend a un host arbitrario vía `localStorage.roig_custom_api_base` (con PII dentro de las peticiones). | `server.py:2991-2993`; `js/api-config.js:16-35`; `js/store.js:12-16` |
| S30 | **Baja** | SSRF: `/api/sync/hydrate` acepta una URL arbitraria y la peticiona desde el servidor sin auth. | `server.py:6511-6515` |

---

## 3. Lógica de negocio y gestión de aforos

### 3.1 Cómo está implementado

- **Aforo global = 12**, configurable en `configuracio.aforament_maxim_per_franja` (`get_aforament_maxim`, `2074-2086`).
- Se comprueba **por franja (mañana/tarde)**, no por día: `SUM(places)` de las reservas `confirmada`/`pendent_paga_senyal` de esa fecha y turno (`5123-5136`) — y **ese límite no se puede saltar** (se evalúa antes que el flag de forzar).
- El "total de plazas del día" que expone la API es `max_cap × nº franjas` = **24** (`2123-2124`), coherente porque las franjas no se solapan (10:00-13:00 y 17:00-20:00, sesiones de 2 h).
- **Cupo por actividad** desde la tabla `activitats` (torn 4, modelatge 8, pintar 12): `5138-5163`; la disponibilidad lo refleja con `min(plazas libres franja, plazas libres actividad)` (`2156-2181`).

### 3.2 Hallazgos

| # | Sev. | Hallazgo | Evidencia |
|---|---|---|---|
| A1 | **Crítica** | `forcar_aforament`/`force` viaja en el cuerpo HTTP: **cualquier cliente** (sin auth) salta el cupo por actividad, el bloqueo de actividades y el cierre por festivo/día no lectivo. El límite global de 12 sí aguanta. | `server.py:5035-5041, 5054-5064, 5139`; `js/reserves-calendar.js:1040, 1080` |
| A2 | **Alta** | **Race condition (TOCTOU)**: la comprobación de aforo (`SELECT SUM`) y el `INSERT` no están en una transacción exclusiva; con `ThreadingHTTPServer` dos peticiones simultáneas pueden pasar ambas y superar el cupo. Igual en series y en `update-horari`. | `server.py:5121-5189, 5438-5560, 5955-5998, 6695` |
| A3 | **Alta** | **Fechas y horas sin validar**: `data` no pasa por `sanitize_date_str` (solo se usa al hidratar de Sheets), `hora_inici` nunca se contrasta con `INTERVALS_INICI_2H` y se comparan como cadenas (`>= '14:00'`). Con `force` se insertan fechas inválidas. | `server.py:4968, 5092, 1794-1797, 973-996`; `reserva.html:2234` |
| A4 | **Alta** | **No se rechazan fechas pasadas**: solo se comprueba que la fecha venga informada. El cliente las oculta, la API no. | `server.py:5006-5008, 1873-1921` |
| A5 | **Alta** | Límites de actividad **hardcodeados** en `update-horari` (`4`/`12`/`8` por nombre) en lugar de leer `activitats.capacitat_max`: mover una reserva valida contra otro límite del que usa la creación. | `server.py:5968` vs `5138-5163` |
| A6 | **Alta** | **Reservas fantasma**: si el POST de reserva falla por red, `Store.crearReserva` la crea en `localStorage` y devuelve `{ok:true}`; la UI la muestra como confirmada y el aforo local queda desincronizado. | `js/store.js:1330-1332, 1384-1386` |
| A7 | **Alta** | `calculate_recurring_dates` **ignora el parámetro `skip_closed`**: siempre salta los días cerrados, así que la opción "incluir festivos" no funciona y la serie devuelve menos sesiones sin avisar. | `server.py:2001, 2033-2046` (los llamadores pasan el flag en `5279, 5429, 5745`) |
| A8 | **Media** | La previsualización admite **52** repeticiones y la creación recorta a **26** sin avisar → lo previsualizado no coincide con lo creado. | `server.py:5275-5276` vs `5364-5365` |
| A9 | **Media** | **Sin idempotencia**: `REC-/RES-` usan `int(timestamp)`; dos envíos en el mismo segundo colisionan con la PRIMARY KEY y devuelven el texto crudo de SQLite al cliente; en segundos distintos duplican la reserva o la serie entera. | `server.py:5177, 5501, 5511-5512, 525, 6550-6551` |
| A10 | **Media** | Cancelación de serie por prefijo `id LIKE recurrent_id || '%'` → puede cancelar reservas de otra serie con prefijo común. | `server.py:5577, 5590` |
| A11 | **Media** | Recurrencia mensual degradada: `day = min(día, 28)` se aplica de forma acumulativa, así que una serie que empieza el 31 pasa a ser el 28 para siempre. | `server.py:2048-2054` |
| A12 | **Media** | `update-serie`/`update-horari` no validan formato ni orden de horas (`20:00 → 09:00` acaba con duración 0,5 h). | `server.py:5678-5692, 5881-5902` |
| A13 | **Media** | La reserva pública calcula **toda** la disponibilidad con la primera franja y mezcla los intervalos de mañana y tarde → puede mostrar "completo" un hueco libre o dejar elegir plazas que no existen. | `reserva.html:1316-1347, 1331, 1361, 1386` |
| A14 | **Media** | El calendario de los portales muestra siempre **"de 12"**: usa `this.config?.aforament_maxim_per_franja || 12` y `this.config` nunca se asigna. | `js/reserves-calendar.js:444, 467, 485, 487`; `js/alumne.js:424-427`; `js/admin.js:2460-2464` |
| A15 | **Media** | Festivos de Cataluña **hardcodeados solo para 2026**: a partir de 2027 se tratarán como laborables. | `server.py:1856-1871, 1889-1894` |
| A16 | **Baja** | Criterios de turno duplicados (`franja == 'T1' OR hora_inici >= '14:00'`) repetidos en 6 consultas distintas. | `server.py:2136-2139, 5126-5127, 5145-5146, 5974-5975` |
| A17 | **Baja** | `places` sin tope superior y `init_db` reescribe el catálogo oficial en cada arranque (se pierden las ediciones del admin). | `server.py:4972-4974`; `851, 863-878, 884-891` |

---

## 4. Frontend, experiencia de usuario y PWA

### 4.1 Sincronización cliente-servidor

- **Degradación silenciosa a local**: si `GET /api/status` falla, `js/store.js` pasa a `mode='local'`, siembra datos de demostración con PINs fijos y sigue operando (`js/store.js:43-96`); `getAlumnes`/`getAlumne` también caen al local ante cualquier error y el admin ve datos viejos **sin aviso** (`123-131, 155-161`). En escritura, `crearReserva` devuelve `ok:true` sin haber guardado nada en el servidor (A6).
- **Credenciales en el navegador**: PIN del alumno en `localStorage`/sessionStorage y en la lista de perfiles vinculados (`js/alumne.js:262-265, 693-706, 721-733, 843-855`; `js/store.js:332`), token de admin en `localStorage` (`js/admin.js:4719-4726`), y datos de clientes en cachés persistentes (`js/admin.js:6545, 6576, 6761, 6793`).
- **Auto-login por URL**: `alumne.html?id=…&pin=…` entra directamente (el PIN viaja en la URL, el historial y los `Referer`). | `js/alumne.js:176-203`
- **Fetch sin timeout ni `res.ok` homogéneo**: hay buenas comprobaciones en rutas críticas (`js/admin.js:4711-4716, 4812-4816, 6572, 6789, 7295, 7428`, con `AbortController` de 6 s en `6563`), pero faltan en `js/admin.js:1737, 6888, 6911, 6933, 6968, 7106, 7148, 7186` y en `js/store.js:212-218, 485-492, 687-693` → un 500 en HTML provoca `Unexpected token '<'`; el portal pinta `err.message` como HTML (`js/alumne.js:546`) y el escáner usa `alert()` (`js/scanner.js:127-130`).
- **Estados y carreras**: `adminSelectedDate` es global y las respuestas pueden llegar fuera de orden (`js/admin.js:2254, 3396-3403, 4297-4367`); la navegación lateral tiene listeners duplicados (inline + `addEventListener`), así que cada clic refresca dos veces y **lanza dos sincronizaciones con Google Calendar** (`admin.html:239, 250`; `js/admin.js:923-929`; `admin.html:69-73`); hay `setInterval` de 1 s y 30 s **sin `clearInterval`** (`js/admin.js:103, 2778`) que siguen corriendo con la pantalla de bloqueo puesta.

### 4.2 Escáner QR y portal del alumno

- **El QR es el ID del alumno en claro** (`carnet.html:396`; `js/alumne.js:377, 387, 941, 1571`), sin firma ni caducidad, y los IDs son secuenciales (`server.py:4597-4604`). El QR descargado sirve para siempre.
- `/api/checkin` no pide credenciales y acepta como código el **PIN, el teléfono, el nombre o el email** (`server.py:4643-4652`, `2384-2409`), con `customTime` arbitrario (`4663-4666`). El único freno al doble escaneo es un temporizador de 2 s en el cliente (`js/scanner.js:103-114`).
- El escáner está servido con librerías locales (`lib/html5-qrcode.min.js`, `lib/qrcode.min.js`), sin CDN: bien; pero son bundles minificados sin SRI ni versión verificable.

### 4.3 PWA y caché

| # | Sev. | Hallazgo | Evidencia |
|---|---|---|---|
| F1 | **Crítica** | **`alumne.html` e `index.html` desregistran el Service Worker y borran todas las cachés en cada carga**, contradiciendo el `register` de `js/alumne.js:22-28` y `js/scanner.js:383-385`: el comportamiento offline queda anulado según la carrera entre ambos. | `alumne.html:30-43`; `index.html:203-216` |
| F2 | **Alta** | El SW no precachea nada en `install` y usa *network-first* con fallback fijo a `./alumne.html`: la primera visita offline falla y cualquier navegación sin red (scanner, admin) devuelve el portal del alumno. | `sw.js:4-6, 32-51 (47)` |
| F3 | **Alta** | `manifest-admin.json` y `manifest-scanner.json` declaran `scope` apuntando a un **archivo** (`./admin.html`, `./scanner.html`): scope inválido, puede impedir la instalación o dejar recursos fuera. | `manifest-admin.json:4-7`; `manifest-scanner.json:4-7` |
| F4 | **Media** | `CACHE_NAME` (`v11.5.3`) está desconectado del versionado real de los assets (`?v=11.5.4`, `store.js?v=12.5.0`, `alumne.js?v=12.5.2`, `scanner ?v=9.0`, `index ?v=7.5`) y `activate` borra **todas** las cachés de la origin. | `sw.js:2, 8-14`; `alumne.html:1149-1156` |
| F5 | **Media** | Exclusión de caché por `substring` (`includes('admin')`, `includes('index.html')`…) en lugar de una lista blanca: páginas futuras (p. ej. `carnet.html`, `manual-admin.html`) sí se cachean. *Punto positivo:* las respuestas `/api/` se excluyen, así que **no se cachean datos personales de la API**. | `sw.js:18-30` |
| F6 | **Media** | Iconos: los 192/512 **sí existen** (`icons/icon-192.png`, `icons/icon-512.png`, `apple-touch-icon`, `favicon-*`, `logo.png`, `icon.svg`), pero ninguno se declara `purpose:"maskable"` (recorte sin zona segura en Android). | `manifest.json:11-22`; `icons/` |
| F7 | **Media** | `live_alumne.html` (917 líneas) es un duplicado huérfano —ninguna página lo referencia— con la UI antigua de recuperación que **mostraba el PIN**. | `live_alumne.html:9, 882, 902, 971-978` |
| F8 | **Media** | El atributo `aria-label` del QR se construye con el texto escaneado dentro de HTML; colores de taller y mensajes de error se inyectan en atributos `style`/`innerHTML` sin validar. | `js/qr-engine.js:88, 95`; `js/admin.js:2952, 3129, 3469-3471, 3917, 4367, 4895` |
| F9 | **Baja** | Incoherencias menores: `theme-color` distinto entre `scanner.html:12` (`#1A1817`) y su manifest (`#831D1D`); `index.html` no declara `theme-color`; el embed de Google Maps usa un place-id ficticio (`index.html:968`). |
| F10 | **Baja** | Coherencia de diseño: el estilo de esquinas rectas está aplicado **solo** en el CSS de la web pública (`--radius-*: 0px` en `css/roigdecoure-web.css:30-32`); el panel, el portal y el escáner siguen con radios de 6/12/18 px (`css/styles.css:47-50`) y la home con 8/20 px. En total, 182 usos de `border-radius`. |

**Puntos fuertes del frontend:** cero frameworks; `escapeHtml` correcto y aplicado de forma sistemática en el calendario y las vistas de ocupación (`js/admin.js:2543-2551` y 55 usos); formularios y selectores construidos con DOM/`textContent`; confirmaciones antes de acciones destructivas; restauración de botones en `finally`; estados de carga en login/registro/recuperación del portal; `AbortController` de 6 s en las rutas críticas; antirrebote del escáner; librerías QR autohospedadas; exclusión de `/api/` en el SW.

---

## 5. Rendimiento y base de datos SQLite

### 5.1 Estado verificado de `data/ceramica.db`

```text
journal_mode: wal          integrity_check: ok          sqlite: 3.49.1
alumnes: 394   (PIN en claro: 393 · password_hash: 0)
reserves: 133  (confirmada 67 · pendent_paga_senyal 1 · cancel·lada 65)
reserves huérfanas (sin alumno): 24
auth_tokens activos: 6 · caducados: 0
activitats: 5 · índices definidos por el proyecto: 0
tablas: 14
```

### 5.2 Hallazgos

| # | Sev. | Hallazgo | Evidencia |
|---|---|---|---|
| P1 | **Alta** | **N+1 severo**: `GET /api/alumnes` lanza 1 consulta por alumno y llama a `get_student_balance`, que abre **su propia conexión** y ejecuta 2 consultas más → ~1.200 consultas y ~394 conexiones por carga de la lista. | `server.py:3218-3225, 1436-1460` |
| P2 | **Alta** | **Cero índices** en las consultas más repetidas (aforo por `data`+`estat`+`franja`, saldo por `student_id`, `recurrent_id`, `sessions(student_id, estat)`, `auth_tokens(expires_at)`, `alumnes(telefon)`): escaneo completo de tabla en cada reserva, check-in y panel. | `sqlite_master`; `2110-2116, 5123-5156` |
| P3 | **Alta** | **Conexión nueva por operación** (110 llamadas a `get_db()`): con `ThreadingHTTPServer` y escrituras concurrentes multiplica el riesgo de `SQLITE_BUSY`/`database is locked` en ráfagas (el `timeout=30` mitiga, no elimina). | `server.py:92-95, 6695` |
| P4 | **Media** | `FOREIGN KEY` declaradas pero **`PRAGMA foreign_keys` nunca se activa** → no se aplican (24 reservas huérfanas lo demuestran). | `server.py:503, 519, 542, 472-473`; datos |
| P5 | **Media** | `restore` de backup copia sobre la base **con otras conexiones abiertas** → riesgo de error o corrupción durante la operación. | `server.py:4214-4222` |
| P6 | **Media** | En `render.yaml` (`plan: free`) **no hay disco persistente**: la base y los backups viven en un sistema de archivos efímero y **se pierden en cada reinicio/despliegue**. Además SQLite + estado local impiden escalar a más de una instancia. | `render.yaml`; `Dockerfile:5`; `server.py:115-128` |
| P7 | **Media** | Respuestas y operaciones construidas en memoria completa: `/api/export` serializa la base entera, la descarga de backup lee el archivo entero y `/api/import` + sincronización vuelca todo a memoria y a Sheets. | `server.py:3512-3541, 3204-3212, 6484-6506` |
| P8 | **Media** | Entorno obsoleto: `python:3.9-slim` (EOL) y `PYTHON_VERSION 3.9.6`; `zoneinfo` depende de `tzdata` en `slim` (hay *fallback* manual de DST, correcto pero duplicado). | `Dockerfile:1`; `render.yaml:10-11`; `server.py:26-52` |
| P9 | **Media** | Los tests **mutan la base real** (mismo `DB_PATH`), con `setUp`/`tearDown` que borran filas de producción. | `tests/test_backend.py:18-38`; `server.py:85, 945` |
| P10 | **Baja** | Búsqueda de alumno con ~20 condiciones `OR` sobre `SELECT *` sin índice, usada en cada login, check-in y reserva. | `server.py:2371-2437` |

**Puntos fuertes de datos:** WAL + `synchronous=NORMAL`, snapshot diario automático con purga a 30 días (`97-128`), backup previo a cualquier restauración (`4216`), exportación JSON/CSV y una suite de tests con 166 aserciones sobre horas, saldos y ciclos.

---

## 6. Matriz de deuda técnica y recomendaciones priorizadas

### 6.1 Puntos fuertes (conservar)

| Área | Punto fuerte | Evidencia |
|---|---|---|
| Criptografía | PBKDF2-SHA256 con salt y `compare_digest`; OTP hasheado, de un uso y 15 min | `server.py:142-149, 4284-4295` |
| Sesiones | Tokens de 256 bits con caducidad por rol y limpieza | `server.py:173-190` |
| SQL | Sin inyección: todo parametrizado | `server.py:1288-1295, 2384-2436, 5577` |
| Aforo | **El límite global de 12 se aplica siempre en servidor**, incluso con `forzar_aforamento`, y también en series y `update-horari` | `server.py:5121-5136, 5458-5473, 5947-5964` |
| Datos | WAL, snapshot diario, purga de backups, backup previo a restaurar | `server.py:97-128, 472-473` |
| Tests | 166 aserciones sobre tiempos, saldos, festivos y restricciones | `tests/test_backend.py` |
| Frontend | Sin frameworks, CSS con tokens, `escapeHtml` correcto y sistemático en el calendario, DOM/`textContent` en formularios | `js/admin.js:2543-2551, 678-691, 4129-4142` |
| PWA | Librerías QR autohospedadas; **las respuestas de API no se cachean**; manifests completos con iconos reales | `sw.js:18-30`; `icons/` |
| Negocio | Validación de vales regalo (existencia, estado, caducidad) antes de usarlos | `server.py:4990-5004` |

### 6.2 Acciones priorizadas

#### Críticas (antes de exponer la aplicación a Internet)

| # | Acción | Archivo | Solución recomendada |
|---|---|---|---|
| C1 | Cerrar la descarga de la base de datos | `server.py:2984, 3016-3036, 3191-3213` | Servir estáticos desde un directorio público dedicado (`public/`) o lista negra de `/data/`, `*.db`, `*.py`, `.env`; `/api/admin/backups*` solo con rol **owner**. Sacar `data/` del árbol servido. |
| C2 | Autorización **fail-closed** | `server.py:269-292, 3557, 4166-4204, 6307-6381` | Middleware que exija rol por defecto + lista blanca de rutas públicas; cambiar todo `if role == 'staff'` por `if role != 'owner'`. |
| C3 | Firmar/verificar el webhook de Square | `server.py:4107-4164` | Validar `x-square-hmacsha256-signature` con `square_webhook_signature_key`; confirmar importes contra la API de Square antes de conceder horas o vales. |
| C4 | Verificación de pago **en servidor** | `server.py:4858-4905, 3861-3951`; `js/alumne.js:190-199, 1473-1513` | Acreditar horas solo desde el webhook del PSP; eliminar la acreditación por parámetro de URL y la simulación cuando no hay PSP configurado. |
| C5 | Proteger identidad del alumno | `server.py:4397, 4410-4420, 4473-4479, 2472-2494` | Exigir siempre `current_pin` o sesión; no cambiar el PIN por autorregistro; no devolver nunca el PIN (usar el OTP existente). |
| C6 | Dejar de exponer PII y secretos | `server.py:3218, 3285-3324, 3476-3482, 3512-3541` | DTO con columnas explícitas (sin `pin`/`password_hash`), expurgar `square_*`/`whatsapp_*` de `/api/config` y del export; hashear los PIN de alumno. |
| C7 | Sanear el XSS almacenado del panel | `js/admin.js:226, 298-304, 6664-6682, 6727-6728, 6973, 3515-3518, 515-518, 92` | `escapeHtml`/`textContent` en todas las interpolaciones, validar email/teléfono en el servidor y añadir CSP sin `unsafe-inline`. |
| C8 | Eliminar la puerta trasera del cliente | `js/admin.js:4746-4763` | Quitar el fallback de `1234`; sin respuesta del servidor, denegar y mostrar error. |
| C9 | Autorizar `forcar_aforament` | `server.py:5035, 5054` | Honrarlo solo con token de **owner** verificado; nunca desde el flujo público. |
| C10 | Proteger importación/restauración | `server.py:6431-6482, 6511-6515, 4200-4222` | Rol owner obligatorio; no importar la tabla `configuracio`; validar la URL de hidratación contra lista blanca (evita SSRF). |

#### Altas (2-4 semanas)

| # | Acción | Archivo | Solución recomendada |
|---|---|---|---|
| H1 | Rate limiting y anti-abuso | `server.py:4223-4392` | Límite por IP/identificador (5 intentos/15 min), bloqueo temporal, tope de OTP por alumno/hora y no revelar `student_id`/nombre hasta validar el OTP. |
| H2 | Fichaje con token firmado | `carnet.html:396`; `server.py:4643, 2384-2409` | QR con HMAC + caducidad y `/api/checkin` autenticado; retirar la coincidencia por PIN/nombre/teléfono. |
| H3 | Transacción y idempotencia en aforo | `server.py:5121-5189, 5438-5560, 5955-5998, 5177, 5501` | `BEGIN IMMEDIATE` (o contador por fecha+franja+actividad) y `Idempotency-Key` con `INSERT OR IGNORE`. |
| H4 | Validar entradas de reserva | `server.py:4968, 5006-5008, 5092, 4972` | Fecha ISO con `sanitize_date_str` y rechazo de pasado; `HH:MM` dentro de `INTERVALS_INICI_2H`; `places` acotado; email/teléfono validados. |
| H5 | Tokens: enviar y revocar | `js/admin.js:1737…7422`; `server.py:173-212` | Enviar siempre `Authorization` y añadir `logout` que borre el token (guardando solo su hash). |
| H6 | Índices y conexión por hilo | esquema; `server.py:92-95` | Índices de P2, `PRAGMA foreign_keys=ON`, `threading.local` en lugar de 110 aperturas. |
| H7 | No degradar a local en silencio | `js/store.js:43-96, 123-131, 1330-1386` | Fallar de forma visible; local solo como caché de lectura; nunca devolver `ok:true` sin persistir. |
| H8 | Persistencia real en producción | `render.yaml`; `Dockerfile` | Disco persistente en `data/` (o Postgres) y backups fuera del mismo volumen. |
| H9 | Recurrencia correcta | `server.py:2001-2056, 5275-5276, 5364-5365` | Respetar `skip_closed`, conservar el día original en la recurrencia mensual y compartir el tope de repeticiones entre preview y creación. |
| H10 | PWA coherente | `alumne.html:30-43`; `index.html:203-216`; `sw.js`; `manifest-admin.json` | **Quitar el desregistro del SW**, precachear el app shell, versionar la caché por build y corregir `scope` a `"./"` con iconos `maskable`. |
| H11 | Unificar el aforo mostrado | `js/reserves-calendar.js:444`; `reserva.html:1316-1347` | Usar `totalPlaces`/`placesLliures` que ya envía el servidor y recorrer `data.franges` por franja. |

#### Medias

| # | Acción | Archivo | Solución recomendada |
|---|---|---|---|
| M1 | Rechazar texto plano y credenciales por defecto | `server.py:157-159, 244-255, 783, 843-846` | Obligar a definir credenciales en el primer arranque; eliminar el fallback de comparación directa. |
| M2 | Aislar los tests | `server.py:85, 945`; `tests/test_backend.py:18-38` | `DB_PATH` configurable y base temporal; mover los efectos secundarios a `main()`. |
| M3 | No reescribir el catálogo al arrancar | `server.py:851-891` | Sembrar solo si falta (`INSERT OR IGNORE`); sacar la URL de Apps Script del código. |
| M4 | Errores y timeouts homogéneos | `js/admin.js:1737, 6888-6968, 7106-7186`; `js/store.js:212-218, 485-492` | Comprobar `res.ok`/content-type, `AbortController` en toda escritura y mensajes normalizados (sin `alert` ni volcados SQL). |
| M5 | Liberar recursos del panel | `js/admin.js:103, 2778, 923-929`; `admin.html:239` | `clearInterval` en logout/`beforeunload` y eliminar la doble navegación (evita dobles syncs con Google). |
| M6 | Quitar datos de clientes del navegador | `js/admin.js:6545, 6576, 6761, 6793`; `js/alumne.js:262-265, 693-706` | Memoria/`sessionStorage` y limpieza al cerrar sesión; no persistir credenciales. |
| M7 | Salir del PIN de 4 dígitos | `server.py:2439-2470, 4605-4606` | PIN aleatorio de 6 dígitos + bloqueo por intentos; separar el código de fichaje de la contraseña. |
| M8 | Restauración en frío y backups fuera del volumen | `server.py:4214-4222`; `render.yaml` | Restaurar con la base cerrada (`VACUUM INTO` + swap atómico) y copias en almacenamiento externo. |
| M9 | Actualizar el entorno | `Dockerfile`; `render.yaml` | Python 3.12 con `tzdata`; dependencias fijadas. |
| M10 | Eliminar el HTML huérfano e incoherencias PWA | `live_alumne.html`; `scanner.html:12`; `index.html:968` | Borrar o redirigir `live_alumne.html`; unificar `theme-color` y el embed de Maps. |
| M11 | Escapar SVG y atributos inyectados | `js/admin.js:5250-5259, 2952, 6334-6747`; `js/qr-engine.js:88` | Escapar XML, validar colores con `^#[0-9A-Fa-f]{6}$` y sustituir handlers inline por `addEventListener` + `dataset`. |

#### Bajas / opcionales

| # | Acción | Archivo | Solución recomendada |
|---|---|---|---|
| B1 | Unificar diseño (esquinas rectas) | `css/styles.css:47-50`, `css/home.css:37-38` | Llevar los tokens de radio a 0 px o hacerlos configurables por tema. |
| B2 | Consolidar CSS duplicado | `css/` (5 hojas, ~4.500 líneas) | Dos hojas (app + web) con tokens compartidos. |
| B3 | Modularizar el backend | `server.py` | Router + `api/*.py` por dominio; plantillas fuera del código. |
| B4 | Módulos ES en el frontend | `js/admin.js`, `admin.html` | Dividir por vistas con `type="module"`. |
| B5 | SRI en las librerías vendorizadas | `lib/*.js` | Fijar versión upstream, hash SRI y licencia documentada. |
| B6 | Documentación operativa y accesibilidad | `README.md`, `*.html` | Documentar despliegue real, rotación de secretos y backup/restore; revisar contraste, foco y ARIA. |
| B7 | Festivos parametrizables | `server.py:1856-1871` | Tabla por año o API de festivos en lugar de lista fija de 2026. |

---

## Anexo — Cómo cerrar el riesgo crítico en una tarde

1. Bloquear `/data/`, `*.db` y `*.py` en el servidor estático y exigir owner en `/api/admin/backups*` **(C1)**.
2. Cambiar los ocho `if role == 'staff'` por `if role != 'owner'` y añadir un guardia al inicio de `do_POST` **(C2, C9)**.
3. Validar la firma del webhook de Square y quitar la acreditación de horas desde el cliente **(C3, C4)**.
4. Exigir `current_pin` (o sesión) en el cambio de PIN y dejar de devolver el PIN **(C5)**.
5. Excluir `pin`, `password_hash` y los secretos de `square_*`/`whatsapp_*` de las respuestas JSON **(C6)**.
6. Escapar las interpolaciones del panel y eliminar el fallback `1234` **(C7, C8)**.

Con esos seis cambios desaparece la práctica totalidad de la superficie que hoy permite descargar la base de datos, regalarse horas, fichar por otros y tomar el control del panel.

---

*Informe elaborado a partir de la inspección directa del código y de la base de datos del proyecto, con verificación de los hallazgos críticos. No se ha modificado ningún archivo del proyecto.*
