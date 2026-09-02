/**
 * alumne.js - Lògica del Portal de l'Alumne i Adquisició d'Hores
 */

let currentStudent = null;
let currentSelectedPack = null;
let liveSessionInterval = null;

document.addEventListener('DOMContentLoaded', async () => {
  await Store.init();
  await loadPortalConfig();
  checkUrlParamsOrSession();
  setupEventListeners();
});

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

// Carregar configuració del taller
async function loadPortalConfig() {
  try {
    const cfg = await Store.getConfig();
    if (cfg.taller_nom) {
      document.getElementById('student-workshop-name').textContent = cfg.taller_nom;
      const bWs = document.getElementById('portal-badge-ws-name');
      if (bWs) bWs.textContent = cfg.taller_nom;
    }
    if (cfg.taller_telefon) {
      const bPhone = document.getElementById('bizum-phone');
      if (bPhone) bPhone.textContent = cfg.taller_telefon;
    }
  } catch (err) {
    console.warn('Error configuració:', err);
  }
}

// Comprovar si hi ha paràmetres URL (ex: alumne.html?id=TC-101 o retorn de Stripe)
async function checkUrlParamsOrSession() {
  const params = new URLSearchParams(window.location.search);
  const idParam = params.get('id');
  const paymentStatus = params.get('payment');
  const packHours = params.get('pack');

  const savedId = sessionStorage.getItem('logged_student_id');
  const targetId = idParam || savedId;

  if (targetId) {
    await loginStudent(targetId);

    // Si retorna d'un pagament de Stripe amb èxit
    if (paymentStatus === 'success' && packHours && currentStudent) {
      await processSuccessfulPayment(parseFloat(packHours), 'Pack Stripe (Retorn)', 0, 'Stripe');
      // Netejar paràmetres de la URL
      window.history.replaceState({}, document.title, window.location.pathname + `?id=${currentStudent.alumne.id}`);
    }
  }
}

// Identificació de l'alumne
async function loginStudent(code) {
  try {
    const details = await Store.getAlumne(code);
    if (!details || !details.alumne) {
      showToast(`No s'ha trobat cap alumne amb el codi "${code}"`, 'error');
      return;
    }

    currentStudent = details;
    sessionStorage.setItem('logged_student_id', details.alumne.id);

    renderDashboard(details);

    document.getElementById('section-login').style.display = 'none';
    document.getElementById('section-dashboard').style.display = 'block';
  } catch (err) {
    showToast('Error iniciant sessió: ' + err.message, 'error');
  }
}

// Renderitzar panell de l'alumne
function renderDashboard(details) {
  const a = details.alumne;
  const bal = details.balanc;

  document.getElementById('portal-student-name').textContent = `Hola, ${a.nom}!`;
  document.getElementById('portal-student-id').textContent = a.id;
  document.getElementById('portal-student-alta').textContent = TimeUtils.formatDate(a.data_alta);

  document.getElementById('portal-balance-hms').textContent = bal.formatBalance;
  document.getElementById('portal-balance-human').textContent = `${bal.humanBalance} restants`;
  document.getElementById('portal-total-bought').textContent = bal.formatBought;
  document.getElementById('portal-total-spent').textContent = bal.formatSpent;

  // Estat al taller en viu
  const liveStatusEl = document.getElementById('portal-live-status');
  if (liveSessionInterval) clearInterval(liveSessionInterval);

  if (details.sessioActiva && details.sessioActiva.estat === 'oberta') {
    const entrada = details.sessioActiva.entrada;
    const updateLiveTimer = () => {
      const durSec = TimeUtils.calculateDuration(entrada, new Date());
      liveStatusEl.innerHTML = `
        <div style="background: #E8F5E9; border: 1px solid #C8E6C9; padding: 8px 14px; border-radius: 99px; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #2E7D32;">
          <span class="live-pulse"></span>
          <span>Al taller ara mateix (${TimeUtils.secondsToHms(durSec)})</span>
        </div>
      `;
    };
    updateLiveTimer();
    liveSessionInterval = setInterval(updateLiveTimer, 1000);
  } else {
    liveStatusEl.innerHTML = `
      <span class="badge badge-neutral">Fora del taller</span>
    `;
  }

  // Carnet digital
  document.getElementById('portal-badge-nom').textContent = a.nom;
  document.getElementById('portal-badge-cognoms').textContent = a.cognoms || '';
  document.getElementById('portal-badge-id').textContent = a.id;
  document.getElementById('portal-badge-tel').textContent = a.telefon ? `Tel: ${a.telefon}` : '';
  document.getElementById('portal-badge-footer-alta').textContent = `Alta: ${TimeUtils.formatDate(a.data_alta)}`;

  const qrContainer = document.getElementById('portal-badge-qr');
  QREngine.generateQR(qrContainer, a.id, 105);

  // Historial de sessions
  renderSessionsTable(details.sessions);

  // Historial de paquets
  renderPaquetsTable(details.paquets);
}

