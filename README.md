# JSX Live

A self-hostable JSX playground with editorial-grade design. No accounts, no cloud, no build step — just static files you can drop on any host and rebrand as your own.

## Why JSX Live?

Browser-based React playgrounds are not a new idea. CodeSandbox, StackBlitz, CodePen, and others already dominate the category as full-featured SaaS products. JSX Live is not trying to compete with them. It is built around a different set of constraints:

- **Static and self-hostable.** The entire product is a handful of HTML, CSS, and JS files. No backend, no database, no account system. Drop it on GitHub Pages, Cloudflare Pages, or any web host you control.
- **Designed, not just functional.** Most playgrounds look like developer tools. JSX Live is laid out like a publication, with editorial typography and a coherent visual system you can re-theme in one CSS variable.
- **Yours to fork.** Released under MIT — clone it, rebrand it, charge for your hosted version. The codebase is small enough to read in an afternoon.
- **Privacy by default.** Code never leaves the browser. Files persist in `localStorage`. Sharing happens via base64-encoded URL hashes, not server uploads.

If you want a polished cloud IDE with npm support, collaboration, and dashboards, use one of the incumbents. If you want a small, owned, redesignable JSX scratchpad, this is for you.

## Features

- Zero-configuration JSX editor — Babel transpiles in the browser, React 18 renders the output
- Named React imports (`import { useState } from 'react'`) without a module bundler
- Tailwind utility classes scoped to the preview pane
- Local file persistence via `localStorage`
- Shareable URLs with base64-encoded source in the hash fragment
- Installable as a PWA
- Starter templates shared between the landing page and the editor

## Project Structure

```
jsx-live/
├── index.html              Landing page (hero, features, templates, FAQ)
├── editor.html             Editor application
├── manifest.json           PWA manifest
├── .nojekyll               Disables Jekyll processing on GitHub Pages
├── README.md               This file
└── assets/
    ├── site.css            Shared typography and design tokens
    ├── editor.css          Editor-specific dark-mode overrides
    ├── home.js             Landing page interactions
    ├── editor.js           Editor logic (run, save, share, library)
    └── templates.js        Starter templates
```

## Deployment

### GitHub Pages

1. Create a public repository (e.g., `jsx-live`).
2. Upload the contents of this directory to the repository root. `index.html` must sit at `/index.html`.
3. Navigate to **Settings → Pages**, set **Source** to *Deploy from a branch*, select the `main` branch and `/ (root)` folder, then save.
4. The site will be available at `https://<username>.github.io/jsx-live/` within a minute.

### Other Static Hosts

The project requires no build step and runs on any static host:

- **Cloudflare Pages** — Connect the repository; leave the build command empty and set the output directory to `.`.
- **Vercel / Netlify** — Import the repository or drag-and-drop the folder. No build configuration needed.
- **Self-hosted** — Upload the folder to your web root via SFTP.
- **Local development** — Run `python -m http.server 8000` and visit `http://localhost:8000/`.

### Custom Domain

Add a `CNAME` file at the repository root containing your domain (e.g., `jsx.yourdomain.com`), then create a DNS `CNAME` record pointing to `<username>.github.io`.

## Configuration

### Branding

Search for `JSX Live` and the `J` logo mark across `index.html`, `editor.html`, `manifest.json`, and the inline favicon data URLs. Replace as needed.

### Theming

Design tokens are defined as CSS custom properties at the top of `assets/site.css`. The accent color (`--acid`) drives the entire palette — changing it re-themes the product.

### Templates

Edit `assets/templates.js` to add or remove starter templates. Both the landing page gallery and the editor sidebar consume this file.

### Copy

All landing-page content lives in `index.html`, including the FAQ section near the bottom of the file.

## How It Works

JSX entered into the editor is transpiled in-browser by Babel Standalone and rendered by React 18. Named hook imports such as `import { useState, useEffect } from 'react'` resolve to the global `React` namespace, so no module resolution is required. Tailwind's Play CDN is configured to apply only within the `#preview` element, preventing utility classes from affecting the editor UI.

Saved files are written to `localStorage`. Sharing produces a URL whose hash fragment contains a base64-encoded copy of the source — recipients open the link and load the exact same code locally, with no server round-trip.

## Limitations

These are intentional, not bugs:

- **No npm packages.** Only libraries available on a CDN can be imported. If you need arbitrary npm support, use CodeSandbox or StackBlitz.
- **No multi-file projects.** Each saved file is self-contained. This is a scratchpad, not an IDE.
- **No collaboration.** Sharing is one-way via URL. No live cursors, no rooms, no accounts.
- **Browser storage only.** Clearing `localStorage` deletes your saved files. There is no cloud backup.

## License

Released under the [MIT License](LICENSE). You are free to use, modify, redistribute, and commercialize the code and design.
