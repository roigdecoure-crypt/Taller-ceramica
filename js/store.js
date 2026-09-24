/**
 * store.js - Gestor de dades híbrid (API Python/SQLite amb suport LocalStorage i Google Sheets)
 */

// Detecció de la URL del backend (Render quan està allotjat a OVH / extern, o relativa quan és local/Render)
function getRoigApiBase() {
  if (typeof window !== 'undefined') {
    if (window.ROIG_API_BASE !== undefined && window.ROIG_API_BASE !== null && window.ROIG_API_BASE !== '') {
      return String(window.ROIG_API_BASE).replace(/\/+$/, '');
    }
    try {
      if (window.localStorage) {
        var custom = window.localStorage.getItem('roig_custom_api_base');
        if (custom) return custom.trim().replace(/\/+$/, '');
      }
    } catch (e) {}

    if (window.location) {
      var host = (window.location.hostname || '').toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.onrender.com')) {
        return '';
      }
    }
  }
  return 'https://taller-ceramica-nb96.onrender.com';
}

if (typeof window !== 'undefined') {
  window.getRoigApiBase = getRoigApiBase;
  if (!window.ROIG_API_BASE) {
    window.ROIG_API_BASE = getRoigApiBase();
  }
}

const Store = {
  // Mode: 'api' (servidor actiu) o 'local' (offline/standalone)
  mode: 'api',
  apiBase: typeof getRoigApiBase === 'function' ? getRoigApiBase() : 'https://taller-ceramica-nb96.onrender.com',

  // Clau de localStorage per a mode offline
  STORAGE_KEY: 'taller_ceramica_v1',

  async init() {
    if (!this.apiBase && typeof getRoigApiBase === 'function') {
      this.apiBase = getRoigApiBase();
    }
    if (!this.apiBase) {
      this.apiBase = 'https://taller-ceramica-nb96.onrender.com';
    }
    this.mode = 'api';
    try {
      const res = await fetch(`${this.apiBase}/api/status`, { cache: 'no-cache' });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        this.mode = 'api';
        return 'api';
      }
    } catch (e) {
      console.warn('Avís de connexió inicial /api/status:', e);
    }
    return this.mode;
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
          taller_nom: 'Roig de Coure',
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
          google_calendar_name: 'reserves'
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
        const res = await fetch(`${this.apiBase}/api/alumnes?t=${Date.now()}`, {
          cache: 'no-store',
          headers: this.getAdminAuthHeaders()
        });
        const json = await res.json();
        if (json.ok && Array.isArray(json.data)) {
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
    if (!id) return null;
    const cleanId = String(id).trim();
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/alumnes/${encodeURIComponent(cleanId)}`, {
          headers: this.getAdminAuthHeaders()
        });
        const json = await res.json();
        if (json.ok) return json;
      } catch (e) {
        console.warn('Error connectant a l\'API, fallback local');
        this.mode = 'local';
      }
    }

    const data = this._getLocalData();
    const cleanDigits = cleanId.replace(/[^0-9]/g, '');
    const cleanUpper = cleanId.toUpperCase();
    const noTcUpper = cleanUpper.replace(/^TC[-\s_]*/, '');
    const noSpacesUpper = cleanUpper.replace(/[\s\-_]/g, '');
    const student = (data.alumnes || []).find(a => {
      if (!a) return false;
      const aId = (a.id || '').trim().toUpperCase();
      const aIdNoSpaces = aId.replace(/[\s\-_]/g, '');
      const aIdNoTc = aId.replace(/^TC[-\s_]*/, '');
      const aPin = String(a.pin || '').trim();
      const aTel = String(a.telefon || '').replace(/[^0-9]/g, '');
      const aFullName = `${a.nom || ''} ${a.cognoms || ''}`.trim().toUpperCase();
      
      return (
        aId === cleanUpper ||
        aId === noTcUpper ||
        aIdNoSpaces === noSpacesUpper ||
        aIdNoTc === noTcUpper ||
        (cleanUpper.length >= 3 && (aId.startsWith(cleanUpper) || aIdNoTc.startsWith(noTcUpper))) ||
        (aPin && aPin === cleanId) ||
        (cleanDigits.length >= 6 && aTel && aTel.endsWith(cleanDigits)) ||
        aFullName === cleanUpper ||
        (cleanUpper.length >= 4 && aFullName.startsWith(cleanUpper))
      );
    });
    if (!student) return null;

    const packs = (data.paquets || []).filter(p => p.student_id === student.id).sort((a,b) => new Date(b.data) - new Date(a.data));
    const sessions = (data.sessions || []).filter(s => s.student_id === student.id).sort((a,b) => new Date(b.entrada) - new Date(a.entrada));
    const reserves = (data.reserves || []).filter(r => r.student_id === student.id).sort((a,b) => new Date((b.data || '') + 'T' + (b.hora_inici || '00:00')) - new Date((a.data || '') + 'T' + (a.hora_inici || '00:00')));
    const openSess = sessions.find(s => s.estat === 'oberta');
    const balanc = TimeUtils.calculateStudentBalance(student.id, packs, sessions);

    return {
      ok: true,
      alumne: student,
      paquets: packs,
      sessions: sessions,
      reserves: reserves,
      sessioActiva: openSess || null,
      balanc: balanc
    };
  },

  async loginAlumne(identifier, password) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/alumnes/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, pin: password })
        });
        const data = await res.json();
        return data;
      } catch (err) {
        console.warn('API error, fallback local');
      }
    }
    // Fallback local
    const details = await this.getAlumne(identifier);
    if (!details || !details.alumne) {
      return { ok: false, error: 'No s\'ha trobat cap alumne amb aquest nom o identificador' };
    }
    const storedPin = String(details.alumne.pin || '').trim();
    const inputPin = String(password || '').trim();
    if (storedPin && storedPin !== inputPin) {
      return { ok: false, error: 'Contrasenya (PIN) incorrecta. Revisa el teu PIN o fes servir les opcions de recuperació.' };
    }
    return { ok: true, ...details };
  },

  async sollicitarRecuperacioAlumne(identifier) {
    if (this.mode === 'api' || this.apiBase) {
      try {
        const res = await fetch(`${this.apiBase}/api/alumnes/sollicitar-recuperacio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: String(identifier || '').trim() })
        });
        return await res.json();
      } catch (err) {
        return { ok: false, error: 'Error de connexió: ' + err.message };
      }
    }
    return { ok: false, error: "La recuperació autònoma per WhatsApp requereix connexió al servidor." };
  },

  async verificarOtpIRestablir(studentId, otp, newPassword) {
    if (this.mode === 'api' || this.apiBase) {
      try {
        const res = await fetch(`${this.apiBase}/api/alumnes/verificar-otp-i-restablir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            student_id: studentId,
            otp: String(otp || '').trim(),
            new_password: String(newPassword || '').trim()
          })
        });
        return await res.json();
      } catch (err) {
        return { ok: false, error: 'Error de connexió: ' + err.message };
      }
    }
    return { ok: false, error: "La verificació de codi requereix connexió al servidor." };
  },

  async recuperarPinAlumne(identifier, contact) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/alumnes/recuperar-pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, contact })
        });
        return await res.json();
      } catch (err) {
        return { ok: false, error: 'Error de connexió: ' + err.message };
      }
    }
    // Fallback local
    const details = await this.getAlumne(identifier);
    if (!details || !details.alumne) {
      return { ok: false, error: 'No s\'ha trobat cap alumne amb aquest identificador' };
    }
    const a = details.alumne;
    const cleanContact = String(contact || '').replace(/[\s\-_]/g, '').toLowerCase();
    const cleanDigits = cleanContact.replace(/[^0-9]/g, '');
    const storedTel = String(a.telefon || '').replace(/[^0-9]/g, '');
    const storedEmail = String(a.email || '').trim().toLowerCase();

    const matched = (cleanDigits && storedTel && (storedTel.endsWith(cleanDigits.slice(-9)) || cleanDigits.endsWith(storedTel.slice(-9)))) ||
                    (cleanContact && storedEmail && cleanContact === storedEmail);
    if (!matched) {
      return { ok: false, error: 'El telèfon o correu electrònic no coincideix amb el registrat a la fitxa de l\'alumne.' };
    }
    return { ok: true, nom: a.nom, id: a.id, pin: a.pin || '1234' };
  },

  async canviarPinAlumne(studentId, newPin, currentPin = null) {
    const cleanPin = String(newPin || '').trim();
    if (cleanPin.length < 4) {
      return { ok: false, error: 'La nova contrasenya ha de tenir almenys 4 caracters' };
    }

    let apiRes = null;
    if (this.mode === 'api' || this.apiBase) {
      try {
        const res = await fetch(`${this.apiBase}/api/alumnes/canviar-pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ student_id: studentId, new_pin: cleanPin, current_pin: currentPin })
        });
        apiRes = await res.json();
        if (apiRes && !apiRes.ok) return apiRes;
      } catch (err) {
        console.warn('Avís API canviar-pin:', err);
      }
    }

    // Actualitzar localment
    const data = this._getLocalData();
    const student = (data.alumnes || []).find(a => a.id === studentId);
    if (student) {
      student.pin = cleanPin;
      this._saveLocalData(data);
    }
    try { localStorage.setItem('logged_student_pin', cleanPin); } catch (e) {}

    // SINCRONITZACIÓ DIRECTA A GOOGLE SHEETS (Garanteix persistència total)
    try {
      const cfg = await this.getConfig();
      const gsUrl = cfg.google_sheets_url || 'https://script.google.com/macros/s/AKfycbzMoUg5Ulqpgepq4D01yolxmGjZsI8yjnNt64gwLnst_QnhkF6GgwaGJcXcv4VFZBQO/exec';
      if (gsUrl) {
        let stObj = null;
        try {
          const stDetails = await this.getAlumne(studentId);
          if (stDetails && stDetails.alumne) {
            stObj = { ...stDetails.alumne, pin: cleanPin };
          }
        } catch (e) {}
        if (!stObj) {
          stObj = student ? { ...student, pin: cleanPin } : { id: studentId, pin: cleanPin };
        }
        fetch(gsUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sync_alumne', payload: stObj })
        }).catch(err => console.warn('Error sync GS student PIN:', err));
      }
    } catch (e) {}

    return apiRes || { ok: true, message: 'Contrasenya actualitzada i sincronitzada permanentment' };
  },

  async registrarAlumne(studentData) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/alumnes/registre`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(studentData)
        });
        const json = await res.json();
        if (json.ok && json.alumne) {
          const local = this._getLocalData();
          if (!local.alumnes) local.alumnes = [];
          const exIdx = local.alumnes.findIndex(a => a.id === json.alumne.id);
          const studentObj = { ...json.alumne, pin: studentData.pin || studentData.contrasenya };
          if (exIdx >= 0) local.alumnes[exIdx] = studentObj;
          else local.alumnes.push(studentObj);
          this._saveLocalData(local);
        }
        return json;
      } catch (e) {
        console.error('Error registre API:', e);
        return { ok: false, error: 'No s\'ha pogut connectar amb el servidor del taller. Si us plau, comprova la connexió o intenta-ho de nou.' };
      }
    }
    // Fallback local només si explícitament estem en mode local
    return await this.saveAlumne(studentData);
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
    let edat = studentData.edat !== undefined && studentData.edat !== null && String(studentData.edat).trim() !== '' ? parseInt(studentData.edat, 10) : null;
    const dataNaixement = studentData.data_naixement || null;
    if (dataNaixement && typeof TimeUtils !== 'undefined' && typeof TimeUtils.calculateAge === 'function') {
      const calc = TimeUtils.calculateAge(dataNaixement);
      if (calc !== null) edat = calc;
    }

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
      edat: edat,
      data_naixement: dataNaixement
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
    const nowIso = TimeUtils.toLocalIsoString ? TimeUtils.toLocalIsoString(now) : now.toISOString();
    const today = TimeUtils.toLocalDateString ? TimeUtils.toLocalDateString(now) : nowIso.slice(0, 10);
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

  async getActiveSessions() {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/sessions`);
        const json = await res.json();
        const list = Array.isArray(json) ? json : (json.data || json.sessions || []);
        return list.filter(s => s.estat === 'oberta' || !s.sortida);
      } catch (e) {
        console.warn('Error getActiveSessions API, fallback local:', e);
      }
    }
    const data = this._getLocalData();
    return (data.sessions || []).filter(s => s.estat === 'oberta' || !s.sortida);
  },

  async getSessions(filter = {}) {
    if (this.mode === 'api') {
      try {
        let url = `${this.apiBase}/api/sessions`;
        if (filter.student_id) url += `?student_id=${encodeURIComponent(filter.student_id)}`;
        const res = await fetch(url);
        const json = await res.json();
        const list = Array.isArray(json) ? json : (json.data || json.sessions || []);
        return list;
      } catch (e) {
        console.warn('Error getSessions API, fallback local:', e);
      }
    }
    const data = this._getLocalData();
    let list = data.sessions || [];
    if (filter.student_id) list = list.filter(s => s.student_id === filter.student_id);
    return list;
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
          headers: this.getAdminAuthHeaders(),
          body: JSON.stringify(packData)
        });
        const json = await res.json();
        if (res.status === 401 || res.status === 403 || !json.ok) return json;
        return json;
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
        const res = await fetch(`${this.apiBase}/api/paquets/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: this.getAdminAuthHeaders()
        });
        const json = await res.json();
        if (res.status === 401 || res.status === 403 || !json.ok) return json;
        return json;
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
        const res = await fetch(`${this.apiBase}/api/config?t=${Date.now()}`, { cache: 'no-cache' });
        const json = await res.json();
        if (json.ok && json.config) {
          const data = this._getLocalData();
          data.config = { ...(data.config || {}), ...json.config };
          this._saveLocalData(data);
          return json.config;
        }
      } catch (e) {
        console.warn('Error obtenint configuració:', e);
      }
    }
    const data = this._getLocalData();
    return data.config || {};
  },

  getAdminAuthHeaders() {
    const token = (typeof localStorage !== 'undefined' && localStorage.getItem('roig_admin_token')) || 
                  (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('roig_admin_token')) || '';
    const pin = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('roig_admin_pin')) || 
                (typeof localStorage !== 'undefined' && localStorage.getItem('roig_admin_pin')) || '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (pin) {
      headers['X-Admin-PIN'] = pin;
    }
    return headers;
  },

  async saveConfig(cfg) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/config`, {
          method: 'POST',
          headers: this.getAdminAuthHeaders(),
          body: JSON.stringify(cfg)
        });
        const json = await res.json();
        if (res.status === 403 || !json.ok) return json;
        return json;
      } catch (e) {
        this.mode = 'local';
      }
    }
    const data = this._getLocalData();
    data.config = { ...(data.config || {}), ...cfg };
    this._saveLocalData(data);
    return { ok: true, message: 'Configuració desada' };
  },

  async authAdmin(pin) {
    const cleanPin = String(pin || '').trim();
    if (this.mode === 'api' || this.apiBase) {
      try {
        const res = await fetch(`${this.apiBase}/api/admin/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: cleanPin })
        });
        const data = await res.json();
        if (data && data.ok) {
          try {
            localStorage.setItem('roig_admin_auth', '1');
            localStorage.setItem('roig_admin_role', data.role || 'owner');
            if (data.token) localStorage.setItem('roig_admin_token', data.token);
            sessionStorage.setItem('roig_admin_auth', '1');
            sessionStorage.setItem('roig_admin_role', data.role || 'owner');
            if (data.token) sessionStorage.setItem('roig_admin_token', data.token);
          } catch(e) {}
        }
        return data;
      } catch (err) {
        console.warn('Error en authAdmin API:', err);
      }
    }
    const data = this._getLocalData();
    const currentStoredPin = (data.config && data.config.admin_pin) || localStorage.getItem('roig_admin_pin') || '1234';
    if (cleanPin === String(currentStoredPin).trim()) {
      try {
        localStorage.setItem('roig_admin_auth', '1');
        localStorage.setItem('roig_admin_role', 'owner');
      } catch(e) {}
      return { ok: true, role: 'owner', message: 'Autenticació correcta' };
    }
    return { ok: false, error: 'PIN incorrecte' };
  },

  async changeAdminCredentials(payload) {
    const apiBase = (typeof getAdminApiBase === 'function' ? getAdminApiBase() : (this.apiBase || (typeof getRoigApiBase === 'function' ? getRoigApiBase() : ''))) || '';
    if (this.mode === 'api' || apiBase) {
      try {
        const token = (typeof localStorage !== 'undefined' && localStorage.getItem('roig_admin_token')) || 
                      (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('roig_admin_token')) || '';
        const bodyData = { ...(payload || {}), token: token, admin_token: token };
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        const res = await fetch(`${apiBase}/api/admin/change-credentials`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(bodyData)
        });
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          return await res.json();
        }
        return { ok: false, error: `Error del servidor (${res.status}): format de resposta invàlid` };
      } catch (err) {
        return { ok: false, error: 'Error de connexió: ' + err.message };
      }
    }
    return { ok: true, message: 'Credencials actualitzades localment' };
  },

    async changeAdminPin(oldPin, newPin) {
    const cleanOld = String(oldPin || '').trim();
    const cleanNew = String(newPin || '').trim();

    if (!cleanOld || !cleanNew) {
      return { ok: false, error: 'Omple tant el PIN actual com el nou.' };
    }
    if (cleanNew.length < 4) {
      return { ok: false, error: 'El nou PIN ha de tenir com a mínim 4 caràcters.' };
    }

    let apiRes = null;
    if (this.mode === 'api' || this.apiBase) {
      try {
        const res = await fetch(`${this.apiBase}/api/admin/change-pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldPin: cleanOld, newPin: cleanNew })
        });
        apiRes = await res.json();
        if (apiRes && !apiRes.ok) return apiRes;
      } catch (err) {
        console.warn('Error canviant PIN via API:', err);
      }
    }

    // Desar localment
    const data = this._getLocalData();
    if (!data.config) data.config = {};
    data.config.admin_pin = cleanNew;
    this._saveLocalData(data);
    try { localStorage.setItem('roig_admin_pin', cleanNew); } catch (e) {}

    // SINCRONITZACIÓ DIRECTA A GOOGLE SHEETS (Perquè mai es restauri a 1234)
    try {
      const cfg = await this.getConfig();
      const gsUrl = cfg.google_sheets_url || 'https://script.google.com/macros/s/AKfycbzMoUg5Ulqpgepq4D01yolxmGjZsI8yjnNt64gwLnst_QnhkF6GgwaGJcXcv4VFZBQO/exec';
      if (gsUrl) {
        fetch(gsUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save_config', payload: { admin_pin: cleanNew } })
        }).catch(err => console.warn('Error sync GS admin PIN:', err));
      }
    } catch (e) {}

    return apiRes || { ok: true, message: "PIN d'administrador actualitzat i sincronitzat permanentment!" };
  },

  /* ====================== DISSENY DEL CARNET ====================== */

  async getCarnetConfig() {
    const defaultConfig = {
      background_color: '#b1ffc2',
      text_color: '#801b1b',
      font_style: 'borel',
      show_bowl_logo: true,
      custom_logo_svg: '',
      show_divider: true,
      brand_name: 'Roig de Coure',
      visible_fields: {
        nom: true,
        cognoms: true,
        codi: true,
        telefon: false,
        saldo: false
      }
    };
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/carnet/config?t=${Date.now()}`);
        const json = await res.json();
        if (json.ok && json.config) {
          return { ...defaultConfig, ...json.config, visible_fields: { ...defaultConfig.visible_fields, ...(json.config.visible_fields || {}) } };
        }
      } catch (e) {
        console.warn('Error carregant configuració del carnet de l\'API:', e);
      }
    }
    const data = this._getLocalData();
    const stored = data.config && data.config.carnet_design ? (typeof data.config.carnet_design === 'string' ? JSON.parse(data.config.carnet_design) : data.config.carnet_design) : null;
    return stored ? { ...defaultConfig, ...stored, visible_fields: { ...defaultConfig.visible_fields, ...(stored.visible_fields || {}) } } : defaultConfig;
  },

  async saveCarnetConfig(cfg) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/admin/carnet/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: cfg })
        });
        const json = await res.json();
        if (json.ok) return json;
      } catch (e) {
        this.mode = 'local';
      }
    }
    const data = this._getLocalData();
    data.config = data.config || {};
    data.config.carnet_design = cfg;
    this._saveLocalData(data);
    return { ok: true, message: 'Disseny del carnet desat localment' };
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

  sanitizeDate(val) {
    if (!val) return '';
    const s = String(val).trim();
    const m = s.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    const months = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    const m2 = s.match(/([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/);
    if (m2 && months[m2[1]]) return `${m2[3]}-${months[m2[1]]}-${String(m2[2]).padStart(2, '0')}`;
    return s.slice(0, 10);
  },

  sanitizeTime(val, defaultTime = '10:00') {
    if (!val) return defaultTime;
    const s = String(val).trim();
    const m = s.match(/(\d{1,2}):(\d{2})/);
    if (m) return `${String(m[1]).padStart(2, '0')}:${m[2]}`;
    return defaultTime;
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
      try {
        const freshRes = await this.getReserves();
        const d = this._getLocalData();
        d.reserves = freshRes;
        this._saveLocalData(d);
      } catch(e) {}
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
    if (json.data.reserves && Array.isArray(json.data.reserves)) {
      d.reserves = json.data.reserves.map(r => ({
        ...r,
        data: this.sanitizeDate(r.data),
        hora_inici: this.sanitizeTime(r.hora_inici, '10:00'),
        hora_fi: this.sanitizeTime(r.hora_fi, '11:30')
      }));
    }
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
    const reserves = (typeof this.getReserves === 'function') ? await this.getReserves() : (data.reserves || []);

    const payload = {
      action: 'sync_all',
      timestamp: new Date().toISOString(),
      alumnes: alumnes,
      paquets: paquets,
      sessions: sessions,
      reserves: reserves,
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
    let list = null;
    const base = this.apiBase || (typeof getRoigApiBase === 'function' ? getRoigApiBase() : 'https://taller-ceramica-nb96.onrender.com');
    if (base) {
      try {
        const q = new URLSearchParams(filters);
        const res = await fetch(`${base}/api/reserves?${q.toString()}&t=${Date.now()}`);
        if (res.ok) {
          const json = await res.json();
          if (json.ok && Array.isArray(json.data)) {
            list = json.data;
            this.mode = 'api';
            try {
              if (!filters.data && !filters.student_id && !filters.estat) {
                const d = this._getLocalData();
                d.reserves = list;
                this._saveLocalData(d);
              }
            } catch (e) {}
          }
        }
      } catch (e) {
        console.warn('Error obtenint reserves de l\'API:', e);
      }
    }
    
    if (!list || list.length === 0) {
      const data = this._getLocalData();
      let resList = data.reserves || [];
      if (filters.data) resList = resList.filter(r => this.sanitizeDate(r.data) === filters.data);
      if (filters.student_id) resList = resList.filter(r => r.student_id === filters.student_id);
      if (filters.estat) resList = resList.filter(r => r.estat === filters.estat);
      list = resList;
    }

    return (list || []).map(r => ({
      ...r,
      data: this.sanitizeDate(r.data),
      hora_inici: this.sanitizeTime(r.hora_inici, '10:00'),
      hora_fi: this.sanitizeTime(r.hora_fi, '11:30')
    }));
  },

  getActivitats() {
    const data = this._getLocalData();
    if (data.activitats && Array.isArray(data.activitats) && data.activitats.length > 0) {
      return data.activitats.filter(a => a.actiu !== false);
    }
    const capTorn = parseInt(data.config?.capacitat_max_torn || 2, 10);
    const capModelatge = parseInt(data.config?.capacitat_max_modelatge || 8, 10);
    const capPintar = parseInt(data.config?.capacitat_max_pintar || 12, 10);
    return [
      { id: "torn", nom: "Torn", descripcio: "classe de torn o acabar treballs de torn", capacitatMax: capTorn, icon: "", color: "#B91C1C", actiu: true },
      { id: "modelatge", nom: "Modelatge", descripcio: "modelatge o acabar treballs sense torn", capacitatMax: capModelatge, icon: "", color: "#047857", actiu: true },
      { id: "pintar", nom: "Pintar ceràmica", descripcio: "Pintar peces de biscuit ceràmica", capacitatMax: capPintar, icon: "", color: "#1D4ED8", actiu: true },
      { id: "experiencia_torn", nom: "Experiència al torn", descripcio: "Iniciació pràctica al torn de terrissaire (2h)", capacitatMax: 2, icon: "", color: "#831D1D", actiu: true },
      { id: "experiencia_modelatge", nom: "Experiència modelatge", descripcio: "Iniciació al modelatge ceràmic manual (2h)", capacitatMax: 8, icon: "", color: "#047857", actiu: true }
    ];
  },

  async getDisponibilitat(dataStr) {
    if (!dataStr) {
      const now = new Date();
      dataStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    }
    const base = this.apiBase || (typeof getRoigApiBase === 'function' ? getRoigApiBase() : 'https://taller-ceramica-nb96.onrender.com');
    if (base) {
      try {
        const res = await fetch(`${base}/api/reserves/disponibilitat?data=${encodeURIComponent(dataStr)}&t=${Date.now()}`);
        if (res.ok) {
          const json = await res.json();
          if (json.ok) {
            this.mode = 'api';
            return json;
          }
        }
      } catch (e) {
        console.warn('Error obtenint disponibilitat de l\'API:', e);
      }
    }

    // Fallback local
    const data = this._getLocalData();
    const maxCap = parseInt(data.config?.aforament_maxim_per_franja || 12, 10);
    const activitats = this.getActivitats();
    const defFranges = [
      { id: "M1", nom: "Matí (10:00 - 13:00)", inici: "10:00", fi: "13:00", hores: 2.0 }
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

    // Comprovar si hi ha dia de festa personalitzat
    const customFestiu = (data.dies_festius || []).find(f => dataStr >= f.data_inici && dataStr <= (f.data_fi || f.data_inici));
    if (customFestiu) {
      return {
        data: dataStr,
        tancat: true,
        festiuPersonalitzat: customFestiu,
        motiu: `Tancat per ${customFestiu.nom}${customFestiu.motiu ? ': ' + customFestiu.motiu : ''}`,
        aforamentMaxim: maxCap,
        totalPlacesDia: 0,
        totalOcupadesDia: 0,
        franges: [],
        activitats: activitats
      };
    }

    // Comprovar restriccions d'activitats
    const restr = (data.restriccions_activitats || []).find(r => dataStr >= r.data_inici && dataStr <= (r.data_fi || r.data_inici));
    const bloqIds = restr ? (restr.activitats_bloquejades || []).map(x => String(x).toLowerCase()) : [];

    const reservesDia = (data.reserves || []).filter(r => r.data === dataStr && r.estat === 'confirmada');
    let totalOcupadesDia = 0;

    const franges = defFranges.map(f => {
      const fRes = reservesDia.filter(r => r.franja === f.id || r.franja === f.nom);
      const ocupades = fRes.reduce((acc, r) => acc + (parseInt(r.places, 10) || 1), 0);
      totalOcupadesDia += ocupades;
      const lliures = Math.max(0, maxCap - ocupades);

      const activitatsFranja = activitats.map(act => {
        const isBlocked = bloqIds.includes(act.id.toLowerCase());
        const ocupatAct = fRes.filter(r => (r.activitat_id || '').toLowerCase() === act.id || (r.activitat || '').toLowerCase() === act.nom.toLowerCase())
                              .reduce((acc, r) => acc + (parseInt(r.places, 10) || 1), 0);
        const lliuresAct = isBlocked ? 0 : Math.max(0, act.capacitatMax - ocupatAct);
        const placesEfectives = isBlocked ? 0 : Math.min(lliures, lliuresAct);
        return {
          id: act.id,
          nom: act.nom,
          icon: act.icon,
          color: act.color,
          capacitatMax: act.capacitatMax,
          ocupat: ocupatAct,
          placesDisponibles: placesEfectives,
          bloquejada: isBlocked,
          motiuBloqueig: isBlocked ? (restr.motiu || 'Activitat no disponible per restricció de calendari') : '',
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
    const base = this.apiBase || (typeof getRoigApiBase === 'function' ? getRoigApiBase() : 'https://taller-ceramica-nb96.onrender.com');
    if (base) {
      try {
        const res = await fetch(`${base}/api/reserves/mes?any=${any}&mes=${mes}&t=${Date.now()}`);
        if (res.ok) {
          const json = await res.json();
          if (json.ok) {
            this.mode = 'api';
            return json;
          }
        }
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

    const forcarAforament = Boolean(reservaData.forcar_aforament || reservaData.ignorar_aforament || reservaData.force);

    // 1. L'aforament global del taller es comprova sempre (Màx. 12 places en total)
    const maxCap = parseInt(data.config?.aforament_maxim_per_franja || 12, 10);
    const existing = data.reserves.filter(r => r.data === reservaData.data && r.franja === (reservaData.franja || reservaData.franja_id) && r.estat === 'confirmada');
    const ocupades = existing.reduce((acc, r) => acc + (parseInt(r.places, 10) || 1), 0);
    const demanades = parseInt(reservaData.places || 1, 10);
    if (ocupades + demanades > maxCap) {
      return { ok: false, error: `Aforament global del taller complet per a aquesta franja (Màx. ${maxCap} places en total). No es pot sobrepassar el límit del taller.`, code: 'AFORAMENT_GLOBAL_COMPLET' };
    }

    if (!forcarAforament) {
      // Validar dia de festa
      const customFestiu = (data.dies_festius || []).find(f => reservaData.data >= f.data_inici && reservaData.data <= (f.data_fi || f.data_inici));
      if (customFestiu) {
        return { ok: false, error: `El taller està tancat en aquesta data: ${customFestiu.nom}${customFestiu.motiu ? ' (' + customFestiu.motiu + ')' : ''}.`, code: 'DIA_TANCAT' };
      }

      // Validar restricció d'activitats
      const actId = (reservaData.activitat_id || reservaData.activitat || '').toLowerCase();
      const restr = (data.restriccions_activitats || []).find(r => reservaData.data >= r.data_inici && reservaData.data <= (r.data_fi || r.data_inici));
      if (restr) {
        const bloq = (restr.activitats_bloquejades || []).map(x => String(x).toLowerCase());
        if (bloq.includes(actId)) {
          return { ok: false, error: `L'activitat triada no es pot impartir en aquesta data (${restr.motiu || 'activitat restringida per calendari'}).`, code: 'ACTIVITAT_RESTRINGIDA' };
        }
      }
    }
    const resId = `RES-${Date.now()}-${reservaData.student_id}`;
    const newRes = {
      id: resId,
      student_id: reservaData.student_id,
      student_nom: reservaData.student_nom || reservaData.student_id,
      telefon: reservaData.telefon || '',
      data: reservaData.data,
      franja: reservaData.franja || reservaData.franja_id || ((reservaData.hora_inici && reservaData.hora_inici >= '14:00') ? 'T1' : 'M1'),
      activitat: reservaData.activitat || 'Torn',
      activitat_id: reservaData.activitat_id || 'torn',
      places: demanades,
      hora_inici: reservaData.hora_inici || '10:00',
      hora_fi: reservaData.hora_fi || '12:00',
      hores: parseFloat(reservaData.hores) || 2.0,
      notes: reservaData.notes || '',
      estat: 'confirmada',
      created_at: new Date().toISOString()
    };
    data.reserves.push(newRes);
    this._saveLocalData(data);
    return { ok: true, reserva: newRes };
  },

  async marcarBestretaCobrada(reservaId, metode = 'TPV Físic (Taller)', importPagat = null) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/reserves/cobrar-bestreta`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: reservaId, metode: metode, import: importPagat })
        });
        return await res.json();
      } catch (e) {
        console.warn('Error cobrant bestreta:', e);
        return { ok: false, error: 'Error de connexió al servidor.' };
      }
    }

    const data = this._getLocalData();
    if (data.reserves) {
      const r = data.reserves.find(x => x.id === reservaId);
      if (r) {
        r.estat = 'confirmada';
        r.notes = (r.notes || '').replace('PENDENT', 'COBRADA') + ` [BESTRETA COBRADA: ${importPagat || (r.places * 10)}€ per ${metode}]`;
        this._saveLocalData(data);
        return { ok: true, message: 'Bestreta marcada com a cobrada.', reserva: r };
      }
    }
    return { ok: false, error: 'Reserva no trobada' };
  },

  async generarLinkBestreta(reservaId, places = 4, nom = '', telefon = '', importVal = null) {
    if (this.mode === 'api') {
      try {
        const safeReservaId = (reservaId && String(reservaId).trim()) ? String(reservaId).trim() : 'direct';
        const res = await fetch(`${this.apiBase}/api/checkout/paga-senyal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reserva_id: safeReservaId,
            places: places,
            nom: nom,
            telefon: telefon,
            import: importVal
          })
        });
        return await res.json();
      } catch (e) {
        console.warn('Error generant enllaç de bestreta:', e);
        return { ok: false, error: 'Error de connexió al servidor: ' + e.message };
      }
    }
    return { ok: false, error: 'La generació d\'enllaços de pagament requereix connexió activa amb el servidor.' };
  },

  async syncGoogleCalendar() {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/reserves/sync-calendar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const json = await res.json();
        if (json.ok) {
          const local = this._getLocalData();
          let modifiedLocal = false;
          if (local.reserves) {
            if (json.cancelled_ids && json.cancelled_ids.length > 0) {
              local.reserves.forEach(r => {
                if (json.cancelled_ids.includes(r.id)) {
                  r.estat = 'cancel·lada';
                  modifiedLocal = true;
                }
              });
            }
            if (json.updated_reserves && json.updated_reserves.length > 0) {
              const genuinelyUpdated = [];
              json.updated_reserves.forEach(u => {
                const r = local.reserves.find(item => item.id === u.id);
                if (r) {
                  const hasChanged = (r.data !== u.data) || (r.hora_inici !== u.hora_inici) || (u.hora_fi && r.hora_fi && r.hora_fi !== u.hora_fi);
                  if (hasChanged) {
                    r.data = u.data;
                    r.hora_inici = u.hora_inici;
                    if (u.hora_fi) r.hora_fi = u.hora_fi;
                    modifiedLocal = true;
                    genuinelyUpdated.push(u);
                  }
                }
              });
              json.updated_reserves = genuinelyUpdated;
              json.rescheduled_count = genuinelyUpdated.length;
            }
            if (modifiedLocal) this._saveLocalData(local);
          }
        }
        return json;
      } catch (e) {
        console.warn('Error sincronitzant Google Calendar amb API:', e);
      }
    }

    // Fallback directe a Google Apps Script si no hi ha connexió amb API backend
    try {
      const cfg = await this.getConfig();
      const url = cfg.google_sheets_url;
      if (!url) return { ok: false, error: 'Cap URL de Google Sheets/Calendar configurat', count: 0, cancelled_ids: [] };
      const sep = url.includes('?') ? '&' : '?';
      const res = await fetch(`${url}${sep}action=check_calendar_sync&t=${Date.now()}`);
      const json = await res.json();
      if (json.status === 'success') {
        const cancelled = json.cancelled_ids || [];
        const rawUpdated = json.updated_reserves || [];
        const local = this._getLocalData();
        let modifiedLocal = false;
        const genuinelyUpdated = [];
        if (local.reserves) {
          if (cancelled.length > 0) {
            local.reserves.forEach(r => {
              if (cancelled.includes(r.id)) {
                r.estat = 'cancel·lada';
                modifiedLocal = true;
              }
            });
          }
          if (rawUpdated.length > 0) {
            rawUpdated.forEach(u => {
              const r = local.reserves.find(item => item.id === u.id);
              if (r) {
                const hasChanged = (r.data !== u.data) || (r.hora_inici !== u.hora_inici) || (u.hora_fi && r.hora_fi && r.hora_fi !== u.hora_fi);
                if (hasChanged) {
                  r.data = u.data;
                  r.hora_inici = u.hora_inici;
                  if (u.hora_fi) r.hora_fi = u.hora_fi;
                  modifiedLocal = true;
                  genuinelyUpdated.push(u);
                }
              }
            });
          }
          if (modifiedLocal) this._saveLocalData(local);
        }
        return { 
          ok: true, 
          cancelled_ids: cancelled, 
          updated_reserves: genuinelyUpdated, 
          count: cancelled.length, 
          rescheduled_count: genuinelyUpdated.length,
          message: json.message 
        };
      }
      return { ok: false, error: json.message || 'Error comprovant Google Calendar', count: 0, cancelled_ids: [] };
    } catch (err) {
      console.warn('Error sincronitzant directament amb Apps Script:', err);
      return { ok: false, error: err.message, count: 0, cancelled_ids: [] };
    }
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
        return { ok: false, error: 'Error de connexió al servidor. Torna-ho a provar.' };
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

  async previewReservesRecurrents(previewData) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/reserves/recurrent-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(previewData)
        });
        return await res.json();
      } catch (e) {
        console.warn('Error preview reserves recurrents:', e);
      }
    }
    return { ok: false, error: 'Connexió no disponible per a la previsualització' };
  },

  async crearReservesRecurrents(recurringData) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/reserves/recurrent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(recurringData)
        });
        return await res.json();
      } catch (e) {
        console.warn('Error creant reserves recurrents a l\'API:', e);
      }
    }
    return { ok: false, error: 'Error de connexió al servidor' };
  },

  async cancelarSerieRecurrent(recurrentId, fromDate = null) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/reserves/cancel-serie`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recurrent_id: recurrentId, from_date: fromDate })
        });
        return await res.json();
      } catch (e) {
        console.warn('Error cancel·lant sèrie recurrent a l\'API:', e);
      }
    }
    return { ok: false, error: 'Error de connexió al servidor' };
  },

  async updateReservaHorari(updateData) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/reserves/update-horari`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData)
        });
        return await res.json();
      } catch (e) {
        console.warn('Error actualitzant horari reserva a l\'API:', e);
        return { ok: false, error: 'Error de connexió al servidor: ' + e.message };
      }
    }
    return { ok: false, error: 'Mode local no suportat per a la modificació de sèries' };
  },

  async updateSerieRecurrent(serieData) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/reserves/update-serie`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(serieData)
        });
        return await res.json();
      } catch (e) {
        console.warn('Error actualitzant sèrie recurrent a l\'API:', e);
        return { ok: false, error: 'Error de connexió al servidor: ' + e.message };
      }
    }
    return { ok: false, error: 'Mode local no suportat' };
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
    const val = parseInt(num, 10) || 12;
    const data = this._getLocalData();
    data.config = { ...(data.config || {}), aforament_maxim_per_franja: String(val) };
    this._saveLocalData(data);

    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/reserves/config-aforament`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aforamentMaxim: val })
        });
        const json = await res.json();
        try {
          await fetch(`${this.apiBase}/api/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ aforament_maxim_per_franja: String(val) })
          });
        } catch (ignored) {}
        return json;
      } catch (e) {
        console.warn('Error guardant aforament:', e);
      }
    }
    await this.saveConfig({ aforament_maxim_per_franja: String(val) });
    return { ok: true, aforamentMaxim: val };
  },

  async getActivitatsConfig(includeInactive = false) {
    if (this.mode === 'api') {
      try {
        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 3500) : null;
        const fetchOpts = controller ? { signal: controller.signal } : {};
        const res = await fetch(`${this.apiBase}/api/activitats?tots=${includeInactive ? '1' : '0'}&t=${Date.now()}`, fetchOpts);
        if (timeoutId) clearTimeout(timeoutId);
        const json = await res.json();
        if (json.ok && json.activitats) {
          json.activitats = json.activitats.filter(a => a.id !== 'experiencia_torn_adult' && a.id !== 'experiencia_torn_infant' && a.id !== 'experienciatornadult' && a.id !== 'experienciatorninfant');
          json.activitats.forEach(a => {
            if (a.id === 'torn') a.capacitatMax = 2;
            if (a.id === 'modelatge') a.capacitatMax = 8;
            if (a.id === 'pintar') a.capacitatMax = 12;
            if (a.id === 'experiencia_torn') { a.nom = 'Experiència al torn'; a.capacitatMax = 2; }
            if (a.id === 'experiencia_modelatge') { a.nom = 'Experiència modelatge'; a.capacitatMax = 8; }
          });
          if (!json.activitats.some(a => a.id === 'torn')) {
            json.activitats.unshift({ id: 'torn', nom: 'Torn', capacitatMax: 2, actiu: true });
          }
          if (!json.activitats.some(a => a.id === 'modelatge')) {
            json.activitats.push({ id: 'modelatge', nom: 'Modelatge', capacitatMax: 8, actiu: true });
          }
          if (!json.activitats.some(a => a.id === 'pintar')) {
            json.activitats.push({ id: 'pintar', nom: 'Pintar ceràmica', capacitatMax: 12, actiu: true });
          }
          if (!json.activitats.some(a => a.id === 'experiencia_torn')) {
            json.activitats.push({ id: 'experiencia_torn', nom: 'Experiència al torn', capacitatMax: 2, actiu: true });
          }
          if (!json.activitats.some(a => a.id === 'experiencia_modelatge')) {
            json.activitats.push({ id: 'experiencia_modelatge', nom: 'Experiència modelatge', capacitatMax: 8, actiu: true });
          }
          const local = this._getLocalData();
          local.activitats = json.activitats;
          this._saveLocalData(local);
          return json.activitats;
        }
      } catch (e) {
        console.warn('Error o timeout obtenint activitats:', e);
      }
    }
    const local = this._getLocalData();
    if (local.activitats && Array.isArray(local.activitats) && local.activitats.length > 0) {
      local.activitats = local.activitats.filter(a => a.id !== 'experiencia_torn_adult' && a.id !== 'experiencia_torn_infant' && a.id !== 'experienciatornadult' && a.id !== 'experienciatorninfant');
      local.activitats.forEach(a => {
        if (a.id === 'torn') a.capacitatMax = 2;
        if (a.id === 'modelatge') a.capacitatMax = 8;
        if (a.id === 'pintar') a.capacitatMax = 12;
        if (a.id === 'experiencia_torn') { a.nom = 'Experiència al torn'; a.capacitatMax = 2; }
        if (a.id === 'experiencia_modelatge') { a.nom = 'Experiència modelatge'; a.capacitatMax = 8; }
      });
      if (!local.activitats.some(a => a.id === 'torn')) {
        local.activitats.unshift({ id: 'torn', nom: 'Torn', capacitatMax: 2, actiu: true });
      }
      if (!local.activitats.some(a => a.id === 'modelatge')) {
        local.activitats.push({ id: 'modelatge', nom: 'Modelatge', capacitatMax: 8, actiu: true });
      }
      if (!local.activitats.some(a => a.id === 'pintar')) {
        local.activitats.push({ id: 'pintar', nom: 'Pintar ceràmica', capacitatMax: 12, actiu: true });
      }
      if (!local.activitats.some(a => a.id === 'experiencia_torn')) {
        local.activitats.push({ id: 'experiencia_torn', nom: 'Experiència al torn', capacitatMax: 2, actiu: true });
      }
      if (!local.activitats.some(a => a.id === 'experiencia_modelatge')) {
        local.activitats.push({ id: 'experiencia_modelatge', nom: 'Experiència modelatge', capacitatMax: 8, actiu: true });
      }
      return includeInactive ? local.activitats : local.activitats.filter(a => a.actiu !== false);
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
        const data = this._getLocalData();
        data.config = {
          ...(data.config || {}),
          capacitat_max_torn: String(dataToSend.capacitat_max_torn),
          capacitat_max_modelatge: String(dataToSend.capacitat_max_modelatge),
          capacitat_max_pintar: String(dataToSend.capacitat_max_pintar)
        };
        this._saveLocalData(data);
        return json;
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

  async getWhatsAppStatus() {
    const base = this.apiBase || (typeof getRoigApiBase === 'function' ? getRoigApiBase() : 'https://taller-ceramica-nb96.onrender.com');
    try {
      const res = await fetch(`${base}/api/whatsapp/status?t=${Date.now()}`);
      return await res.json();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async disconnectWhatsApp() {
    const base = this.apiBase || (typeof getRoigApiBase === 'function' ? getRoigApiBase() : 'https://taller-ceramica-nb96.onrender.com');
    try {
      const res = await fetch(`${base}/api/whatsapp/disconnect`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      return await res.json();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async testWhatsAppMeta(telefon, template = 'reserva_confirmada') {
    const base = this.apiBase || (typeof getRoigApiBase === 'function' ? getRoigApiBase() : 'https://taller-ceramica-nb96.onrender.com');
    try {
      const res = await fetch(`${base}/api/whatsapp/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefon, template })
      });
      return await res.json();
    } catch (e) {
      return { ok: false, error: e.message };
    }
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
  },

  async getFestius() {
    if (this.mode === 'api') {
      try {
        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 3500) : null;
        const fetchOpts = controller ? { signal: controller.signal } : {};
        const res = await fetch(`${this.apiBase}/api/festius?t=${Date.now()}`, fetchOpts);
        if (timeoutId) clearTimeout(timeoutId);
        const data = await res.json();
        if (data.ok) return data;
      } catch (e) {
        console.warn('Error o timeout obtenint festius de l\'API:', e);
      }
    }
    const local = this._getLocalData();
    return {
      ok: true,
      festius_oficials: [],
      festius_personalitzats: local.dies_festius || []
    };
  },

  async crearFestiu(festiuData) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/festius`, {
          method: 'POST',
          headers: this.getAdminAuthHeaders(),
          body: JSON.stringify(festiuData)
        });
        const json = await res.json();
        if (res.status === 403 || !json.ok) return json;
        return json;
      } catch (e) {
        console.warn('Error creant festiu a l\'API, intentant localment:', e);
      }
    }
    const local = this._getLocalData();
    if (!local.dies_festius) local.dies_festius = [];
    const newFestiu = {
      id: Date.now(),
      data_inici: festiuData.data_inici || festiuData.dataInici,
      data_fi: festiuData.data_fi || festiuData.dataFi || festiuData.data_inici,
      nom: festiuData.nom || 'Dia de Festa',
      motiu: festiuData.motiu || '',
      creat_el: new Date().toISOString()
    };
    local.dies_festius.push(newFestiu);
    this._saveLocalData(local);
    return { ok: true, id: newFestiu.id, message: 'Dia de festa desat' };
  },

  async eliminarFestiu(id) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/festius/delete`, {
          method: 'POST',
          headers: this.getAdminAuthHeaders(),
          body: JSON.stringify({ id })
        });
        const json = await res.json();
        if (res.status === 403 || !json.ok) return json;
        return json;
      } catch (e) {
        console.warn('Error eliminant festiu a l\'API, intentant localment:', e);
      }
    }
    const local = this._getLocalData();
    if (local.dies_festius) {
      local.dies_festius = local.dies_festius.filter(f => String(f.id) !== String(id));
      this._saveLocalData(local);
    }
    return { ok: true, message: 'Festiu eliminat' };
  },

  async getRestriccionsActivitats() {
    if (this.mode === 'api') {
      try {
        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 3500) : null;
        const fetchOpts = controller ? { signal: controller.signal } : {};
        fetchOpts.headers = this.getAdminAuthHeaders();
        const res = await fetch(`${this.apiBase}/api/restriccions-activitats?t=${Date.now()}`, fetchOpts);
        if (timeoutId) clearTimeout(timeoutId);
        const data = await res.json();
        if (data.ok) return data;
      } catch (e) {
        console.warn('Error o timeout obtenint restriccions de l\'API:', e);
      }
    }
    const local = this._getLocalData();
    return {
      ok: true,
      restriccions: local.restriccions_activitats || []
    };
  },

  async crearRestriccioActivitats(restriccioData) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/restriccions-activitats`, {
          method: 'POST',
          headers: this.getAdminAuthHeaders(),
          body: JSON.stringify(restriccioData)
        });
        const json = await res.json();
        if (res.status === 401 || res.status === 403 || !json.ok) return json;
        return json;
      } catch (e) {
        console.warn('Error creant restricció a l\'API, intentant localment:', e);
      }
    }
    const local = this._getLocalData();
    if (!local.restriccions_activitats) local.restriccions_activitats = [];
    const datesMultiples = restriccioData.dates_multiples || restriccioData.datesMultiples;
    if (datesMultiples && Array.isArray(datesMultiples) && datesMultiples.length > 0) {
      const newIds = [];
      for (const d of datesMultiples) {
        const item = {
          id: Date.now() + Math.floor(Math.random() * 10000),
          data_inici: d,
          data_fi: d,
          tipus_abast: restriccioData.tipus_abast || restriccioData.tipusAbast || 'dia',
          activitats_permeses: restriccioData.activitats_permeses || restriccioData.activitatsPermeses || [],
          activitats_bloquejades: restriccioData.activitats_bloquejades || restriccioData.activitatsBloquejades || [],
          motiu: restriccioData.motiu || '',
          torn: restriccioData.torn || 'tot_el_dia',
          creat_el: new Date().toISOString()
        };
        local.restriccions_activitats.push(item);
        newIds.push(item.id);
      }
      this._saveLocalData(local);
      return { ok: true, ids: newIds, count: newIds.length, message: `${newIds.length} restriccions de tallers desades` };
    }
    const newRestr = {
      id: Date.now(),
      data_inici: restriccioData.data_inici || restriccioData.dataInici,
      data_fi: restriccioData.data_fi || restriccioData.dataFi || restriccioData.data_inici,
      tipus_abast: restriccioData.tipus_abast || restriccioData.tipusAbast || 'dia',
      activitats_permeses: restriccioData.activitats_permeses || restriccioData.activitatsPermeses || [],
      activitats_bloquejades: restriccioData.activitats_bloquejades || restriccioData.activitatsBloquejades || [],
      motiu: restriccioData.motiu || '',
      torn: restriccioData.torn || 'tot_el_dia',
      creat_el: new Date().toISOString()
    };
    local.restriccions_activitats.push(newRestr);
    this._saveLocalData(local);
    return { ok: true, id: newRestr.id, message: 'Restricció de tallers desada' };
  },

  async eliminarRestriccioActivitats(id) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/restriccions-activitats/delete`, {
          method: 'POST',
          headers: this.getAdminAuthHeaders(),
          body: JSON.stringify({ id })
        });
        const json = await res.json();
        if (res.status === 401 || res.status === 403 || !json.ok) return json;
        return json;
      } catch (e) {
        console.warn('Error eliminant restricció a l\'API, intentant localment:', e);
      }
    }
    const local = this._getLocalData();
    if (local.restriccions_activitats) {
      local.restriccions_activitats = local.restriccions_activitats.filter(r => String(r.id) !== String(id));
      this._saveLocalData(local);
    }
    return { ok: true, message: 'Restricció eliminada' };
  },

  async crearTaller(tallerData) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/activitats`, {
          method: 'POST',
          headers: this.getAdminAuthHeaders(),
          body: JSON.stringify(tallerData)
        });
        const json = await res.json();
        if (json.ok && json.activitats) {
          const local = this._getLocalData();
          local.activitats = json.activitats;
          this._saveLocalData(local);
        }
        return json;
      } catch (e) {
        console.warn('Error creant taller a l\'API:', e);
      }
    }
    const local = this._getLocalData();
    if (!local.activitats) local.activitats = this.getActivitats();
    const id = tallerData.id || (tallerData.nom || 'taller').toLowerCase().replace(/[^a-z0-9]/g, '-');
    const newAct = {
      id,
      nom: tallerData.nom,
      descripcio: tallerData.descripcio || '',
      capacitatMax: parseInt(tallerData.capacitat_max || tallerData.capacitatMax || 4, 10),
      color: tallerData.color || '#B91C1C',
      actiu: true,
      ordre: local.activitats.length + 1
    };
    local.activitats.push(newAct);
    this._saveLocalData(local);
    return { ok: true, activitat: newAct, activitats: local.activitats };
  },

  async actualitzarTaller(id, tallerData) {
    const payload = { id, ...tallerData };
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/activitats/update`, {
          method: 'POST',
          headers: this.getAdminAuthHeaders(),
          body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (json.ok && json.activitats) {
          const local = this._getLocalData();
          local.activitats = json.activitats;
          this._saveLocalData(local);
        }
        return json;
      } catch (e) {
        console.warn('Error actualitzant taller a l\'API:', e);
      }
    }
    const local = this._getLocalData();
    if (!local.activitats) local.activitats = this.getActivitats();
    const idx = local.activitats.findIndex(a => a.id === id);
    if (idx !== -1) {
      local.activitats[idx] = { ...local.activitats[idx], ...tallerData };
      this._saveLocalData(local);
      return { ok: true, activitat: local.activitats[idx], activitats: local.activitats };
    }
    return { ok: false, error: 'Taller no trobat' };
  },

  async eliminarTaller(id) {
    if (this.mode === 'api') {
      try {
        const res = await fetch(`${this.apiBase}/api/activitats/delete`, {
          method: 'POST',
          headers: this.getAdminAuthHeaders(),
          body: JSON.stringify({ id })
        });
        const json = await res.json();
        if (json.ok && json.activitats) {
          const local = this._getLocalData();
          local.activitats = json.activitats;
          this._saveLocalData(local);
        }
        return json;
      } catch (e) {
        console.warn('Error eliminant taller a l\'API:', e);
      }
    }
    const local = this._getLocalData();
    if (local.activitats) {
      local.activitats = local.activitats.filter(a => a.id !== id);
      this._saveLocalData(local);
    }
    return { ok: true, message: 'Taller suprimit' };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Store;
}
