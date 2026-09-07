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

    this.html5QrScanner = new Html5Qrcode(elementId);

    const wantFront = cameraChoice === 'user' || (typeof cameraChoice === 'string' && /front|user|selfie/i.test(cameraChoice));

    if (window.isSecureContext === false && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      throw new Error("L'accés a la càmera requereix connexió segura HTTPS.");
    }

    const config = {
      fps: 25,
      videoConstraints: {
        facingMode: wantFront ? 'user' : 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 }
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
      try {
        await this.html5QrScanner.start(
          cameraChoice,
          config,
          handleSuccess,
          handleError
        );
        this._startNativeHardwareDetection(elementId, handleSuccess);
        this._optimizeVideoTrack(elementId);
        return true;
      } catch (errCustom) {
        console.warn('Error amb càmera específica, provant per defecte:', errCustom);
        await this.stopScanner();
        this.html5QrScanner = new Html5Qrcode(elementId);
      }
    }

    // Cas 2: Intentar seleccionar la càmera frontal o posterior per facingMode
    try {
      await this.html5QrScanner.start(
        { facingMode: wantFront ? 'user' : 'environment' },
        config,
        handleSuccess,
        handleError
      );
      this._startNativeHardwareDetection(elementId, handleSuccess);
      this._optimizeVideoTrack(elementId);
      return true;
    } catch (errFacing) {
      console.warn(`Error iniciant amb facingMode directament:`, errFacing);
      await this.stopScanner();
      this.html5QrScanner = new Html5Qrcode(elementId);
    }

    // Cas 3: Si falla, busquem a la llista de càmeres del dispositiu
    try {
      const devices = await this.getCameras();
      if (devices && devices.length > 0) {
        let chosen = null;
        if (wantFront) {
          chosen = devices.find(d => /front|user|anterior|delantera|selfie|face/i.test(d.label || ''));
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
        this._optimizeVideoTrack(elementId);
        return true;
      }
    } catch (errDevices) {
      console.warn('Error provant dispositius específics:', errDevices);
      await this.stopScanner();
      this.html5QrScanner = new Html5Qrcode(elementId);
    }

    // Cas 4: Últim recurs - provar qualsevol càmera disponible sense filtres
    await this.html5QrScanner.start(
      { facingMode: 'environment' },
      { fps: 20 },
      handleSuccess,
      handleError
    );
    this._startNativeHardwareDetection(elementId, handleSuccess);
    this._optimizeVideoTrack(elementId);
    return true;
  },

  /**
   * Detector natiu d'alta velocitat accelerat per maquinari (Google ML Kit / Chromium C++)
   * Executa a 60 FPS i detecta codis sobre pantalles mòbils i smartwatches d'alta brillantor
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
   * Optimitza els paràmetres de la pista de vídeo (enfocament continu i autoexposició si estan suportats)
   */
  _optimizeVideoTrack(elementId) {
    setTimeout(() => {
      try {
        const videoEl = document.querySelector(`#${elementId} video`);
        if (videoEl && videoEl.srcObject) {
          const track = videoEl.srcObject.getVideoTracks()[0];
          if (track && track.getCapabilities) {
            const caps = track.getCapabilities();
            const advanced = {};
            if (caps.focusMode && caps.focusMode.includes('continuous')) {
              advanced.focusMode = 'continuous';
            }
            if (caps.exposureMode && caps.exposureMode.includes('continuous')) {
              advanced.exposureMode = 'continuous';
            }
            if (Object.keys(advanced).length > 0) {
              track.applyConstraints({ advanced: [advanced] }).catch(() => {});
            }
          }
        }
      } catch (e) {
        // Ignorar si el maquinari no admet applyConstraints
      }
    }, 400);
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
