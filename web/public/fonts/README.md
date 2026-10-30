# Local interface fonts

Geist Sans and Geist Mono Latin variable WOFF2 subsets, copied without modification from the installed Next.js 16.3.5 distribution (`dist/next-devtools/server/font`).

Copyright Vercel / basement.studio. Distributed under the SIL Open Font License; see LICENSE.txt. Official source: https://github.com/vercel/geist-font

`globals.css` loads these locally using font-display: swap. Chinese glyphs use the platform Chinese sans-serif fallback. `scripts/sync-showcase.mjs` copies this complete directory, including license, into the demo build.
