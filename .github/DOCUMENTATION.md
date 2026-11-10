# Maintaining the documentation

The public documentation is built with [Zensical](https://zensical.org/docs/) from `docs/`. Its address is `https://docs.mietkartei.de/`. It holds the German user guides: the start page, the guide to self-hosting and the how-to guides under `docs/anleitungen/`.

## Preview and build

Once `zensical.toml` and `docs/requirements.txt` are in place, run the following commands in the repository root with Python 3.12:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r docs/requirements.txt
python scripts/prepare_docs_assets.py
zensical serve
```

On Windows, activate the environment in PowerShell with `.venv\Scripts\Activate.ps1`. The preview is available at [http://127.0.0.1:8000](http://127.0.0.1:8000). Stop the server with `Ctrl+C`.

Before submitting, check the complete output:

```sh
python scripts/check_references.py
python scripts/prepare_docs_assets.py
zensical build --clean --strict
```

`check_references.py` needs only Python 3.11 and git. It fails when an address of the app, the demo or the documentation in the texts leads to no page, when a page is missing from the `llmstxt` sections in `zensical.toml` or from the links in `website/llms.txt`, when the text of a note box (`!!! note`) is not indented and the box would render empty, and when a file in `docs/` would be published although it is neither a page nor an asset; such a file belongs in `exclude_docs` in `zensical.toml`. Warnings, such as invalid internal links, make the build fail. The generated files in `site/` and `docs/assets/brand/` and the local environment are not committed. Also check the layout on small screens and in light and dark mode.

After changing the originals in `assets/brand/`, run `python scripts/prepare_docs_assets.py` again. It copies the black and white register symbols and wordmark combinations, the favicon and Geist with its OFL license. A running preview picks up the updated copies automatically. The script uses only the Python standard library and needs no symbolic links.

## Files

| Path | Purpose |
| --- | --- |
| `docs/index.md` | Start page |
| `docs/selbst-hosten.md` | Guide to self-hosting, on Cloudflare or with Docker |
| `docs/anleitungen/` | How-to guides, one page each |
| `docs/assets/screenshots/` | Screenshots of the guides, taken by `npm run screenshots` in `app/` |
| `assets/brand/` | Shared symbols, wordmark combinations, favicon and Geist font |
| `assets/brand/variants/` | Earlier design variants, not published |
| `docs/assets/stylesheets/` | Styles for the documentation only |
| `docs/assets/brand/` | Generated copies of the selected branding, favicon and Geist with its license |
| `scripts/prepare_docs_assets.py` | Copies the shared branding, favicon and font before preview and build |
| `scripts/check_references.py` | Checks addresses of the app and the documentation, both `llms.txt`, the note boxes and the published files; part of **Check websites** |
| `docs/requirements.in` | Zensical version to install |
| `docs/requirements.txt` | All docs build dependencies with pinned versions and hashes, generated from `requirements.in` |
| `zensical.toml` | Language, domain and appearance |
| `docs/wrangler.toml` | Cloudflare Worker for the documentation domain |
| `docs/_headers` | HTTP response headers for Cloudflare |
| `docs/robots.txt` | Instructions for search engines, pointing to the generated `sitemap.xml` |
| `docs/overrides/main.html` | Theme override: tab titles as `Page \| mietkartei`, link previews (Open Graph), and the website's header, way back to the homepage and footer in place of the theme's |
| `.github/workflows/websites.yml` | Required check and deployment of both websites |

The header is the website's (`website/_header.html`): the register symbol with the Geist wordmark and the neon block behind "kartei", 52px high on desktop and 44px on smaller screens (`lockup-highlight.svg`, `lockup-highlight-white.svg` in dark mode), and the "Anmelden" button to the app's sign-in page left of the GitHub icon. Under it stands the way back to the homepage, at the bottom the website's footer; see the page frame in [HOMEPAGE.md](HOMEPAGE.md). The colour scheme follows the system, as on the website, so there is no toggle. The browser icon uses the small white symbol on black. The [brand assets](../assets/brand/README.md) contain the vector construction, shared exports and the earlier Geist wordmarks with their original font and license. The page uses the same locally hosted Geist font as the homepage and app, with system fonts as a fallback. Search is disabled in `zensical.toml`.

Every page needs `title` and `description` in its front matter: they become the tab title, the search engine description and the link preview. Zensical generates `sitemap.xml` from `site_url`, and its `llmstxt` plugin writes `llms.txt` and `llms-full.txt` for AI assistants; add each new page to the `llmstxt` sections in `zensical.toml` and to the links in `website/llms.txt`.

## Cloudflare and domain

The Worker **mietkartei-de-docs** serves the Zensical output from `site/` at `https://docs.mietkartei.de/`. Language, page design and address are still configured in `zensical.toml`. `docs/wrangler.toml`, `docs/requirements.in` and `docs/requirements.txt` are not included in the public output.

The [deployment guide](DEPLOYMENT.md) describes the one-time setup of the GitHub secrets, the switch from the previous GitHub Pages CNAME to a Cloudflare custom domain, and the shared workflow for homepage and documentation.

Every pull request gets the required check **Check websites**, which always runs `scripts/check_references.py`. The actual Zensical build runs when relevant files change; these include the shared brand assets, the preparation script and the workflow file. After a successful check on `main`, the documentation is deployed in the shared GitHub environment **production**, which the homepage uses as well. The **Websites** workflow can also be started manually; deployments are limited to `main`.
