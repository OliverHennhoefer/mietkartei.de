# Maintaining the public homepage

The static landing page at `https://mietkartei.de/` is written for private landlords, many of them between 40 and 70: calm, factual and complete rather than loud. Large text (body copy 16 to 21px), generous whitespace and no motion. It scrolls through a centred hero with a link to the latest guide, the Auswertung in an app window on a soft neon haze with two floating details, four facts, the four yearly tasks with their screenshots (Nebenkostenabrechnung first), a grid of all areas of the app, a dark band with a sample chat with Claude, four promises about data and "So fängst du an": demo, moving over from Excel, and choosing hosted or self-hosted with a link to the pricing page. The demo is the main call to action, so the page does not open with a sales pitch. The neon block of the logo marks only single facts. It consists of HTML and CSS. Geist, the register symbol/wordmark combination and the favicon are taken from the shared brand assets; the page needs no JavaScript.

## Preview

Run the following commands in the repository root with Python 3:

```sh
python3 scripts/build_homepage.py
python3 -m http.server 8002 --bind 127.0.0.1 --directory dist/homepage
```

Then open [http://127.0.0.1:8002](http://127.0.0.1:8002). Rebuild the output after changes. Check the page at 1440, 1024 and 390 pixels wide in light and dark mode, that nothing scrolls sideways, and the links.

## Files

| Path | Purpose |
| --- | --- |
| `website/index.html` | Public German homepage |
| `website/_header.html`, `website/_footer.html` | The one header and footer of every page; the build puts them in place of the `<!-- header -->` and `<!-- footer -->` markers and marks the footer link of the page itself |
| `website/preise/index.html`, `website/fragen/index.html` | Pricing and FAQ pages |
| `website/impressum/index.html` | Legal notice (Impressum) with provider and contact details |
| `website/styles.css` | Styles, including light and dark colors |
| `website/assets/screenshots/` | The homepage screenshots, all 1600 × 1000: whole screens (Auswertung in the hero, Mietkonto) and enlarged details (Rendite, a bank transaction, one tenant's share of the operating cost statement), taken by `npm run screenshots` in `app/`. The numbers in the floating details and the sample chat in `website/index.html` are copied from these screenshots; keep them in step when the demo data changes |
| `website/ratgeber/*.md` | Guides, one Markdown file per guide; the file name is the URL slug |
| `website/ratgeber/_layout.html` | Page frame for the guide index and the guides |
| `website/_headers` | HTTP response headers for Cloudflare |
| `website/_redirects` | Permanent redirects for moved pages, such as the former `/neuigkeiten/` URLs |
| `website/robots.txt` | Instructions for search engines, pointing to the sitemap |
| `website/sitemap.xml` | List of the public pages; add every new page here |
| `website/llms.txt` | Plain-text summary of the product for AI assistants and AI search ([llms.txt](https://llmstxt.org/)) |
| `website/.well-known/security.txt` | Security contact per [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116); the build fails 30 days before its `Expires` date, so move it a year ahead then |
| `website/assets/social.png` | Preview image (1200×630) for links shared on social media and in messengers, used by the homepage, guides, docs and app; rendered by `npm run social-images` in `app/` |
| `website/wrangler.toml` | Cloudflare Worker and custom domain |
| `scripts/build_homepage.py` | Builds the public output with the shared assets |
| `scripts/build_guides.py` | Renders the guide pages, the RSS feed and their sitemap and `llms.txt` entries |
| `.github/workflows/websites.yml` | Checks and deploys homepage and documentation |
| `dist/homepage/` | Generated output; not committed |

The build copies only the listed public files, the homepage screenshots (linked with a content hash, so a retaken screenshot bypasses the one-day cache of `/assets/`), the black and white register symbols and wordmark combinations, the favicon and the original font with its OFL license. The font and brand SVGs are maintained in `assets/brand/`. The homepage, legal-notice and guide headers combine the larger register symbol with the Geist Semibold wordmark and a neon yellow block behind "kartei" that is as tall as the symbol, using `lockup-highlight.svg` in light mode and `lockup-highlight-white.svg` in dark mode. The combination is 52px high on desktop and 44px on smaller screens. The favicon uses the small register symbol on a black background. Next to `favicon.svg`, the build ships `/favicon.ico` (16, 32 and 48 px) for Safari and crawlers and `apple-touch-icon.png` (180 px) for home screen icons, both rendered from `favicon.svg`. Earlier wordmarks and design studies are not copied into the public output. Page-specific illustrations live in `website/assets/`.

## Page frame

Every page but the homepage follows the pricing page: the shared header, `<main class="subpage …">` with the "← Zur Startseite" link first, then an eyebrow, the `h1` and an optional lead in one size, and the shared footer. Text pages (legal notice, guides) keep a reading width of 720px, the FAQ 1080px. The signed-out app pages (`app/src/lib/components/WebsiteHeader.svelte`, `WebsiteFooter.svelte`) and the documentation (`docs/overrides/main.html`) copy this frame in the same pixel sizes; change them together with `website/_header.html`, `_footer.html` and `website/styles.css`.

## Guides

Guides live in `website/ratgeber/` as Markdown files with a front matter block:

```markdown
---
title: Fernablesbare Heizkostenzähler: Die Frist endet am 31. Dezember 2026
date: 2026-10-24
category: Mietrecht
description: One or two sentences, at most about 160 characters, used for search results, link previews, the feed and the list.
---
Body text. Supported: paragraphs, `## headings`, `- lists`, `**bold**` and `[links](https://…)`.
```

The build renders `/ratgeber/` (all guides, newest first), `/ratgeber/<slug>/` per guide with `BlogPosting` structured data, and `/ratgeber/feed.xml` (RSS). It replaces the `<!-- guides -->` marker in `website/llms.txt` with the guide links and the `<!-- latest-guide -->` marker of the homepage with a link to the newest guide, and appends the guide pages to `sitemap.xml`, so a new guide needs no other edit. Use the categories `Mietrecht` and `Betriebskosten`; product updates do not belong here. Guides link the law on gesetze-im-internet.de and end with the note that they are general information, not legal advice.

## Search engines and AI search

Each page has a German title in the form `Page | mietkartei` (the homepage: `mietkartei – Hausverwaltung für Privatvermieter`), a description of at most about 160 characters and a canonical URL. The homepage also carries Open Graph tags for link previews and structured data (`Organization`, `WebSite`, `SoftwareApplication`) as JSON-LD. When the product changes, keep the description, the `featureList` in the JSON-LD and `llms.txt` in line with the README. A new page needs its own title, description and canonical URL and an entry in `sitemap.xml`.

The legal notice is available at `/impressum/`. Keep the provider and contact details current and remove optional details that do not apply.

## Deployment

Cloudflare serves the page as static assets of the Worker **mietkartei-de**. The custom domain is `mietkartei.de`. The documentation uses its own Cloudflare Worker at `docs.mietkartei.de`.

The shared GitHub Actions workflow **Websites** automatically deploys relevant changes from the production branch `main` in the shared environment **production**, which the documentation uses as well. The [deployment guide](DEPLOYMENT.md) describes the setup and the replacement of the previous Cloudflare Git integration.

For a manual deployment with Wrangler already signed in:

```sh
python3 scripts/build_homepage.py
npx wrangler@4 deploy --config website/wrangler.toml
```

Manual Wrangler deployments create no GitHub environment entry. For a redeploy that shows up in the deployment history, use **Actions → Websites → Run workflow → Branch: main**.
