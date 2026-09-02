/**
 * scanner.js - Lògica de l'Escàner Mòbil Android i Tauleta per al Taller de Ceràmica
 */

let deferredPrompt = null;
let currentFacingMode = 'environment'; // 'environment' (posterior) o 'user' (frontal)
let resultAutoCloseTimer = null;
let isProcessingScan = false;

document.addEventListener('DOMContentLoaded', async () => {
  await Store.init();
  await loadScannerConfig();
  await loadStudentSelector();
  setupPwaInstall();
  setupScannerEvents();
  startCamera();
});

// Carregar configuració
async function loadScannerConfig() {
  try {
    const cfg = await Store.getConfig();
    if (cfg.taller_nom) {
      document.getElementById('scanner-ws-name').textContent = cfg.taller_nom;
    }
  } catch (err) {
    console.warn('Error configuració:', err);
  }
}

// Iniciar càmera
async function startCamera() {
  const statusEl = document.getElementById('camera-status-text');
  statusEl.textContent = 'Iniciant càmera...';

  try {
    await QREngine.startScanner('qr-video-container', onQrScanned, onScanError);
    statusEl.textContent = 'Càmera activa • Enfoca el codi QR';
  } catch (err) {
    console.warn('Error iniciant càmera:', err);
    statusEl.textContent = '⚠️ Permís de càmera no concedit o dispositiu sense càmera';
  }
}

// Callback en escanejar un codi QR
async function onQrScanned(decodedText) {
  if (isProcessingScan) return;
  isProcessingScan = true;

  try {
    await processCheckInOut(decodedText);
  } catch (err) {
    console.error('Error processant codi QR:', err);
  } finally {
    // Petit retard per tornar a permetre escanejos
    setTimeout(() => {
      isProcessingScan = false;
    }, 1500);
  }
}

function onScanError(error) {
  // Errors comuns de cerca contínua ignorats
}

// Processar entrada o sortida
async function processCheckInOut(code) {
  try {
    const res = await Store.checkInOrOut(code);
    displayScanResult(res);
  } catch (err) {
    SoundEngine.playWarning();
    alert(err.message);
  }
}

// Mostrar modal gran de feedback
function displayScanResult(res) {
  const modal = document.getElementById('scan-result-modal');
  const box = document.getElementById('scan-result-box');

  const iconEl = document.getElementById('res-icon');
  const badgeEl = document.getElementById('res-badge');
  const nameEl = document.getElementById('res-student-name');
  const horaEntradaEl = document.getElementById('res-hora-entrada');
  const horaSortidaEl = document.getElementById('res-hora-sortida');
  const duradaEl = document.getElementById('res-durada-sessio');
  const saldoEl = document.getElementById('res-saldo-restant');

  const rowSortida = document.getElementById('row-sortida');
  const rowDurada = document.getElementById('row-durada');

  // Netejar classes
  box.classList.remove('is-entrada', 'is-sortida');

  nameEl.textContent = `${res.alumne.nom} ${res.alumne.cognoms || ''}`;
  horaEntradaEl.textContent = res.horaEntrada || '--:--:--';
  saldoEl.textContent = res.balanc ? res.balanc.formatBalance : '--:--:--';

  if (res.action === 'entrada') {
    // ENTRADA
    SoundEngine.playCheckin();
    box.classList.add('is-entrada');
    iconEl.textContent = '👋🏺';
    badgeEl.textContent = 'BENVINGUT/DA • ENTRADA';
    rowSortida.style.display = 'none';
    rowDurada.style.display = 'none';
  } else {
    // SORTIDA
    SoundEngine.playCheckout();
    box.classList.add('is-sortida');
    iconEl.textContent = '🎨✨';
    badgeEl.textContent = 'FINS AVIAT • SORTIDA';
    rowSortida.style.display = 'flex';
    rowDurada.style.display = 'flex';
    horaSortidaEl.textContent = res.horaSortida || '--:--:--';
    duradaEl.textContent = res.duradaHms || '00:00:00';
  }

  modal.classList.add('active');

  // Auto-tancar després de 4 segons perquè quedi a punt per al següent alumne
  if (resultAutoCloseTimer) clearTimeout(resultAutoCloseTimer);
  resultAutoCloseTimer = setTimeout(() => {
    modal.classList.remove('active');
  }, 4000);
}

// Carregar selector d'alumnes per a suport manual
async function loadStudentSelector() {
  try {
    const students = await Store.getAlumnes();
    const select = document.getElementById('select-student-quick');
    select.innerHTML = '<option value="">-- Selecciona un alumne --</option>';
    students.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.nom} ${s.cognoms || ''} (${s.id})`;
      select.appendChild(opt);
    });
  } catch (err) {
    console.warn('Error llistant alumnes:', err);
  }
}

// Esdeveniments
function setupScannerEvents() {
  // Tancar modal de resultat
  document.getElementById('btn-dismiss-result').addEventListener('click', () => {
    if (resultAutoCloseTimer) clearTimeout(resultAutoCloseTimer);
    document.getElementById('scan-result-modal').classList.remove('active');
  });
  document.getElementById('scan-result-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('scan-result-modal')) {
      if (resultAutoCloseTimer) clearTimeout(resultAutoCloseTimer);
      document.getElementById('scan-result-modal').classList.remove('active');
    }
  });

  // Alternar càmera (posterior/frontal)
  document.getElementById('btn-switch-camera').addEventListener('click', async () => {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    await QREngine.stopScanner();
    const config = { fps: 15, qrbox: { width: 260, height: 260 }, aspectRatio: 1.0 };
    await QREngine.html5QrScanner.start(
      { facingMode: currentFacingMode },
      config,
      onQrScanned,
      onScanError
    );
  });

  // Modal entrada manual
  const manualModal = document.getElementById('modal-manual-entry-backdrop');
  document.getElementById('btn-manual-entry').addEventListener('click', () => {
    document.getElementById('manual-code-input').value = '';
    document.getElementById('select-student-quick').value = '';
    manualModal.classList.add('active');
    setTimeout(() => document.getElementById('manual-code-input').focus(), 150);
  });

  document.getElementById('btn-close-manual-modal').addEventListener('click', () => {
    manualModal.classList.remove('active');
  });
  document.getElementById('btn-cancel-manual').addEventListener('click', () => {
    manualModal.classList.remove('active');
  });

  // Si selecciona alumne del desplegable, omple el camp
  document.getElementById('select-student-quick').addEventListener('change', (e) => {
    if (e.target.value) {
      document.getElementById('manual-code-input').value = e.target.value;
    }
  });

  // Submit entrada manual
  document.getElementById('form-manual-code').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('manual-code-input').value.trim();
    if (!code) return;
    manualModal.classList.remove('active');
    await processCheckInOut(code);
  });
}

// Suport PWA instal·lació a Android
function setupPwaInstall() {
  const installBtn = document.getElementById('btn-install-pwa');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.style.display = 'inline-flex';
  });

  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        installBtn.style.display = 'none';
      }
      deferredPrompt = null;
    }
  });

  window.addEventListener('appinstalled', () => {
    installBtn.style.display = 'none';
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.log(err));
  }
}
