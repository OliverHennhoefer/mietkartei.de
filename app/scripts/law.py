"""Builds src/lib/server/law-data.ts, the wording of the statutes the app applies.

For every section listed in LAWS: its heading and its text as published on gesetze-im-internet.de
by the Bundesministerium der Justiz, and for every law its current version note ("zuletzt geändert
durch ..."). Statutes are official works without copyright (§ 5 Abs. 1 UrhG). The text is bundled,
so an assistant reads the law through the MCP server without the app calling another service.

Run from app/: python3 -I scripts/law.py
It needs no packages. gesetze-im-internet.de does not answer GitHub's runners, so it runs on a
machine in Germany rather than in a workflow. When a text changed, check the code that cites the
section: a changed section may also change a rule the app computes.
"""
import io
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ElementTree
import zipfile
from pathlib import Path

SOURCE = "https://www.gesetze-im-internet.de/{slug}/xml.zip"
PAGE = "https://www.gesetze-im-internet.de/{slug}/__{section}.html"
OUTPUT = Path(__file__).resolve().parent.parent / "src/lib/server/law-data.ts"

# The sections the app applies or names, by the abbreviation the law gives itself. Add a section
# here when the code starts to cite it.
LAWS = [
    {
        "abbreviation": "BGB",
        "slug": "bgb",
        "sections": [
            "193", "247", "286", "288", "366", "535", "543", "551", "556", "556a", "556b",
            "557", "557a", "557b", "558", "558a", "558b", "560", "573c", "580a",
        ],
    },
    {"abbreviation": "BetrKV", "slug": "betrkv", "sections": ["1", "2"]},
    {
        "abbreviation": "HeizkostenV",
        "slug": "heizkostenv",
        "sections": ["6", "7", "8", "9", "9a", "9b", "12"],
    },
    {"abbreviation": "CO2KostAufG", "slug": "co2kostaufg", "sections": ["5", "6", "7", "8"]},
    {"abbreviation": "EStG", "slug": "estg", "sections": ["6", "7", "11", "21"]},
]


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "mietkartei.de"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def norms(slug):
    """The norm elements of a law's XML."""
    with zipfile.ZipFile(io.BytesIO(fetch(SOURCE.format(slug=slug)))) as archive:
        name = next(name for name in archive.namelist() if name.endswith(".xml"))
        root = ElementTree.fromstring(archive.read(name))
    return root.findall("norm")


EQUATION = "[Formel nur als Bild veröffentlicht, siehe url]"

# Marks a line break of the text; line breaks of the XML source are only whitespace.
BREAK = "\x00"


def sentence_number(element, parts):
    """A superscript sentence number (EStG numbers its sentences), unlike an exponent such as m²:
    it starts the text or follows whitespace or a bracket."""
    if element.tag != "SUP" or not (element.text or "").strip().isdigit():
        return False
    before = "".join(parts)
    return not before.strip() or before[-1].isspace() or before[-1] in "(" + BREAK


def inline(element):
    """The text of an element with its children; footnote marks are left out."""
    parts = [element.text or ""]
    for child in element:
        if child.tag == "FnR" or sentence_number(child, parts):
            pass
        elif child.tag == "LA":
            # Paragraphs of a list item follow each other without whitespace in the source.
            parts.append(" " + inline(child))
        elif child.tag == "IMG":
            # Some equations are published only as an image; point to the page that shows it.
            parts.append(child.get("ALT") or child.get("alt") or EQUATION)
        elif child.tag == "BR":
            parts.append(BREAK)
        elif child.tag == "DL":
            parts.append(BREAK + listing(child).replace("\n", BREAK) + BREAK)
        else:
            parts.append(inline(child))
        parts.append(child.tail or "")
    return "".join(parts)


def listing(element):
    """A numbered list (DL of DT and DD), one item per line."""
    lines = []
    for child in element:
        if child.tag == "DT":
            lines.append(clean(inline(child)))
        elif child.tag == "DD" and lines:
            lines[-1] += " " + clean(inline(child))
    return "\n".join(lines)


def clean(text):
    lines = (re.sub(r"\s+", " ", line).strip() for line in text.split(BREAK))
    return "\n".join(line for line in lines if line)


def section_text(norm):
    content = norm.find("textdaten/text/Content")
    if content is None:
        return ""
    paragraphs = [clean(inline(child)) for child in content if child.tag in ("P", "DL")]
    return "\n\n".join(paragraph for paragraph in paragraphs if paragraph)


def law_entry(law):
    found = norms(law["slug"])
    head = found[0].find("metadaten")
    name = clean("".join(head.find("langue").itertext())) if head.find("langue") is not None else ""
    notes = [
        clean("".join(note.itertext())).rstrip(";").strip()
        for note in head.findall("standangabe/standkommentar")
    ]
    by_section = {}
    for norm in found:
        number = norm.findtext("metadaten/enbez") or ""
        match = re.fullmatch(r"§\s*(\d+[a-z]?)", number.strip())
        if match:
            by_section.setdefault(match.group(1), norm)
    sections = []
    for section in law["sections"]:
        norm = by_section.get(section)
        if norm is None:
            sys.exit(f"{law['abbreviation']}: § {section} not found")
        title = clean("".join(norm.find("metadaten/titel").itertext())) if norm.find(
            "metadaten/titel"
        ) is not None else ""
        text = section_text(norm)
        if not text:
            sys.exit(f"{law['abbreviation']}: § {section} has no text")
        sections.append(
            {
                "id": f"{law['abbreviation'].lower()}-{section}",
                "law": law["abbreviation"],
                "section": section,
                "title": title,
                "url": PAGE.format(slug=law["slug"], section=section),
                "text": text,
            }
        )
    return {
        "abbreviation": law["abbreviation"],
        "name": name,
        "url": f"https://www.gesetze-im-internet.de/{law['slug']}/",
        "version": "; ".join(notes),
    }, sections


def main():
    laws = []
    sections = []
    for law in LAWS:
        entry, found = law_entry(law)
        laws.append(entry)
        sections.extend(found)
        print(f"{law['abbreviation']}: {len(found)} sections")
    dump = lambda value: json.dumps(value, ensure_ascii=False, indent="\t")
    OUTPUT.write_text(
        "// Generated by app/scripts/law.py from gesetze-im-internet.de; do not edit by hand.\n"
        "// Statutes are official works without copyright (§ 5 Abs. 1 UrhG).\n\n"
        f"export const laws = {dump(laws)} as const;\n\n"
        f"export const lawSections = {dump(sections)} as const;\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
