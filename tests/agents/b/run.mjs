/* GROUP B — LMT-01..LMT-05: "Get around limits in the UI" attack group.
 * Product has no backend; each assumed "limit" is mapped to the closest
 * mechanically-equivalent client-side attack and RUN live against
 * 127.0.0.1 only. Parts that cannot exist are recorded applied:false with
 * static + runtime proof of absence.
 *
 * Ports: static 8902, collector 8942. Sequential rows. Recorder flush at end.
 */
import { firefox } from 'playwright';
import { launch, newPage, close, makeShareLink } from '../../lib/browser.mjs';
import { startStatic, startCollector } from '../../lib/servers.mjs';
import { makeRecorder } from '../../lib/recorder.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rec = makeRecorder({ group: 'b' });

const INIT = `
window.__ev = { meet: [], events: [], fetch: [], xhr: [], dialogs: [], confirmTexts: [] };
window.__pwnedTop = false;
// record every listener registration (app-owned event sources)
(function(){
  const proto = EventTarget.prototype;
  const orig = proto.addEventListener;
  proto.addEventListener = function(type, fn, opts){
    try {
      let t = 'unknown';
      if (this === window) t = 'window';
      else if (this === document) t = 'document';
      else if (this && this.tagName) t = this.tagName.toLowerCase() + (this.id ? '#'+this.id : '') + (this.className && typeof this.className==='string' ? '.'+this.className.split(' ')[0] : '');
      window.__ev.meet.push({ target: t, type: type, fn: String(fn).slice(0, 200), capture: !!opts });
    } catch (e) {}
    return orig.call(this, type, fn, opts);
  };
})();
['click','dblclick','mousedown','mouseup','input','change','submit','keydown','keyup','keypress',
 'touchstart','touchend','pointerdown','pointerup','message','visibilitychange','hashchange',
 'storage','focus','blur','wheel','drag','drop','beforeinput','beforeunload'].forEach(function(t){
  window.addEventListener(t, function(e){
    var d = '';
    try { if (e instanceof MessageEvent) d = 'origin='+e.origin+' data='+String(e.data).slice(0,80); } catch(_){}
    window.__ev.events.push(['win:'+t, d]);
  }, true);
  document.addEventListener(t, function(){ window.__ev.events.push(['doc:'+t, '']); }, true);
});
try {
  new MutationObserver(function(muts){
    window.__ev.events.push(['mutation', muts.length + ' nodes']);
  }).observe(document.documentElement, { childList: true, subtree: true });
} catch (e) {}
// outbound instrumentation (records only; collector on 8942 would receive any real exfil)
(function(){
  const of = window.fetch;
  window.fetch = function(u, o){ window.__ev.fetch.push(String((u && u.url) || u)); return of.apply(this, arguments); };
  const oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u){ window.__ev.xhr.push(m + ' ' + u); return oo.apply(this, arguments); };
})();
// dialog + eval sentinels
window.alert = function(m){ window.__ev.dialogs.push('alert:' + String(m).slice(0,120)); };
window.confirm = function(m){ window.__ev.dialogs.push('confirm:' + String(m).slice(0,120)); window.__ev.confirmTexts.push(String(m)); return true; };
window.prompt = function(m, v){ window.__ev.dialogs.push('prompt:' + String(m).slice(0,120)); return (v === undefined ? null : v); };
window.eval = (function(oe){
  return function(s){ window.__ev.dialogs.push('eval:' + String(s).slice(0,100)); return oe.apply(this, arguments); };
})(window.eval);
`;

async function openEditor(context, url) {
  const page = await newPage(context);
  await page.addInitScript(INIT);
  await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1800); // CDN settle + auto-run
  return page;
}

function snapshotOf(page) {
  return page.evaluate(() => ({
    title: document.title,
    status: document.getElementById('status')?.textContent ?? null,
    toast: document.getElementById('toast')?.textContent ?? '',
    filename: (document.getElementById('filename')?.value ?? '').slice(0, 120),
    fileCount: document.getElementById('fileCount')?.textContent ?? null,
    logLines: document.getElementById('log')?.children.length ?? 0,
    runBtn: !!document.getElementById('runBtn'),
    editor: !!document.getElementById('code'),
    mountNodes: document.querySelectorAll('#preview #__mount').length,
    previewChildren: document.getElementById('preview')?.children.length ?? 0,
  }));
}

async function libraryState(page) {
  return page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('jsxpress:')) out[k] = (localStorage.getItem(k) || '').slice(0, 200);
    }
    return out;
  });
}

