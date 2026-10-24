"""Renders the news posts in website/neuigkeiten/*.md into static pages.

Each post is a Markdown file with a front matter block (title, date, category, description).
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
        return f"/neuigkeiten/{self.slug}/"

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
        lambda m: f'<a href="{html.escape(m.group(2))}">{m.group(1)}</a>',
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
    content = f"""        <a class="back-link" href="/neuigkeiten/"><span aria-hidden="true">←</span> Alle Neuigkeiten</a>
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
            "inLanguage": "de-DE",
            "url": SITE + post.path,
            "mainEntityOfPage": SITE + post.path,
            "image": f"{SITE}/assets/social.png",
            "author": {"@type": "Person", "name": "Oliver Hennhöfer"},
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
        <h1>Neuigkeiten</h1>
        <p class="lead">Was sich im Mietrecht für private Vermieter ändert und was es Neues in mietkartei gibt.</p>
        <ul class="post-list">
{items}
        </ul>"""
    return fill(
        layout,
        title="Neuigkeiten",
        description="Neuigkeiten für private Vermieter: Änderungen im Mietrecht, bei Heiz- und Betriebskosten und neue Funktionen in mietkartei.",
        path="/neuigkeiten/",
        og_type="website",
        json_ld=json_ld({
            "@context": "https://schema.org",
            "@type": "Blog",
            "name": "Neuigkeiten von mietkartei",
            "url": f"{SITE}/neuigkeiten/",
            "inLanguage": "de-DE",
            "publisher": {"@id": f"{SITE}/#organization"},
            "blogPost": [{"@type": "BlogPosting", "headline": post.title, "url": SITE + post.path, "datePublished": post.date.isoformat()} for post in posts],
        }),
        content=content,
    )


def render_teaser(posts: list[Post]) -> str:
    items = "".join(
        f'<li><a href="{post.path}"><time datetime="{post.date.isoformat()}">{post.date.strftime("%d.%m.%Y")}</time>'
        f"<span>{html.escape(post.title)}</span></a></li>"
        for post in posts[:3]
    )
    return (
        '<section class="news" aria-labelledby="neuigkeiten">'
        '<div class="news-head"><h2 id="neuigkeiten">Neuigkeiten</h2>'
        '<a class="news-all" href="/neuigkeiten/">Alle Neuigkeiten<span aria-hidden="true">→</span></a></div>'
        f'<ul>{items}</ul>'
        "</section>"
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
    <title>Neuigkeiten von mietkartei</title>
    <link>{SITE}/neuigkeiten/</link>
    <description>Mietrecht und Neues aus mietkartei für private Vermieter.</description>
    <language>de-de</language>{items}
  </channel>
</rss>
"""


def build_news(website: Path, output: Path) -> None:
    """Writes the news pages and feed and fills the teaser and sitemap entries of the homepage."""
    posts = read_posts(website / "neuigkeiten")
    layout = (website / "neuigkeiten" / "_layout.html").read_text(encoding="utf-8")

    pages = {"neuigkeiten/index.html": render_index(layout, posts)}
    for post in posts:
        pages[f"neuigkeiten/{post.slug}/index.html"] = render_post(layout, post)
    pages["neuigkeiten/feed.xml"] = render_feed(posts)
    for name, text in pages.items():
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(text, encoding="utf-8")

    homepage = output / "index.html"
    text = homepage.read_text(encoding="utf-8")
    if "<!-- news -->" not in text:
        raise ValueError("website/index.html: missing <!-- news --> marker")
    homepage.write_text(text.replace("<!-- news -->", render_teaser(posts)), encoding="utf-8")

    sitemap = output / "sitemap.xml"
    entries = [f"  <url>\n    <loc>{SITE}/neuigkeiten/</loc>\n  </url>\n"]
    entries += [
        f"  <url>\n    <loc>{SITE}{post.path}</loc>\n    <lastmod>{post.date.isoformat()}</lastmod>\n  </url>\n"
        for post in posts
    ]
    sitemap.write_text(
        sitemap.read_text(encoding="utf-8").replace("</urlset>", "".join(entries) + "</urlset>"),
        encoding="utf-8",
    )
