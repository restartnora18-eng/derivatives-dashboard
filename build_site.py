"""Build a small static directory from an explicit allowlist; no dependencies."""
from __future__ import annotations

import argparse
import json
import shutil
import tempfile
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PUBLIC_FILES = (
    "index.html", "styles.css", "app.js", "snapshot.js", "funding-data.js",
    "oi-data.js", "oi-ui.js", "data-model.js", "history-data.js", "history-chart.js", "history-ui.js", "LICENSE",
)


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.assets = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("src"):
            self.assets.append(attrs["src"])
        if tag == "link" and attrs.get("rel") == "stylesheet":
            self.assets.append(attrs["href"])


def build_site(root=ROOT, hosted=False):
    root = Path(root)
    # The output location is fixed. Never accept an arbitrary deletion target.
    dist = root / "dist"
    if dist.is_symlink():
        raise ValueError("dist 不能是符号链接")
    for filename in PUBLIC_FILES:
        path = root / filename
        if not path.is_file() or path.is_symlink():
            raise ValueError("公开文件缺失或为符号链接: " + filename)
    references = References()
    references.feed((root / "index.html").read_text(encoding="utf-8"))
    allowed = set(PUBLIC_FILES) | {"runtime-config.js"}
    if not set(references.assets) <= allowed:
        raise ValueError("网页引用了未列入发布清单的资源")
    with tempfile.TemporaryDirectory(prefix=".build-", dir=str(root)) as directory:
        stage = Path(directory)
        for filename in PUBLIC_FILES:
            shutil.copyfile(root / filename, stage / filename)
        runtime = {"hosted": hosted, "expected_refresh_minutes": 60}
        (stage / "runtime-config.js").write_text("window.DASHBOARD_RUNTIME = " + json.dumps(runtime) + ";\n", encoding="utf-8")
        (stage / ".nojekyll").write_text("", encoding="utf-8")
        if dist.exists():
            shutil.rmtree(dist)
        stage.rename(dist)
    return dist


def main():
    parser = argparse.ArgumentParser(description="仅打包网页必要文件到 dist/")
    parser.add_argument("--hosted", action="store_true", help="页面标记为云端定时快照")
    args = parser.parse_args()
    dist = build_site(hosted=args.hosted)
    print(f"Static site built: {dist} ({sum(p.stat().st_size for p in dist.iterdir())} bytes)")


if __name__ == "__main__":
    main()
