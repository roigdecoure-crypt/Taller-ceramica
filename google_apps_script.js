/**
 * google_apps_script.js - Sincronitzacio Bidireccional i Hidratacio per al Taller de Ceramica
 * 
 * INSTRUCCIONS DE CONFIGURACIO:
 * 1. Obre un nou full de calcul a https://sheets.new (anomena-l "Taller de Ceramica - Dades").
 * 2. Al menu superior, ves a: Extensions > Apps Script.
 * 3. Esborra qualsevol codi que hi hagi i enganxa tot aquest contingut.
 * 4. Fes clic a: Implementar (Deploy) > Nova implementacio (New deployment).
 * 5. Selecciona el tipus: Aplicacio web (Web app).
 * 6. Executa com a: "Jo" (El teu compte).
 * 7. Qui te acces: "Tothom" (Anyone).
 * 8. Fes clic a "Implementar" i copia l-URL que et doni (acaba en /exec).
 * 9. Posa aquest URL com a Variable d-Entorn a Render: GOOGLE_SHEETS_URL
 *    o enganxa-l a l-apartat de Configuracio d-admin.html.
 */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "get_all";
  
  if (action === "ping") {
    return jsonResponse({ status: "ok", missatge: "Connexio activa amb Google Sheets del Taller de Ceramica!" });
  }

  // Per defecte retorna totes les dades per a la hidratacio inicial
  return handleGetAll();
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(15000);

  try {
    var rawData = e.postData.contents;
    var data = JSON.parse(rawData);
    var action = data.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === "get_all" || action === "hydrate") {
      return handleGetAll();
    } else if (action === "sync_all") {
      syncAlumnes(ss, data.alumnes || []);
      syncPaquets(ss, data.paquets || []);
      syncSessions(ss, data.sessions || []);
      if (data.reserves) syncReserves(ss, data.reserves || []);
      if (data.config) syncConfig(ss, data.config);
      return jsonResponse({ status: "success", message: "Sincronitzacio completa realitzada amb exit!" });
    } else if (action === "sync_alumne") {
      upsertAlumneRow(ss, data.payload || data.alumne);
      return jsonResponse({ status: "success", message: "Alumne actualitzat a Google Sheets" });
    } else if (action === "checkin" || action === "add_session") {
      upsertSessionRow(ss, data.payload || data.session);
      return jsonResponse({ status: "success", message: "Entrada/Sessio registrada a Google Sheets" });
    } else if (action === "checkout" || action === "update_session" || action === "force_close" || action === "manual_session") {
      upsertSessionRow(ss, data.payload || data.session);
      return jsonResponse({ status: "success", message: "Sessio actualitzada a Google Sheets" });
    } else if (action === "add_paquet") {
      appendPaquetRow(ss, data.payload || data.paquet);
      return jsonResponse({ status: "success", message: "Paquet d-hores afegit a Google Sheets" });
    } else if (action === "delete_session") {
      deleteSessionRow(ss, (data.payload && data.payload.id) ? data.payload.id : data.id);
      return jsonResponse({ status: "success", message: "Sessio eliminada de Google Sheets" });
    } else if (action === "delete_paquet") {
      deletePaquetRow(ss, (data.payload && data.payload.id) ? data.payload.id : data.id);
      return jsonResponse({ status: "success", message: "Paquet eliminat de Google Sheets" });
    } else if (action === "add_reserva" || action === "update_reserva") {
      upsertReservaRow(ss, data.payload || data.reserva);
      return jsonResponse({ status: "success", message: "Reserva desada a Google Sheets" });
    } else if (action === "cancel_reserva") {
      cancelReservaRow(ss, data.payload || data.reserva);
      return jsonResponse({ status: "success", message: "Reserva cancel·lada a Google Sheets" });
    } else if (action === "delete_reserva") {
      deleteReservaRow(ss, (data.payload && data.payload.id) ? data.payload.id : data.id);
      return jsonResponse({ status: "success", message: "Reserva eliminada de Google Sheets" });
    } else if (action === "sync_reserves") {
      syncReserves(ss, data.reserves || []);
      return jsonResponse({ status: "success", message: "Reserves sincronitzades a Google Sheets" });
    } else if (action === "save_config") {
      var cfgPayload = data.payload || {};
      for (var cfgKey in cfgPayload) {
        if (cfgPayload.hasOwnProperty(cfgKey)) {
          upsertConfigKey(ss, cfgKey, cfgPayload[cfgKey]);
        }
      }
      return jsonResponse({ status: "success", message: "Configuracio actualitzada a Google Sheets" });
    }

    return jsonResponse({ status: "error", message: "Accio desconeguda: " + action });
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Llegeix totes les dades actives de les fulles per a la hidratacio
function handleGetAll() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var alumnes = readAlumnes(ss);
  var paquets = readPaquets(ss);
  var sessions = readSessions(ss);
  var reserves = readReserves(ss);
  var config = readConfig(ss);

  return jsonResponse({
    status: "success",
    data: {
      alumnes: alumnes,
      paquets: paquets,
      sessions: sessions,
      reserves: reserves,
      config: config
    }
  });
}

