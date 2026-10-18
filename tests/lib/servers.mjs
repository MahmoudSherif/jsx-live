/* Local-only test servers for the jsx-live security suite.
 * NEVER bind anything but 127.0.0.1. No external connections are made.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { phaseName } from './recorder.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.jsx': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown',
};
const NONE = { url: 'https://cdnjs.cloudflare.com' };

export function startStatic(port = 8901) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(REPO_ROOT, p));
    if (!file.startsWith(REPO_ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${port}`,
    root: REPO_ROOT,
    close: () => new Promise((r) => server.close(() => r())),
  })));
}

/** Attacker-owned collector. Logs every request it receives (method, path, headers, body). */
export function startCollector(port = 8941) {
  const requests = [];
  const phase = phaseName();
  const file = path.join(REPO_ROOT, 'tests', 'results', phase, `collector-${port}.log`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 2_000_000) req.destroy(); });
    req.on('end', () => {
      const entry = { ts: new Date().toISOString(), method: req.method, path: req.url, body: body.slice(0, 4096) };
      requests.push(entry);
      fs.appendFileSync(file, JSON.stringify(entry) + '\n');
      res.writeHead(200, {
        'content-type': 'text/plain',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
      });
      res.end('pwned');
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${port}`,
    requests,
    count: () => requests.length,
    clear: () => { requests.length = 0; fs.writeFileSync(file, ''); },
    close: () => new Promise((r) => server.close(() => r())),
  })));
}
export { NONE };
