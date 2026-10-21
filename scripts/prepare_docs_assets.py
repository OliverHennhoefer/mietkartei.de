"""Übernimmt die gemeinsamen Wortmarken und die Schrift in die Dokumentation."""

from pathlib import Path
from shutil import copyfile


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "brand"
DESTINATION = ROOT / "docs" / "assets" / "brand"

DESTINATION.mkdir(parents=True, exist_ok=True)
for filename in (
    "logo.svg",
    "logo-white.svg",
    "favicon.svg",
    "fonts/geist/Geist.ttf",
    "fonts/geist/OFL.txt",
):
    destination = DESTINATION / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    copyfile(SOURCE / filename, destination)
