"""Read the Rutor daily table and replace the public snapshot only after validation."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlsplit
from urllib.request import Request, urlopen
import argparse
import json
import re

SOURCE = "https://rutor.is/top/"
HEADING = "Топ торренты за последние 24 часа"
MAX_BYTES = 2 * 1024 * 1024
HOSTS = {"rutor.is", "rutor.info"}
DOWNLOAD_HOSTS = HOSTS | {"d.rutor.is", "d.rutor.info"}
ID = re.compile(r"^/torrent/(\d+)(?:/|$)")
SIZE = re.compile(r"\d+(?:[.,]\d+)?\s*(?:[KMGTPE]?i?B|байт|[КМГТ]Б)", re.I)
HASH = re.compile(r"urn:btih:(?:[0-9a-f]{40}|[a-z2-7]{32})", re.I)
CATEGORIES = set("/kino /nashe_kino /nauchno_popularnoe /seriali /nashi_seriali /tv /multiki /anime /games /knigi /audio /soft /inostrannoe /sport /jumor /byt /other".split())
VIDEO = re.compile(r"\b(?:WEB[ -]?(?:DL(?:Rip)?|Rip|Cap|Mux)|(?:UHD[ -]?)?Blu[ -]?ray|(?:UHD[ -]?)?BD[ -]?(?:Rip|Remux)|DVD[ -]?(?:Rip|[59])|HDTV(?:Rip)?|HDRip|TVRip|SAT(?:Rip)?|CAMRip|TS|VHSRip|REMUX|(?:4320|2160|1080|720|576|480)[pi]|UHD|DVB|IPTVRip|BDMV|MKV|MP4|AVI|MPEG-TS)\b", re.I)
NONVIDEO = re.compile(r"\b(?:RePack|APK|DEB|MSI|EXE|iOS|macOS|Windows|Linux|PS[345]|Nintendo Switch|Xbox|EPUB|FB2|PDF|DJVU|CB[ZR]|MOBI|AZW3|DOCX?)\b|\bPC\s*\|", re.I)
KNOWN_VIDEO = set("/kino /nashe_kino /nauchno_popularnoe /seriali /nashi_seriali /tv /multiki /anime".split())


class Node:
    def __init__(self, tag, attrs=()):
        self.tag = tag
        self.attrs = dict(attrs)
        self.children = []

    def find(self, *tags):
        for child in self.children:
            if isinstance(child, Node):
                if child.tag in tags:
                    yield child
                yield from child.find(*tags)

    def text(self):
        return "".join(c.text() if isinstance(c, Node) else c for c in self.children)


class Page(HTMLParser):
    void = set("area base br col embed hr img input link meta param source track wbr".split())

    def __init__(self, text):
        super().__init__()
        self.root = Node("")
        self.stack = [self.root]
        self.feed(text)
        self.close()

    def handle_starttag(self, tag, attrs):
        if tag in {"tr", "td", "th"} and self.stack[-1].tag == tag:
            self.stack.pop()
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in self.void:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(Node(tag, attrs))

    def handle_endtag(self, tag):
        for i in range(len(self.stack)-1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def clean(text):
    return " ".join(text.split())


def fetch(url):
    with urlopen(Request(url, headers={"User-Agent": "Rutor24-Lampa/0.6", "Accept": "text/html"}), timeout=10) as response:
        if urlsplit(response.url).hostname not in HOSTS:
            raise ValueError("unexpected redirect")
        if response.headers.get_content_type() != "text/html":
            raise ValueError("unexpected content type")
        body = response.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES:
            raise ValueError("Rutor response is too large")
        # Rutor can serve cached HTML. Preserve its reported age.
        age = max(0, int(response.headers.get("Age", "0")))
        now = datetime.now(timezone.utc)
        stamp = now - timedelta(seconds=age)
        if response.headers.get("Date"):
            stamp = min(stamp, parsedate_to_datetime(response.headers["Date"]))
        return body.decode("utf-8"), stamp


def links(cell, rid):
    magnet = torrent = ""
    for anchor in cell.find("a"):
        href = anchor.attrs.get("href") or ""
        if re.fullmatch(r"magnet:\?[^\s<>\"']{1,4088}", href, re.I):
            if HASH.fullmatch(parse_qs(href[8:]).get("xt", [""])[0]):
                magnet = href
        elif re.match(r"^(?:https?:)?//", href):
            target = urlsplit(urljoin(SOURCE, href))
            if target.hostname in DOWNLOAD_HOSTS and not (target.username or target.password or target.query or target.fragment or target.port) and target.path.rstrip("/") == "/download/" + rid:
                torrent = "https:" + href if href.startswith("//") else href
    return magnet, torrent


def category(anchor):
    path = (anchor.attrs.get("href") or "").rstrip("/")
    return path if path in CATEGORIES else ""


def detail_category(rid):
    try:
        html, _ = fetch("https://rutor.is/torrent/" + rid)
        cells = list(Page(html).root.find("td"))
        for i, cell in enumerate(cells[:-1]):
            if "header" in (cell.attrs.get("class") or "").split() and clean(cell.text()) == "Категория":
                return next(filter(None, map(category, cells[i+1].find("a"))), "")
    except (OSError, ValueError) as error:
        print(f"category {rid}: {error}")
    return ""


def parse(html):
    sections = list(Page(html).root.find("h1", "h2", "h3", "table"))
    index = next(i for i, item in enumerate(sections) if item.tag != "table" and clean(item.text()) == HEADING)
    table = sections[index+1]
    if table.tag != "table":
        raise ValueError("daily header is not followed by a table")
    indexes = {}
    for label, section in zip(sections[index+2:], sections[index+3:]):
        if label.tag == "table" or section.tag != "table" or not clean(label.text()).startswith("Самые популярные торренты в категории"):
            continue
        kind = next(filter(None, map(category, label.find("a"))), "")
        if kind:
            for anchor in section.find("a"):
                match = ID.match(anchor.attrs.get("href") or "")
                if match:
                    indexes.setdefault(match[1], kind)

    head, *items = list(table.find("tr"))
    if not re.search(r"Название.*Размер.*Пиры", clean(" ".join(c.text() for c in head.find("td", "th"))), re.I):
        raise ValueError("unexpected daily table columns")
    rows, seen = [], set()
    for rank, item in enumerate(items, 1):
        cells = list(item.find("td"))
        if len(cells) < 4:
            raise ValueError(f"broken row {rank}")
        anchor = next(a for a in cells[1].find("a") if ID.match(a.attrs.get("href") or ""))
        rid = ID.match(anchor.attrs["href"])[1]
        title, date, size = clean(anchor.text()), clean(cells[0].text()), clean(cells[-2].text())
        counters = {}
        for span in cells[-1].find("span"):
            for key in ("green", "red"):
                if key in (span.attrs.get("class") or "").split():
                    counters[key] = "".join(span.text().split())
        magnet, torrent = links(cells[1], rid)
        if rid in seen or not title or not date or not SIZE.fullmatch(size) or not all(re.fullmatch(r"[0-9]+", counters.get(k, "")) for k in ("green", "red")) or not (magnet or torrent):
            raise ValueError(f"invalid or duplicate release at rank {rank}")
        seen.add(rid)
        rows.append(dict(rank=rank, id=rid, title=title, date=date, size=size, category=indexes.get(rid, ""),
                         seeds=int(counters["green"]), peers=int(counters["red"]), magnet=magnet, torrent=torrent))
    if not 10 <= len(rows) <= 100:
        raise ValueError(f"unexpected table size: {len(rows)}")
    return rows


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("--output", type=Path, default=Path("site/rating.json"))
    cli.add_argument("--fixture", type=Path, help="Verify the parser without publishing a fixture")
    args = cli.parse_args()
    try:
        html, stamp = (args.fixture.read_text(), None) if args.fixture else fetch(SOURCE)
        rows = parse(html)
        if not args.fixture:
            # Resolve a bounded number of ambiguous entries. Unconfirmed entries remain hidden.
            ambiguous = [r for r in rows if r["category"] not in KNOWN_VIDEO | {"/games", "/knigi"} and not VIDEO.search(r["title"]) and not NONVIDEO.search(r["title"])][:4]
            with ThreadPoolExecutor(max_workers=2) as pool:
                for row, found in zip(ambiguous, pool.map(detail_category, (r["id"] for r in ambiguous))):
                    if found:
                        row["category"] = found
        videos = sum(r["category"] not in {"/games", "/knigi"} and not NONVIDEO.search(r["title"]) and (r["category"] in KNOWN_VIDEO or bool(VIDEO.search(r["title"]))) for r in rows)
        if videos < 3:
            raise ValueError("snapshot has too few recognizable videos")
        print(f"Validated: {len(rows)} ranked releases, {videos} recognizable videos")
        if args.fixture:
            return
        now = datetime.now(timezone.utc)
        if args.output.exists():
            previous = json.loads(args.output.read_text())
            previous_stamp = datetime.fromisoformat(previous["sourceAt"])
            if stamp < previous_stamp:
                print(f"Upstream source time {stamp.isoformat()}; previous {previous_stamp.isoformat()}")
                if rows != previous["rows"]:
                    raise ValueError("upstream returned an older ranking with different rows")
                # Replicas can report a different age for the same table.
                # Confirm the read without changing the time shown for the ranking.
                stamp = previous_stamp
        data = dict(schema=1, source=SOURCE, fetchedAt=now.isoformat(timespec="seconds"), sourceAt=stamp.isoformat(timespec="seconds"), rows=rows)
        tmp = args.output.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
        tmp.replace(args.output)
        print(f"Updated {args.output} at {data['fetchedAt']}; source time {data['sourceAt']}")
    except (ValueError, OSError, StopIteration, IndexError, KeyError) as error:
        cli.exit(1, f"Rutor refresh failed: {type(error).__name__}: {error}. Previous snapshot retained.\n")


if __name__ == "__main__":
    main()