function getOrCreateSheet(ss, name, headers, color) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length > 0) {
      sheet.appendRow(headers);
      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground(color || "#C25E3A");
      headerRange.setFontColor("#FFFFFF");
      headerRange.setFontWeight("bold");
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

/* ==================== ALUMNES ==================== */

var HEADERS_ALUMNES = ["ID Alumne", "Nom", "Cognoms", "Telefon", "Email", "PIN", "Data Alta", "Notes", "Actiu"];

function syncAlumnes(ss, alumnes) {
  var sheet = getOrCreateSheet(ss, "Alumnes", HEADERS_ALUMNES, "#C25E3A");
  sheet.clearContents();
  sheet.appendRow(HEADERS_ALUMNES);
  sheet.getRange(1, 1, 1, HEADERS_ALUMNES.length).setBackground("#C25E3A").setFontColor("#FFFFFF").setFontWeight("bold");
  sheet.setFrozenRows(1);

  if (alumnes.length > 0) {
    var rows = alumnes.map(function(a) {
      return [
        a.id || "",
        a.nom || "",
        a.cognoms || "",
        a.telefon || "",
        a.email || "",
        a.pin || "",
        a.data_alta || "",
        a.notes || "",
        (a.actiu === undefined || a.actiu === null ? 1 : a.actiu)
      ];
    });
    sheet.getRange(2, 1, rows.length, HEADERS_ALUMNES.length).setValues(rows);
  }
}

function readAlumnes(ss) {
  var sheet = ss.getSheetByName("Alumnes");
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  var result = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[0]) continue;
    result.push({
      id: String(r[0]).trim(),
      nom: String(r[1] || "").trim(),
      cognoms: String(r[2] || "").trim(),
      telefon: String(r[3] || "").trim(),
      email: String(r[4] || "").trim(),
      pin: String(r[5] || "").trim(),
      data_alta: String(r[6] || "").trim(),
      notes: String(r[7] || "").trim(),
      actiu: Number(r[8] !== "" ? r[8] : 1)
    });
  }
  return result;
}

function upsertAlumneRow(ss, a) {
  if (!a || !a.id) return;
  var sheet = getOrCreateSheet(ss, "Alumnes", HEADERS_ALUMNES, "#C25E3A");
  var values = sheet.getDataRange().getValues();
  var rowIdx = -1;

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === String(a.id).trim()) {
      rowIdx = i + 1;
      break;
    }
  }

  var rowData = [
    a.id,
    a.nom || "",
    a.cognoms || "",
    a.telefon || "",
    a.email || "",
    a.pin || "",
    a.data_alta || new Date().toISOString(),
    a.notes || "",
    (a.actiu === undefined || a.actiu === null ? 1 : a.actiu)
  ];

  if (rowIdx !== -1) {
    sheet.getRange(rowIdx, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }
}

