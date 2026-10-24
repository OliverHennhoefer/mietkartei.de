"""Erzeugt die Wortmarken aus Geist Medium mit den originalen Schriftkonturen."""

from html import escape
import json
from pathlib import Path

import uharfbuzz as hb
from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "assets" / "brand"
FONT_PATH = BRAND / "fonts" / "geist" / "Geist.ttf"
WEIGHT = 500


def outline(text, start=0, end=None, weight=WEIGHT):
    face = hb.Face(FONT_PATH.read_bytes())
    shaped_font = hb.Font(face)
    hb.ot_font_set_funcs(shaped_font)
    shaped_font.scale = (face.upem, face.upem)
    shaped_font.set_variations({"wght": weight})
    buffer = hb.Buffer()
    buffer.add_str(text)
    buffer.guess_segment_properties()
    hb.shape(shaped_font, buffer, {"kern": True})

    font = instantiateVariableFont(TTFont(FONT_PATH), {"wght": weight})
    glyphs = font.getGlyphSet()
    order = font.getGlyphOrder()
    path = SVGPathPen(glyphs, ntos=lambda number: f"{number:.3f}".rstrip("0").rstrip(".") or "0")
    bounds = BoundsPen(glyphs)
    cursor_x = cursor_y = 0
    for info, position in zip(buffer.glyph_infos, buffer.glyph_positions):
        transform = Transform(1, 0, 0, 1, cursor_x + position.x_offset, cursor_y + position.y_offset)
        glyph = glyphs[order[info.codepoint]]
        if info.cluster >= start and (end is None or info.cluster < end):
            glyph.draw(TransformPen(path, transform))
            glyph.draw(TransformPen(bounds, transform))
        cursor_x += position.x_advance
        cursor_y += position.y_advance
    return path.getCommands(), bounds.bounds


def write_svg(filename, text, fill, title, description, square=False):
    path, (left, bottom, right, top) = outline(text)
    padding = 24
    width = right - left + 2 * padding
    height = top - bottom + 2 * padding
    if square:
        width = height = max(width, height)
    offset_x = (width - (right - left)) / 2 - left
    offset_y = (height - (top - bottom)) / 2 + top
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.3f} {height:.3f}" '
        f'fill="{fill}" role="img" aria-labelledby="title description">\n'
        f'  <title id="title">{escape(title)}</title>\n'
        f'  <desc id="description">{escape(description)}</desc>\n'
        '  <!-- Geist Medium (500), native Laufweite und Kerning; scripts/generate_brand_logos.py -->\n'
        f'  <path transform="translate({offset_x:.3f} {offset_y:.3f}) scale(1 -1)" d="{path}"/>\n'
        '</svg>\n'
    )
    (BRAND / filename).write_text(svg, encoding="utf-8")


def write_highlight_svg(filename, foreground, inverse):
    first_path, (left, first_bottom, first_right, first_top) = outline("mietkartei", end=4)
    last_path, (last_left, last_bottom, last_right, last_top) = outline("mietkartei", start=4)
    top = max(first_top, last_top)
    bottom = min(first_bottom, last_bottom)
    padding = 24
    box_padding = 112
    box_left = first_right + 60
    shift = box_left + box_padding - last_left
    box_width = last_right - last_left + 2 * box_padding
    box_height = top - bottom + 2 * box_padding
    width = last_right + shift + box_padding - left + 2 * padding
    height = box_height + 2 * padding
    offset_x = padding - left
    offset_y = padding + box_padding + top
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.3f} {height:.3f}" '
        f'fill="{foreground}" role="img" aria-labelledby="title description">\n'
        '  <title id="title">mietkartei</title>\n'
        '  <desc id="description">Einzeilige Gestaltungsvariante in Geist Medium mit invertiertem „kartei“ in einer rechteckigen Fläche.</desc>\n'
        '  <!-- Originale Geist-Konturen (500); scripts/generate_brand_logos.py -->\n'
        f'  <rect x="{box_left + offset_x:.3f}" y="{padding}" width="{box_width:.3f}" height="{box_height:.3f}"/>\n'
        f'  <path transform="translate({offset_x:.3f} {offset_y:.3f}) scale(1 -1)" d="{first_path}"/>\n'
        f'  <path fill="{inverse}" transform="translate({offset_x + shift:.3f} {offset_y:.3f}) scale(1 -1)" d="{last_path}"/>\n'
        '</svg>\n'
    )
    destination = BRAND / "variants" / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(svg, encoding="utf-8")


def write_split_outlines(filename, weight):
    # "miet" and "kartei" as separate outlines on a shared baseline, for the highlight lockup in
    # assets/brand/register/construction.py.
    parts = {}
    for name, start, end in (("miet", 0, 4), ("kartei", 4, None)):
        path, (left, bottom, right, top) = outline("mietkartei", start=start, end=end, weight=weight)
        parts[name] = {"d": path, "bounds": [round(value, 3) for value in (left, bottom, right, top)]}
    data = {"font": "Geist", "weight": weight, "units_per_em": 1000, **parts}
    (BRAND / "variants" / filename).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    for filename, fill, colour in (("logo.svg", "#000", "Schwarze"), ("logo-white.svg", "#fff", "Weiße")):
        write_svg(filename, "mietkartei", fill, "mietkartei", f"{colour} einzeilige Wortmarke in Geist Medium mit originalen Schriftkonturen.")
    write_highlight_svg("geist-highlight.svg", "#000", "#fff")
    write_highlight_svg("geist-highlight-white.svg", "#fff", "#000")
    write_split_outlines("geist-semibold-outlines.json", 600)