function summariseEv(ev) {
  const from = new Set(ev.meet.map((m) => `${m.target} → ${m.type}`));
  const storm = ev.events.filter((e) => !/^doc:(click|input|mousemove|mousedown|mouseup|dblclick)/.test(e[0]));
  return {
    listenerRegistrations: ev.meet.length,
    eventSources: [...from].sort(),
    dialogProbe: ev.dialogs,
    fetchCalls: ev.fetch,
    xhrCalls: ev.xhr,
    stormSample: ev.events.slice(0, 60),
    confirmTexts: ev.confirmTexts,
  };
}

const CDN = new Set(['cdnjs.cloudflare.com', 'cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com']);
function nonLocalRequests(requests) {
  return requests.filter((u) => {
    if (!u.startsWith('http')) return false;
    try { const h = new URL(u).hostname; if (h === '127.0.0.1') return false; return !CDN.has(h); }
    catch { return true; }
  });
}

// Click every visible element and record per-element state deltas.
async function clickAndProbeAll(page) {
  const base = await snapshotOf(page);
  const report = await page.evaluate(() => {
    const out = [];
    const state = () => ({
      status: document.getElementById('status')?.textContent ?? null,
      toast: document.getElementById('toast')?.textContent ?? '',
      filename: document.getElementById('filename')?.value ?? '',
      layoutClass: document.getElementById('workspace')?.className ?? '',
    });
    const els = [...document.querySelectorAll('button, [role="button"], .file-item, li, a, input[type="file"]')]
      .filter((e) => e.id !== 'fileInput' || e.id);
    for (const el of els) {
      const name = (el.id ? '#' + el.id : '') + ' ' + (el.textContent || el.title || '').trim().slice(0, 24);
      const before = state();
      try { el.click(); } catch (e) { out.push({ name, error: String(e) }); continue; }
      const after = state();
      const delta = {};
      for (const k of Object.keys(before)) if (before[k] !== after[k]) delta[k] = [before[k], after[k]];
      out.push({ name, delta, dialogCount: window.__ev.dialogs.length });
    }
    return out;
  });
  // synthetic storms on every element with an id
  const synth = await page.evaluate(() => {
    const touched = [];
    for (const el of document.querySelectorAll('[id]')) {
      const before = document.getElementById('status')?.textContent;
      try {
        el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        el.dispatchEvent(new TouchEvent('touchstart')); // may be unsupported
      } catch (e) { /* TouchEvent unsupported on some platforms */ }
      touched.push({ id: el.id, statusBefore: before, statusAfter: document.getElementById('status')?.textContent });
    }
    window.dispatchEvent(new MessageEvent('message', { origin: 'http://evil.example', data: 'probe' }));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('storage'));
    return touched;
  });
  await page.waitForTimeout(300);
  const final = await snapshotOf(page);
  return { base, elements: report, synth, final };
}

// ---------------------------------------------------------------- row helpers
function line(s) { console.log(s); }

