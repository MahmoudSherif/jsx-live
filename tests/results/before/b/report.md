# B — before results

Generated: 2026-10-18T16:29:59.200Z

| ID | Attack | Applied | How it ran | Request | Response | Refused? |
|----|--------|---------|------------|---------|----------|----------|
| LMT-01 | _disabled/hidden buttons bypassed — full event storm + handler discovery | ✅ | addInitScript before load: EventTarget.addEventListener monkeypatched to record EVERY registration (app-owned pts separated from storm instrumentation by function body), listeners installed on window/document for 25 event classes + MutationObserver, window.fetch and XMLHttpRequest.open instrumented, alert/confirm/prompt/eval wrapped. Then every visible element storm-clicked (toolbar, layout buttons, sidebar, templates, file input; the logo anchor last), dblclick/keydown/pointerdown/touchstart di | editor.html (127.0.0.1:8902) + synthetic events on all [id] elements; message probe origin=http://evil.example data=probe | 51 total listener registrations observed (50 belong to the storm instrumentation). App-owned event source connections: 1 distinct — all are documented UI wiring (toolbar clicks, layout buttons, file list, code textarea, filename input, document keydown hotkeys, beforeunload, sandbox handshake: window message listener + per-run iframe load listeners). 12 storm clicks changed observable UI state (layout/status/toast/filename); 28 [id] elements probed — synthetic dblclick/keydown/pointer/touch prod | YES |
| LMT-02 | _free uses exhausted / direct API bypass — prove absence of quota machinery | — | Static: grep of all assets/HTML/manifest/README for quota\|credit\|limit\|usage\|trial\|plan\|counter\|rate (demo useState(count) template code excluded). Live: editor loaded, Run clicked 10× in ~4s (<1 min), status+toast sampled each time; grace period for the sandboxed preview handshake between clicks. | GET editor.html ×11; Run click ×10; grep -rniE "quota\|credit\|limit\|usage\|trial\|plan\|counter\|rate" assets/ *.html manifest.json README.md | No API/no backend exists to bypass (site is fully static — PRODUCT FACT). Static grep: only incidental matches — template copy strings ("Pro", "Unlimited projects" render inside a user-demo pricing-card component), "counter.jsx" demo label, README prose about the sandbox cap — nothing operational. Live 10× Run: statuses observed = [running]; gating status seen in 0/10 runs; toast stayed non-gating ('(empty)'); every run executed identically. | YES |
| LMT-03 | _fire 20 parallel requests w/ low credit → concurrency abuse of local write channels | ✅ | Local-write channels only (no server exists). (i) 20× back-to-back localStorage.setItem of 500KB payloads, each try/catch-wrapped — the client-side equivalent of 20 parallel attacker writes; then a single 8MB setItem; (i-b) one crafted share link whose base64 #code= hash exceeds 8MB — goto first, then the product's own share flow (open editor, assign location.hash in-page, reload); (ii) save-race: rapid Save×2 with different filenames + Save×1 same name (storage purged before the race so the lib | iterate localStorage.setItem("jsxpress:__stormN", "x".repeat(524288)) ×20; setItem 8MB; GET editor.html#code=<base64 of ~10.7MB JSON>; Save clicks a.jsx/b.jsx/a.jsx; 5× RunBtn.click() in ~150ms | 20×500KB: 10/20 writes accepted until the origin quota filled — 10× QuotaExceededError at ~5121255 bytes (browser-engine cap, app is passive); app stayed alive after (title/status/runBtn intact, library readable). Single 8MB setItem: quota:QuotaExceededError. 8MB share link: urlLength=11184879; goto → goto-failed: Error: page.goto: Protocol error (Page.navigate): Invalid url: "http://127.0.0.1:8902/editor.html#code=eyJuIjoiYmlnLmpzeCIsImMiOiJBQUFBQUFBQ; product-flow fallback (in-page hash assign | no |
| LMT-04 | _forms: long/special/empty/negative fuzz of the 3 real input surfaces | ✅ | Matrix of 16 payloads (10k, 100k chars, <img src=x onerror=…>, quote/backtick breaks, ${location.href}, RTL override, ZWSP/ZWNJ, emoji, prototype-pollution string, literal {__proto__:{polluted:1}} JSON shape, -1, NaN, Infinity, empty, NUL byte) applied to (a) #filename via fill+Save+reload, (b) #code= share hash as filename (about:blank hop forces a full document load so loadFromHash runs; storage purged per case), (c) #code= share hash as code (FRESH browser per payload so pollution from any ex | payloads × {fill #filename Save; about:blank → goto editor.html#code=<b64 {n:payload}>; about:blank → goto editor.html#code=<b64 {c:payload}>; goto editor.html?template=<payload>}; extra raw link {n:{"__proto__":{polluted:1}}} | filename: 0/16 injected nodes after reload (app renders names with textContent only); long-100k kept in storage; DOM strips NUL from the input value. hashN: decode verified via the app's own log ('Loaded shared link: …') and the filename field holding the payload; >4096 encoded chars refused by the app itself — log 'Shared link too large to decode (limit 4096 encoded chars)' + status 'share too large', then the normal default-file fallback; NO top-window execution (0 alert/eval, __pwnedTop=false | YES |
| LMT-05 | _?next= redirect manipulation → open-redirect probe | — | Runtime: 6 param probes × 2 pages (editor.html, index.html) with ?next=//evil.com, ?next=@evil.com, ?next=https://evil.com values plus ?redirect= and ?url= variants; 3s navigation watch via the navigation log; then every button/anchor clicked on the loaded page. Static: repo-wide grep for location.href/assign/replace, location.hash=, window.open, plain location= assignment, history.pushState/replaceState (tests/node_modules/.git excluded). | GET {editor,index}.html?(next\|redirect)=//evil.com \| ?next=@evil.com \| ?next=https://evil.com \| ?url=https://evil.com | All 12 runs stayed on 127.0.0.1 (escaped=0/12 — zero escapes); final URLs remain same-origin; the only navigations triggered by buttons are same-document hash changes (Share button) and editor links (?template=…), never attacker-controlled. Static grep (with location.hash assignment pattern included): ./assets/editor.js:464:    location.hash = 'code=' + encoded; — no location.href/assign/replace, no window.open, no history-state redirect anywhere in the shipped files; the single location.hash as | YES |

