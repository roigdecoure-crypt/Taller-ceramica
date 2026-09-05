/**
 * scanner.js - Lògica de l'Escàner Mòbil Android i Tauleta per al Taller de Ceràmica
 */

let deferredPrompt = null;
let currentFacingMode = localStorage.getItem('scanner_preferred_camera') || 'user'; // 'user' (frontal per defecte) o 'environment' o deviceId
let resultAutoCloseTimer = null;
let isProcessingScan = false;

document.addEventListener('DOMContentLoaded', async () => {
  await Store.init();
  await loadScannerConfig();
  await loadStudentSelector();
  setupPwaInstall();
  setupScannerEvents();
  startCamera(currentFacingMode);
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
async function startCamera(cameraModeOrId = 'user') {
  currentFacingMode = cameraModeOrId;
  localStorage.setItem('scanner_preferred_camera', currentFacingMode);

  const statusEl = document.getElementById('camera-status-text');
  const errorContainer = document.getElementById('camera-error-container');
  const container = document.getElementById('qr-video-container');

  const isFront = currentFacingMode === 'user' || currentFacingMode.toLowerCase().includes('front') || currentFacingMode.toLowerCase().includes('selfie');
  statusEl.textContent = `Iniciant càmera ${isFront ? 'frontal' : 'posterior'}...`;

  if (isFront) {
    container.classList.add('mirror-camera');
  } else {
    container.classList.remove('mirror-camera');
  }

  try {
    errorContainer.style.display = 'none';
    await QREngine.startScanner('qr-video-container', onQrScanned, onScanError, currentFacingMode);
    statusEl.textContent = `Càmera ${isFront ? 'frontal' : 'posterior'} activa • Enfoca el codi QR`;
    
    // Un cop la càmera és activa, poblem el desplegable amb totes les càmeres detectades
    await populateCameraDropdown();
  } catch (err) {
    console.error('Error iniciant càmera:', err);
    statusEl.textContent = 'Càmera desactivada o sense permís';
    errorContainer.style.display = 'block';
    document.getElementById('camera-error-message').textContent = 
      `No s'ha pogut obrir la càmera (${err.message || err}). Prem el botó per activar-la o tria una altra càmera a dalt.`;
  }
}

// Poblar el desplegable de càmeres reals del dispositiu
async function populateCameraDropdown() {
  const select = document.getElementById('select-camera-device');
  if (!select) return;

  try {
    const devices = await QREngine.getCameras();
    if (devices && devices.length > 0) {
      select.innerHTML = '';
      devices.forEach((dev, idx) => {
        const opt = document.createElement('option');
        opt.value = dev.id;
        
        let label = dev.label || `Càmera ${idx + 1}`;
        if (/front|user|anterior|delantera|selfie/i.test(label)) {
          label = `Frontal (${label})`;
        } else if (/back|rear|trasera|posterior|environment/i.test(label)) {
          label = `Posterior (${label})`;
        }
        
        opt.textContent = label;
        if (currentFacingMode === dev.id || (currentFacingMode === 'user' && /front|user|anterior|selfie/i.test(dev.label))) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });
    }
  } catch (e) {
    console.warn('Error omplint desplegable de càmeres:', e);
  }
}

// Callback en escanejar un codi QR
async function onQrScanned(decodedText) {
  if (isProcessingScan) return;
  isProcessingScan = true;

  try {
    await processCheckInOut(decodedText, { action: 'auto', tipus: 'qr' });
  } catch (err) {
    console.error('Error processant codi QR:', err);
  } finally {
    setTimeout(() => {
      isProcessingScan = false;
    }, 2000);
  }
}

function onScanError(error) {
  // Ignorem els errors continus de recerca de marcs
}

// Processar entrada o sortida
async function processCheckInOut(code, options = {}) {
  try {
    const res = await Store.checkInOrOut(code, options);
    displayScanResult(res);
    await loadStudentSelector(); // Actualitzar estat
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

  box.classList.remove('is-entrada', 'is-sortida');

  nameEl.textContent = `${res.alumne.nom} ${res.alumne.cognoms || ''}`;
  horaEntradaEl.textContent = res.horaEntrada || '--:--:--';
  saldoEl.textContent = res.balanc ? res.balanc.formatBalance : '--:--:--';

  if (res.action === 'entrada') {
    SoundEngine.playCheckin();
    box.classList.add('is-entrada');
    iconEl.textContent = '';
    badgeEl.textContent = 'BENVINGUT/DA • ENTRADA';
    rowSortida.style.display = 'none';
    rowDurada.style.display = 'none';
  } else {
    SoundEngine.playCheckout();
    box.classList.add('is-sortida');
    iconEl.textContent = '';
    badgeEl.textContent = 'FINS AVIAT • SORTIDA';
    rowSortida.style.display = 'flex';
    rowDurada.style.display = 'flex';
    horaSortidaEl.textContent = res.horaSortida || '--:--:--';
    duradaEl.textContent = res.duradaHms || '00:00:00';
  }

  modal.classList.add('active');

  if (resultAutoCloseTimer) clearTimeout(resultAutoCloseTimer);
  resultAutoCloseTimer = setTimeout(() => {
    modal.classList.remove('active');
  }, 4000);
}

// Carregar selector d'alumnes per a suport manual indicant si són al taller
async function loadStudentSelector() {
  try {
    const students = await Store.getAlumnes();
    const activeSessions = await Store.getActiveSessions();
    const activeStudentIds = new Set(activeSessions.map(s => s.student_id));

    const select = document.getElementById('select-student-quick');
    if (!select) return;

    select.innerHTML = '<option value="">-- Tria un alumne de la llista --</option>';
    students.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      const isInside = activeStudentIds.has(s.id);
      opt.textContent = `${s.nom} ${s.cognoms || ''} (${s.id}) ${isInside ? '[Al taller]' : '[A fora]'}`;
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

  // Selector desplegable de càmera
  const camSelect = document.getElementById('select-camera-device');
  if (camSelect) {
    camSelect.addEventListener('change', async (e) => {
      const selectedChoice = e.target.value;
      await startCamera(selectedChoice);
    });
  }

  // Botó de reintent / activació manual de càmera
  const retryBtn = document.getElementById('btn-retry-camera');
  if (retryBtn) {
    retryBtn.addEventListener('click', async () => {
      await startCamera('user');
    });
  }

  // Alternar ràpidament càmera amb el botó Canviar
  const switchBtn = document.getElementById('btn-switch-camera');
  if (switchBtn) {
    switchBtn.addEventListener('click', async () => {
      const isCurrentlyFront = currentFacingMode === 'user' || currentFacingMode.toLowerCase().includes('front');
      const nextChoice = isCurrentlyFront ? 'environment' : 'user';
      await startCamera(nextChoice);
    });
  }

  // Modal entrada manual
  const manualModal = document.getElementById('modal-manual-entry-backdrop');
  const customTimeInput = document.getElementById('manual-custom-time-input');

  document.getElementById('btn-manual-entry').addEventListener('click', () => {
    document.getElementById('manual-code-input').value = '';
    document.getElementById('select-student-quick').value = '';
    
    // Posar hora actual per defecte a l'input de temps
    const nowLocal = new Date();
    nowLocal.setMinutes(nowLocal.getMinutes() - nowLocal.getTimezoneOffset());
    customTimeInput.value = nowLocal.toISOString().slice(0, 16);
    customTimeInput.style.display = 'none';
    
    const radioNow = document.querySelector('input[name="manual_time_option"][value="now"]');
    if (radioNow) radioNow.checked = true;

    manualModal.classList.add('active');
  });

  document.getElementById('btn-close-manual-modal').addEventListener('click', () => {
    manualModal.classList.remove('active');
  });

  // Alternar opció d'hora actual o manual
  document.querySelectorAll('input[name="manual_time_option"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'custom') {
        customTimeInput.style.display = 'block';
      } else {
        customTimeInput.style.display = 'none';
      }
    });
  });

  document.getElementById('select-student-quick').addEventListener('change', (e) => {
    if (e.target.value) {
      document.getElementById('manual-code-input').value = e.target.value;
    }
  });

  // Botons d'acció del formulari manual (Entrada, Sortida o Automàtic)
  document.querySelectorAll('.btn-manual-action').forEach(btn => {
    btn.addEventListener('click', async () => {
      const studentSelect = document.getElementById('select-student-quick');
      const manualInput = document.getElementById('manual-code-input');
      const code = (studentSelect.value || manualInput.value).trim();

      if (!code) {
        alert('Si us plau, selecciona un alumne o escriu el seu codi.');
        return;
      }

      const action = btn.dataset.action; // 'entrada', 'sortida' o 'auto'
      const timeOption = document.querySelector('input[name="manual_time_option"]:checked')?.value || 'now';
      let customTime = null;
      if (timeOption === 'custom' && customTimeInput.value) {
        customTime = new Date(customTimeInput.value).toISOString();
      }

      manualModal.classList.remove('active');
      await processCheckInOut(code, { action, customTime, tipus: 'manual' });
    });
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