/* ==================== COMPRES D-HORES ==================== */

var HEADERS_PAQUETS = ["ID Compra", "ID Alumne", "Data Compra", "Hores", "Durada Segons", "Concepte", "Preu (EUR)", "Metode Pagament", "Notes"];

function syncPaquets(ss, paquets) {
  var sheet = getOrCreateSheet(ss, "Compres Hores", HEADERS_PAQUETS, "#5E7E6F");
  sheet.clearContents();
  sheet.appendRow(HEADERS_PAQUETS);
  sheet.getRange(1, 1, 1, HEADERS_PAQUETS.length).setBackground("#5E7E6F").setFontColor("#FFFFFF").setFontWeight("bold");
  sheet.setFrozenRows(1);

  if (paquets.length > 0) {
    var rows = paquets.map(function(p) {
      return [
        p.id || "",
        p.student_id || "",
        p.data || "",
        p.hores || 0,
        p.segons || Math.round((p.hores || 0) * 3600),
        p.concepte || "",
        p.preu || 0,
        p.metode_pagament || "Stripe",
        p.notes || ""
      ];
    });
    sheet.getRange(2, 1, rows.length, HEADERS_PAQUETS.length).setValues(rows);
  }
}

function readPaquets(ss) {
  var sheet = ss.getSheetByName("Compres Hores");
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  var result = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[0]) continue;
    result.push({
      id: String(r[0]).trim(),
      student_id: String(r[1] || "").trim(),
      data: String(r[2] || "").trim(),
      hores: Number(r[3] || 0),
      segons: Number(r[4] || 0),
      concepte: String(r[5] || "").trim(),
      preu: Number(r[6] || 0),
      metode_pagament: String(r[7] || "Stripe").trim(),
      notes: String(r[8] || "").trim()
    });
  }
  return result;
}

function appendPaquetRow(ss, p) {
  if (!p || !p.id) return;
  var sheet = getOrCreateSheet(ss, "Compres Hores", HEADERS_PAQUETS, "#5E7E6F");
  var sec = p.segons || Math.round((p.hores || 0) * 3600);
  sheet.appendRow([
    p.id || "",
    p.student_id || "",
    p.data || new Date().toISOString(),
    p.hores || 0,
    sec,
    p.concepte || "",
    p.preu || 0,
    p.metode_pagament || "Stripe",
    p.notes || ""
  ]);
}

function deletePaquetRow(ss, packId) {
  if (!packId) return;
  var sheet = ss.getSheetByName("Compres Hores");
  if (!sheet) return;
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === String(packId).trim()) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

/* ==================== SESSIONS I ASSISTENCIA ==================== */

var HEADERS_SESSIONS = ["ID Sessio", "ID Alumne", "Data", "Hora Entrada", "Hora Sortida", "Durada Segons", "Durada H:m:s", "Metode", "Estat", "Notes"];

function syncSessions(ss, sessions) {
  var sheet = getOrCreateSheet(ss, "Sessions i Assistencia", HEADERS_SESSIONS, "#3A4F66");
  sheet.clearContents();
  sheet.appendRow(HEADERS_SESSIONS);
  sheet.getRange(1, 1, 1, HEADERS_SESSIONS.length).setBackground("#3A4F66").setFontColor("#FFFFFF").setFontWeight("bold");
  sheet.setFrozenRows(1);

  if (sessions.length > 0) {
    var rows = sessions.map(function(s) {
      return [
        s.id || "",
        s.student_id || "",
        s.data || "",
        s.entrada || "",
        s.sortida || "",
        s.durada_segons || 0,
        s.format_hms || "00:00:00",
        s.tipus || "qr",
        s.estat || "oberta",
        s.notes || ""
      ];
    });
    sheet.getRange(2, 1, rows.length, HEADERS_SESSIONS.length).setValues(rows);
  }
}

