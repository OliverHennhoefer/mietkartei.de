"""Builds the README's tour (assets/screenshots/rundgang.webp) from the frames that
`npm run screenshots` in app/ takes, scaled to twice the 900 pixels the README shows them at:
each screen stands for three seconds, then fades into the next, and the last one back into the
first. Needs Pillow (pip install -r scripts/requirements-readme.txt)."""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FRAMES = ROOT / "assets" / "screenshots" / "rundgang"
OUTPUT = ROOT / "assets" / "screenshots" / "rundgang.webp"
HOLD_MS = 3000
FADE_STEPS = 7
FADE_STEP_MS = 50
SIZE = (1800, 1125)


def main() -> None:
    shots = [Image.open(path).convert("RGB") for path in sorted(FRAMES.glob("*.png"))]
    # Frames of different sizes would be stretched; they must all be the same window.
    if len({shot.size for shot in shots}) != 1:
        raise SystemExit("The frames differ in size.")
    screens = [shot.resize(SIZE, Image.Resampling.LANCZOS) for shot in shots]
    frames: list[Image.Image] = []
    durations: list[int] = []
    for index, screen in enumerate(screens):
        following = screens[(index + 1) % len(screens)]
        frames.append(screen)
        durations.append(HOLD_MS)
        for step in range(1, FADE_STEPS):
            frames.append(Image.blend(screen, following, step / FADE_STEPS))
            durations.append(FADE_STEP_MS)
    # Every frame a keyframe: with partial frames, some decoders leave parts of earlier screens.
    frames[0].save(
        OUTPUT,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        quality=80,
        method=6,
        kmin=1,
        kmax=1,
    )
    print(f"{OUTPUT.relative_to(ROOT)}: {OUTPUT.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
