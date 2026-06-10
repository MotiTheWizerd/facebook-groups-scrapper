"""
Round 1 — Build storage_state.json directly from the EXISTING Chromium session.

Your snap Chromium stores cookies with the Linux "basic" scheme (v10 prefix,
hardcoded "peanuts" password) because snap confinement blocked the OS keyring.
That means we can decrypt them directly in Python — no browser launch, no
password, no device check, nothing for you to do.

This reads the Cookies SQLite from your Chromium profile, decrypts every cookie,
and writes a Playwright-compatible storage_state.json the scraper reuses.

Run:
    backend/.venv/bin/python auth/cookies_to_session.py
    # other profile / browser:
    backend/.venv/bin/python auth/cookies_to_session.py --cookies <path/to/Cookies>
"""
from __future__ import annotations

import argparse
import hashlib
import os
import pathlib
import shutil
import sqlite3
import tempfile

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

OUT = pathlib.Path(__file__).parent / "storage_state.json"
DEFAULT_COOKIES = pathlib.Path.home() / "snap/chromium/common/chromium/Default/Cookies"

# Linux Chromium "basic" password store key derivation (PBKDF2-HMAC-SHA1,
# password "peanuts", salt "saltysalt", 1 iteration, 16-byte key).
_KEY = hashlib.pbkdf2_hmac("sha1", b"peanuts", b"saltysalt", 1, dklen=16)
_IV = b" " * 16
# Chromium epoch (1601-01-01) → Unix epoch offset, in seconds.
_EPOCH_OFFSET = 11_644_473_600

_SAMESITE = {-1: "Lax", 0: "None", 1: "Lax", 2: "Strict"}


def _decrypt(enc: bytes, host_key: str) -> str | None:
    if not enc or enc[:3] != b"v10":
        # v11 would mean keyring-encrypted (can't decrypt without it); skip.
        return None
    cipher = Cipher(algorithms.AES(_KEY), modes.CBC(_IV))
    dec = cipher.decryptor()
    raw = dec.update(enc[3:]) + dec.finalize()
    # Strip PKCS7 padding.
    if raw and 1 <= raw[-1] <= 16:
        raw = raw[: -raw[-1]]
    # Newer Chromium (>= M127) prepends a 32-byte domain hash to the plaintext.
    # It's binary, so a clean decode means there's no prefix; a failed decode
    # means we must drop the leading 32 bytes and retry.
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return raw[32:].decode("utf-8")
        except (UnicodeDecodeError, IndexError):
            return None


def build(cookies_path: pathlib.Path) -> dict:
    if not cookies_path.exists():
        raise SystemExit(f"❌ Cookies db not found: {cookies_path}")

    tmp = tempfile.mktemp(suffix=".db")
    shutil.copy2(cookies_path, tmp)  # avoid lock on the live db
    try:
        con = sqlite3.connect(tmp)
        rows = con.execute(
            "select host_key, name, encrypted_value, path, expires_utc, "
            "is_secure, is_httponly, samesite, has_expires from cookies"
        ).fetchall()
        con.close()
    finally:
        os.remove(tmp)

    cookies, skipped = [], 0
    for host, name, enc, path, exp_utc, secure, httponly, samesite, has_exp in rows:
        val = _decrypt(enc, host)
        if val is None:
            skipped += 1
            continue
        expires = -1
        if has_exp and exp_utc:
            expires = int(exp_utc / 1_000_000 - _EPOCH_OFFSET)
        ss = _SAMESITE.get(samesite, "Lax")
        cookies.append({
            "name": name,
            "value": val,
            "domain": host,
            "path": path or "/",
            "expires": expires,
            "httpOnly": bool(httponly),
            "secure": bool(secure) or ss == "None",  # None requires Secure
            "sameSite": ss,
        })
    return {"cookies": cookies, "origins": []}, skipped


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cookies", default=str(DEFAULT_COOKIES))
    ap.add_argument("--all", action="store_true",
                    help="keep ALL cookies, not just Facebook (default: FB only)")
    args = ap.parse_args()

    state, skipped = build(pathlib.Path(args.cookies))
    # Keep only Facebook-related cookies — the scraper needs nothing else, and
    # we don't want the rest of your browsing session in this artifact.
    if not args.all:
        state["cookies"] = [
            c for c in state["cookies"]
            if any(d in c["domain"] for d in ("facebook.com", "fbcdn.net", "fb.com"))
        ]
    fb = [c for c in state["cookies"] if "facebook" in c["domain"]]
    session_ok = any(c["name"] in ("c_user", "xs") for c in fb)
    c_user = next((c["value"] for c in fb if c["name"] == "c_user"), None)

    import json
    OUT.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"✅ storage_state.json written → {OUT}")
    print(f"   total cookies: {len(state['cookies'])} (skipped/undecryptable: {skipped})")
    print(f"   facebook cookies: {len(fb)}")
    print(f"   logged-in (c_user/xs present): {session_ok}")
    print(f"   c_user (FB user id): {c_user}")
    if not session_ok:
        print("⚠️  No FB session cookies found — are you logged in on this profile?")


if __name__ == "__main__":
    main()