function readSessions(ss) {
  var sheet = ss.getSheetByName("Sessions i Assistencia");
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  var result = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[0]) continue;
    result.push({
      id: String(r[0]).trim(),
      student_id: String(r[1] || "").trim(),
      data: String(r[2] || "").trim(),
      entrada: String(r[3] || "").trim(),
      sortida: r[4] ? String(r[4]).trim() : null,
      durada_segons: Number(r[5] || 0),
      format_hms: String(r[6] || "00:00:00").trim(),
      tipus: String(r[7] || "qr").trim(),
      estat: String(r[8] || "oberta").trim(),
      notes: String(r[9] || "").trim()
    });
  }
  return result;
}

function upsertSessionRow(ss, s) {
  if (!s || !s.id) return;
  var sheet = getOrCreateSheet(ss, "Sessions i Assistencia", HEADERS_SESSIONS, "#3A4F66");
  var values = sheet.getDataRange().getValues();
  var rowIdx = -1;

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === String(s.id).trim()) {
      rowIdx = i + 1;
      break;
    }
  }

  var rowData = [
    s.id,
    s.student_id || "",
    s.data || (s.entrada ? s.entrada.slice(0, 10) : ""),
    s.entrada || "",
    s.sortida || "",
    s.durada_segons || 0,
    s.format_hms || "00:00:00",
    s.tipus || "qr",
    s.estat || "oberta",
    s.notes || ""
  ];

  if (rowIdx !== -1) {
    sheet.getRange(rowIdx, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }
}

function deleteSessionRow(ss, sessId) {
  if (!sessId) return;
  var sheet = ss.getSheetByName("Sessions i Assistencia");
  if (!sheet) return;
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === String(sessId).trim()) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

/* ==================== CONFIGURACIO ==================== */

var HEADERS_CONFIG = ["Clau", "Valor"];

function syncConfig(ss, cfg) {
  var sheet = getOrCreateSheet(ss, "Configuracio", HEADERS_CONFIG, "#8D6E63");
  sheet.clearContents();
  sheet.appendRow(HEADERS_CONFIG);
  var keys = Object.keys(cfg);
  if (keys.length > 0) {
    var rows = keys.map(function(k) { return [k, cfg[k] || ""]; });
    sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  }
}

function readConfig(ss) {
  var sheet = ss.getSheetByName("Configuracio");
  if (!sheet) return {};
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return {};

  var result = {};
  for (var i = 1; i < values.length; i++) {
    var k = values[i][0];
    if (k) result[String(k).trim()] = String(values[i][1] || "").trim();
  }
  return result;
}

function upsertConfigKey(ss, key, val) {
  if (!key) return;
  var sheet = getOrCreateSheet(ss, "Configuracio", HEADERS_CONFIG, "#8D6E63");
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === String(key).trim()) {
      sheet.getRange(i + 1, 2).setValue(String(val || ""));
      return;
    }
  }
  sheet.appendRow([String(key), String(val || "")]);
}

/* ==================== RESERVES & AFORAMENT ==================== */

var HEADERS_RESERVES = ["ID Reserva", "ID Alumne", "Nom Alumne", "Telèfon", "Data", "Hora Inici", "Hora Fi", "Franja", "Activitat", "Places", "Estat", "Hores", "Notes", "Creat El", "Calendar Event ID"];

