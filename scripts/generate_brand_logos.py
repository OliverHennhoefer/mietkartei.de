"""Erzeugt die Wortmarken aus Geist Medium mit den originalen Schriftkonturen."""

from html import escape
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


def outline(text):
    face = hb.Face(FONT_PATH.read_bytes())
    shaped_font = hb.Font(face)
    hb.ot_font_set_funcs(shaped_font)
    shaped_font.scale = (face.upem, face.upem)
    shaped_font.set_variations({"wght": WEIGHT})
    buffer = hb.Buffer()
    buffer.add_str(text)
    buffer.guess_segment_properties()
    hb.shape(shaped_font, buffer, {"kern": True})

    font = instantiateVariableFont(TTFont(FONT_PATH), {"wght": WEIGHT})
    glyphs = font.getGlyphSet()
    order = font.getGlyphOrder()
    path = SVGPathPen(glyphs, ntos=lambda number: f"{number:.3f}".rstrip("0").rstrip(".") or "0")
    bounds = BoundsPen(glyphs)
    cursor_x = cursor_y = 0
    for info, position in zip(buffer.glyph_infos, buffer.glyph_positions):
        transform = Transform(1, 0, 0, 1, cursor_x + position.x_offset, cursor_y + position.y_offset)
        glyph = glyphs[order[info.codepoint]]
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


if __name__ == "__main__":
    for filename, fill, colour in (("logo.svg", "#000", "Schwarze"), ("logo-white.svg", "#fff", "Weiße")):
        write_svg(filename, "mietkartei", fill, "mietkartei", f"{colour} einzeilige Wortmarke in Geist Medium mit originalen Schriftkonturen.")
    write_svg("favicon.svg", "m", "#737373", "mietkartei", "Initiale m aus Geist Medium.", square=True)
