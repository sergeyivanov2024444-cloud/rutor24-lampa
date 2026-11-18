"""Prepare the public distribution with the canonical Pages URL."""
import json
import os
from pathlib import Path
import shutil
from urllib.parse import urlsplit

base = os.environ["PAGES_BASE"].rstrip("/")
url = urlsplit(base)
if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment:
    raise SystemExit("GitHub Pages did not provide a valid HTTPS base URL")

src, dest = Path("site"), Path("dist")
dest.mkdir(exist_ok=True)
for name in (".nojekyll", "index.html", "home.js", "rating.json"):
    shutil.copyfile(src / name, dest / name)
plugin = (src / "plugin.js").read_text()
marker = "var publishedRatingURL = '';"
if plugin.count(marker) != 1:
    raise SystemExit("The rating endpoint marker changed")
(dest / "plugin.js").write_text(plugin.replace(marker, "var publishedRatingURL = " + json.dumps(base + "/rating.json") + ";"))
