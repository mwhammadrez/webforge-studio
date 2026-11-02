"""Add a full admin panel to any static site.

Usage:
    python init_panel.py [SITE_DIR] [--force] [--hero-match SUBSTR]

Copies admin.html / site-editor.js / serve.ps1 / run-panel.bat / content.json,
builds pages.json and injects the editor script into every page.
Nothing else in the site is touched; running it twice is safe.
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parent
COPY = ["admin.html", "site-editor.js", "serve.ps1", "run-panel.bat"]
SKIP_DIRS = {"_mirror", "assets", "reports", "design-system", "_tools", "node_modules", ".git"}
MARKER = "gf-editor"


def scan(root: Path):
    """Yield (file, url path, iframe src) for every servable html page."""
    found = []
    for page in sorted(root.rglob("*.html")):
        rel = page.relative_to(root)
        if set(rel.parts[:-1]) & SKIP_DIRS:
            continue
        if page.name == "admin.html":
            continue
        parent = rel.parent.as_posix()
        if page.name == "index.html":
            path = "/" if parent == "." else "/" + parent
            src = "/" if parent == "." else "/" + parent + "/"
        else:
            path = "/" + rel.as_posix()
            src = path
        found.append({"file": page, "path": path, "src": src})
    return found


def inject(page: Path, root: Path) -> bool:
    depth = len(page.relative_to(root).parts) - 1
    tag = f'<!-- {MARKER} --><script src="{"../" * depth}site-editor.js" defer></script>'
    html = page.read_text(encoding="utf-8", errors="replace")
    if MARKER in html:
        return False
    if "</body>" in html:
        html = html.replace("</body>", tag + "</body>", 1)
    else:
        html += tag
    page.write_text(html, encoding="utf-8")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("site", nargs="?", default=".")
    ap.add_argument("--force", action="store_true", help="overwrite existing panel files")
    ap.add_argument("--hero-match", default="", help="substring of the hero image url (optional)")
    args = ap.parse_args()

    root = Path(args.site).resolve()
    if not root.is_dir():
        sys.exit(f"not a folder: {root}")
    pages = scan(root)
    if not pages:
        sys.exit("no html files found - is this an extracted site folder?")

    copied, skipped = [], []
    for name in COPY:
        dst = root / name
        if dst.exists() and not args.force:
            skipped.append(name)
            continue
        shutil.copy2(KIT / name, dst)
        copied.append(name)

    content = root / "content.json"
    if not content.exists() or args.force:
        content.write_text('{"version":1,"pages":{}}', encoding="utf-8")

    cfg_path = root / "panel-config.json"
    if not cfg_path.exists():
        cfg = {"hero": {"match": args.hero_match}} if args.hero_match else {}
        cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")

    (root / "pages.json").write_text(
        json.dumps({"pages": [{"path": p["path"], "src": p["src"]} for p in pages]},
                   ensure_ascii=False, indent=1), encoding="utf-8")

    touched = sum(1 for p in pages if inject(p["file"], root))

    print(f"site      : {root}")
    print(f"pages     : {len(pages)}")
    print(f"injected  : {touched} page(s)")
    print(f"copied    : {', '.join(copied) or '-'}")
    print(f"kept      : {', '.join(skipped) or '-'}")
    print()
    print("now run  ->  run-panel.bat")
    print("open     ->  http://localhost:8080/admin.html")


if __name__ == "__main__":
    main()
