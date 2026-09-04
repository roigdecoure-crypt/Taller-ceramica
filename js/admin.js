/**
 * admin.js - Lògica del Panell d'Administració 360° per al Taller de Ceràmica
 */

let allStudents = [];
let currentViewingStudent = null;
let liveTimerInterval = null;

// Inicialització
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    startLiveClock();

    try {
      await Store.init();
    } catch (err) {
      console.warn('Store.init warning:', err);
    }

    loadConfig();
    await refreshStudentsList();
  });
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span> <span>${message}</span>`;
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
      document.getElementById('nav-workshop-name').textContent = cfg.taller_nom;
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
    if (cfg.brand_font === 'sans') {
      document.documentElement.style.setProperty('--brand-font', "'Inter', -apple-system, sans-serif");
    } else {
      document.documentElement.style.setProperty('--brand-font', "'Playfair Display', Georgia, serif");
    }
    const lblDefecte = document.getElementById('lbl-durada-defecte');
    if (lblDefecte) lblDefecte.textContent = cfg.hores_per_defecte_oblit || '01:30:00';
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
        <span class="live-timer-label">⏱️ Temps actual:</span>
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
          ⚠️ Oblit
        </button>
        <button class="btn btn-outline btn-sm btn-action-view" data-id="${s.id}">
          🔍
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
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--color-muted); padding:32px; font-size:15px;">ℹ️ No s'ha trobat cap alumne registrat o coincident amb la cerca.</td></tr>`;
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
    const edatLabel = s.edat !== null && s.edat !== undefined ? `<div style="font-size:11px; color:var(--color-muted);">${s.edat} anys (${s.edat >= 12 ? 'Adult' : 'Infantil'})</div>` : '';
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
        <button class="btn btn-outline btn-sm btn-action-view" data-id="${s.id}" title="Veure fitxa 360°">
          🔍 Fitxa
        </button>
        <button class="btn btn-outline btn-sm btn-action-carnet" data-id="${s.id}" title="Veure carnet amb QR">
          💳 Carnet
        </button>
        <button class="btn ${isActiu ? 'btn-primary' : 'btn-success'} btn-sm btn-action-toggle-sessio" data-id="${s.id}" data-action="${isActiu ? 'sortida' : 'entrada'}" title="${isActiu ? 'Registrar sortida ara mateix' : 'Registrar entrada ara mateix'}">
          ${isActiu ? '🔴 Sortida' : '🟢 Entrada'}
        </button>
        <button class="btn btn-outline btn-sm btn-action-open-manual-time" data-id="${s.id}" data-action="${isActiu ? 'sortida' : 'entrada'}" title="Ajustar hora d'entrada o sortida">
          ⏱️
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// OBRIR DRAWER FITXA 360°
async function openStudentDrawer(studentId) {
  try {
    const details = await Store.getAlumne(studentId);
    if (!details) return;

    currentViewingStudent = details;
    const a = details.alumne;
    const bal = details.balanc;

    document.getElementById('drawer-student-id').textContent = a.id;
    document.getElementById('drawer-student-fullname').textContent = `${a.nom} ${a.cognoms || ''}`;
    document.getElementById('drawer-balance-value').textContent = bal.formatBalance;
    document.getElementById('drawer-balance-human').textContent = bal.humanBalance;
    document.getElementById('drawer-total-bought').textContent = bal.formatBought;
    document.getElementById('drawer-total-spent').textContent = bal.formatSpent;

    const contactEl = document.getElementById('drawer-student-contact');
    const edatText = a.edat !== null && a.edat !== undefined ? ` | Edat: ${a.edat} anys (${a.edat >= 12 ? 'Adult' : 'Infantil'})` : '';
    contactEl.textContent = `Tel: ${a.telefon || '-'} | Email: ${a.email || '-'}${edatText}`;

    const waBtn = document.getElementById('drawer-btn-whatsapp');
    if (a.telefon) {
      const cleanPhone = a.telefon.replace(/\D/g, '');
      waBtn.href = `https://wa.me/34${cleanPhone}`;
      waBtn.style.display = 'inline-flex';
    } else {
      waBtn.style.display = 'none';
    }

    const sessBadge = document.getElementById('drawer-session-status-badge');
    if (details.sessioActiva) {
      sessBadge.innerHTML = `<span class="badge badge-success">Actiu des de les ${TimeUtils.formatTime(details.sessioActiva.entrada)}</span>`;
    } else {
      sessBadge.innerHTML = `<span class="badge badge-neutral">Sessió tancada</span>`;
    }

    document.getElementById('drawer-count-sessions').textContent = details.sessions.length;
    document.getElementById('drawer-count-paquets').textContent = details.paquets.length;

    renderDrawerSessions(details.sessions);
    renderDrawerPaquets(details.paquets);

    document.getElementById('student-drawer-backdrop').classList.add('active');
  } catch (err) {
    showToast('Error obrint la fitxa: ' + err.message, 'error');
  }
}