function renderSessionsTable(sessions) {
  const tbody = document.getElementById('portal-sessions-table-body');
  tbody.innerHTML = '';

  if (sessions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--color-muted); padding:16px;">Encara no s'ha registrat cap sessió.</td></tr>`;
    return;
  }

  sessions.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${TimeUtils.formatDate(s.data || s.entrada)}</td>
      <td>${TimeUtils.formatTime(s.entrada)}</td>
      <td>${s.sortida ? TimeUtils.formatTime(s.sortida) : '<span class="badge badge-success">En curs</span>'}</td>
      <td><strong>${s.format_hms || '00:00:00'}</strong></td>
      <td><span class="badge ${s.tipus === 'qr' ? 'badge-info' : 'badge-neutral'}">${s.tipus || 'qr'}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderPaquetsTable(paquets) {
  const tbody = document.getElementById('portal-paquets-table-body');
  tbody.innerHTML = '';

  if (paquets.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--color-muted); padding:16px;">Encara no hi ha cap compra d'hores.</td></tr>`;
    return;
  }

  paquets.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${TimeUtils.formatDate(p.data)}</td>
      <td><strong>${p.concepte || 'Pack Hores'}</strong></td>
      <td><span class="badge badge-success">+${p.hores}h (${TimeUtils.secondsToHms(p.segons)})</span></td>
      <td>${p.preu ? p.preu + '€' : '-'}</td>
      <td><span class="badge badge-neutral">${p.metode_pagament || 'Stripe'}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// Processar suma d'hores
async function processSuccessfulPayment(hores, concepte, preu, metode = 'Stripe') {
  if (!currentStudent) return;
  const studentId = currentStudent.alumne.id;

  try {
    const res = await Store.addPackage({
      studentId: studentId,
      hores: hores,
      concepte: concepte,
      preu: preu,
      metodePagament: metode,
      data: new Date().toISOString()
    });

    SoundEngine.playCheckin();
    showToast(`🎉 S'han sumat ${hores} hores al teu compte! Nou saldo: ${res.balanc.formatBalance}`, 'success');
    
    // Refrescar dades
    const updated = await Store.getAlumne(studentId);
    currentStudent = updated;
    renderDashboard(updated);
  } catch (err) {
    showToast('Error sumant les hores: ' + err.message, 'error');
  }
}

