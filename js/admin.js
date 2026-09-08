/**
 * admin.js - Lògica del Panell d'Administració 360° per al Taller de Ceràmica
 */

let allStudents = [];
let currentViewingStudent = null;
let liveTimerInterval = null;

// Inicialització
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', async () => {
    initAdminAuth();
    setupEventListeners();
    startLiveClock();

    const isAuth = sessionStorage.getItem('roig_admin_auth') === '1';
    if (isAuth) {
      await loadAdminDashboardData();
    }
  });
}

async function loadAdminDashboardData() {
  try {
    await Store.init();
  } catch (err) {
    console.warn('Store.init warning:', err);
  }
  loadConfig();
  await refreshStudentsList();
  await initAppointmentsDashboard();
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Rellotge i actualització dels cronòmetres en viu
function startLiveClock() {
  const clockEl = document.getElementById('live-time-clock');
  setInterval(() => {
    const now = new Date();
    if (clockEl) clockEl.textContent = TimeUtils.formatTime(now);

    // Actualitzar cronòmetres dels alumnes actius al taller
    document.querySelectorAll('.live-student-timer').forEach(el => {
      const entradaIso = el.getAttribute('data-entrada');
      if (entradaIso) {
        const sec = TimeUtils.calculateDuration(entradaIso, new Date());
        el.textContent = TimeUtils.secondsToHms(sec);
      }
    });
  }, 1000);
}

// Carregar configuració general
async function loadConfig() {
  try {
    const cfg = await Store.getConfig();
    if (cfg.taller_nom) {
      const navWs = document.getElementById('nav-workshop-name');
      if (navWs) navWs.textContent = cfg.taller_nom;
      const wsNameBadge = document.getElementById('badge-ws-name');
      if (wsNameBadge) wsNameBadge.textContent = cfg.taller_nom;
    }
    if (cfg.brand_primary) {
      document.documentElement.style.setProperty('--brand-primary', cfg.brand_primary);
      document.documentElement.style.setProperty('--color-primary', cfg.brand_primary);
    }
    if (cfg.brand_secondary) {
      document.documentElement.style.setProperty('--brand-secondary', cfg.brand_secondary);
    }
    if (cfg.brand_font === 'serif') {
      document.documentElement.style.setProperty('--brand-font', "'Playfair Display', Georgia, serif");
    } else if (cfg.brand_font === 'sans') {
      document.documentElement.style.setProperty('--brand-font', "'Inter', -apple-system, sans-serif");
    } else {
      document.documentElement.style.setProperty('--brand-font', "Verdana, Geneva, Tahoma, sans-serif");
    }
    const lblDefecte = document.getElementById('lbl-durada-defecte');
    if (lblDefecte) lblDefecte.textContent = cfg.hores_per_defecte_oblit || '01:30:00';

    const sbLogo = document.getElementById('sidebar-logo-img');
    if (sbLogo) {
      let logoVal = (cfg.taller_logo_url || '').trim();
      if (logoVal.includes('PHN2Zz48L3N2Zz4=')) logoVal = '';
      sbLogo.src = logoVal || 'img/logo.png';
    }
  } catch (err) {
    console.warn('Error carregant configuració:', err);
  }
}

// Refrescar llista d'alumnes i panell en viu
async function refreshStudentsList() {
  try {
    allStudents = await Store.getAlumnes();
    if (!Array.isArray(allStudents)) allStudents = [];
    renderActiveStudentsBanner(allStudents);
    renderStudentsTable(allStudents);
  } catch (err) {
    console.error('Error carregant alumnes:', err);
    showToast('Error carregant alumnes: ' + err.message, 'error');
  }
}

// Renderitzar el banner d'alumnes actualment presents
function renderActiveStudentsBanner(students) {
  const container = document.getElementById('active-students-container');
  const countBadge = document.getElementById('count-alumnes-actius');
  if (!container || !countBadge) return;

  const list = Array.isArray(students) ? students : [];
  const activeList = list.filter(s => s && s.sessioActiva && s.sessioActiva.estat === 'oberta');

  countBadge.textContent = activeList.length;

  if (activeList.length === 0) {
    container.innerHTML = `
      <p style="color: var(--color-muted); font-size: 14px; grid-column: 1/-1; padding: 8px 0;">
        No hi ha cap alumne al taller en aquests moments. Quan passin el codi QR o marquis entrada apareixeran aquí.
      </p>
    `;
    return;
  }

  container.innerHTML = '';
  activeList.forEach(s => {
    if (!s) return;
    const sess = s.sessioActiva || {};
    const durSec = sess.entrada ? TimeUtils.calculateDuration(sess.entrada, new Date()) : 0;
    const durHms = TimeUtils.secondsToHms(durSec);
    const horaEntrada = sess.entrada ? TimeUtils.formatTime(sess.entrada) : '--:--';

    const card = document.createElement('div');
    card.className = 'active-student-card';
    card.innerHTML = `
      <div class="student-head">
        <div>
          <h4>${s.nom} ${s.cognoms || ''}</h4>
          <span class="student-id">${s.id} &bull; Entrat: ${horaEntrada}</span>
        </div>
        <span class="badge badge-success">Al taller</span>
      </div>
      <div class="live-timer-row">
        <span class="live-timer-label">Temps actual:</span>
        <span class="live-timer-value live-student-timer" data-entrada="${sess.entrada || ''}">${durHms}</span>
      </div>
      <div style="font-size: 12px; color: var(--color-muted);">
        Saldo restant: <strong>${s.balanc ? s.balanc.formatBalance : '00:00:00'}</strong>
      </div>
      <div class="active-card-actions">
        <button class="btn btn-primary btn-sm btn-action-checkout" data-id="${s.id}" style="flex:1;">
          Sortida Ara
        </button>
        <button class="btn btn-outline btn-sm btn-action-force-close" data-id="${s.id}" data-sess-id="${sess.id || ''}" data-nom="${s.nom}" data-entrada="${horaEntrada}" title="Tancar cicle si s'ha oblidat">
          Oblit
        </button>
        <button class="btn btn-outline btn-sm btn-action-view" data-id="${s.id}">
          Fitxa
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

// Renderitzar taula d'alumnes
function renderStudentsTable(students) {
  const tbody = document.getElementById('students-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const list = Array.isArray(students) ? students : [];
  const searchInput = document.getElementById('search-students-input');
  const filterText = (searchInput ? searchInput.value : '').toLowerCase().trim();
  const filtered = list.filter(s => {
    if (!s) return false;
    if (!filterText) return true;
    const full = `${s.nom || ''} ${s.cognoms || ''} ${s.telefon || ''} ${s.email || ''} ${s.id || ''} ${s.pin || ''}`.toLowerCase();
    return full.includes(filterText);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--color-muted); padding:32px; font-size:15px;">No s'ha trobat cap alumne registrat o coincident amb la cerca.</td></tr>`;
    return;
  }

  filtered.forEach(s => {
    if (!s) return;
    const isActiu = s.sessioActiva && s.sessioActiva.estat === 'oberta';
    const bal = s.balanc || { formatBalance: '00:00:00', isNegative: false, isLow: false };
    
    let saldoBadgeClass = 'badge-neutral';
    if (bal.isNegative) saldoBadgeClass = 'badge-danger';
    else if (bal.isLow) saldoBadgeClass = 'badge-warning';
    else saldoBadgeClass = 'badge-success';

    const tr = document.createElement('tr');
    tr.className = 'student-clickable-row';
    tr.dataset.id = s.id;
    tr.title = "Fes clic a qualsevol lloc de la fila per veure la informació i historial complet";
    let edatLabel = '';
    const age = (s.edat !== null && s.edat !== undefined) ? s.edat : (s.data_naixement && typeof TimeUtils !== 'undefined' && typeof TimeUtils.calculateAge === 'function' ? TimeUtils.calculateAge(s.data_naixement) : null);
    if (s.data_naixement) {
      const ageStr = age !== null ? ` (${age} anys · ${age >= 12 ? 'Adult' : 'Infantil'})` : '';
      edatLabel = `<div style="font-size:11px; color:var(--color-muted);">Naixement: ${TimeUtils.formatDate(s.data_naixement)}${ageStr}</div>`;
    } else if (age !== null) {
      edatLabel = `<div style="font-size:11px; color:var(--color-muted);">${age} anys (${age >= 12 ? 'Adult' : 'Infantil'})</div>`;
    }
    tr.innerHTML = `
      <td><strong>${s.id}</strong></td>
      <td>
        <div style="font-weight:600;">${s.nom} ${s.cognoms || ''}</div>
        ${edatLabel}
      </td>
      <td>${s.telefon || '-'}</td>
      <td>${s.email || '-'}</td>
      <td>
        ${isActiu ? '<span class="badge badge-success">Al Taller</span>' : '<span class="badge badge-neutral">Fora</span>'}
      </td>
      <td>
        <span class="badge ${saldoBadgeClass}" style="font-family:monospace; font-size:13px;">
          ${bal.formatBalance}
        </span>
      </td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn btn-outline btn-sm btn-action-view" data-id="${s.id}" title="Veure fitxa completa de l'alumne">
          Fitxa
        </button>
        <button class="btn btn-outline btn-sm btn-action-carnet" data-id="${s.id}" title="Veure carnet amb QR">
          Carnet
        </button>
        <button class="btn ${isActiu ? 'btn-danger' : 'btn-success'} btn-sm btn-action-toggle-sessio" data-id="${s.id}" data-action="${isActiu ? 'sortida' : 'entrada'}" title="${isActiu ? 'Registrar sortida ara mateix' : 'Registrar entrada ara mateix'}">
          ${isActiu ? 'Sortida' : 'Entrada'}
        </button>
        <button class="btn btn-outline btn-sm btn-action-open-manual-time" data-id="${s.id}" data-action="${isActiu ? 'sortida' : 'entrada'}" title="Ajustar hora d'entrada o sortida">
          Ajustar
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Listener de clic a la fila de la taula d'alumnes
  if (!tbody.dataset.rowClickListener) {
    tbody.dataset.rowClickListener = 'true';
    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('button, a');
      if (btn && !btn.classList.contains('btn-action-view')) {
        return;
      }
      const row = e.target.closest('tr.student-clickable-row');
      if (row && row.dataset.id) {
        openStudentInlineDetail(row.dataset.id);
      }
    });
  }
}

// OBRIR FITXA COMPLETA D'ALUMNE (INLINE A LA MATEIXA PÀGINA, SENSE FINESTRA)
async function openStudentInlineDetail(studentId) {
  try {
    const details = await Store.getAlumne(studentId);
    if (!details) return;

    currentViewingStudent = details;
    const a = details.alumne;
    const bal = details.balanc || { formatBalance: '00:00:00', humanBalance: '0h 0m 0s', formatBought: '00:00:00', formatSpent: '00:00:00' };

    // Assegurar pestanya d'alumnes activa
    const targetView = document.getElementById('view-alumnes');
    if (targetView && !targetView.classList.contains('active')) {
      document.querySelectorAll('.admin-tab-view').forEach(view => view.classList.remove('active'));
      targetView.classList.add('active');
      document.querySelectorAll('.sidebar-item').forEach(i => {
        i.classList.toggle('active', i.dataset.tab === 'alumnes');
      });
    }

    // Commutar contenidors: ocultar taula i mostrar fitxa
    const listCont = document.getElementById('alumnes-list-container');
    const detailCont = document.getElementById('alumnes-detail-container');
    if (listCont) listCont.style.display = 'none';
    if (detailCont) detailCont.style.display = 'block';

    // Capçalera
    const idEl = document.getElementById('inline-student-id');
    const nameEl = document.getElementById('inline-student-fullname');
    if (idEl) idEl.textContent = a.id;
    if (nameEl) nameEl.textContent = `${a.nom} ${a.cognoms || ''}`;

    // Estat de presència
    const isActiu = details.sessioActiva && details.sessioActiva.estat === 'oberta';
    const presenceBadge = document.getElementById('inline-student-presence-badge');
    const statusHtml = isActiu
      ? `<span class="badge badge-success" style="font-size:13px; padding:6px 12px;">Al Taller des de les ${TimeUtils.formatTime(details.sessioActiva.entrada)}</span>`
      : `<span class="badge badge-neutral" style="font-size:13px; padding:6px 12px;">Fora del taller</span>`;
    if (presenceBadge) presenceBadge.innerHTML = statusHtml;

    // Perfil i contacte
    const phoneEl = document.getElementById('inline-student-phone');
    if (phoneEl) {
      if (a.telefon) {
        phoneEl.innerHTML = `<a href="tel:${a.telefon}" style="color:inherit; text-decoration:underline;">${a.telefon}</a>`;
      } else {
        phoneEl.textContent = '-';
      }
    }

    const emailEl = document.getElementById('inline-student-email');
    if (emailEl) {
      if (a.email) {
        emailEl.innerHTML = `<a href="mailto:${a.email}" style="color:inherit; text-decoration:underline;">${a.email}</a>`;
      } else {
        emailEl.textContent = '-';
      }
    }

    const pinEl = document.getElementById('inline-student-pin');
    if (pinEl) pinEl.textContent = a.pin || '-';

    const birthEl = document.getElementById('inline-student-data-naixement');
    if (birthEl) {
      birthEl.textContent = a.data_naixement ? TimeUtils.formatDate(a.data_naixement) : '-';
    }

    const edatEl = document.getElementById('inline-student-edat');
    if (edatEl) {
      const calcAge = (a.edat !== null && a.edat !== undefined) ? a.edat : (a.data_naixement && typeof TimeUtils !== 'undefined' && typeof TimeUtils.calculateAge === 'function' ? TimeUtils.calculateAge(a.data_naixement) : null);
      edatEl.textContent = calcAge !== null ? `${calcAge} anys (${calcAge >= 12 ? 'Adult' : 'Infantil'})` : '-';
    }

    const altaEl = document.getElementById('inline-student-alta');
    if (altaEl) altaEl.textContent = a.data_alta ? TimeUtils.formatDate(a.data_alta) : '-';

    const notesCont = document.getElementById('inline-student-notes-container');
    const notesEl = document.getElementById('inline-student-notes');
    if (notesCont && notesEl) {
      if (a.notes && a.notes.trim()) {
        notesEl.textContent = a.notes;
        notesCont.style.display = 'block';
      } else {
        notesCont.style.display = 'none';
      }
    }

    // Botó WhatsApp
    const waBtn = document.getElementById('inline-btn-whatsapp');
    if (waBtn) {
      if (a.telefon) {
        const cleanPhone = a.telefon.replace(/\D/g, '');
        waBtn.href = `https://wa.me/34${cleanPhone}`;
        waBtn.style.display = 'inline-flex';
      } else {
        waBtn.style.display = 'none';
      }
    }

    // Hero de Saldo
    const balVal = document.getElementById('inline-student-balance-val');
    const balHuman = document.getElementById('inline-student-balance-human');
    const boughtEl = document.getElementById('inline-student-total-bought');
    const spentEl = document.getElementById('inline-student-total-spent');
    const sessStatusEl = document.getElementById('inline-student-session-status');

    if (balVal) balVal.textContent = bal.formatBalance;
    if (balHuman) balHuman.textContent = bal.humanBalance;
    if (boughtEl) boughtEl.textContent = bal.formatBought;
    if (spentEl) spentEl.textContent = bal.formatSpent;
    if (sessStatusEl) sessStatusEl.innerHTML = statusHtml;

    // Comptadors
    const reservesList = details.reserves || [];
    const sessionsList = details.sessions || [];
    const paquetsList = details.paquets || [];

    const countRes = document.getElementById('inline-count-reserves');
    const countSess = document.getElementById('inline-count-sessions');
    const countPacks = document.getElementById('inline-count-paquets');
    if (countRes) countRes.textContent = reservesList.length;
    if (countSess) countSess.textContent = sessionsList.length;
    if (countPacks) countPacks.textContent = paquetsList.length;

    // Renderitzar taules d'historial
    renderInlineStudentReserves(reservesList);
    renderInlineStudentSessions(sessionsList);
    renderInlineStudentPaquets(paquetsList);

    // Scroll cap a dalt de la pàgina
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    showToast('Error obrint la fitxa de l\'alumne: ' + err.message, 'error');
  }
}

// TANCAR FITXA D'ALUMNE I TORNAR AL LLISTAT
function closeStudentInlineDetail() {
  const detailCont = document.getElementById('alumnes-detail-container');
  const listCont = document.getElementById('alumnes-list-container');
  if (detailCont) detailCont.style.display = 'none';
  if (listCont) listCont.style.display = 'block';
  currentViewingStudent = null;
  const heading = document.getElementById('admin-view-heading');
  if (heading) heading.textContent = 'Alumnes & Clients';
}

// RENDERITZAR TAULA DE RESERVES DE L'ALUMNE
function renderInlineStudentReserves(reserves) {
  const tbody = document.getElementById('inline-reserves-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!reserves || reserves.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--color-muted); padding:24px; font-size:14px;">No hi ha cap reserva registrada per a aquest alumne.</td></tr>`;
    return;
  }

  reserves.forEach(r => {
    const isCancelada = r.estat === 'cancel·lada';
    let estatBadge = '<span class="badge badge-success">Confirmada</span>';
    if (isCancelada) estatBadge = '<span class="badge badge-danger">Cancel·lada</span>';
    else if (r.estat === 'pendent') estatBadge = '<span class="badge badge-warning">Pendent</span>';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${TimeUtils.formatDate(r.data)}</td>
      <td><strong>${r.hora_inici || '-'} - ${r.hora_fi || '-'}</strong></td>
      <td><span class="badge badge-neutral">${r.torn || 'Franja'}</span></td>
      <td><strong>${r.activitat || 'Ceràmica'}</strong></td>
      <td><span class="badge badge-info">${r.places || 1} plaça</span></td>
      <td>${estatBadge}</td>
      <td style="font-size:12px; color:var(--color-muted); max-width:180px;">${r.notes || '-'}</td>
      <td style="text-align: right; white-space: nowrap;">
        ${!isCancelada 
          ? `<button type="button" class="btn btn-outline btn-sm btn-inline-cancel-reserva" data-id="${r.id}" style="color:var(--color-danger); border-color:var(--color-danger); padding:3px 8px;" title="Cancel·lar aquesta reserva i alliberar la plaça">Cancel·lar</button>`
          : `<span style="color:var(--color-muted); font-size:12px;">Cancel·lada</span>`
        }
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// RENDERITZAR TAULA DE SESSIONS DE L'ALUMNE
function renderInlineStudentSessions(sessions) {
  const tbody = document.getElementById('inline-sessions-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!sessions || sessions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--color-muted); padding:24px; font-size:14px;">Encara no hi ha cap sessió registrada.</td></tr>`;
    return;
  }

  sessions.forEach(s => {
    const isOberta = s.estat === 'oberta';
    const isForcada = s.estat === 'tancada_forçada';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${TimeUtils.formatDate(s.data || s.entrada)}</td>
      <td>${TimeUtils.formatTime(s.entrada)}</td>
      <td>${s.sortida ? TimeUtils.formatTime(s.sortida) : '<span class="badge badge-success">Al taller</span>'}</td>
      <td><strong>${s.format_hms || '00:00:00'}</strong></td>
      <td>
        <span class="badge ${s.tipus === 'qr' ? 'badge-info' : 'badge-neutral'}">${s.tipus || 'qr'}</span>
      </td>
      <td>
        ${isOberta ? '<span class="badge badge-success">Oberta</span>' : (isForcada ? '<span class="badge badge-warning" title="Tancat per oblit">Oblit</span>' : '<span class="badge badge-neutral">Tancada</span>')}
      </td>
      <td style="text-align: right; white-space: nowrap;">
        <button type="button" class="btn btn-outline btn-sm btn-edit-sessio" data-id="${s.id}" style="padding:3px 8px; margin-right:4px;" title="Modificar horaris de la sessió">Editar</button>
        <button type="button" class="btn btn-outline btn-sm btn-delete-sessio" data-id="${s.id}" style="color:var(--color-danger); border-color:var(--color-danger); padding:3px 8px;" title="Eliminar sessió">Eliminar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// RENDERITZAR TAULA DE COMPRES DE PAQUETS DE L'ALUMNE
function renderInlineStudentPaquets(paquets) {
  const tbody = document.getElementById('inline-paquets-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!paquets || paquets.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--color-muted); padding:24px; font-size:14px;">Encara no s'ha comprat cap paquet d'hores.</td></tr>`;
    return;
  }

  paquets.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${TimeUtils.formatDate(p.data)}</td>
      <td><strong>${p.concepte || 'Pack Hores'}</strong></td>
      <td><span class="badge badge-success">+${p.hores}h (${TimeUtils.secondsToHms(p.segons)})</span></td>
      <td>${p.preu ? p.preu + '€' : '-'}</td>
      <td><span class="badge badge-neutral">${p.metode_pagament || 'Efectiu'}</span></td>
      <td style="text-align: right; white-space: nowrap;">
        <button type="button" class="btn btn-outline btn-sm btn-delete-paquet" data-id="${p.id}" style="color:var(--color-danger); border-color:var(--color-danger); padding:3px 8px;" title="Eliminar compra">Eliminar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Compatibilitat retroactiva: redirigir qualsevol crida de Drawer cap a la nova fitxa inline a la mateixa pàgina
async function openStudentDrawer(studentId) {
  return openStudentInlineDetail(studentId);
}

// MOSTRAR CARNET AMB QR
async function showStudentBadgeModal(studentId) {
  const student = allStudents.find(s => s.id === studentId);
  if (!student) return;

  currentViewingStudent = { alumne: student };

  let cfg = {};
  try {
    cfg = await Store.getCarnetConfig();
  } catch (e) {
    cfg = { background_color: '#b1ffc2', text_color: '#801b1b', brand_name: 'Roig de Coure' };
  }

  const badge = document.getElementById('printable-badge');
  if (badge) {
    badge.style.setProperty('--card-bg-color', cfg.background_color || '#b1ffc2');
    badge.style.setProperty('--card-text-color', cfg.text_color || '#801b1b');
    const font = cfg.font_style === 'modern' ? 'system-ui, -apple-system, sans-serif' : "'Borel', 'Buffalo', cursive";
    badge.style.setProperty('--card-font-family', font);
  }

  const wsName = document.getElementById('badge-ws-name');
  if (wsName) wsName.textContent = cfg.brand_name || 'Roig de Coure';

  const logoContainer = document.getElementById('badge-ws-logo-container');
  if (logoContainer) {
    logoContainer.style.display = cfg.show_bowl_logo !== false ? 'flex' : 'none';
  }

  document.getElementById('badge-nom').textContent = student.nom;
  document.getElementById('badge-cognoms').textContent = student.cognoms || '—';
  document.getElementById('badge-id').textContent = student.id;

  // Generar QR
  const qrContainer = document.getElementById('badge-qr-container');
  if (qrContainer && typeof QREngine !== 'undefined') {
    QREngine.generateQR(qrContainer, student.id, 104);
  }

  // Botons de descàrrega al modal
  const btnSvg = document.getElementById('btn-modal-export-svg');
  if (btnSvg) {
    btnSvg.onclick = () => downloadCardAsSVG(student, cfg);
  }
  const btnPng = document.getElementById('btn-modal-export-png');
  if (btnPng) {
    btnPng.onclick = () => downloadCardAsPNG(student, cfg);
  }

  document.getElementById('modal-carnet-backdrop').classList.add('active');
}

// Obrir modal de registre manual (Admin)
async function openAdminManualCheckinModal(preselectedStudentId = null, preselectedAction = null) {
  const modal = document.getElementById('modal-admin-manual-backdrop');
  if (!modal) return;

  // Obrir el modal immediatament
  modal.classList.add('active');

  const select = document.getElementById('admin-manual-student-select');
  const customTimeInput = document.getElementById('admin-manual-custom-time');

  const fillSelect = (list) => {
    if (!select) return;
    select.innerHTML = '<option value="">-- Selecciona un alumne --</option>';
    (list || []).forEach(s => {
      const isInside = s.sessioActiva && s.sessioActiva.estat === 'oberta';
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.nom} ${s.cognoms || ''} (${s.id}) ${isInside ? '[Al taller]' : '[Fora]'}`;
      if (preselectedStudentId && preselectedStudentId === s.id) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  };

  if (allStudents && allStudents.length > 0) {
    fillSelect(allStudents);
  } else {
    try {
      allStudents = await Store.getAlumnes();
      fillSelect(allStudents);
      renderActiveStudentsBanner(allStudents);
      renderStudentsTable(allStudents);
    } catch (e) {
      console.warn('Error omplint select:', e);
    }
  }

  // Reset hora a ara mateix
  if (customTimeInput) {
    const nowLocal = new Date();
    nowLocal.setMinutes(nowLocal.getMinutes() - nowLocal.getTimezoneOffset());
    customTimeInput.value = nowLocal.toISOString().slice(0, 16);
    customTimeInput.style.display = 'none';
  }

  const radioNow = document.querySelector('input[name="admin_manual_time_opt"][value="now"]');
  if (radioNow) radioNow.checked = true;
}

if (typeof window !== 'undefined') {
  window.openAdminManualCheckinModal = openAdminManualCheckinModal;
}

// Modal Nou Alumne (Funció global i des de la capçalera)
function openNewStudentModal() {
  const title = document.getElementById('modal-alumne-title');
  if (title) title.textContent = "Donar d'Alta Nou Alumne";
  const form = document.getElementById('form-alumne');
  if (form) form.reset();
  const idEl = document.getElementById('alumne-form-id');
  if (idEl) idEl.value = '';
  const edatEl = document.getElementById('alumne-form-edat');
  if (edatEl) edatEl.value = '';
  const dataNaix = document.getElementById('alumne-form-data-naixement');
  if (dataNaix) dataNaix.value = '';
  const agePrev = document.getElementById('alumne-form-age-preview');
  if (agePrev) agePrev.textContent = '';
  const modal = document.getElementById('modal-alumne-backdrop');
  if (modal) modal.classList.add('active');
}
if (typeof window !== 'undefined') {
  window.openNewStudentModal = openNewStudentModal;
}

// SETUP D'ESDEVENIMENTS
function setupEventListeners() {
  initBrandStudio();
  initReservesAdmin();
  initCardDesigner();

  // Navegació de la barra lateral (Estil WordPress)
  document.querySelectorAll('.sidebar-item[data-tab]').forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      document.querySelectorAll('.admin-tab-view').forEach(view => view.classList.remove('active'));
      const targetView = document.getElementById(`view-${tab}`);
      if (targetView) targetView.classList.add('active');

      const heading = document.getElementById('admin-view-heading');
      if (heading) {
        if (tab === 'reserves') heading.textContent = 'Gestió de Reserves';
        else if (tab === 'alumnes') heading.textContent = 'Alumnes & Clients';
        else if (tab === 'directe') heading.textContent = 'Al taller ara mateix';
        else if (tab === 'carnet-designer') heading.textContent = 'Dissenyador de Carnets';
      }

      if (tab === 'reserves') {
        refreshAppointmentsDashboard();
      } else if (tab === 'alumnes') {
        refreshStudentsList();
      } else if (tab === 'carnet-designer') {
        populateDesignerStudentSelect();
        updateCardDesignPreview();
      }
    });
  });

  // Plegar / desplegar barra lateral (escriptori)
  document.getElementById('btn-collapse-sidebar')?.addEventListener('click', () => {
    document.getElementById('admin-sidebar')?.classList.toggle('collapsed');
  });

  // Plegar / desplegar menú en versió mòbil (hamburguesa)
  document.getElementById('btn-sidebar-hamburger')?.addEventListener('click', () => {
    document.getElementById('admin-sidebar')?.classList.toggle('collapsed');
  });

  // Tancar menú en mòbil quan es clica un element del menú
  document.querySelectorAll('.admin-sidebar .sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        document.getElementById('admin-sidebar')?.classList.add('collapsed');
      }
    });
  });

  // En mòbil arrenca per defecte plegat en hamburguesa
  if (window.innerWidth <= 768) {
    document.getElementById('admin-sidebar')?.classList.add('collapsed');
  }

  // Botons modals des de la barra lateral
  document.getElementById('btn-sidebar-branding')?.addEventListener('click', () => {
    if (typeof openBrandStudioModal === 'function') openBrandStudioModal();
    else document.getElementById('modal-branding-backdrop')?.classList.add('active');
  });
  document.getElementById('btn-sidebar-config')?.addEventListener('click', () => {
    openConfigModal();
  });
  document.getElementById('btn-sidebar-export')?.addEventListener('click', () => {
    document.getElementById('modal-backup-backdrop')?.classList.add('active');
  });

  // Cerca d'alumnes en temps real
  document.getElementById('search-students-input').addEventListener('input', () => {
    renderStudentsTable(allStudents);
  });

  // Tancar Drawer
  document.getElementById('btn-close-drawer').addEventListener('click', () => {
    document.getElementById('student-drawer-backdrop').classList.remove('active');
    currentViewingStudent = null;
  });

  // Delegació d'esdeveniments per a botons de taula i banner
  document.addEventListener('click', async (e) => {
    const target = e.target.closest('button');
    if (!target) return;

    // Tancar modals
    if (target.dataset.close) {
      document.getElementById(target.dataset.close).classList.remove('active');
      return;
    }

    // Veure fitxa 360°
    if (target.classList.contains('btn-action-view')) {
      const studentId = target.dataset.id;
      openStudentDrawer(studentId);
    }

    // Veure Carnet
    if (target.classList.contains('btn-action-carnet')) {
      const studentId = target.dataset.id;
      showStudentBadgeModal(studentId);
    }

    // Sortida ràpida des del banner
    if (target.classList.contains('btn-action-checkout')) {
      const studentId = target.dataset.id;
      try {
        const res = await Store.checkInOrOut(studentId);
        SoundEngine.playCheckout();
        showToast(res.message, 'success');
        await refreshStudentsList();
        if (currentViewingStudent && currentViewingStudent.alumne.id === studentId) {
          openStudentDrawer(studentId);
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    }

    // Entrada/Sortida ràpida des de la taula
    if (target.classList.contains('btn-action-toggle-sessio')) {
      const studentId = target.dataset.id;
      const action = target.dataset.action || 'auto';
      try {
        const res = await Store.checkInOrOut(studentId, { action, tipus: 'manual' });
        if (res.action === 'entrada') SoundEngine.playCheckin();
        else SoundEngine.playCheckout();
        showToast(res.message, 'success');
        await refreshStudentsList();
        if (currentViewingStudent && currentViewingStudent.alumne.id === studentId) {
          openStudentDrawer(studentId);
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    }

    // Obrir modal de temps manual per a aquest alumne concret
    if (target.classList.contains('btn-action-open-manual-time')) {
      const studentId = target.dataset.id;
      const action = target.dataset.action;
      openAdminManualCheckinModal(studentId, action);
    }

    // Obrir modal "Tancar cicle oblidat"
    if (target.classList.contains('btn-action-force-close')) {
      const studentId = target.dataset.id;
      const sessId = target.dataset.sessId;
      const nom = target.dataset.nom;
      const entrada = target.dataset.entrada;

      document.getElementById('tancar-cicle-student-id').value = studentId;
      document.getElementById('tancar-cicle-session-id').value = sessId;
      document.getElementById('tancar-cicle-student-name').textContent = nom;
      document.getElementById('tancar-cicle-hora-entrada').textContent = entrada;
      document.getElementById('modal-tancar-cicle-backdrop').classList.add('active');
    }

    // Cancel·lar reserva des de la fitxa inline d'alumne
    if (target.classList.contains('btn-inline-cancel-reserva')) {
      const resId = target.dataset.id;
      if (confirm('Segur que vols cancel·lar aquesta reserva i alliberar la plaça?')) {
        try {
          const res = await Store.cancelarReserva(resId);
          if (res.ok) {
            showToast('Reserva cancel·lada correctament.', 'info');
            if (currentViewingStudent && currentViewingStudent.alumne) {
              openStudentInlineDetail(currentViewingStudent.alumne.id);
            }
          } else {
            showToast(res.error || 'No s\'ha pogut cancel·lar la reserva', 'error');
          }
        } catch (err) {
          showToast('Error cancel·lant reserva: ' + err.message, 'error');
        }
      }
    }

    // Modificar sessió des de la fitxa de l'alumne
    if (target.classList.contains('btn-edit-sessio')) {
      const sessId = target.dataset.id;
      if (!currentViewingStudent || !currentViewingStudent.sessions) return;
      const sess = currentViewingStudent.sessions.find(s => s.id === sessId);
      if (!sess) return;
      const a = currentViewingStudent.alumne;

      const titleEl = document.getElementById('modal-manual-title');
      if (titleEl) titleEl.textContent = 'Modificar Sessió d\'Assistència';

      document.getElementById('manual-sessio-id').value = sess.id;
      document.getElementById('manual-sessio-student-id').value = a.id;
      document.getElementById('manual-sessio-student-name').value = `${a.nom} ${a.cognoms || ''} (${a.id})`;

      const entradaDt = sess.entrada ? new Date(sess.entrada) : new Date();
      const sortidaDt = sess.sortida ? new Date(sess.sortida) : new Date();
      document.getElementById('manual-sessio-entrada').value = TimeUtils.toLocalDatetimeInput(entradaDt);
      document.getElementById('manual-sessio-sortida').value = TimeUtils.toLocalDatetimeInput(sortidaDt);
      document.getElementById('manual-sessio-notes').value = sess.notes || '';

      const sec = Math.max(0, Math.floor((sortidaDt - entradaDt) / 1000));
      document.getElementById('manual-sessio-preview').textContent = TimeUtils.secondsToHms(sec);
      document.getElementById('modal-manual-sessio-backdrop').classList.add('active');
    }

    // Eliminar sessió des del drawer o fitxa
    if (target.classList.contains('btn-delete-sessio')) {
      if (confirm('Segur que vols eliminar aquesta sessió?')) {
        const sessId = target.dataset.id;
        await Store.deleteSession(sessId);
        showToast('Sessió eliminada correctament', 'info');
        await refreshStudentsList();
        if (currentViewingStudent && currentViewingStudent.alumne) openStudentInlineDetail(currentViewingStudent.alumne.id);
      }
    }

    // Eliminar paquet des del drawer o fitxa
    if (target.classList.contains('btn-delete-paquet')) {
      if (confirm('Segur que vols eliminar aquesta compra de paquet?')) {
        const packId = target.dataset.id;
        await Store.deletePackage(packId);
        showToast('Paquet eliminat correctament', 'info');
        await refreshStudentsList();
        if (currentViewingStudent && currentViewingStudent.alumne) openStudentInlineDetail(currentViewingStudent.alumne.id);
      }
    }
  });

  // Botons de la Fitxa Inline d'Alumne (A la mateixa pàgina)
  document.getElementById('btn-back-to-alumnes-list')?.addEventListener('click', () => {
    closeStudentInlineDetail();
  });

  document.getElementById('inline-btn-nova-reserva')?.addEventListener('click', () => {
    if (currentViewingStudent && currentViewingStudent.alumne) {
      openAdminNovaReservaModal(null, currentViewingStudent.alumne.id);
    }
  });

  document.getElementById('inline-btn-add-hours')?.addEventListener('click', () => {
    if (!currentViewingStudent || !currentViewingStudent.alumne) return;
    const a = currentViewingStudent.alumne;
    document.getElementById('paquet-form-student-id').value = a.id;
    document.getElementById('paquet-form-student-name').value = `${a.nom} ${a.cognoms || ''} (${a.id})`;
    document.getElementById('paquet-form-hores').value = 4;
    document.getElementById('paquet-form-concepte').value = '4 Hores';
    document.getElementById('paquet-form-preu').value = 50;
    document.getElementById('paquet-form-data').value = TimeUtils.toLocalDatetimeInput();
    document.getElementById('modal-paquet-backdrop').classList.add('active');
  });

  document.getElementById('inline-btn-checkin')?.addEventListener('click', () => {
    if (currentViewingStudent && currentViewingStudent.alumne) {
      openAdminManualCheckinModal(currentViewingStudent.alumne.id, 'entrada');
    }
  });

  document.getElementById('inline-btn-checkout')?.addEventListener('click', () => {
    if (currentViewingStudent && currentViewingStudent.alumne) {
      openAdminManualCheckinModal(currentViewingStudent.alumne.id, 'sortida');
    }
  });

  document.getElementById('inline-btn-manual-session')?.addEventListener('click', () => {
    if (!currentViewingStudent || !currentViewingStudent.alumne) return;
    const a = currentViewingStudent.alumne;
    const titleEl = document.getElementById('modal-manual-title');
    if (titleEl) titleEl.textContent = 'Registrar Sessió Manual';
    document.getElementById('manual-sessio-id').value = '';
    document.getElementById('manual-sessio-student-id').value = a.id;
    document.getElementById('manual-sessio-student-name').value = `${a.nom} ${a.cognoms || ''} (${a.id})`;

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    document.getElementById('manual-sessio-entrada').value = TimeUtils.toLocalDatetimeInput(oneHourAgo);
    document.getElementById('manual-sessio-sortida').value = TimeUtils.toLocalDatetimeInput(now);
    document.getElementById('manual-sessio-notes').value = '';
    document.getElementById('manual-sessio-preview').textContent = '01:00:00';
    document.getElementById('modal-manual-sessio-backdrop').classList.add('active');
  });

  document.getElementById('inline-btn-carnet')?.addEventListener('click', () => {
    if (currentViewingStudent && currentViewingStudent.alumne) {
      showStudentBadgeModal(currentViewingStudent.alumne.id);
    }
  });

  document.getElementById('inline-btn-edit-student')?.addEventListener('click', () => {
    if (!currentViewingStudent || !currentViewingStudent.alumne) return;
    const a = currentViewingStudent.alumne;
    document.getElementById('modal-alumne-title').textContent = 'Editar Alumne';
    document.getElementById('alumne-form-id').value = a.id;
    document.getElementById('alumne-form-nom').value = a.nom;
    document.getElementById('alumne-form-cognoms').value = a.cognoms || '';
    document.getElementById('alumne-form-telefon').value = a.telefon || '';
    document.getElementById('alumne-form-email').value = a.email || '';
    document.getElementById('alumne-form-pin').value = a.pin || '';
    document.getElementById('alumne-form-notes').value = a.notes || '';
    const birthVal = a.data_naixement ? a.data_naixement.split('T')[0] : '';
    const birthInput = document.getElementById('alumne-form-data-naixement');
    const edatInput = document.getElementById('alumne-form-edat');
    const agePrev = document.getElementById('alumne-form-age-preview');
    if (birthInput) birthInput.value = birthVal;
    if (edatInput) edatInput.value = (a.edat !== null && a.edat !== undefined) ? a.edat : '';
    if (agePrev) {
      const curAge = (a.edat !== null && a.edat !== undefined) ? a.edat : (birthVal && typeof TimeUtils !== 'undefined' && typeof TimeUtils.calculateAge === 'function' ? TimeUtils.calculateAge(birthVal) : null);
      agePrev.textContent = curAge !== null ? `Edat calculada: ${curAge} anys (${curAge >= 12 ? 'Tarifa Adults' : 'Tarifa Infantil'})` : '';
    }
    document.getElementById('modal-alumne-backdrop').classList.add('active');
  });

  // Pestanyes d'Historial Inline
  document.querySelectorAll('.inline-history-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.inline-history-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const targetTab = btn.dataset.historyTab;
      document.querySelectorAll('.inline-history-pane').forEach(p => p.style.display = 'none');
      const targetEl = document.getElementById(targetTab);
      if (targetEl) targetEl.style.display = 'block';
    });
  });

  // Botons ràpids del Drawer (Compatibilitat)
  document.getElementById('drawer-btn-carnet')?.addEventListener('click', () => {
    if (currentViewingStudent && currentViewingStudent.alumne) showStudentBadgeModal(currentViewingStudent.alumne.id);
  });

  const btnCheckin = document.getElementById('drawer-btn-checkin');
  if (btnCheckin) {
    btnCheckin.addEventListener('click', () => {
      if (currentViewingStudent && currentViewingStudent.alumne) openAdminManualCheckinModal(currentViewingStudent.alumne.id, 'entrada');
    });
  }

  const btnCheckout = document.getElementById('drawer-btn-checkout');
  if (btnCheckout) {
    btnCheckout.addEventListener('click', () => {
      if (currentViewingStudent && currentViewingStudent.alumne) openAdminManualCheckinModal(currentViewingStudent.alumne.id, 'sortida');
    });
  }

  document.getElementById('drawer-btn-add-hours')?.addEventListener('click', () => {
    if (!currentViewingStudent || !currentViewingStudent.alumne) return;
    const a = currentViewingStudent.alumne;
    document.getElementById('paquet-form-student-id').value = a.id;
    document.getElementById('paquet-form-student-name').value = `${a.nom} ${a.cognoms || ''} (${a.id})`;
    document.getElementById('paquet-form-hores').value = 4;
    document.getElementById('paquet-form-concepte').value = '4 Hores';
    document.getElementById('paquet-form-preu').value = 50;
    document.getElementById('paquet-form-data').value = TimeUtils.toLocalDatetimeInput();
    document.getElementById('modal-paquet-backdrop').classList.add('active');
  });

  document.getElementById('drawer-btn-add-manual-session')?.addEventListener('click', () => {
    if (!currentViewingStudent || !currentViewingStudent.alumne) return;
    const a = currentViewingStudent.alumne;
    const titleEl = document.getElementById('modal-manual-title');
    if (titleEl) titleEl.textContent = 'Registrar Sessió Manual';
    document.getElementById('manual-sessio-id').value = '';
    document.getElementById('manual-sessio-student-id').value = a.id;
    document.getElementById('manual-sessio-student-name').value = `${a.nom} ${a.cognoms || ''} (${a.id})`;

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    document.getElementById('manual-sessio-entrada').value = TimeUtils.toLocalDatetimeInput(oneHourAgo);
    document.getElementById('manual-sessio-sortida').value = TimeUtils.toLocalDatetimeInput(now);
    document.getElementById('manual-sessio-notes').value = '';
    document.getElementById('manual-sessio-preview').textContent = '01:00:00';
    document.getElementById('modal-manual-sessio-backdrop').classList.add('active');
  });

  document.getElementById('drawer-btn-edit-student')?.addEventListener('click', () => {
    if (!currentViewingStudent || !currentViewingStudent.alumne) return;
    const a = currentViewingStudent.alumne;
    document.getElementById('modal-alumne-title').textContent = 'Editar Alumne';
    document.getElementById('alumne-form-id').value = a.id;
    document.getElementById('alumne-form-nom').value = a.nom;
    document.getElementById('alumne-form-cognoms').value = a.cognoms || '';
    document.getElementById('alumne-form-telefon').value = a.telefon || '';
    document.getElementById('alumne-form-email').value = a.email || '';
    document.getElementById('alumne-form-pin').value = a.pin || '';
    document.getElementById('alumne-form-notes').value = a.notes || '';
    const birthVal = a.data_naixement ? a.data_naixement.split('T')[0] : '';
    const birthInput = document.getElementById('alumne-form-data-naixement');
    const edatInput = document.getElementById('alumne-form-edat');
    const agePrev = document.getElementById('alumne-form-age-preview');
    if (birthInput) birthInput.value = birthVal;
    if (edatInput) edatInput.value = (a.edat !== null && a.edat !== undefined) ? a.edat : '';
    if (agePrev) {
      const curAge = (a.edat !== null && a.edat !== undefined) ? a.edat : (birthVal && typeof TimeUtils !== 'undefined' && typeof TimeUtils.calculateAge === 'function' ? TimeUtils.calculateAge(birthVal) : null);
      agePrev.textContent = curAge !== null ? `Edat calculada: ${curAge} anys (${curAge >= 12 ? 'Tarifa Adults' : 'Tarifa Infantil'})` : '';
    }
    document.getElementById('modal-alumne-backdrop').classList.add('active');
  });

  // Pestanyes del Drawer (Compatibilitat)
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn[data-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const targetTab = btn.dataset.tab;
      document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
      const pane = document.getElementById(targetTab);
      if (pane) pane.style.display = 'block';
    });
  });

  // Modal Nou Alumne (Des de dalt)
  document.getElementById('btn-nou-alumne')?.addEventListener('click', () => {
    openNewStudentModal();
  });

  // Modal Entrada / Sortida Manual (Admin)
  const btnAdminManual = document.getElementById('btn-admin-manual-checkin');
  if (btnAdminManual) {
    btnAdminManual.addEventListener('click', () => {
      openAdminManualCheckinModal();
    });
  }

  // Alternar hora manual al formulari admin
  document.querySelectorAll('input[name="admin_manual_time_opt"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const customInput = document.getElementById('admin-manual-custom-time');
      if (e.target.value === 'custom') {
        customInput.style.display = 'block';
      } else {
        customInput.style.display = 'none';
      }
    });
  });

  // Botons d'acció manual a l'admin (Entrada o Sortida)
  document.querySelectorAll('.btn-admin-action').forEach(btn => {
    btn.addEventListener('click', async () => {
      const select = document.getElementById('admin-manual-student-select');
      const studentId = select.value;
      if (!studentId) {
        alert('Si us plau, selecciona un alumne.');
        return;
      }

      const action = btn.dataset.action; // 'entrada' o 'sortida'
      const timeOpt = document.querySelector('input[name="admin_manual_time_opt"]:checked')?.value || 'now';
      let customTime = null;
      if (timeOpt === 'custom') {
        const customInput = document.getElementById('admin-manual-custom-time');
        if (customInput.value) {
          customTime = new Date(customInput.value).toISOString();
        }
      }

      try {
        const res = await Store.checkInOrOut(studentId, { action, customTime, tipus: 'manual' });
        if (res.action === 'entrada') SoundEngine.playCheckin();
        else SoundEngine.playCheckout();
        showToast(res.message, 'success');
        document.getElementById('modal-admin-manual-backdrop').classList.remove('active');
        await refreshStudentsList();
        if (currentViewingStudent && currentViewingStudent.alumne.id === studentId) {
          openStudentDrawer(studentId);
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  // Listener per calcular edat en temps real quan es selecciona la data de naixement
  const birthChangeInput = document.getElementById('alumne-form-data-naixement');
  if (birthChangeInput) {
    birthChangeInput.addEventListener('input', () => {
      const val = birthChangeInput.value;
      const age = (val && typeof TimeUtils !== 'undefined' && typeof TimeUtils.calculateAge === 'function') ? TimeUtils.calculateAge(val) : null;
      const prev = document.getElementById('alumne-form-age-preview');
      const hidden = document.getElementById('alumne-form-edat');
      if (age !== null) {
        if (hidden) hidden.value = age;
        if (prev) prev.textContent = `Edat calculada: ${age} anys (${age >= 12 ? 'Tarifa Adults' : 'Tarifa Infantil'})`;
      } else {
        if (hidden) hidden.value = '';
        if (prev) prev.textContent = '';
      }
    });
  }

  // Formulari Alumne Submit
  document.getElementById('form-alumne').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dataNaixement = document.getElementById('alumne-form-data-naixement') ? document.getElementById('alumne-form-data-naixement').value : '';
    let calculatedAge = null;
    if (dataNaixement && typeof TimeUtils !== 'undefined' && typeof TimeUtils.calculateAge === 'function') {
      calculatedAge = TimeUtils.calculateAge(dataNaixement);
    }
    const hiddenEdat = document.getElementById('alumne-form-edat') ? document.getElementById('alumne-form-edat').value : '';
    const finalEdat = calculatedAge !== null ? calculatedAge : (hiddenEdat ? parseInt(hiddenEdat, 10) : null);

    const data = {
      id: document.getElementById('alumne-form-id').value,
      nom: document.getElementById('alumne-form-nom').value,
      cognoms: document.getElementById('alumne-form-cognoms').value,
      telefon: document.getElementById('alumne-form-telefon').value,
      email: document.getElementById('alumne-form-email').value,
      pin: document.getElementById('alumne-form-pin').value,
      notes: document.getElementById('alumne-form-notes').value,
      data_naixement: dataNaixement || null,
      edat: finalEdat
    };
    try {
      const res = await Store.saveAlumne(data);
      showToast(res.message || 'Alumne desat!', 'success');
      document.getElementById('modal-alumne-backdrop').classList.remove('active');
      await refreshStudentsList();
      if (currentViewingStudent && currentViewingStudent.alumne.id === res.id) {
        openStudentDrawer(res.id);
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Formulari Paquet Submit
  document.getElementById('form-paquet').addEventListener('submit', async (e) => {
    e.preventDefault();
    const studentId = document.getElementById('paquet-form-student-id').value;
    const hores = parseFloat(document.getElementById('paquet-form-hores').value);
    const concepte = document.getElementById('paquet-form-concepte').value;
    const preu = parseFloat(document.getElementById('paquet-form-preu').value) || 0;
    const metode = document.getElementById('paquet-form-metode').value;
    const data = document.getElementById('paquet-form-data').value ? new Date(document.getElementById('paquet-form-data').value).toISOString() : new Date().toISOString();

    try {
      const res = await Store.addPackage({ studentId, hores, concepte, preu, metodePagament: metode, data });
      showToast(res.message, 'success');
      document.getElementById('modal-paquet-backdrop').classList.remove('active');
      await refreshStudentsList();
      if (currentViewingStudent) openStudentDrawer(studentId);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Formulari Sessió Manual Submit
  const manualEntrada = document.getElementById('manual-sessio-entrada');
  const manualSortida = document.getElementById('manual-sessio-sortida');
  const updateManualPreview = () => {
    if (manualEntrada.value && manualSortida.value) {
      const sec = TimeUtils.calculateDuration(manualEntrada.value, manualSortida.value);
      document.getElementById('manual-sessio-preview').textContent = TimeUtils.secondsToHms(sec);
    }
  };
  manualEntrada.addEventListener('change', updateManualPreview);
  manualSortida.addEventListener('change', updateManualPreview);

  document.getElementById('form-manual-sessio').addEventListener('submit', async (e) => {
    e.preventDefault();
    const studentId = document.getElementById('manual-sessio-student-id').value;
    const sessId = document.getElementById('manual-sessio-id').value;
    const entrada = new Date(manualEntrada.value).toISOString();
    const sortida = new Date(manualSortida.value).toISOString();
    const data_sess = entrada.slice(0, 10);
    const notes = document.getElementById('manual-sessio-notes').value;

    try {
      const res = await Store.saveManualSession({ id: sessId, studentId, data: data_sess, entrada, sortida, notes });
      showToast(res.message, 'success');
      document.getElementById('modal-manual-sessio-backdrop').classList.remove('active');
      await refreshStudentsList();
      if (currentViewingStudent && currentViewingStudent.alumne) {
        openStudentInlineDetail(studentId);
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Formulari Tancar Cicle Oblidat Submit
  document.getElementById('form-tancar-cicle').addEventListener('submit', async (e) => {
    e.preventDefault();
    const studentId = document.getElementById('tancar-cicle-student-id').value;
    const sessionId = document.getElementById('tancar-cicle-session-id').value;
    const opcio = document.querySelector('input[name="opcio_tancament"]:checked').value;
    const notes = document.getElementById('tancar-cicle-notes').value;

    let duradaManual = null;
    let sortidaManual = null;

    if (opcio === 'durada_manual') {
      duradaManual = document.getElementById('tancar-cicle-durada-custom').value || '01:30:00';
    } else if (opcio === 'hora_exacta') {
      const horaInput = document.getElementById('tancar-cicle-hora-sortida').value;
      if (horaInput) sortidaManual = new Date(horaInput).toISOString();
    }

    try {
      const res = await Store.forceCloseSession({ sessionId, studentId, duradaManual, sortidaManual, notes });
      showToast(res.message, 'success');
      document.getElementById('modal-tancar-cicle-backdrop').classList.remove('active');
      await refreshStudentsList();
      if (currentViewingStudent) openStudentDrawer(studentId);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Modal Configuració
  async function openConfigModal() {
    const cfg = await Store.getConfig();
    document.getElementById('cfg-taller-nom').value = cfg.taller_nom || '';
    document.getElementById('cfg-taller-telefon').value = cfg.taller_telefon || '';
    document.getElementById('cfg-durada-oblit').value = cfg.hores_per_defecte_oblit || '01:30:00';
    if (document.getElementById('cfg-edat-tall')) {
      document.getElementById('cfg-edat-tall').value = cfg.edat_tall_infantil || '12';
    }
    if (document.getElementById('cfg-stripe-adults')) {
      document.getElementById('cfg-stripe-adults').value = cfg.stripe_url_adults || '';
    }
    if (document.getElementById('cfg-stripe-infantil')) {
      document.getElementById('cfg-stripe-infantil').value = cfg.stripe_url_infantil || '';
    }
    document.getElementById('cfg-sheets-url').value = cfg.google_sheets_url || '';
    if (document.getElementById('cfg-calendar-name')) {
      const calName = (cfg.google_calendar_name && cfg.google_calendar_name !== 'Roig de Coure' && cfg.google_calendar_name !== 'roigdecoure') ? cfg.google_calendar_name : 'reserves';
      document.getElementById('cfg-calendar-name').value = calName;
    }
    if (document.getElementById('cfg-whatsapp-enabled')) {
      document.getElementById('cfg-whatsapp-enabled').checked = (cfg.whatsapp_enabled === '1' || cfg.whatsapp_enabled === 'true' || cfg.whatsapp_enabled === true);
    }
    if (document.getElementById('cfg-whatsapp-phone-id')) {
      document.getElementById('cfg-whatsapp-phone-id').value = cfg.whatsapp_meta_phone_id || '';
    }
    if (document.getElementById('cfg-whatsapp-token')) {
      document.getElementById('cfg-whatsapp-token').value = cfg.whatsapp_meta_token || '';
    }
    if (document.getElementById('cfg-whatsapp-tpl-confirm')) {
      document.getElementById('cfg-whatsapp-tpl-confirm').value = cfg.whatsapp_meta_template_confirmacio || 'reserva_confirmada';
    }
    if (document.getElementById('cfg-whatsapp-tpl-48h')) {
      document.getElementById('cfg-whatsapp-tpl-48h').value = cfg.whatsapp_meta_template_48h || 'recordatori_48h';
    }
    if (document.getElementById('cfg-whatsapp-tpl-dia')) {
      document.getElementById('cfg-whatsapp-tpl-dia').value = cfg.whatsapp_meta_template_dia || 'recordatori_dia';
    }
    document.getElementById('modal-config-backdrop').classList.add('active');
  }

  document.getElementById('btn-configuracio')?.addEventListener('click', openConfigModal);
  document.getElementById('btn-sidebar-config')?.addEventListener('click', openConfigModal);

  document.getElementById('form-config').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newCfg = {
      taller_nom: document.getElementById('cfg-taller-nom').value,
      taller_telefon: document.getElementById('cfg-taller-telefon').value,
      hores_per_defecte_oblit: document.getElementById('cfg-durada-oblit').value,
      edat_tall_infantil: document.getElementById('cfg-edat-tall') ? document.getElementById('cfg-edat-tall').value : '12',
      stripe_url_adults: document.getElementById('cfg-stripe-adults') ? document.getElementById('cfg-stripe-adults').value : '',
      stripe_url_infantil: document.getElementById('cfg-stripe-infantil') ? document.getElementById('cfg-stripe-infantil').value : '',
      google_sheets_url: document.getElementById('cfg-sheets-url').value,
      google_calendar_name: document.getElementById('cfg-calendar-name') ? document.getElementById('cfg-calendar-name').value.trim() : 'reserves',
      whatsapp_enabled: document.getElementById('cfg-whatsapp-enabled')?.checked ? '1' : '0',
      whatsapp_meta_phone_id: document.getElementById('cfg-whatsapp-phone-id')?.value.trim() || '',
      whatsapp_meta_token: document.getElementById('cfg-whatsapp-token')?.value.trim() || '',
      whatsapp_meta_template_confirmacio: document.getElementById('cfg-whatsapp-tpl-confirm')?.value.trim() || 'reserva_confirmada',
      whatsapp_meta_template_48h: document.getElementById('cfg-whatsapp-tpl-48h')?.value.trim() || 'recordatori_48h',
      whatsapp_meta_template_dia: document.getElementById('cfg-whatsapp-tpl-dia')?.value.trim() || 'recordatori_dia'
    };
    try {
      await Store.saveConfig(newCfg);
      showToast('Configuració desada correctament', 'success');
      document.getElementById('modal-config-backdrop').classList.remove('active');
      await loadConfig();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Prova d'enviament de WhatsApp des del modal de configuració
  document.getElementById('btn-cfg-test-whatsapp')?.addEventListener('click', async () => {
    const telInput = document.getElementById('cfg-whatsapp-test-tel');
    const statusDiv = document.getElementById('cfg-whatsapp-test-status');
    const tplInput = document.getElementById('cfg-whatsapp-tpl-confirm');
    const tel = (telInput ? telInput.value : '').trim();
    if (!tel) {
      showToast('Introdueix un telèfon amb prefix (ex: +34 600 000 000)', 'warning');
      return;
    }
    const tpl = (tplInput ? tplInput.value : '').trim() || 'reserva_confirmada';
    if (statusDiv) {
      statusDiv.style.display = 'block';
      statusDiv.style.color = '#5E7E6F';
      statusDiv.textContent = 'Enviant missatge de prova a Meta Graph API...';
    }
    try {
      const res = await Store.testWhatsAppMeta(tel, tpl);
      if (res.ok) {
        if (statusDiv) {
          statusDiv.style.color = '#5E7E6F';
          statusDiv.textContent = 'Missatge enviat correctament! Revisa el teu WhatsApp.';
        }
        showToast('WhatsApp de prova enviat amb èxit!', 'success');
      } else {
        if (statusDiv) {
          statusDiv.style.color = '#831D1D';
          statusDiv.textContent = 'Error: ' + (res.error || 'No s\'ha pogut enviar');
        }
        showToast('Error: ' + (res.error || 'No s\'ha pogut enviar'), 'error');
      }
    } catch (e) {
      if (statusDiv) {
        statusDiv.style.color = '#831D1D';
        statusDiv.textContent = 'Error: ' + e.message;
      }
      showToast(e.message, 'error');
    }
  });

  // Botó Sincronitzar amb Google Sheets
  document.getElementById('btn-sync-sheets').addEventListener('click', async () => {
    try {
      showToast('Sincronitzant dades amb Google Sheets...', 'info');
      const res = await Store.syncToGoogleSheets();
      showToast(res.message, 'success');
    } catch (err) {
      showToast(err.message, 'error');
      // Si no hi ha URL configurat, obrim configuració
      if (err.message.includes('No hi ha cap URL')) {
        document.getElementById('btn-configuracio').click();
      }
    }
  });

  // Botons d'hidratació (llegir i bolcar del full)
  const handleHydrateAction = async () => {
    try {
      showToast('Connectant amb Google Sheets i descarregant dades...', 'info');
      const res = await Store.hydrateFromGoogleSheets();
      showToast(res.message || 'Hidratació completada amb èxit!', 'success');
      await refreshStudentsList();
    } catch (err) {
      showToast('Error en la hidratació: ' + err.message, 'error');
      if (err.message.includes('URL') || err.message.includes('configurat')) {
        document.getElementById('btn-configuracio').click();
      }
    }
  };

  const btnHydrate = document.getElementById('btn-hydrate-sheets');
  if (btnHydrate) btnHydrate.addEventListener('click', handleHydrateAction);

  const btnCfgHydrate = document.getElementById('btn-cfg-hydrate-sheets');
  if (btnCfgHydrate) btnCfgHydrate.addEventListener('click', handleHydrateAction);

  const btnCfgPush = document.getElementById('btn-cfg-push-sheets');
  if (btnCfgPush) {
    btnCfgPush.addEventListener('click', async () => {
      try {
        showToast('Enviant dades locals cap a Google Sheets...', 'info');
        const res = await Store.syncToGoogleSheets();
        showToast(res.message || 'Dades enviades amb èxit!', 'success');
      } catch (err) {
        showToast('Error enviant dades: ' + err.message, 'error');
      }
    });
  }

  // Modal Backup & Export
  document.getElementById('btn-exportar')?.addEventListener('click', () => {
    document.getElementById('modal-backup-backdrop').classList.add('active');
    loadSnapshotsList();
  });
  document.getElementById('btn-sidebar-export')?.addEventListener('click', () => {
    document.getElementById('modal-backup-backdrop').classList.add('active');
    loadSnapshotsList();
  });

  // Botó per crear snapshot manual immediat
  document.getElementById('btn-create-snapshot')?.addEventListener('click', async () => {
    try {
      showToast('Creant snapshot de la base de dades...', 'info');
      const res = await fetch('/api/admin/backups', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        showToast(data.message || 'Snapshot creat correctament!', 'success');
        await loadSnapshotsList();
      } else {
        showToast(data.error || 'Error creant snapshot', 'error');
      }
    } catch (err) {
      showToast('Error de connexió: ' + err.message, 'error');
    }
  });

  // Refrescar llista de snapshots
  document.getElementById('btn-refresh-snapshots')?.addEventListener('click', loadSnapshotsList);

  // Canviar PIN d'Administració
  document.getElementById('btn-cfg-change-pin')?.addEventListener('click', async () => {
    const curInput = document.getElementById('cfg-pin-current');
    const newInput = document.getElementById('cfg-pin-new');
    const statusEl = document.getElementById('cfg-pin-status');
    const oldPin = curInput.value.trim();
    const newPin = newInput.value.trim();

    if (!oldPin || !newPin) {
      statusEl.textContent = 'Cal omplir el PIN actual i el nou PIN.';
      statusEl.style.color = '#D32F2F';
      statusEl.style.display = 'block';
      return;
    }

    try {
      const res = await fetch('/api/admin/change-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPin, newPin })
      });
      const data = await res.json();
      if (data.ok) {
        statusEl.textContent = data.message || 'PIN actualitzat correctament!';
        statusEl.style.color = '#2E7D32';
        statusEl.style.display = 'block';
        curInput.value = '';
        newInput.value = '';
        showToast('PIN d\'administrador actualitzat!', 'success');
      } else {
        statusEl.textContent = data.error || 'Error actualitzant el PIN.';
        statusEl.style.color = '#D32F2F';
        statusEl.style.display = 'block';
      }
    } catch (err) {
      statusEl.textContent = 'Error de connexió: ' + err.message;
      statusEl.style.color = '#D32F2F';
      statusEl.style.display = 'block';
    }
  });

  document.getElementById('btn-download-json')?.addEventListener('click', () => {
    Store.exportBackupJson();
    showToast('Còpia de seguretat descarregada!', 'success');
  });

  document.getElementById('input-restore-json')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (confirm('Segur que vols restaurar aquesta còpia? Es sobreescriuran les dades.')) {
      try {
        const res = await Store.importBackupJson(file);
        showToast(res.message, 'success');
        document.getElementById('modal-backup-backdrop').classList.remove('active');
        await refreshStudentsList();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  });

  // Exportar CSV per a Excel
  document.getElementById('btn-export-csv').addEventListener('click', async () => {
    try {
      const data = await Store._getLocalData();
      const sessions = data.sessions || [];
      const alumnes = data.alumnes || [];
      const mapAlumnes = {};
      alumnes.forEach(a => mapAlumnes[a.id] = `${a.nom} ${a.cognoms || ''}`);

      let csv = 'ID Sessio,ID Alumne,Nom Alumne,Data,Entrada,Sortida,Durada Hms,Segons,Tipus,Estat,Notes\n';
      sessions.forEach(s => {
        csv += `"${s.id}","${s.student_id}","${mapAlumnes[s.student_id] || ''}","${s.data}","${s.entrada}","${s.sortida || ''}","${s.format_hms}","${s.durada_segons}","${s.tipus}","${s.estat}","${s.notes || ''}"\n`;
      });

      const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `assistencia_ceramica_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Arxiu CSV descarregat per a Excel', 'success');
    } catch (err) {
      showToast('Error exportant CSV: ' + err.message, 'error');
    }
  });

  // Botons del Carnet
  document.getElementById('btn-print-card')?.addEventListener('click', () => {
    window.print();
  });

  document.getElementById('btn-copy-card-link')?.addEventListener('click', () => {
    const studentId = document.getElementById('badge-id')?.textContent || '';
    const url = `${window.location.origin}${window.location.pathname.replace('admin.html', 'alumne.html')}?id=${studentId}`;
    navigator.clipboard.writeText(url).then(() => {
      showToast('Enllaç directe de l\'alumne copiat al porta-retalls!', 'success');
    }).catch(() => {
      showToast('URL: ' + url, 'info');
    });
  });

  // Tancar qualsevol modal amb botons .modal-close o data-close
  document.querySelectorAll('.modal-close, [data-close]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetId = btn.getAttribute('data-close');
      if (targetId) {
        const m = document.getElementById(targetId);
        if (m) m.classList.remove('active');
      } else {
        const m = btn.closest('.modal-backdrop');
        if (m) m.classList.remove('active');
      }
    });
  });

  // Tancar fent clic al fons del modal (fora del contingut)
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        backdrop.classList.remove('active');
      }
    });
  });
}

