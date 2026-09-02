/**
 * google_apps_script.js - Sincronització amb Google Sheets per al Taller de Ceràmica
 * 
 * INSTRUCCIONS DE CONFIGURACIÓ:
 * 1. Obre un nou full de càlcul a https://sheets.new (anomena'l "Taller de Ceràmica - Control d'Hores").
 * 2. Al menú superior, ves a: Extensions > Apps Script.
 * 3. Esborra qualsevol codi que hi hagi i enganxa tot aquest contingut.
 * 4. Fes clic a: Implementar (Deploy) > Nova implementació (New deployment).
 * 5. Selecciona el tipus: Aplicació web (Web app).
 * 6. Executa com a: "Jo" (El teu compte).
 * 7. Qui té accés: "Tothom" (Anyone).
 * 8. Fes clic a "Implementar" i copia l'URL que et doni (acaba en /exec).
 * 9. Enganxa aquest URL a l'apartat de Configuració del Panell d'Administració (admin.html).
 */

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "ok",
    missatge: "Connexió activa amb Google Sheets del Taller de Ceràmica!"
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(15000);

  try {
    var rawData = e.postData.contents;
    var data = JSON.parse(rawData);
    var action = data.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === "sync_all") {
      syncAlumnes(ss, data.alumnes || []);
      syncPaquets(ss, data.paquets || []);
      syncSessions(ss, data.sessions || []);
      return jsonResponse({ status: "success", message: "Sincronització completa realitzada amb èxit!" });
    } else if (action === "sync_alumne") {
      updateAlumneRow(ss, data.alumne);
      return jsonResponse({ status: "success", message: "Alumne actualitzat a Google Sheets" });
    } else if (action === "add_session") {
      appendSessionRow(ss, data.session);
      return jsonResponse({ status: "success", message: "Sessió registrada a Google Sheets" });
    } else if (action === "add_paquet") {
      appendPaquetRow(ss, data.paquet);
      return jsonResponse({ status: "success", message: "Paquet d'hores afegit a Google Sheets" });
    }

    return jsonResponse({ status: "error", message: "Acció desconeguda: " + action });
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length > 0) {
      sheet.appendRow(headers);
      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground("#C25E3A");
      headerRange.setFontColor("#FFFFFF");
      headerRange.setFontWeight("bold");
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function syncAlumnes(ss, alumnes) {
  var headers = ["ID Alumne", "Nom", "Cognoms", "Telèfon", "Email", "PIN", "Data Alta", "Saldo H:m:s", "Estat", "Notes"];
  var sheet = getOrCreateSheet(ss, "Alumnes", headers);
  sheet.clearContents();
  sheet.appendRow(headers);
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground("#C25E3A");
  headerRange.setFontColor("#FFFFFF");
  headerRange.setFontWeight("bold");
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
        (a.balanc ? a.balanc.formatBalance : "00:00:00"),
        (a.sessioActiva ? "Al Taller" : "Fora"),
        a.notes || ""
      ];
    });
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

function syncPaquets(ss, paquets) {
  var headers = ["ID Compra", "ID Alumne", "Alumne", "Data Compra", "Hores", "Durada H:m:s", "Concepte", "Preu (€)", "Mètode Pagament", "Notes"];
  var sheet = getOrCreateSheet(ss, "Compres Hores", headers);
  sheet.clearContents();
  sheet.appendRow(headers);
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground("#5E7E6F");
  headerRange.setFontColor("#FFFFFF");
  headerRange.setFontWeight("bold");
  sheet.setFrozenRows(1);

  if (paquets.length > 0) {
    var rows = paquets.map(function(p) {
      var sec = p.segons || Math.round((p.hores || 0) * 3600);
      var h = Math.floor(sec / 3600);
      var m = Math.floor((sec % 3600) / 60);
      var s = sec % 60;
      var hms = (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
      var nomComplet = (p.nom ? p.nom + " " + (p.cognoms || "") : "").trim();

      return [
        p.id || "",
        p.student_id || "",
        nomComplet,
        p.data || "",
        p.hores || 0,
        hms,
        p.concepte || "",
        p.preu || 0,
        p.metode_pagament || "Stripe",
        p.notes || ""
      ];
    });
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

function syncSessions(ss, sessions) {
  var headers = ["ID Sessió", "ID Alumne", "Alumne", "Data", "Hora Entrada", "Hora Sortida", "Durada H:m:s", "Segons", "Mètode", "Estat", "Notes"];
  var sheet = getOrCreateSheet(ss, "Sessions i Assistència", headers);
  sheet.clearContents();
  sheet.appendRow(headers);
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground("#3A4F66");
  headerRange.setFontColor("#FFFFFF");
  headerRange.setFontWeight("bold");
  sheet.setFrozenRows(1);

  if (sessions.length > 0) {
    var rows = sessions.map(function(s) {
      var nomComplet = (s.nom ? s.nom + " " + (s.cognoms || "") : "").trim();
      return [
        s.id || "",
        s.student_id || "",
        nomComplet,
        s.data || "",
        s.entrada || "",
        s.sortida || "(En curs)",
        s.format_hms || "00:00:00",
        s.durada_segons || 0,
        s.tipus || "qr",
        s.estat || "oberta",
        s.notes || ""
      ];
    });
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

function appendSessionRow(ss, s) {
  var headers = ["ID Sessió", "ID Alumne", "Alumne", "Data", "Hora Entrada", "Hora Sortida", "Durada H:m:s", "Segons", "Mètode", "Estat", "Notes"];
  var sheet = getOrCreateSheet(ss, "Sessions i Assistència", headers);
  sheet.appendRow([
    s.id || "",
    s.student_id || "",
    s.nomComplet || "",
    s.data || "",
    s.entrada || "",
    s.sortida || "",
    s.format_hms || "00:00:00",
    s.durada_segons || 0,
    s.tipus || "qr",
    s.estat || "tancada",
    s.notes || ""
  ]);
}

function appendPaquetRow(ss, p) {
  var headers = ["ID Compra", "ID Alumne", "Alumne", "Data Compra", "Hores", "Durada H:m:s", "Concepte", "Preu (€)", "Mètode Pagament", "Notes"];
  var sheet = getOrCreateSheet(ss, "Compres Hores", headers);
  var sec = p.segons || Math.round((p.hores || 0) * 3600);
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  var hms = (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;

  sheet.appendRow([
    p.id || "",
    p.student_id || "",
    p.nomComplet || "",
    p.data || "",
    p.hores || 0,
    hms,
    p.concepte || "",
    p.preu || 0,
    p.metode_pagament || "Stripe",
    p.notes || ""
  ]);
}
