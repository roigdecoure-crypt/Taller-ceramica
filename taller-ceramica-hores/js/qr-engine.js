/**
 * qr-engine.js - Generador i Lector de codis QR per al taller de ceràmica
 */

const QREngine = {
  html5QrScanner: null,
  lastScannedCode: null,
  lastScannedTime: 0,

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
   * Inicia la càmera i l'escàner QR utilitzant Html5Qrcode
   * @param {string} elementId ID del contenidor de la càmera (ex: "qr-reader")
   * @param {function} onScanSuccess Callback en detectar un QR
   * @param {function} onScanError Callback d'error opcional
   * @param {string} facingMode 'user' (frontal) o 'environment' (posterior)
   */
  async startScanner(elementId, onScanSuccess, onScanError = null, facingMode = 'user') {
    if (typeof Html5Qrcode === 'undefined') {
      throw new Error('La llibreria Html5Qrcode no està carregada.');
    }

    // Aturar qualsevol escàner previ
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
      // Debounce de 2.5 segons per al mateix codi per evitar lectures repetides accidentals
      if (this.lastScannedCode === decodedText && now - this.lastScannedTime < 2500) {
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

    try {
      // 1. Intentar buscar la càmera exacta mitjançant la llista de dispositius
      const devices = await Html5Qrcode.getCameras();
      if (devices && devices.length > 0) {
        let chosenCamera = null;
        if (facingMode === 'user') {
          // Buscar paraules clau de càmera frontal
          chosenCamera = devices.find(d => {
            const lbl = (d.label || '').toLowerCase();
            return lbl.includes('front') || lbl.includes('user') || lbl.includes('anterior') || lbl.includes('delantera') || lbl.includes('selfie');
          });
          // Si no la troba per nom però n'hi ha més d'una, la segona o primera sol ser la frontal
          if (!chosenCamera && devices.length > 1) {
            chosenCamera = devices[devices.length - 1];
          }
        } else {
          // Càmera posterior
          chosenCamera = devices.find(d => {
            const lbl = (d.label || '').toLowerCase();
            return lbl.includes('back') || lbl.includes('rear') || lbl.includes('trasera') || lbl.includes('posterior') || lbl.includes('environment');
          });
        }

        if (!chosenCamera) chosenCamera = devices[0];

        await this.html5QrScanner.start(
          chosenCamera.id,
          config,
          handleSuccess,
          handleError
        );
        return true;
      }
    } catch (camErr) {
      console.warn('getCameras no disponible, provant facingMode directe:', camErr);
    }

    // 2. Fallback directe per facingMode
    try {
      await this.html5QrScanner.start(
        { facingMode: facingMode },
        config,
        handleSuccess,
        handleError
      );
      return true;
    } catch (err) {
      console.warn(`Error iniciant amb facingMode ${facingMode}, provant mode contrari:`, err);
      const fallbackMode = facingMode === 'user' ? 'environment' : 'user';
      await this.html5QrScanner.start(
        { facingMode: fallbackMode },
        config,
        handleSuccess,
        handleError
      );
      return true;
    }
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
        console.warn('Error aturant l\'escàner:', err);
      }
      this.html5QrScanner = null;
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = QREngine;
}