/* ==================== ESTUDI DE DISSENY & MARCA ==================== */

let previewQrGenerated = false;

function initBrandStudio() {
  const btnBranding = document.getElementById('btn-branding') || document.getElementById('btn-sidebar-branding');
  const modalBranding = document.getElementById('modal-branding-backdrop');
  if (!modalBranding) return;

  btnBranding?.addEventListener('click', async () => {
    await openBrandStudioModal();
  });

  // Controls de colors
  const primaryColorInput = document.getElementById('brand-input-primary-color');
  const primaryHexInput = document.getElementById('brand-input-primary-hex');
  const secondaryColorInput = document.getElementById('brand-input-secondary-color');
  const secondaryHexInput = document.getElementById('brand-input-secondary-hex');

  if (primaryColorInput && primaryHexInput) {
    primaryColorInput.addEventListener('input', (e) => {
      primaryHexInput.value = e.target.value.toUpperCase();
      updateBrandPreview();
    });
    primaryHexInput.addEventListener('input', (e) => {
      let val = e.target.value.trim();
      if (!val.startsWith('#')) val = '#' + val;
      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
        primaryColorInput.value = val;
        updateBrandPreview();
      }
    });
  }

  if (secondaryColorInput && secondaryHexInput) {
    secondaryColorInput.addEventListener('input', (e) => {
      secondaryHexInput.value = e.target.value.toUpperCase();
      updateBrandPreview();
    });
    secondaryHexInput.addEventListener('input', (e) => {
      let val = e.target.value.trim();
      if (!val.startsWith('#')) val = '#' + val;
      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
        secondaryColorInput.value = val;
        updateBrandPreview();
      }
    });
  }

  // Paletes de Ceràmica ràpides
  document.querySelectorAll('.btn-palette').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.primary;
      const s = btn.dataset.secondary;
      if (p && s && primaryColorInput && secondaryColorInput) {
        primaryColorInput.value = p;
        primaryHexInput.value = p.toUpperCase();
        secondaryColorInput.value = s;
        secondaryHexInput.value = s.toUpperCase();
        updateBrandPreview();
      }
    });
  });

  // Nom i subtítol
  const nomInput = document.getElementById('brand-input-nom');
  const subInput = document.getElementById('brand-input-subtitol');
  if (nomInput) nomInput.addEventListener('input', updateBrandPreview);
  if (subInput) subInput.addEventListener('input', updateBrandPreview);

  // Tipografia
  document.querySelectorAll('input[name="brand_font_choice"]').forEach(radio => {
    radio.addEventListener('change', updateBrandPreview);
  });

  // Pujada de logotip oficial (Fitxer o URL)
  const logoFileInput = document.getElementById('brand-input-logo-file');
  const logoUrlInput = document.getElementById('brand-input-logo-url');
  const btnRemoveLogo = document.getElementById('btn-remove-logo');
  const logoStatusEl = document.getElementById('brand-logo-status');

  if (logoUrlInput) {
    logoUrlInput.addEventListener('input', () => {
      const url = logoUrlInput.value.trim();
      setLogoPreview(url);
      updateBrandPreview();
      if (logoStatusEl) logoStatusEl.textContent = url ? 'URL introduïda' : '';
    });
  }

  if (logoFileInput) {
    logoFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (file.size > 2 * 1024 * 1024) {
        alert('La imatge supera els 2MB. Si us plau, tria una imatge més lleugera (o redueix-ne la mida abans de pujar-la).');
        logoFileInput.value = '';
        return;
      }

      if (logoStatusEl) logoStatusEl.textContent = 'Llegint imatge...';

      const reader = new FileReader();
      reader.onload = (loadEvt) => {
        const base64 = loadEvt.target.result;
        if (logoUrlInput) logoUrlInput.value = base64;
        setLogoPreview(base64);
        updateBrandPreview();
        if (logoStatusEl) logoStatusEl.textContent = `Fitxer llest (${Math.round(file.size / 1024)} KB)`;
      };
      reader.onerror = () => {
        if (logoStatusEl) logoStatusEl.textContent = 'Error llegint el fitxer.';
      };
      reader.readAsDataURL(file);
    });
  }

  if (btnRemoveLogo) {
    btnRemoveLogo.addEventListener('click', () => {
      if (logoUrlInput) logoUrlInput.value = '';
      if (logoFileInput) logoFileInput.value = '';
      if (logoStatusEl) logoStatusEl.textContent = '';
      setLogoPreview('');
      updateBrandPreview();
    });
  }

  // Formulari Desar Disseny
  const formBrand = document.getElementById('form-branding');
  if (formBrand) {
    formBrand.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nom = nomInput ? nomInput.value.trim() : 'Roig de Coure';
      const sub = subInput ? subInput.value.trim() : '';
      const prim = primaryHexInput ? primaryHexInput.value.trim() : '#831D1D';
      const sec = secondaryHexInput ? secondaryHexInput.value.trim() : '#5E7E6F';
      const fontChoice = document.querySelector('input[name="brand_font_choice"]:checked')?.value || 'verdana';
      let logoUrl = logoUrlInput ? logoUrlInput.value.trim() : '';
      if (logoUrl.includes('PHN2Zz48L3N2Zz4=')) logoUrl = '';

      try {
        showToast('Desant i aplicant imatge corporativa...', 'info');
        await Store.saveConfig({
          taller_nom: nom,
          taller_subtitol: sub,
          taller_logo_url: logoUrl,
          brand_primary: prim,
          brand_secondary: sec,
          brand_font: fontChoice
        });

        // Actualitzar interfície de l'admin
        const wsNav = document.getElementById('nav-workshop-name');
        if (wsNav) wsNav.textContent = nom;
        const bWs = document.getElementById('badge-ws-name');
        if (bWs) bWs.textContent = nom;
        const sbLogo = document.getElementById('sidebar-logo-img');
        if (sbLogo) sbLogo.src = logoUrl || 'img/logo.png';

        // Actualitzar variables CSS globals a l'admin
        document.documentElement.style.setProperty('--brand-primary', prim);
        document.documentElement.style.setProperty('--color-primary', prim);
        document.documentElement.style.setProperty('--brand-secondary', sec);

        modalBranding.classList.remove('active');
        showToast('Imatge de marca actualitzada i sincronitzada amb èxit!', 'success');
      } catch (err) {
        showToast('Error desant el disseny: ' + err.message, 'error');
      }
    });
  }
}

