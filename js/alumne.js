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

  const nom = (cfg.taller_nom && cfg.taller_nom !== 'Taller de Ceràmica' && cfg.taller_nom !== 'Taller de Ceramica') ? cfg.taller_nom : 'Roig de Coure';

  // Textos de marca (sense subtítol redundant)
  const loginTitle = document.getElementById('login-workshop-title');
  if (loginTitle) loginTitle.textContent = nom;

  const pwaTitle = document.getElementById('pwa-banner-title');
  if (pwaTitle) pwaTitle.textContent = `Baixa l'App de ${nom}`;

  const studentWs = document.getElementById('student-workshop-name');
  if (studentWs) studentWs.textContent = nom;

  // Colors personalitzats
  const primaryColor = (cfg.brand_primary && cfg.brand_primary !== '#831D1D') 
    ? cfg.brand_primary 
    : '#831D1D';
  document.documentElement.style.setProperty('--brand-primary', primaryColor);
  document.documentElement.style.setProperty('--color-primary', primaryColor);

  if (cfg.brand_secondary) {
    document.documentElement.style.setProperty('--brand-secondary', cfg.brand_secondary);
  }

  // Tipografia - Verdana per defecte oficial
  document.documentElement.style.setProperty('--brand-font', "Verdana, Geneva, Tahoma, sans-serif");

  // Logotip (amb comprovació de càrrega segura i gestió d'errors per no trencar la imatge)
  const rawLogo = (cfg.taller_logo_url || '').trim();
  const isValidLogo = rawLogo !== '' && !rawLogo.includes('PHN2Zz48L3N2Zz4=');

  const loginImg = document.getElementById('login-logo-img');
  const loginIcon = document.getElementById('login-logo-icon');
  const headImg = document.getElementById('portal-header-logo-img');
  const headIcon = document.getElementById('portal-header-logo-icon');

  if (isValidLogo) {
    if (loginImg) {
      loginImg.onerror = () => { loginImg.style.display = 'none'; };
      loginImg.onload = () => { loginImg.style.display = 'block'; };
      loginImg.src = rawLogo;
    }
    if (loginIcon) loginIcon.style.display = 'none';

    if (headImg) {
      headImg.onerror = () => { headImg.style.display = 'none'; };
      headImg.onload = () => { headImg.style.display = 'block'; };
      headImg.src = rawLogo;
    }
    if (headIcon) headIcon.style.display = 'none';
  } else {
    if (loginImg) { loginImg.src = ''; loginImg.style.display = 'none'; }
    if (loginIcon) loginIcon.style.display = 'none';
    if (headImg) { headImg.src = ''; headImg.style.display = 'none'; }
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

// Comprovar si hi ha paràmetres URL (ex: alumne.html?id=TC-101) o sessió guardada a localStorage
async function checkUrlParamsOrSession() {
  const params = new URLSearchParams(window.location.search);
  const idParam = params.get('id');
  const pinParam = params.get('pin');
  const paymentStatus = params.get('payment');
  const packHours = params.get('pack');

  const savedId = localStorage.getItem('logged_student_id') || sessionStorage.getItem('logged_student_id');
  const savedPin = localStorage.getItem('logged_student_pin') || sessionStorage.getItem('logged_student_pin');

  const targetId = idParam || savedId;
  const targetPin = pinParam || savedPin;

  // Si disposem d'identificador i PIN, intentem iniciar sessió automàticament
  if (targetId && targetPin) {
    const success = await loginStudent(targetId, targetPin, true);
    if (success) {
      // Si retorna d'un pagament de Stripe amb èxit (sempre a partir de 4h com a Stripe)
      const pendingHours = sessionStorage.getItem('pending_stripe_hours');
      const hoursToAdd = packHours ? parseFloat(packHours) : (pendingHours ? parseFloat(pendingHours) : null);
      if (paymentStatus === 'success' && hoursToAdd && hoursToAdd >= 4 && currentStudent) {
        sessionStorage.removeItem('pending_stripe_hours');
        await processSuccessfulPayment(hoursToAdd, `Adquisició ${hoursToAdd} Hores (Stripe)`, 0, 'Stripe');
        window.history.replaceState({}, document.title, window.location.pathname + `?id=${currentStudent.alumne.id}`);
      }
      return;
    }
  }

  // Si només disposem de l'identificador (ex: enllaç desat anteriorment)
  if (targetId) {
    const inputId = document.getElementById('login-student-id');
    if (inputId) inputId.value = targetId;
    const inputPwd = document.getElementById('login-student-password');
    if (inputPwd) inputPwd.focus();
  }
}

// Identificació de l'alumne amb nom/codi i contrasenya (PIN)
async function loginStudent(identifier, password, isAutoLogin = false) {
  const errBox = document.getElementById('login-error-msg');
  if (errBox) errBox.style.display = 'none';

  const cleanId = (identifier || '').trim();
  const cleanPin = (password || '').trim();

  if (!cleanId || !cleanPin) {
    if (!isAutoLogin) {
      const msg = 'Cal introduir tant el nom o codi d\'alumne com la contrasenya (PIN).';
      if (errBox) {
        errBox.textContent = msg;
        errBox.style.display = 'block';
      }
      showToast(msg, 'error');
    }
    return false;
  }

  const btnSubmit = document.getElementById('btn-submit-login');
  const originalBtnText = btnSubmit ? btnSubmit.textContent : '';
  if (btnSubmit && !isAutoLogin) {
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Verificant credencials...';
  }

  try {
    const res = await Store.loginAlumne(cleanId, cleanPin);

    if (!res.ok) {
      if (!isAutoLogin) {
        const errorText = res.error || 'Credencials incorrectes.';
        if (errBox) {
          errBox.textContent = errorText;
          errBox.style.display = 'block';
        }
        showToast(errorText, 'error');
      } else {
        localStorage.removeItem('logged_student_pin');
        sessionStorage.removeItem('logged_student_pin');
      }
      return false;
    }

    currentStudent = res;

    // Guardar a localStorage i sessionStorage per a persistència total
    localStorage.setItem('logged_student_id', res.alumne.id);
    sessionStorage.setItem('logged_student_id', res.alumne.id);
    localStorage.setItem('logged_student_pin', cleanPin);
    sessionStorage.setItem('logged_student_pin', cleanPin);

    renderDashboard(res);

    document.getElementById('section-login').style.display = 'none';
    document.getElementById('section-dashboard').style.display = 'block';

    const pwdInput = document.getElementById('login-student-password');
    if (pwdInput) pwdInput.value = '';

    return true;
  } catch (err) {
    if (!isAutoLogin) {
      const msg = 'Error iniciant sessió: ' + err.message;
      if (errBox) {
        errBox.textContent = msg;
        errBox.style.display = 'block';
      }
      showToast(msg, 'error');
    }
    return false;
  } finally {
    if (btnSubmit && !isAutoLogin) {
      btnSubmit.disabled = false;
      btnSubmit.textContent = originalBtnText;
    }
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

  // Actualitzar enllaços del Wallet i Carnet Digital
  const btnLinkPkpass = document.getElementById('btn-link-download-pkpass');
  if (btnLinkPkpass) {
    btnLinkPkpass.href = `/api/wallet/pass?id=${encodeURIComponent(a.id)}`;
  }
  const btnOpenCarnetWeb = document.getElementById('btn-open-carnet-web');
  if (btnOpenCarnetWeb) {
    btnOpenCarnetWeb.href = `carnet.html?id=${encodeURIComponent(a.id)}`;
  }
  const btnWalletModalCarnetLink = document.getElementById('btn-wallet-modal-carnet-link');
  if (btnWalletModalCarnetLink) {
    btnWalletModalCarnetLink.href = `carnet.html?id=${encodeURIComponent(a.id)}`;
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

// Gestió de Finestres Flotants (Modals)
function openModal(modal) {
  if (!modal) return;
  modal.style.removeProperty('display');
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal(modal) {
  if (!modal) return;
  modal.classList.remove('active');
  modal.style.removeProperty('display');
  if (!document.querySelector('.modal-backdrop.active')) {
    document.body.style.overflow = '';
  }
}

async function openReservarModal() {
  const modalReservar = document.getElementById('modal-reservar-sessio');
  if (!modalReservar) return;
  openModal(modalReservar);
  if (studentReservesCalendar) {
    await studentReservesCalendar.refresh();
  }
}

function openComprarModal() {
  const modalComprar = document.getElementById('modal-comprar-hores');
  if (!modalComprar) return;
  openModal(modalComprar);
}

async function loadStudentBookings(studentId) {
  const container = document.getElementById('portal-my-bookings-list');
  if (!container) return;

  try {
    const reserves = await Store.getReserves({ student_id: studentId, estat: 'confirmada' });
    const todayStr = new Date().toISOString().slice(0, 10);
    const upcoming = reserves.filter(r => r.data >= todayStr).sort((a, b) => a.data.localeCompare(b.data) || a.hora_inici.localeCompare(b.hora_inici));

    if (upcoming.length === 0) {
      container.innerHTML = `
        <div style="padding: 16px; text-align: center; background: #FAF8F5; border-radius: 8px; border: 1px dashed var(--color-border);">
          <p style="font-size: 13px; color: var(--color-muted); margin: 0 0 10px;">No tens cap reserva activa per als propers dies.</p>
          <button type="button" class="btn btn-outline btn-sm" id="btn-empty-open-reservar" style="color: var(--brand-secondary, #5E7E6F); border-color: var(--brand-secondary, #5E7E6F); font-weight: 700; font-size: 13px;">
            + Reservar la teva propera sessió
          </button>
        </div>
      `;
      document.getElementById('btn-empty-open-reservar')?.addEventListener('click', openReservarModal);
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

    // Determinar categoria per defecte segons la data de naixement / edat registrada
    let categoria = 'adults';
    let ageNum = null;
    if (a.data_naixement && typeof TimeUtils !== 'undefined' && typeof TimeUtils.calculateAge === 'function') {
      ageNum = TimeUtils.calculateAge(a.data_naixement);
    }
    if (ageNum === null && a.edat !== null && a.edat !== undefined && String(a.edat).trim() !== '') {
      const parsed = parseInt(a.edat, 10);
      if (!isNaN(parsed)) ageNum = parsed;
    }

    if (ageNum !== null) {
      categoria = ageNum <= edatTall ? 'infantil' : 'adults';
    }

    function updateCategoryUI(cat) {
      if (!titleEl || !descEl || !iconEl) return;
      const birthInfo = a.data_naixement ? `Data de naixement: ${TimeUtils.formatDate(a.data_naixement)} (${ageNum} anys). ` : (ageNum !== null ? `Edat: ${ageNum} anys. ` : '');
      if (cat === 'infantil') {
        iconEl.textContent = '';
        titleEl.textContent = `Tarifa Infantil (fins a ${edatTall} anys)`;
        descEl.textContent = birthInfo
          ? `${birthInfo}Redirigirà a l'article infantil de Stripe.`
          : `S'aplicarà la passarel·la per a alumnes de fins a ${edatTall} anys.`;
      } else {
        iconEl.textContent = '';
        titleEl.textContent = `Tarifa Adults (més de ${edatTall} anys)`;
        descEl.textContent = birthInfo
          ? `${birthInfo}Redirigirà a l'article d'adults de Stripe.`
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
    
    // Tancar modal de compra si estava obert
    const modalComprar = document.getElementById('modal-comprar-hores');
    if (modalComprar) closeModal(modalComprar);

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
  // Commutar visibilitat de la contrasenya (PIN)
  const btnTogglePwd = document.getElementById('btn-toggle-login-pwd');
  const inputPwd = document.getElementById('login-student-password');
  if (btnTogglePwd && inputPwd) {
    btnTogglePwd.addEventListener('click', () => {
      const isPwd = inputPwd.type === 'password';
      inputPwd.type = isPwd ? 'text' : 'password';
      btnTogglePwd.textContent = isPwd ? 'Ocultar' : 'Mostrar';
    });
  }

  // Formulari d'Accés d'Alumnes (Nom o Codi + Contrasenya)
  const formLogin = document.getElementById('form-student-login');
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('login-student-id').value.trim();
      const pwd = document.getElementById('login-student-password').value.trim();
      if (id && pwd) {
        await loginStudent(id, pwd, false);
      }
    });
  }

  // Tancar sessió (Logout net de credencials i estat)
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      localStorage.removeItem('logged_student_id');
      sessionStorage.removeItem('logged_student_id');
      localStorage.removeItem('logged_student_pin');
      sessionStorage.removeItem('logged_student_pin');
      currentStudent = null;
      if (liveSessionInterval) clearInterval(liveSessionInterval);
      document.getElementById('section-dashboard').style.display = 'none';
      document.getElementById('section-login').style.display = 'block';
      const pwdInput = document.getElementById('login-student-password');
      if (pwdInput) pwdInput.value = '';
    });
  }

  // Obertura i gestió del modal de Recuperació de Contrasenya / PIN
  const btnOpenRecovery = document.getElementById('btn-open-recovery');
  const modalRecovery = document.getElementById('modal-recuperar-pwd');
  const btnCloseRecovery = document.getElementById('btn-close-recovery-modal');

  if (btnOpenRecovery && modalRecovery) {
    btnOpenRecovery.addEventListener('click', () => {
      const typedId = (document.getElementById('login-student-id')?.value || '').trim();
      const recIdInput = document.getElementById('recovery-identifier');
      if (recIdInput && typedId) {
        recIdInput.value = typedId;
      }
      const errBox = document.getElementById('recovery-error-msg');
      if (errBox) errBox.style.display = 'none';
      const resBox = document.getElementById('recovery-result-box');
      if (resBox) resBox.style.display = 'none';
      const chgBox = document.getElementById('recovery-change-box');
      if (chgBox) chgBox.style.display = 'none';

      openModal(modalRecovery);
    });
  }

  if (btnCloseRecovery && modalRecovery) {
    btnCloseRecovery.addEventListener('click', () => closeModal(modalRecovery));
  }
  if (modalRecovery) {
    modalRecovery.addEventListener('click', (e) => {
      if (e.target === modalRecovery) closeModal(modalRecovery);
    });
  }

  // Submit recuperació (verificació d'identitat per telèfon o correu)
  const formRecovery = document.getElementById('form-recovery-verify');
  if (formRecovery) {
    formRecovery.addEventListener('submit', async (e) => {
      e.preventDefault();
      const identifier = document.getElementById('recovery-identifier').value.trim();
      const contact = document.getElementById('recovery-contact').value.trim();
      const errBox = document.getElementById('recovery-error-msg');
      const resBox = document.getElementById('recovery-result-box');
      const btnSubmit = document.getElementById('btn-submit-recovery');

      if (errBox) errBox.style.display = 'none';
      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.textContent = 'Verificant identitat...';
      }

      try {
        const res = await Store.recuperarPinAlumne(identifier, contact);
        if (!res.ok) {
          if (errBox) {
            errBox.textContent = res.error || 'No s\'han pogut verificar les dades.';
            errBox.style.display = 'block';
          }
          if (resBox) resBox.style.display = 'none';
          return;
        }

        // Èxit de verificació
        if (resBox) {
          const greetingEl = document.getElementById('recovery-result-greeting');
          if (greetingEl) greetingEl.textContent = `Identitat verificada: ${res.nom} (Codi ${res.id})`;
          const pinEl = document.getElementById('recovery-result-pin');
          if (pinEl) pinEl.textContent = res.pin;
          resBox.style.display = 'block';
        }

        // Botó per accedir ara directament amb el PIN recuperat
        const btnLoginNow = document.getElementById('btn-recovery-login-now');
        if (btnLoginNow) {
          btnLoginNow.onclick = async () => {
            closeModal(modalRecovery);
            document.getElementById('login-student-id').value = res.id;
            document.getElementById('login-student-password').value = res.pin;
            await loginStudent(res.id, res.pin, false);
          };
        }

        // Toggle per desplegar formulari d'assignació de nova contrasenya
        const btnToggleChg = document.getElementById('btn-recovery-toggle-change');
        const chgBox = document.getElementById('recovery-change-box');
        if (btnToggleChg && chgBox) {
          btnToggleChg.onclick = () => {
            chgBox.style.display = chgBox.style.display === 'none' ? 'block' : 'none';
          };
        }

        // Botó per desar nova contrasenya directament des de la recuperació
        const btnSaveNew = document.getElementById('btn-recovery-save-new-pin');
        if (btnSaveNew) {
          btnSaveNew.onclick = async () => {
            const newPin = (document.getElementById('recovery-new-pin-input')?.value || '').trim();
            if (!newPin || newPin.length < 4) {
              alert('La nova contrasenya ha de tenir com a mínim 4 caràcters.');
              return;
            }
            btnSaveNew.disabled = true;
            btnSaveNew.textContent = 'Guardant...';
            try {
              const chgRes = await Store.canviarPinAlumne(res.id, newPin);
              if (chgRes.ok) {
                showToast('Nova contrasenya desada amb èxit!', 'success');
                closeModal(modalRecovery);
                document.getElementById('login-student-id').value = res.id;
                document.getElementById('login-student-password').value = newPin;
                await loginStudent(res.id, newPin, false);
              } else {
                alert(chgRes.error || 'Error canviant la contrasenya');
              }
            } finally {
              btnSaveNew.disabled = false;
              btnSaveNew.textContent = 'Desar Nova Contrasenya i Accedir';
            }
          };
        }

      } catch (err) {
        if (errBox) {
          errBox.textContent = 'Error: ' + err.message;
          errBox.style.display = 'block';
        }
      } finally {
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.textContent = 'Verificar Identitat i Recuperar PIN';
        }
      }
    });
  }

  // Modal de Canvi de PIN dins del portal
  const btnPortalChangePin = document.getElementById('btn-portal-change-pin');
  const modalChangePin = document.getElementById('modal-canviar-pin');
  const btnCloseChangePin = document.getElementById('btn-close-change-pin-modal');

  if (btnPortalChangePin && modalChangePin) {
    btnPortalChangePin.addEventListener('click', () => {
      const errBox = document.getElementById('change-pin-error-msg');
      if (errBox) errBox.style.display = 'none';
      const form = document.getElementById('form-change-pin');
      if (form) form.reset();
      openModal(modalChangePin);
    });
  }

  if (btnCloseChangePin && modalChangePin) {
    btnCloseChangePin.addEventListener('click', () => closeModal(modalChangePin));
  }
  if (modalChangePin) {
    modalChangePin.addEventListener('click', (e) => {
      if (e.target === modalChangePin) closeModal(modalChangePin);
    });
  }

  const formChangePin = document.getElementById('form-change-pin');
  if (formChangePin) {
    formChangePin.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentStudent || !currentStudent.alumne) return;

      const currentPin = document.getElementById('input-current-pin').value.trim();
      const newPin = document.getElementById('input-new-pin').value.trim();
      const confirmPin = document.getElementById('input-confirm-pin').value.trim();
      const errBox = document.getElementById('change-pin-error-msg');
      const btnSubmit = document.getElementById('btn-submit-change-pin');

      if (errBox) errBox.style.display = 'none';

      if (newPin !== confirmPin) {
        if (errBox) {
          errBox.textContent = 'La nova contrasenya i la confirmació no coincideixen.';
          errBox.style.display = 'block';
        }
        return;
      }

      if (newPin.length < 4) {
        if (errBox) {
          errBox.textContent = 'La contrasenya ha de tenir un mínim de 4 caràcters.';
          errBox.style.display = 'block';
        }
        return;
      }

      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.textContent = 'Desant...';
      }

      try {
        const studentId = currentStudent.alumne.id;
        const res = await Store.canviarPinAlumne(studentId, newPin, currentPin);
        if (!res.ok) {
          if (errBox) {
            errBox.textContent = res.error || 'Error actualitzant la contrasenya.';
            errBox.style.display = 'block';
          }
          return;
        }

        // Actualitzar credencial guardada
        localStorage.setItem('logged_student_pin', newPin);
        sessionStorage.setItem('logged_student_pin', newPin);
        if (currentStudent.alumne) currentStudent.alumne.pin = newPin;

        closeModal(modalChangePin);
        showToast('Contrasenya (PIN) actualitzada amb èxit!', 'success');
      } catch (err) {
        if (errBox) {
          errBox.textContent = 'Error: ' + err.message;
          errBox.style.display = 'block';
        }
      } finally {
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.textContent = 'Desar Nova Contrasenya';
        }
      }
    });
  }

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
        showToast(`S'ha obert la passarel·la de Stripe per a ${catNom}.`, 'info');
      } else {
        const confirmSim = confirm(
          `L'enllaç de Stripe per a la categoria "${catNom}" no està configurat a l'Administració.\n\n` +
          `Vols simular el pagament d'hores de prova per a ${currentStudent.alumne.nom}?`
        );
        if (confirmSim) {
          const hStr = prompt('Quantes hores vols carregar de prova? (Mínim 4h)', '4');
          const h = parseFloat(hStr);
          if (!isNaN(h) && h >= 4) {
            await processSuccessfulPayment(h, `Adquisició ${h} Hores (${catNom})`, 0, 'Stripe (Simulació)');
          }
        }
      }
    });
  }

  // Desplegable i simulació Pagament de Prova
  const btnShowTestPay = document.getElementById('btn-portal-show-testpay');
  if (btnShowTestPay) {
    btnShowTestPay.addEventListener('click', () => {
      const box = document.getElementById('portal-testpay-box');
      if (box) {
        box.style.display = box.style.display === 'none' ? 'block' : 'none';
      }
    });
  }

  const btnConfirmTestPay = document.getElementById('btn-portal-confirm-testpay');
  if (btnConfirmTestPay) {
    btnConfirmTestPay.addEventListener('click', async () => {
      if (!currentStudent) return;
      const inputH = document.getElementById('testpay-input-hours');
      let hores = parseFloat(inputH ? inputH.value : 4);
      if (isNaN(hores) || hores < 4) hores = 4;
      btnConfirmTestPay.disabled = true;
      btnConfirmTestPay.textContent = 'Sumant hores...';
      try {
        await processSuccessfulPayment(hores, `Adquisició ${hores} Hores (Mode Prova)`, 0, 'Stripe (Test)');
        const box = document.getElementById('portal-testpay-box');
        if (box) box.style.display = 'none';
      } finally {
        btnConfirmTestPay.disabled = false;
        btnConfirmTestPay.textContent = 'Simular Pagament i Sumar Hores';
      }
    });
  }

  // Desplegable i confirmació Bizum (mínim 4h)
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
      const hStr = prompt(`Quantes hores has pagat per Bizum? (Mínim 4 hores)`, '4');
      if (hStr === null) return;
      const h = parseFloat(hStr);
      if (isNaN(h) || h < 4) {
        alert('La quantitat mínima permesa és de 4 hores (com a Stripe).');
        return;
      }
      const selectCat = document.getElementById('portal-select-categoria');
      const cat = selectCat ? selectCat.value : 'adults';
      await processSuccessfulPayment(h, `Pagament Bizum ${h} Hores (${cat})`, 0, 'Bizum');
      const box = document.getElementById('portal-bizum-box');
      if (box) box.style.display = 'none';
    });
  }

  // Finestres flotants (Modals): Comprar Hores & Reservar Sessió
  const btnOpenComprar = document.getElementById('btn-open-modal-comprar');
  const modalComprar = document.getElementById('modal-comprar-hores');
  const btnCloseComprar = document.getElementById('btn-close-modal-comprar');

  if (btnOpenComprar) {
    btnOpenComprar.addEventListener('click', openComprarModal);
  }
  if (btnCloseComprar && modalComprar) {
    btnCloseComprar.addEventListener('click', () => closeModal(modalComprar));
  }
  if (modalComprar) {
    modalComprar.addEventListener('click', (e) => {
      if (e.target === modalComprar) closeModal(modalComprar);
    });
  }

  const btnOpenReservar = document.getElementById('btn-open-modal-reservar');
  const btnSubOpenReservar = document.getElementById('btn-sub-open-reservar');
  const modalReservar = document.getElementById('modal-reservar-sessio');
  const btnCloseReservar = document.getElementById('btn-close-modal-reservar');

  if (btnOpenReservar) {
    btnOpenReservar.addEventListener('click', openReservarModal);
  }
  if (btnSubOpenReservar) {
    btnSubOpenReservar.addEventListener('click', openReservarModal);
  }
  if (btnCloseReservar && modalReservar) {
    btnCloseReservar.addEventListener('click', () => closeModal(modalReservar));
  }
  if (modalReservar) {
    modalReservar.addEventListener('click', (e) => {
      if (e.target === modalReservar) closeModal(modalReservar);
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
      if (!document.querySelector('.modal-backdrop.active')) {
        document.body.style.overflow = '';
      }
    };

    if (btnCloseQrZoom) btnCloseQrZoom.addEventListener('click', closeQrModal);
    if (btnCloseQrModal) btnCloseQrModal.addEventListener('click', closeQrModal);

    modalQrZoom.addEventListener('click', (e) => {
      if (e.target === modalQrZoom) closeQrModal();
    });
  }

  // Modal d'Opcions de Wallet i Rellotge
  const modalWalletOptions = document.getElementById('modal-wallet-options');
  const btnOpenWalletOptions = document.getElementById('btn-open-wallet-options');
  const btnPortalOpenWallet = document.getElementById('btn-portal-open-wallet');
  const btnCloseWalletOptions = document.getElementById('btn-close-wallet-options');
  const btnCloseWalletOptionsFooter = document.getElementById('btn-close-wallet-options-footer');

  const openWalletModal = () => {
    if (modalQrZoom && modalQrZoom.style.display === 'flex') {
      modalQrZoom.style.display = 'none';
    }
    const raw = currentStudent;
    const s = (raw && raw.alumne) ? raw.alumne : raw;
    if (s && s.id) {
      const btnLinkPkpass = document.getElementById('btn-link-download-pkpass');
      if (btnLinkPkpass) {
        btnLinkPkpass.href = `/api/wallet/pass?id=${encodeURIComponent(s.id)}`;
      }
      const btnCarnetWeb = document.getElementById('btn-wallet-modal-carnet-link');
      if (btnCarnetWeb) {
        btnCarnetWeb.href = `carnet.html?id=${encodeURIComponent(s.id)}`;
      }
    }
    if (modalWalletOptions) openModal(modalWalletOptions);
  };
  const closeWalletModal = () => {
    if (modalWalletOptions) closeModal(modalWalletOptions);
  };

  if (btnOpenWalletOptions) btnOpenWalletOptions.addEventListener('click', openWalletModal);
  if (btnPortalOpenWallet) btnPortalOpenWallet.addEventListener('click', openWalletModal);
  if (btnCloseWalletOptions) btnCloseWalletOptions.addEventListener('click', closeWalletModal);
  if (btnCloseWalletOptionsFooter) btnCloseWalletOptionsFooter.addEventListener('click', closeWalletModal);
  if (modalWalletOptions) {
    modalWalletOptions.addEventListener('click', (e) => {
      if (e.target === modalWalletOptions) closeWalletModal();
    });
  }

  // Botons de descàrrega QR per al Rellotge Intel·ligent
  const btnDownloadWatchQr = document.getElementById('btn-download-watch-qr');
  const btnWalletModalWatchQr = document.getElementById('btn-wallet-modal-watch-qr');
  const btnWalletModalWatchQrMatte = document.getElementById('btn-wallet-modal-watch-qr-matte');

  if (btnDownloadWatchQr) {
    btnDownloadWatchQr.addEventListener('click', () => downloadWatchQrImage(currentStudent, true));
  }
  if (btnWalletModalWatchQrMatte) {
    btnWalletModalWatchQrMatte.addEventListener('click', () => downloadWatchQrImage(currentStudent, true));
  }
  if (btnWalletModalWatchQr) {
    btnWalletModalWatchQr.addEventListener('click', () => downloadWatchQrImage(currentStudent, false));
  }

  // Google Wallet (Android)
  const btnWalletModalGoogleQr = document.getElementById('btn-wallet-modal-google-qr');
  if (btnWalletModalGoogleQr) {
    btnWalletModalGoogleQr.addEventListener('click', async () => {
      await downloadWatchQrImage(currentStudent, true);
      showToast("Imatge descarregada! A Google Wallet, toca '+ Afegeix a Wallet' > 'Foto' i tria la foto.", 'success');
    });
  }

  const btnOpenGoogleWalletApp = document.getElementById('btn-open-google-wallet-app');
  if (btnOpenGoogleWalletApp) {
    btnOpenGoogleWalletApp.addEventListener('click', () => {
      setTimeout(() => {
        window.open('https://wallet.google.com', '_blank');
      }, 600);
    });
  }

  // Tecla Escape per tancar qualsevol finestra flotant activa
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modalQrZoom && modalQrZoom.style.display === 'flex') {
        modalQrZoom.style.display = 'none';
      }
      if (modalWalletOptions) closeModal(modalWalletOptions);
      const activeModals = document.querySelectorAll('.modal-backdrop.active');
      activeModals.forEach(m => closeModal(m));
      document.body.style.overflow = '';
    }
  });
}

