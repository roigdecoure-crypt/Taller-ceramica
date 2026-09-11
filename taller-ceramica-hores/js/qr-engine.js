/**
 * qr-engine.js - Generador i Lector de codis QR per al taller de ceràmica
 */

const QREngine = {
  html5QrScanner: null,
  lastScannedCode: null,
  lastScannedTime: 0,
  availableCameras: [],

  /**
   * Obté el model matemàtic del codi QR (instància amb getModuleCount i isDark)
   * @param {string} textText
   * @param {number} level
   */
  getQRModel(textText, level) {
    const cleanText = String(textText || '').trim();
    if (!cleanText) return null;

    const qrLevel = (typeof level !== 'undefined')
      ? level
      : ((typeof QRCode !== 'undefined' && QRCode.CorrectLevel && QRCode.CorrectLevel.M !== undefined) ? QRCode.CorrectLevel.M : 0);

    // Mètode directe ultra-ràpid sense tocar el DOM
    if (typeof QRCode !== 'undefined' && typeof QRCode.createModel === 'function') {
      try {
        return QRCode.createModel(cleanText, qrLevel);
      } catch (err) {
        console.warn('Avís createModel QRCode:', err);
      }
    }

    // Fallback instanciant QRCode en element desacoblat
    if (typeof QRCode !== 'undefined') {
      try {
        const dummy = document.createElement('div');
        const q = new QRCode(dummy, {
          text: cleanText,
          width: 100,
          height: 100,
          correctLevel: qrLevel
        });
        if (q && q._oQRCode) return q._oQRCode;
      } catch (err2) {
        console.warn('Avís instanciant QRCode dummy:', err2);
      }
    }

    return null;
  },

  /**
   * Genera un codi QR en un element contenidor (DOM element o ID)
   * Prioritza representació vectorial SVG pura (nítida a pantalles Retina, immediata, sense toDataURL)
   * @param {string|HTMLElement} container
   * @param {string} textText Codi d'identificació de l'alumne (ex: "TC-101")
   * @param {number} size Mida en píxels (per defecte 180)
   * @param {object} options Opcions de personalització (colorDark, colorLight, correctLevel)
   */
  generateQR(container, textText, size = 180, options = {}) {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) return null;

    const cleanText = String(textText || '').trim();
    if (!cleanText) {
      el.innerHTML = '';
      return null;
    }

    el.innerHTML = ''; // Netejar contingut previ

    const colorDark = options.colorDark || '#000000';
    const colorLight = options.colorLight || '#FFFFFF';

    // 1. Generació d'alta precisió vectorial SVG (instantània, suportada a tots els navegadors)
    const model = this.getQRModel(cleanText, options.correctLevel);
    if (model) {
      const count = model.getModuleCount();
      const rects = [];
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (model.isDark(r, c)) {
            rects.push(`<rect x="${c}" y="${r}" width="1" height="1"/>`);
          }
        }
      }
      const svgMarkup = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${count} ${count}" width="${size}" height="${size}" style="display:block; width:${size}px; height:${size}px; max-width:100%; max-height:100%; margin:0 auto;" shape-rendering="crispEdges" role="img" aria-label="Codi QR ${cleanText}">
          <rect width="${count}" height="${count}" fill="${colorLight}"/>
          <g fill="${colorDark}">
            ${rects.join('')}
          </g>
        </svg>
      `.trim();
      el.innerHTML = svgMarkup;
      return { svg: svgMarkup, model, count };
    }

    // 2. Si la llibreria QRCode no està disponible, provar càrrega dinàmica o avís suau
    if (typeof QRCode === 'undefined') {
      if (typeof document !== 'undefined' && !document.getElementById('lib-qrcode-dyn')) {
        const s = document.createElement('script');
        s.id = 'lib-qrcode-dyn';
        s.src = 'lib/qrcode.min.js?v=9.2';
        s.onload = () => {
          this.generateQR(el, cleanText, size, options);
        };
        document.head.appendChild(s);
      }
      el.innerHTML = `<div style="padding:8px; font-size:11px; color:var(--brand-primary, #831D1D); text-align:center;">Carregant QR...</div>`;
      return null;
    }

    // 3. Fallback clàssic QRCode amb canvas / img protegits
    try {
      const qrcode = new QRCode(el, {
        text: cleanText,
        width: size,
        height: size,
        colorDark: colorDark,
        colorLight: colorLight,
        correctLevel: (typeof QRCode.CorrectLevel !== 'undefined' && QRCode.CorrectLevel.M !== undefined) ? QRCode.CorrectLevel.M : 0
      });

      const fixVisibility = () => {
        const cvs = el.querySelector('canvas');
        const img = el.querySelector('img');
        if (img && img.src && img.src.length > 30) {
          img.style.display = 'block';
          img.style.width = `${size}px`;
          img.style.height = `${size}px`;
          img.style.maxWidth = '100%';
          img.style.margin = '0 auto';
          if (cvs) cvs.style.display = 'none';
        } else if (cvs) {
          cvs.style.display = 'block';
          cvs.style.width = `${size}px`;
          cvs.style.height = `${size}px`;
          cvs.style.maxWidth = '100%';
          cvs.style.margin = '0 auto';
        }
      };
      fixVisibility();
      setTimeout(fixVisibility, 50);
      setTimeout(fixVisibility, 200);

      return qrcode;
    } catch (err) {
      console.error('Error generant QR fallback:', err);
      el.innerHTML = `<div style="padding:8px; font-size:11px; color:#831D1D; text-align:center;">Codi: <strong>${cleanText}</strong></div>`;
      return null;
    }
  },

  /**
   * Dibuixa el codi QR directament sobre un context Canvas 2D (ex: per descarregar imatges de rellotge o carnet)
   * @param {CanvasRenderingContext2D} ctx Context 2D del canvas
   * @param {string} textText Codi d'identificació
   * @param {number} x Coordenada X
   * @param {number} y Coordenada Y
   * @param {number} size Mida en píxels
   * @param {string} colorDark Color dels mòduls
   * @param {string} colorLight Color de fons (o 'transparent')
   */
  drawQRToCanvas(ctx, textText, x, y, size, colorDark = '#000000', colorLight = '#FFFFFF') {
    const cleanText = String(textText || '').trim();
    if (!cleanText || !ctx) return false;

    const model = this.getQRModel(cleanText);
    if (!model) return false;

    const count = model.getModuleCount();
    const cellSize = size / count;

    if (colorLight && colorLight !== 'transparent') {
      ctx.fillStyle = colorLight;
      ctx.fillRect(x, y, size, size);
    }

    ctx.fillStyle = colorDark;
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (model.isDark(r, c)) {
          const px = Math.round(x + c * cellSize);
          const py = Math.round(y + r * cellSize);
          const pw = Math.round(x + (c + 1) * cellSize) - px;
          const ph = Math.round(y + (r + 1) * cellSize) - py;
          ctx.fillRect(px, py, pw, ph);
        }
      }
    }
    return true;
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