async function openBrandStudioModal() {
  const modal = document.getElementById('modal-branding-backdrop');
  if (!modal) return;

  try {
    const cfg = await Store.getConfig();
    const nom = cfg.taller_nom || 'Roig de Coure';
    const sub = cfg.taller_subtitol || '';
    const prim = cfg.brand_primary || '#831D1D';
    const sec = cfg.brand_secondary || '#5E7E6F';
    const font = cfg.brand_font || 'verdana';
    let logoUrl = (cfg.taller_logo_url || '').trim();
    if (logoUrl.includes('PHN2Zz48L3N2Zz4=')) logoUrl = '';

    const nomInput = document.getElementById('brand-input-nom');
    if (nomInput) nomInput.value = nom;
    const subInput = document.getElementById('brand-input-subtitol');
    if (subInput) subInput.value = sub;

    const pCol = document.getElementById('brand-input-primary-color');
    const pHex = document.getElementById('brand-input-primary-hex');
    if (pCol) pCol.value = prim;
    if (pHex) pHex.value = prim.toUpperCase();

    const sCol = document.getElementById('brand-input-secondary-color');
    const sHex = document.getElementById('brand-input-secondary-hex');
    if (sCol) sCol.value = sec;
    if (sHex) sHex.value = sec.toUpperCase();

    const radioFont = document.querySelector(`input[name="brand_font_choice"][value="${font}"]`);
    if (radioFont) radioFont.checked = true;

    const logoInput = document.getElementById('brand-input-logo-url');
    if (logoInput) logoInput.value = logoUrl;
    const logoFile = document.getElementById('brand-input-logo-file');
    if (logoFile) logoFile.value = '';
    const statusEl = document.getElementById('brand-logo-status');
    if (statusEl) statusEl.textContent = logoUrl ? (logoUrl.startsWith('data:') ? 'Logotip desat' : 'Enllaç URL carregat') : '';

    setLogoPreview(logoUrl);

    // Generar QR de mostra al mockup si encara no s'ha fet
    const qrContainer = document.getElementById('preview-badge-qr');
    if (qrContainer && !previewQrGenerated && typeof QREngine !== 'undefined') {
      QREngine.generateQR(qrContainer, 'TC-101', 75);
      previewQrGenerated = true;
    }

    updateBrandPreview();
    modal.classList.add('active');
  } catch (err) {
    console.warn('Error obrint estudi de disseny:', err);
  }
}

