"""
Background scrape job runner.

The scraper engine is *sync* Playwright, which can't run inside the asyncio
event loop. So each job runs in its own daemon thread; the engine's on_progress
callback appends events to an in-memory list on the Job. The SSE endpoint reads
that list by index (so reconnects/multiple viewers all catch up cleanly), and
when the scrape finishes we upsert the people into SQLite.
"""
from __future__ import annotations

import pathlib
import threading
import time

from . import db
from scraper.engine import scrape_group


class Job:
    def __init__(self, job_id: str, group_id: int):
        self.id = job_id
        self.group_id = group_id
        self.events: list[dict] = []
        self.done = False
        self._lock = threading.Lock()

    def push(self, ev: dict) -> None:
        with self._lock:
            self.events.append(ev)

    def snapshot(self, start: int) -> tuple[list[dict], bool]:
        with self._lock:
            return self.events[start:], self.done


class JobManager:
    def __init__(self):
        self.jobs: dict[str, Job] = {}

    def start_scrape(self, group: dict, scrolls: int = 120, resume: bool = True) -> str:
        job_id = db.create_job(group["id"], scrolls)
        job = Job(job_id, group["id"])
        self.jobs[job_id] = job
        threading.Thread(
            target=self._run, args=(job, group, scrolls, resume), daemon=True
        ).start()
        return job_id

    def get(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)

    def _run(self, job: Job, group: dict, scrolls: int, resume: bool) -> None:
        db.update_job(job.id, status="running")
        job.push({"event": "status", "status": "running", "group_id": group["id"]})
        out = pathlib.Path(db.DB_PATH).parent / "groups" / f"group_{group['id']}.json"
        try:
            people = scrape_group(
                group["url"], scrolls=scrolls, out=str(out), resume=resume,
                on_progress=job.push,
            )
            ppl = [
                {"user_id": p.user_id, "name": p.name, "profile_url": p.profile_url}
                for p in people
            ]
            new_links = db.upsert_people(group["id"], ppl)
            db.update_job(job.id, status="done", found=len(ppl),
                          new_found=new_links, finished_at=time.time())
            job.push({"event": "persisted", "found": len(ppl),
                      "new_in_group": new_links})
            job.push({"event": "status", "status": "done"})
        except Exception as e:  # noqa: BLE001 — surface any engine failure to the UI
            db.update_job(job.id, status="error", error=str(e),
                          finished_at=time.time())
            job.push({"event": "status", "status": "error", "error": str(e)})
        finally:
            with job._lock:
                job.done = True


manager = JobManager()
