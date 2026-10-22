// Local server: serves the page and runs the same api/*.js handlers Vercel runs.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Only these files are ever served: never .env, server code or node_modules.
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/script.js': ['script.js', 'application/javascript; charset=utf-8'],
  '/html2pdf.bundle.min.js': ['html2pdf.bundle.min.js', 'application/javascript; charset=utf-8'],
};
const API = ['status', 'login', 'logout', 'data', 'save', 'sync'];

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com/gsi/; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups"
};

function plain(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  // No CORS headers: the page and API share an origin, which also stops other
  // websites from calling this local server from the browser.
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const p = new URL(req.url, 'http://localhost').pathname;

  if (p.startsWith('/api/')) {
    const name = p.slice(5);
    if (!API.includes(name)) return plain(res, 404, 'Not found');
    try {
      const mod = await import(`./api/${name}.js`);
      return await mod.default(req, res);
    } catch (err) {
      console.error(`/api/${name}:`, err.message);
      if (!res.headersSent) plain(res, 500, 'Server error');
      return;
    }
  }

  const entry = req.method === 'GET' && STATIC[p];
  if (!entry) return plain(res, 404, 'Not found');
  fs.readFile(path.join(__dirname, entry[0]), (err, content) => {
    if (err) return plain(res, 500, 'Server error');
    res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-store' });
    res.end(content);
  });
});

// Loopback only, so nobody else on the network can reach it.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Formial Finance Dashboard: http://localhost:${PORT}`);
  if (!process.env.MONGODB_URI) console.log('MONGODB_URI is not set: add it to .env to enable Sync MongoDB.');
});