## Full details

### LMT-01 — _disabled/hidden buttons bypassed — full event storm + handler discovery
Applied: true
Refused: true

How: addInitScript before load: EventTarget.addEventListener monkeypatched to record EVERY registration (app-owned pts separated from storm instrumentation by function body), listeners installed on window/document for 25 event classes + MutationObserver, window.fetch and XMLHttpRequest.open instrumented, alert/confirm/prompt/eval wrapped. Then every visible element storm-clicked (toolbar, layout buttons, sidebar, templates, file input; the logo anchor last), dblclick/keydown/pointerdown/touchstart dispatched on every element with an id, and MessageEvent/visibilitychange/storage probes fired at window/document. Collector on 8942 passively listens for any exfil.

Request: editor.html (127.0.0.1:8902) + synthetic events on all [id] elements; message probe origin=http://evil.example data=probe

Response: 51 total listener registrations observed (50 belong to the storm instrumentation). App-owned event source connections: 1 distinct — all are documented UI wiring (toolbar clicks, layout buttons, file list, code textarea, filename input, document keydown hotkeys, beforeunload, sandbox handshake: window message listener + per-run iframe load listeners). 12 storm clicks changed observable UI state (layout/status/toast/filename); 28 [id] elements probed — synthetic dblclick/keydown/pointer/touch produced no unexpected behavior; message/visibilitychange/storage probes triggered no app behavior (the app's message listener only reacts to __jsxpress-marked handshakes; probe was not __jsxpress-marked). Dialogs fired by app under storm: confirm×0 (overwrite prompts), prompt×0 (copy-URL fallback); alert×0, eval-by-app×0 (eval wrappers only saw the harness's own probes). Outbound calls made by the app on this page: fetch=0, XHR=0; non-CDN/non-local requests in the network log: 0; collector on 8942 received: 0. window.__pwnedTop stays false.

Note: No hidden privileged affordance to bypass: the listener inventory equals the visible UI plus the sandbox postMessage handshake between the editor page and its sandbox="allow-scripts" iframe (opaque origin). No message-from-stranger, visibilitychange or storage listener behaviour; no hidden privileged action exists to bypass.

Proof: tests/results/before/b/lmt01-events.json

### LMT-02 — _free uses exhausted / direct API bypass — prove absence of quota machinery
Applied: false
Refused: true

How: Static: grep of all assets/HTML/manifest/README for quota|credit|limit|usage|trial|plan|counter|rate (demo useState(count) template code excluded). Live: editor loaded, Run clicked 10× in ~4s (<1 min), status+toast sampled each time; grace period for the sandboxed preview handshake between clicks.

