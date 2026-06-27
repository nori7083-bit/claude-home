#!/usr/bin/env python3
import argparse
import re
import sys
from html import escape
from pathlib import Path
from typing import Optional


def split_slides(markdown: str) -> list[str]:
    slides = [part.strip() for part in re.split(r"\n\s*---\s*\n", markdown.strip()) if part.strip()]
    return slides or [markdown.strip()]


def render_slide(content: str) -> str:
    lines = [line.rstrip() for line in content.splitlines()]
    html_lines: list[str] = []
    in_list = False

    for line in lines:
        if not line.strip():
            if in_list:
                html_lines.append("</ul>")
                in_list = False
            continue

        if re.match(r"^[-*]\s+", line):
            if not in_list:
                html_lines.append("<ul>")
                in_list = True
            html_lines.append(f"<li>{escape(line[2:].strip())}</li>")
            continue

        if in_list:
            html_lines.append("</ul>")
            in_list = False

        if re.match(r"^#{1,6}\s+", line):
            level = len(re.match(r"^(#{1,6})\s+", line).group(1))
            text = escape(line[level:].strip())
            html_lines.append(f"<h{level}>{text}</h{level}>")
        else:
            html_lines.append(f"<p>{escape(line)}</p>")

    if in_list:
        html_lines.append("</ul>")

    return "\n".join(html_lines)


def build_html(markdown: str, title: Optional[str] = None) -> str:
    slides = split_slides(markdown)
    slide_html = "\n".join(f"<section class=\"slide\">{render_slide(slide)}</section>" for slide in slides)
    deck_title = title or (slides[0].splitlines()[0].lstrip('#').strip() if slides else "Slide Deck")
    return f"""<!DOCTYPE html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\">
  <title>{escape(deck_title)}</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 0; background: #f4f4f4; }}
    .slide {{ background: white; padding: 2rem; margin: 2rem auto; max-width: 800px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }}
    h1, h2, h3 {{ color: #222; }}
    ul {{ padding-left: 1.2rem; }}
  </style>
</head>
<body>
{slide_html}
</body>
</html>
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a simple HTML slide deck from markdown")
    parser.add_argument("input", nargs="?", default="-", help="Markdown file or '-' for stdin")
    parser.add_argument("output", nargs="?", help="Output HTML file path")
    parser.add_argument("--title", help="Optional title override")
    args = parser.parse_args()

    if args.input == "-":
        markdown = sys.stdin.read()
    else:
        markdown = Path(args.input).read_text(encoding="utf-8")

    html = build_html(markdown, title=args.title)

    if args.output:
        Path(args.output).write_text(html, encoding="utf-8")
    else:
        sys.stdout.write(html)


if __name__ == "__main__":
    main()
