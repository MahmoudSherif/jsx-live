/* JSX Press — editor boot. Runs before the CDN bundle.
   Moved out of editor.html's inline script so the app page can carry a
   strictly-allowlisting CSP with no 'unsafe-inline' for scripts. */
window.addEventListener('error', function (e) {
  // Suppress opaque cross-origin "Script error." noise from loaded CDN libs
  if (e.message === 'Script error.' && !e.error) {
    e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    return false;
  }
}, true);
