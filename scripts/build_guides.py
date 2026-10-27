"""Renders the guides in website/ratgeber/*.md into static pages.

Each guide is a Markdown file with a front matter block (title, date, category, description).
The renderer supports the subset the posts need: paragraphs, `##` headings, `-` lists,
**bold** and [links](https://…).
"""

import html
import json
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from email.utils import format_datetime
from pathlib import Path

SITE = "https://mietkartei.de"
MONTHS = (
    "Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember",
)


@dataclass
class Post:
    slug: str
    title: str
    date: date
    category: str
    description: str
    body: str

    @property
    def path(self) -> str:
        return f"/ratgeber/{self.slug}/"

    @property
    def date_label(self) -> str:
        return f"{self.date.day}. {MONTHS[self.date.month - 1]} {self.date.year}"


def read_posts(directory: Path) -> list[Post]:
    posts = []
    for source in directory.glob("*.md"):
        text = source.read_text(encoding="utf-8")
        match = re.match(r"---\n(.*?)\n---\n(.*)", text, re.S)
        if not match:
            raise ValueError(f"{source}: missing front matter")
        fields = dict(line.split(": ", 1) for line in match.group(1).splitlines())
        missing = {"title", "date", "category", "description"} - fields.keys()
        if missing:
            raise ValueError(f"{source}: missing {', '.join(sorted(missing))}")
        posts.append(Post(
            slug=source.stem,
            title=fields["title"],
            date=date.fromisoformat(fields["date"]),
            category=fields["category"],
            description=fields["description"],
            body=match.group(2),
        ))
    return sorted(posts, key=lambda post: (post.date, post.slug), reverse=True)


def inline(text: str) -> str:
    text = html.escape(text, quote=False)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    return re.sub(
        r"\[(.+?)\]\((https?://[^)\s]+|/[^)\s]*)\)",
        # The text is already escaped above; only quotes remain to keep the attribute intact.
        lambda m: f'<a href="{m.group(2).replace(chr(34), "&quot;")}">{m.group(1)}</a>',
        text,
    )


def render_markdown(source: str) -> str:
    blocks = []
    for block in re.split(r"\n\s*\n", source.strip()):
        lines = block.splitlines()
        if block.startswith("## "):
            blocks.append(f"<h2>{inline(block[3:].strip())}</h2>")
        elif all(line.startswith("- ") for line in lines):
            items = "".join(f"<li>{inline(line[2:])}</li>" for line in lines)
            blocks.append(f"<ul>{items}</ul>")
        else:
            blocks.append(f"<p>{inline(' '.join(lines))}</p>")
    return "\n".join(blocks)


def fill(layout: str, **values: str) -> str:
    for key, value in values.items():
        layout = layout.replace("{" + key + "}", value)
    return layout


def json_ld(data: dict) -> str:
    # Escaping "<" keeps "</script>" inside a string from ending the block.
    return json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")


def meta_line(post: Post) -> str:
    return (
        f'<p class="post-meta"><time datetime="{post.date.isoformat()}">{post.date_label}</time>'
        f' · {html.escape(post.category)}</p>'
    )


def render_post(layout: str, post: Post) -> str:
    content = f"""        <a class="back-link" href="/ratgeber/"><span aria-hidden="true">←</span> Alle Ratgeber</a>
        <article>
          {meta_line(post)}
          <h1>{html.escape(post.title)}</h1>
          <div class="prose">
{render_markdown(post.body)}
          </div>
        </article>"""
    return fill(
        layout,
        title=html.escape(post.title),
        description=html.escape(post.description),
        path=post.path,
        og_type="article",
        json_ld=json_ld({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            "headline": post.title,
            "description": post.description,
            "datePublished": post.date.isoformat(),
            "dateModified": post.date.isoformat(),
            "articleSection": post.category,
            "inLanguage": "de-DE",
            "url": SITE + post.path,
            "mainEntityOfPage": SITE + post.path,
            "image": f"{SITE}/assets/social.png?v=auswertung",
            "author": {"@type": "Person", "name": "Oliver Hennhöfer", "url": "https://github.com/OliverHennhoefer"},
            "publisher": {"@id": f"{SITE}/#organization"},
        }),
        content=content,
    )


def post_list_item(post: Post, heading: str) -> str:
    return (
        f'<li><a href="{post.path}">{meta_line(post)}'
        f"<{heading}>{html.escape(post.title)}</{heading}>"
        f"<p>{html.escape(post.description)}</p></a></li>"
    )


