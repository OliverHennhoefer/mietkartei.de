# Maintaining the documentation

The public documentation is built with [Zensical](https://zensical.org/docs/) from `docs/`. Its address is `https://docs.mietkartei.de/`. The site starts with a single German placeholder page; full guides will follow with the application.

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
python scripts/prepare_docs_assets.py
zensical build --clean --strict
```

Warnings, such as invalid internal links, make the build fail. The generated files in `site/` and `docs/assets/brand/` and the local environment are not committed. Also check the layout on small screens and in light and dark mode.

After changing the originals in `assets/brand/`, run `python scripts/prepare_docs_assets.py` again. It copies both logos and the favicon. A running preview picks up the updated copies automatically. The script uses only the Python standard library and needs no symbolic links.

## Files

| Path | Purpose |
| --- | --- |
| `docs/index.md` | Public placeholder page |
| `assets/brand/` | Shared originals of the selected wordmarks |
| `assets/brand/variants/` | Earlier design variants, not published |
| `docs/assets/stylesheets/` | Styles for the documentation only |
| `docs/assets/brand/` | Generated copies of the selected wordmarks |
| `scripts/prepare_docs_assets.py` | Copies the shared wordmarks before preview and build |
| `docs/requirements.txt` | Pinned Zensical version |
| `zensical.toml` | Language, domain and appearance |
| `docs/wrangler.toml` | Cloudflare Worker for the documentation domain |
| `docs/_headers` | HTTP response headers for Cloudflare |
| `.github/workflows/websites.yml` | Required check and deployment of both websites |

The single-line wordmarks use the original outlines of Geist Medium (500). The [brand assets](../assets/brand/README.md) contain the original font, its license and instructions for exporting again. The page font uses locally available system fonts. Search stays disabled for the single placeholder page.

## Cloudflare and domain

The Worker **mietkartei-de-docs** serves the Zensical output from `site/` at `https://docs.mietkartei.de/`. Language, page design and address are still configured in `zensical.toml`. `docs/wrangler.toml` and `docs/requirements.txt` are not included in the public output.

The [deployment guide](DEPLOYMENT.md) describes the one-time setup of the GitHub secrets, the switch from the previous GitHub Pages CNAME to a Cloudflare custom domain, and the shared workflow for homepage and documentation.

Every pull request gets the required check **Check websites**. The actual Zensical build runs when relevant files change; these include the shared brand assets, the preparation script and the workflow file. After a successful check on `main`, the documentation is deployed in the shared GitHub environment **production**, which the homepage uses as well. The **Websites** workflow can also be started manually; deployments are limited to `main`.
