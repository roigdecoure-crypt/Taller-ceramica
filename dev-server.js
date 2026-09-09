const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 5173;
const PY_PORT = 8199;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.webp': 'image/webp',
};

const ALIASES = {
  '/alumne': '/alumne.html', '/alumnes': '/alumne.html',
  '/admin': '/admin.html', '/reserva': '/reserva.html', '/reserves': '/reserva.html',
  '/carnet': '/carnet.html', '/scanner': '/scanner.html', '/landing': '/landing.html',
};

const py = spawn('python3', ['server.py', String(PY_PORT)], {
  cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit']
});
py.on('error', (e) => console.error('Python server failed to start:', e.message));

function proxyToPython(req, res) {
  const opts = {
    hostname: '127.0.0.1', port: PY_PORT,
    path: req.url, method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${PY_PORT}` },
  };
  const proxy = http.request(opts, (pyRes) => {
    res.writeHead(pyRes.statusCode, pyRes.headers);
    pyRes.pipe(res);
  });
  proxy.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Backend not ready yet');
  });
  req.pipe(proxy);
}

function serveFile(filePath, res) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = parsed.pathname;

  if (pathname.startsWith('/api/') || req.method !== 'GET') {
    proxyToPython(req, res);
    return;
  }

  const clean = pathname.replace(/\/+$/, '') || '/';
  if (ALIASES[clean]) pathname = ALIASES[clean];
  if (pathname === '/') pathname = '/landing.html';

  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden');
    return;
  }

  serveFile(filePath, res);
});

server.listen(PORT, () => {
  console.log(`  Local: http://localhost:${PORT}/`);
});

process.on('SIGTERM', () => { py.kill(); process.exit(0); });
process.on('SIGINT', () => { py.kill(); process.exit(0); });