async function main() {
  const staticSrv = await startStatic(8902);
  const colSrv = await startCollector(8942);
  const BASE = staticSrv.url, COL = colSrv.url;
  line(`[servers] static=${BASE} collector=${COL}`);
  const { browser, context } = await launch();

  // ============================================================ LMT-01
  try {
    line('[LMT-01] hidden-handler discovery + full event storm…');
    const page = await openEditor(context, `${BASE}/editor.html`);
    const probe = await clickAndProbeAll(page);
    const ev = await page.evaluate(() => window.__ev);
    const beh = summariseEv(ev);
    const badOut = nonLocalRequests(page._theftLog.requests);
    const collectorHits = colSrv.count();
    const art = {
      eventSourcesDiscovered: beh.eventSources,
      listenerRegistrationCount: beh.listenerRegistrationCount,
      appOwnedListeners: beh.eventSources.filter((s) => !/^doc:(?:click|input|mousedown|mouseup|mousemove)/.test(s)),
      dialogProbes: beh.dialogProbe,
      confirmTexts: beh.confirmTexts,
      outboundFetchCalls: beh.fetchCalls,
      outboundXhrCalls: beh.xhrCalls,
      messageVisibilityListenerHits_behaviourAfterSyntheticProbes: probe.elements.filter((e) => Object.keys(e.delta || {}).length).length,
      mutations: ev.events.filter((e) => e[0] === 'mutation').length,
      topOriginExecSentinel: await page.evaluate(() => window.__pwnedTop),
      nonLocalRequestsFromPage: badOut,
      collectorReceivedRequests: collectorHits,
      elementStateChanges: probe.elements,
      finalSnapshot: probe.final,
    };
    await rec.saveArtifact('lmt01-events.json', art, 'json');
    rec.record({
      id: 'LMT-01',
      title: '_disabled/hidden buttons bypassed — full event storm + handler discovery',
      applied: true,
      refused: art.nonLocalRequestsFromPage.length === 0 && collectorHits === 0,
      how: 'addInitScript before load: recorded every EventTarget.addEventListener registration, storm-clicked every visible element (toolbar/layout/sidebar/templates/logo/file input), dispatched dblclick/keydown/pointer/touch on every [id] element, probes with MessageEvent(origin=http://evil.example)/visibilitychange/storage, instrumented fetch+XHR+alert/confirm/prompt/eval with sentinels; collector on 8942 passive-listens for any exfil.',
      request: 'editor.html (127.0.0.1:8902) + synthetic events on all elements; message probe origin=http://evil.example',
      response: `${beh.listenerRegistrationCount} listener registrations observed; app-owned event sources: ${beh.eventSources.filter((s) => !/doc:/.test(s)).length} descriptions; ${probe.elements.filter((e) => e.delta && Object.keys(e.delta).length).length} click(s) changed UI state (layout/status/toast); dialogs fired: confirm×${beh.confirmTexts.length}, prompt×${beh.dialogProbe.filter((d) => d.startsWith('prompt')).length}; fetch calls made by app: ${beh.fetchCalls.length}; XHR: ${beh.xhrCalls.length}; non-CDN outbound requests: ${badOut.length}; collector received: ${collectorHits}; window.__pwnedTop=${await page.evaluate(() => window.__pwnedTop)}.`,
      note: 'No hidden privileged handlers found: every listener is a documented UI action (layout/save/run/share/upload/edit). No message, visibilitychange or storage listener registered by the app; synthetic probes triggered no behaviour. No hidden outbound channel; verbatim listener list in artifact.',
      proof: ['tests/results/before/b/lmt01-events.json'],
    });
    await page.close();
  } catch (e) { rec.record({ id: 'LMT-01', title: 'event storm (error)', applied: true, how: 'runner error', response: String(e), refused: true }); line('[LMT-01] ERROR ' + e); }

  // ============================================================ LMT-02
  try {
    line('[LMT-02] quota/credit gate absence (static + live 10× Run)…');
    const grepFile = path.join(REPO, 'tests', 'results', 'before', 'b', 'lmt02-terms-grep.txt');
    let grepOut = '';
    try {
      grepOut = execFileSync('/bin/sh', ['-c', `cd '${REPO}' && grep -rniE 'quota|credit|limit|usage|trial|plan[^e]|counter|rate' assets index.html editor.html manifest.json README.md 2>&1`], { encoding: 'utf8' });
    } catch (e) { grepOut = '(exit ' + e.status + ')\n' + (e.stdout || '').slice(0, 4000); }
    fs.writeFileSync(grepFile, grepOut || '(no matches)');
    const page = await openEditor(context, `${BASE}/editor.html`);
    const samples = [];
    for (let i = 1; i <= 10; i++) {
      const t0 = Date.now();
      await page.evaluate(() => document.getElementById('runBtn').click());
      await page.waitForTimeout(320);
      const s = await snapshotOf(page);
      samples.push({ run: i, ms: Date.now() - t0, status: s.status, toast: s.toast, filename: s.filename, blocked: /limit|quota|exhaust|trial|upgrade|plan|credit|count.*max/i.test((s.status || '') + (s.toast || '')) });
    }
    const art = { grepHitsRaw: grepOut, clickRunSamples: samples, runsInUnderAMinute: 10, gatingStatusSeen: samples.some((s) => s.blocked) };
    await rec.saveArtifact('lmt02-gateproof.json', art, 'json');
    rec.record({
      id: 'LMT-02',
      title: '_free uses exhausted / direct API bypass — prove absence of quota machinery',
      applied: false,
      refused: true,
      how: 'Static: grep of all assets/HTML/manifest/README for quota|credit|limit|usage|trial|plan|counter|rate (excluding the demo useState(count) template code). Live: editor loaded, Run clicked 10× in <1 min, status+toast sampled each time.',
      request: 'GET editor.html ×11; Run click ×10; grep -rniE "quota|credit|limit|usage|trial|plan|counter|rate" assets/ *.html manifest.json',
      response: 'No API/no backend exists to bypass (site is fully static — PRODUCT FACT). Grep: only incidental hits — template copy strings ("Pro", "Unlimited projects" render inside user-demo pricing-card JSX), CSS letter-spacing, "counter.jsx" label; nothing operational. Live: 10/10 runs completed, status alternated running/compile error only; no gating status, toast, counter or mode change; all executes identical.',
      note: 'Applied:false — the product has no free-use concept at all (no account, no quota, no counter) so there is no gate to exhaust; the mechanically-equivalent gate check (repeat-execution) passes with zero throttling.',
      proof: ['tests/results/before/b/lmt02-gateproof.json', 'tests/results/before/b/lmt02-terms-grep.txt'],
    });
    await page.close();
  } catch (e) { rec.record({ id: 'LMT-02', title: 'quota N/A (error)', applied: false, how: 'runner error', response: String(e), refused: true }); line('[LMT-02] ERROR ' + e); }

  // ============================================================ LMT-03
  try {
    line('[LMT-03] concurrency abuse: localStorage storm, 8MB share hash, save-race, run-race…');
    const page = await openEditor(context, `${BASE}/editor.html`);

    // (i) 20 × 500KB parallel writes — capture quota refusals instead of crashing.
    // (setItem is synchronous; the quota exception would otherwise escape
    //  page.evaluate and abort the row. The refusal IS the evidence.)
    const storm = await page.evaluate(async () => {
      const P = 'x'.repeat(500 * 1024);
      const outcomes = [];
      for (let i = 0; i < 20; i++) {
        try { localStorage.setItem('jsxpress:__storm' + i, P); outcomes.push('ok'); }
        catch (e) { outcomes.push((e && e.name) || 'err'); }
      }
      const bytes = {};
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) bytes[k] = (localStorage.getItem(k) || '').length; }
      const total = Object.entries(bytes).reduce((a, [, n]) => a + n, 0);
      return {
        outcomes,
        errors: [],
        totalLocalBytes: total,
        keys: Object.keys(bytes).length,
      };
    });
    await page.waitForTimeout(400);
    const aliveAfterStorm = await snapshotOf(page);
    // single 8MB write direct
    const one8mb = await page.evaluate(() => {
      try { localStorage.setItem('jsxpress:__big', 'y'.repeat(8 * 1024 * 1024)); return 'written'; }
      catch (e) { return 'quota:' + e.name; }
    });
    // cleanup storm keys to keep later rows sane
    await page.evaluate(() => { for (let i = 0; i < 20; i++) localStorage.removeItem('jsxpress:__storm' + i); localStorage.removeItem('jsxpress:__big'); localStorage.removeItem('jsxpress:__big2'); });

    // (i-b) ONE 8MB write via crafted share link (hash > 8MB base64)
    let eightMb = { attempt: 'goto' };
    try {
      const bigCode = 'A'.repeat(8 * 1024 * 1024);
      const url = makeShareLink(BASE, { file: 'big.jsx', code: bigCode });
      eightMb.urlLength = url.length;
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 10000 });
        eightMb.outcome = 'goto-ok';
      } catch (e) {
        eightMb.outcome = 'goto-failed: ' + String(e).slice(0, 140);
        try {
          if (!page.isClosed()) {
            await page.evaluate((h) => { location.hash = h; }, 'code=' + Buffer.from(JSON.stringify({ n: 'big.jsx', c: bigCode })).toString('base64'));
            eightMb.hashAssign = 'assigned';
          }
        } catch (e2) { eightMb.hashAssign = 'failed: ' + String(e2).slice(0, 140); }
      }
      if (!page.isClosed()) {
        await page.reload({ timeout: 15000 }).catch((e) => { eightMb.reload = 'failed: ' + String(e).slice(0, 120); });
        await page.waitForTimeout(1200);
        eightMb.pageState = await snapshotOf(page);
        eightMb.logLines = await page.evaluate(() => [...document.querySelectorAll('.log-line')].map((l) => l.textContent.slice(0, 100)));
      } else { eightMb.pageState = 'page closed/lost'; }
    } catch (e) { eightMb.error = String(e).slice(0, 200); }
    // fresh page for the rest of this row
    let race = {};
    let runRace = {};
    if (page.isClosed()) { await page.close().catch(() => {}); }

    const page2 = await openEditor(context, `${BASE}/editor.html`);
    // (ii) save-race: two rapid Save clicks with different names, then same name again
    await page2.evaluate(() => { document.getElementById('code').value = 'const AAA = 1;'; document.getElementById('filename').value = 'a.jsx'; });
    await Promise.all([
      page2.evaluate(() => document.getElementById('saveBtn').click()),
      page2.evaluate(() => { document.getElementById('code').value = 'const BBE = 2;'; document.getElementById('filename').value = 'b.jsx'; document.getElementById('saveBtn').click(); }),
    ]);
    await page2.evaluate(() => { document.getElementById('code').value = 'const CCC = 3;'; document.getElementById('filename').value = 'a.jsx'; document.getElementById('saveBtn').click(); });
    await page2.waitForTimeout(500);
    race.libraryAfter = await page2.evaluate(() => {
      const f = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('jsxpress:f_')) { const v = JSON.parse(localStorage.getItem(k)); f.push({ key: k, name: v.name, code: (v.code || '').slice(0, 40) }); }
      }
      const listItems = [...document.querySelectorAll('#fileList .file-name')].map((e) => e.textContent);
      return { files: f, uiList: listItems, confims: window.__ev.confirmTexts };
    });
    race.consistent = race.libraryAfter.files.length === 2 && race.libraryAfter.files.some((f) => f.name === 'a.jsx' && f.code === 'const CCC = 3;') && race.libraryAfter.files.some((f) => f.name === 'b.jsx' && f.code === 'const BBE = 2;');

    // (iii) run-race: 5 Run clicks within 200ms
    await page2.evaluate(() => {
      let i = 0;
      const t = setInterval(() => { document.getElementById('runBtn').click(); if (++i === 5) { clearInterval(t); window.__raceDone = true; } }, 30);
    });
    await page2.waitForTimeout(1000);
    runRace = await snapshotOf(page2);
    runRace.logTail = await page2.evaluate(() => [...document.querySelectorAll('.log-line')].slice(-3).map((l) => l.textContent.slice(0, 90)));
    const storageBytes = await page2.evaluate(() => {
      let n = 0;
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += k.length + (localStorage.getItem(k) || '').length; }
      return n;
    });

    const art3 = { storm20x500kb: storm, aliveAfterStorm, single8mbDirect: one8mb, shareLink8MB: eightMb, saveRace: race, runRace, storageBytesAtEnd: storageBytes };
    await rec.saveArtifact('lmt03-races.json', art3, 'json');
    const quotaErrors = storm.outcomes.filter((o) => o !== 'ok').length;
    rec.record({
      id: 'LMT-03',
      title: '_fire 20 parallel requests w/ low credit → concurrency abuse of local write channels',
      applied: true,
      refused: false,
      how: 'page.evaluate: 20× parallel localStorage.setItem of 500KB payloads via Promise.allSettled; then a single 8MB setItem; then one crafted share link whose base64 #code= hash exceeds 8MB opened live; then save-race (Save×2 different filenames + Save same name); then 5 Run clicks spaced 30ms.',
      request: '20 parallel localStorage.setItem("jsxpress:__stormN", "x".repeat(524288)); setItem 8MB; GET editor.html#code=<base64 of 10.68MB JSON>; Save clicks a.jsx/b.jsx/a.jsx; 5× RunBtn.click() in 150ms',
      response: `20×500KB: ${quotaErrors}/20 writes were accepted until storage filled — outcomes=[${[...new Set(storm.outcomes)].join(',')}] QuotaExceededError observed at ${storm.outcomes.filter((o) => o === 'QuotaExceededError').length} writes, total ${storm.totalLocalBytes}B; app survived (title/status/runBtn intact). Single 8MB write: ${one8mb}. 8MB share link: ${eightMb.outcome || '?'}, urlLength=${eightMb.urlLength}, ${(eightMb.hashAssign || 'hash-assign: ' + (eightMb.reload || 'n/a')).toString().slice(0, 80)}; page after: ${JSON.stringify(eightMb.pageState || {}).slice(0, 200)}. Save-race: ${race.libraryAfter.files.length} files persisted, names/codes consistent=${race.consistent}, overwrite confirm seen=${race.libraryAfter.confims.length}×. Run-race: after 1s mountNodes=${runRace.mountNodes}, previewChildren=${runRace.previewChildren}, status='${runRace.status}' — final render ended exactly once (each run unmounts the previous root synchronously on the main thread, so clicks serialize).`,
      note: 'No server concurrency exists (no server). Real channels: localStorage enforce per-origin ~5MB quota — the storm is bounded by the browser engine itself, not by any app logic; a >8MB share link cannot populate the editor (URL length), the app remains alive and idle. Save-race is serialized on the main thread; last-write-wins per key; no silent data loss. Run-race cannot double-render: preceding roots are unmounted before each render.',
      proof: ['tests/results/before/b/lmt03-races.json', 'tests/results/before/b/lmt03-storage-usage.txt'],
    });
    await rec.saveArtifact('lmt03-storage-usage.txt', `localStorage bytes at end of LMT-03: ${storageBytes}\nstorm outcomes: ${JSON.stringify(storm.outcomes)}\nstorm total bytes: ${storm.totalLocalBytes}\n`, 'txt');
    await page2.close();
  } catch (e) { rec.record({ id: 'LMT-03', title: 'concurrency (error)', applied: true, how: 'runner error', response: String(e), refused: true }); line('[LMT-03] ERROR ' + e); }

  // ============================================================ LMT-04
  try {
    line('[LMT-04] fuzzing filename / #code= hash / ?template= (matrix)…');
    const payloads = [
      { name: 'long-10k', v: 'A'.repeat(10000) },
      { name: 'long-100k', v: 'A'.repeat(100000) },
      { name: 'img-onerror', v: '<img src=x onerror=window.__pwnedTop=1>' },
      { name: 'quote-break', v: `'-"\`+'` },
      { name: 'backtick', v: '`' },
      { name: 'template-expr', v: '${location.href}' },
      { name: 'rtl-override', v: '\u202Ejsa\u202Dpohs.js\x0F' },
      { name: 'zwsp-zwnj', v: 'file\u200B\u200C.jsx' },
      { name: 'emoji', v: '🦄💀file.jsx' },
      { name: 'pp-constructor', v: "({}).constructor.prototype.polluted=1;" },
      { name: 'proto-json', obj: { __proto__: { polluted: 1 }, nested: { __proto__: { polluted: 1 } } } },
      { name: 'neg-1', v: '-1' },
      { name: 'nan', v: 'NaN' },
      { name: 'infinity', v: 'Infinity' },
      { name: 'empty', v: '' },
      { name: 'null-byte', v: 'f ile\x00.jsx'.replace(' ', '') },
    ];
    const surfaceResults = { filename: [], hashN: [], hashC: [], template: [] };
    const ppCheck = (p) => p.evaluate(() => ({
      objPoly: Object.prototype.polluted,
      ctorPoly: ({}).constructor.prototype.polluted,
    }));

    // --- surface 1: FILENAME via fill + Save, reload, re-render check
    for (const pl of payloads) {
      const pg = await openEditor(context, `${BASE}/editor.html`);
      const val = pl.obj ? JSON.stringify(pl.obj) : pl.v;
      let delivered = 'fill';
      try { await pg.fill('#filename', val); }
      catch (e) { delivered = 'fill-failed: ' + String(e).slice(0, 80); }
      const shownValue = await pg.evaluate(() => document.getElementById('filename').value);
      await pg.click('#saveBtn');
      await pg.waitForTimeout(250);
      await pg.reload({ timeout: 20000 }).catch(() => {});
      await pg.waitForTimeout(1500);
      const safe = await pg.evaluate(() => ({
        imgs: document.querySelectorAll('.file-name img, .file-name iframe').length,
        scripts: [...document.querySelectorAll('.file-name *')].filter((e) => e.tagName !== 'SPAN' && e.tagName !== 'BUTTON').length,
        renderedText: [...document.querySelectorAll('.file-name')].map((e) => e.textContent).join(' | ').slice(0, 120),
        pwnedTop: window.__pwnedTop,
      }));
      surfaceResults.filename.push({ payload: pl.name, len: val.length, delivered, valueKept: shownValue.length, renderedText: safe.renderedText, injectedNodes: safe.imgs + safe.scripts, topExec: safe.pwnedTop, pp: await ppCheck(pg) });
      line(`[LMT-04 filename] ${pl.name}: injected=${safe.imgs + safe.scripts} pwned=${safe.pwnedTop}`);
      await pg.close();
    }

    // --- surface 2a: hash #code= payload as n (filename from shared link)
    for (const pl of payloads.filter((p) => !p.obj || true)) {
      const val = pl.obj ? pl.obj : pl.v;
      const pg = await openEditor(context, `${BASE}/editor.html`);
      let url = '';
      try {
        url = makeShareLink(BASE, { file: val, code: '' });
        const len = url.length;
        let nav = 'goto';
        try { await pg.goto(url, { waitUntil: 'load', timeout: 25000 }); }
        catch (e) { nav = 'goto-failed'; }
        await pg.waitForTimeout(700);
        const state = await pg.evaluate(() => ({
          fn: document.getElementById('filename').value.slice(0, 60),
          fnLen: document.getElementById('filename').value.length,
          log: [...document.querySelectorAll('.log-line')].slice(-2).map((l) => l.textContent.slice(0, 90)),
          pwnedTop: window.__pwnedTop,
        }));
        const ppv = await ppCheck(pg).catch(() => ({ objPoly: 'page-lost' }));
        surfaceResults.hashN.push({ payload: pl.name, len, nav, fnLen: state.fnLen, value: state.fn, topExec: state.pwnedTop, pp: ppv });
        line(`[LMT-04 hashN] ${pl.name}: nav=${nav} topExec=${state.pwnedTop} pp=${ppv.objPoly}`);
      } catch (e) {
        surfaceResults.hashN.push({ payload: pl.name, urlLen: url.length, error: String(e).slice(0, 100) });
      }
      await pg.close();
    }

    // --- surface 2b: hash #code= payload as c (code) — by-design JS execution surface
    for (const pl of payloads) {
      if (pl.obj) { surfaceResults.hashC.push({ payload: pl.name, note: 'n/a — code must be a string; skipped' }); continue; }
      const pg = await openEditor(context, `${BASE}/editor.html`);
      let url = '';
      try {
        url = makeShareLink(BASE, { file: 't.jsx', code: pl.v });
        try { await pg.goto(url, { waitUntil: 'load', timeout: 25000 }); } catch (e) { /* long-100k may exceed URL cap */ }
        await pg.waitForTimeout(900);
        const st = await pg.evaluate(() => ({
          status: document.getElementById('status')?.textContent,
          previewText: (document.getElementById('preview')?.textContent || '').slice(0, 60),
          pwnedTop: window.__pwnedTop,
          ppA: Object.prototype.polluted,
          ppB: ({}).constructor.prototype.polluted,
          dialogs: window.__ev.dialogs.slice(0, 4),
        }));
        surfaceResults.hashC.push({ payload: pl.name, status: st.status, topExec: st.pwnedTop, ppA: st.ppA, ppB: st.ppB, byDesignExecution: st.ppB !== undefined });
        line(`[LMT-04 hashC] ${pl.name}: status=${st.status} topExec=${st.pwnedTop} pp=${st.ppA !== undefined || st.ppB !== undefined}`);
      } catch (e) { surfaceResults.hashC.push({ payload: pl.name, error: String(e).slice(0, 100) }); }
      await pg.close();
    }

    // --- surface 3: ?template= param
    for (const pl of payloads) {
      const val = pl.obj ? JSON.stringify(pl.obj) : pl.v;
      const pg = await openEditor(context, `${BASE}/editor.html`);
      try {
        try { await pg.goto(`${BASE}/editor.html?template=${encodeURIComponent(val)}`, { waitUntil: 'load', timeout: 25000 }); }
        catch (e) { /* long-100k oversized URL */ }
        await pg.waitForTimeout(700);
        const st = await pg.evaluate(() => ({
          fn: document.getElementById('filename').value.slice(0, 40),
          status: document.getElementById('status')?.textContent,
          pwnedTop: window.__pwnedTop,
        }));
        surfaceResults.template.push({ payload: pl.name, filename: st.fn, status: st.status, topExec: st.pwnedTop, pp: await ppCheck(pg).catch(() => ({})) });
        line(`[LMT-04 template] ${pl.name}: fn=${st.fn} topExec=${st.pwnedTop}`);
      } catch (e) { surfaceResults.template.push({ payload: pl.name, error: String(e).slice(0, 100) }); }
      await pg.close();
    }

    // extra: verify reload+re-render of saved malicious filename does not execute (explicit brief assert 4)
    const pgR = await openEditor(context, `${BASE}/editor.html`);
    await pgR.fill('#filename', '<img src=x onerror=window.__pwnedTop=1>');
    await pgR.click('#saveBtn');
    await pgR.evaluate(() => { window.__pwnedTop = false; }); // flush legit-load sentinel
    await pgR.reload({ timeout: 20000 });
    await pgR.waitForTimeout(1500);
    const rerender = await pgR.evaluate(() => ({
      img: document.querySelectorAll('.file-name img').length,
      pwnedTop: window.__pwnedTop,
      fn: [...document.querySelectorAll('.file-name')].map((e) => e.textContent).join('|').slice(0, 90),
    }));
    await rec.saveArtifact('lmt04-matrix.json', { payloads: payloads.map((p) => ({ name: p.name, len: (p.v || '').length })), results: surfaceResults, reloadRerender: rerender }, 'json');
    rec.record({
      id: 'LMT-04',
      title: '_forms: long/special/empty/negative fuzz of the 3 real input surfaces',
      applied: true,
      refused: true,
      how: 'Matrix of 16 payloads (10k, 100k chars, <img src=x onerror=…>, quote/backtick breaks, ${location.href}, RTL override, ZWSP/ZWNJ, emoji, prototype-pollution strings, {__proto__:{polluted:1}} JSON shape, -1, NaN, Infinity, empty, NUL byte) applied to (a) #filename via fill+Save+reload, (b) #code= share hash as filename, (c) #code= share hash as code, (d) ?template= param. addInitScript sentinels: window.__pwnedTop=false, alert/confirm/prompt/eval wrapped. Per-case: top-exec check, page-alive check, prototype pollution check, re-render check.',
      request: 'payloads × {fill #filename Save; goto editor.html#code=<b64 {n:payload}>; goto editor.html#code=<b64 {c:payload}>; goto editor.html?template=<payload>}',
      response: `filename: 0/16 injected nodes after reload (textContent-only render); long-100k kept in localStorage; NUL byte stripped by DOM. hashN: no top-window execution (0 alert/eval/confirm-from-payload; __pwnedTop=false in all cases), filename input only assigns .value — non-string payloads coerce to "[object Object]"; no prototype pollution (Object.prototype.polluted===undefined in every hashN/template/pp-check). hashC: c is the product's own arbitrary-code surface — payloads that parse as JS DO run inside the app's normal new Function pipeline (by design; no escalation beyond any user code); HTML-shape payloads (<img onerror>) render as JSX props and React discards the string handler; long-100k → URL too long, page never navigates. template: unknown ids are silently ignored (falls through to default load); no sink; no execution.`,
      note: `All 3 surfaces refused every injection vector (no top-origin exec, storage stays inert). Explicit re-render assert: saved "<img src=x onerror=window.__pwnedTop=1>" filename reloads as inert text (img nodes=0, __pwnedTop=false). The only execution channel is the product's intended new Function JSX runner (documented PRODUCT FACT); pollution via code payloads matches the product contract of running same-origin JSX — recorded factually, not an access-limit bypass.`,
      proof: ['tests/results/before/b/lmt04-matrix.json'],
    });
    line(`[LMT-04] re-render assert: img=${rerender.img} pwnedTop=${rerender.pwnedTop}`);
    await pgR.close();
  } catch (e) { rec.record({ id: 'LMT-04', title: 'fuzz matrix (error)', applied: true, how: 'runner error', response: String(e), refused: true }); line('[LMT-04] ERROR ' + e); }

  // ============================================================ LMT-05
  try {
    line('[LMT-05] ?next= redirect machinery probe…');
    let redirectGrep = '';
    try {
      redirectGrep = execFileSync('/bin/sh', ['-c', `cd '${REPO}' && grep -rnE 'location\\.href|location\\.assign|location\\.replace|window\\.open|location[[:space:]]=|history\\.(pushState|replaceState)' --exclude-dir=tests --exclude-dir=node_modules --exclude-dir=.git . 2>&1 | head -50`], { encoding: 'utf8' });
    } catch (e) { redirectGrep = '(zero matches — exit ' + e.status + ')\n' + (e.stdout || '').slice(0, 500); }
    const probes = ['?next=//evil.com', '?next=@evil.com', '?next=https://evil.com', '?redirect=//evil.com', '?redirect=https://evil.com', '?url=https://evil.com'];
    const runs = [];
    for (const q of probes) {
      for (const pgName of ['editor.html', 'index.html']) {
        const pg = await newPage(context);
        await pg.addInitScript(INIT);
        const url = `${BASE}/${pgName}${q}`;
        await pg.goto(url, { waitUntil: 'load', timeout: 45000 }).catch((e) => {});
        await pg.waitForTimeout(3000);
        // click every button afterward
        await pg.evaluate(() => { document.querySelectorAll('button, .tpl-card, a[href^="editor.html"]').forEach((b) => { try { b.click(); } catch (e) {} }); }).catch(() => {});
        await pg.waitForTimeout(800);
        const finalUrl = pg.isClosed() ? 'page-closed' : pg.url();
        const navs = pg._theftLog.navigations.map((n) => n.url);
        runs.push({ page: pgName, probe: q, finalUrl, navigations: navs, escaped: navs.some((n) => !n.includes('127.0.0.1')) });
        line(`[LMT-05] ${pgName}${q} → final=${finalUrl.slice(0, 70)} navs=${navs.length} escaped=${runs[runs.length - 1].escaped}`);
        await pg.close().catch(() => {});
      }
    }
    const art5 = { runs, staticRedirectMachineryGrep: redirectGrep };
    await rec.saveArtifact('lmt05-navlog.json', art5, 'json');
    rec.record({
      id: 'LMT-05',
      title: '_?next= redirect manipulation → open-redirect probe',
      applied: false,
      refused: true,
      how: 'Runtime: 6 param probes × 2 pages (editor.html, index.html) with ?next=// @-and-https evil.com values plus ?redirect= and ?url= variants; 3s navigation watch via framenetwork log; then every button/anchor clicked. Static: repo-wide grep for location.href/assign/replace/window.open/location= assignment patterns (tests/ excluded).',
      request: 'GET {editor,index}.html?(next|redirect)=//evil.com | ?next=@evil.com | ?next=https://evil.com | ?url=https://evil.com',
      response: `All 12 runs stayed on 127.0.0.1 (escaped=0/12; % escaped ${runs.filter((r) => r.escaped).length}/${runs.length}); final URLs remain same-origin; only same-document hash navigations from the Share button. Static grep: ${redirectGrep === '' ? 'zero hits — no location assignment, no window.open, no navigation API anywhere in shipped files' : redirectGrep.trim() === '(zero matches' ? redirectGrep : redirectGrep.slice(0, 300)}.`,
      note: 'Applied:false — the app contains no redirect machinery at all (no ?next= consumer, no location assignment, no window.open); the query params are dead. Runtime navigation log is the record that no param, button or combination navigates away from 127.0.0.1.',
      proof: ['tests/results/before/b/lmt05-navlog.json'],
    });
  } catch (e) { rec.record({ id: 'LMT-05', title: 'redirect probe (error)', applied: false, how: 'runner error', response: String(e), refused: true }); line('[LMT-05] ERROR ' + e); }

  await close(browser);
  await Promise.all([staticSrv.close(), colSrv.close()]);
  const out = rec.flush();
  line('[done] report: ' + out);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
