/**
 * alumne.js - Lògica del Portal de l'Alumne, PWA i Adquisició d'Hores
 */

let currentStudent = null;
let currentSelectedPack = null;
let liveSessionInterval = null;
let deferredPrompt = null;

// Detecció iOS i Mode Standalone (App instal·lada)
const isIosDevice = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua);
};
const isInStandaloneMode = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return ('standalone' in window.navigator && window.navigator.standalone) || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
};

// Registre de Service Worker per a suport PWA i Offline
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker actiu per al Portal de l\'Alumne:', reg.scope))
      .catch(err => console.warn('Avis registrant Service Worker:', err));
  });
}

// Captura de l'esdeveniment d'instal·lació de PWA (Android / Chrome / Edge)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    
    // Mostrar banner només si no està ja en mode app i no l'ha tancat expressament
    if (!isInStandaloneMode() && typeof sessionStorage !== 'undefined' && sessionStorage.getItem('pwa_banner_dismissed') !== '1') {
      const banner = document.getElementById('pwa-install-banner');
      if (banner) banner.style.display = 'flex';
    }
  });

  // Quan l'app s'instal·la correctament
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.style.display = 'none';
    showToast('App instal·lada amb èxit a la teva pantalla d\'inici!', 'success');
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', async () => {
  await Store.init();
  await loadPortalConfig();
  await checkUrlParamsOrSession();
  setupEventListeners();

  // Si és iOS i no està en mode standalone, mostrar el banner d'instal·lació suau
  if (isIosDevice() && !isInStandaloneMode() && sessionStorage.getItem('pwa_banner_dismissed') !== '1') {
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.style.display = 'flex';
  }
  });
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Carregar configuració del taller i aplicar marca personalitzada
async function loadPortalConfig() {
  try {
    const cfg = await Store.getConfig();
    applyBrandingToPortal(cfg);

    if (cfg.taller_telefon) {
      const bPhone = document.getElementById('bizum-phone');
      if (bPhone) bPhone.textContent = cfg.taller_telefon;
    }
  } catch (err) {
    console.warn('Error carregant configuració del portal:', err);
  }
}

// Aplicar disseny i marca (colors, tipografia, nom i logo) dinàmicament
function applyBrandingToPortal(cfg) {
  if (!cfg) return;

  const nom = cfg.taller_nom || 'Roig de Coure';
  const subtitol = cfg.taller_subtitol || "Taller d'Art i Ceràmica";

  // Textos de marca
  const loginTitle = document.getElementById('login-workshop-title');
  if (loginTitle) loginTitle.textContent = nom;
  const loginSub = document.getElementById('login-workshop-subtitle');
  if (loginSub) loginSub.textContent = subtitol;

  const pwaTitle = document.getElementById('pwa-banner-title');
  if (pwaTitle) pwaTitle.textContent = `Baixa l'App de ${nom}`;

  const studentWs = document.getElementById('student-workshop-name');
  if (studentWs) studentWs.textContent = nom;
  const studentWsSub = document.getElementById('student-workshop-subtitle');
  if (studentWsSub) studentWsSub.textContent = subtitol;

  // Colors personalitzats
  const primaryColor = (cfg.brand_primary && cfg.brand_primary !== '#831D1D' && cfg.brand_primary !== '#831D1D') 
    ? cfg.brand_primary 
    : '#831D1D';
  document.documentElement.style.setProperty('--brand-primary', primaryColor);
  document.documentElement.style.setProperty('--color-primary', primaryColor);

  if (cfg.brand_secondary) {
    document.documentElement.style.setProperty('--brand-secondary', cfg.brand_secondary);
  }

  // Tipografia - Verdana per defecte oficial
  document.documentElement.style.setProperty('--brand-font', "Verdana, Geneva, Tahoma, sans-serif");

  // Logotip
  const logoUrl = cfg.taller_logo_url;
  if (logoUrl && logoUrl.trim() !== '') {
    // Login
    const loginImg = document.getElementById('login-logo-img');
    const loginIcon = document.getElementById('login-logo-icon');
    if (loginImg) { loginImg.src = logoUrl; loginImg.style.display = 'block'; }
    if (loginIcon) loginIcon.style.display = 'none';

    // Header Portal
    const headImg = document.getElementById('portal-header-logo-img');
    const headIcon = document.getElementById('portal-header-logo-icon');
    if (headImg) { headImg.src = logoUrl; headImg.style.display = 'block'; }
    if (headIcon) headIcon.style.display = 'none';
  }
}

