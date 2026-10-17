/* =============================================================================
   JSX Press — editor logic.
   Adapted from the desktop viewer for the browser-only context.

   Sections:
     1. State + constants
     2. DOM refs + helpers
     3. Layout (split / preview / editor)
     4. Run pipeline (preprocess → Babel → React)
     5. Library (localStorage)
     6. File I/O (upload / download / share via URL)
     7. Wiring + init (URL params, templates, keyboard shortcuts)
   ============================================================================= */

(function () {
  'use strict';

  // -------------------------------------------------------------------- 1. State

  const STORAGE_PREFIX = 'jsxpress:';
  const DRAFT_KEY      = 'jsxpress:__draft';
  const LAST_FILE_KEY  = 'jsxpress:__last';

  let currentKey = null;
  let dirty = false;
  let runTimer = null;
  let layout = 'preview';
  let editorSize = parseFloat(localStorage.getItem('jsxpress:editorSize')) || 50;
  let userPickedLayout = false;

  const DEFAULT_CODE =
    "// Welcome to JSX Press.\n" +
    "// Define a component named App (or use 'export default') — it renders automatically.\n" +
    "// Edit anything; preview updates after a brief pause. Hit ⌘↵ to force a run.\n" +
    "\n" +
    "function App() {\n" +
    "  const [count, setCount] = React.useState(0);\n" +
    "\n" +
    "  return (\n" +
    "    <div style={{\n" +
    "      fontFamily: 'system-ui, sans-serif',\n" +
    "      padding: '52px 32px',\n" +
    "      textAlign: 'center',\n" +
    "      background: 'linear-gradient(180deg, #f8f7f1, #ece9dc)',\n" +
    "      minHeight: '100vh',\n" +
    "      color: '#2a2620'\n" +
    "    }}>\n" +
    "      <h1 style={{ fontSize: 48, margin: 0, fontFamily: 'Georgia, serif', fontWeight: 400 }}>\n" +
    "        Hello, <em style={{ color: '#7a8a1f' }}>JSX</em>\n" +
    "      </h1>\n" +
    "      <button\n" +
    "        onClick={() => setCount(count + 1)}\n" +
    "        style={{\n" +
    "          marginTop: 32, padding: '14px 28px',\n" +
    "          background: '#2a2620', color: '#c8ff3e',\n" +
    "          border: 'none', borderRadius: 4, cursor: 'pointer',\n" +
    "          fontSize: 14, letterSpacing: '0.06em',\n" +
    "          textTransform: 'uppercase', fontWeight: 600\n" +
    "        }}>\n" +
    "        clicked {count} {count === 1 ? 'time' : 'times'}\n" +
    "      </button>\n" +
    "    </div>\n" +
    "  );\n" +
    "}\n";

  // Hooks/exports we transparently bind from `import { ... } from 'react'`
  const REACT_NAMED_EXPORTS = [
    'useState', 'useEffect', 'useRef', 'useMemo', 'useCallback',
    'useContext', 'useReducer', 'useLayoutEffect', 'useImperativeHandle',
    'useDebugValue', 'useId', 'useTransition', 'useDeferredValue',
    'useSyncExternalStore', 'useInsertionEffect',
    'createContext', 'createRef', 'forwardRef', 'memo', 'lazy', 'Suspense',
    'Fragment', 'StrictMode', 'Profiler', 'Children', 'cloneElement',
    'createElement', 'isValidElement', 'Component', 'PureComponent',
  ];

  // -------------------------------------------------------------------- 2. DOM + helpers

  const $ = (id) => document.getElementById(id);
  const els = {
    code:        $('code'),
    preview:     $('preview'),
    log:         $('log'),
    status:      $('status'),
    filename:    $('filename'),
    dirtyDot:    $('dirtyDot'),
    toast:       $('toast'),
    workspace:   $('workspace'),
    splitter:    $('splitter'),
    fileInput:   $('fileInput'),
    fileList:    $('fileList'),
    templateList:$('templateList'),
    fileCount:   $('fileCount'),
    empty:       $('emptyLibrary'),
    editToggle:  $('editToggle'),
    layoutBtns: {
      split:   $('layoutSplit'),
      preview: $('layoutPreview'),
      editor:  $('layoutEditor'),
    },
  };

  function log(msg, type) {
    type = type || 'info';
    const line = document.createElement('div');
    line.className = 'log-line ' + type;
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = new Date().toLocaleTimeString([], { hour12: false });
    line.appendChild(t);
    line.appendChild(document.createTextNode(String(msg)));
    els.log.appendChild(line);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function setStatus(text, cls) {
    els.status.textContent = text;
    els.status.className = 'pane-status' + (cls ? ' ' + cls : '');
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.remove('show'), 1600);
  }

  function setDirty(v) {
    dirty = v;
    els.dirtyDot.classList.toggle('dirty', v);
  }

  function escapeHtml(s) {
    // Escapes quotes/backticks too — safe in text nodes AND attribute values.
    return String(s).replace(/[&<>"'`]/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;',
      '"': '&quot;', "'": '&#39;', '`': '&#96;',
    }[c]));
  }

  // -------------------------------------------------------------------- 3. Layout

  function applyLayout() {
    els.workspace.classList.remove('split', 'preview-only', 'editor-only');
    if (layout === 'preview') els.workspace.classList.add('preview-only');
    else if (layout === 'editor') els.workspace.classList.add('editor-only');
    else els.workspace.classList.add('split');
    Object.entries(els.layoutBtns).forEach(([key, btn]) => {
      if (btn) btn.classList.toggle('active', key === layout);
    });
    if (els.editToggle) els.editToggle.textContent = layout === 'preview' ? '✎ Edit' : '▸ Preview';
    els.workspace.style.setProperty('--editor-size', editorSize + '%');
    localStorage.setItem('jsxpress:layout', layout);
  }
  function setLayout(mode) { layout = mode; applyLayout(); }

  (function setupSplitter() {
    let dragging = false, startX = 0, startSize = 50;
    els.splitter.addEventListener('mousedown', (e) => {
      if (layout !== 'split') return;
      dragging = true; startX = e.clientX; startSize = editorSize;
      els.splitter.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const totalWidth = els.workspace.clientWidth;
      const deltaPct = ((e.clientX - startX) / totalWidth) * 100;
      editorSize = Math.max(15, Math.min(85, startSize + deltaPct));
      els.workspace.style.setProperty('--editor-size', editorSize + '%');
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      els.splitter.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('jsxpress:editorSize', editorSize.toFixed(2));
    });
    els.splitter.addEventListener('keydown', (e) => {
      if (layout !== 'split') return;
      if (e.key === 'ArrowLeft')  { editorSize = Math.max(15, editorSize - 2); applyLayout(); }
      if (e.key === 'ArrowRight') { editorSize = Math.min(85, editorSize + 2); applyLayout(); }
    });
  })();

  // -------------------------------------------------------------------- 4. Run pipeline

  function preprocess(src) {
    const reactNames = new Set();
    const reactDomNames = new Set();
    const importRe = /^\s*import\s+(.+?)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm;
    src = src.replace(importRe, (full, clause, mod) => {
      const target = mod === 'react' ? reactNames
                   : mod === 'react-dom' || mod === 'react-dom/client' ? reactDomNames
                   : null;
      if (!target) return '';
      const m = clause.match(/\{([^}]+)\}/);
      if (m) {
        m[1].split(',').forEach((entry) => {
          const trimmed = entry.trim();
          if (!trimmed) return;
          const parts = trimmed.split(/\s+as\s+/);
          const exported = parts[0].trim();
          const local = (parts[1] || parts[0]).trim();
          if (exported && local) target.add(local + '=' + exported);
        });
      }
      return '';
    });
    src = src.replace(/^\s*import\s+['"][^'"]+['"]\s*;?\s*$/gm, '');

    let prelude = '';
    if (reactNames.size) {
      prelude += 'const { ' + [...reactNames].map(p => {
        const [local, exp] = p.split('=');
        return local === exp ? local : `${exp}: ${local}`;
      }).join(', ') + ' } = React;\n';
    }
    if (reactDomNames.size) {
      prelude += 'const { ' + [...reactDomNames].map(p => {
        const [local, exp] = p.split('=');
        return local === exp ? local : `${exp}: ${local}`;
      }).join(', ') + ' } = ReactDOM;\n';
    }

    src = src.replace(/^\s*export\s+default\s+/m, 'var __default = ')
             .replace(/^\s*export\s+(const|let|var|function|class)\s+/gm, '$1 ');
    return prelude + src;
  }

  function showError(title, body) {
    els.preview.innerHTML =
      '<pre style="margin:0;padding:24px;background:#fff5f3;color:#9a2520;font-family:ui-monospace,monospace;font-size:13px;line-height:1.55;white-space:pre-wrap;border-left:4px solid #ff6b54">' +
      '<strong style="display:block;margin-bottom:8px;font-family:Georgia,serif;font-size:16px;font-weight:400">' +
      escapeHtml(title) + '</strong>' + escapeHtml(body) + '</pre>';
  }

  function showHint(html) {
    els.preview.innerHTML =
      '<div style="padding:48px 36px;color:#888;font-family:Georgia,serif;text-align:center;font-size:15px;line-height:1.6;font-style:italic">' +
      html + '</div>';
  }

  // -------------------------------------------------------------------- 4. Run pipeline (sandboxed)
  //
  //  SECURITY BOUNDARY — read before changing this section.
  //  User code is transpiled on the app origin (Babel) but EXECUTED inside
  //  sandbox-wrap.html, loaded into an iframe with sandbox="allow-scripts"
  //  and NO allow-same-origin. That document has an opaque origin: it cannot
  //  read or write this app's localStorage, cookies, DOM, or history.
  //  Without that boundary a share link (#code=...) could exfiltrate a
  //  visitor's entire saved library with zero interaction. Every reply from
  //  the sandbox is matched against the current run's nonce so stale frames
  //  can't confuse us.

  let sandboxNonce = 0;
  let sandboxFrame = null;
  let awaitingReady = null; // { code, nonce } — waiting for the sandbox to boot

  function mountSandboxFrame() {
    els.preview.innerHTML = '';
    const frame = document.createElement('iframe');
    frame.className = 'preview-sandbox';
    frame.title = 'Rendered preview';
    frame.setAttribute('sandbox', 'allow-scripts'); // no allow-same-origin, ever
    frame.dataset.readySeen = '0';

    frame.addEventListener('load', () => {
      // Loads BEFORE the sandbox announced itself ('ready' handshake →
      // dataset.alive) are the wrapper's own initial boots — nothing to
      // verify. Any load AFTER the frame proved itself must still be ours:
      // ping it, and reset the frame if the ping fails (i.e. user code
      // navigated the sandbox somewhere else).
      if (frame.dataset.alive !== '1') return;
      verifyFrameStillOurs(frame);
    });
    els.preview.appendChild(frame);
    return frame;
  }

  function verifyFrameStillOurs(frame) {
    let answered = false;
    const nonceAtPing = sandboxNonce;
    const onAlive = (e) => {
      if (e.data && e.data.__jsxpress === true && e.data.kind === 'alive'
        && String(e.data.nonce) === String(nonceAtPing)) {
        answered = true;
        window.removeEventListener('message', onAlive);
        clearTimeout(timer);
      }
    };
    const timer = setTimeout(() => {
      window.removeEventListener('message', onAlive);
      if (answered) return;
      if (!frame.isConnected) return; // a later run already replaced it
      log('Preview left the sandbox (self-navigation). Reloading the default.', 'warn');
      setStatus('running', 'running');
      startSandboxExec(Babel.transform(DEFAULT_CODE, { presets: ['react'] }).code);
    }, 300);
    window.addEventListener('message', onAlive);
    try {
      frame.contentWindow.postMessage({ __jsxpress: true, kind: 'ping', nonce: nonceAtPing }, '*');
    } catch (_) {
      clearTimeout(timer);
      window.removeEventListener('message', onAlive);
    }
  }

  function onSandboxMessage(e) {
    const d = e.data;
    if (!d || d.__jsxpress !== true) return;

    if (d.kind === 'ready') {
      if (awaitingReady && String(d.nonce) === String(awaitingReady.nonce)) {
        if (sandboxFrame) sandboxFrame.dataset.alive = '1';
        try {
          e.source.postMessage(
            { __jsxpress: true, kind: 'exec', code: awaitingReady.code, nonce: awaitingReady.nonce },
            '*'
          );
        } catch (err) {
          log('Could not hand code to the preview sandbox: ' + err.message, 'error');
          showError('Sandbox error', err.message);
        }
        awaitingReady = null;
      }
      return;
    }

    // Everything else must come from the CURRENT run's sandbox.
    if (String(d.nonce) !== String(sandboxNonce)) return;

    switch (d.kind) {
      case 'error':
        setStatus('runtime error', 'error');
        log(d.message, 'error');
        showError('Runtime error', d.message);
        break;
      case 'no-component':
        setStatus('no component', 'error');
        log('No component found. Define `function App()` or use `export default`.', 'warn');
        showHint('No component defined.<br><br>Define <code>function App()</code> or use <code>export default</code>.');
        break;
      case 'rendered':
        setStatus('running', 'running');
        break;
    }
  }
  window.addEventListener('message', onSandboxMessage);

  function startSandboxExec(transpiledCode) {
    sandboxNonce += 1;
    const nonce = sandboxNonce;
    sandboxFrame = mountSandboxFrame();
    awaitingReady = { code: transpiledCode, nonce };
    // Nonce travels in the hash so the sandbox can echo it back and stray
    // messages from stale frames are discarded.
    sandboxFrame.src = 'sandbox-wrap.html#n=' + nonce;

    // If the sandbox never boots (CDN outage inside the frame), surface it
    // instead of spinning on "running…" forever.
    setTimeout(() => {
      if (awaitingReady && awaitingReady.nonce === nonce) {
        awaitingReady = null;
        setStatus('sandbox error', 'error');
        log('Preview sandbox did not start within 8s. Reload once you are online.', 'error');
        showError('Sandbox error', 'The preview sandbox did not start. Reload the page once you are online.');
      }
    }, 8000);
  }

  function run() {
    if (typeof Babel === 'undefined') {
      setStatus('libs missing', 'error');
      log('Babel did not load from cdnjs. Check your internet connection.', 'error');
      showError('Library load error', 'Babel did not load from cdnjs. Reload the page once you are connected.');
      return;
    }
    setStatus('running', 'running');

    let transpiled;
    try {
      transpiled = Babel.transform(preprocess(els.code.value), { presets: ['react'] }).code;
    } catch (err) {
      setStatus('compile error', 'error');
      log(err.message, 'error');
      showError('Compile error', err.message);
      return;
    }

    startSandboxExec(transpiled);
  }

  // -------------------------------------------------------------------- 5. Library

  function listFiles() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || key.indexOf(STORAGE_PREFIX) !== 0) continue;
      if (key === DRAFT_KEY || key === LAST_FILE_KEY ||
          key === 'jsxpress:layout' || key === 'jsxpress:editorSize') continue;
      try { out.push({ key, data: JSON.parse(localStorage.getItem(key)) }); }
      catch (_) {}
    }
    out.sort((a, b) => (b.data.updatedAt || 0) - (a.data.updatedAt || 0));
    return out;
  }

  function saveToLibrary(name, code) {
    const now = Date.now();
    if (currentKey) {
      let existing = null;
      try { existing = JSON.parse(localStorage.getItem(currentKey) || 'null'); } catch (_) {}
      if (existing && existing.name === name) {
        localStorage.setItem(currentKey, JSON.stringify({
          name, code, createdAt: existing.createdAt || now, updatedAt: now,
        }));
        setDirty(false); renderFileList(); toast('Saved'); return;
      }
    }
    const files = listFiles();
    for (const f of files) {
      if (f.data.name === name) {
        if (!confirm(`"${name}" already exists. Overwrite?`)) return;
        localStorage.setItem(f.key, JSON.stringify({
          name, code, createdAt: f.data.createdAt || now, updatedAt: now,
        }));
        currentKey = f.key; setDirty(false); renderFileList(); toast('Saved'); return;
      }
    }
    const key = STORAGE_PREFIX + 'f_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    localStorage.setItem(key, JSON.stringify({ name, code, createdAt: now, updatedAt: now }));
    localStorage.setItem(LAST_FILE_KEY, key);
    currentKey = key;
    setDirty(false); renderFileList(); toast('Saved to library');
  }

  function loadFromLibrary(key) {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    let val;
    try { val = JSON.parse(localStorage.getItem(key)); } catch (_) { return; }
    if (!val) return;
    els.code.value = val.code;
    els.filename.value = val.name;
    currentKey = key;
    localStorage.setItem(LAST_FILE_KEY, key);
    setDirty(false); renderFileList(); run();
  }

  function deleteLibraryEntry(key) {
    localStorage.removeItem(key);
    if (currentKey === key) currentKey = null;
    renderFileList();
  }

  function renderFileList() {
    const files = listFiles();
    els.fileCount.textContent = files.length;
    els.fileList.innerHTML = '';
    els.empty.style.display = files.length === 0 ? 'block' : 'none';
    files.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'file-item' + (currentKey === item.key ? ' active' : '');
      li.dataset.key = item.key;
      li.innerHTML = `
        <span class="file-icon">◇</span>
        <span class="file-name"></span>
        <button class="file-del" title="Delete">×</button>
      `;
      li.querySelector('.file-name').textContent = item.data.name;
      li.querySelector('.file-del').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete "${item.data.name}"?`)) deleteLibraryEntry(item.key);
      });
      li.addEventListener('click', () => loadFromLibrary(item.key));
      els.fileList.appendChild(li);
    });
  }

  function renderTemplateList() {
    if (!els.templateList || !window.JSX_TEMPLATES) return;
    els.templateList.innerHTML = '';
    window.JSX_TEMPLATES.forEach((tpl) => {
      const li = document.createElement('li');
      li.className = 'file-item template-item';
      li.innerHTML = `
        <span class="file-icon">◊</span>
        <span class="file-name"></span>
      `;
      li.querySelector('.file-name').textContent = tpl.name;
      li.title = tpl.description;
      li.addEventListener('click', () => loadTemplate(tpl.id));
      els.templateList.appendChild(li);
    });
  }

  function loadTemplate(id) {
    const tpl = (window.JSX_TEMPLATES || []).find((t) => t.id === id);
    if (!tpl) return;
    if (dirty && !confirm('Discard unsaved changes?')) return;
    els.code.value = tpl.code;
    els.filename.value = tpl.id + '.jsx';
    currentKey = null;
    setDirty(false);
    log('Loaded template: ' + tpl.name, 'ok');
    run();
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        name: els.filename.value, code: els.code.value, currentKey,
      }));
    } catch (_) {}
  }
  function loadDraft() {
    try {
      const v = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (!v) return false;
      els.code.value = v.code || '';
      els.filename.value = v.name || 'untitled.jsx';
      currentKey = v.currentKey || null;
      return true;
    } catch (_) { return false; }
  }

  // -------------------------------------------------------------------- 6. File I/O

  function triggerUpload() { els.fileInput.click(); }

  els.fileInput.addEventListener('change', () => {
    const file = els.fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      els.code.value = String(reader.result || '');
      els.filename.value = file.name;
      currentKey = null;
      setDirty(true);
      log('Uploaded: ' + file.name);
      run();
    };
    reader.readAsText(file);
    els.fileInput.value = '';
  });

  function download() {
    const name = els.filename.value.trim() || 'untitled.jsx';
    const blob = new Blob([els.code.value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Downloaded');
  }

  function share() {
    const payload = JSON.stringify({
      n: els.filename.value.trim() || 'untitled.jsx',
      c: els.code.value,
    });
    let encoded;
    try { encoded = btoa(unescape(encodeURIComponent(payload))); }
    catch (_) { toast('Encode failed'); return; }

    const url = location.origin + location.pathname + '#code=' + encoded;
    location.hash = 'code=' + encoded;

    const fallback = () => prompt('Copy this URL:', url);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        () => toast(url.length > 2000 ? 'Long URL copied (may be truncated)' : 'Link copied'),
        fallback
      );
    } else {
      fallback();
    }
  }

  function loadFromHash() {
    const m = /#code=([^&]+)/.exec(location.hash);
    if (!m) return false;
    // Cap shared payloads: a multi-megabyte link can't be loaded anyway
    // (URL length limits are far below this), and refusing here keeps the
    // decode+JSON.parse off the main thread entirely.
    if (m[1].length > 4096) {
      log('Shared link too large to decode (limit 4096 encoded chars).', 'warn');
      setStatus('share too large', 'error');
      return false;
    }
    try {
      const json = decodeURIComponent(escape(atob(m[1])));
      const payload = JSON.parse(json);
      els.code.value = payload.c || '';
      els.filename.value = payload.n || 'shared.jsx';
      currentKey = null;
      setDirty(true);
      log('Loaded shared link: ' + els.filename.value, 'ok');
      return true;
    } catch (e) {
      log('Could not decode shared link: ' + e.message, 'warn');
      return false;
    }
  }

  function loadFromQuery() {
    const params = new URLSearchParams(location.search);
    const tplId = params.get('template');
    if (tplId) {
      const tpl = (window.JSX_TEMPLATES || []).find((t) => t.id === tplId);
      if (tpl) {
        els.code.value = tpl.code;
        els.filename.value = tpl.id + '.jsx';
        currentKey = null;
        return true;
      }
    }
    return false;
  }

  // -------------------------------------------------------------------- 7. Wiring

  els.code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = els.code.selectionStart, en = els.code.selectionEnd;
      els.code.value = els.code.value.slice(0, s) + '  ' + els.code.value.slice(en);
      els.code.selectionStart = els.code.selectionEnd = s + 2;
    }
  });
  els.code.addEventListener('input', () => {
    setDirty(true);
    saveDraft();
    setStatus('editing…', 'running');
    clearTimeout(runTimer);
    runTimer = setTimeout(run, 500);
  });

  els.filename.addEventListener('input', () => { setDirty(true); saveDraft(); });
  els.filename.addEventListener('blur', () => {
    const v = els.filename.value.trim();
    if (!v) els.filename.value = 'untitled.jsx';
    else if (!/\.(jsx|js|mjs|txt)$/i.test(v)) els.filename.value = v + '.jsx';
  });

  $('newBtn').addEventListener('click', () => {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    els.code.value = DEFAULT_CODE;
    els.filename.value = 'untitled.jsx';
    currentKey = null;
    setDirty(false);
    renderFileList();
    run();
  });
  $('saveBtn').addEventListener('click', () => {
    saveToLibrary(els.filename.value.trim() || 'untitled.jsx', els.code.value);
  });
  $('uploadBtn').addEventListener('click', triggerUpload);
  $('downloadBtn').addEventListener('click', download);
  $('shareBtn').addEventListener('click', share);
  $('runBtn').addEventListener('click', run);

  els.editToggle.addEventListener('click', () => { userPickedLayout = true; setLayout(layout === 'preview' ? 'split' : 'preview'); });
  els.layoutBtns.split.addEventListener('click',   () => { userPickedLayout = true; setLayout('split'); });
  els.layoutBtns.preview.addEventListener('click', () => { userPickedLayout = true; setLayout('preview'); });
  els.layoutBtns.editor.addEventListener('click',  () => { userPickedLayout = true; setLayout('editor'); });

  document.addEventListener('keydown', (e) => {
    const cmd = e.ctrlKey || e.metaKey;
    if (!cmd) return;
    if (e.key === 'Enter') { e.preventDefault(); run(); }
    else if (e.key === 's') { e.preventDefault(); saveToLibrary(els.filename.value.trim() || 'untitled.jsx', els.code.value); }
    else if (e.key === 'o') { e.preventDefault(); triggerUpload(); }
    else if (e.key === '1') { e.preventDefault(); setLayout('split'); }
    else if (e.key === '2') { e.preventDefault(); setLayout('preview'); }
    else if (e.key === '3') { e.preventDefault(); setLayout('editor'); }
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  // ------------------------------- Init -------------------------------

  applyLayout();
  renderTemplateList();
  renderFileList();

  // Priority: ?template=id  >  #code=...  >  last library file  >  draft  >  default.
  let loaded = false;
  if (loadFromQuery()) loaded = true;
  else if (location.hash && loadFromHash()) loaded = true;
  else {
    const lastKey = localStorage.getItem(LAST_FILE_KEY);
    if (lastKey && localStorage.getItem(lastKey)) {
      try {
        const v = JSON.parse(localStorage.getItem(lastKey));
        if (v) {
          els.code.value = v.code || '';
          els.filename.value = v.name || 'untitled.jsx';
          currentKey = lastKey;
          renderFileList();
          loaded = true;
        }
      } catch (_) {}
    }
    if (!loaded && loadDraft()) loaded = true;
  }
  if (!loaded) els.code.value = DEFAULT_CODE;

  log('Ready.', 'ok');
  run();
})();