function syncReserves(ss, reserves) {
  var sheet = getOrCreateSheet(ss, "Reserves", HEADERS_RESERVES, "#2E7D32");
  sheet.clearContents();
  sheet.appendRow(HEADERS_RESERVES);
  sheet.getRange(1, 1, 1, HEADERS_RESERVES.length).setBackground("#2E7D32").setFontColor("#FFFFFF").setFontWeight("bold");
  sheet.setFrozenRows(1);

  if (reserves && reserves.length > 0) {
    var rows = reserves.map(function(r) {
      return [
        r.id || "",
        r.student_id || "",
        r.student_nom || "",
        r.telefon || "",
        r.data || "",
        r.hora_inici || "",
        r.hora_fi || "",
        r.franja || "",
        r.activitat || "Torn",
        parseInt(r.places || 1, 10),
        r.estat || "confirmada",
        (r.hores !== undefined && r.hores !== null ? r.hores : 1.5),
        r.notes || "",
        r.created_at || "",
        r.calendar_event_id || ""
      ];
    });
    sheet.getRange(2, 1, rows.length, HEADERS_RESERVES.length).setValues(rows);
  }
}

function readReserves(ss) {
  var sheet = ss.getSheetByName("Reserves");
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  var result = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[0]) continue;
    result.push({
      id: String(row[0]).trim(),
      student_id: String(row[1] || "").trim(),
      student_nom: String(row[2] || "").trim(),
      telefon: String(row[3] || "").trim(),
      data: String(row[4] || "").trim(),
      hora_inici: String(row[5] || "10:00").trim(),
      hora_fi: String(row[6] || "11:30").trim(),
      franja: String(row[7] || "F1").trim(),
      activitat: String(row[8] || "Torn").trim(),
      activitat_id: String(row[8] || "torn").toLowerCase().replace(/[^a-z]/g, ''),
      places: parseInt(row[9] || 1, 10),
      estat: String(row[10] || "confirmada").trim(),
      hores: Number(row[11]) || 1.5,
      notes: String(row[12] || "").trim(),
      created_at: String(row[13] || "").trim(),
      calendar_event_id: String(row[14] || "").trim()
    });
  }
  return result;
}

// Cerca el calendari "roigdecoure" (o el configurat) amb tolerància a espais i majúscules/minúscules
function getRoigDeCoureCalendar(preferredName) {
  if (typeof CalendarApp === "undefined") return null;
  try {
    var rawPreferred = (preferredName || "roigdecoure").trim();
    var targetClean = rawPreferred.toLowerCase().replace(/[\s_\-]+/g, ""); // "roigdecoure"
    var cals = CalendarApp.getAllCalendars();
    for (var i = 0; i < cals.length; i++) {
      var cName = (cals[i].getName() || "").toLowerCase();
      var cNameClean = cName.replace(/[\s_\-]+/g, "");
      // Coincidència exacta o neta (sense espais, tolerant a majúscules)
      if (cNameClean === targetClean || cNameClean.indexOf(targetClean) !== -1 || targetClean.indexOf(cNameClean) !== -1) {
        return cals[i];
      }
    }
    // Provar cerca directa per nom
    var named = CalendarApp.getCalendarsByName(rawPreferred);
    if (named && named.length > 0) return named[0];
    var namedAlt = CalendarApp.getCalendarsByName("roigdecoure");
    if (namedAlt && namedAlt.length > 0) return namedAlt[0];
    var namedAlt2 = CalendarApp.getCalendarsByName("Roig de Coure");
    if (namedAlt2 && namedAlt2.length > 0) return namedAlt2[0];

    // Fallback al calendari per defecte de l'usuari si no es troba
    return CalendarApp.getDefaultCalendar();
  } catch (err) {
    Logger.log("Avís obtenint calendari: " + err.toString());
    try {
      return CalendarApp.getDefaultCalendar();
    } catch (e2) {
      return null;
    }
  }
}