// Funció per activar la instal·lació de l'App (Android prompt o modal iOS)
async function triggerPwaInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      console.log('Instal·lació PWA acceptada');
    }
    deferredPrompt = null;
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.style.display = 'none';
  } else if (isIosDevice()) {
    const modal = document.getElementById('modal-ios-install');
    if (modal) modal.style.display = 'flex';
  } else {
    showToast('Pots instal·lar l\'aplicació prement el menú del navegador (⋮ o Share) i triant "Afegeix a la pantalla d\'inici".', 'info');
  }
}

// Comprovar si hi ha paràmetres URL (ex: alumne.html?id=TC-101 o retorn de Stripe) o sessió guardada a localStorage
async function checkUrlParamsOrSession() {
  const params = new URLSearchParams(window.location.search);
  const idParam = params.get('id');
  const paymentStatus = params.get('payment');
  const packHours = params.get('pack');

  // Prioritat: Paràmetre URL > Sessió persistent a localStorage > sessionStorage antic
  const savedId = localStorage.getItem('logged_student_id') || sessionStorage.getItem('logged_student_id');
  const targetId = idParam || savedId;

  if (targetId) {
    await loginStudent(targetId);

    // Si retorna d'un pagament de Stripe amb èxit
    if (paymentStatus === 'success' && packHours && currentStudent) {
      await processSuccessfulPayment(parseFloat(packHours), 'Pack Stripe (Retorn)', 0, 'Stripe');
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
    // Guardar a localStorage per a persistència total a l'App mòbil
    localStorage.setItem('logged_student_id', details.alumne.id);
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
  const human = bal.humanBalance || (typeof TimeUtils !== 'undefined' && bal.balanceSeconds !== undefined ? TimeUtils.formatHmsHuman(bal.balanceSeconds) : '');
  const humanEl = document.getElementById('portal-balance-human');
  if (humanEl) {
    humanEl.textContent = human ? `${human} restants` : (bal.formatBalance ? `${bal.formatBalance} restants` : '');
  }
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
        <div style="background: #EEF5F1; border: 1px solid var(--color-border); padding: 8px 14px; border-radius: 99px; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #5E7E6F;">
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

  // Generar QR visible a dalt (compacte: 80px)
  const topQrContainer = document.getElementById('portal-top-qr');
  if (topQrContainer) {
    QREngine.generateQR(topQrContainer, a.id, 80);
  }

  // Preparar contingut del modal de zoom
  const zoomNameEl = document.getElementById('qr-zoom-student-name');
  if (zoomNameEl) zoomNameEl.textContent = `${a.nom} ${a.cognoms || ''}`.trim();
  const zoomIdEl = document.getElementById('qr-zoom-student-id');
  if (zoomIdEl) zoomIdEl.textContent = a.id;
  const zoomQrBox = document.getElementById('modal-qr-zoom-box');
  if (zoomQrBox) {
    QREngine.generateQR(zoomQrBox, a.id, 216);
  }

  // Historial de sessions
  renderSessionsTable(details.sessions);

  // Historial de paquets
  renderPaquetsTable(details.paquets);

  // Secció de Reserves i Aforament
  renderReservationsSection(a.id);

  // Secció d'adquisició d'hores segons edat
  setupStudentPurchaseSection(a);
}

let studentReservesCalendar = null;

async function renderReservationsSection(studentId) {
  const mount = document.getElementById('student-reserves-calendar-mount');
  if (!mount) return;

  if (!studentReservesCalendar) {
    studentReservesCalendar = new ReservesCalendar({
      containerId: 'student-reserves-calendar-mount',
      isAdmin: false,
      currentStudent: currentStudent,
      onBookingSuccess: async () => {
        await loadStudentBookings(studentId);
      }
    });
    await studentReservesCalendar.init();
  } else {
    studentReservesCalendar.setStudent(currentStudent);
    await studentReservesCalendar.refresh();
  }

  await loadStudentBookings(studentId);
}

async function loadStudentBookings(studentId) {
  const container = document.getElementById('portal-my-bookings-list');
  if (!container) return;

  try {
    const reserves = await Store.getReserves({ student_id: studentId, estat: 'confirmada' });
    const todayStr = new Date().toISOString().slice(0, 10);
    const upcoming = reserves.filter(r => r.data >= todayStr).sort((a, b) => a.data.localeCompare(b.data) || a.hora_inici.localeCompare(b.hora_inici));

    if (upcoming.length === 0) {
      container.innerHTML = `<p style="font-size: 13px; color: var(--color-muted);">No tens cap reserva activa per als propers dies.</p>`;
      return;
    }

    container.innerHTML = '';
    upcoming.forEach(r => {
      const item = document.createElement('div');
      item.className = 'booking-item-card';
      item.innerHTML = `
        <div>
          <div style="font-weight: 700; font-size: 14px; color: var(--color-dark);">
            ${TimeUtils.formatDate(r.data)} &bull; ${r.hora_inici} - ${r.hora_fi}
          </div>
          <div style="font-size: 12px; color: var(--color-muted); margin-top: 2px;">
            <strong style="color:var(--color-primary);">${r.activitat || 'Taller'}</strong> (${r.places || 1} persona${(r.places || 1) > 1 ? 'es' : ''}) &bull; Torn ${r.franja_nom || r.franja}
          </div>
        </div>
        <div>
          <button class="btn btn-outline btn-sm btn-cancel-student-res" data-res-id="${r.id}" style="color: var(--color-primary, #831D1D); border-color: var(--color-border, #E2EBE5); font-size: 12px; font-weight: 600;">
            Cancel·lar
          </button>
        </div>
      `;
      container.appendChild(item);
    });

    container.querySelectorAll('.btn-cancel-student-res').forEach(btn => {
      btn.addEventListener('click', async () => {
        const resId = btn.dataset.resId;
        const confirmCancel = confirm('Estàs segur que vols cancel·lar aquesta reserva? La teva plaça al taller quedarà lliure per a altres companys.');
        if (!confirmCancel) return;

        btn.disabled = true;
        btn.textContent = 'Cancel·lant...';
        const res = await Store.cancelarReserva(resId);
        if (res.ok) {
          showToast('Reserva cancel·lada correctament i plaça alliberada.', 'info');
          if (studentReservesCalendar) await studentReservesCalendar.refresh();
          await loadStudentBookings(studentId);
        } else {
          showToast(res.error || 'Error cancel·lant la reserva', 'error');
          btn.disabled = false;
          btn.textContent = 'Cancel·lar';
        }
      });
    });

  } catch (err) {
    container.innerHTML = `<p style="font-size: 13px; color: var(--color-danger);">Error carregant reserves: ${err.message}</p>`;
  }
}

async function setupStudentPurchaseSection(a) {
  try {
    const cfg = await Store.getConfig();
    const edatTall = parseInt(cfg.edat_tall_infantil, 10) || 12;
    const selectCat = document.getElementById('portal-select-categoria');
    const titleEl = document.getElementById('portal-edat-title');
    const descEl = document.getElementById('portal-edat-desc');
    const iconEl = document.getElementById('portal-edat-icon');
    const idEl = document.getElementById('portal-buy-student-id');
    const bizumConceptEl = document.getElementById('portal-bizum-concept');
    const bizumPhoneEl = document.getElementById('portal-bizum-phone');

    if (idEl) idEl.textContent = a.id;
    if (bizumConceptEl) bizumConceptEl.textContent = `${a.id} ${a.nom}`;
    if (bizumPhoneEl) bizumPhoneEl.textContent = cfg.taller_telefon || '+34 600 000 000';

    // Determinar categoria per defecte segons l'edat registrada a la base de dades (<= 12 infantil, > 12 adults)
    let categoria = 'adults';
    const hasEdat = a.edat !== null && a.edat !== undefined && String(a.edat).trim() !== '';
    if (hasEdat) {
      const edatNum = parseInt(a.edat, 10);
      if (!isNaN(edatNum)) {
        categoria = edatNum <= edatTall ? 'infantil' : 'adults';
      }
    }

    function updateCategoryUI(cat) {
      if (!titleEl || !descEl || !iconEl) return;
      if (cat === 'infantil') {
        iconEl.textContent = '';
        titleEl.textContent = `Tarifa Infantil (fins a ${edatTall} anys)`;
        descEl.textContent = hasEdat
          ? `Edat registrada: ${a.edat} anys. Redirigirà a l'article infantil de Stripe.`
          : `S'aplicarà la passarel·la per a alumnes de fins a ${edatTall} anys.`;
      } else {
        iconEl.textContent = '';
        titleEl.textContent = `Tarifa Adults (més de ${edatTall} anys)`;
        descEl.textContent = hasEdat
          ? `Edat registrada: ${a.edat} anys. Redirigirà a l'article d'adults de Stripe.`
          : `S'aplicarà la passarel·la d'adults (més de ${edatTall} anys).`;
      }
      if (selectCat) selectCat.value = cat;
    }

    updateCategoryUI(categoria);

    if (selectCat) {
      selectCat.onchange = (e) => {
        updateCategoryUI(e.target.value);
      };
    }
  } catch (err) {
    console.warn('Error configurant secció de compra:', err);
  }
}

function renderSessionsTable(sessions) {
  const tbody = document.getElementById('portal-sessions-table-body');
  tbody.innerHTML = '';

  if (!sessions || sessions.length === 0) {
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

  if (!paquets || paquets.length === 0) {
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
    showToast(`S'han sumat ${hores} hores al teu compte! Nou saldo: ${res.balanc.formatBalance}`, 'success');
    
    // Refrescar dades
    const updated = await Store.getAlumne(studentId);
    currentStudent = updated;
    renderDashboard(updated);
  } catch (err) {
    showToast('Error sumant les hores: ' + err.message, 'error');
  }
}

// Configuració d'Esdeveniments
function setupEventListeners() {
  // Login submit
  document.getElementById('form-student-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('login-student-id').value.trim();
    if (code) await loginStudent(code);
  });

  // Tancar sessió (Logout net)
  document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('logged_student_id');
    sessionStorage.removeItem('logged_student_id');
    currentStudent = null;
    if (liveSessionInterval) clearInterval(liveSessionInterval);
    document.getElementById('section-dashboard').style.display = 'none';
    document.getElementById('section-login').style.display = 'block';
  });

  // Botons d'instal·lació de PWA
  const btnInstallBanner = document.getElementById('btn-pwa-install-action');
  if (btnInstallBanner) {
    btnInstallBanner.addEventListener('click', triggerPwaInstall);
  }
  const btnDismissBanner = document.getElementById('btn-pwa-dismiss');
  if (btnDismissBanner) {
    btnDismissBanner.addEventListener('click', () => {
      const banner = document.getElementById('pwa-install-banner');
      if (banner) banner.style.display = 'none';
      sessionStorage.setItem('pwa_banner_dismissed', '1');
    });
  }
  const btnLoginInstall = document.getElementById('btn-login-install-prompt');
  if (btnLoginInstall) {
    btnLoginInstall.addEventListener('click', triggerPwaInstall);
  }
  const btnPortalInstall = document.getElementById('btn-portal-install-app');
  if (btnPortalInstall) {
    btnPortalInstall.addEventListener('click', triggerPwaInstall);
  }

  // Modals d'instruccions iOS
  const btnCloseIos = document.getElementById('btn-close-ios-modal');
  if (btnCloseIos) {
    btnCloseIos.addEventListener('click', () => {
      document.getElementById('modal-ios-install').style.display = 'none';
    });
  }
  const btnIosDone = document.getElementById('btn-ios-modal-done');
  if (btnIosDone) {
    btnIosDone.addEventListener('click', () => {
      document.getElementById('modal-ios-install').style.display = 'none';
    });
  }

  // Botó Compra directa amb Stripe segons Edat (>= 12 Adults, < 12 Infantil)
  const btnPortalBuyStripe = document.getElementById('btn-portal-buy-stripe');
  if (btnPortalBuyStripe) {
    btnPortalBuyStripe.addEventListener('click', async () => {
      if (!currentStudent) return;
      const cfg = await Store.getConfig();
      const edatTall = parseInt(cfg.edat_tall_infantil, 10) || 12;
      const selectCat = document.getElementById('portal-select-categoria');
      const categoria = selectCat ? selectCat.value : 'adults';

      let stripeUrl = '';
      let catNom = '';
      if (categoria === 'infantil') {
        stripeUrl = (cfg.stripe_url_infantil || '').trim();
        catNom = `Infantil (fins a ${edatTall} anys)`;
      } else {
        stripeUrl = (cfg.stripe_url_adults || '').trim();
        catNom = `Adults (més de ${edatTall} anys)`;
      }

      if (stripeUrl && stripeUrl.startsWith('http')) {
        const separator = stripeUrl.includes('?') ? '&' : '?';
        const finalUrl = `${stripeUrl}${separator}client_reference_id=${encodeURIComponent(currentStudent.alumne.id)}`;
        window.open(finalUrl, '_blank');
        showToast(`S'ha obert la passarel·la segura de Stripe per a ${catNom}.`, 'info');
      } else {
        const confirmSim = confirm(
          `L'enllaç de Stripe per a la categoria "${catNom}" no està configurat a l'Administració.\n\n` +
          `Vols simular el pagament d'hores de prova per a ${currentStudent.alumne.nom}?`
        );
        if (confirmSim) {
          const hStr = prompt('Quantes hores vols carregar de prova?', '5');
          const h = parseFloat(hStr);
          if (!isNaN(h) && h > 0) {
            await processSuccessfulPayment(h, `Adquisició Hores (${catNom})`, 0, 'Stripe (Simulació)');
          }
        }
      }
    });
  }

  // Desplegable i confirmació Bizum
  const btnPortalShowBizum = document.getElementById('btn-portal-show-bizum');
  if (btnPortalShowBizum) {
    btnPortalShowBizum.addEventListener('click', () => {
      const box = document.getElementById('portal-bizum-box');
      if (box) {
        box.style.display = box.style.display === 'none' ? 'block' : 'none';
      }
    });
  }

  const btnPortalConfirmBizum = document.getElementById('btn-portal-confirm-bizum');
  if (btnPortalConfirmBizum) {
    btnPortalConfirmBizum.addEventListener('click', async () => {
      if (!currentStudent) return;
      const hStr = prompt('Quantes hores has pagat per Bizum?', '5');
      const h = parseFloat(hStr);
      if (isNaN(h) || h <= 0) {
        alert('Si us plau, indica un nombre d\'hores vàlid.');
        return;
      }
      const selectCat = document.getElementById('portal-select-categoria');
      const cat = selectCat ? selectCat.value : 'adults';
      await processSuccessfulPayment(h, `Pagament Bizum (${cat})`, 0, 'Bizum');
      const box = document.getElementById('portal-bizum-box');
      if (box) box.style.display = 'none';
    });
  }

  // Tancar Checkout modal (si fos obert)
  const btnCloseCheckout = document.getElementById('btn-close-checkout');
  if (btnCloseCheckout) {
    btnCloseCheckout.addEventListener('click', () => {
      document.getElementById('modal-checkout-backdrop').classList.remove('active');
    });
  }

  // Modal de zoom del codi QR
  const btnOpenQrZoom = document.getElementById('btn-open-qr-zoom');
  const modalQrZoom = document.getElementById('modal-qr-zoom');
  const btnCloseQrZoom = document.getElementById('btn-close-qr-zoom');
  const btnCloseQrModal = document.getElementById('btn-close-qr-modal');

  if (btnOpenQrZoom && modalQrZoom) {
    btnOpenQrZoom.addEventListener('click', () => {
      modalQrZoom.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    });

    const closeQrModal = () => {
      modalQrZoom.style.display = 'none';
      document.body.style.overflow = '';
    };

    if (btnCloseQrZoom) btnCloseQrZoom.addEventListener('click', closeQrModal);
    if (btnCloseQrModal) btnCloseQrModal.addEventListener('click', closeQrModal);

    modalQrZoom.addEventListener('click', (e) => {
      if (e.target === modalQrZoom) closeQrModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalQrZoom.style.display === 'flex') {
        closeQrModal();
      }
    });
  }
}
