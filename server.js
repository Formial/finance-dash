import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { fetchMonthlyPrescriptionsAndCOGS, mergeSynced } from './sync.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const MAX_BODY = 5 * 1024 * 1024;

// Only these files are ever served — never .env, server code or node_modules.
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/script.js': ['script.js', 'application/javascript; charset=utf-8'],
};

const emptyData = () => ({ months: {}, ledger: [] });

function readData() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { ...emptyData(), ...d };
  } catch (e) {
    return emptyData();
  }
}

function saveData(data) {
  // Write then rename so a crash mid-write can't leave a half-written data.json.
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

const validShape = (d) => d && typeof d === 'object' && d.months && typeof d.months === 'object' && !Array.isArray(d.months) && Array.isArray(d.ledger);

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  // No CORS headers: the page and API share an origin, and leaving them off
  // stops other websites from calling this local server from the browser.
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/status' && req.method === 'GET') {
    return send(res, 200, { ok: true, mongoConfigured: !!process.env.MONGODB_URI });
  }

  if (p === '/api/data' && req.method === 'GET') {
    return send(res, 200, readData());
  }

  if (p === '/api/sync' && req.method === 'POST') {
    try {
      const synced = await fetchMonthlyPrescriptionsAndCOGS();
      const current = mergeSynced(readData(), synced);
      saveData(current);
      console.log('Synced months:', Object.keys(synced).join(', ') || '(none)');
      return send(res, 200, { ok: true, data: current, syncedMonths: Object.keys(synced) });
    } catch (err) {
      console.error('Sync error:', err.message);
      return send(res, 500, { ok: false, error: err.message });
    }
  }

  if (p === '/api/save' && req.method === 'POST') {
    let body = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return;
      try {
        const payload = JSON.parse(body);
        if (!validShape(payload)) return send(res, 400, { ok: false, error: 'Expected { months: {}, ledger: [] }' });
        saveData(payload);
        send(res, 200, { ok: true });
      } catch (err) {
        send(res, 400, { ok: false, error: 'Invalid JSON' });
      }
    });
    return;
  }

  if (p.startsWith('/api/')) return send(res, 404, { error: 'Not found' });

  const entry = req.method === 'GET' && STATIC[p];
  if (!entry) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(path.join(__dirname, entry[0]), (err, content) => {
    if (err) return send(res, 500, 'Server error', 'text/plain');
    send(res, 200, content, entry[1]);
  });
});

// Loopback only, so nobody else on the network can read or overwrite the data.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Formial Finance Dashboard: http://localhost:${PORT}`);
  if (!process.env.MONGODB_URI) console.log('MONGODB_URI is not set — add it to .env to enable Sync MongoDB.');
});
