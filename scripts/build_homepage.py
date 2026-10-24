"""Baut ausschließlich die öffentliche statische Startseite für Cloudflare."""

from pathlib import Path
from shutil import copyfile, rmtree

from build_news import build_news


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "homepage"
if OUTPUT.exists():
    rmtree(OUTPUT)
OUTPUT.mkdir(parents=True)

for filename in (
    "index.html",
    "impressum/index.html",
    "styles.css",
    "robots.txt",
    "sitemap.xml",
    "llms.txt",
    "_headers",
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

build_news(ROOT / "website", OUTPUT)

print(f"Startseite erzeugt: {OUTPUT}")