/**
 * Genera i descarrega una imatge d'alta definició (600x600 px) del codi QR
 * optimitzada exclusivament per a pantalles de rellotges intel·ligents (Pixel Watch, Apple Watch, Wear OS).
 *
 * @param {object} student Dades de l'alumne
 * @param {boolean} isMatte Si és true, genera la versió Ceràmic Mat antirreflex per a pantalles OLED
 */
async function downloadWatchQrImage(student, isMatte = true) {
  const raw = student || currentStudent;
  const s = (raw && raw.alumne) ? raw.alumne : raw;
  if (!s || !s.id) {
    showToast('No s\'ha pogut identificar l\'alumne/a.', 'error');
    return;
  }

  const id = s.id;
  const name = `${s.nom || ''} ${s.cognoms || ''}`.trim() || 'Alumne/a';

  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 600;
  const ctx = canvas.getContext('2d');

  function drawRoundRect(c, x, y, w, h, r) {
    if (c.roundRect) {
      c.beginPath();
      c.roundRect(x, y, w, h, r);
      c.fill();
    } else {
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
      c.fill();
    }
  }

  const tempContainer = document.createElement('div');
  tempContainer.style.display = 'none';
  document.body.appendChild(tempContainer);

  if (isMatte) {
    // 1. Fons fosc AMOLED: els píxels perimetrals estan apagats (0 nits)
    ctx.fillStyle = '#181514';
    ctx.fillRect(0, 0, 600, 600);

    // 2. Capçalera en to terracota càlid corporatiu
    ctx.fillStyle = '#D28C74';
    ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ROIG DE COURE', 300, 48);

    // 3. Targeta central mat ceràmica (porcellana càlida antirreflex #DDD7CE)
    ctx.fillStyle = '#DDD7CE';
    drawRoundRect(ctx, 75, 70, 450, 450, 24);

    // 4. QR amb mòduls negres purs sobre el to ceràmic mat
    const qrObj = new QRCode(tempContainer, {
      text: id,
      width: 390,
      height: 390,
      colorDark: '#000000',
      colorLight: '#DDD7CE',
      correctLevel: QRCode.CorrectLevel.M
    });

    setTimeout(async () => {
      const qrCanvas = tempContainer.querySelector('canvas');
      const qrImg = tempContainer.querySelector('img');
      const source = qrCanvas || qrImg;

      if (source) {
        ctx.drawImage(source, 105, 100, 390, 390);
      }
      document.body.removeChild(tempContainer);

      // 5. Peu d'alumne en to suau sobre fosc
      ctx.fillStyle = '#C8C1B6';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(`${id} • ${name}`, 300, 562);

      saveCanvasAsFile(canvas, `RoigDeCoure_${id}_Mat_Rellotge.png`, 'QR ceràmic mat desat correctament!');
    }, 150);

  } else {
    // Fons blanc clàssic
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 600, 600);

    ctx.fillStyle = '#831D1D';
    ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ROIG DE COURE', 300, 52);

    const qrObj = new QRCode(tempContainer, {
      text: id,
      width: 420,
      height: 420,
      colorDark: '#000000',
      colorLight: '#FFFFFF',
      correctLevel: QRCode.CorrectLevel.M
    });

    setTimeout(async () => {
      const qrCanvas = tempContainer.querySelector('canvas');
      const qrImg = tempContainer.querySelector('img');
      const source = qrCanvas || qrImg;

      if (source) {
        ctx.drawImage(source, 90, 85, 420, 420);
      }
      document.body.removeChild(tempContainer);

      ctx.fillStyle = '#2C221E';
      ctx.font = 'bold 22px monospace';
      ctx.fillText(`${id} • ${name}`, 300, 545);

      saveCanvasAsFile(canvas, `RoigDeCoure_${id}_Rellotge.png`, 'QR fons blanc desat correctament!');
    }, 150);
  }

  function saveCanvasAsFile(canvasEl, filename, successMsg) {
    canvasEl.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], filename, { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: `Carnet Rellotge - ${id}`,
            text: `Codi QR de Roig de Coure per al teu rellotge intel·ligent`,
            files: [file]
          });
          showToast(successMsg, 'success');
          return;
        } catch (err) {
          if (err.name !== 'AbortError') {
            console.warn('navigator.share no ha reeixit, usant descàrrega:', err);
          } else {
            return;
          }
        }
      }

      // Descàrrega directa
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast(successMsg, 'success');
    }, 'image/png');
  }
}

