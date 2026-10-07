// Tiny helpers so the same handlers run on Vercel and in the local server.js.
export function json(res, code, body, headers = {}) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(body));
}

export async function readJson(req, limit = 4 * 1024 * 1024) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new Error('Expected application/json');
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error('Body too large');
  }
  return JSON.parse(body);
}