def render_index(layout: str, posts: list[Post]) -> str:
    items = "\n".join(f"          {post_list_item(post, 'h2')}" for post in posts)
    content = f"""        <a class="back-link" href="/"><span aria-hidden="true">←</span> Zur Startseite</a>
        <p class="eyebrow">Wissen für Vermieter</p>
        <h1>Ratgeber</h1>
        <p class="lead">Was private Vermieter zu Mietrecht, Heiz- und Betriebskosten wissen sollten. Neue Beiträge gibt es auch als <a href="/ratgeber/feed.xml">RSS-Feed</a>.</p>
        <ul class="post-list">
{items}
        </ul>"""
    return fill(
        layout,
        title="Ratgeber",
        description="Ratgeber für private Vermieter: Mietrecht, Heizkosten und Betriebskostenabrechnung verständlich erklärt.",
        path="/ratgeber/",
        og_type="website",
        json_ld=json_ld({
            "@context": "https://schema.org",
            "@type": "Blog",
            "name": "Ratgeber von mietkartei",
            "url": f"{SITE}/ratgeber/",
            "inLanguage": "de-DE",
            "publisher": {"@id": f"{SITE}/#organization"},
            "blogPost": [{"@type": "BlogPosting", "headline": post.title, "url": SITE + post.path, "datePublished": post.date.isoformat()} for post in posts],
        }),
        content=content,
    )


def render_feed(posts: list[Post]) -> str:
    def rfc822(day: date) -> str:
        return format_datetime(datetime(day.year, day.month, day.day, tzinfo=timezone.utc))

    items = "".join(
        f"""
    <item>
      <title>{html.escape(post.title)}</title>
      <link>{SITE}{post.path}</link>
      <guid>{SITE}{post.path}</guid>
      <pubDate>{rfc822(post.date)}</pubDate>
      <category>{html.escape(post.category)}</category>
      <description>{html.escape(post.description)}</description>
    </item>"""
        for post in posts
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Ratgeber von mietkartei</title>
    <link>{SITE}/ratgeber/</link>
    <description>Mietrecht, Heiz- und Betriebskosten für private Vermieter.</description>
    <language>de-de</language>{items}
  </channel>
</rss>
"""


def render_llms_links(posts: list[Post]) -> str:
    return "".join(f"- [{post.title}]({SITE}{post.path}): {post.description}\n" for post in posts)


def build_guides(website: Path, output: Path) -> None:
    """Writes the guide pages and feed and fills the sitemap and llms.txt entries."""
    posts = read_posts(website / "ratgeber")
    layout = (website / "ratgeber" / "_layout.html").read_text(encoding="utf-8")

    pages = {"ratgeber/index.html": render_index(layout, posts)}
    for post in posts:
        pages[f"ratgeber/{post.slug}/index.html"] = render_post(layout, post)
    pages["ratgeber/feed.xml"] = render_feed(posts)
    for name, text in pages.items():
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(text, encoding="utf-8")

    homepage = output / "index.html"
    text = homepage.read_text(encoding="utf-8")
    if "<!-- latest-guide -->\n" not in text:
        raise ValueError("website/index.html: missing <!-- latest-guide --> marker")
    latest = posts[0]
    homepage.write_text(
        text.replace(
            "<!-- latest-guide -->\n",
            f'<a class="latest" href="{latest.path}"><span class="latest-tag">Neu</span>'
            f'<span class="latest-title">{html.escape(latest.title)}</span><span aria-hidden="true">→</span></a>\n',
        ),
        encoding="utf-8",
    )

    llms = output / "llms.txt"
    text = llms.read_text(encoding="utf-8")
    if "<!-- guides -->\n" not in text:
        raise ValueError("website/llms.txt: missing <!-- guides --> marker")
    llms.write_text(text.replace("<!-- guides -->\n", render_llms_links(posts)), encoding="utf-8")

    sitemap = output / "sitemap.xml"
    entries = [f"  <url>\n    <loc>{SITE}/ratgeber/</loc>\n  </url>\n"]
    entries += [
        f"  <url>\n    <loc>{SITE}{post.path}</loc>\n    <lastmod>{post.date.isoformat()}</lastmod>\n  </url>\n"
        for post in posts
    ]
    sitemap.write_text(
        sitemap.read_text(encoding="utf-8").replace("</urlset>", "".join(entries) + "</urlset>"),
        encoding="utf-8",
    )
