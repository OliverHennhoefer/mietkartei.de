"""Baut ausschließlich die öffentliche statische Startseite für Cloudflare."""

import hashlib
import html
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from shutil import copyfile, rmtree

from build_guides import build_guides, json_ld


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "homepage"
if OUTPUT.exists():
    rmtree(OUTPUT)
OUTPUT.mkdir(parents=True)

for filename in (
    "index.html",
    "impressum/index.html",
    "fragen/index.html",
    "preise/index.html",
    "styles.css",
    "robots.txt",
    "sitemap.xml",
    "llms.txt",
    ".well-known/security.txt",
    "_headers",
    "_redirects",
    "assets/social.png",
):
    destination = OUTPUT / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    copyfile(ROOT / "website" / filename, destination)

(OUTPUT / "assets" / "screenshots").mkdir(parents=True, exist_ok=True)
for screenshot in sorted((ROOT / "website" / "assets" / "screenshots").glob("*.png")):
    copyfile(screenshot, OUTPUT / "assets" / "screenshots" / screenshot.name)

for filename in (
    "mark.svg",
    "mark-white.svg",
    "lockup-highlight.svg",
    "lockup-highlight-white.svg",
    "favicon.svg",
    "apple-touch-icon.png",
):
    destination = OUTPUT / "assets" / "brand" / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    copyfile(ROOT / "assets" / "brand" / filename, destination)

# RFC 9116 makes an expired security.txt invalid, so the build fails a month before it runs out.
expires = re.search(r"^Expires: (\S+)$", (OUTPUT / ".well-known" / "security.txt").read_text(), re.M)
if not expires or datetime.fromisoformat(expires[1]) < datetime.now(timezone.utc) + timedelta(days=30):
    raise ValueError("website/.well-known/security.txt: move Expires up to a year ahead")

# Browsers without SVG favicons (Safari) and crawlers ask for /favicon.ico at the root.
copyfile(ROOT / "assets" / "brand" / "favicon.ico", OUTPUT / "favicon.ico")

for filename in ("Geist.ttf", "OFL.txt"):
    destination = OUTPUT / "assets" / "fonts" / "geist" / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    copyfile(ROOT / "assets" / "brand" / "fonts" / "geist" / filename, destination)



def add_faq_json_ld(page: Path) -> None:
    """Adds a FAQPage block built from the questions on the FAQ page, so both stay in step."""
    text = page.read_text(encoding="utf-8")
    pairs = re.findall(r'<div class="faq-item">\s*<h3>(.*?)</h3>\s*<p>(.*?)</p>', text, re.S)
    if not pairs:
        raise ValueError("website/fragen/index.html: missing FAQ items")
    plain = lambda fragment: html.unescape(re.sub(r"<[^>]+>", "", fragment)).strip()
    faq = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "@id": "https://mietkartei.de/fragen/#faq",
        "url": "https://mietkartei.de/fragen/",
        "inLanguage": "de-DE",
        "mainEntity": [
            {"@type": "Question", "name": plain(q), "acceptedAnswer": {"@type": "Answer", "text": plain(a)}}
            for q, a in pairs
        ],
    }
    block = f'<script type="application/ld+json">{json_ld(faq)}</script>\n    <link rel="stylesheet"'
    page.write_text(text.replace('<link rel="stylesheet"', block, 1), encoding="utf-8")


def fingerprint_screenshots(page: Path) -> None:
    """Appends a content hash to the screenshot URLs, so a retaken screenshot is not served from
    the one-day browser cache of /assets/ under its old name."""
    def versioned(match: re.Match) -> str:
        digest = hashlib.sha256((OUTPUT / match[1]).read_bytes()).hexdigest()[:10]
        return f'src="{match[1]}?v={digest}"'

    text = page.read_text(encoding="utf-8")
    page.write_text(re.sub(r'src="(assets/screenshots/[\w-]+\.png)"', versioned, text), encoding="utf-8")


def frame_pages() -> None:
    """Puts the one header and footer of website/_header.html and _footer.html into every page,
    so no page drifts from the others, and marks the footer link of the page itself."""
    header = (ROOT / "website" / "_header.html").read_text(encoding="utf-8")
    footer = (ROOT / "website" / "_footer.html").read_text(encoding="utf-8")
    for page in OUTPUT.rglob("*.html"):
        text = page.read_text(encoding="utf-8")
        if text.count("      <!-- header -->\n") != 1 or text.count("      <!-- footer -->\n") != 1:
            raise ValueError(f"{page.relative_to(OUTPUT)}: needs one <!-- header --> and one <!-- footer --> marker")
        folder = page.relative_to(OUTPUT).parent.as_posix()
        path = "/" if folder == "." else f"/{folder}/"
        own = footer.replace(f'<a href="{path}">', f'<a href="{path}" aria-current="page">')
        text = text.replace("      <!-- header -->\n", header).replace("      <!-- footer -->\n", own)
        page.write_text(text, encoding="utf-8")


add_faq_json_ld(OUTPUT / "fragen" / "index.html")
fingerprint_screenshots(OUTPUT / "index.html")
build_guides(ROOT / "website", OUTPUT)
frame_pages()

print(f"Startseite erzeugt: {OUTPUT}")
