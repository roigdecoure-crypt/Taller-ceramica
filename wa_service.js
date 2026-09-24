/**
 * wa_service.js - Microservei autònom i gratuït de WhatsApp Web QR
 * Utilitza @whiskeysockets/baileys per connectar-se directament als servidors de WhatsApp
 * sense necessitat de cap intermediari comercial (Whapi/Twilio), a cost 0,00 €/mes.
 */

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
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

const logger = pino({ level: 'error' });

async function startWhatsAppSocket() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[WA Gateway] Iniciant Baileys v${version.join('.')} (Última: ${isLatest})...`);

    sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: true,
      auth: state,
      browser: ['Taller Roig de Coure', 'Desktop', '1.0.0'],
      syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

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
        const rawId = sock?.user?.id || '';
        connectedPhone = rawId.split(':')[0].replace(/[^0-9]/g, '');
        console.log(`[WA Gateway] 🎉 Connexió establerta amb èxit com a +${connectedPhone}`);
      }
    });

    // Escolta de missatges entrants (respostes de confirmació o cancel·lació)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const senderJid = msg.key.remoteJid || '';
        const senderPhone = senderJid.replace(/[^0-9]/g, '');
        const text = msg.message.conversation ||
                     msg.message.extendedTextMessage?.text ||
                     msg.message.buttonsResponseMessage?.selectedButtonId ||
                     msg.message.templateButtonReplyMessage?.selectedId ||
                     '';

        console.log(`[WA Gateway] Missatge entrant de ${senderPhone}: "${text}"`);

        // Reenviar a Python per actualitzar reserves a la base de dades i calendari
        forwardInboundToPython(senderPhone, text, msg.key.id);
      }
    });

  } catch (err) {
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
      qr: currentQR
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
