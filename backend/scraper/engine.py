"""
Round 1 — Facebook public-group people scraper engine.

Loads the saved logged-in session, opens a group, scrolls the feed while it
collects post/comment author links, and emits a deduped list of people:

    { "name": "...", "profile_url": "...", "user_id": "..." }

In a group, every author (poster or commenter) links to a group-scoped profile:
    /groups/<gid>/user/<uid>/
That link is the cleanest, least-ambiguous signal for "who is active in this
group", so it's our primary extraction target. We also fall back to
profile.php?id= links.

Usage:
    backend/.venv/bin/python -m scraper.engine <group_url> \
        --scrolls 40 --out output/result.json [--headless/--no-headless] [--debug]
"""
from __future__ import annotations

import argparse
import json
import pathlib
import random
import re
import time
from dataclasses import dataclass, asdict

from playwright.sync_api import sync_playwright, Page

AUTH_STATE = pathlib.Path(__file__).resolve().parents[1] / "auth" / "storage_state.json"

# Anchor text that is never a person's name (UI chrome, varies by FB locale a bit).
_NOISE = {
    "like", "comment", "share", "reply", "follow", "see more", "see translation",
    "most relevant", "all comments", "view more comments", "write a comment",
    "join", "joined", "members", "admin", "moderator", "author", "top contributor",
    "active", "anonymous member", "group member",
}

_USER_RE = re.compile(r"/groups/\d+/user/(\d+)")
_PROFILE_RE = re.compile(r"profile\.php\?id=(\d+)")


@dataclass(frozen=True)
class Person:
    name: str
    profile_url: str
    user_id: str


def _user_key(href: str) -> tuple[str, str] | None:
    """Return (user_id, canonical_profile_url) for an author link, or None."""
    m = _USER_RE.search(href)
    if m:
        uid = m.group(1)
        return uid, f"https://www.facebook.com/profile.php?id={uid}"
    m = _PROFILE_RE.search(href)
    if m:
        uid = m.group(1)
        return uid, f"https://www.facebook.com/profile.php?id={uid}"
    return None


def _looks_like_name(text: str) -> bool:
    t = text.strip()
    if not (2 <= len(t) <= 60):
        return False
    if t.lower() in _NOISE:
        return False
    if t.isdigit():
        return False
    # Reject things that are clearly counts/timestamps ("3h", "12 likes").
    if re.fullmatch(r"[\d\s.,·hmsdwy]+", t.lower()):
        return False
    return True


def _harvest(page: Page) -> list[dict]:
    """Pull every author-like anchor currently in the DOM."""
    return page.eval_on_selector_all(
        'a[href*="/user/"], a[href*="profile.php?id="]',
        """els => els.map(a => ({
            href: a.href,
            text: (a.innerText || a.textContent || '').trim()
        }))""",
    )


def scrape_group(
    group_url: str,
    scrolls: int = 40,
    headless: bool = True,
    debug: bool = False,
    on_progress=None,
) -> list[Person]:
    if not AUTH_STATE.exists():
        raise FileNotFoundError(
            f"No session file at {AUTH_STATE}. Run auth/save_session.py first."
        )

    found: dict[str, Person] = {}

    def _emit(event: str, **data):
        if on_progress:
            on_progress({"event": event, **data})

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        ctx = browser.new_context(
            storage_state=str(AUTH_STATE),
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        page = ctx.new_page()
        _emit("navigating", url=group_url)
        page.goto(group_url, wait_until="domcontentloaded", timeout=60_000)
        time.sleep(3)

        for i in range(scrolls):
            for raw in _harvest(page):
                key = _user_key(raw["href"])
                if not key:
                    continue
                uid, url = key
                name = raw["text"].splitlines()[0].strip() if raw["text"] else ""
                if not _looks_like_name(name):
                    continue
                if uid not in found:
                    found[uid] = Person(name=name, profile_url=url, user_id=uid)

            _emit("scroll", index=i + 1, total=scrolls, count=len(found))
            page.mouse.wheel(0, random.randint(1500, 2600))
            time.sleep(random.uniform(1.2, 2.6))  # human-ish pacing

        if debug:
            out_dir = pathlib.Path(__file__).resolve().parents[1] / "output"
            page.screenshot(path=str(out_dir / "debug.png"), full_page=False)
            (out_dir / "debug.html").write_text(page.content(), encoding="utf-8")
            _emit("debug_saved", dir=str(out_dir))

        browser.close()

    people = sorted(found.values(), key=lambda x: x.name.lower())
    _emit("done", count=len(people))
    return people


def _cli() -> None:
    ap = argparse.ArgumentParser(description="Scrape people from a public FB group.")
    ap.add_argument("group_url")
    ap.add_argument("--scrolls", type=int, default=40)
    ap.add_argument("--out", default="output/result.json")
    ap.add_argument("--headless", dest="headless", action="store_true", default=True)
    ap.add_argument("--no-headless", dest="headless", action="store_false")
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    def log(ev):
        if ev["event"] == "scroll":
            print(f"  scroll {ev['index']}/{ev['total']} — {ev['count']} people", flush=True)
        else:
            print(f"[{ev['event']}] { {k: v for k, v in ev.items() if k != 'event'} }", flush=True)

    people = scrape_group(
        args.group_url,
        scrolls=args.scrolls,
        headless=args.headless,
        debug=args.debug,
        on_progress=log,
    )

    out_path = pathlib.Path(args.out)
    if not out_path.is_absolute():
        out_path = pathlib.Path(__file__).resolve().parents[1] / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps([asdict(x) for x in people], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n✅ {len(people)} unique people → {out_path}")


if __name__ == "__main__":
    _cli()
