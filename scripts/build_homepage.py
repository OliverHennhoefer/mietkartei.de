"""Baut ausschließlich die öffentliche statische Startseite für Cloudflare."""

from pathlib import Path
from shutil import copyfile, rmtree


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "homepage"
if OUTPUT.exists():
    rmtree(OUTPUT)
OUTPUT.mkdir(parents=True)

for filename in ("index.html", "impressum/index.html", "styles.css", "robots.txt", "_headers"):
    destination = OUTPUT / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    copyfile(ROOT / "website" / filename, destination)

illustration = OUTPUT / "assets" / "house-blueprint.svg"
illustration.parent.mkdir(parents=True, exist_ok=True)
copyfile(ROOT / "website" / "assets" / "house-blueprint.svg", illustration)

for filename in (
    "mark.svg",
    "mark-white.svg",
    "favicon.svg",
):
    destination = OUTPUT / "assets" / "brand" / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    copyfile(ROOT / "assets" / "brand" / filename, destination)

for filename in ("Geist.ttf", "OFL.txt"):
    destination = OUTPUT / "assets" / "fonts" / "geist" / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    copyfile(ROOT / "assets" / "brand" / "fonts" / "geist" / filename, destination)

print(f"Startseite erzeugt: {OUTPUT}")