// Esdeveniments
function setupEventListeners() {
  // Login submit
  document.getElementById('form-student-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('login-student-id').value.trim();
    if (code) await loginStudent(code);
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    sessionStorage.removeItem('logged_student_id');
    currentStudent = null;
    if (liveSessionInterval) clearInterval(liveSessionInterval);
    document.getElementById('section-dashboard').style.display = 'none';
    document.getElementById('section-login').style.display = 'block';
  });

  // Botons de compra de pack
  document.querySelectorAll('.btn-buy-pack').forEach(btn => {
    btn.addEventListener('click', () => {
      const hours = parseFloat(btn.dataset.hours);
      const price = parseFloat(btn.dataset.price);
      const name = btn.dataset.name;
      openCheckoutModal({ hours, price, name });
    });
  });

  // Hores personalitzades
  document.getElementById('btn-custom-hours').addEventListener('click', () => {
    const customH = prompt('Quantes hores vols adquirir?', '8');
    if (customH) {
      const h = parseFloat(customH);
      if (!isNaN(h) && h > 0) {
        const estPrice = Math.round(h * 12);
        openCheckoutModal({ hours: h, price: estPrice, name: `Pack Personalitzat ${h} Hores` });
      }
    }
  });

  // Obrir modal de Checkout
  function openCheckoutModal(pack) {
    currentSelectedPack = pack;
    document.getElementById('checkout-pack-name').textContent = pack.name;
    document.getElementById('checkout-pack-price').textContent = `${pack.price}€`;
    document.getElementById('checkout-pack-hours').textContent = `+${pack.hours} Hores al teu compte`;

    // Concepte per a Bizum
    const a = currentStudent.alumne;
    const bizConcept = `${a.id} ${a.nom} ${pack.hours}h`;
    document.getElementById('bizum-concept').textContent = bizConcept;
    document.getElementById('bizum-instructions').style.display = 'none';

    document.getElementById('modal-checkout-backdrop').classList.add('active');
  }

  // Tancar Checkout
  document.getElementById('btn-close-checkout').addEventListener('click', () => {
    document.getElementById('modal-checkout-backdrop').classList.remove('active');
  });

  // Botó Pagar amb Stripe
  document.getElementById('btn-pay-stripe').addEventListener('click', async () => {
    if (!currentSelectedPack || !currentStudent) return;
    const cfg = await Store.getConfig();
    let stripeUrl = '';

    if (currentSelectedPack.hours === 5) stripeUrl = cfg.stripe_pack5_url;
    else if (currentSelectedPack.hours === 10) stripeUrl = cfg.stripe_pack10_url;
    else if (currentSelectedPack.hours === 20) stripeUrl = cfg.stripe_pack20_url;

    if (stripeUrl && stripeUrl.startsWith('http')) {
      // Afegir referència del client si és possible o obrir el link de Stripe
      const separator = stripeUrl.includes('?') ? '&' : '?';
      const redirectUrl = encodeURIComponent(`${window.location.origin}${window.location.pathname}?id=${currentStudent.alumne.id}&payment=success&pack=${currentSelectedPack.hours}`);
      window.open(`${stripeUrl}${separator}client_reference_id=${currentStudent.alumne.id}`, '_blank');
      document.getElementById('modal-checkout-backdrop').classList.remove('active');
      showToast('S\'ha obert la passarel·la segura de Stripe. Quan completis el pagament les hores se sumaran automàticament.', 'info');
    } else {
      // Si encara no han enganxat l'enllaç de Stripe a l'admin, oferim confirmació automàtica
      const confirmDirect = confirm(`L'enllaç de Stripe per a aquest pack no està configurat a l'Admin. Vols simular el pagament i sumar directament les ${currentSelectedPack.hours} hores al compte de ${currentStudent.alumne.nom}?`);
      if (confirmDirect) {
        document.getElementById('modal-checkout-backdrop').classList.remove('active');
        await processSuccessfulPayment(currentSelectedPack.hours, currentSelectedPack.name, currentSelectedPack.price, 'Stripe');
      }
    }
  });

  // Botó Bizum
  document.getElementById('btn-pay-bizum').addEventListener('click', () => {
    document.getElementById('bizum-instructions').style.display = 'block';
  });

  document.getElementById('btn-confirm-bizum').addEventListener('click', async () => {
    document.getElementById('modal-checkout-backdrop').classList.remove('active');
    await processSuccessfulPayment(currentSelectedPack.hours, currentSelectedPack.name, currentSelectedPack.price, 'Bizum');
  });

  // Botó simulació / suma immediata
  document.getElementById('btn-simulate-pay').addEventListener('click', async () => {
    document.getElementById('modal-checkout-backdrop').classList.remove('active');
    await processSuccessfulPayment(currentSelectedPack.hours, currentSelectedPack.name, currentSelectedPack.price, 'Pagament Immediat');
  });

  // Imprimir carnet
  document.getElementById('btn-portal-print-badge').addEventListener('click', () => {
    window.print();
  });
}
