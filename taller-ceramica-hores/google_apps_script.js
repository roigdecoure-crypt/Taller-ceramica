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
  var config = readConfig(ss);

  return jsonResponse({
    status: "success",
    data: {
      alumnes: alumnes,
      paquets: paquets,
      sessions: sessions,
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
