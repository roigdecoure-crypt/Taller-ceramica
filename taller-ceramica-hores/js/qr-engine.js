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
        colorDark: '#000000',
        colorLight: '#FFFFFF',
        correctLevel: QRCode.CorrectLevel.M
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

    // Restringir exclusivament a codis QR per estalviar CPU i accelerar la lectura
    const qrFormat = typeof Html5QrcodeSupportedFormats !== 'undefined' ? Html5QrcodeSupportedFormats.QR_CODE : 0;
    this.html5QrScanner = new Html5Qrcode(elementId, {
      formatsToSupport: [ qrFormat ],
      verbose: false
    });

    const wantFront = cameraChoice === 'user' || (typeof cameraChoice === 'string' && /front|user|selfie/i.test(cameraChoice));

    const config = {
      fps: 30,
      videoConstraints: {
        facingMode: wantFront ? 'user' : 'environment',
        width: { min: 640, ideal: 1280, max: 1920 },
        height: { min: 480, ideal: 720, max: 1080 }
      },
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
      this._startNativeHardwareDetection(elementId, handleSuccess);
      return true;
    }

    // Cas 2: Intentar seleccionar la càmera frontal o posterior amb resolució HD
    try {
      await this.html5QrScanner.start(
        { 
          facingMode: wantFront ? 'user' : 'environment',
          width: { min: 640, ideal: 1280, max: 1920 },
          height: { min: 480, ideal: 720, max: 1080 }
        },
        config,
        handleSuccess,
        handleError
      );
      this._startNativeHardwareDetection(elementId, handleSuccess);
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
        this._startNativeHardwareDetection(elementId, handleSuccess);
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
    this._startNativeHardwareDetection(elementId, handleSuccess);
    return true;
  },

  /**
   * Detector natiu d'alta velocitat accelerat per maquinari (Google Play Services / Chromium C++)
   * Executa a 60 FPS sense càrrega de CPU suplementària i detecta codis en pantalles petites a l'instant
   */
  _startNativeHardwareDetection(elementId, handleSuccess) {
    this._stopNativeDetector = false;
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        const checkFrame = async () => {
          if (this._stopNativeDetector || !this.html5QrScanner) return;
          const videoEl = document.querySelector(`#${elementId} video`);
          if (videoEl && videoEl.readyState >= 2 && !videoEl.paused) {
            try {
              const barcodes = await detector.detect(videoEl);
              if (barcodes && barcodes.length > 0) {
                const found = barcodes.find(b => b.format === 'qr_code') || barcodes[0];
                if (found && found.rawValue) {
                  handleSuccess(found.rawValue, { rawValue: found.rawValue });
                }
              }
            } catch (err) {
              // Frame en trànsit, continuar
            }
          }
          if (!this._stopNativeDetector) {
            requestAnimationFrame(checkFrame);
          }
        };
        requestAnimationFrame(checkFrame);
      } catch (e) {
        console.warn('BarcodeDetector natiu no disponible:', e);
      }
    }
  },

  /**
   * Atura la càmera i allibera els recursos
   */
  async stopScanner() {
    this._stopNativeDetector = true;
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
