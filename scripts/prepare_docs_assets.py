"""Copy the shared branding and font into the documentation."""

from pathlib import Path
from shutil import copyfile


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "brand"
DESTINATION = ROOT / "docs" / "assets" / "brand"

DESTINATION.mkdir(parents=True, exist_ok=True)
for filename in (
    "mark.svg",
    "mark-white.svg",
    "lockup-highlight.svg",
    "lockup-highlight-white.svg",
    "favicon.svg",
    "fonts/geist/Geist.woff2",
    "fonts/geist/OFL.txt",
):
    destination = DESTINATION / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    copyfile(SOURCE / filename, destination)
