/**
 * qr-engine.js - Generador i Lector de codis QR per al taller de ceràmica
 */

const QREngine = {
  html5QrScanner: null,
  lastScannedCode: null,
  lastScannedTime: 0,
  availableCameras: [],

  /**
   * Genera un codi QR en un element contenidor (DOM element o ID)
   * @param {string|HTMLElement} container
   * @param {string} textText Codi d'identificació de l'alumne (ex: "TC-101")
   * @param {number} size Mida en píxels (per defecte 180)
   */
  generateQR(container, textText, size = 180) {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) return null;

    el.innerHTML = ''; // Netejar contingut previ

    if (typeof QRCode === 'undefined') {
      console.error('La llibreria QRCode no està carregada.');
      el.innerHTML = `<div style="padding:10px; font-size:12px; color:red;">Error carregant QR</div>`;
      return null;
    }

    try {
      const qrcode = new QRCode(el, {
        text: textText,
        width: size,
        height: size,
        colorDark: '#1E1D1B',
        colorLight: '#FFFFFF',
        correctLevel: QRCode.CorrectLevel.H
      });
      return qrcode;
    } catch (err) {
      console.error('Error generant el codi QR:', err);
      return null;
    }
  },

  /**
   * Obté la llista de càmeres del dispositiu
   */
  async getCameras() {
    if (typeof Html5Qrcode === 'undefined') return [];
    try {
      this.availableCameras = await Html5Qrcode.getCameras();
      return this.availableCameras || [];
    } catch (e) {
      console.warn('No s\'ha pogut obtenir getCameras():', e);
      return [];
    }
  },

  /**
   * Inicia la càmera i l'escàner QR utilitzant Html5Qrcode
   * @param {string} elementId ID del contenidor (ex: "qr-video-container")
   * @param {function} onScanSuccess Callback en detectar un QR
   * @param {function} onScanError Callback d'error opcional
   * @param {string} cameraChoice 'user' (frontal), 'environment' (posterior) o un ID de dispositiu
   */
  async startScanner(elementId, onScanSuccess, onScanError = null, cameraChoice = 'user') {
    if (typeof Html5Qrcode === 'undefined') {
      throw new Error('La llibreria Html5Qrcode no està carregada.');
    }

    // Aturar i netejar qualsevol instància prèvia
    await this.stopScanner();

    this.html5QrScanner = new Html5Qrcode(elementId);

    const config = {
      fps: 15,
      qrbox: { width: 260, height: 260 },
      aspectRatio: 1.0,
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true
      }
    };

    const handleSuccess = (decodedText, decodedResult) => {
      const now = Date.now();
      // Debounce de 2 segons per al mateix codi
      if (this.lastScannedCode === decodedText && now - this.lastScannedTime < 2000) {
        return;
      }
      this.lastScannedCode = decodedText;
      this.lastScannedTime = now;

      if (typeof onScanSuccess === 'function') {
        onScanSuccess(decodedText, decodedResult);
      }
    };

    const handleError = (error) => {
      if (onScanError && typeof onScanError === 'function') {
        onScanError(error);
      }
    };

    // Cas 1: Si s'ha passat un ID de càmera concret (des del desplegable)
    if (cameraChoice && cameraChoice !== 'user' && cameraChoice !== 'environment') {
      await this.html5QrScanner.start(
        cameraChoice,
        config,
        handleSuccess,
        handleError
      );
      return true;
    }

    const wantFront = cameraChoice === 'user';

    // Cas 2: Intentar seleccionar la càmera frontal o posterior
    // Intentem primer amb la configuració estàndard de WebRTC
    try {
      await this.html5QrScanner.start(
        { facingMode: wantFront ? 'user' : 'environment' },
        config,
        handleSuccess,
        handleError
      );
      return true;
    } catch (errFacing) {
      console.warn(`Error iniciant amb facingMode directament:`, errFacing);
    }

    // Cas 3: Si falla, busquem a la llista de càmeres del dispositiu
    try {
      const devices = await this.getCameras();
      if (devices && devices.length > 0) {
        let chosen = null;
        if (wantFront) {
          chosen = devices.find(d => /front|user|anterior|delantera|selfie|face/i.test(d.label || ''));
          // Si no té nom explícit i n'hi ha més d'una, la segona acostuma a ser la frontal
          if (!chosen && devices.length > 1) {
            chosen = devices[1];
          }
        } else {
          chosen = devices.find(d => /back|rear|trasera|posterior|environment/i.test(d.label || ''));
        }
        if (!chosen) chosen = devices[0];

        await this.html5QrScanner.start(
          chosen.id,
          config,
          handleSuccess,
          handleError
        );
        return true;
      }
    } catch (errDevices) {
      console.warn('Error provant dispositius específics:', errDevices);
    }

    // Cas 4: Últim recurs - provar qualsevol càmera disponible
    await this.html5QrScanner.start(
      { facingMode: 'environment' },
      config,
      handleSuccess,
      handleError
    );
    return true;
  },

  /**
   * Atura la càmera i allibera els recursos
   */
  async stopScanner() {
    if (this.html5QrScanner) {
      try {
        if (this.html5QrScanner.isScanning) {
          await this.html5QrScanner.stop();
        }
        await this.html5QrScanner.clear();
      } catch (err) {
        console.warn('Avís aturant escàner:', err);
      }
      this.html5QrScanner = null;
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = QREngine;
}
