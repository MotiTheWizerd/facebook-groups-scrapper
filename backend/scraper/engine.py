"""
Facebook public-group people scraper engine.

Loads the saved logged-in session, opens a group, scrolls the feed while it
collects post/comment author links, and emits a deduped list of people:

    { "name": "...", "profile_url": "...", "user_id": "..." }

In a group, every author (poster or commenter) links to a group-scoped profile:
    /groups/<gid>/user/<uid>/
That link is the cleanest, least-ambiguous signal for "who is active in this
group", so it's our primary extraction target. We also fall back to
profile.php?id= links.

Hardened behaviour (so deep runs are safe and complete):
  - Real exhaustion detection: stops only when the page stops growing AND no new
    people appear for several scrolls (not just because we hit a scroll cap).
  - Lazy-load nudge: when the page height stalls, jiggle the scroll to coax FB
    into loading more before deciding the feed is done.
  - Incremental + resumable: writes results every N scrolls, and --resume merges
    into an existing output file (dedup by user id) so a crash/ban loses nothing.
  - Human-ish pacing with occasional longer pauses on long runs.

Usage:
    python -m scraper.engine <group_url> [--scrolls 300] [--out output/result.json]
        [--idle-limit 8] [--save-every 10] [--resume] [--target 0]
        [--headless/--no-headless] [--debug]
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
    m = _USER_RE.search(href) or _PROFILE_RE.search(href)
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


def _resolve_out(out: str) -> pathlib.Path:
    p = pathlib.Path(out)
    if not p.is_absolute():
        p = pathlib.Path(__file__).resolve().parents[1] / p
    return p


def _load_existing(path: pathlib.Path) -> dict[str, Person]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return {d["user_id"]: Person(**d) for d in data}
    except Exception:
        return {}


def _write(path: pathlib.Path, found: dict[str, Person]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    people = sorted(found.values(), key=lambda x: x.name.lower())
    path.write_text(
        json.dumps([asdict(x) for x in people], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def scrape_group(
    group_url: str,
    scrolls: int = 300,
    idle_limit: int = 8,
    save_every: int = 10,
    target: int = 0,
    out: str = "output/result.json",
    resume: bool = False,
    headless: bool = True,
    debug: bool = False,
    on_progress=None,
) -> list[Person]:
    if not AUTH_STATE.exists():
        raise FileNotFoundError(
            f"No session file at {AUTH_STATE}. Run auth/cookies_to_session.py first."
        )

    out_path = _resolve_out(out)
    found: dict[str, Person] = _load_existing(out_path) if resume else {}
    seed = len(found)

    def _emit(event: str, **data):
        if on_progress:
            on_progress({"event": event, **data})

    if seed:
        _emit("resumed", count=seed, file=str(out_path))

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

        idle = 0                     # consecutive scrolls with no new people
        last_height = 0
        stall = 0                    # consecutive scrolls with no height growth
        stop_reason = "scroll_cap"

        for i in range(scrolls):
            before = len(found)
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

            new = len(found) - before
            idle = idle + 1 if new == 0 else 0

            height = page.evaluate("document.body.scrollHeight")
            stall = stall + 1 if height <= last_height else 0
            last_height = height

            _emit("scroll", index=i + 1, total=scrolls, count=len(found),
                  new=new, idle=idle, stall=stall)

            if save_every and (i + 1) % save_every == 0:
                _write(out_path, found)
                _emit("saved", count=len(found), file=str(out_path))

            if target and len(found) >= target:
                stop_reason = "target_reached"
                break

            # Genuine exhaustion = page not growing AND no new people for a while.
            if idle >= idle_limit and stall >= idle_limit:
                stop_reason = "feed_exhausted"
                break

            # Scroll down; if the page has stalled, jiggle to coax a lazy load.
            page.mouse.wheel(0, random.randint(1600, 2800))
            if stall >= 2:
                time.sleep(1.0)
                page.mouse.wheel(0, -400)
                time.sleep(0.5)
                page.mouse.wheel(0, 1200)
            time.sleep(random.uniform(1.2, 2.6))           # human-ish pacing
            if (i + 1) % 25 == 0:                           # occasional breather
                time.sleep(random.uniform(4.0, 7.0))

        if debug:
            out_dir = pathlib.Path(__file__).resolve().parents[1] / "output"
            page.screenshot(path=str(out_dir / "debug.png"), full_page=False)
            (out_dir / "debug.html").write_text(page.content(), encoding="utf-8")
            _emit("debug_saved", dir=str(out_dir))

        browser.close()

    _write(out_path, found)
    people = sorted(found.values(), key=lambda x: x.name.lower())
    _emit("done", count=len(people), new_this_run=len(found) - seed,
          reason=stop_reason, file=str(out_path))
    return people


def _cli() -> None:
    ap = argparse.ArgumentParser(description="Scrape people from a public FB group.")
    ap.add_argument("group_url")
    ap.add_argument("--scrolls", type=int, default=300, help="max scrolls (safety cap)")
    ap.add_argument("--idle-limit", type=int, default=8,
                    help="stop after this many scrolls with no new people AND no growth")
    ap.add_argument("--save-every", type=int, default=10, help="incremental save cadence")
    ap.add_argument("--target", type=int, default=0, help="stop once N people found (0=off)")
    ap.add_argument("--out", default="output/result.json")
    ap.add_argument("--resume", action="store_true", help="merge into existing --out file")
    ap.add_argument("--headless", dest="headless", action="store_true", default=True)
    ap.add_argument("--no-headless", dest="headless", action="store_false")
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    def log(ev):
        e = ev["event"]
        if e == "scroll":
            print(f"  scroll {ev['index']}/{ev['total']} — {ev['count']} people "
                  f"(+{ev['new']}, idle={ev['idle']}, stall={ev['stall']})", flush=True)
        elif e == "saved":
            print(f"    💾 saved {ev['count']} → {ev['file']}", flush=True)
        else:
            print(f"[{e}] { {k: v for k, v in ev.items() if k != 'event'} }", flush=True)

    people = scrape_group(
        args.group_url,
        scrolls=args.scrolls,
        idle_limit=args.idle_limit,
        save_every=args.save_every,
        target=args.target,
        out=args.out,
        resume=args.resume,
        headless=args.headless,
        debug=args.debug,
        on_progress=log,
    )
    print(f"\n✅ {len(people)} unique people → {_resolve_out(args.out)}")


if __name__ == "__main__":
    _cli()
