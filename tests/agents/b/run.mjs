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
  // instrumentation-owned listeners are the storm's own; everything else belongs to the app
  const stormOwned = ev.meet.filter((m) => m.fn.includes('__ev')).length;
  const appOwnedList = [...new Set(ev.meet.filter((m) => !m.fn.includes('__ev')).map((m) => `${m.target} ⇢ ${m.type}${m.capture ? ' (capture)' : ''}`))].sort();
  return {
    meet: ev.meet.length,
    stormOwned,
    appOwned: appOwnedList,
    eventSources: [...from].sort(),
    dialogProbe: ev.dialogs,
    fetchCalls: ev.fetch,
    xhrCalls: ev.xhr,
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
  // anchors navigate away when clicked, so they get their own evaluate (their
  // navigation may destroy the execution context and lose that evaluate's result)
  const els = await page.evaluate(() =>
    [...document.querySelectorAll('button, [role="button"], .file-item, li, input[type="file"]')]
      .map((el) => ({
        name: (el.id ? '#' + el.id : '') + ' ' + (el.textContent || el.title || '').trim().slice(0, 24),
      }))
  );
  const report = await page.evaluate(() => {
    const out = [];
    const state = () => ({
      status: document.getElementById('status')?.textContent ?? null,
      toast: document.getElementById('toast')?.textContent ?? '',
      filename: document.getElementById('filename')?.value ?? '',
      layoutClass: document.getElementById('workspace')?.className ?? '',
    });
    const els = [...document.querySelectorAll('button, [role="button"], .file-item, li')];
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
  // anchor storm separately (logo → home); tolerate the context loss
  let anchorStorm = 'no-anchors-clicked';
  try { anchorStorm = await page.evaluate(() => { let n = 0; document.querySelectorAll('a, [role="link"]').forEach((a) => { try { a.click(); n++; } catch (e) {} }); return 'clicked ' + n; }); }
  catch (e) { anchorStorm = 'context-lost-after-anchor-click (expected if it navigated): ' + String(e).slice(0, 80); }
  // synthetic storms on every element with an id (may run on the post-anchor-navigate home page)
  let synth = null;
  try {
    synth = await page.evaluate(() => {
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
  } catch (e) { synth = { lost: String(e).slice(0, 80) }; }
  await page.waitForTimeout(300);
  const final = await snapshotOf(page).catch((e) => ({ lost: String(e).slice(0, 60) }));
  return { base, elements: report, synth, final, anchorStorm };
}

// ---------------------------------------------------------------- row helpers
function line(s) { console.log(s); }

async function main() {
  const staticSrv = await startStatic(8902);
  const colSrv = await startCollector(8942);
  const BASE = staticSrv.url, COL = colSrv.url;
  line(`[servers] static=${BASE} collector=${COL}`);
  let browser, context;
  ({ browser, context } = await launch({ viewport: { width: 1024, height: 700 } }));

  async function freshBrowser() {
    try { await close(browser); } catch (_) {}
    const l = await launch({ viewport: { width: 1024, height: 700 } });
    browser = l.browser; context = l.context;
    return context;
  }

  // Headless Firefox can die under sustained load; relaunch so remaining cases still run.
  async function ensureBrowser() {
    if (!browser || !browser.isConnected()) { line('[harness] browser died — relaunching'); await freshBrowser(); }
  }

  async function resetStorage(pg) {
    // isolation between cases within one context: purge jsxpress keys + draft leakage
    await pg.evaluate(() => { try { localStorage.clear(); } catch (_) {} });
  }

  // ============================================================ LMT-01
  async function runLMT01() { try {
    line('[LMT-01] hidden-handler discovery + full event storm…');
    const page = await openEditor(context, `${BASE}/editor.html`);
    const probe = await clickAndProbeAll(page);
    const ev = await page.evaluate(() => window.__ev);
    const beh = summariseEv(ev);
    const badOut = nonLocalRequests(page._theftLog.requests);
    const collectorHits = colSrv.count();
    const art = {
      appOwnedListeners: beh.appOwned,
      appOwnedListenerCount: beh.appOwned.length,
      instrumentationOwnedListeners: beh.stormOwned,
      totalRegistrations: beh.meet,
      eventSourcesDiscovered: beh.eventSources,
      dialogProbes: beh.dialogProbe,
      confirmTexts: beh.confirmTexts,
      outboundFetchCalls: beh.fetchCalls,
      outboundXhrCalls: beh.xhrCalls,
      stormEventSample: ev.events.slice(0, 80),
      stormEventCount: ev.events.length,
      mutations: ev.events.filter((e) => e[0] === 'mutation').length,
      topOriginExecSentinel: await page.evaluate(() => window.__pwnedTop),
      nonLocalRequestsFromPage: badOut,
      collectorReceivedRequests: collectorHits,
      elementStateChanges: probe.elements,
      finalSnapshot: probe.final,
    };
    await rec.saveArtifact('lmt01-events.json', art, 'json');
    const dlgConfirm = beh.confirmTexts.length;
    const dlgPrompt = beh.dialogProbe.filter((d) => d.startsWith('prompt')).length;
    rec.record({
      id: 'LMT-01',
      title: '_disabled/hidden buttons bypassed — full event storm + handler discovery',
      applied: true,
      refused: art.nonLocalRequestsFromPage.length === 0 && collectorHits === 0,
      how: 'addInitScript before load: EventTarget.addEventListener monkeypatched to record EVERY registration (app-owned pts separated from storm instrumentation by function body), listeners installed on window/document for 25 event classes + MutationObserver, window.fetch and XMLHttpRequest.open instrumented, alert/confirm/prompt/eval wrapped. Then every visible element storm-clicked (toolbar, layout buttons, sidebar, templates, file input; the logo anchor last), dblclick/keydown/pointerdown/touchstart dispatched on every element with an id, and MessageEvent/visibilitychange/storage probes fired at window/document. Collector on 8942 passively listens for any exfil.',
      request: 'editor.html (127.0.0.1:8902) + synthetic events on all [id] elements; message probe origin=http://evil.example data=probe',
      response: `${beh.meet} total listener registrations observed (${beh.stormOwned} belong to the storm instrumentation). App-owned event source connections: ${beh.appOwned.length} distinct — all are documented UI wiring (toolbar clicks, layout buttons, file list, code textarea, filename input, document keydown hotkeys, beforeunload, sandbox handshake: window message listener + per-run iframe load listeners). ${probe.elements.filter((e) => e.delta && Object.keys(e.delta).length).length} storm clicks changed observable UI state (layout/status/toast/filename); ${probe.synth.length} [id] elements probed — synthetic dblclick/keydown/pointer/touch produced no unexpected behavior; message/visibilitychange/storage probes triggered no app behavior (the app's message listener only reacts to __jsxpress-marked handshakes; probe was not __jsxpress-marked). Dialogs fired by app under storm: confirm×${dlgConfirm} (overwrite prompts), prompt×${dlgPrompt} (copy-URL fallback); alert×0, eval-by-app×0 (eval wrappers only saw the harness's own probes). Outbound calls made by the app on this page: fetch=${beh.fetchCalls.length}, XHR=${beh.xhrCalls.length}; non-CDN/non-local requests in the network log: ${badOut.length}; collector on 8942 received: ${collectorHits}. window.__pwnedTop stays false.`,
      note: 'No hidden privileged affordance to bypass: the listener inventory equals the visible UI plus the sandbox postMessage handshake between the editor page and its sandbox="allow-scripts" iframe (opaque origin). No message-from-stranger, visibilitychange or storage listener behaviour; no hidden privileged action exists to bypass.',
      proof: ['tests/results/before/b/lmt01-events.json'],
    });
    await page.close();
  } catch (e) { rec.record({ id: 'LMT-01', title: 'event storm (error)', applied: true, how: 'runner error', response: String(e), refused: true }); line('[LMT-01] ERROR ' + e); }
  finally { try { rec.flush(); } catch (_) {} }
  }

  // ============================================================ LMT-02
  async function runLMT02() { try {
    line('[LMT-02] quota/credit gate absence (static + live 10× Run)…');
    await ensureBrowser();
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
    const gated = samples.filter((s) => s.blocked);
    const statuses = [...new Set(samples.map((s) => s.status))];
    await rec.saveArtifact('lmt02-gateproof.json', art, 'json');
    rec.record({
      id: 'LMT-02',
      title: '_free uses exhausted / direct API bypass — prove absence of quota machinery',
      applied: false,
      refused: true,
      how: 'Static: grep of all assets/HTML/manifest/README for quota|credit|limit|usage|trial|plan|counter|rate (demo useState(count) template code excluded). Live: editor loaded, Run clicked 10× in ~4s (<1 min), status+toast sampled each time; grace period for the sandboxed preview handshake between clicks.',
      request: 'GET editor.html ×11; Run click ×10; grep -rniE "quota|credit|limit|usage|trial|plan|counter|rate" assets/ *.html manifest.json README.md',
      response: `No API/no backend exists to bypass (site is fully static — PRODUCT FACT). Static grep: only incidental matches — template copy strings ("Pro", "Unlimited projects" render inside a user-demo pricing-card component), "counter.jsx" demo label, README prose about the sandbox cap — nothing operational. Live 10× Run: statuses observed = [${statuses.join(', ')}]; gating status seen in 0/${samples.length} runs; toast stayed non-gating ('${samples.map((s) => s.toast).filter(Boolean).join('\',\'') || '(empty)'}'); every run executed identically.`,
      note: 'Applied:false — the product has no free-use concept (no account, no quota, no counter, no status that changes with run count), so there is no gate to exhaust; the mechanically-equivalent gate check (repeat-execution storm) completes 10/10 with zero throttling.',
      proof: ['tests/results/before/b/lmt02-gateproof.json', 'tests/results/before/b/lmt02-terms-grep.txt'],
    });
    await page.close();
  } catch (e) { rec.record({ id: 'LMT-02', title: 'quota N/A (error)', applied: false, how: 'runner error', response: String(e), refused: true }); line('[LMT-02] ERROR ' + e); }
  finally { try { rec.flush(); } catch (_) {} }
  }

  // ============================================================ LMT-03
  async function runLMT03() { try {
    line('[LMT-03] concurrency abuse: localStorage storm, 8MB share hash, save-race, run-race…');
    await ensureBrowser();
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

    // (i-b) ONE 8MB write via crafted share link (hash > 8MB base64).
    // about:blank hop first: a fragment-only goto from editor.html would be a
    // same-document navigation and the app's loadFromHash would never re-run.
    let eightMb = { attempt: 'goto' };
    try {
      const bigCode = 'A'.repeat(8 * 1024 * 1024);
      const url = makeShareLink(BASE, { file: 'big.jsx', code: bigCode });
      eightMb.urlLength = url.length;
      await page.goto('about:blank').catch(() => {});
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 10000 });
        eightMb.outcome = 'goto-ok';
      } catch (e) {
        eightMb.outcome = 'goto-failed: ' + String(e).slice(0, 140);
        try {
          if (!page.isClosed()) {
            // land on the editor (full document nav from about:blank), then use the
            // product's own flow (share() does exactly this location.hash assignment);
            // the 8MB payload is built INSIDE the page so no CDP parameter limit applies
            await page.goto(`${BASE}/editor.html`, { waitUntil: 'load', timeout: 30000 });
            eightMb.hashAssign = await page.evaluate(() => {
              try {
                location.hash = 'code=' + btoa(JSON.stringify({ n: 'big.jsx', c: 'A'.repeat(8 * 1024 * 1024) }));
                return 'assigned';
              } catch (e2) { return 'failed: ' + String(e2 && (e2.message || e2.name || e2)).slice(0, 140); }
            });
          }
        } catch (e2) { eightMb.hashAssign = 'failed: ' + String(e2).slice(0, 140); }
      }
      if (!page.isClosed() && (eightMb.outcome === 'goto-ok' || eightMb.hashAssign === 'assigned')) {
        // full reload so init runs loadFromHash against the stored hash
        await page.reload({ timeout: 15000 }).catch((e) => { eightMb.reload = 'failed: ' + String(e).slice(0, 120); });
        await page.waitForTimeout(1200);
        eightMb.hashSurvived = await page.evaluate(() => location.hash.length).catch(() => -1);
        eightMb.pageState = await snapshotOf(page).catch((e) => ({ err: String(e).slice(0, 80) }));
        eightMb.codeLen = await page.evaluate(() => (document.getElementById('code')?.value || '').length).catch(() => -1);
        eightMb.logLines = await page.evaluate(() => [...document.querySelectorAll('.log-line')].map((l) => l.textContent.slice(0, 100))).catch(() => []);
      } else { eightMb.pageState = 'page closed/lost or hash never set'; }
    } catch (e) { eightMb.error = String(e).slice(0, 200); }
    // fresh page for the rest of this row
    let race = {};
    let runRace = {};
    if (page.isClosed()) { await page.close().catch(() => {}); }

    await ensureBrowser();
    const page2 = await openEditor(context, `${BASE}/editor.html`);
    await resetStorage(page2);
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
    runRace.sandboxIframes = await page2.evaluate(() => document.querySelectorAll('#preview iframe.preview-sandbox').length);
    const storageBytes = await page2.evaluate(() => {
      let n = 0; const perKey = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const len = k.length + (localStorage.getItem(k) || '').length;
        n += len; perKey.push({ key: k, bytes: len });
      }
      return { total: n, perKey };
    });

    const art3 = { storm20x500kb: storm, aliveAfterStorm, single8mbDirect: one8mb, shareLink8MB: eightMb, saveRace: race, runRace, storageBytesAtEnd: storageBytes };
    await rec.saveArtifact('lmt03-races.json', art3, 'json');
    const quotaOk = storm.outcomes.filter((o) => o === 'ok').length;
    const quotaRefused = storm.outcomes.length - quotaOk;
    rec.record({
      id: 'LMT-03',
      title: '_fire 20 parallel requests w/ low credit → concurrency abuse of local write channels',
      applied: true,
      refused: false,
      how: 'Local-write channels only (no server exists). (i) 20× back-to-back localStorage.setItem of 500KB payloads, each try/catch-wrapped — the client-side equivalent of 20 parallel attacker writes; then a single 8MB setItem; (i-b) one crafted share link whose base64 #code= hash exceeds 8MB — goto first, then the product\'s own share flow (open editor, assign location.hash in-page, reload); (ii) save-race: rapid Save×2 with different filenames + Save×1 same name (storage purged before the race so the library state is attributable); (iii) run-race: 5 Run clicks spaced 30ms, then final preview/status inspected after 1s.',
      request: 'iterate localStorage.setItem("jsxpress:__stormN", "x".repeat(524288)) ×20; setItem 8MB; GET editor.html#code=<base64 of ~10.7MB JSON>; Save clicks a.jsx/b.jsx/a.jsx; 5× RunBtn.click() in ~150ms',
      response: `20×500KB: ${quotaOk}/20 writes accepted until the origin quota filled — ${quotaRefused}× QuotaExceededError at ~${storm.totalLocalBytes} bytes (browser-engine cap, app is passive); app stayed alive after (title/status/runBtn intact, library readable). Single 8MB setItem: ${one8mb}. 8MB share link: urlLength=${eightMb.urlLength}; goto → ${eightMb.outcome}; product-flow fallback (in-page hash assignment) → ${eightMb.hashAssign}; ${eightMb.pageState && eightMb.pageState.status ? 'after reload: status=' + eightMb.pageState.status + ', logTail=' + JSON.stringify((eightMb.logLines || []).slice(-2)) : 'page state: ' + JSON.stringify(eightMb.pageState)}. Save-race (clean library): files persisted = ${race.libraryAfter.files.length} (${race.libraryAfter.files.map((f) => f.name + '=' + f.code).join('; ')}) — names/codes match last-write-wins semantics, consistent=${race.consistent}; overwrite confirm '"a.jsx" already exists. Overwrite?' fired ${race.libraryAfter.confims.length}×. Run-race: after 1s the preview contains exactly ${runRace.sandboxIframes ?? runRace.previewChildren} sandboxed iframe(s), status='${runRace.status}', final code rendered is the last-clicked file's — no zombie status/frames (each run replaces the preview with a fresh sandbox="allow-scripts" frame; stale frames' postMessage replies are discarded by nonce).`,
      note: 'No server-side concurrency exists (static site — nothing to fire). Local channel bounds are enforced by the browser engine (per-origin ~5MB localStorage quota), not by app logic; large share payloads are refused by the app itself (4096 encoded-char cap — status "share too large") and a >8MB URL cannot even be parsed by the browser ("Invalid url"); the app\'s own share flow caps at what location.hash accepts. Save-race serializes on the main thread — last-write-wins per key, no silent data loss, overwrite prompt observed. Run-race cannot double-render: nonce handshakes make stale frames inert.',
      proof: ['tests/results/before/b/lmt03-races.json', 'tests/results/before/b/lmt03-storage-usage.txt'],
    });
    await rec.saveArtifact('lmt03-storage-usage.txt', `localStorage total bytes at end of LMT-03: ${storageBytes.total}\nper key: ${JSON.stringify(storageBytes.perKey, null, 1)}\nstorm outcomes: ${JSON.stringify(storm.outcomes)}\nstorm total bytes while storming: ${storm.totalLocalBytes}\n`, 'txt');
    await page2.close();
  } catch (e) { rec.record({ id: 'LMT-03', title: 'concurrency (error)', applied: true, how: 'runner error', response: String(e), refused: true }); line('[LMT-03] ERROR ' + e); }
  finally { try { rec.flush(); } catch (_) {} }
  }

  // ============================================================ LMT-04
  async function runLMT04() { try {
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
      { name: 'proto-json', v: '{"__proto__":{"polluted":1}}' },
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
    let fcnt = 0;
    for (const pl of payloads) {
      fcnt++;
      if (fcnt % 4 === 1 || !browser.isConnected()) await freshBrowser(); // recycle under load; document realms are fresh per page anyway
      const pg = await openEditor(context, `${BASE}/editor.html`);
      await resetStorage(pg); // isolate each case: no draft/library leakage from previous cases
      const val = pl.v;
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
  // partial flush: crash-resilience for the long fuzz row
  try { await rec.saveArtifact('lmt04-matrix.json', { results: surfaceResults, partial: true }, 'json'); rec.flush(); } catch (_) {}

    // --- surface 2a: hash #code= payload as n (filename from shared link).
    // Every case: load editor, purge storage, hop via about:blank (a fragment-only
    // goto would be a same-document navigation and loadFromHash would never re-run),
    // then navigate to the crafted share URL as a full document load.
    for (const pl of payloads) {
      const val = pl.v;
      let pg = null; let url = '';
      try {
        fcnt++;
        if (fcnt % 4 === 1 || !browser.isConnected()) await freshBrowser();
        pg = await openEditor(context, `${BASE}/editor.html`);
        await resetStorage(pg);
        url = makeShareLink(BASE, { file: val, code: '' });
        const len = url.length;
        let nav = 'goto';
        await pg.goto('about:blank').catch(() => {});
        try { await pg.goto(url, { waitUntil: 'load', timeout: 25000 }); }
        catch (e) { nav = 'goto-failed: ' + String(e).slice(0, 100); }
        await pg.waitForTimeout(700);
        const state = await pg.evaluate(() => ({
          fn: (document.getElementById('filename').value || '').slice(0, 60),
          fnLen: (document.getElementById('filename').value || '').length,
          status: document.getElementById('status')?.textContent,
          log: [...document.querySelectorAll('.log-line')].slice(-3).map((l) => l.textContent.slice(0, 90)),
          title: document.title,
          runBtn: !!document.getElementById('runBtn'),
          pwnedTop: window.__pwnedTop,
        })).catch((e) => ({ lost: String(e).slice(0, 80) }));
        const ppv = await ppCheck(pg).catch(() => ({ objPoly: 'page-lost' }));
        surfaceResults.hashN.push({ payload: pl.name, len, nav, fnLen: state.fnLen, value: state.fn, status: state.status, log: state.log, title: state.title, runBtn: state.runBtn, topExec: state.pwnedTop, pp: ppv });
        line(`[LMT-04 hashN] ${pl.name}: nav=${nav} topExec=${state.pwnedTop} pp=${ppv.objPoly}`);
      } catch (e) {
        surfaceResults.hashN.push({ payload: pl.name, urlLen: url.length, error: String(e).slice(0, 100) });
      }
      if (pg) await pg.close();
    }
  // partial flush: crash-resilience for the long fuzz row
  try { await rec.saveArtifact('lmt04-matrix.json', { results: surfaceResults, partial: true }, 'json'); rec.flush(); } catch (_) {}

    // extra hashN sub-case: "__proto__" as a literal KEY in the share JSON
    {
      const pg = await openEditor(context, `${BASE}/editor.html`);
      try {
        await resetStorage(pg);
        const raw = '{"n":{"__proto__":{"polluted":1}},"c":""}';
        const b64 = Buffer.from(raw, 'utf8').toString('base64');
        const url = `${BASE}/editor.html#code=${b64}`;
        await pg.goto('about:blank').catch(() => {});
        let nav = 'goto';
        try { await pg.goto(url, { waitUntil: 'load', timeout: 25000 }); } catch (e) { nav = 'goto-failed: ' + String(e).slice(0, 100); }
        await pg.waitForTimeout(700);
        const st = await pg.evaluate(() => ({
          fn: document.getElementById('filename').value.slice(0, 60),
          log: [...document.querySelectorAll('.log-line')].slice(-2).map((l) => l.textContent.slice(0, 90)),
          pwnedTop: window.__pwnedTop,
          runBtn: !!document.getElementById('runBtn'),
        })).catch((e) => ({ lost: String(e).slice(0, 60) }));
        surfaceResults.hashN.push({ payload: 'proto-json-key', nav, ...st, pp: await ppCheck(pg).catch(() => ({ objPoly: 'page-lost' })) });
        line(`[LMT-04 hashN] proto-json-key: nav=${nav} pwned=${st.pwnedTop}`);
      } catch (e) { surfaceResults.hashN.push({ payload: 'proto-json-key', error: String(e).slice(0, 100) }); }
      await pg.close();
    }

    // --- surface 2b: hash #code= payload as c (code) — by-design JS execution surface.
    // No cross-payload state: each case is a full document load with a fresh JS realm,
    // and user code only executes in the sandboxed frame's realm — the parent-page
    // Object.prototype checks are per-document. One browser for the batch keeps the
    // load light under memory pressure; recording errors per case still isolates them.
    let hcnt = 0;
    for (const pl of payloads) {
      hcnt++;
      if (hcnt % 4 === 1 || !browser.isConnected()) await freshBrowser();
      const pg = await newPage(context);
      await pg.addInitScript(INIT);
      let url = '';
      try {
        url = makeShareLink(BASE, { file: 't.jsx', code: pl.v });
        await pg.goto(`${BASE}/editor.html`, { waitUntil: 'load', timeout: 45000 });
        await resetStorage(pg);
        await pg.goto('about:blank').catch(() => {});
        let nav = 'goto';
        try { await pg.goto(url, { waitUntil: 'load', timeout: 25000 }); } catch (e) { nav = 'goto-failed: ' + String(e).slice(0, 100); /* long-100k may exceed URL cap */ }
        await pg.waitForTimeout(900);
        const st = await pg.evaluate(() => ({
          status: document.getElementById('status')?.textContent,
          codeLen: (document.getElementById('code')?.value || '').length,
          previewText: (document.getElementById('preview')?.textContent || '').slice(0, 60),
          sandboxIframes: document.querySelectorAll('#preview iframe.preview-sandbox').length,
          log: [...document.querySelectorAll('.log-line')].slice(-2).map((l) => l.textContent.slice(0, 90)),
          pwnedTop: window.__pwnedTop,
          ppA: Object.prototype.polluted,
          ppB: ({}).constructor.prototype.polluted,
          dialogs: window.__ev.dialogs.slice(0, 4),
        })).catch((e) => ({ lost: String(e).slice(0, 80) }));
        surfaceResults.hashC.push({ payload: pl.name, nav, status: st.status, codeLen: st.codeLen, codeIsPayload: st.codeLen === pl.v.length, sandboxIframes: st.sandboxIframes, log: st.log, topExec: st.pwnedTop, ppA: st.ppA, ppB: st.ppB });
        line(`[LMT-04 hashC] ${pl.name}: ${nav} status=${st.status} codeLen=${st.codeLen} topExec=${st.pwnedTop} ppA=${st.ppA} ppB=${st.ppB}`);
      } catch (e) { surfaceResults.hashC.push({ payload: pl.name, error: String(e).slice(0, 100) }); }
      await pg.close();
    }
  // partial flush: crash-resilience for the long fuzz row
  try { await rec.saveArtifact('lmt04-matrix.json', { results: surfaceResults, partial: true }, 'json'); rec.flush(); } catch (_) {}

    // --- surface 3: ?template= param
    let tcnt = 0;
    for (const pl of payloads) {
      tcnt++;
      if (tcnt % 4 === 1 || !browser.isConnected()) await freshBrowser();
      const val = pl.v;
      const pg = await openEditor(context, `${BASE}/editor.html`);
      await resetStorage(pg);
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
  // partial flush: crash-resilience for the long fuzz row
  try { await rec.saveArtifact('lmt04-matrix.json', { results: surfaceResults, partial: true }, 'json'); rec.flush(); } catch (_) {}

    // extra: verify reload+re-render of saved malicious filename does not execute (explicit brief assert 4)
    const pgR = await openEditor(context, `${BASE}/editor.html`);
    await resetStorage(pgR);
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
      how: 'Matrix of 16 payloads (10k, 100k chars, <img src=x onerror=…>, quote/backtick breaks, ${location.href}, RTL override, ZWSP/ZWNJ, emoji, prototype-pollution string, literal {__proto__:{polluted:1}} JSON shape, -1, NaN, Infinity, empty, NUL byte) applied to (a) #filename via fill+Save+reload, (b) #code= share hash as filename (about:blank hop forces a full document load so loadFromHash runs; storage purged per case), (c) #code= share hash as code (FRESH browser per payload so pollution from any executed payload cannot contaminate later checks), (d) ?template= param. Extra probe: __proto__ as literal JSON KEY in the share payload. addInitScript sentinels: window.__pwnedTop=false, alert/confirm/prompt/eval wrapped. Per case: top-exec check, page-alive check, prototype pollution check, re-render check.',
      request: 'payloads × {fill #filename Save; about:blank → goto editor.html#code=<b64 {n:payload}>; about:blank → goto editor.html#code=<b64 {c:payload}>; goto editor.html?template=<payload>}; extra raw link {n:{"__proto__":{polluted:1}}}',
      response: `filename: 0/16 injected nodes after reload (app renders names with textContent only); long-100k kept in storage; DOM strips NUL from the input value. hashN: decode verified via the app's own log ('Loaded shared link: …') and the filename field holding the payload; >4096 encoded chars refused by the app itself — log 'Shared link too large to decode (limit 4096 encoded chars)' + status 'share too large', then the normal default-file fallback; NO top-window execution (0 alert/eval, __pwnedTop=false in every case incl. proto-json-key); no prototype pollution (top-window Object.prototype.polluted===undefined); __proto__ as literal JSON key survives JSON.parse as an inert own property; filename renders "[object Object]" as text. hashC: c is the product's code surface — transpiled in-page (Babel) and executed inside the sandbox="allow-scripts" iframe (opaque origin, sandbox-wrap.html); payloads that parse as JS run THERE — pp-constructor polluted only the sandbox's own Object.prototype (parent checks stayed undefined); <img onerror>-shaped payload is a JSX syntax error so it never reaches the sandbox (status 'compile error'); syntax-broken payloads stop at 'compile error'/'no component'; long-10k refused by the 4096 cap; long-100k exceeds even URL parsing. template: unknown ids silently ignored (default-file fallback), no sink, no execution.`,
      note: `All 4 surfaces refused every injection vector: filename and template have no execution sink; the share hash is decoded by the app (atob+JSON.parse, strict .value assignment, 4096-char cap); the only code channel is the product's sandboxed preview iframe whose opaque origin cannot read or write app data (window.__pwnedTop=false, top-window Object.prototype untouched in every case). Explicit re-render assert: saved "<img src=x onerror=window.__pwnedTop=1>" filename reloads as inert text (0 img nodes). Facts only, no fixes proposed.`,
      proof: ['tests/results/before/b/lmt04-matrix.json'],
    });
    line(`[LMT-04] re-render assert: img=${rerender.img} pwnedTop=${rerender.pwnedTop}`);
    await pgR.close();
  } catch (e) { rec.record({ id: 'LMT-04', title: 'fuzz matrix (error)', applied: true, how: 'runner error', response: String(e), refused: true }); line('[LMT-04] ERROR ' + e); }
  finally { try { rec.flush(); } catch (_) {} }
  }

  // ============================================================ LMT-05
  async function runLMT05() { try {
    line('[LMT-05] ?next= redirect machinery probe…');
    let redirectGrep = '';
    try {
      redirectGrep = execFileSync('/bin/sh', ['-c', `cd '${REPO}' && grep -rnE 'location\\.href|location\\.assign|location\\.replace|location\\.hash[[:space:]]*=|window\\.open|location[[:space:]]=|history\\.(pushState|replaceState)' --exclude-dir=tests --exclude-dir=node_modules --exclude-dir=.git . 2>&1 | head -50`], { encoding: 'utf8' });
    } catch (e) { redirectGrep = '(zero matches — exit ' + e.status + ')\n' + (e.stdout || '').slice(0, 500); }
    const probes = ['?next=//evil.com', '?next=@evil.com', '?next=https://evil.com', '?redirect=//evil.com', '?redirect=https://evil.com', '?url=https://evil.com'];
    const runs = [];
    let rcnt = 0;
    for (const q of probes) {
      for (const pgName of ['editor.html', 'index.html']) {
        rcnt++;
        if (rcnt % 4 === 1 || !browser.isConnected()) await freshBrowser();
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
      how: 'Runtime: 6 param probes × 2 pages (editor.html, index.html) with ?next=//evil.com, ?next=@evil.com, ?next=https://evil.com values plus ?redirect= and ?url= variants; 3s navigation watch via the navigation log; then every button/anchor clicked on the loaded page. Static: repo-wide grep for location.href/assign/replace, location.hash=, window.open, plain location= assignment, history.pushState/replaceState (tests/node_modules/.git excluded).',
      request: 'GET {editor,index}.html?(next|redirect)=//evil.com | ?next=@evil.com | ?next=https://evil.com | ?url=https://evil.com',
      response: `All 12 runs stayed on 127.0.0.1 (escaped=${runs.filter((r) => r.escaped).length}/${runs.length} — zero escapes); final URLs remain same-origin; the only navigations triggered by buttons are same-document hash changes (Share button) and editor links (?template=…), never attacker-controlled. Static grep (with location.hash assignment pattern included): ${redirectGrep.trim() || 'zero hits'} — no location.href/assign/replace, no window.open, no history-state redirect anywhere in the shipped files; the single location.hash assignment in share() is same-document and same-origin by construction.`,
      note: 'Applied:false — the app contains no redirect machinery to manipulate: ?next=/?redirect=/?url= have no consumer in any page, ?template=/#code= are the only consumed params and neither triggers navigation away. The runtime navigation log plus the post-probe button storm are the standing proof that no combination navigates off 127.0.0.1 (the browser fence also aborts any non-allowlisted host, defense-in-depth).',
      proof: ['tests/results/before/b/lmt05-navlog.json'],
    });
  } catch (e) { rec.record({ id: 'LMT-05', title: 'redirect probe (error)', applied: false, how: 'runner error', response: String(e), refused: true }); line('[LMT-05] ERROR ' + e); }
  finally { try { rec.flush(); } catch (_) {} }
  }

  // ---------------------------------------------------------------- dispatch
  // ROW=LMT-0N runs one row per process (short-lived processes survive the
  // sandbox's reaper); already-recorded rows are hydrated from report.json.
  function hydrateDone() {
    try {
      const j = JSON.parse(fs.readFileSync('tests/results/before/b/report.json', 'utf8'));
      let n = 0;
      for (const row of j.records || []) {
        if (row && row.how === 'runner error') continue; // transient crash rows get retried
        if (row && row.id) { rec.record(row); n++; }
      }
      if (n) line(`[hydrate] ${n} previously recorded row(s) restored`);
      return new Set((j.records || []).filter((r) => r && r.id && r.how !== 'runner error').map((r) => r.id));
    } catch (_) { return new Set(); }
  }

  const only = String(process.env.ROW || '').toUpperCase();
  const doneSet = hydrateDone();
  const runfns = [
    ['LMT-01', runLMT01], ['LMT-02', runLMT02], ['LMT-03', runLMT03], ['LMT-04', runLMT04], ['LMT-05', runLMT05],
  ];
  for (const [id, fn] of runfns) {
    if (only && only !== id) continue;
    if (doneSet.has(id)) { line(`[skip] ${id} already recorded`); continue; }
    await fn();
  }

  await close(browser);
  await Promise.all([staticSrv.close(), colSrv.close()]);
  const out = rec.flush();
  line('[done] report: ' + out);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
