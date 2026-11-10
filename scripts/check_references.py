"""Checks that the docs, the website and the maintainer guides still match the repository.

Each check answers to a mistake that once went unnoticed:

- an address of the app or the docs that leads to no page,
- a page of the docs missing from one of the two llms.txt,
- a file in .github/ missing from the table in MAINTENANCE.md,
- a note box in the docs that renders empty because its text is not indented,
- a build file in docs/ that Zensical publishes along with the pages.

Run it from anywhere: python3 scripts/check_references.py. It needs Python 3.11 and git, nothing
else, and builds nothing, so CI runs it on every pull request.
"""

import re
import subprocess
import sys
import tomllib
from fnmatch import fnmatch
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
ADDRESS = r"(/[^\s\"'<>()\[\]`|\\]*)?"
APP_ADDRESS = re.compile(r"https://(?:app|demo)\.mietkartei\.de" + ADDRESS)
DOCS_ADDRESS = re.compile(r"https://docs\.mietkartei\.de" + ADDRESS)
# Written by the docs build, so there is no source file to look for.
GENERATED_DOCS_FILES = {"llms.txt", "llms-full.txt", "sitemap.xml"}
# Files in docs/ that are neither a page nor an asset and still belong to the site.
PUBLISHED_DOCS_FILES = {"_headers", "robots.txt"}
# Where addresses are checked: what people read. The changelog is left out, because an entry
# names a page as it was called when the entry was written.
TEXT_FOLDERS = {"docs", "website", ".github"}
TEXT_SUFFIXES = {".md", ".html", ".txt", ".yml", ".toml", ".json", ".xml", ".js"}

problems: list[str] = []


def repository_files() -> list[PurePosixPath]:
    """Every file git knows or would add, so generated and ignored files stay out."""
    listing = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    ).stdout.decode()
    return [PurePosixPath(name) for name in listing.split("\0") if (ROOT / name).is_file()]


