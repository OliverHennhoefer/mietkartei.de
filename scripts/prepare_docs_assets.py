"""Übernimmt die gemeinsamen Wortmarken in die Dokumentation."""

from pathlib import Path
from shutil import copyfile


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "brand"
DESTINATION = ROOT / "docs" / "assets" / "brand"

DESTINATION.mkdir(parents=True, exist_ok=True)
for filename in ("logo.svg", "logo-white.svg"):
    copyfile(SOURCE / filename, DESTINATION / filename)
