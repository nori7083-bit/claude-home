import argparse
import datetime
import html
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Union


def scan_directory(path: Union[str, os.PathLike], max_depth: int = 3) -> Dict[str, Any]:
    root = Path(path).expanduser().resolve()
    if not root.exists():
        raise FileNotFoundError(f"Path does not exist: {root}")

    def walk(current: Path, depth: int) -> Dict[str, Any]:
        children: List[Dict[str, Any]] = []
        stat = current.stat()
        updated_at = datetime.datetime.fromtimestamp(stat.st_mtime).isoformat()
        if depth <= 0:
            return {
                "name": current.name,
                "path": str(current),
                "type": "directory",
                "size": 0,
                "updated_at": updated_at,
                "children": [],
            }

        try:
            entries = sorted(current.iterdir(), key=lambda item: (0 if item.is_dir() else 1, item.name.lower()))
        except PermissionError:
            entries = []

        for entry in entries:
            if entry.is_dir():
                children.append(walk(entry, depth - 1))
            else:
                entry_stat = entry.stat()
                children.append(
                    {
                        "name": entry.name,
                        "path": str(entry),
                        "type": "file",
                        "size": entry_stat.st_size if entry.exists() else 0,
                        "updated_at": datetime.datetime.fromtimestamp(entry_stat.st_mtime).isoformat(),
                        "children": [],
                    }
                )

        return {
            "name": current.name,
            "path": str(current),
            "type": "directory",
            "size": sum(item.get("size", 0) for item in children if item.get("type") == "file"),
            "updated_at": updated_at,
            "children": children,
        }

    return walk(root, max_depth)


def _age_class(updated_at: Optional[str]) -> str:
    if not updated_at:
        return "age-unknown"

    try:
        updated_dt = datetime.datetime.fromisoformat(updated_at)
    except ValueError:
        return "age-unknown"

    age_days = (datetime.datetime.now() - updated_dt).total_seconds() / 86400
    if age_days < 7:
        return "age-recent"
    if age_days < 30:
        return "age-weekly"
    if age_days < 180:
        return "age-monthly"
    return "age-old"


def _render_tree(inventory: Dict[str, Any], level: int = 0) -> str:
    indent = "  " * level
    icon = "📁" if inventory.get("type") == "directory" else "📄"
    label = f"{icon} {html.escape(inventory['name'])}"
    size = inventory.get("size", 0)
    size_text = f" · {size} bytes" if inventory.get("type") == "file" else ""
    updated_at = inventory.get("updated_at")
    age_class = _age_class(updated_at)
    updated_text = f" · {updated_at}" if updated_at else ""
    children_html = ""
    if inventory.get("children"):
        children_html = "\n".join(_render_tree(child, level + 1) for child in inventory["children"])
        if children_html:
            children_html = f"<ul>\n{children_html}\n</ul>"

    return f"{indent}<li><div class='node {age_class}'>{label}{size_text}<span class='stamp {age_class}'>{html.escape(updated_at.split('T')[0] if updated_at else 'Unknown')}</span></div>{children_html}</li>"


def render_dashboard(inventory: Union[Sequence[Dict[str, Any]], Dict[str, Any]]) -> str:
    if isinstance(inventory, dict):
        inventory_list = [inventory]
    else:
        inventory_list = list(inventory)

    sections = []
    for source in inventory_list:
        sections.append(
            "<section class='source-card'>"
            f"<h2>{html.escape(source.get('name', 'Source'))}</h2>"
            f"<p>{html.escape(source.get('path', ''))}</p>"
            f"<ul class='tree'>\n{_render_tree(source, 0)}\n</ul>"
            "</section>"
        )

    return f"""<!doctype html>
<html lang='ja'>
<head>
  <meta charset='utf-8'>
  <title>Folder Inventory Dashboard</title>
  <style>
    body {{ font-family: 'Segoe UI', sans-serif; margin: 0; background: #f5f7fb; color: #1f2937; }}
    .page {{ max-width: 1200px; margin: 0 auto; padding: 32px; }}
    h1 {{ margin-bottom: 8px; }}
    .subtitle {{ color: #6b7280; margin-bottom: 24px; }}
    .source-card {{ background: white; border-radius: 16px; padding: 20px; margin-bottom: 18px; box-shadow: 0 8px 24px rgba(15,23,42,.08); }}
    .source-card h2 {{ margin: 0 0 6px; font-size: 20px; }}
    .source-card p {{ margin: 0 0 12px; color: #6b7280; font-size: 13px; word-break: break-all; }}
    .tree {{ list-style: none; padding-left: 0; margin: 0; }}
    .tree ul {{ list-style: none; padding-left: 18px; margin: 6px 0 0 0; border-left: 1px solid #e5e7eb; }}
    .node {{ padding: 4px 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }}
    .stamp {{ font-size: 11px; padding: 2px 8px; border-radius: 999px; color: white; }}
    .age-recent {{ background: #ecfdf3; color: #047857; }}
    .age-weekly {{ background: #fef3c7; color: #92400e; }}
    .age-monthly {{ background: #ffedd5; color: #c2410c; }}
    .age-old {{ background: #fee2e2; color: #b91c1c; }}
    .age-unknown {{ background: #e5e7eb; color: #374151; }}
  </style>
</head>
<body>
  <div class='page'>
    <h1>Folder Inventory Dashboard</h1>
    <p class='subtitle'>PC / Mac / Cloud のフォルダを一覧で確認できる簡易ダッシュボードです。</p>
    {''.join(sections)}
  </div>
</body>
</html>
"""


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Scan folders and generate a simple inventory dashboard")
    parser.add_argument("paths", nargs="*", help="Folders to scan")
    parser.add_argument("--output", default="dashboard.html", help="Output HTML file")
    parser.add_argument("--max-depth", type=int, default=3, help="How deep to recurse")
    args = parser.parse_args(argv)

    selected_paths = args.paths or ["."]
    inventory = [scan_directory(path, max_depth=args.max_depth) for path in selected_paths]
    html_output = render_dashboard(inventory)

    output_path = Path(args.output)
    output_path.write_text(html_output, encoding="utf-8")
    print(f"Dashboard written to {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