def read(path: PurePosixPath | str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def below(files: list[PurePosixPath], folder: str) -> list[PurePosixPath]:
    """The files in a folder of the repository, as paths relative to it."""
    return [file.relative_to(folder) for file in files if file.is_relative_to(folder)]


def is_excluded(file: PurePosixPath, patterns: list[str]) -> bool:
    """Whether a path below docs/ matches exclude_docs in zensical.toml, read like a .gitignore."""
    for pattern in patterns:
        name = pattern.strip("/")
        if pattern.endswith("/"):
            if name in file.parts[:-1]:
                return True
        elif fnmatch(file.name, name) or fnmatch(file.as_posix(), name):
            return True
    return False


def route_pattern(folder: PurePosixPath) -> re.Pattern[str]:
    """The paths a folder under app/src/routes answers, by the rules of app/src/routes/links.spec.ts."""
    pattern = ""
    for segment in folder.parts:
        if re.fullmatch(r"\(.*\)", segment):
            continue
        if re.fullmatch(r"\[\.\.\..+\]", segment):
            pattern += "(?:/.*)?"
        elif re.fullmatch(r"\[\[.+\]\]", segment):
            pattern += "(?:/[^/]+)?"
        else:
            parts = re.split(r"(\[[^\]]+\])", segment)
            pattern += "/" + "".join(
                "[^/]+" if part.startswith("[") else re.escape(part) for part in parts
            )
    return re.compile(pattern or "/")


def address_path(match: re.Match[str]) -> str:
    """The path of an address in running text: no query, no fragment, no punctuation after it."""
    path = (match.group(1) or "/").split("?")[0].split("#")[0].rstrip(".,;:!*")
    return path.rstrip("/") or "/"


def check_addresses(
    files: list[PurePosixPath], pages: set[PurePosixPath], published: set[PurePosixPath]
) -> int:
    """Every address of the app and of the docs leads to a route, a page or a published file."""
    routes = [
        route_pattern(folder)
        for folder in {
            file.parent
            for file in below(files, "app/src/routes")
            if re.match(r"\+(page|server)", file.name)
        }
    ]
    texts = [
        file
        for file in files
        if file.suffix in TEXT_SUFFIXES
        and (
            file.parts[0] in TEXT_FOLDERS
            or file.as_posix() == "app/README.md"
            or (len(file.parts) == 1 and file.name != "CHANGELOG.md")
        )
    ]
    count = 0
    for file in texts:
        for number, line in enumerate(read(file).splitlines(), 1):
            for match in APP_ADDRESS.finditer(line):
                count += 1
                if not any(route.fullmatch(address_path(match)) for route in routes):
                    problems.append(
                        f"{file}:{number}: {match.group(0)} leads to no page of the app"
                        " (app/src/routes)."
                    )
            for match in DOCS_ADDRESS.finditer(line):
                count += 1
                path = address_path(match).strip("/")
                page = {PurePosixPath(f"{path}.md"), PurePosixPath(path, "index.md")}
                if not (
                    path == ""
                    or page & pages
                    or PurePosixPath(path) in published
                    or path in GENERATED_DOCS_FILES
                ):
                    problems.append(
                        f"{file}:{number}: {match.group(0)} leads to no page of the docs (docs/)."
                    )
    return count


def check_page_lists(pages: set[PurePosixPath], project: dict) -> None:
    """Every page of the docs is in the llms.txt of the docs and in the one of the website."""
    listed = {
        PurePosixPath(name)
        for section in project["plugins"]["llmstxt"]["sections"].values()
        for entry in section
        for name in entry
    }
    for page in sorted(pages - listed):
        problems.append(
            f"zensical.toml: docs/{page} is missing from [project.plugins.llmstxt.sections],"
            " so the llms.txt of the docs leaves it out."
        )
    for page in sorted(listed - pages):
        problems.append(
            f"zensical.toml: [project.plugins.llmstxt.sections] lists {page},"
            " which is no page in docs/."
        )
    website_list = read("website/llms.txt")
    for page in sorted(pages - {PurePosixPath("index.md")}):
        path = page.with_suffix("").as_posix().removesuffix("/index")
        address = f"https://docs.mietkartei.de/{path}/"
        if address not in website_list:
            problems.append(f"website/llms.txt: the link to {address} is missing.")


def check_maintenance_table(files: list[PurePosixPath]) -> int:
    """Every file in .github/ has its row in the file table of MAINTENANCE.md."""
    named = set(re.findall(r"`([^`\s]+)`", read(".github/MAINTENANCE.md")))
    described = [file for file in below(files, ".github") if file.name != "MAINTENANCE.md"]
    for file in sorted(described):
        if file.as_posix() not in named:
            problems.append(f".github/MAINTENANCE.md: `{file}` is missing from the file table.")
    return len(described)


def check_note_boxes(pages: set[PurePosixPath]) -> None:
    """A note box holds the lines indented by four more spaces than its `!!!` line."""
    for page in sorted(pages):
        lines = read(f"docs/{page}").splitlines()
        fenced = False
        for index, line in enumerate(lines):
            if line.lstrip().startswith("```"):
                fenced = not fenced
            box = None if fenced else re.match(r"( *)(?:!!!|\?\?\?\+?) ", line)
            if not box:
                continue
            following = next((later for later in lines[index + 1 :] if later.strip()), "")
            if not following.startswith(box.group(1) + "    "):
                problems.append(
                    f"docs/{page}:{index + 1}: the note box has no text."
                    " Indent its text by four spaces, after an empty line."
                )


def check_published_files(files: list[PurePosixPath], excluded: list[str]) -> None:
    """Nothing in docs/ is published by accident: Zensical copies every file that is no page."""
    for file in sorted(below(files, "docs")):
        if file.suffix == ".md" or file.parts[0] == "assets" or is_excluded(file, excluded):
            continue
        if file.as_posix() not in PUBLISHED_DOCS_FILES:
            problems.append(
                f"docs/{file}: Zensical would publish this file at"
                f" https://docs.mietkartei.de/{file}. Add it to exclude_docs in zensical.toml,"
                " or to PUBLISHED_DOCS_FILES in scripts/check_references.py if it belongs to"
                " the site."
            )


def main() -> int:
    files = repository_files()
    project = tomllib.loads(read("zensical.toml"))["project"]
    excluded = project["exclude_docs"].split()
    published = {file for file in below(files, "docs") if not is_excluded(file, excluded)}
    pages = {file for file in published if file.suffix == ".md"}

    addresses = check_addresses(files, pages, published)
    check_page_lists(pages, project)
    described = check_maintenance_table(files)
    check_note_boxes(pages)
    check_published_files(files, excluded)
    # A change that makes this script find nothing must not pass as "nothing wrong".
    if not (addresses and pages and described):
        problems.append(
            f"scripts/check_references.py found {addresses} addresses, {len(pages)} pages of"
            f" the docs and {described} files in .github/. None of these may be 0."
        )

    for problem in problems:
        print(problem, file=sys.stderr)
    if problems:
        print(f"\n{len(problems)} reference(s) need attention.", file=sys.stderr)
        return 1
    print(
        f"References checked: {addresses} addresses, {len(pages)} pages of the docs,"
        f" {described} files in .github/."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
