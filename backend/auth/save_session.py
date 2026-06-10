"""
Round 1 — Session saver.

Opens a HEADED Chromium, lets you log into Facebook manually (with the throwaway
account), then saves the authenticated cookies/localStorage to storage_state.json.
The scraper reuses that file so we never automate the login itself.

Run:
    backend/.venv/bin/python backend/auth/save_session.py

Then log in inside the window, get to your normal feed, and press ENTER in the
terminal to save the session.
"""
import pathlib
from playwright.sync_api import sync_playwright

OUT = pathlib.Path(__file__).parent / "storage_state.json"


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        ctx = browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        page = ctx.new_page()
        page.goto("https://www.facebook.com/", wait_until="domcontentloaded")

        print("\n" + "=" * 60)
        print("  Log into Facebook in the browser window.")
        print("  When you can see your normal feed, come back here")
        print("  and press ENTER to save the session.")
        print("=" * 60 + "\n")
        input("Press ENTER once you are logged in... ")

        ctx.storage_state(path=str(OUT))
        print(f"\n✅ Session saved to: {OUT}")
        browser.close()


if __name__ == "__main__":
    main()
