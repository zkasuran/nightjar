# SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
"""The artifact: compile the week's chapters into a printable book.

The physical object is the point. A story that evaporates is a demo; a book on
a shelf is a thing a four-year-old owns. Outputs print-ready HTML (A5, page
breaks per chapter) and a PDF when a renderer is available.
"""

from __future__ import annotations

import html
import json
import shutil
import subprocess
from datetime import date, datetime, timedelta
from pathlib import Path

from .config import OUT_DIR

CSS = """
@page { size: A5; margin: 18mm 16mm; }
body { font-family: Georgia, 'Times New Roman', serif; font-size: 14pt;
       line-height: 1.7; color: #1a1a1a; }
.cover { text-align: center; page-break-after: always; padding-top: 28mm; }
.cover h1 { font-size: 30pt; margin-bottom: 4mm; }
.cover p { font-size: 12pt; color: #555; }
.chapter { page-break-before: always; }
.chapter h2 { font-size: 20pt; margin-bottom: 2mm; }
.chapter .night { font-size: 9pt; color: #777; letter-spacing: .08em;
                  text-transform: uppercase; margin-bottom: 6mm; }
.chapter p { margin: 0 0 4mm; text-indent: 6mm; }
.chapter p:first-of-type { text-indent: 0; }
.colophon { page-break-before: always; font-size: 9pt; color: #666; }
"""


def _load_stories(since: date | None) -> list[dict]:
    directory = OUT_DIR / "stories"
    if not directory.exists():
        return []
    stories = []
    for path in sorted(directory.glob("*.json")):
        data = json.loads(path.read_text())
        if since:
            try:
                night = datetime.fromisoformat(data["night"]).date()
            except Exception:
                night = None
            if night and night < since:
                continue
        stories.append(data)
    return stories


def build(child_name: str, days: int = 7, title: str | None = None) -> tuple[Path, Path | None]:
    """Returns (html_path, pdf_path_or_None)."""
    since = date.today() - timedelta(days=days)
    stories = _load_stories(since)
    if not stories:
        raise RuntimeError("no stories found in out/stories, run `nightjar tonight` first")

    book_title = title or f"{child_name}'s Book of Nights"
    parts = [
        "<!doctype html><html><head><meta charset='utf-8'>",
        f"<title>{html.escape(book_title)}</title>",
        f"<style>{CSS}</style></head><body>",
        "<div class='cover'>",
        f"<h1>{html.escape(book_title)}</h1>",
        f"<p>{len(stories)} nights &middot; {stories[0]['night']} to {stories[-1]['night']}</p>",
        "<p>Written at bedtime, one chapter at a time.</p>",
        "</div>",
    ]
    for story in stories:
        parts.append("<div class='chapter'>")
        parts.append(f"<h2>{html.escape(story['title'])}</h2>")
        parts.append(f"<div class='night'>{html.escape(story['night'])}</div>")
        for para in [p for p in story["text"].split("\n") if p.strip()]:
            parts.append(f"<p>{html.escape(para.strip())}</p>")
        parts.append("</div>")

    parts.append(
        "<div class='colophon'><p>Every chapter in this book was written on a "
        "laptop in this house by an open-weight model, checked by a safety "
        "filter and read aloud before anyone fell asleep. Nothing about the "
        "reader was uploaded anywhere.</p></div>"
    )
    parts.append("</body></html>")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    html_path = OUT_DIR / f"book-{date.today().isoformat()}.html"
    html_path.write_text("\n".join(parts))
    return html_path, _to_pdf(html_path)


def _to_pdf(html_path: Path) -> Path | None:
    pdf_path = html_path.with_suffix(".pdf")
    try:
        from weasyprint import HTML  # optional: pip install weasyprint

        HTML(filename=str(html_path)).write_pdf(str(pdf_path))
        return pdf_path
    except ImportError:
        pass
    except Exception:  # a broken renderer must not lose the HTML book
        pass
    for tool, args in (
        ("weasyprint", [str(html_path), str(pdf_path)]),
        ("wkhtmltopdf", ["--page-size", "A5", str(html_path), str(pdf_path)]),
    ):
        exe = shutil.which(tool)
        if not exe:
            continue
        if subprocess.run([exe, *args], capture_output=True).returncode == 0:
            return pdf_path
    return None