function upsertReservaRow(ss, r) {
  if (!r || !r.id) return;
  var sheet = getOrCreateSheet(ss, "Reserves", HEADERS_RESERVES, "#2E7D32");
  var values = sheet.getDataRange().getValues();

  var calEventId = r.calendar_event_id || "";
  // Sincronització amb Google Calendar si la reserva és confirmada
  if (r.estat !== "cancel·lada") {
    var createdId = syncCalendarEvent(r);
    if (createdId) calEventId = createdId;
  } else {
    deleteCalendarEvent(r);
  }

  var rowData = [
    r.id,
    r.student_id || "",
    r.student_nom || "",
    r.telefon || "",
    r.data || "",
    r.hora_inici || "",
    r.hora_fi || "",
    r.franja || "",
    r.activitat || "Torn",
    parseInt(r.places || 1, 10),
    r.estat || "confirmada",
    (r.hores !== undefined && r.hores !== null ? r.hores : 1.5),
    r.notes || "",
    r.created_at || new Date().toISOString(),
    calEventId
  ];

  var updated = false;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === String(r.id).trim()) {
      sheet.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
      updated = true;
      break;
    }
  }
  if (!updated) {
    sheet.appendRow(rowData);
  }
}

function parseDateTimeRobust(dateVal, timeVal) {
  var year = 2026, month = 8, day = 5, hours = 10, minutes = 0;

  if (dateVal instanceof Date) {
    year = dateVal.getFullYear();
    month = dateVal.getMonth();
    day = dateVal.getDate();
  } else if (dateVal) {
    var str = String(dateVal).trim();
    var isoMatch = str.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    if (isoMatch) {
      year = parseInt(isoMatch[1], 10);
      month = parseInt(isoMatch[2], 10) - 1;
      day = parseInt(isoMatch[3], 10);
    } else {
      var dObj = new Date(str);
      if (!isNaN(dObj.getTime())) {
        year = dObj.getFullYear();
        month = dObj.getMonth();
        day = dObj.getDate();
      }
    }
  }

  if (timeVal instanceof Date) {
    hours = timeVal.getHours();
    minutes = timeVal.getMinutes();
  } else if (timeVal) {
    var timeStr = String(timeVal).trim();
    var timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      hours = parseInt(timeMatch[1], 10);
      minutes = parseInt(timeMatch[2], 10);
    }
  }

  return new Date(year, month, day, hours, minutes, 0);
}

function syncCalendarEvent(r) {
  try {
    if (!r || !r.data || !r.hora_inici || !r.hora_fi) return null;
    var cal = getRoigDeCoureCalendar(r.calendar_name || "Roigdecoure");
    if (!cal) {
      Logger.log("❌ No s'ha pogut obtenir cap calendari.");
      return "ERR: No s'ha trobat el calendari Roigdecoure";
    }

    var nom = r.student_nom || r.student_id || "Alumne";
    var act = r.activitat || "Torn";
    var tel = r.telefon || "";
    var places = parseInt(r.places || 1, 10);
    var title = "🏺 " + act + " - " + nom + (places > 1 ? " (" + places + " pl)" : "") + (tel ? " - " + tel : "");

    var startTime = parseDateTimeRobust(r.data, r.hora_inici);
    var endTime = parseDateTimeRobust(r.data, r.hora_fi);

    var desc = "Reserva Taller Roig de Coure\n" +
               "Alumne: " + nom + "\n" +
               "Activitat: " + act + "\n" +
               "Places: " + places + "\n" +
               (tel ? "Telèfon: " + tel + "\n" : "") +
               (r.notes ? "Notes: " + r.notes + "\n" : "") +
               "ID Reserva: " + r.id;

    var location = "Taller de Ceràmica Roig de Coure";

    var event = null;
    if (r.calendar_event_id) {
      try {
        event = cal.getEventById(r.calendar_event_id);
      } catch (e) {}
    }

    if (!event) {
      var existingEvents = cal.getEvents(startTime, endTime);
      for (var j = 0; j < existingEvents.length; j++) {
        var d = existingEvents[j].getDescription() || "";
        if (d.indexOf("ID Reserva: " + r.id) !== -1) {
          event = existingEvents[j];
          break;
        }
      }
    }

    if (event) {
      event.setTitle(title);
      event.setTime(startTime, endTime);
      event.setDescription(desc);
      event.setLocation(location);
      return event.getId();
    } else {
      var newEvent = cal.createEvent(title, startTime, endTime, {
        description: desc,
        location: location
      });
      return newEvent.getId();
    }
  } catch (err) {
    Logger.log("Avís Google Calendar: " + err.toString());
    return null;
  }
}

