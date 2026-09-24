/**
 * wa_service.js - Microservei autònom i gratuït de WhatsApp Web QR
 * Utilitza @whiskeysockets/baileys per connectar-se directament als servidors de WhatsApp
 * sense necessitat de cap intermediari comercial (Whapi/Twilio), a cost 0,00 €/mes.
 */

// Polyfill de crypto per a compatibilitat amb Baileys
const nodeCrypto = require('crypto');
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = nodeCrypto;
}
if (typeof global.crypto === 'undefined') {
  global.crypto = nodeCrypto;
}

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.WA_PORT || 3001;
const AUTH_DIR = path.join(__dirname, 'data', 'wa_auth');

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

let sock = null;
let currentQR = null;
let connectionState = 'starting';
let connectedPhone = null;
let lastError = null;
let lastDisconnectCode = null;

const logger = pino({ level: 'error' });

const recentInbound = [];
function recordRecentInbound(phone, text, msgId) {
  recentInbound.unshift({ phone, text, msgId, timestamp: new Date().toISOString() });
  if (recentInbound.length > 30) recentInbound.pop();
}

let backupTimeout = null;
function scheduleAuthBackup() {
  clearTimeout(backupTimeout);
  backupTimeout = setTimeout(async () => {
    try {
      if (!fs.existsSync(AUTH_DIR)) return;
      const files = fs.readdirSync(AUTH_DIR);
      if (!files.includes('creds.json')) return;

      const credsPath = path.join(AUTH_DIR, 'creds.json');
      let credsObj = null;
      try {
        credsObj = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
      } catch (e) {}

      // NOMÉS fer backup si la sessió està efectivament enllaçada amb un número
      if (!credsObj || !credsObj.me?.id) {
        return;
      }
      credsObj.registered = true;
      fs.writeFileSync(credsPath, JSON.stringify(credsObj, null, 2));

      const bundle = {};
      for (const file of files) {
        const filePath = path.join(AUTH_DIR, file);
        if (fs.statSync(filePath).isFile()) {
          bundle[file] = fs.readFileSync(filePath).toString('base64');
        }
      }
      const payload = JSON.stringify({ files: bundle });
      const req = http.request({
        hostname: '127.0.0.1',
        port: process.env.PORT || 8080,
        path: '/api/whatsapp/internal-auth-backup',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      });
      req.on('error', () => {});
      req.write(payload);
      req.end();
    } catch (e) {
      console.warn('[WA Gateway] Advertència fent backup auth:', e.message);
    }
  }, 2500);
}

process.on('uncaughtException', (err) => console.error('[WA Gateway Uncaught]', err));
process.on('unhandledRejection', (err) => console.error('[WA Gateway Unhandled Rejection]', err));

async function tryRestoreAuth() {
  for (let attempt = 1; attempt <= 15; attempt++) {
    const credsPath = path.join(AUTH_DIR, 'creds.json');
    let localRegistered = false;
    if (fs.existsSync(credsPath)) {
      try {
        const c = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
        if (c && c.me?.id) {
          localRegistered = true;
          if (!c.registered) {
            c.registered = true;
            fs.writeFileSync(credsPath, JSON.stringify(c, null, 2));
          }
        }
      } catch (e) {}
    }

    if (localRegistered) {
      return true;
    }

    const restored = await new Promise((resolve) => {
      try {
        const req = http.request({
          hostname: '127.0.0.1',
          port: process.env.PORT || 8080,
          path: '/api/whatsapp/internal-auth-restore',
          method: 'GET',
          timeout: 4000
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data || '{}');
              if (parsed.ok && parsed.files && typeof parsed.files === 'object') {
                for (let [fname, b64] of Object.entries(parsed.files)) {
                  let fileBuf = Buffer.from(b64, 'base64');
                  if (fname === 'creds.json') {
                    try {
                      const cObj = JSON.parse(fileBuf.toString('utf8'));
                      if (cObj.me && cObj.me.id) {
                        cObj.registered = true;
                      }
                      fileBuf = Buffer.from(JSON.stringify(cObj, null, 2), 'utf8');
                    } catch (e) {}
                  }
                  fs.writeFileSync(path.join(AUTH_DIR, fname), fileBuf);
                }
                console.log(`[WA Gateway] S'han restaurat ${Object.keys(parsed.files).length} fitxers d'autenticació de WhatsApp amb èxit.`);
                return resolve(true);
              }
            } catch (e) {}
            resolve(false);
          });
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
      } catch (e) {
        resolve(false);
      }
    });

    if (restored) return true;

    console.log(`[WA Gateway] Esperant backend Python per restaurar credencials (${attempt}/15)...`);
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