function renderDrawerSessions(sessions) {
  const tbody = document.getElementById('drawer-sessions-tbody');
  tbody.innerHTML = '';
  if (sessions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--color-muted); padding:16px;">Encara no hi ha cap sessió registrada.</td></tr>`;
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
        ${isForcada ? '<span class="badge badge-warning" title="Tancat per oblit">Oblit</span>' : ''}
      </td>
      <td>
        <button class="btn btn-outline btn-sm btn-delete-sessio" data-id="${s.id}" style="color:var(--color-danger);" title="Eliminar sessió">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderDrawerPaquets(paquets) {
  const tbody = document.getElementById('drawer-paquets-tbody');
  tbody.innerHTML = '';
  if (paquets.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--color-muted); padding:16px;">Encara no s'ha comprat cap paquet d'hores.</td></tr>`;
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
      <td>
        <button class="btn btn-outline btn-sm btn-delete-paquet" data-id="${p.id}" style="color:var(--color-danger);" title="Eliminar compra">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// MOSTRAR CARNET AMB QR
async function showStudentBadgeModal(studentId) {
  const student = allStudents.find(s => s.id === studentId);
  if (!student) return;

  const cfg = await Store.getConfig();
  document.getElementById('badge-ws-name').textContent = cfg.taller_nom || 'Roig de Coure';

  const logoUrl = cfg.taller_logo_url;
  const badgeLogoImg = document.getElementById('badge-ws-logo-img');
  const badgeLogoIcon = document.getElementById('badge-ws-logo-icon');
  if (logoUrl && logoUrl.trim() !== '') {
    if (badgeLogoImg) { badgeLogoImg.src = logoUrl; badgeLogoImg.style.display = 'inline-block'; }
    if (badgeLogoIcon) badgeLogoIcon.style.display = 'none';
  } else {
    if (badgeLogoImg) { badgeLogoImg.src = ''; badgeLogoImg.style.display = 'none'; }
    if (badgeLogoIcon) badgeLogoIcon.style.display = 'inline-block';
  }

  document.getElementById('badge-nom').textContent = student.nom;
  document.getElementById('badge-cognoms').textContent = student.cognoms || '';
  document.getElementById('badge-id').textContent = student.id;
  document.getElementById('badge-tel').textContent = student.telefon ? `Tel: ${student.telefon}` : '';
  document.getElementById('badge-data-alta').textContent = `Alta: ${TimeUtils.formatDate(student.data_alta)}`;

  // Generar QR
  const qrContainer = document.getElementById('badge-qr-container');
  QREngine.generateQR(qrContainer, student.id, 105);

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
      opt.textContent = `${s.nom} ${s.cognoms || ''} (${s.id}) ${isInside ? '🟢 [Al taller]' : '⚪ [Fora]'}`;
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

// SETUP D'ESDEVENIMENTS
function setupEventListeners() {
  initBrandStudio();
  initReservesAdmin();

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

    // Eliminar sessió des del drawer
    if (target.classList.contains('btn-delete-sessio')) {
      if (confirm('Segur que vols eliminar aquesta sessió?')) {
        const sessId = target.dataset.id;
        await Store.deleteSession(sessId);
        showToast('Sessió eliminada correctament', 'info');
        await refreshStudentsList();
        if (currentViewingStudent) openStudentDrawer(currentViewingStudent.alumne.id);
      }
    }

    // Eliminar paquet des del drawer
    if (target.classList.contains('btn-delete-paquet')) {
      if (confirm('Segur que vols eliminar aquesta compra de paquet?')) {
        const packId = target.dataset.id;
        await Store.deletePackage(packId);
        showToast('Paquet eliminat correctament', 'info');
        await refreshStudentsList();
        if (currentViewingStudent) openStudentDrawer(currentViewingStudent.alumne.id);
      }
    }
  });

  // Botons ràpids del Drawer
  document.getElementById('drawer-btn-carnet').addEventListener('click', () => {
    if (currentViewingStudent) showStudentBadgeModal(currentViewingStudent.alumne.id);
  });

  const btnCheckin = document.getElementById('drawer-btn-checkin');
  if (btnCheckin) {
    btnCheckin.addEventListener('click', () => {
      if (currentViewingStudent) openAdminManualCheckinModal(currentViewingStudent.alumne.id, 'entrada');
    });
  }

  const btnCheckout = document.getElementById('drawer-btn-checkout');
  if (btnCheckout) {
    btnCheckout.addEventListener('click', () => {
      if (currentViewingStudent) openAdminManualCheckinModal(currentViewingStudent.alumne.id, 'sortida');
    });
  }

  document.getElementById('drawer-btn-add-hours').addEventListener('click', () => {
    if (!currentViewingStudent) return;
    const a = currentViewingStudent.alumne;
    document.getElementById('paquet-form-student-id').value = a.id;
    document.getElementById('paquet-form-student-name').value = `${a.nom} ${a.cognoms || ''} (${a.id})`;
    document.getElementById('paquet-form-hores').value = 10;
    document.getElementById('paquet-form-concepte').value = 'Pack 10 Hores';
    document.getElementById('paquet-form-preu').value = 120;
    document.getElementById('paquet-form-data').value = TimeUtils.toLocalDatetimeInput();
    document.getElementById('modal-paquet-backdrop').classList.add('active');
  });

  document.getElementById('drawer-btn-add-manual-session').addEventListener('click', () => {
    if (!currentViewingStudent) return;
    const a = currentViewingStudent.alumne;
    document.getElementById('manual-sessio-id').value = '';
    document.getElementById('manual-sessio-student-id').value = a.id;
    document.getElementById('manual-sessio-student-name').value = `${a.nom} ${a.cognoms || ''} (${a.id})`;

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    document.getElementById('manual-sessio-entrada').value = TimeUtils.toLocalDatetimeInput(oneHourAgo);
    document.getElementById('manual-sessio-sortida').value = TimeUtils.toLocalDatetimeInput(now);
    document.getElementById('manual-sessio-preview').textContent = '01:00:00';
    document.getElementById('modal-manual-sessio-backdrop').classList.add('active');
  });

  document.getElementById('drawer-btn-edit-student').addEventListener('click', () => {
    if (!currentViewingStudent) return;
    const a = currentViewingStudent.alumne;
    document.getElementById('modal-alumne-title').textContent = 'Editar Alumne';
    document.getElementById('alumne-form-id').value = a.id;
    document.getElementById('alumne-form-nom').value = a.nom;
    document.getElementById('alumne-form-cognoms').value = a.cognoms || '';
    document.getElementById('alumne-form-telefon').value = a.telefon || '';
    document.getElementById('alumne-form-email').value = a.email || '';
    document.getElementById('alumne-form-pin').value = a.pin || '';
    document.getElementById('alumne-form-notes').value = a.notes || '';
    document.getElementById('alumne-form-edat').value = (a.edat !== null && a.edat !== undefined) ? a.edat : '';
    document.getElementById('modal-alumne-backdrop').classList.add('active');
  });

  // Pestanyes del Drawer
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const targetTab = btn.dataset.tab;
      document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
      document.getElementById(targetTab).style.display = 'block';
    });
  });

  // Modal Nou Alumne (Des de dalt)
  document.getElementById('btn-nou-alumne').addEventListener('click', () => {
    document.getElementById('modal-alumne-title').textContent = 'Donar d\'Alta Nou Alumne';
    document.getElementById('form-alumne').reset();
    document.getElementById('alumne-form-id').value = '';
    document.getElementById('alumne-form-edat').value = '';
    document.getElementById('modal-alumne-backdrop').classList.add('active');
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

  // Formulari Alumne Submit
  document.getElementById('form-alumne').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      id: document.getElementById('alumne-form-id').value,
      nom: document.getElementById('alumne-form-nom').value,
      cognoms: document.getElementById('alumne-form-cognoms').value,
      telefon: document.getElementById('alumne-form-telefon').value,
      email: document.getElementById('alumne-form-email').value,
      pin: document.getElementById('alumne-form-pin').value,
      notes: document.getElementById('alumne-form-notes').value,
      edat: document.getElementById('alumne-form-edat').value ? parseInt(document.getElementById('alumne-form-edat').value, 10) : null
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

  // Botons de packs ràpids
  document.querySelectorAll('.quick-pack-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('paquet-form-hores').value = btn.dataset.hours;
      document.getElementById('paquet-form-preu').value = btn.dataset.price;
      document.getElementById('paquet-form-concepte').value = btn.dataset.name;
    });
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
    const notes = document.getElementById('manual-sessio-notes').value;

    try {
      const res = await Store.saveManualSession({ id: sessId, studentId, entrada, sortida, notes });
      showToast(res.message, 'success');
      document.getElementById('modal-manual-sessio-backdrop').classList.remove('active');
      await refreshStudentsList();
      if (currentViewingStudent) openStudentDrawer(studentId);
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
  document.getElementById('btn-configuracio').addEventListener('click', async () => {
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
      const calName = (cfg.google_calendar_name && cfg.google_calendar_name !== 'Roig de Coure') ? cfg.google_calendar_name : 'roigdecoure';
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
  });

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
      google_calendar_name: document.getElementById('cfg-calendar-name') ? document.getElementById('cfg-calendar-name').value.trim() : 'roigdecoure',
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
      statusDiv.style.color = '#1E40AF';
      statusDiv.textContent = '⏳ Enviant missatge de prova a Meta Graph API...';
    }
    try {
      const res = await Store.testWhatsAppMeta(tel, tpl);
      if (res.ok) {
        if (statusDiv) {
          statusDiv.style.color = '#16A34A';
          statusDiv.textContent = '✅ Missatge enviat correctament! Revisa el teu WhatsApp.';
        }
        showToast('WhatsApp de prova enviat amb èxit!', 'success');
      } else {
        if (statusDiv) {
          statusDiv.style.color = '#DC2626';
          statusDiv.textContent = '❌ Error: ' + (res.error || 'No s\'ha pogut enviar');
        }
        showToast('Error: ' + (res.error || 'No s\'ha pogut enviar'), 'error');
      }
    } catch (e) {
      if (statusDiv) {
        statusDiv.style.color = '#DC2626';
        statusDiv.textContent = '❌ Error: ' + e.message;
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
      showToast('⏳ Connectant amb Google Sheets i descarregant dades...', 'info');
      const res = await Store.hydrateFromGoogleSheets();
      showToast(res.message || 'Hidratació completada amb èxit!', 'success');
      await refreshStudentsList();
    } catch (err) {
      showToast('⚠️ Error en la hidratació: ' + err.message, 'error');
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
  document.getElementById('btn-exportar').addEventListener('click', () => {
    document.getElementById('modal-backup-backdrop').classList.add('active');
  });

  document.getElementById('btn-download-json').addEventListener('click', () => {
    Store.exportBackupJson();
    showToast('Còpia de seguretat descarregada!', 'success');
  });

  document.getElementById('input-restore-json').addEventListener('change', async (e) => {
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
  document.getElementById('btn-print-card').addEventListener('click', () => {
    window.print();
  });

  document.getElementById('btn-copy-card-link').addEventListener('click', () => {
    const studentId = document.getElementById('badge-id').textContent;
    const url = `${window.location.origin}${window.location.pathname.replace('admin.html', 'alumne.html')}?id=${studentId}`;
    navigator.clipboard.writeText(url).then(() => {
      showToast('Enllaç directe de l\'alumne copiat al porta-retalls!', 'success');
    }).catch(() => {
      showToast('URL: ' + url, 'info');
    });
  });
}

/* ==================== ESTUDI DE DISSENY & MARCA ==================== */

let previewQrGenerated = false;

function initBrandStudio() {
  const btnBranding = document.getElementById('btn-branding');
  const modalBranding = document.getElementById('modal-branding-backdrop');
  if (!btnBranding || !modalBranding) return;

  btnBranding.addEventListener('click', async () => {
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

  // Pujada de logotip oficial (FileReader -> Base64)
  const logoFileInput = document.getElementById('brand-input-logo-file');
  const logoUrlHidden = document.getElementById('brand-input-logo-url');
  const btnRemoveLogo = document.getElementById('btn-remove-logo');

  if (logoFileInput) {
    logoFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (file.size > 2 * 1024 * 1024) {
        alert('La imatge supera els 2MB. Si us plau, tria una imatge més lleugera.');
        logoFileInput.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = (loadEvt) => {
        const base64 = loadEvt.target.result;
        if (logoUrlHidden) logoUrlHidden.value = base64;
        setLogoPreview(base64);
        updateBrandPreview();
      };
      reader.readAsDataURL(file);
    });
  }

  if (btnRemoveLogo) {
    btnRemoveLogo.addEventListener('click', () => {
      if (logoUrlHidden) logoUrlHidden.value = '';
      if (logoFileInput) logoFileInput.value = '';
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
      const sub = subInput ? subInput.value.trim() : "Taller d'Art i Ceràmica";
      const prim = primaryHexInput ? primaryHexInput.value.trim() : '#C25E3A';
      const sec = secondaryHexInput ? secondaryHexInput.value.trim() : '#5E7E6F';
      const fontChoice = document.querySelector('input[name="brand_font_choice"]:checked')?.value || 'serif';
      const logoUrl = logoUrlHidden ? logoUrlHidden.value : '';

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

        // Actualitzar variables CSS globals a l'admin
        document.documentElement.style.setProperty('--brand-primary', prim);
        document.documentElement.style.setProperty('--color-primary', prim);
        document.documentElement.style.setProperty('--brand-secondary', sec);

        modalBranding.classList.remove('active');
        showToast('🎨 Imatge de marca actualitzada i sincronitzada amb èxit!', 'success');
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
    const sub = cfg.taller_subtitol || "Taller d'Art i Ceràmica";
    const prim = cfg.brand_primary || '#C25E3A';
    const sec = cfg.brand_secondary || '#5E7E6F';
    const font = cfg.brand_font || 'serif';
    const logoUrl = cfg.taller_logo_url || '';

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

    const logoHidden = document.getElementById('brand-input-logo-url');
    if (logoHidden) logoHidden.value = logoUrl;
    const logoFile = document.getElementById('brand-input-logo-file');
    if (logoFile) logoFile.value = '';
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

  if (url && url.trim() !== '') {
    if (previewImg) { previewImg.src = url; previewImg.style.display = 'block'; }
    if (previewPlaceholder) previewPlaceholder.style.display = 'none';
    if (btnRemove) btnRemove.style.display = 'inline-block';
  } else {
    if (previewImg) { previewImg.src = ''; previewImg.style.display = 'none'; }
    if (previewPlaceholder) previewPlaceholder.style.display = 'block';
    if (btnRemove) btnRemove.style.display = 'none';
  }
}

function updateBrandPreview() {
  const nom = document.getElementById('brand-input-nom')?.value.trim() || 'Roig de Coure';
  const sub = document.getElementById('brand-input-subtitol')?.value.trim() || "Taller d'Art i Ceràmica";
  const prim = document.getElementById('brand-input-primary-hex')?.value.trim() || '#C25E3A';
  const sec = document.getElementById('brand-input-secondary-hex')?.value.trim() || '#5E7E6F';
  const fontChoice = document.querySelector('input[name="brand_font_choice"]:checked')?.value || 'serif';
  const logoUrl = document.getElementById('brand-input-logo-url')?.value || '';

  // Textos
  const prevHdrTitle = document.getElementById('preview-header-title');
  if (prevHdrTitle) prevHdrTitle.textContent = nom;
  const prevHdrSub = document.getElementById('preview-header-sub');
  if (prevHdrSub) prevHdrSub.textContent = sub;
  const prevBadgeTitle = document.getElementById('preview-badge-title');
  if (prevBadgeTitle) prevBadgeTitle.textContent = nom;

  // Logotip
  const prevHdrImg = document.getElementById('preview-header-logo-img');
  const prevHdrIcon = document.getElementById('preview-header-logo-icon');
  const prevBadgeImg = document.getElementById('preview-badge-logo-img');
  const prevBadgeIcon = document.getElementById('preview-badge-logo-icon');

  if (logoUrl && logoUrl.trim() !== '') {
    if (prevHdrImg) { prevHdrImg.src = logoUrl; prevHdrImg.style.display = 'block'; }
    if (prevHdrIcon) prevHdrIcon.style.display = 'none';
    if (prevBadgeImg) { prevBadgeImg.src = logoUrl; prevBadgeImg.style.display = 'inline-block'; }
    if (prevBadgeIcon) prevBadgeIcon.style.display = 'none';
  } else {
    if (prevHdrImg) { prevHdrImg.src = ''; prevHdrImg.style.display = 'none'; }
    if (prevHdrIcon) prevHdrIcon.style.display = 'inline-block';
    if (prevBadgeImg) { prevBadgeImg.src = ''; prevBadgeImg.style.display = 'none'; }
    if (prevBadgeIcon) prevBadgeIcon.style.display = 'inline-block';
  }

  // Colors al Mockup
  const badgeTop = document.getElementById('preview-badge-top');
  if (badgeTop) {
    badgeTop.style.background = `linear-gradient(135deg, ${prim} 0%, ${sec} 100%)`;
  }
  const balanceCard = document.getElementById('preview-balance-card');
  if (balanceCard) {
    balanceCard.style.background = `linear-gradient(135deg, ${prim} 0%, #2E2825 100%)`;
  }
  const btnSample = document.getElementById('preview-btn-sample');
  if (btnSample) {
    btnSample.style.background = prim;
  }

  // Tipografia al Carnet
  const badgeCard = document.getElementById('preview-ceramic-badge');
  if (badgeCard) {
    if (fontChoice === 'sans') {
      badgeCard.style.fontFamily = "'Inter', -apple-system, sans-serif";
    } else {
      badgeCard.style.fontFamily = "'Playfair Display', Georgia, serif";
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
  const btnOpen = document.getElementById('btn-reserves-admin');
  const modal = document.getElementById('modal-reserves-backdrop');
  if (!btnOpen || !modal) return;

  btnOpen.addEventListener('click', () => {
    openReservesModal();
  });

  document.getElementById('btn-close-modal-reserves')?.addEventListener('click', () => {
    modal.classList.remove('active');
  });
  document.getElementById('btn-close-modal-reserves-footer')?.addEventListener('click', () => {
    modal.classList.remove('active');
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
    } catch (err) {
      showToast('Error desant capacitats d\'activitats: ' + err.message, 'error');
    }
  });
}

async function openReservesModal() {
  const modal = document.getElementById('modal-reserves-backdrop');
  if (!modal) return;
  modal.classList.add('active');

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
      onBookingSuccess: async () => {
        showToast('Reserva confirmada i sincronitzada.', 'success');
      }
    });
    await adminReservesCalendar.init();
  } else {
    adminReservesCalendar.setAllStudents(allStudents);
    await adminReservesCalendar.refresh();
  }
}

if (typeof window !== 'undefined') {
  window.openReservesModal = openReservesModal;
  window.loadAdminDisponibilitat = loadAdminDisponibilitat;
}