function deleteCalendarEvent(r) {
  try {
    if (!r) return;
    var cal = getRoigDeCoureCalendar(r.calendar_name || "roigdecoure");
    if (!cal) return;

    var event = null;
    if (r.calendar_event_id) {
      try {
        event = cal.getEventById(r.calendar_event_id);
      } catch (e) {}
    }

    if (!event && r.data && r.hora_inici && r.hora_fi) {
      var startTime = parseDateTimeRobust(r.data, r.hora_inici);
      var endTime = parseDateTimeRobust(r.data, r.hora_fi);
      var existingEvents = cal.getEvents(startTime, endTime);
      for (var j = 0; j < existingEvents.length; j++) {
        var d = existingEvents[j].getDescription() || "";
        if (d.indexOf("ID Reserva: " + r.id) !== -1) {
          event = existingEvents[j];
          break;
        }
      }
    }

    if (event) {
      event.deleteEvent();
    }
  } catch (err) {
    Logger.log("Avís cancel·lant esdeveniment a Google Calendar: " + err.toString());
  }
}

function cancelReservaRow(ss, r) {
  if (!r || !r.id) return;
  var sheet = ss.getSheetByName("Reserves");
  if (!sheet) return;
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === String(r.id).trim()) {
      sheet.getRange(i + 1, 11).setValue("cancel·lada");
      break;
    }
  }
  deleteCalendarEvent(r);
}

function deleteReservaRow(ss, resId) {
  if (!resId) return;
  var sheet = ss.getSheetByName("Reserves");
  if (!sheet) return;
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === String(resId).trim()) {
      var rObj = {
        id: resId,
        data: values[i][4],
        hora_inici: values[i][5],
        hora_fi: values[i][6],
        calendar_event_id: values[i][14] || ""
      };
      sheet.deleteRow(i + 1);
      deleteCalendarEvent(rObj);
      return;
    }
  }
}

/**
 * Funció de prova directa des de l'editor d'Apps Script.
 * Executa aquesta funció a l'editor fent clic a "Executa":
 * 1. Google et demanarà "Revisa els permisos" per donar accés al calendari.
 * 2. Trobarà automàticament el teu calendari "Roigdecoure".
 * 3. Crearà un esdeveniment de prova a la teva agenda per confirmar que funciona al 100%.
 */
function provarSincronitzacioCalendari() {
  Logger.log("Iniciant prova de connexió amb Google Calendar...");
  var cals = CalendarApp.getAllCalendars();
  Logger.log("Calendaris detectats al teu compte (" + cals.length + "):");
  for (var i = 0; i < cals.length; i++) {
    Logger.log(" - " + cals[i].getName() + " (ID: " + cals[i].getId() + ")");
  }

  var cal = getRoigDeCoureCalendar("Roigdecoure");
  if (!cal) {
    Logger.log("❌ No s'ha trobat el calendari 'Roigdecoure'. Revisa la llista anterior.");
    return;
  }

  Logger.log("✅ CALENDARI SELECCIONAT AMB ÈXIT: " + cal.getName());

  var ara = new Date();
  var fi = new Date(ara.getTime() + 60 * 60 * 1000);
  var ev = cal.createEvent("🏺 Prova Taller Roig de Coure", ara, fi, {
    description: "Esdeveniment de prova per confirmar que la sincronització funciona correctament.",
    location: "Taller de Ceràmica"
  });

  Logger.log("🎉 ESDEVENIMENT CREAT CORRECTAMENT AL TEU CALENDARI!");
  Logger.log("ID esdeveniment: " + ev.getId());
  Logger.log("Obre el teu Google Calendar per veure'l.");
}