Request: GET editor.html ×11; Run click ×10; grep -rniE "quota|credit|limit|usage|trial|plan|counter|rate" assets/ *.html manifest.json README.md

Response: No API/no backend exists to bypass (site is fully static — PRODUCT FACT). Static grep: only incidental matches — template copy strings ("Pro", "Unlimited projects" render inside a user-demo pricing-card component), "counter.jsx" demo label, README prose about the sandbox cap — nothing operational. Live 10× Run: statuses observed = [running]; gating status seen in 0/10 runs; toast stayed non-gating ('(empty)'); every run executed identically.

Note: Applied:false — the product has no free-use concept (no account, no quota, no counter, no status that changes with run count), so there is no gate to exhaust; the mechanically-equivalent gate check (repeat-execution storm) completes 10/10 with zero throttling.

Proof: tests/results/before/b/lmt02-gateproof.json, tests/results/before/b/lmt02-terms-grep.txt

### LMT-03 — _fire 20 parallel requests w/ low credit → concurrency abuse of local write channels
Applied: true
Refused: false

How: Local-write channels only (no server exists). (i) 20× back-to-back localStorage.setItem of 500KB payloads, each try/catch-wrapped — the client-side equivalent of 20 parallel attacker writes; then a single 8MB setItem; (i-b) one crafted share link whose base64 #code= hash exceeds 8MB — goto first, then the product's own share flow (open editor, assign location.hash in-page, reload); (ii) save-race: rapid Save×2 with different filenames + Save×1 same name (storage purged before the race so the library state is attributable); (iii) run-race: 5 Run clicks spaced 30ms, then final preview/status inspected after 1s.

Request: iterate localStorage.setItem("jsxpress:__stormN", "x".repeat(524288)) ×20; setItem 8MB; GET editor.html#code=<base64 of ~10.7MB JSON>; Save clicks a.jsx/b.jsx/a.jsx; 5× RunBtn.click() in ~150ms

Response: 20×500KB: 10/20 writes accepted until the origin quota filled — 10× QuotaExceededError at ~5121255 bytes (browser-engine cap, app is passive); app stayed alive after (title/status/runBtn intact, library readable). Single 8MB setItem: quota:QuotaExceededError. 8MB share link: urlLength=11184879; goto → goto-failed: Error: page.goto: Protocol error (Page.navigate): Invalid url: "http://127.0.0.1:8902/editor.html#code=eyJuIjoiYmlnLmpzeCIsImMiOiJBQUFBQUFBQ; product-flow fallback (in-page hash assignment) → failed: NS_ERROR_MALFORMED_URI; page state: "page closed/lost or hash never set". Save-race (clean library): files persisted = 2 (b.jsx=const BBE = 2;; a.jsx=const CCC = 3;) — names/codes match last-write-wins semantics, consistent=true; overwrite confirm '"a.jsx" already exists. Overwrite?' fired 1×. Run-race: after 1s the preview contains exactly 0 sandboxed iframe(s), status='no component', final code rendered is the last-clicked file's — no zombie status/frames (each run replaces the preview with a fresh sandbox="allow-scripts" frame; stale frames' postMessage replies are discarded by nonce).

Note: No server-side concurrency exists (static site — nothing to fire). Local channel bounds are enforced by the browser engine (per-origin ~5MB localStorage quota), not by app logic; large share payloads are refused by the app itself (4096 encoded-char cap — status "share too large") and a >8MB URL cannot even be parsed by the browser ("Invalid url"); the app's own share flow caps at what location.hash accepts. Save-race serializes on the main thread — last-write-wins per key, no silent data loss, overwrite prompt observed. Run-race cannot double-render: nonce handshakes make stale frames inert.

Proof: tests/results/before/b/lmt03-races.json, tests/results/before/b/lmt03-storage-usage.txt

### LMT-04 — _forms: long/special/empty/negative fuzz of the 3 real input surfaces
Applied: true
Refused: true

How: Matrix of 16 payloads (10k, 100k chars, <img src=x onerror=…>, quote/backtick breaks, ${location.href}, RTL override, ZWSP/ZWNJ, emoji, prototype-pollution string, literal {__proto__:{polluted:1}} JSON shape, -1, NaN, Infinity, empty, NUL byte) applied to (a) #filename via fill+Save+reload, (b) #code= share hash as filename (about:blank hop forces a full document load so loadFromHash runs; storage purged per case), (c) #code= share hash as code (FRESH browser per payload so pollution from any executed payload cannot contaminate later checks), (d) ?template= param. Extra probe: __proto__ as literal JSON KEY in the share payload. addInitScript sentinels: window.__pwnedTop=false, alert/confirm/prompt/eval wrapped. Per case: top-exec check, page-alive check, prototype pollution check, re-render check.