function setLogoPreview(url) {
  const previewImg = document.getElementById('brand-logo-preview-img');
  const previewPlaceholder = document.getElementById('brand-logo-preview-placeholder');
  const btnRemove = document.getElementById('btn-remove-logo');

  if (url && url.trim() !== '' && !url.includes('PHN2Zz48L3N2Zz4=')) {
    if (previewImg) {
      previewImg.onerror = () => {
        previewImg.style.display = 'none';
        if (previewPlaceholder) previewPlaceholder.style.display = 'block';
      };
      previewImg.onload = () => {
        previewImg.style.display = 'block';
        if (previewPlaceholder) previewPlaceholder.style.display = 'none';
      };
      previewImg.src = url;
    }
    if (btnRemove) btnRemove.style.display = 'inline-block';
  } else {
    if (previewImg) { previewImg.src = ''; previewImg.style.display = 'none'; }
    if (previewPlaceholder) previewPlaceholder.style.display = 'block';
    if (btnRemove) btnRemove.style.display = 'none';
  }
}

function updateBrandPreview() {
  const nom = document.getElementById('brand-input-nom')?.value.trim() || 'Roig de Coure';
  const sub = document.getElementById('brand-input-subtitol')?.value.trim() || '';
  const prim = document.getElementById('brand-input-primary-hex')?.value.trim() || '#831D1D';
  const sec = document.getElementById('brand-input-secondary-hex')?.value.trim() || '#5E7E6F';
  const fontChoice = document.querySelector('input[name="brand_font_choice"]:checked')?.value || 'sans';
  const logoUrl = (document.getElementById('brand-input-logo-url')?.value || '').trim();

  // Textos
  const prevHdrTitle = document.getElementById('preview-header-title');
  if (prevHdrTitle) prevHdrTitle.textContent = nom;
  const prevHdrSub = document.getElementById('preview-header-sub');
  if (prevHdrSub) {
    prevHdrSub.textContent = sub;
    prevHdrSub.style.display = sub ? 'block' : 'none';
  }
  const prevBadgeTitle = document.getElementById('preview-badge-title');
  if (prevBadgeTitle) prevBadgeTitle.textContent = nom;

  // Logotip
  const prevHdrImg = document.getElementById('preview-header-logo-img');
  const prevHdrIcon = document.getElementById('preview-header-logo-icon');
  const prevBadgeImg = document.getElementById('preview-badge-logo-img');
  const prevBadgeIcon = document.getElementById('preview-badge-logo-icon');

  if (logoUrl && !logoUrl.includes('PHN2Zz48L3N2Zz4=')) {
    if (prevHdrImg) {
      prevHdrImg.onerror = () => { prevHdrImg.style.display = 'none'; };
      prevHdrImg.onload = () => { prevHdrImg.style.display = 'block'; };
      prevHdrImg.src = logoUrl;
    }
    if (prevHdrIcon) prevHdrIcon.style.display = 'none';
    if (prevBadgeImg) {
      prevBadgeImg.onerror = () => { prevBadgeImg.style.display = 'none'; };
      prevBadgeImg.onload = () => { prevBadgeImg.style.display = 'inline-block'; };
      prevBadgeImg.src = logoUrl;
    }
    if (prevBadgeIcon) prevBadgeIcon.style.display = 'none';
  } else {
    if (prevHdrImg) { prevHdrImg.src = ''; prevHdrImg.style.display = 'none'; }
    if (prevHdrIcon) prevHdrIcon.style.display = 'none';
    if (prevBadgeImg) { prevBadgeImg.src = ''; prevBadgeImg.style.display = 'none'; }
    if (prevBadgeIcon) prevBadgeIcon.style.display = 'none';
  }

  // Colors al Mockup (Sense gradients, fons corporatiu sòlid)
  const badgeTop = document.getElementById('preview-badge-top');
  if (badgeTop) {
    badgeTop.style.background = prim;
  }
  const balanceCard = document.getElementById('preview-balance-card');
  if (balanceCard) {
    balanceCard.style.background = prim;
  }
  const btnSample = document.getElementById('preview-btn-sample');
  if (btnSample) {
    btnSample.style.background = prim;
  }

  // Tipografia al Carnet
  const badgeCard = document.getElementById('preview-ceramic-badge');
  if (badgeCard) {
    if (fontChoice === 'serif') {
      badgeCard.style.fontFamily = "'Playfair Display', Georgia, serif";
    } else if (fontChoice === 'sans') {
      badgeCard.style.fontFamily = "'Inter', -apple-system, sans-serif";
    } else {
      badgeCard.style.fontFamily = "Verdana, Geneva, Tahoma, sans-serif";
    }
  }
}

