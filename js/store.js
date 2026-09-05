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
          { id: 'TC-101', nom: 'Maria', cognoms: 'Garcia Font', telefon: '612345678', email: 'maria.garcia@email.com', pin: '1001', data_alta: nowIso, notes: 'Curs de torn nivell mig', actiu: 1, edat: 32 },
          { id: 'TC-102', nom: 'Jordi', cognoms: 'Rovira Pons', telefon: '623456789', email: 'jordi.rovira@email.com', pin: '1002', data_alta: nowIso, notes: 'Modelatge i escultura', actiu: 1, edat: 28 },
          { id: 'TC-103', nom: 'Clara', cognoms: 'Vidal Soler', telefon: '634567890', email: 'clara.vidal@email.com', pin: '1003', data_alta: nowIso, notes: 'Esmalts i pintura', actiu: 1, edat: 10 }
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
          stripe_url_adults: 'https://buy.stripe.com/eVqdR90tzeTL1OO06xgIo0n',
          stripe_url_infantil: 'https://buy.stripe.com/cNi9AT5NT8vnfFEcTjgIo0j',
          edat_tall_infantil: '12',
          stripe_pack5_url: '',
          stripe_pack10_url: '',
          stripe_pack20_url: '',
          google_sheets_url: 'https://script.google.com/macros/s/AKfycbzMoUg5Ulqpgepq4D01yolxmGjZsI8yjnNt64gwLnst_QnhkF6GgwaGJcXcv4VFZBQO/exec',
          google_calendar_name: 'roigdecoure'
        }
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(initial));
    }
  },

  _getLocalData() {
    this._initLocalStorage();
    try {
      const parsed = JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || {};
      if (!parsed.alumnes || parsed.alumnes.length === 0) {
        localStorage.removeItem(this.STORAGE_KEY);
        this._initLocalStorage();
        return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || {};
      }
      return parsed;
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
        const res = await fetch(`${this.apiBase}/api/alumnes?t=${Date.now()}`, { cache: 'no-store' });
        const json = await res.json();
        if (json.ok && Array.isArray(json.data) && json.data.length > 0) {
          return json.data;
        }
      } catch (e) {
        console.warn('Error connectant a l\'API, canviant a mode local:', e);
        this.mode = 'local';
      }
    }

    const data = this._getLocalData();
    const activeStudents = (data.alumnes || []).filter(a => a.actiu !== 0);

    return activeStudents.map(a => {
      const openSess = (data.sessions || []).find(s => s.student_id === a.id && s.estat === 'oberta');
      const bal = (typeof TimeUtils !== 'undefined' && TimeUtils.calculateStudentBalance)
        ? TimeUtils.calculateStudentBalance(a.id, data.paquets || [], data.sessions || [])
        : { formatBalance: '00:00:00', isNegative: false, isLow: false };
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
      actiu: 1,
      edat: studentData.edat !== undefined && studentData.edat !== null && String(studentData.edat).trim() !== '' ? parseInt(studentData.edat, 10) : null
    };

    if (existingIdx >= 0) {
      data.alumnes[existingIdx] = { ...data.alumnes[existingIdx], ...alumneRecord };
    } else {
      data.alumnes.push(alumneRecord);
    }
    this._saveLocalData(data);
    return { ok: true, id: id, message: 'Alumne desat correctament' };
  },

  getCategoriaEdat(edat, edatTall = 12) {
    const tall = parseInt(edatTall, 10) || 12;
    if (edat === undefined || edat === null || edat === '') return 'indefinida';
    const num = parseInt(edat, 10);
    if (isNaN(num)) return 'indefinida';
    return num <= tall ? 'infantil' : 'adults';
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
      };
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

  async getSyncStatus() {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/sync/status`);
        return await res.json();
      } catch (e) {
        return { ok: false };
      }
    }
    const cfg = await this.getConfig();
    return { ok: true, configured: Boolean(cfg.google_sheets_url), urlPreview: cfg.google_sheets_url ? (cfg.google_sheets_url.slice(0, 30) + '...') : '' };
  },

  async hydrateFromGoogleSheets(customUrl = null) {
    if (this.mode === 'api') {
      const res = await fetch(`${this.apiBase}/api/sync/hydrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: customUrl })
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Error en la hidratació');
      return json;
    }

    // Mode Local / Offline
    const cfg = await this.getConfig();
    const url = customUrl || cfg.google_sheets_url;
    if (!url) throw new Error('Cal configurar un URL de Google Sheets.');

    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}action=get_all`);
    const json = await res.json();
    if (json.status !== 'success' || !json.data) throw new Error('Resposta no vàlida de Google Sheets');

    const d = this._getLocalData();
    if (json.data.alumnes) d.alumnes = json.data.alumnes;
    if (json.data.paquets) d.paquets = json.data.paquets;
    if (json.data.sessions) d.sessions = json.data.sessions;
    if (json.data.config) d.config = { ...d.config, ...json.data.config };
    this._saveLocalData(d);
    return { ok: true, message: 'Dades hidratades correctament al navegador.' };
  },

  async syncToGoogleSheets(customUrl = null) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/sync/all`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: customUrl })
        });
        const json = await res.json();
        if (json.ok) return json;
      } catch (e) {
        console.warn('Error sincronitzant via API, provant connexió directa...');
      }
    }

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
      sessions: sessions,
      config: config
    };

    // Petició POST a l'aplicació web de Google Apps Script
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    return { ok: true, message: 'Dades enviades a Google Sheets correctament!' };
  },

  /* ====================== RESERVES & AFORAMENT ====================== */

  async getReserves(filters = {}) {
    if (this.mode === 'api') {
      try {
        const q = new URLSearchParams(filters);
        const res = await fetch(`${this.apiBase}/api/reserves?${q.toString()}&t=${Date.now()}`);
        const json = await res.json();
        if (json.ok && Array.isArray(json.data)) {
          return json.data;
        }
      } catch (e) {
        console.warn('Error obtenint reserves de l\'API:', e);
      }
    }
    const data = this._getLocalData();
    let resList = data.reserves || [];
    if (filters.data) resList = resList.filter(r => r.data === filters.data);
    if (filters.student_id) resList = resList.filter(r => r.student_id === filters.student_id);
    if (filters.estat) resList = resList.filter(r => r.estat === filters.estat);
    return resList;
  },

  getActivitats() {
    const data = this._getLocalData();
    const capTorn = parseInt(data.config?.capacitat_max_torn || 4, 10);
    const capModelatge = parseInt(data.config?.capacitat_max_modelatge || 8, 10);
    const capPintar = parseInt(data.config?.capacitat_max_pintar || 12, 10);
    return [
      { id: "torn", nom: "Torn", descripcio: "Sessió al torn de terrissaire", capacitatMax: capTorn, icon: "", color: "#7A3026" },
      { id: "modelatge", nom: "Modelatge", descripcio: "Modelat de fang a mà i escultura", capacitatMax: capModelatge, icon: "", color: "#5E7E6F" },
      { id: "pintar", nom: "Pintar ceràmica", descripcio: "Pintura i esmaltat sobre ceràmica", capacitatMax: capPintar, icon: "", color: "#7A3026" }
    ];
  },

  async getDisponibilitat(dataStr) {
    if (!dataStr) {
      const now = new Date();
      dataStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    }
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/reserves/disponibilitat?data=${encodeURIComponent(dataStr)}&t=${Date.now()}`);
        const json = await res.json();
        if (json.ok) return json;
      } catch (e) {
        console.warn('Error obtenint disponibilitat de l\'API:', e);
      }
    }

    // Fallback local
    const data = this._getLocalData();
    const maxCap = parseInt(data.config?.aforament_maxim_per_franja || 12, 10);
    const activitats = this.getActivitats();
    const defFranges = [
      { id: "F1", nom: "Matí 1 (10:00 - 11:30)", inici: "10:00", fi: "11:30", hores: 1.5 },
      { id: "F2", nom: "Matí 2 (11:30 - 13:00)", inici: "11:30", fi: "13:00", hores: 1.5 },
      { id: "F3", nom: "Tarda 1 (17:00 - 18:30)", inici: "17:00", fi: "18:30", hores: 1.5 },
      { id: "F4", nom: "Tarda 2 (18:30 - 20:00)", inici: "18:30", fi: "20:00", hores: 1.5 }
    ];

    // Comprovar si dilluns o dimarts
    const dParts = dataStr.split('-').map(Number);
    const dt = new Date(dParts[0], dParts[1] - 1, dParts[2]);
    const dayOfWeek = dt.getDay(); // 0 Diumenge, 1 Dilluns, 2 Dimarts
    if (dayOfWeek === 1 || dayOfWeek === 2) {
      return {
        data: dataStr,
        tancat: true,
        motiu: `Tancat per descans setmanal (${dayOfWeek === 1 ? 'Dilluns' : 'Dimarts'}). Obrim de Dimecres a Diumenge.`,
        aforamentMaxim: maxCap,
        totalPlacesDia: 0,
        totalOcupadesDia: 0,
        franges: [],
        activitats: activitats
      };
    }

    const reservesDia = (data.reserves || []).filter(r => r.data === dataStr && r.estat === 'confirmada');
    let totalOcupadesDia = 0;

    const franges = defFranges.map(f => {
      const fRes = reservesDia.filter(r => r.franja === f.id || r.franja === f.nom);
      const ocupades = fRes.reduce((acc, r) => acc + (parseInt(r.places, 10) || 1), 0);
      totalOcupadesDia += ocupades;
      const lliures = Math.max(0, maxCap - ocupades);

      const activitatsFranja = activitats.map(act => {
        const ocupatAct = fRes.filter(r => (r.activitat_id || '').toLowerCase() === act.id || (r.activitat || '').toLowerCase() === act.nom.toLowerCase())
                              .reduce((acc, r) => acc + (parseInt(r.places, 10) || 1), 0);
        const lliuresAct = Math.max(0, act.capacitatMax - ocupatAct);
        const placesEfectives = Math.min(lliures, lliuresAct);
        return {
          id: act.id,
          nom: act.nom,
          icon: act.icon,
          color: act.color,
          capacitatMax: act.capacitatMax,
          ocupat: ocupatAct,
          placesDisponibles: placesEfectives,
          complet: placesEfectives === 0
        };
      });

      return {
        id: f.id,
        nom: f.nom,
        inici: f.inici,
        fi: f.fi,
        hores: f.hores,
        totalPlaces: maxCap,
        placesOcupades: ocupades,
        placesLliures: lliures,
        estat: lliures === 0 ? 'complet' : (lliures <= 3 && ocupades > 0 ? 'ultimes_places' : 'lliure'),
        estaComplet: lliures === 0,
        activitats: activitatsFranja,
        reserves: fRes
      };
    });

    return {
      data: dataStr,
      tancat: false,
      motiu: '',
      aforamentMaxim: maxCap,
      totalPlacesDia: maxCap * franges.length,
      totalOcupadesDia: totalOcupadesDia,
      franges: franges,
      activitats: activitats
    };
  },

  async getDisponibilitatMes(any, mes) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/reserves/mes?any=${any}&mes=${mes}&t=${Date.now()}`);
        const json = await res.json();
        if (json.ok) return json;
      } catch (e) {
        console.warn('Error obtenint disponibilitat de mes de l\'API:', e);
      }
    }

    // Fallback local per mes
    const daysInMonth = new Date(any, mes, 0).getDate();
    const dies = {};
    for (let day = 1; day <= daysInMonth; day++) {
      const dataStr = `${any}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dispDia = await this.getDisponibilitat(dataStr);
      dies[dataStr] = {
        data: dataStr,
        tancat: dispDia.tancat,
        motiu: dispDia.motiu,
        placesTotals: dispDia.totalPlacesDia,
        placesOcupades: dispDia.totalOcupadesDia,
        placesLliures: Math.max(0, dispDia.totalPlacesDia - dispDia.totalOcupadesDia),
        estat: dispDia.tancat ? 'tancat' : (dispDia.totalPlacesDia - dispDia.totalOcupadesDia <= 0 ? 'complet' : 'lliure'),
        activitatsAmbPlaces: dispDia.tancat ? [] : (dispDia.franges || []).flatMap(f => (f.activitats || []).filter(a => a.placesDisponibles > 0).map(a => a.id))
      };
    }
    return { any, mes, dies, activitats: this.getActivitats() };
  },

  async crearReserva(reservaData) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/reserves`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reservaData)
        });
        return await res.json();
      } catch (e) {
        console.warn('Error creant reserva a l\'API, intentant localment:', e);
      }
    }

    const data = this._getLocalData();
    if (!data.reserves) data.reserves = [];
    const maxCap = parseInt(data.config?.aforament_maxim_per_franja || 12, 10);
    const existing = data.reserves.filter(r => r.data === reservaData.data && r.franja === (reservaData.franja || reservaData.franja_id) && r.estat === 'confirmada');
    const ocupades = existing.reduce((acc, r) => acc + (parseInt(r.places, 10) || 1), 0);
    const demanades = parseInt(reservaData.places || 1, 10);
    if (ocupades + demanades > maxCap) {
      return { ok: false, error: `Aforament complet per a aquesta franja (Màx. ${maxCap} places).` };
    }

    const resId = `RES-${Date.now()}-${reservaData.student_id}`;
    const newRes = {
      id: resId,
      student_id: reservaData.student_id,
      student_nom: reservaData.student_nom || reservaData.student_id,
      telefon: reservaData.telefon || '',
      data: reservaData.data,
      franja: reservaData.franja || reservaData.franja_id || 'F1',
      activitat: reservaData.activitat || 'Torn',
      activitat_id: reservaData.activitat_id || 'torn',
      places: demanades,
      hora_inici: reservaData.hora_inici || '10:00',
      hora_fi: reservaData.hora_fi || '11:30',
      hores: parseFloat(reservaData.hores) || 1.5,
      notes: reservaData.notes || '',
      estat: 'confirmada',
      created_at: new Date().toISOString()
    };
    data.reserves.push(newRes);
    this._saveLocalData(data);
    return { ok: true, reserva: newRes };
  },

  async cancelarReserva(reservaId) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/reserves/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: reservaId })
        });
        return await res.json();
      } catch (e) {
        console.warn('Error cancel·lant reserva a l\'API:', e);
      }
    }

    const data = this._getLocalData();
    if (data.reserves) {
      const r = data.reserves.find(x => x.id === reservaId);
      if (r) {
        r.estat = 'cancel·lada';
        this._saveLocalData(data);
        return { ok: true, message: 'Reserva cancel·lada correctament i plaça alliberada.' };
      }
    }
    return { ok: false, error: 'Reserva no trobada' };
  },

  async updateReservaAssistencia(id, assistit) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/reserves/assistencia`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, assistit })
        });
        return await res.json();
      } catch (e) {
        console.warn('Error actualitzant assistència:', e);
      }
    }
    const data = this._getLocalData();
    const r = (data.reserves || []).find(x => x.id === id);
    if (r) {
      r.estat = assistit ? 'assistit' : 'confirmada';
      this._saveLocalData(data);
      return { ok: true, reserva: r };
    }
    return { ok: false, error: 'Reserva no trobada' };
  },

  async guardarAforamentMaxim(num) {
    const val = parseInt(num, 10) || 8;
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/reserves/config-aforament`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aforamentMaxim: val })
        });
        return await res.json();
      } catch (e) {
        console.warn('Error guardant aforament:', e);
      }
    }
    await this.saveConfig({ aforament_maxim_per_franja: String(val) });
    return { ok: true, aforamentMaxim: val };
  },

  async getActivitatsConfig() {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/reserves/activitats?t=${Date.now()}`);
        const json = await res.json();
        if (json.ok && json.activitats) return json.activitats;
      } catch (e) {
        console.warn('Error obtenint activitats:', e);
      }
    }
    return this.getActivitats();
  },

  async guardarCapacitatsActivitats(payload) {
    const dataToSend = {
      capacitat_max_torn: parseInt(payload.capacitat_max_torn, 10) || 4,
      capacitat_max_modelatge: parseInt(payload.capacitat_max_modelatge, 10) || 8,
      capacitat_max_pintar: parseInt(payload.capacitat_max_pintar, 10) || 12
    };
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/reserves/config-activitats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dataToSend)
        });
        const json = await res.json();
        if (json.ok) return json;
      } catch (e) {
        console.warn('Error guardant capacitats:', e);
      }
    }
    await this.saveConfig({
      capacitat_max_torn: String(dataToSend.capacitat_max_torn),
      capacitat_max_modelatge: String(dataToSend.capacitat_max_modelatge),
      capacitat_max_pintar: String(dataToSend.capacitat_max_pintar)
    });
    return { ok: true, activitats: this.getActivitats() };
  },

  async testWhatsAppMeta(telefon, template = 'reserva_confirmada') {
    if (this.mode === 'api') {
      const res = await fetch(`${this.apiBase}/api/whatsapp/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefon, template })
      });
      return await res.json();
    }
    return { ok: false, error: 'Només disponible en mode servidor/API' };
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