async function startWhatsAppSocket() {
  try {
    await tryRestoreAuth();
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    let version = [2, 3000, 1015901307];
    try {
      const v = await fetchLatestBaileysVersion();
      if (v && v.version) version = v.version;
    } catch (vErr) {
      console.warn('[WA Gateway] Advertència obtenint versió Baileys:', vErr.message);
    }

    console.log(`[WA Gateway] Iniciant Baileys v${version.join('.')}...`);

    sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: true,
      auth: state,
      browser: Browsers.macOS('Chrome'),
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 10000
    });

    sock.ev.on('creds.update', async () => {
      await saveCreds();
      scheduleAuthBackup();
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          currentQR = await QRCode.toDataURL(qr, { margin: 2, scale: 7 });
          connectionState = 'qr_ready';
          console.log('[WA Gateway] Nou codi QR generat i llest per escanejar.');
        } catch (qrErr) {
          console.error('[WA Gateway] Error convertint QR a DataURL:', qrErr);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        connectionState = 'disconnected';
        connectedPhone = null;
        lastDisconnectCode = statusCode;
        lastError = lastDisconnect?.error?.message || `Codi tancament: ${statusCode}`;
        console.warn(`[WA Gateway] Connexió tancada (Codi: ${statusCode}). Reconnectant: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(startWhatsAppSocket, 4000);
        } else {
          console.warn('[WA Gateway] Sessió tancada permanentment pel mòbil. Netejant dades d\'autenticació...');
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
            fs.mkdirSync(AUTH_DIR, { recursive: true });
          } catch (e) {}
          setTimeout(startWhatsAppSocket, 2000);
        }
      } else if (connection === 'open') {
        connectionState = 'open';
        currentQR = null;
        lastError = null;
        const rawId = sock?.user?.id || '';
        connectedPhone = rawId.split(':')[0].replace(/[^0-9]/g, '');
        console.log(`[WA Gateway] 🎉 Connexió establerta amb èxit com a +${connectedPhone}`);
        scheduleAuthBackup();
      }
    });

    // Escolta de missatges entrants (respostes de confirmació o cancel·lació)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      for (const msg of (messages || [])) {
        if (!msg.message || msg.key?.fromMe) continue;

        const rawMsg = msg.message;
        const unwrapped = rawMsg.ephemeralMessage?.message ||
                          rawMsg.viewOnceMessage?.message ||
                          rawMsg.viewOnceMessageV2?.message ||
                          rawMsg.documentWithCaptionMessage?.message ||
                          rawMsg;

        const text = (unwrapped.conversation ||
                      unwrapped.extendedTextMessage?.text ||
                      unwrapped.buttonsResponseMessage?.selectedButtonId ||
                      unwrapped.templateButtonReplyMessage?.selectedId ||
                      unwrapped.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
                      '').trim();

        let senderJid = msg.key.remoteJid || '';
        if (msg.key.participant && !senderJid.endsWith('@s.whatsapp.net')) {
          senderJid = msg.key.participant;
        }
        const senderPhone = senderJid.split('@')[0].replace(/[^0-9]/g, '');

        console.log(`[WA Gateway] [${type}] Missatge entrant de ${senderPhone}: "${text}" (msgId: ${msg.key.id})`);

        recordRecentInbound(senderPhone, text, msg.key.id);

        if (text) {
          forwardInboundToPython(senderPhone, text, msg.key.id);
        }
      }
    });

  } catch (err) {
    lastError = err.message || String(err);
    console.error('[WA Gateway] Error crític en arrencar el socket:', err);
    setTimeout(startWhatsAppSocket, 5000);
  }
}

function forwardInboundToPython(senderPhone, text, msgId) {
  try {
    const payload = JSON.stringify({
      sender_phone: senderPhone,
      text: text,
      msg_id: msgId
    });

    const req = http.request({
      hostname: '127.0.0.1',
      port: process.env.PORT || 8080,
      path: '/api/whatsapp/internal-inbound',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      // Ignorar resposta
    });

    req.on('error', (e) => {
      // Pot ser que python encara estigui arrencant
    });

    req.write(payload);
    req.end();
  } catch (e) {}
}

// Servidor HTTP intern per a la comunicació amb server.py
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200);
    return res.end(JSON.stringify({
      ok: true,
      connected: connectionState === 'open',
      state: connectionState,
      phone: connectedPhone,
      qr: currentQR,
      last_error: lastError,
      last_code: lastDisconnectCode
    }));
  if (req.method === 'GET' && url.pathname === '/recent-inbound') {
    res.writeHead(200);
    return res.end(JSON.stringify({
      ok: true,
      inbound: recentInbound
    }));
  }

  if (req.method === 'POST' && url.pathname === '/send') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const rawPhone = String(data.to || '').replace(/[^0-9]/g, '');
        let cleanPhone = rawPhone;
        if (cleanPhone.length === 9 && cleanPhone.startsWith('6') || cleanPhone.startsWith('7') || cleanPhone.startsWith('8') || cleanPhone.startsWith('9')) {
          cleanPhone = '34' + cleanPhone;
        }

        if (!cleanPhone || !data.text) {
          res.writeHead(400);
          return res.end(JSON.stringify({ ok: false, error: 'Falten camps: to o text' }));
        }

        if (connectionState !== 'open' || !sock) {
          res.writeHead(503);
          return res.end(JSON.stringify({ ok: false, error: 'El WhatsApp del taller no està connectat. Cal escanejar el QR.' }));
        }

        const jid = `${cleanPhone}@s.whatsapp.net`;
        const sent = await sock.sendMessage(jid, { text: data.text });

        res.writeHead(200);
        return res.end(JSON.stringify({
          ok: true,
          messageId: sent?.key?.id,
          to: cleanPhone
        }));
      } catch (err) {
        console.error('[WA Gateway] Error enviant missatge:', err);
        res.writeHead(500);
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/reconnect') {
    try {
      console.log('[WA Gateway] Sol·licitud de reinici / reconnexió del socket...');
      if (sock) {
        try { sock.end(new Error('Manual reconnect')); } catch (e) {}
      }
      setTimeout(startWhatsAppSocket, 1000);
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true, message: 'Reconnexió en marxa...' }));
    } catch (e) {
      res.writeHead(500);
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  if (req.method === 'POST' && url.pathname === '/logout') {
    try {
      if (sock) {
        await sock.logout();
      }
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      fs.mkdirSync(AUTH_DIR, { recursive: true });
      connectionState = 'disconnected';
      connectedPhone = null;
      currentQR = null;
      setTimeout(startWhatsAppSocket, 1500);

      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true, message: 'Sessió desconnectada correctament.' }));
    } catch (e) {
      res.writeHead(500);
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  res.writeHead(404);
  res.end(JSON.stringify({ ok: false, error: 'Ruta no trobada' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[WA Gateway] Servidor HTTP intern escoltant al port ${PORT}`);
  startWhatsAppSocket();
});
