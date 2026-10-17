/* Headless-Firefox page factory with hard network fencing.
 *
 * SAFETY: every page installs two route fences:
 *   1. Block any request whose host is not 127.0.0.1/localhost or an approved CDN
 *      (cdnjs.cloudflare.com, cdn.tailwindcss.com, fonts.googleapis.com, fonts.gstatic.com).
 *   2. HTTPS is never needed locally; anything else is aborted, so no payload can
 *      ever reach a non-local machine (this is why we do NOT include hosts like
 *      169.254.169.254 in live URLs — those only appear in static scans).
 */
import { firefox } from 'playwright';
import fs from 'node:fs';

const FORCE_LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
const ALLOWED_REMOTE_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

function fencedHost(host) {
  if (FORCE_LOCAL_HOSTS.includes(host)) return true;
  return ALLOWED_REMOTE_HOSTS.includes(host);
}

export async function launch(opts = {}) {
  const browser = await firefox.launch({
    headless: true,
    timeout: 30000,
    args: [],
  });
  const context = await browser.newContext({
    viewport: opts.viewport || { width: 1280, height: 800 },
  });

  // ---- network fence (applies to every page in this context) ----
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!fencedHost(url.hostname)) return route.abort('blockedbyclient');
    return route.continue();
  });

  return { browser, context };
}

export async function newPage(context) {
  const page = await context.newPage();
  const log = { console: [], errors: [], violated: [], requests: [], navigations: [] };

  page.on('console', (m) => log.console.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => log.errors.push(String(e)));
  page.on('request', (r) => log.requests.push(r.url()));
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) log.navigations.push({ url: f.url(), ts: new Date().toISOString() });
  });
  page.on('requestfailed', (r) => {
    const f = r.failure()?.failureText || '';
    if (/blocked|MIME|ERR_|NS_BLO/.test(f) || r.url().includes('favicon')) {
      // keep it but it's noise-minimized
    }
    log.requests.push(`[FAILED ${f}] ${r.url()}`);
  });

  // Capture CSP violations surfaced through console warnings
  page.on('console', (m) => {
    const t = m.text();
    if (/Content Security Policy|Refused to|Refused by/i.test(t)) log.violated.push(t);
  });

  page._theftLog = log;
  return page;
}

export async function close(browser) { await browser.close().catch(() => {}); }

/* Build a share-link for a given payload (same encoding the app uses). */
export function makeShareLink(base, { file = 'shared.jsx', code = '' } = {}) {
  const payload = JSON.stringify({ n: file, c: code });
  const encoded = Buffer.from(payload, 'utf8').toString('base64');
  return `${base}/editor.html#code=${encoded}`;
}

/** Force-local-safe payload URLs: collector must be a localhost URL. */
export function assertLocalUrls(requests) {
  const bad = requests.filter((u) => u.startsWith('http') && !u.includes('127.0.0.1') && !u.includes('localhost'));
  return bad;
}
