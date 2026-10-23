# Maintaining the public homepage

The static landing page at `https://mietkartei.de/` summarizes the product on a single screen: positioning, the links to the app and the documentation, two app screenshots and four value points. On desktop it fits into one viewport without scrolling (checked down to 1280×720 and 1024×768); on narrow screens it stacks and scrolls. It consists of HTML and CSS. Geist, the register symbol/wordmark combination and the favicon are taken from the shared brand assets; the page needs no JavaScript.

## Preview

Run the following commands in the repository root with Python 3:

```sh
python3 scripts/build_homepage.py
python3 -m http.server 8002 --bind 127.0.0.1 --directory dist/homepage
```

Then open [http://127.0.0.1:8002](http://127.0.0.1:8002). Rebuild the output after changes. Check that the page still fits one screen at 1280×720 and 1024×768, the layout on small screens and the links.

## Files

| Path | Purpose |
| --- | --- |
| `website/index.html` | Public German homepage |
| `website/impressum/index.html` | Legal notice (Impressum) with provider and contact details |
| `website/styles.css` | Styles, including light and dark colors |
| `website/assets/screenshots/` | App screenshots shown on the homepage, copied from `assets/screenshots/` (`npm run screenshots` in `app/`) |
| `website/_headers` | HTTP response headers for Cloudflare |
| `website/robots.txt` | Instructions for search engines |
| `website/wrangler.toml` | Cloudflare Worker and custom domain |
| `scripts/build_homepage.py` | Builds the public output with the shared assets |
| `.github/workflows/websites.yml` | Checks and deploys homepage and documentation |
| `dist/homepage/` | Generated output; not committed |

The build copies only the listed public files, the two homepage screenshots, the black and white register symbols and wordmark combinations, the favicon and the original font with its OFL license. The font and brand SVGs are maintained in `assets/brand/`. Both the homepage and legal-notice header combine the larger register symbol with the Geist wordmark, using `lockup.svg` in light mode and `lockup-white.svg` in dark mode. The combination is 52px high on desktop and 44px on smaller screens. The favicon uses the small register symbol on a black background. Earlier wordmarks and design studies are not copied into the public output. Page-specific illustrations live in `website/assets/`.

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