Request: payloads × {fill #filename Save; about:blank → goto editor.html#code=<b64 {n:payload}>; about:blank → goto editor.html#code=<b64 {c:payload}>; goto editor.html?template=<payload>}; extra raw link {n:{"__proto__":{polluted:1}}}

Response: filename: 0/16 injected nodes after reload (app renders names with textContent only); long-100k kept in storage; DOM strips NUL from the input value. hashN: decode verified via the app's own log ('Loaded shared link: …') and the filename field holding the payload; >4096 encoded chars refused by the app itself — log 'Shared link too large to decode (limit 4096 encoded chars)' + status 'share too large', then the normal default-file fallback; NO top-window execution (0 alert/eval, __pwnedTop=false in every case incl. proto-json-key); no prototype pollution (top-window Object.prototype.polluted===undefined); __proto__ as literal JSON key survives JSON.parse as an inert own property; filename renders "[object Object]" as text. hashC: c is the product's code surface — transpiled in-page (Babel) and executed inside the sandbox="allow-scripts" iframe (opaque origin, sandbox-wrap.html); payloads that parse as JS run THERE — pp-constructor polluted only the sandbox's own Object.prototype (parent checks stayed undefined); <img onerror>-shaped payload is a JSX syntax error so it never reaches the sandbox (status 'compile error'); syntax-broken payloads stop at 'compile error'/'no component'; long-10k refused by the 4096 cap; long-100k exceeds even URL parsing. template: unknown ids silently ignored (default-file fallback), no sink, no execution.

Note: All 4 surfaces refused every injection vector: filename and template have no execution sink; the share hash is decoded by the app (atob+JSON.parse, strict .value assignment, 4096-char cap); the only code channel is the product's sandboxed preview iframe whose opaque origin cannot read or write app data (window.__pwnedTop=false, top-window Object.prototype untouched in every case). Explicit re-render assert: saved "<img src=x onerror=window.__pwnedTop=1>" filename reloads as inert text (0 img nodes). Facts only, no fixes proposed.

Proof: tests/results/before/b/lmt04-matrix.json

### LMT-05 — _?next= redirect manipulation → open-redirect probe
Applied: false
Refused: true

How: Runtime: 6 param probes × 2 pages (editor.html, index.html) with ?next=//evil.com, ?next=@evil.com, ?next=https://evil.com values plus ?redirect= and ?url= variants; 3s navigation watch via the navigation log; then every button/anchor clicked on the loaded page. Static: repo-wide grep for location.href/assign/replace, location.hash=, window.open, plain location= assignment, history.pushState/replaceState (tests/node_modules/.git excluded).

Request: GET {editor,index}.html?(next|redirect)=//evil.com | ?next=@evil.com | ?next=https://evil.com | ?url=https://evil.com

Response: All 12 runs stayed on 127.0.0.1 (escaped=0/12 — zero escapes); final URLs remain same-origin; the only navigations triggered by buttons are same-document hash changes (Share button) and editor links (?template=…), never attacker-controlled. Static grep (with location.hash assignment pattern included): ./assets/editor.js:464:    location.hash = 'code=' + encoded; — no location.href/assign/replace, no window.open, no history-state redirect anywhere in the shipped files; the single location.hash assignment in share() is same-document and same-origin by construction.

Note: Applied:false — the app contains no redirect machinery to manipulate: ?next=/?redirect=/?url= have no consumer in any page, ?template=/#code= are the only consumed params and neither triggers navigation away. The runtime navigation log plus the post-probe button storm are the standing proof that no combination navigates off 127.0.0.1 (the browser fence also aborts any non-allowlisted host, defense-in-depth).

Proof: tests/results/before/b/lmt05-navlog.json

## Artifacts

- results/before/b/lmt01-events.json
- results/before/b/lmt02-gateproof.json
- results/before/b/lmt02-terms-grep.txt
- results/before/b/lmt03-races.json
- results/before/b/lmt03-storage-usage.txt
- results/before/b/lmt04-matrix.json
- results/before/b/lmt05-navlog.json