/* ==================== RESERVES & CONTROL D'AFORAMENT (ADMIN) ==================== */

function getAdminLocalDate(daysOffset = 0) {
  const d = new Date();
  if (daysOffset !== 0) d.setDate(d.getDate() + daysOffset);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

let adminSelectedDate = getAdminLocalDate();

let adminReservesCalendar = null;

function initReservesAdmin() {
  const btnOpen = document.getElementById('btn-reserves-admin') || document.getElementById('btn-admin-aforament-modal');
  const modal = document.getElementById('modal-reserves-backdrop');
  if (btnOpen && modal) {
    btnOpen.addEventListener('click', () => {
      openReservesModal(adminSelectedDate);
    });
  }

  document.getElementById('btn-close-modal-reserves')?.addEventListener('click', () => {
    modal?.classList.remove('active');
  });
  document.getElementById('btn-close-modal-reserves-footer')?.addEventListener('click', () => {
    modal?.classList.remove('active');
  });

  // Desar aforament màxim global
  document.getElementById('btn-admin-save-aforament')?.addEventListener('click', async () => {
    const input = document.getElementById('admin-input-aforament');
    if (!input) return;
    const val = parseInt(input.value, 10) || 12;
    try {
      await Store.guardarAforamentMaxim(val);
      showToast(`Aforament màxim global actualitzat a ${val} places/franja.`, 'success');
      const dispVal = document.getElementById('admin-display-aforament-val');
      if (dispVal) dispVal.textContent = `${val} places simultànies`;
      if (adminReservesCalendar) await adminReservesCalendar.refresh();
      await refreshAppointmentsDashboard();
    } catch (err) {
      showToast('Error desant aforament: ' + err.message, 'error');
    }
  });

  // Desar capacitats per activitat (Torn, Modelatge, Pintar ceràmica)
  document.getElementById('btn-admin-save-capacitats-act')?.addEventListener('click', async () => {
    const torn = parseInt(document.getElementById('admin-cap-torn')?.value, 10) || 4;
    const modelatge = parseInt(document.getElementById('admin-cap-modelatge')?.value, 10) || 8;
    const pintar = parseInt(document.getElementById('admin-cap-pintar')?.value, 10) || 12;

    try {
      await Store.guardarCapacitatsActivitats({
        capacitat_max_torn: torn,
        capacitat_max_modelatge: modelatge,
        capacitat_max_pintar: pintar
      });
      showToast(`Capacitats desades: Torn (${torn}), Modelatge (${modelatge}), Pintar (${pintar}).`, 'success');
      if (adminReservesCalendar) await adminReservesCalendar.refresh();
      await refreshAppointmentsDashboard();
    } catch (err) {
      showToast('Error desant capacitats d\'activitats: ' + err.message, 'error');
    }
  });
}

async function openReservesModal(preselectedDate) {
  const modal = document.getElementById('modal-reserves-backdrop');
  if (!modal) return;
  modal.classList.add('active');

  const targetDate = preselectedDate || null;

  try {
    const cfg = await Store.getConfig();
    const maxCap = parseInt(cfg.aforament_maxim_per_franja || 12, 10);
    const inputCap = document.getElementById('admin-input-aforament');
    if (inputCap) inputCap.value = maxCap;
    const dispVal = document.getElementById('admin-display-aforament-val');
    if (dispVal) dispVal.textContent = `${maxCap} places simultànies`;

    // Carregar capacitats de les 3 activitats
    const acts = await Store.getActivitatsConfig();
    const actMap = {};
    acts.forEach(a => { actMap[a.id] = a.capacitatMax; });
    if (document.getElementById('admin-cap-torn')) {
      document.getElementById('admin-cap-torn').value = actMap['torn'] || 4;
    }
    if (document.getElementById('admin-cap-modelatge')) {
      document.getElementById('admin-cap-modelatge').value = actMap['modelatge'] || 8;
    }
    if (document.getElementById('admin-cap-pintar')) {
      document.getElementById('admin-cap-pintar').value = actMap['pintar'] || 12;
    }
  } catch (e) {}

  if (!adminReservesCalendar) {
    adminReservesCalendar = new ReservesCalendar({
      containerId: 'admin-reserves-calendar-mount',
      isAdmin: true,
      allStudents: allStudents,
      initialDate: targetDate,
      onBookingSuccess: async () => {
        showToast('Reserva confirmada i sincronitzada.', 'success');
        await refreshAppointmentsDashboard();
      }
    });
    adminReservesCalendar.selectedDate = targetDate;
    await adminReservesCalendar.init();
  } else {
    adminReservesCalendar.setAllStudents(allStudents);
    adminReservesCalendar.selectedDate = targetDate;
    if (targetDate) {
      await adminReservesCalendar.loadDay(targetDate);
    } else {
      adminReservesCalendar.dayData = null;
    }
    await adminReservesCalendar.refresh();
  }
}

// ==================== APPOINTMENTS DASHBOARD (2 COLUMNES: CALENDARI + LLISTA) ====================
let adminCalYear = new Date().getFullYear();
let adminCalMonth = new Date().getMonth() + 1; // 1-12
let adminMonthDisponibilitat = null;
let adminMonthReservesMap = {};

const CATALAN_MONTHS = [
  'Gener', 'Febrer', 'Març', 'Abril', 'Maig', 'Juny',
  'Juliol', 'Agost', 'Setembre', 'Octubre', 'Novembre', 'Desembre'
];

const CATALAN_WEEKDAYS = [
  'Diumenge', 'Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte'
];

function formatCatalanFullDate(dateStr) {
  if (!dateStr) return '';
  try {
    const parts = dateStr.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const dayName = CATALAN_WEEKDAYS[d.getDay()];
    const dayNum = d.getDate();
    const monthName = CATALAN_MONTHS[d.getMonth()].toLowerCase();
    const year = d.getFullYear();
    return `${dayName}, ${dayNum} de ${monthName} de ${year}`;
  } catch (e) {
    return dateStr;
  }
}

async function initAppointmentsDashboard() {
  // Navegació mes anterior / següent / avui
  document.getElementById('btn-cal-prev')?.addEventListener('click', async () => {
    adminCalMonth--;
    if (adminCalMonth < 1) {
      adminCalMonth = 12;
      adminCalYear--;
    }
    await renderAdminCalendar();
  });

  document.getElementById('btn-cal-next')?.addEventListener('click', async () => {
    adminCalMonth++;
    if (adminCalMonth > 12) {
      adminCalMonth = 1;
      adminCalYear++;
    }
    await renderAdminCalendar();
  });

  document.getElementById('btn-cal-today')?.addEventListener('click', async () => {
    const now = new Date();
    adminCalYear = now.getFullYear();
    adminCalMonth = now.getMonth() + 1;
    adminSelectedDate = now.toISOString().split('T')[0];
    await renderAdminCalendar();
    await renderAdminDayAppointments(adminSelectedDate);
  });

  // Botons "+ Nova Reserva"
  document.getElementById('btn-admin-nova-reserva')?.addEventListener('click', () => {
    openAdminNovaReservaModal(adminSelectedDate);
  });

  document.getElementById('btn-nova-reserva-dia')?.addEventListener('click', () => {
    openAdminNovaReservaModal(adminSelectedDate);
  });

  // Render inicial del calendari i llista del dia seleccionat
  await renderAdminCalendar();
  await renderAdminDayAppointments(adminSelectedDate);
}

async function refreshAppointmentsDashboard() {
  await renderAdminCalendar();
  await renderAdminDayAppointments(adminSelectedDate);
}

async function renderAdminCalendar() {
  const monthTitle = document.getElementById('cal-month-title');
  if (monthTitle) {
    monthTitle.textContent = `${CATALAN_MONTHS[adminCalMonth - 1]} ${adminCalYear}`;
  }

  const grid = document.getElementById('cal-days-grid');
  if (!grid) return;

  // Carregar disponibilitat del mes i reserves
  try {
    adminMonthDisponibilitat = await Store.getDisponibilitatMes(adminCalYear, adminCalMonth);
  } catch (e) {
    adminMonthDisponibilitat = null;
  }

  try {
    const allRes = await Store.getReserves();
    adminMonthReservesMap = {};
    if (Array.isArray(allRes)) {
      allRes.forEach(r => {
        if (r.estat !== 'cancel·lada') {
          if (!adminMonthReservesMap[r.data]) adminMonthReservesMap[r.data] = [];
          adminMonthReservesMap[r.data].push(r);
        }
      });
    }
  } catch (e) {
    adminMonthReservesMap = {};
  }

  const daysInMonth = new Date(adminCalYear, adminCalMonth, 0).getDate();
  const firstDayOfMonth = new Date(adminCalYear, adminCalMonth - 1, 1).getDay(); // 0: Dg, 1: Dl...
  const startOffset = (firstDayOfMonth + 6) % 7; // Dl=0, Dt=1... Dg=6

  const prevMonthDays = new Date(adminCalYear, adminCalMonth - 1, 0).getDate();
  const todayStr = new Date().toISOString().split('T')[0];

  let html = '';

  // Dies previs del mes anterior
  for (let i = startOffset - 1; i >= 0; i--) {
    const dNum = prevMonthDays - i;
    html += `
      <div class="cal-day-cell other-month">
        <div class="cal-day-num">${dNum}</div>
      </div>
    `;
  }

  // Dies del mes actual
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${adminCalYear}-${String(adminCalMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === adminSelectedDate;
    const dayDisp = adminMonthDisponibilitat?.dies?.[dateStr];
    const isClosed = dayDisp?.tancat;
    const dayRes = adminMonthReservesMap[dateStr] || [];
    const count = dayRes.length;

    let cellClasses = ['cal-day-cell'];
    if (isSelected) cellClasses.push('active-day');
    if (isToday) cellClasses.push('today-day');
    if (isClosed) cellClasses.push('closed-day');

    html += `
      <div class="${cellClasses.join(' ')}" data-date="${dateStr}">
        <div class="cal-day-num">${day}</div>
        ${count > 0 ? `<div class="cal-day-badge" title="${count} ${count === 1 ? 'reserva' : 'reserves'}"><span class="badge-full">${count} ${count === 1 ? 'Reserva' : 'Reserves'}</span><span class="badge-short">${count} res.</span></div>` : ''}
        ${isClosed && count === 0 ? `<div class="cal-day-closed-label">Tancat</div>` : ''}
      </div>
    `;
  }

  // Dies posteriors per omplir graella
  const totalCells = startOffset + daysInMonth;
  const remainingCells = (7 - (totalCells % 7)) % 7;
  for (let nextDay = 1; nextDay <= remainingCells; nextDay++) {
    html += `
      <div class="cal-day-cell other-month">
        <div class="cal-day-num">${nextDay}</div>
      </div>
    `;
  }

  grid.innerHTML = html;

  // Afegir listener de clic per seleccionar dia
  grid.querySelectorAll('.cal-day-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', async () => {
      adminSelectedDate = cell.dataset.date;
      grid.querySelectorAll('.cal-day-cell').forEach(c => c.classList.remove('active-day'));
      cell.classList.add('active-day');
      await renderAdminDayAppointments(adminSelectedDate);
      document.getElementById('admin-appointment-list-mount')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

async function renderAdminDayAppointments(dateStr) {
  const dateDisplay = document.getElementById('app-selected-date-display');
  const countDisplay = document.getElementById('app-list-count');
  const tableBody = document.getElementById('app-table-body');

  if (dateDisplay) {
    dateDisplay.textContent = formatCatalanFullDate(dateStr);
  }

  if (tableBody) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; color: #6B7280; padding: 24px;">
          Carregant reserves per al ${dateStr}...
        </td>
      </tr>
    `;
  }

  let reserves = [];
  try {
    reserves = await Store.getReserves({ data: dateStr });
    if (!Array.isArray(reserves)) reserves = [];
  } catch (e) {
    console.warn('Error obtenint reserves del dia:', e);
    reserves = [];
  }

  const activeReserves = reserves.filter(r => r.estat !== 'cancel·lada');
  if (countDisplay) {
    countDisplay.textContent = `Llista de Reserves (${activeReserves.length})`;
  }

  if (!tableBody) return;

  if (reserves.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="4" class="app-empty-state" style="padding: 32px 16px; text-align: center;">
          <div style="font-weight: 700; color: #374151; margin-bottom: 4px; font-size: 14px;">No hi ha cap reserva per aquest dia</div>
          <div style="color: #6B7280; font-size: 13px;">Totes les places estan disponibles (12 places).</div>
        </td>
      </tr>
    `;
    return;
  }

  // Renderitzar files amb checkbox "Visited"
  tableBody.innerHTML = reserves.map((r, idx) => {
    const isVisited = r.estat === 'assistit';
    const isCancelled = r.estat === 'cancel·lada';
    const clientNom = `${r.nom || ''} ${r.cognoms || ''}`.trim() || r.student_nom || r.student_id || 'Client sense nom';
    const slotDesc = (r.hora_inici && r.hora_fi) ? `${r.hora_inici} - ${r.hora_fi}` : (r.franja_id || '');

    let actNom = 'Torn';
    if (r.activitat_id === 'modelatge') { actNom = 'Modelatge'; }
    else if (r.activitat_id === 'pintar') { actNom = 'Pintar ceràmica'; }

    const placesBadge = `<span class="badge badge-neutral" style="font-size: 11px; padding: 2px 6px;">${r.places || 1} pl.</span>`;
    const isValRegal = r.val_regal === 1 || (r.notes && r.notes.includes('VAL REGAL'));
    const valRegalBadge = isValRegal ? `<span class="badge" style="background: #FDE8E8; color: #831D1D; border: 1px solid #F8B4B4; font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: 700; margin-left: 4px;">Val regal (${actNom})</span>` : '';
    const isRecurrent = !!r.recurrent_id;
    const recurrentBadge = isRecurrent ? `<span class="badge" style="background: #EEF2FF; color: #4338CA; border: 1px solid #C7D2FE; font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: 700; margin-left: 4px;" title="Sèrie de reserves periòdiques">Recurrent</span>` : '';

    return `
      <tr style="${isCancelled ? 'opacity: 0.55; text-decoration: line-through;' : ''}">
        <td style="font-weight: 700; color: #6B7280; font-size: 12px; width: 32px;">${idx + 1}</td>
        <td>
          <div class="app-client-name">${clientNom}</div>
          <div class="app-slot-desc">
            ${slotDesc} &bull; ${actNom} ${placesBadge} ${valRegalBadge} ${recurrentBadge}
            ${r.notes ? `&bull; <span style="font-style: italic; color: #6B7280;">"${r.notes}"</span>` : ''}
          </div>
        </td>
        <td style="text-align: center;">
          <label class="visited-checkbox-label" title="Marca per confirmar l'assistència com a 'Visited'">
            <input type="checkbox" class="app-visited-checkbox" data-res-id="${r.id}" ${isVisited ? 'checked' : ''} ${isCancelled ? 'disabled' : ''}>
            <span>Visited</span>
          </label>
          <div style="margin-top: 3px;">
            <span class="badge ${isVisited ? 'badge-success' : (isCancelled ? 'badge-danger' : 'badge-neutral')}" style="font-size: 10px; padding: 2px 6px;">
              ${isVisited ? 'Assistit' : (isCancelled ? 'Cancel·lada' : 'Pendent')}
            </span>
          </div>
        </td>
        <td style="text-align: right;">
          <div class="app-actions-group">
            ${r.student_id && !r.student_id.startsWith('CLI-') ? `
              <button type="button" class="btn btn-outline btn-sm btn-action-view" data-id="${r.student_id}" style="padding: 3px 6px; font-size: 11.5px;" title="Veure Fitxa 360°">
                Fitxa
              </button>
            ` : ''}
            ${r.telefon ? `
              <a href="https://wa.me/${r.telefon.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`Hola ${clientNom}, et contactem de Roig de Coure respecte a la teva reserva de ceràmica el dia ${dateStr} a les ${r.hora_inici || ''}...`)}" target="_blank" class="btn btn-outline btn-sm" style="padding: 3px 6px; font-size: 11.5px; color: #128C7E; border-color: #A7F3D0;" title="Contactar per WhatsApp">
                WhatsApp
              </a>
            ` : ''}
            ${!isCancelled ? `
              <button type="button" class="btn btn-outline btn-sm btn-app-cancel-reserva" data-res-id="${r.id}" style="padding: 3px 6px; font-size: 11.5px; color: #831D1D; border-color: #E5DDD5;" title="Cancel·lar aquesta sessió">
                Cancel·lar
              </button>
            ` : ''}
            ${!isCancelled && isRecurrent ? `
              <button type="button" class="btn btn-outline btn-sm btn-app-cancel-serie" data-recurrent-id="${r.recurrent_id}" data-date="${dateStr}" style="padding: 3px 6px; font-size: 11.5px; color: #DC2626; border-color: #FCA5A5; background: #FEF2F2;" title="Cancel·lar totes les sessions futures d'aquesta sèrie">
                Cancel·lar Sèrie
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Delegar canvi de checkbox "Visited"
  tableBody.querySelectorAll('.app-visited-checkbox').forEach(chk => {
    chk.addEventListener('change', async () => {
      const resId = chk.dataset.resId;
      const isChecked = chk.checked;
      try {
        await Store.updateReservaAssistencia(resId, isChecked);
        showToast(isChecked ? 'Assistència confirmada (Visited)' : 'Assistència desmarcada', 'success');
        if (typeof SoundEngine !== 'undefined') SoundEngine.playCheckin();
        await refreshAppointmentsDashboard();
      } catch (err) {
        showToast('Error actualitzant assistència: ' + err.message, 'error');
        chk.checked = !isChecked;
      }
    });
  });

  // Delegar cancel·lació de reserva individual
  tableBody.querySelectorAll('.btn-app-cancel-reserva').forEach(btn => {
    btn.addEventListener('click', async () => {
      const resId = btn.dataset.resId;
      if (confirm('Segur que vols cancel·lar aquesta reserva i alliberar la plaça?')) {
        try {
          const res = await Store.cancelarReserva(resId);
          if (res.ok) {
            showToast('Reserva cancel·lada correctament.', 'info');
            await refreshAppointmentsDashboard();
          } else {
            showToast(res.error || 'No s\'ha pogut cancel·lar la reserva', 'error');
          }
        } catch (err) {
          showToast('Error cancel·lant reserva: ' + err.message, 'error');
        }
      }
    });
  });

  // Delegar cancel·lació de sèrie recurrent sencera
  tableBody.querySelectorAll('.btn-app-cancel-serie').forEach(btn => {
    btn.addEventListener('click', async () => {
      const recId = btn.dataset.recurrentId;
      const fromDate = btn.dataset.date;
      if (confirm(`Segur que vols cancel·lar totes les sessions pendents d'aquesta sèrie recurrent a partir del dia ${fromDate}? S'alliberaran totes les places.`)) {
        try {
          const res = await Store.cancelarSerieRecurrent(recId, fromDate);
          if (res && res.ok) {
            showToast(res.message || 'Sèrie recurrent cancel·lada correctament.', 'info');
            await refreshAppointmentsDashboard();
          } else {
            showToast(res?.error || 'No s\'ha pogut cancel·lar la sèrie', 'error');
          }
        } catch (err) {
          showToast('Error cancel·lant sèrie: ' + err.message, 'error');
        }
      }
    });
  });
}

// ==================== MODAL ADMIN NOVA RESERVA D'ALUMNE ====================
async function openAdminNovaReservaModal(preselectedDate, preselectedStudentId, preselectedActId) {
  const modal = document.getElementById('modal-admin-nova-reserva-backdrop');
  if (!modal) {
    console.error('Modal #modal-admin-nova-reserva-backdrop no trobat');
    return;
  }
  // Obrir el modal immediatament
  modal.classList.add('active');

  // Selector d'alumnes
  const studentSelect = document.getElementById('admin-res-student-select');
  const fillSelect = (list) => {
    if (!studentSelect) return;
    studentSelect.innerHTML = '<option value="">-- Selecciona un alumne registrat --</option>';
    const sorted = [...(list || [])].sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
    sorted.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.dataset.nom = `${s.nom} ${s.cognoms || ''}`.trim();
      opt.dataset.tel = s.telefon || '';
      opt.dataset.email = s.email || '';
      opt.textContent = `${s.nom} ${s.cognoms || ''} (${s.id}) ${s.telefon ? '· Tel: ' + s.telefon : ''}`;
      if (preselectedStudentId && preselectedStudentId === s.id) {
        opt.selected = true;
      }
      studentSelect.appendChild(opt);
    });
  };

  if (allStudents && allStudents.length > 0) {
    fillSelect(allStudents);
  } else {
    if (studentSelect) studentSelect.innerHTML = '<option value="">Carregant alumnes...</option>';
    Store.getAlumnes().then(list => {
      allStudents = Array.isArray(list) ? list : [];
      fillSelect(allStudents);
    }).catch(e => {
      console.warn('Error carregant alumnes:', e);
      if (studentSelect) studentSelect.innerHTML = '<option value="">-- No s\'han pogut carregar alumnes --</option>';
    });
  }

  // Reset al tipus existent
  const radioExistent = document.querySelector('input[name="admin_res_client_type"][value="existent"]');
  if (radioExistent) radioExistent.checked = true;
  toggleAdminReservaClientType();

  // Reset a mode puntual
  const radioPuntual = document.querySelector('input[name="admin_res_mode"][value="puntual"]');
  if (radioPuntual) radioPuntual.checked = true;
  toggleAdminReservaMode();

  // Netejar inputs de nou client
  const mNom = document.getElementById('admin-res-nou-nom');
  const mTel = document.getElementById('admin-res-nou-tel');
  const mEmail = document.getElementById('admin-res-nou-email');
  if (mNom) mNom.value = '';
  if (mTel) mTel.value = '';
  if (mEmail) mEmail.value = '';

  // Data
  const todayISO = getAdminLocalDate();
  const targetDate = preselectedDate || adminSelectedDate || todayISO;
  const dateInput = document.getElementById('admin-res-data');
  if (dateInput) {
    dateInput.min = todayISO;
    dateInput.value = targetDate;
  }
  handleAdminResDataChange();

  // Activitat
  const actSelect = document.getElementById('admin-res-activitat');
  if (actSelect) {
    actSelect.value = (preselectedActId || 'torn').toLowerCase();
  }

  // Places
  const placesInput = document.getElementById('admin-res-places');
  if (placesInput) placesInput.value = 1;

  // Repeticions per defecte
  const repsInput = document.getElementById('admin-res-repeticions');
  if (repsInput) repsInput.value = 4;

  // Hora inici 10:00
  const horaSelect = document.getElementById('admin-res-hora-inici');
  if (horaSelect) horaSelect.value = '10:00';

  // Notes
  const notesInput = document.getElementById('admin-res-notes');
  if (notesInput) notesInput.value = '';
}

function closeAdminNovaReservaModal() {
  const modal = document.getElementById('modal-admin-nova-reserva-backdrop');
  if (modal) modal.classList.remove('active');
}

function toggleAdminReservaClientType() {
  const type = document.querySelector('input[name="admin_res_client_type"]:checked')?.value || 'existent';
  const grpExistent = document.getElementById('admin-res-group-existent');
  const grpNou = document.getElementById('admin-res-group-nou');
  if (type === 'nou') {
    if (grpExistent) grpExistent.style.display = 'none';
    if (grpNou) grpNou.style.display = 'block';
  } else {
    if (grpExistent) grpExistent.style.display = 'block';
    if (grpNou) grpNou.style.display = 'none';
  }
}

function toggleAdminReservaMode() {
  const mode = document.querySelector('input[name="admin_res_mode"]:checked')?.value || 'puntual';
  const grpRec = document.getElementById('admin-res-group-recurrent');
  const dateLabel = document.getElementById('admin-res-data-label');
  const submitBtn = document.getElementById('btn-admin-submit-nova-reserva');

  if (mode === 'recurrent') {
    if (grpRec) grpRec.style.display = 'block';
    if (dateLabel) dateLabel.textContent = "Data d'inici de la sèrie:";
    const reps = document.getElementById('admin-res-repeticions')?.value || 4;
    if (submitBtn) submitBtn.textContent = `Confirmar Sèrie Recurrent (${reps} sessions)`;
    updateRecurringPreview();
  } else {
    if (grpRec) grpRec.style.display = 'none';
    if (dateLabel) dateLabel.textContent = "Data de la reserva:";
    if (submitBtn) submitBtn.textContent = "Confirmar Reserva";
  }
}

function setPresetRepeticions(n) {
  const input = document.getElementById('admin-res-repeticions');
  if (input) {
    input.value = n;
    const submitBtn = document.getElementById('btn-admin-submit-nova-reserva');
    if (submitBtn && document.querySelector('input[name="admin_res_mode"]:checked')?.value === 'recurrent') {
      submitBtn.textContent = `Confirmar Sèrie Recurrent (${n} sessions)`;
    }
    updateRecurringPreview();
  }
}

async function updateRecurringPreview() {
  const mode = document.querySelector('input[name="admin_res_mode"]:checked')?.value || 'puntual';
  if (mode !== 'recurrent') return;

  const dataInici = document.getElementById('admin-res-data')?.value;
  const frequencia = document.getElementById('admin-res-frequencia')?.value || 'setmanal';
  const repeticions = parseInt(document.getElementById('admin-res-repeticions')?.value || 4, 10);
  const activitatId = document.getElementById('admin-res-activitat')?.value || 'torn';
  const places = parseInt(document.getElementById('admin-res-places')?.value || 1, 10);
  const saltarTancats = document.getElementById('admin-res-saltar-tancats')?.checked !== false;

  const summaryEl = document.getElementById('admin-recurring-preview-summary');
  const listEl = document.getElementById('admin-recurring-preview-list');
  const submitBtn = document.getElementById('btn-admin-submit-nova-reserva');

  if (submitBtn) {
    submitBtn.textContent = `Confirmar Sèrie Recurrent (${repeticions} sessions)`;
  }

  if (!dataInici) {
    if (listEl) listEl.innerHTML = '<div style="color: #6B7280; padding: 6px;">Selecciona una data d\'inici per veure les sessions.</div>';
    return;
  }

  if (listEl) {
    listEl.innerHTML = '<div style="color: #6B7280; padding: 6px;">Calculant sessions i disponibilitat...</div>';
  }

  try {
    const res = await Store.previewReservesRecurrents({
      data_inici: dataInici,
      frequencia: frequencia,
      repeticions: repeticions,
      activitat_id: activitatId,
      places: places,
      saltar_tancats: saltarTancats
    });

    if (res && res.ok && Array.isArray(res.preview)) {
      if (summaryEl) {
        summaryEl.textContent = `Sessions programades (${res.preview.length} demanades, ${frequencia}):`;
      }
      listEl.innerHTML = res.preview.map((p, idx) => {
        const dFmt = formatCatalanFullDate(p.data);
        const isOk = p.disponible;
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 5px 8px; border-radius: 4px; background: ${isOk ? '#F0FDF4' : '#FEF2F2'}; border: 1px solid ${isOk ? '#BBF7D0' : '#FECACA'};">
            <div>
              <strong style="color: #111827; font-size: 12px;">${idx + 1}. ${dFmt}</strong>
            </div>
            <div>
              <span class="badge ${isOk ? 'badge-success' : 'badge-danger'}" style="font-size: 11px; padding: 2px 6px;">
                ${isOk ? `Obert (${p.places_lliures_activitat} pl. lliures)` : `Complet (${p.places_lliures_activitat} lliures)`}
              </span>
            </div>
          </div>
        `;
      }).join('');

      if (res.dates_saltades && res.dates_saltades.length > 0) {
        listEl.innerHTML += `
          <div style="font-size: 11px; color: #92400E; background: #FEF3C7; border: 1px solid #FDE68A; border-radius: 4px; padding: 4px 8px; margin-top: 4px;">
            S'han saltat ${res.dates_saltades.length} dia(es) per tancament/festiu: ${res.dates_saltades.map(s => s.data).join(', ')}.
          </div>
        `;
      }
    } else {
      if (listEl) listEl.innerHTML = `<div style="color: #DC2626; padding: 6px;">${res?.error || 'No s\'han pogut calcular les dates'}</div>`;
    }
  } catch (err) {
    if (listEl) listEl.innerHTML = `<div style="color: #DC2626; padding: 6px;">Error: ${err.message}</div>`;
  }
}

function handleAdminResDataChange() {
  const dateInput = document.getElementById('admin-res-data');
  const warningDiv = document.getElementById('admin-res-data-warning');
  if (!dateInput || !warningDiv) return;

  const dateVal = dateInput.value;
  if (!dateVal) {
    warningDiv.style.display = 'none';
    return;
  }

  const parts = dateVal.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const dayOfWeek = d.getDay(); // 0 = Dg, 1 = Dl, 2 = Dt...

  if (dayOfWeek === 1 || dayOfWeek === 2) {
    warningDiv.textContent = 'Atenció: Els dilluns i dimarts el taller roman tancat per descans setmanal.';
    warningDiv.style.display = 'block';
  } else {
    warningDiv.style.display = 'none';
  }

  // Actualitzar previsualització recurrent si s'escau
  if (document.querySelector('input[name="admin_res_mode"]:checked')?.value === 'recurrent') {
    updateRecurringPreview();
  }
}

async function handleAdminSubmitNovaReserva(e) {
  if (e) e.preventDefault();
  const submitBtn = document.getElementById('btn-admin-submit-nova-reserva');
  const originalBtnText = submitBtn ? submitBtn.textContent : 'Confirmar Reserva';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processant...';
  }

  const clientType = document.querySelector('input[name="admin_res_client_type"]:checked')?.value || 'existent';
  let studentId = '';
  let studentNom = '';
  let studentTel = '';
  let studentEmail = '';

  if (clientType === 'existent') {
    const sel = document.getElementById('admin-res-student-select');
    studentId = sel ? sel.value : '';
    if (!studentId) {
      alert('Si us plau, selecciona un alumne registrat a la llista.');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }
      return;
    }
    const opt = sel.options[sel.selectedIndex];
    studentNom = opt.dataset.nom || studentId;
    studentTel = opt.dataset.tel || '';
    studentEmail = opt.dataset.email || '';
  } else {
    studentNom = document.getElementById('admin-res-nou-nom')?.value?.trim();
    studentTel = document.getElementById('admin-res-nou-tel')?.value?.trim();
    studentEmail = document.getElementById('admin-res-nou-email')?.value?.trim();
    if (!studentNom || !studentTel) {
      alert('Cal indicar el nom complet i el telèfon de contacte del client.');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }
      return;
    }
    studentId = `CLI-${Date.now().toString().slice(-4)}`;
  }

  const dataRes = document.getElementById('admin-res-data')?.value;
  if (!dataRes) {
    alert('Cal indicar la data de la reserva.');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }
    return;
  }

  const actSelect = document.getElementById('admin-res-activitat');
  const actId = actSelect ? actSelect.value : 'torn';
  const actOpt = actSelect ? actSelect.options[actSelect.selectedIndex] : null;
  const actNom = actOpt ? actOpt.text.split('(')[0].trim() : 'Torn';

  const places = parseInt(document.getElementById('admin-res-places')?.value || 1, 10);

  const horaSelect = document.getElementById('admin-res-hora-inici');
  const horaInici = horaSelect ? horaSelect.value : '10:00';
  const horaFi = horaSelect?.options[horaSelect.selectedIndex]?.dataset.fi || '12:00';

  const notes = document.getElementById('admin-res-notes')?.value?.trim() || '';
  const mode = document.querySelector('input[name="admin_res_mode"]:checked')?.value || 'puntual';

  try {
    if (mode === 'recurrent') {
      const frequencia = document.getElementById('admin-res-frequencia')?.value || 'setmanal';
      const repeticions = parseInt(document.getElementById('admin-res-repeticions')?.value || 4, 10);
      const saltarTancats = document.getElementById('admin-res-saltar-tancats')?.checked !== false;

      const res = await Store.crearReservesRecurrents({
        student_id: studentId,
        student_nom: studentNom,
        telefon: studentTel,
        email: studentEmail,
        data_inici: dataRes,
        frequencia: frequencia,
        repeticions: repeticions,
        saltar_tancats: saltarTancats,
        franja_id: 'M1',
        franja: 'M1',
        activitat: actNom,
        activitat_id: actId,
        places: places,
        hora_inici: horaInici,
        hora_fi: horaFi,
        hores: 2.0,
        notes: notes
      });

      if (res && res.ok) {
        showToast(res.message || `Sèrie de ${res.total_creades} reserves recurrents creada amb èxit!`, 'success');
        if (typeof SoundEngine !== 'undefined') SoundEngine.playSuccess();
        closeAdminNovaReservaModal();

        adminSelectedDate = dataRes;
        await refreshAppointmentsDashboard();

        if (adminReservesCalendar) {
          adminReservesCalendar.selectedDate = dataRes;
          await adminReservesCalendar.refresh();
        }

        if (currentViewingStudent && currentViewingStudent.alumne) {
          openStudentInlineDetail(currentViewingStudent.alumne.id);
        }
      } else {
        alert(`No s'ha pogut crear la sèrie recurrent: ${(res && res.error) || 'Aforament complet o error en les dates'}`);
      }

    } else {
      // Reserva puntual
      const res = await Store.crearReserva({
        student_id: studentId,
        student_nom: studentNom,
        telefon: studentTel,
        email: studentEmail,
        data: dataRes,
        franja_id: 'M1',
        franja: 'M1',
        activitat: actNom,
        activitat_id: actId,
        places: places,
        hora_inici: horaInici,
        hora_fi: horaFi,
        hores: 2.0,
        notes: notes
      });

      if (res && res.ok) {
        showToast(`Reserva confirmada amb èxit per a ${studentNom}!`, 'success');
        if (typeof SoundEngine !== 'undefined') SoundEngine.playSuccess();
        closeAdminNovaReservaModal();

        adminSelectedDate = dataRes;
        await refreshAppointmentsDashboard();

        if (adminReservesCalendar) {
          adminReservesCalendar.selectedDate = dataRes;
          await adminReservesCalendar.refresh();
        }

        if (currentViewingStudent && currentViewingStudent.alumne) {
          openStudentInlineDetail(currentViewingStudent.alumne.id);
        }
      } else {
        alert(`No s'ha pogut crear la reserva: ${(res && res.error) || 'Aforament complet o dia no disponible'}`);
      }
    }
  } catch (err) {
    alert(`Error en crear la reserva: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText;
    }
  }
}

if (typeof window !== 'undefined') {
  window.openReservesModal = openReservesModal;
  window.openAdminNovaReservaModal = openAdminNovaReservaModal;
  window.closeAdminNovaReservaModal = closeAdminNovaReservaModal;
  window.toggleAdminReservaClientType = toggleAdminReservaClientType;
  window.toggleAdminReservaMode = toggleAdminReservaMode;
  window.setPresetRepeticions = setPresetRepeticions;
  window.updateRecurringPreview = updateRecurringPreview;
  window.handleAdminResDataChange = handleAdminResDataChange;
  window.handleAdminSubmitNovaReserva = handleAdminSubmitNovaReserva;
  window.loadAdminDisponibilitat = typeof loadAdminDisponibilitat !== 'undefined' ? loadAdminDisponibilitat : null;
  window.refreshAppointmentsDashboard = refreshAppointmentsDashboard;
  window.initAppointmentsDashboard = initAppointmentsDashboard;
  window.initAdminAuth = initAdminAuth;
  window.loadSnapshotsList = loadSnapshotsList;
}

// --- AUTENTICACIÓ I PANELL DE CONTROL AMB PIN ---
function initAdminAuth() {
  const lockScreen = document.getElementById('admin-lock-screen');
  const authForm = document.getElementById('form-admin-auth');
  const pinInput = document.getElementById('input-admin-pin');
  const pinError = document.getElementById('admin-pin-error');
  const logoutBtn = document.getElementById('btn-sidebar-logout');

  const isAuth = sessionStorage.getItem('roig_admin_auth') === '1';
  if (isAuth) {
    if (lockScreen) lockScreen.style.display = 'none';
  } else {
    if (lockScreen) lockScreen.style.display = 'flex';
    if (pinInput) setTimeout(() => pinInput.focus(), 150);
  }

  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = pinInput ? pinInput.value.trim() : '';
      if (!pin) return;

      const submitBtn = document.getElementById('btn-submit-admin-pin');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Comprovant...';
      }
      if (pinError) pinError.style.display = 'none';

      try {
        const res = await fetch('/api/admin/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin })
        });
        const data = await res.json();
        if (data.ok) {
          sessionStorage.setItem('roig_admin_auth', '1');
          if (lockScreen) lockScreen.style.display = 'none';
          showToast('Sessió d\'administrador iniciada', 'success');
          await loadAdminDashboardData();
        } else {
          if (pinError) {
            pinError.textContent = data.error || 'PIN incorrecte. Torna-ho a provar.';
            pinError.style.display = 'block';
          }
          if (pinInput) {
            pinInput.value = '';
            pinInput.focus();
          }
        }
      } catch (err) {
        if (pinError) {
          pinError.textContent = 'Error de connexió: ' + err.message;
          pinError.style.display = 'block';
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Desbloquejar Panell \u2192';
        }
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (confirm('Vols tancar la sessió d\'administració?')) {
        sessionStorage.removeItem('roig_admin_auth');
        window.location.reload();
      }
    });
  }
}

// --- GESTIÓ DE SNAPSHOTS I RESTAURACIÓ ---
async function loadSnapshotsList() {
  const container = document.getElementById('snapshots-list-container');
  if (!container) return;

  container.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--color-muted); font-size: 12px;">Carregant còpies de seguretat...</div>';

  try {
    const res = await fetch('/api/admin/backups');
    const data = await res.json();
    if (!data.ok || !data.backups || data.backups.length === 0) {
      container.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--color-muted); font-size: 12px;">No hi ha cap còpia de seguretat disponible.</div>';
      return;
    }

    let html = `
      <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left;">
        <thead>
          <tr style="background: #FAF8F5; border-bottom: 1px solid var(--color-border); color: var(--color-muted);">
            <th style="padding: 8px 10px; font-weight: 600;">Fitxer / Tipus</th>
            <th style="padding: 8px 10px; font-weight: 600;">Data</th>
            <th style="padding: 8px 10px; font-weight: 600;">Mida</th>
            <th style="padding: 8px 10px; font-weight: 600; text-align: right;">Accions</th>
          </tr>
        </thead>
        <tbody>
    `;

    data.backups.forEach(b => {
      const tipusLabel = b.tipus === 'actual' ? '<span style="color: #2E7D32; font-weight: 600;">[En ús]</span>'
        : (b.tipus === 'diari' ? '<span style="color: #1976D2;">[Diari]</span>'
        : (b.tipus === 'pre_restauracio' ? '<span style="color: #E65100;">[Pre-restauració]</span>' : '<span style="color: #5D4037;">[Manual]</span>'));

      const downloadUrl = `/api/admin/backups/download?file=${encodeURIComponent(b.filename)}`;
      
      let actionsHtml = `<a href="${downloadUrl}" class="btn btn-outline btn-sm" style="font-size: 11px; padding: 3px 7px; text-decoration: none;" download>Descarregar</a>`;
      if (b.isRestoreable) {
        actionsHtml += ` <button type="button" class="btn btn-outline btn-sm btn-restore-snapshot" data-file="${b.filename}" style="font-size: 11px; padding: 3px 7px; color: #D32F2F; border-color: #D32F2F; margin-left: 4px;">Restaurar</button>`;
      }

      html += `
        <tr style="border-bottom: 1px solid #EFEAE6;">
          <td style="padding: 8px 10px; font-family: monospace; font-size: 11px;">
            ${tipusLabel} ${b.filename}
          </td>
          <td style="padding: 8px 10px; color: var(--color-muted); white-space: nowrap;">${b.data}</td>
          <td style="padding: 8px 10px; color: var(--color-muted);">${b.midaFormatted}</td>
          <td style="padding: 8px 10px; text-align: right; white-space: nowrap;">
            ${actionsHtml}
          </td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;

    // Connectar botons de restauració
    container.querySelectorAll('.btn-restore-snapshot').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const fileToRestore = e.currentTarget.getAttribute('data-file');
        if (!fileToRestore) return;

        const confirmMsg = `ATENCIÓ: Vols restaurar la base de dades a la versió "${fileToRestore}"?\n\nEs crearà automàticament una còpia de seguretat de l'estat actual abans de restaurar.`;
        if (!confirm(confirmMsg)) return;

        try {
          showToast('Restaurant base de dades...', 'info');
          const restoreRes = await fetch('/api/admin/backups/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: fileToRestore })
          });
          const resJson = await restoreRes.json();
          if (resJson.ok) {
            showToast(resJson.message || 'Base de dades restaurada correctament!', 'success');
            await loadSnapshotsList();
            await loadAdminDashboardData();
          } else {
            showToast(resJson.error || 'Error en restaurar la base de dades.', 'error');
          }
        } catch (restoreErr) {
          showToast('Error de connexió: ' + restoreErr.message, 'error');
        }
      });
    });

  } catch (err) {
    container.innerHTML = `<div style="padding: 16px; text-align: center; color: #D32F2F; font-size: 12px;">Error carregant còpies de seguretat: ${err.message}</div>`;
  }
}

/* =======================================================
   DISSENYADOR DE CARNETS D'ALUMNE (CR80)
   ======================================================= */
let cardDesignerConfig = null;
let currentDesignerStudent = null;

async function initCardDesigner() {
  const panel = document.getElementById('view-carnet-designer');
  if (!panel) return;

  // Carregar configuració existent
  try {
    cardDesignerConfig = await Store.getCarnetConfig();
  } catch (e) {
    cardDesignerConfig = {
      background_color: '#b1ffc2',
      text_color: '#801b1b',
      font_style: 'borel',
      show_bowl_logo: true,
      custom_logo_svg: '',
      show_divider: true,
      brand_name: 'Roig de Coure',
      visible_fields: { nom: true, cognoms: true, codi: true, telefon: false, saldo: false }
    };
  }

  // Omplir selector d'alumnes de mostra
  populateDesignerStudentSelect();

  // Aplicar valors als controls
  syncDesignerControlsWithConfig();

  // Esdeveniments per a paletes de colors ràpides (Fons)
  document.querySelectorAll('#swatches-bg .color-swatch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#swatches-bg .color-swatch-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const color = btn.dataset.color;
      const bgPicker = document.getElementById('designer-color-bg');
      const bgVal = document.getElementById('designer-color-bg-val');
      if (bgPicker) bgPicker.value = color;
      if (bgVal) bgVal.textContent = color;
      if (cardDesignerConfig) cardDesignerConfig.background_color = color;
      updateCardDesignPreview();
    });
  });

  // Esdeveniments per a paletes de colors ràpides (Text & Marca)
  document.querySelectorAll('#swatches-text .color-swatch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#swatches-text .color-swatch-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const color = btn.dataset.color;
      const textPicker = document.getElementById('designer-color-text');
      const textVal = document.getElementById('designer-color-text-val');
      if (textPicker) textPicker.value = color;
      if (textVal) textVal.textContent = color;
      if (cardDesignerConfig) cardDesignerConfig.text_color = color;
      updateCardDesignPreview();
    });
  });

  // Color picker lliure de fons
  const colorBgInput = document.getElementById('designer-color-bg');
  colorBgInput?.addEventListener('input', (e) => {
    const color = e.target.value;
    const bgVal = document.getElementById('designer-color-bg-val');
    if (bgVal) bgVal.textContent = color;
    document.querySelectorAll('#swatches-bg .color-swatch-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.color.toLowerCase() === color.toLowerCase());
    });
    if (cardDesignerConfig) cardDesignerConfig.background_color = color;
    updateCardDesignPreview();
  });

  // Color picker lliure de text
  const colorTextInput = document.getElementById('designer-color-text');
  colorTextInput?.addEventListener('input', (e) => {
    const color = e.target.value;
    const textVal = document.getElementById('designer-color-text-val');
    if (textVal) textVal.textContent = color;
    document.querySelectorAll('#swatches-text .color-swatch-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.color.toLowerCase() === color.toLowerCase());
    });
    if (cardDesignerConfig) cardDesignerConfig.text_color = color;
    updateCardDesignPreview();
  });

  // Input de marca
  document.getElementById('designer-input-brand')?.addEventListener('input', (e) => {
    if (cardDesignerConfig) cardDesignerConfig.brand_name = e.target.value;
    updateCardDesignPreview();
  });

  // Selector de font
  document.getElementById('designer-select-font')?.addEventListener('change', (e) => {
    if (cardDesignerConfig) cardDesignerConfig.font_style = e.target.value;
    updateCardDesignPreview();
  });

  // Checkbox de bol ceràmic
  document.getElementById('designer-check-bowl')?.addEventListener('change', (e) => {
    if (cardDesignerConfig) cardDesignerConfig.show_bowl_logo = e.target.checked;
    updateCardDesignPreview();
  });

  // Checkbox de línia divisòria
  document.getElementById('designer-check-divider')?.addEventListener('change', (e) => {
    if (cardDesignerConfig) cardDesignerConfig.show_divider = e.target.checked;
    updateCardDesignPreview();
  });

  // Checkboxes de camps
  ['cognoms', 'telefon', 'saldo'].forEach(field => {
    const chk = document.getElementById(`designer-check-${field}`);
    chk?.addEventListener('change', (e) => {
      if (cardDesignerConfig) {
        cardDesignerConfig.visible_fields = cardDesignerConfig.visible_fields || {};
        cardDesignerConfig.visible_fields[field] = e.target.checked;
      }
      updateCardDesignPreview();
    });
  });

  // Selector d'alumne de mostra
  document.getElementById('designer-sample-student')?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'SAMPLE_ZOEY') {
      currentDesignerStudent = { id: '300Z', nom: 'Zoey', cognoms: '', telefon: '+34 600 000 000' };
    } else {
      const found = allStudents.find(s => s.id === val);
      currentDesignerStudent = found || { id: '300Z', nom: 'Zoey', cognoms: '', telefon: '+34 600 000 000' };
    }
    updateCardDesignPreview();
  });

  // Botó: Desar com a Disseny del Taller
  document.getElementById('btn-designer-save-config')?.addEventListener('click', async () => {
    try {
      await Store.saveCarnetConfig(cardDesignerConfig);
      showToast('Disseny de carnet desat correctament com a oficial del taller.', 'success');
    } catch (err) {
      showToast('Error desant el disseny: ' + err.message, 'error');
    }
  });

  // Botó: Restablir Original
  document.getElementById('btn-designer-reset-default')?.addEventListener('click', () => {
    cardDesignerConfig = {
      background_color: '#b1ffc2',
      text_color: '#801b1b',
      font_style: 'borel',
      show_bowl_logo: true,
      custom_logo_svg: '',
      show_divider: true,
      brand_name: 'Roig de Coure',
      visible_fields: { nom: true, cognoms: true, codi: true, telefon: false, saldo: false }
    };
    syncDesignerControlsWithConfig();
    updateCardDesignPreview();
    showToast('Plantilla restablerta al model artesanal original.', 'info');
  });

  // Botó: Descarregar en SVG
  document.getElementById('btn-designer-export-svg')?.addEventListener('click', () => {
    downloadCardAsSVG(currentDesignerStudent || { id: '300Z', nom: 'Zoey', cognoms: '' }, cardDesignerConfig);
  });

  // Botó: Descarregar en PNG (CR80 300 DPI)
  document.getElementById('btn-designer-export-png')?.addEventListener('click', () => {
    downloadCardAsPNG(currentDesignerStudent || { id: '300Z', nom: 'Zoey', cognoms: '' }, cardDesignerConfig);
  });

  // Botó: Imprimir Carnet
  document.getElementById('btn-designer-print')?.addEventListener('click', () => {
    window.print();
  });

  // Renderització inicial
  currentDesignerStudent = { id: '300Z', nom: 'Zoey', cognoms: '', telefon: '+34 600 000 000' };
  updateCardDesignPreview();
}

