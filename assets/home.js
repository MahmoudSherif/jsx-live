/* JSX Press — landing page interactions.
   Renders the template gallery, today's date, and the live demo button. */

(function () {
  // Today's date in editorial style: "26 April 2026"
  const today = new Date();
  const formatted = today.toLocaleDateString(undefined, {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const dateEls = document.querySelectorAll('#todayDate, #todayDate2');
  dateEls.forEach((el) => { el.textContent = formatted; });

  // ------------------------------------------------------------------
  //  Template gallery
  // ------------------------------------------------------------------
  const grid = document.getElementById('templateGrid');
  if (grid && window.JSX_TEMPLATES) {
    window.JSX_TEMPLATES.forEach((tpl, i) => {
      const card = document.createElement('a');
      card.className = 'tpl-card';
      card.href = `editor.html?template=${tpl.id}`;
      card.style.setProperty('--i', i);

      // Take the first ~5 lines of code as a preview
      const codePreview = tpl.code
        .split('\n')
        .filter((line, idx) => idx < 14 && (line.trim() || idx > 0))
        .slice(0, 8)
        .join('\n');

      card.innerHTML = `
        <div class="tpl-meta">
          <span class="tpl-num">${String(i + 1).padStart(2, '0')}</span>
          <span class="tpl-kind">${tpl.kind}</span>
        </div>
        <h3 class="tpl-name">${tpl.name}</h3>
        <p class="tpl-desc">${tpl.description}</p>
        <pre class="tpl-code"><code>${escapeHtml(codePreview)}</code></pre>
        <div class="tpl-action">
          <span>Open in editor</span>
          <span class="tpl-arrow">→</span>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  // ------------------------------------------------------------------
  //  Live demo button
  // ------------------------------------------------------------------
  const btn = document.getElementById('demoBtn');
  const countEl = document.getElementById('demoCount');
  const labelEl = document.getElementById('demoLabel');
  if (btn && countEl && labelEl) {
    let n = 0;
    btn.addEventListener('click', () => {
      n++;
      countEl.textContent = n;
      labelEl.textContent = n === 1 ? 'time' : 'times';
      btn.classList.remove('pulse');
      // restart animation
      void btn.offsetWidth;
      btn.classList.add('pulse');
    });
  }
})();
