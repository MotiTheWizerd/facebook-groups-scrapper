"""
Round 1 — Session saver via EXISTING Chrome profile (no password needed).

You're already logged into Facebook in Google Chrome. This reuses that session:
it copies your Chrome profile to a temp dir (so your real profile is never
touched), launches Google Chrome against the copy, and exports the authenticated
cookies to storage_state.json — which the scraper then reuses.

Why a copy + channel="chrome":
  - channel="chrome" runs your *installed* Google Chrome, so the profile version
    matches and cookie decryption via the OS keyring works.
  - Copying avoids the "profile is locked / in use" problem and never risks your
    real data.

Prereqs:
  - Fully QUIT Chrome before running (so cookies aren't mid-write).
  - Be in a normal desktop session (keyring unlocked) so cookies decrypt.

Run:
    backend/.venv/bin/python auth/save_session_from_chrome.py
    # non-default profile:
    backend/.venv/bin/python auth/save_session_from_chrome.py --profile "Profile 1"
"""
from __future__ import annotations

import argparse
import pathlib
import shutil
import tempfile

from playwright.sync_api import sync_playwright

OUT = pathlib.Path(__file__).parent / "storage_state.json"
DEFAULT_UDD = pathlib.Path.home() / ".config" / "google-chrome"

# Big/lock-prone things we don't need for auth — skip them when copying.
_IGNORE = shutil.ignore_patterns(
    "Cache", "Code Cache", "GPUCache", "GraphiteDawnCache", "DawnCache",
    "Service Worker", "Crashpad", "ShaderCache", "component_crx_cache",
    "Singleton*", "*.lock", "lockfile",
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user-data-dir", default=str(DEFAULT_UDD),
                    help="Chrome user data dir (default: ~/.config/google-chrome)")
    ap.add_argument("--profile", default="Default",
                    help='Profile folder name, e.g. "Default" or "Profile 1"')
    args = ap.parse_args()

    src = pathlib.Path(args.user_data_dir)
    if not (src / args.profile).exists():
        raise SystemExit(
            f"❌ Profile '{args.profile}' not found in {src}.\n"
            f"   Folders present: "
            f"{[p.name for p in src.iterdir() if p.is_dir()][:20]}"
        )

    tmp = pathlib.Path(tempfile.mkdtemp(prefix="fbscrape-chrome-"))
    print(f"📋 Copying Chrome profile → {tmp} (this can take a few seconds)...")
    # Copy the few top-level files Chrome needs + the chosen profile folder.
    for item in src.iterdir():
        if item.is_file():
            shutil.copy2(item, tmp / item.name)
    shutil.copytree(src / args.profile, tmp / args.profile, ignore=_IGNORE,
                    dirs_exist_ok=True)

    try:
        with sync_playwright() as p:
            ctx = p.chromium.launch_persistent_context(
                user_data_dir=str(tmp),
                channel="chrome",
                headless=False,
                args=[f"--profile-directory={args.profile}"],
                no_viewport=True,
            )
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto("https://www.facebook.com/", wait_until="domcontentloaded")

            print("\n" + "=" * 64)
            print("  A Chrome window opened. You should ALREADY be logged in.")
            print("  • If you see your FB feed → great, nothing to do.")
            print("  • If not, log in now in that window.")
            print("  Then come back here and press ENTER to save the session.")
            print("=" * 64 + "\n")
            input("Press ENTER once you can see your Facebook feed... ")

            ctx.storage_state(path=str(OUT))
            n = len(ctx.cookies())
            print(f"\n✅ Session saved to: {OUT}  ({n} cookies captured)")
            ctx.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        print("🧹 Temp profile copy removed.")


if __name__ == "__main__":
    main()
