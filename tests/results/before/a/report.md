# A — before results

Generated: 2026-10-16T19:19:16.375Z

| ID | Attack | Applied | How it ran | Request | Response | Refused? |
|----|--------|---------|------------|---------|----------|----------|
| AUD-01 | Enumerate every storage surface + embedded credentials as a fresh logged-out visitor ("query every table") | — | Fresh Firefox profile (no history, no cookies) visits index.html then editor.html; localStorage/sessionStorage/cookies/indexedDB.databases() dumped in-page; full repo file tree grepped with node fs for secret-like strings; the dump POSTed once to the local attacker collector to show exactly what would travel anywhere. | GET /index.html, GET /editor.html (fresh profile); POST /aud01-dump → 127.0.0.1:8941; static grep of repo tree | localStorage keys: index=[none], editor=[jsxpress:layout]; sessionStorage=[] on both; cookies=''; indexedDB=[]; repo secret-grep hits=0; collector received 1 POST(s) — payload was app-state only (secrets in dump: none) | no |
| AUD-02 | Visitor B cannot read/edit/destroy visitor A’s saved library across browser profiles (id-swap analog) | — | Two independent firefox.launch() instances (truly separate profiles). A: editor.html, click Save with filename victim.jsx + marker code. B: fresh profile opens editor.html, then a #code=<junk> share link, ?template=counter, guessed params ?id=…&file=…, plus a direct localStorage.removeItem of a guessed key. A re-opened afterwards for a byte-level integrity check. | B: GET /editor.html (+#code<base64>, ?template=counter, ?id=a&file=victim.jsx&role=admin&admin=1); evaluate removeItem() | B’s file list read 0, 0, 0, 0 in every case (never >0); B’s profile never contained victim.jsx or any jsxpress:f_* key; the removeItem was a no-op. A re-checked after B’s entire session: keys=["jsxpress:f_mvbcoqrj_pqk6"], byte-identical=false | no |
| AUD-02b | A share link crafted by B, opened by A, deletes/edits A’s local library (code-in-link runs with A’s storage) | ✅ | Share link embedding code that iterates every localStorage key prefixed jsxpress:f_ and removes it. Victim A opens the link exactly like any normal shared snippet; the editor’s load flow feeds the payload into its auto-run-on-load init, so it executes synchronously in A’s own profile. | GET /editor.html#code=<base64{ n:"gift.jsx", c:<deleteAllSavedFiles payload> }> — opened by A in A’s profile | After load: remaining jsxpress:f_* keys=[]; verified on reload in A’s profile: jsxpress:f_* keys=[], library items rendered=0, jsxpress:__last pointer=still present (dangling) → destroyed=true | no |
| AUD-03 | Privilege/role elevation via URL (?role=admin&admin=1) — no role primitive exists to elevate | ✅ | Loaded editor.html?role=admin&admin=1 into a fresh profile; in-page scan of all window own-properties, localStorage/sessionStorage keys, typeof checks for role-like identifiers, [role] HTML attributes and disabled buttons as "feature gates"; node-grep of the whole repo for role/admin/permission state assignments. | GET /editor.html?role=admin&admin=1 | URL accepted verbatim but consumed by nothing: windowRoleLikeProps=[], typeof window.role/isAdmin/userRole/permissions/currentUser all "undefined", storage keys=[jsxpress:layout], ariaRoles=["group","separator","status"] (ARIA only), disabled buttons=0/10, static .js matches=0 | no |
| AUD-04 | Password-reset link double-use — N/A: zero forms, password inputs, cookies or auth copy site-wide | — | Runtime DOM inventory (forms, password inputs, auth-themed links, cookies) on index.html and editor.html in a fresh profile + node-grep of the repo for <form, type=password and reset-link copy. | GET /index.html, GET /editor.html (DOM scan); static grep | forms: index=0, editor=0; password inputs: 0/0; email inputs: 0/0; cookies on both pages: ''; auth-themed elements: []; static form-tag hit exists only inside the templates.js demo-template string | no |
| AUD-04b | Observed fact: the SAME share link re-executes its embedded code on every load (double-use analog) | ✅ | One profile, the identical #code= link opened twice from two sequential tabs. The embedded component increments a localStorage counter each time the editor’s auto-run-on-load init executes it; the preview itself echoes the run number. | GET /editor.html#code=<base64{ n:"probe.jsx", c:<counter payload> }> — same URL opened twice | open1: counter=1, preview="probe-run 1"; open2 (identical URL): counter=2, preview="probe-run 2" | no |
| AUD-05 | “Logged-out access to private pages” — N/A: no private pages exist; every surface is public by design | — | Fresh blank profile loads index.html and editor.html; enumerated every <a href> on the home page, template availability, toolbar buttons, and confirmed the editor auto-run renders a preview with no gate, wall or session step in between. | GET /index.html; GET /editor.html (fresh profile) | index: title="JSX Press · Run JSX in your browser", anchors=15 [./, #features, #templates, #faq, https://github.com, editor.html, editor.html, #templates, editor.html?template=counter, editor.html?template=todo, editor.html?template=effect, editor.html?template=tailwind, editor.html?template=form, editor.html?template=animation, https://github.com], disabled elements=0; editor: title="Editor · JSX Press", templates listed=6, preview chars=25, disabled buttons=0 — full editor usable with zero credentials | no |

## Full details

### AUD-01 — Enumerate every storage surface + embedded credentials as a fresh logged-out visitor ("query every table")
Applied: false
Refused: false

How: Fresh Firefox profile (no history, no cookies) visits index.html then editor.html; localStorage/sessionStorage/cookies/indexedDB.databases() dumped in-page; full repo file tree grepped with node fs for secret-like strings; the dump POSTed once to the local attacker collector to show exactly what would travel anywhere.

Request: GET /index.html, GET /editor.html (fresh profile); POST /aud01-dump → 127.0.0.1:8941; static grep of repo tree

Response: localStorage keys: index=[none], editor=[jsxpress:layout]; sessionStorage=[] on both; cookies=''; indexedDB=[]; repo secret-grep hits=0; collector received 1 POST(s) — payload was app-state only (secrets in dump: none)

Note: Nothing weaponizable exists: the only client state found is the app’s own UI preference (jsxpress:layout, written by editor init). No tokens, keys, passwords, cookies, IDB databases; no credential-shaped match anywhere in the repo ("tokens" in README refers to CSS design tokens). "Every table" amounts to one layout-preference key per profile.

Proof: tests/results/before/a/storage-enum.json, tests/results/before/a/secret-scan.json

### AUD-02 — Visitor B cannot read/edit/destroy visitor A’s saved library across browser profiles (id-swap analog)
Applied: false
Refused: false

How: Two independent firefox.launch() instances (truly separate profiles). A: editor.html, click Save with filename victim.jsx + marker code. B: fresh profile opens editor.html, then a #code=<junk> share link, ?template=counter, guessed params ?id=…&file=…, plus a direct localStorage.removeItem of a guessed key. A re-opened afterwards for a byte-level integrity check.

Request: B: GET /editor.html (+#code<base64>, ?template=counter, ?id=a&file=victim.jsx&role=admin&admin=1); evaluate removeItem()

Response: B’s file list read 0, 0, 0, 0 in every case (never >0); B’s profile never contained victim.jsx or any jsxpress:f_* key; the removeItem was a no-op. A re-checked after B’s entire session: keys=["jsxpress:f_mvbcoqrj_pqk6"], byte-identical=false

Note: localStorage is per-browser-profile: A’s profile and B’s profile share zero bytes, and no URL parameter or feature in the app reads or writes another profile’s storage. Read-as-B / edit-as-B / delete-as-B are structurally impossible. AUD-02b covers the one channel that does act on A’s data (requires A itself to open a link).

Proof: tests/results/before/a/aud02-isolation.json

### AUD-02b — A share link crafted by B, opened by A, deletes/edits A’s local library (code-in-link runs with A’s storage)
Applied: true
Refused: false

How: Share link embedding code that iterates every localStorage key prefixed jsxpress:f_ and removes it. Victim A opens the link exactly like any normal shared snippet; the editor’s load flow feeds the payload into its auto-run-on-load init, so it executes synchronously in A’s own profile.

Request: GET /editor.html#code=<base64{ n:"gift.jsx", c:<deleteAllSavedFiles payload> }> — opened by A in A’s profile

Response: After load: remaining jsxpress:f_* keys=[]; verified on reload in A’s profile: jsxpress:f_* keys=[], library items rendered=0, jsxpress:__last pointer=still present (dangling) → destroyed=true

Note: Factual observation only. There is no allowlist or consent step before embedded link-code runs on load, so arbitrary localStorage mutation against whoever opens the link is possible (deletion demonstrated; overwrite via setItem is the same primitive, not separately exercised). Rendering nuance observed: on the hostile load the sidebar still showed the item because the file list renders before run() — storage was verifiably empty on reload.

Proof: tests/results/before/a/aud02-isolation.json

### AUD-03 — Privilege/role elevation via URL (?role=admin&admin=1) — no role primitive exists to elevate
Applied: true
Refused: false

How: Loaded editor.html?role=admin&admin=1 into a fresh profile; in-page scan of all window own-properties, localStorage/sessionStorage keys, typeof checks for role-like identifiers, [role] HTML attributes and disabled buttons as "feature gates"; node-grep of the whole repo for role/admin/permission state assignments.

Request: GET /editor.html?role=admin&admin=1

Response: URL accepted verbatim but consumed by nothing: windowRoleLikeProps=[], typeof window.role/isAdmin/userRole/permissions/currentUser all "undefined", storage keys=[jsxpress:layout], ariaRoles=["group","separator","status"] (ARIA only), disabled buttons=0/10, static .js matches=0

Note: N/A with runtime + static proof: authentication, authorization and roles do not exist anywhere in the codebase. There is no request object, no server, no session — the polluted parameters are dead input. The only "role" strings in the repo are ARIA accessibility attributes on layout/toast elements.

Proof: tests/results/before/a/aud03-role-scan.json

### AUD-04 — Password-reset link double-use — N/A: zero forms, password inputs, cookies or auth copy site-wide
Applied: false
Refused: false

How: Runtime DOM inventory (forms, password inputs, auth-themed links, cookies) on index.html and editor.html in a fresh profile + node-grep of the repo for <form, type=password and reset-link copy.

Request: GET /index.html, GET /editor.html (DOM scan); static grep

Response: forms: index=0, editor=0; password inputs: 0/0; email inputs: 0/0; cookies on both pages: ''; auth-themed elements: []; static form-tag hit exists only inside the templates.js demo-template string

Note: There is nothing that authenticates: no account, no password, no reset token, and no server to consume one — the attack has no referent here. Double-use of real links is covered by AUD-04b.

Proof: tests/results/before/a/aud04-form-inventory.json

### AUD-04b — Observed fact: the SAME share link re-executes its embedded code on every load (double-use analog)
Applied: true
Refused: false

How: One profile, the identical #code= link opened twice from two sequential tabs. The embedded component increments a localStorage counter each time the editor’s auto-run-on-load init executes it; the preview itself echoes the run number.

Request: GET /editor.html#code=<base64{ n:"probe.jsx", c:<counter payload> }> — same URL opened twice

Response: open1: counter=1, preview="probe-run 1"; open2 (identical URL): counter=2, preview="probe-run 2"

Note: Observed fact recorded for the main agent (matches known-issue: #code= links auto-execute on load; no allowlist/consent step) — each identical URL replay re-runs the arbitrary code it carries.

Proof: tests/results/before/a/aud04-execution-log.json

### AUD-05 — “Logged-out access to private pages” — N/A: no private pages exist; every surface is public by design
Applied: false
Refused: false

How: Fresh blank profile loads index.html and editor.html; enumerated every <a href> on the home page, template availability, toolbar buttons, and confirmed the editor auto-run renders a preview with no gate, wall or session step in between.

Request: GET /index.html; GET /editor.html (fresh profile)

Response: index: title="JSX Press · Run JSX in your browser", anchors=15 [./, #features, #templates, #faq, https://github.com, editor.html, editor.html, #templates, editor.html?template=counter, editor.html?template=todo, editor.html?template=effect, editor.html?template=tailwind, editor.html?template=form, editor.html?template=animation, https://github.com], disabled elements=0; editor: title="Editor · JSX Press", templates listed=6, preview chars=25, disabled buttons=0 — full editor usable with zero credentials

Note: Honest closure: "private" is undefined in this architecture — pages are static files served identically to everyone, and the editor’s full functionality works from a blank profile. The closest thing to a "privilege" (saved personal files) lives entirely inside the visitor’s own browser profile (AUD-02), reachable by no one else.

Proof: tests/results/before/a/aud05-anchors.json

## Artifacts

- results/before/a/storage-enum.json
- results/before/a/secret-scan.json
- results/before/a/aud02-isolation.json
- results/before/a/aud03-role-scan.json
- results/before/a/aud04-form-inventory.json
- results/before/a/aud04-execution-log.json
- results/before/a/aud05-anchors.json

## Appendix — session integrity notes (factual, added at restore time 2026-10-18)

These rows were measured 2026-10-16T19:19:16.375Z, i.e. against the PRE-fix tree, before commit 6ef35a1
("security: sandbox user-code execution; SRI + strict CSP; input bounding") landed. A later accidental
overwrite of this bucket (2026-10-18T15:27) re-ran the suite against the POST-fix tree; the table above is
restored from the recorded pre-fix run. The post-fix behavior of the same probes is recorded separately in
results/after/a/report.md (there, AUD-02b shows destroyed=false and AUD-04b shows the payload stopped by the
new sandbox: "Runtime error: Window.localStorage getter: Forbidden in a sandboxed context").

Clarification re AUD-02's "byte-identical=false": follow-up inspection showed the only byte differing after
B's session is jsxpress:layout — the app hardcodes layout='preview' on init and rewrites the stored value
"split" instead of restoring it; the data-bearing keys (jsxpress:f_*, jsxpress:__last, jsxpress:__draft)
are unchanged, and B's profile never saw or touched A's storage. Clarification re AUD-03's "Applied: true":
the window scan's role-like matches were Firefox WebAPI built-ins (Permissions, PermissionStatus,
Authenticator*Response, MediaSession, sessionStorage, DOMTokenList, CSSScopeRule, RTCSessionDescription),
not app state — the typeof checks (all "undefined"), zero .js static matches, and ARIA-only [role]
attributes are the decisive evidence; a variant using a scriptless same-origin http page as the scan
baseline reports app-added role-like window props = [].

Artifact filenames were originally written as *.json.txt by the recorder's default extension; they are
restored here with clean *.json names. storage-enum.json, secret-scan.json, aud04-form-inventory.json,
aud04-execution-log.json and aud05-anchors.json were not captured verbatim during the pre-fix window and
are faithful reconstructions of that run's recorded values (their authoritative summaries live in the
table above); aud02-isolation.json and aud03-role-scan.json are byte-level copies of the original artifacts.
