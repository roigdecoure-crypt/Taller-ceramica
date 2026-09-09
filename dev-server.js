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
  '.ttf': 'font/ttf', '.webp': 'image/webp', '.db': 'application/octet-stream',
};

const ALIASES = {
  '/alumne': '/alumne.html', '/alumnes': '/alumne.html',
  '/admin': '/admin.html', '/reserva': '/reserva.html', '/reserves': '/reserva.html',
  '/carnet': '/carnet.html', '/scanner': '/scanner.html', '/landing': '/landing.html',
};

let py;
function startPython() {
  py = spawn('python3', ['server.py', String(PY_PORT)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PY_PORT) },
  });
  py.stdout.on('data', (d) => process.stdout.write('[py] ' + d));
  py.stderr.on('data', (d) => process.stderr.write('[py] ' + d));
  py.on('error', (e) => console.error('Python server failed to start:', e.message));
}

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
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Backend not ready yet' }));
  });
  req.pipe(proxy);
}

const NO_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};

function serveFile(filePath, res) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...NO_CACHE });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, ...NO_CACHE });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = parsed.pathname;

  // Only proxy /api/ routes and non-GET methods to Python backend
  if (pathname.startsWith('/api/')) {
    proxyToPython(req, res);
    return;
  }
  if (req.method !== 'GET') {
    proxyToPython(req, res);
    return;
  }

  // Static file serving
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (ALIASES[clean]) pathname = ALIASES[clean];
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden');
    return;
  }

  serveFile(filePath, res);
});

server.listen(PORT, () => {
  console.log(`  Local: http://localhost:${PORT}/`);
  // Start Python AFTER Node has bound the port
  startPython();
});

process.on('SIGTERM', () => { py.kill(); process.exit(0); });
process.on('SIGINT', () => { py.kill(); process.exit(0); });
