/**
 * store.js - Gestor de dades híbrid (API Python/SQLite amb suport LocalStorage i Google Sheets)
 */

const Store = {
  // Mode: 'api' (servidor actiu) o 'local' (offline/standalone)
  mode: 'api',
  apiBase: '',

  // Clau de localStorage per a mode offline
  STORAGE_KEY: 'taller_ceramica_v1',

  async init() {
    try {
      const res = await fetch(`${this.apiBase}/api/status`, { cache: 'no-cache' });
      if (res.ok) {
        this.mode = 'api';
        return 'api';
      }
    } catch (e) {
      console.warn('Servidor Python no detectat o no disponible. Activant mode local (localStorage).');
    }
    this.mode = 'local';
    this._initLocalStorage();
    return 'local';
  },

  _initLocalStorage() {
    let data = localStorage.getItem(this.STORAGE_KEY);
    if (!data) {
      const nowIso = new Date().toISOString();
      const initial = {
        alumnes: [
          { id: 'TC-101', nom: 'Maria', cognoms: 'Garcia Font', telefon: '612345678', email: 'maria.garcia@email.com', pin: '1001', data_alta: nowIso, notes: 'Curs de torn nivell mig', actiu: 1 },
          { id: 'TC-102', nom: 'Jordi', cognoms: 'Rovira Pons', telefon: '623456789', email: 'jordi.rovira@email.com', pin: '1002', data_alta: nowIso, notes: 'Modelatge i escultura', actiu: 1 },
          { id: 'TC-103', nom: 'Clara', cognoms: 'Vidal Soler', telefon: '634567890', email: 'clara.vidal@email.com', pin: '1003', data_alta: nowIso, notes: 'Esmalts i pintura', actiu: 1 }
        ],
        paquets: [
          { id: 'PK-101-1', student_id: 'TC-101', data: nowIso, hores: 10, segons: 36000, concepte: 'Pack 10 Hores Torn', preu: 120, metode_pagament: 'Stripe', notes: 'Pagat amb Stripe' },
          { id: 'PK-102-1', student_id: 'TC-102', data: nowIso, hores: 5, segons: 18000, concepte: 'Pack 5 Hores Modelatge', preu: 65, metode_pagament: 'Bizum', notes: 'Pagat per Bizum' },
          { id: 'PK-103-1', student_id: 'TC-103', data: nowIso, hores: 20, segons: 72000, concepte: 'Pack 20 Hores Taller Lliure', preu: 220, metode_pagament: 'Targeta', notes: 'Compra inicial' }
        ],
        sessions: [
          { id: 'SES-DEMO-1', student_id: 'TC-101', data: '2026-09-01', entrada: '2026-09-01T10:00:00', sortida: '2026-09-01T11:45:20', durada_segons: 6320, format_hms: '01:45:20', tipus: 'qr', estat: 'tancada', notes: 'Sessió de torn' }
        ],
        config: {
          taller_nom: 'Taller de Ceràmica',
          taller_telefon: '+34 600 000 000',
          taller_email: 'info@tallerdecoramica.cat',
          hores_per_defecte_oblit: '01:30:00',
          stripe_pack5_url: '',
          stripe_pack10_url: '',
          stripe_pack20_url: '',
          google_sheets_url: ''
        }
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(initial));
    }
  },

  _getLocalData() {
    this._initLocalStorage();
    try {
      return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || {};
    } catch (e) {
      return { alumnes: [], paquets: [], sessions: [], config: {} };
    }
  },

  _saveLocalData(data) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
  },

  /* ====================== ALUMNES ====================== */

  async getAlumnes() {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/alumnes`);
        const json = await res.json();
        if (json.ok) return json.data;
      } catch (e) {
        console.warn('Error connectant a l\'API, canviant a mode local');
        this.mode = 'local';
      }
    }

    const data = this._getLocalData();
    const activeStudents = (data.alumnes || []).filter(a => a.actiu !== 0);

    return activeStudents.map(a => {
      const openSess = (data.sessions || []).find(s => s.student_id === a.id && s.estat === 'oberta');
      const bal = TimeUtils.calculateStudentBalance(a.id, data.paquets || [], data.sessions || []);
      return {
        ...a,
        sessioActiva: openSess || null,
        balanc: bal
      };
    });
  },

  async getAlumne(id) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/alumnes/${encodeURIComponent(id)}`);
        const json = await res.json();
        if (json.ok) return json;
      } catch (e) {
        console.warn('Error connectant a l\'API, fallback local');
        this.mode = 'local';
      }
    }

    const data = this._getLocalData();
    const student = (data.alumnes || []).find(a => a.id === id || a.pin === id);
    if (!student) return null;

    const packs = (data.paquets || []).filter(p => p.student_id === student.id).sort((a,b) => new Date(b.data) - new Date(a.data));
    const sessions = (data.sessions || []).filter(s => s.student_id === student.id).sort((a,b) => new Date(b.entrada) - new Date(a.entrada));
    const openSess = sessions.find(s => s.estat === 'oberta');
    const balanc = TimeUtils.calculateStudentBalance(student.id, packs, sessions);

    return {
      ok: true,
      alumne: student,
      paquets: packs,
      sessions: sessions,
      sessioActiva: openSess || null,
      balanc: balanc
    };
  },

  async saveAlumne(studentData) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/alumnes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(studentData)
        });
        const json = await res.json();
        if (json.ok) return json;
      } catch (e) {
        this.mode = 'local';
      }
    }

    const data = this._getLocalData();
    let id = studentData.id;
    if (!id) {
      const maxNum = (data.alumnes || []).reduce((max, a) => {
        const m = (a.id || '').match(/TC-(\d+)/);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 100);
      id = `TC-${maxNum + 1}`;
      if (!studentData.pin) studentData.pin = String(maxNum + 1);
    }

    const existingIdx = (data.alumnes || []).findIndex(a => a.id === id);
    const alumneRecord = {
      id: id,
      nom: studentData.nom,
      cognoms: studentData.cognoms || '',
      telefon: studentData.telefon || '',
      email: studentData.email || '',
      pin: studentData.pin || id.replace('TC-', ''),
      data_alta: studentData.data_alta || new Date().toISOString(),
      notes: studentData.notes || '',
      actiu: 1
    };

    if (existingIdx >= 0) {
      data.alumnes[existingIdx] = { ...data.alumnes[existingIdx], ...alumneRecord };
    } else {
      data.alumnes.push(alumneRecord);
    }
    this._saveLocalData(data);
    return { ok: true, id: id, message: 'Alumne desat correctament' };
  },

  async deleteAlumne(id) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/alumnes/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const json = await res.json();
        if (json.ok) return json;
      } catch (e) {
        this.mode = 'local';
      }
    }
    const data = this._getLocalData();
    const idx = (data.alumnes || []).findIndex(a => a.id === id);
    if (idx >= 0) {
      data.alumnes[idx].actiu = 0;
      this._saveLocalData(data);
    }
    return { ok: true, message: 'Alumne desactivat' };
  },

  /* ====================== CHECK-IN / CHECK-OUT (QR & MANUAL) ====================== */

  async checkInOrOut(code, options = {}) {
    const payload = {
      code: code,
      action: options.action || 'auto',
      customTime: options.customTime || null,
      tipus: options.tipus || (options.action ? 'manual' : 'qr')
    };

    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/checkin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (json.ok) return json;
        throw new Error(json.error || 'Error en el check-in/out');
      } catch (e) {
        if (this.mode === 'api' && e.message !== 'Failed to fetch') {
          throw e;
        }
        this.mode = 'local';
      }
    }

    const data = this._getLocalData();
    const cleanCode = (code || '').trim().toUpperCase();
    const student = (data.alumnes || []).find(a => a.actiu !== 0 && (
      (a.id || '').toUpperCase() === cleanCode ||
      (a.pin || '') === cleanCode ||
      (a.telefon || '') === cleanCode
    ));

    if (!student) {
      throw new Error(`No s'ha trobat cap alumne amb el codi "${code}"`);
    }

    const now = payload.customTime ? new Date(payload.customTime) : new Date();
    const nowIso = now.toISOString();
    const today = nowIso.slice(0, 10);
    const requestedAction = payload.action;

    // Buscar sessió oberta
    const openIdx = (data.sessions || []).findIndex(s => s.student_id === student.id && s.estat === 'oberta');
    const hasOpenSession = openIdx !== -1;

    const shouldCheckin = (requestedAction === 'entrada') || (requestedAction === 'auto' && !hasOpenSession);
    const shouldCheckout = (requestedAction === 'sortida') || (requestedAction === 'auto' && hasOpenSession);

    if (shouldCheckin) {
      // ENTRADA (Check-in)
      if (hasOpenSession) {
        data.sessions[openIdx].estat = 'tancada_forçada';
        data.sessions[openIdx].notes = 'Reemplaçada per nova entrada manual';
      }

      const newSession = {
        id: `SES-${Date.now()}-${student.id}`,
        student_id: student.id,
        data: today,
        entrada: nowIso,
        sortida: null,
        durada_segons: 0,
        format_hms: '00:00:00',
        tipus: payload.tipus,
        estat: 'oberta',
        notes: ''
      };
      data.sessions.push(newSession);
      this._saveLocalData(data);

      const balanc = TimeUtils.calculateStudentBalance(student.id, data.paquets || [], data.sessions);
      return {
        ok: true,
        action: 'entrada',
        alumne: student,
        horaEntrada: TimeUtils.formatTime(now),
        dataEntrada: TimeUtils.formatDate(now),
        balanc: balanc,
        message: `Entrada registrada per a ${student.nom} a les ${TimeUtils.formatTime(now)} (${payload.tipus.toUpperCase()}).`
      };
    } else if (shouldCheckout) {
      // SORTIDA (Check-out)
      if (!hasOpenSession) {
        throw new Error(`${student.nom} no té cap sessió oberta. Utilitza 'Sessió Manual' per registrar un dia passat.`);
      }

      const openSess = data.sessions[openIdx];
      const startDt = new Date(openSess.entrada);
      const durSec = Math.max(0, Math.floor((now.getTime() - startDt.getTime()) / 1000));
      const durHms = TimeUtils.secondsToHms(durSec);

      openSess.sortida = nowIso;
      openSess.durada_segons = durSec;
      openSess.format_hms = durHms;
      openSess.estat = 'tancada';
      openSess.tipus = payload.tipus;
      this._saveLocalData(data);

      const balanc = TimeUtils.calculateStudentBalance(student.id, data.paquets || [], data.sessions);
      return {
        ok: true,
        action: 'sortida',
        alumne: student,
        horaEntrada: TimeUtils.formatTime(startDt),
        horaSortida: TimeUtils.formatTime(now),
        duradaSegons: durSec,
        duradaHms: durHms,
        balanc: balanc,
        message: `Sortida registrada per a ${student.nom} a les ${TimeUtils.formatTime(now)}. Temps: ${duradaHms}. Saldo disponible: ${balanc.formatBalance}.`
    }
  },

  async forceCloseSession(opts) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/tancar-cicle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(opts)
        });
        const json = await res.json();
        if (json.ok) return json;
      } catch (e) {
        this.mode = 'local';
      }
    }

    const data = this._getLocalData();
    let sessIdx = -1;
    if (opts.sessionId) {
      sessIdx = (data.sessions || []).findIndex(s => s.id === opts.sessionId);
    } else if (opts.studentId) {
      sessIdx = (data.sessions || []).findIndex(s => s.student_id === opts.studentId && s.estat === 'oberta');
    }

    if (sessIdx === -1) {
      throw new Error('No s\'ha trobat cap sessió oberta per tancar');
    }

    const sess = data.sessions[sessIdx];
    const entradaDt = new Date(sess.entrada);
    let durSec = 5400; // 1h 30m per defecte

    if (opts.duradaManual) {
      durSec = TimeUtils.hmsToSeconds(opts.duradaManual);
    } else if (opts.sortidaManual) {
      const sortDt = new Date(opts.sortidaManual);
      durSec = Math.max(0, Math.floor((sortDt.getTime() - entradaDt.getTime()) / 1000));
    }

    const durHms = TimeUtils.secondsToHms(durSec);
    const sortidaIso = new Date(entradaDt.getTime() + (durSec * 1000)).toISOString();

    sess.sortida = sortidaIso;
    sess.durada_segons = durSec;
    sess.format_hms = durHms;
    sess.estat = 'tancada_forçada';
    sess.notes = opts.notes || 'Tancat per oblit';

    this._saveLocalData(data);
    const balanc = TimeUtils.calculateStudentBalance(sess.student_id, data.paquets || [], data.sessions);

    return {
      ok: true,
      message: `Cicle tancat correctament (${durHms})`,
      duradaHms: durHms,
      balanc: balanc
    };
  },

  /* ====================== PAQUETS D'HORES (COMPRA) ====================== */

  async addPackage(packData) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/paquets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(packData)
        });
        const json = await res.json();
        if (json.ok) return json;
      } catch (e) {
        this.mode = 'local';
      }
    }

    const data = this._getLocalData();
    const hores = parseFloat(packData.hores) || 0;
    const segons = Math.round(hores * 3600);
    const packId = `PK-${Date.now()}-${packData.studentId}`;

    const newPack = {
      id: packId,
      student_id: packData.studentId,
      data: packData.data || new Date().toISOString(),
      hores: hores,
      segons: segons,
      concepte: packData.concepte || `Pack ${hores} Hores`,
      preu: parseFloat(packData.preu) || 0,
      metode_pagament: packData.metodePagament || 'Stripe',
      stripe_session_id: packData.stripeSessionId || '',
      notes: packData.notes || ''
    };

    data.paquets.push(newPack);
    this._saveLocalData(data);

    const balanc = TimeUtils.calculateStudentBalance(packData.studentId, data.paquets, data.sessions || []);
    return {
      ok: true,
      id: packId,
      message: `S'han afegit ${hores} hores (${TimeUtils.secondsToHms(segons)}) al compte.`,
      balanc: balanc
    };
  },

  async deletePackage(id) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/paquets/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const json = await res.json();
        if (json.ok) return json;
      } catch (e) {
        this.mode = 'local';
      }
    }
    const data = this._getLocalData();
    data.paquets = (data.paquets || []).filter(p => p.id !== id);
    this._saveLocalData(data);
    return { ok: true, message: 'Paquet eliminat' };
  },

  /* ====================== SESSIONS MANUALS ====================== */

  async saveManualSession(sessData) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/sessions/manual`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sessData)
        });
        const json = await res.json();
        if (json.ok) return json;
      } catch (e) {
        this.mode = 'local';
      }
    }

    const data = this._getLocalData();
    const entradaDt = new Date(sessData.entrada);
    const sortidaDt = new Date(sessData.sortida);
    const durSec = Math.max(0, Math.floor((sortidaDt.getTime() - entradaDt.getTime()) / 1000));
    const durHms = TimeUtils.secondsToHms(durSec);

    let id = sessData.id;
    if (id) {
      const idx = (data.sessions || []).findIndex(s => s.id === id);
      if (idx >= 0) {
        data.sessions[idx] = {
          ...data.sessions[idx],
          data: sessData.data || sessData.entrada.slice(0, 10),
          entrada: sessData.entrada,
          sortida: sessData.sortida,
          durada_segons: durSec,
          format_hms: durHms,
          notes: sessData.notes || '',
          estat: 'tancada'
        };
      }
    } else {
      id = `SES-MANUAL-${Date.now()}-${sessData.studentId}`;
      data.sessions.push({
        id: id,
        student_id: sessData.studentId,
        data: sessData.data || sessData.entrada.slice(0, 10),
        entrada: sessData.entrada,
        sortida: sessData.sortida,
        durada_segons: durSec,
        format_hms: durHms,
        tipus: 'manual',
        estat: 'tancada',
        notes: sessData.notes || ''
      });
    }

    this._saveLocalData(data);
    const balanc = TimeUtils.calculateStudentBalance(sessData.studentId, data.paquets || [], data.sessions);
    return { ok: true, id: id, duradaHms: durHms, balanc: balanc, message: 'Sessió desada' };
  },

  async deleteSession(id) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const json = await res.json();
        if (json.ok) return json;
      } catch (e) {
        this.mode = 'local';
      }
    }
    const data = this._getLocalData();
    data.sessions = (data.sessions || []).filter(s => s.id !== id);
    this._saveLocalData(data);
    return { ok: true, message: 'Sessió eliminada' };
  },

  /* ====================== CONFIGURACIÓ & GOOGLE SHEETS ====================== */

  async getConfig() {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/config`);
        const json = await res.json();
        if (json.ok) return json.config;
      } catch (e) {
        this.mode = 'local';
      }
    }
    const data = this._getLocalData();
    return data.config || {};
  },

  async saveConfig(cfg) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cfg)
        });
        const json = await res.json();
        if (json.ok) return json;
      } catch (e) {
        this.mode = 'local';
      }
    }
    const data = this._getLocalData();
    data.config = { ...(data.config || {}), ...cfg };
    this._saveLocalData(data);
    return { ok: true, message: 'Configuració desada' };
  },

  async syncToGoogleSheets(customUrl = null) {
    const config = await this.getConfig();
    const url = customUrl || config.google_sheets_url;
    if (!url) {
      throw new Error('No hi ha cap URL de Google Apps Script configurat.');
    }

    // Obtenir totes les dades
    const alumnes = await this.getAlumnes();
    const data = this._getLocalData();
    const paquets = data.paquets || [];
    const sessions = data.sessions || [];

    const payload = {
      action: 'sync_all',
      timestamp: new Date().toISOString(),
      alumnes: alumnes,
      paquets: paquets,
      sessions: sessions
    };

    // Petició POST a l'aplicació web de Google Apps Script
    const res = await fetch(url, {
      method: 'POST',
      mode: 'no-cors', // Apps Script web apps funcionen amb no-cors o redireccions
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    return { ok: true, message: 'Dades enviades a Google Sheets correctament!' };
  },

  /* ====================== CÒPIA DE SEGURETAT JSON / CSV ====================== */

  async exportBackupJson() {
    let data;
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/export`);
        data = await res.json();
      } catch (e) {
        data = this._getLocalData();
      }
    } else {
      data = this._getLocalData();
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `copia_seguretat_ceramica_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async importBackupJson(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const parsed = JSON.parse(e.target.result);
          if (this.mode === 'api') {
            const res = await fetch(`${this.apiBase}/api/import`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(parsed)
            });
            resolve(await res.json());
          } else {
            this._saveLocalData(parsed);
            resolve({ ok: true, message: 'Dades restaurades correctament' });
          }
        } catch (err) {
          reject(new Error('Format de fitxer de còpia de seguretat no vàlid.'));
        }
      };
      reader.onerror = () => reject(new Error('Error llegint el fitxer.'));
      reader.readAsText(file);
    });
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Store;
}
