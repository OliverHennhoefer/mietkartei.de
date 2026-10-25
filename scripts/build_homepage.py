"""Baut ausschließlich die öffentliche statische Startseite für Cloudflare."""

import html
import json
import re
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
    "_headers",
    "_redirects",
    "assets/social.png",
):
    destination = OUTPUT / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    copyfile(ROOT / "website" / filename, destination)

for filename in ("uebersicht.png", "abrechnung-mieter.png"):
    destination = OUTPUT / "assets" / "screenshots" / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    copyfile(ROOT / "website" / "assets" / "screenshots" / filename, destination)

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


add_faq_json_ld(OUTPUT / "fragen" / "index.html")
build_guides(ROOT / "website", OUTPUT)

print(f"Startseite erzeugt: {OUTPUT}")