function populateDesignerStudentSelect() {
  const sel = document.getElementById('designer-sample-student');
  if (!sel) return;
  const currentVal = sel.value;
  sel.innerHTML = '<option value="SAMPLE_ZOEY">Zoey (300Z) - Model Oficial</option>';
  if (Array.isArray(allStudents)) {
    allStudents.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.nom} ${s.cognoms || ''} (${s.id})`.trim();
      sel.appendChild(opt);
    });
  }
  if (currentVal && sel.querySelector(`option[value="${currentVal}"]`)) {
    sel.value = currentVal;
  }
}

function syncDesignerControlsWithConfig() {
  if (!cardDesignerConfig) return;
  const brandInput = document.getElementById('designer-input-brand');
  if (brandInput) brandInput.value = cardDesignerConfig.brand_name || 'Roig de Coure';

  const fontSelect = document.getElementById('designer-select-font');
  if (fontSelect) fontSelect.value = cardDesignerConfig.font_style || 'borel';

  const colorBg = cardDesignerConfig.background_color || '#b1ffc2';
  const colorBgInput = document.getElementById('designer-color-bg');
  const bgVal = document.getElementById('designer-color-bg-val');
  if (colorBgInput) colorBgInput.value = colorBg;
  if (bgVal) bgVal.textContent = colorBg;
  document.querySelectorAll('#swatches-bg .color-swatch-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.color.toLowerCase() === colorBg.toLowerCase());
  });

  const colorText = cardDesignerConfig.text_color || '#801b1b';
  const colorTextInput = document.getElementById('designer-color-text');
  const textVal = document.getElementById('designer-color-text-val');
  if (colorTextInput) colorTextInput.value = colorText;
  if (textVal) textVal.textContent = colorText;
  document.querySelectorAll('#swatches-text .color-swatch-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.color.toLowerCase() === colorText.toLowerCase());
  });

  const chkBowl = document.getElementById('designer-check-bowl');
  if (chkBowl) chkBowl.checked = cardDesignerConfig.show_bowl_logo !== false;

  const chkDivider = document.getElementById('designer-check-divider');
  if (chkDivider) chkDivider.checked = cardDesignerConfig.show_divider !== false;

  const vis = cardDesignerConfig.visible_fields || {};
  const chkCognoms = document.getElementById('designer-check-cognoms');
  if (chkCognoms) chkCognoms.checked = vis.cognoms !== false;
  const chkTel = document.getElementById('designer-check-telefon');
  if (chkTel) chkTel.checked = Boolean(vis.telefon);
  const chkSaldo = document.getElementById('designer-check-saldo');
  if (chkSaldo) chkSaldo.checked = Boolean(vis.saldo);
}

function updateCardDesignPreview() {
  const badge = document.getElementById('designer-live-badge');
  if (!badge || !cardDesignerConfig) return;

  const bg = cardDesignerConfig.background_color || '#b1ffc2';
  const text = cardDesignerConfig.text_color || '#801b1b';
  const font = cardDesignerConfig.font_style === 'modern' ? 'system-ui, -apple-system, sans-serif' : "'Borel', 'Buffalo', cursive";

  badge.style.setProperty('--card-bg-color', bg);
  badge.style.setProperty('--card-text-color', text);
  badge.style.setProperty('--card-font-family', font);

  const brandEl = document.getElementById('preview-brand-name');
  if (brandEl) brandEl.textContent = cardDesignerConfig.brand_name || 'Roig de Coure';

  const bowlContainer = document.getElementById('preview-bowl-container');
  if (bowlContainer) {
    bowlContainer.style.display = cardDesignerConfig.show_bowl_logo ? 'flex' : 'none';
  }

  const dividerEl = document.getElementById('preview-divider-line');
  if (dividerEl) {
    dividerEl.style.display = cardDesignerConfig.show_divider ? 'block' : 'none';
  }

  const s = currentDesignerStudent || { id: '300Z', nom: 'Zoey', cognoms: '', telefon: '+34 600 000 000' };
  const nomEl = document.getElementById('preview-nom-val');
  if (nomEl) nomEl.textContent = s.nom || 'Zoey';

  const cognomsWrap = document.getElementById('preview-field-cognoms-wrap');
  const cognomsEl = document.getElementById('preview-cognoms-val');
  const vis = cardDesignerConfig.visible_fields || {};
  if (cognomsWrap) {
    cognomsWrap.style.display = vis.cognoms !== false ? 'flex' : 'none';
  }
  if (cognomsEl) cognomsEl.textContent = s.cognoms || '—';

  const codiEl = document.getElementById('preview-codi-val');
  if (codiEl) codiEl.textContent = s.id || '300Z';

  const telWrap = document.getElementById('preview-field-telefon-wrap');
  const telEl = document.getElementById('preview-telefon-val');
  if (telWrap) {
    telWrap.style.display = vis.telefon && s.telefon ? 'flex' : 'none';
  }
  if (telEl) telEl.textContent = s.telefon || '';

  const saldoWrap = document.getElementById('preview-field-saldo-wrap');
  if (saldoWrap) {
    saldoWrap.style.display = vis.saldo ? 'flex' : 'none';
  }

  // Generar codi QR
  const qrMount = document.getElementById('preview-qr-mount');
  if (qrMount && typeof QREngine !== 'undefined') {
    QREngine.generateQR(qrMount, s.id || '300Z', 104);
  }
}

/* =======================================================
   EXPORTACIÓ VECTORIAL SVG I PNG D'ALTA RESOLUCIÓ (CR80)
   ======================================================= */
function downloadCardAsSVG(student, config) {
  const cfg = config || cardDesignerConfig || {};
  const s = student || { id: '300Z', nom: 'Zoey', cognoms: '' };
  const bg = cfg.background_color || '#b1ffc2';
  const text = cfg.text_color || '#801b1b';
  const brand = cfg.brand_name || 'Roig de Coure';
  const fontStyle = cfg.font_style || 'borel';
  const fontFam = fontStyle === 'modern' ? 'system-ui, -apple-system, sans-serif' : "'Borel', 'Buffalo', cursive";
  const showBowl = cfg.show_bowl_logo !== false;
  const showDivider = cfg.show_divider !== false;

  // Extreure QR com a imatge data URL del contenidor de previsualització
  let qrDataUrl = '';
  const qrImg = document.querySelector('#preview-qr-mount img, #badge-qr-container img');
  const qrCanvas = document.querySelector('#preview-qr-mount canvas, #badge-qr-container canvas');
  if (qrCanvas) {
    qrDataUrl = qrCanvas.toDataURL('image/png');
  } else if (qrImg && qrImg.src) {
    qrDataUrl = qrImg.src;
  }

  const bowlSvg = showBowl ? `
    <g transform="translate(845, 52)" fill="${text}">
      <path d="M 5 12 C 18 50, 50 56, 70 56 C 90 56, 122 50, 135 12 C 137 6, 128 6, 123 10 C 108 44, 88 48, 70 48 C 52 48, 32 44, 17 10 C 12 6, 3 6, 5 12 Z M 44 56 L 44 65 L 56 65 L 56 56 Z M 84 56 L 84 65 L 96 65 L 96 56 Z"/>
    </g>` : '';

  const dividerSvg = showDivider ? `
    <line x1="60" y1="435" x2="560" y2="435" stroke="${text}" stroke-width="2" stroke-dasharray="12, 8" opacity="0.65"/>` : '';

  const qrElement = qrDataUrl ? `
    <image x="695" y="255" width="230" height="230" href="${qrDataUrl}"/>` : `
    <rect x="710" y="270" width="200" height="200" fill="#000000" rx="8"/>
    <text x="810" y="380" fill="#ffffff" font-family="Roboto, sans-serif" font-size="20" text-anchor="middle">${s.id}</text>`;

  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1012 638" width="1012" height="638">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Borel&amp;family=Roboto:wght@400;500;700;900&amp;display=swap');
    </style>
  </defs>
  <rect x="0" y="0" width="1012" height="638" rx="28" ry="28" fill="${bg}" stroke="${text}" stroke-opacity="0.2" stroke-width="2"/>
  <text x="60" y="105" font-family="${fontFam}" font-size="46" font-weight="bold" fill="${text}">${brand}</text>
  ${bowlSvg}
  <g transform="translate(0, 40)">
    <text x="60" y="175" font-family="${fontFam}" font-size="30" fill="${text}">Nom:</text>
    <text x="60" y="230" font-family="Roboto, sans-serif" font-size="36" font-weight="500" fill="#1f1f1f">${s.nom || 'Zoey'}</text>
    <text x="60" y="300" font-family="${fontFam}" font-size="30" fill="${text}">Cognoms:</text>
    <text x="60" y="355" font-family="Roboto, sans-serif" font-size="36" font-weight="500" fill="#1f1f1f">${s.cognoms || '—'}</text>
    ${dividerSvg}
    <text x="60" y="450" font-family="${fontFam}" font-size="30" fill="${text}">Codi Alumne:</text>
    <text x="60" y="515" font-family="Roboto, sans-serif" font-size="44" font-weight="700" fill="${text}">${s.id || '300Z'}</text>
  </g>
  <rect x="680" y="240" width="260" height="260" rx="16" fill="#ffffff" stroke="${text}" stroke-width="2"/>
  ${qrElement}
</svg>`;

  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `carnet-${s.id || 'alumne'}.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadCardAsPNG(student, config) {
  const cfg = config || cardDesignerConfig || {};
  const s = student || { id: '300Z', nom: 'Zoey', cognoms: '' };
  const bg = cfg.background_color || '#b1ffc2';
  const text = cfg.text_color || '#801b1b';
  const brand = cfg.brand_name || 'Roig de Coure';
  const fontFam = cfg.font_style === 'modern' ? 'system-ui, sans-serif' : 'Borel, cursive';

  const canvas = document.createElement('canvas');
  canvas.width = 1012;
  canvas.height = 638;
  const ctx = canvas.getContext('2d');

  function drawRoundedRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  // Pintar fons
  drawRoundedRect(ctx, 4, 4, 1004, 630, 28);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = text;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Marca
  ctx.font = `bold 46px ${fontFam}`;
  ctx.fillStyle = text;
  ctx.fillText(brand, 60, 105);

  // Bol ceràmic a la cantonada
  if (cfg.show_bowl_logo !== false) {
    ctx.save();
    ctx.translate(845, 52);
    ctx.fillStyle = text;
    const p = new Path2D("M 5 12 C 18 50, 50 56, 70 56 C 90 56, 122 50, 135 12 C 137 6, 128 6, 123 10 C 108 44, 88 48, 70 48 C 52 48, 32 44, 17 10 C 12 6, 3 6, 5 12 Z M 44 56 L 44 65 L 56 65 L 56 56 Z M 84 56 L 84 65 L 96 65 L 96 56 Z");
    ctx.fill(p);
    ctx.restore();
  }

  // Camps
  ctx.font = `600 30px ${fontFam}`;
  ctx.fillStyle = text;
  ctx.fillText("Nom:", 60, 215);
  ctx.font = "500 36px Roboto, sans-serif";
  ctx.fillStyle = "#1f1f1f";
  ctx.fillText(s.nom || 'Zoey', 60, 270);

  ctx.font = `600 30px ${fontFam}`;
  ctx.fillStyle = text;
  ctx.fillText("Cognoms:", 60, 340);
  ctx.font = "500 36px Roboto, sans-serif";
  ctx.fillStyle = "#1f1f1f";
  ctx.fillText(s.cognoms || '—', 60, 395);

  if (cfg.show_divider !== false) {
    ctx.beginPath();
    ctx.setLineDash([12, 8]);
    ctx.strokeStyle = text;
    ctx.lineWidth = 2;
    ctx.moveTo(60, 435);
    ctx.lineTo(560, 435);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.font = `600 30px ${fontFam}`;
  ctx.fillStyle = text;
  ctx.fillText("Codi Alumne:", 60, 490);
  ctx.font = "700 44px Roboto, sans-serif";
  ctx.fillStyle = text;
  ctx.fillText(s.id || '300Z', 60, 555);

  // Marc del QR
  drawRoundedRect(ctx, 680, 240, 260, 260, 16);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = text;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Dibuixar QR des del canvas o imatge
  const qrCanvas = document.querySelector('#preview-qr-mount canvas, #badge-qr-container canvas');
  const qrImg = document.querySelector('#preview-qr-mount img, #badge-qr-container img');
  const finishDownload = () => {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `carnet-${s.id || 'alumne'}-cr80-300dpi.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  if (qrCanvas) {
    ctx.drawImage(qrCanvas, 695, 255, 230, 230);
    finishDownload();
  } else if (qrImg && qrImg.complete) {
    ctx.drawImage(qrImg, 695, 255, 230, 230);
    finishDownload();
  } else {
    finishDownload();
  }
}

if (typeof window !== 'undefined') {
  window.openStudentInlineDetail = openStudentInlineDetail;
  window.closeStudentInlineDetail = closeStudentInlineDetail;
  window.openStudentDrawer = openStudentDrawer;
}




