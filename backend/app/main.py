"""
FastAPI app for the Facebook group scraper.

Endpoints (all under /api):
  GET  /health
  POST /groups                 {url, name?}          -> register a group
  GET  /groups                                       -> list groups + people counts
  GET  /groups/{id}/people     ?include_anon=&q=&page=&per_page= -> paged people
  GET  /groups/{id}/people.csv                       -> CSV download
  POST /scrape                 {group_id, scrolls?}  -> start a scrape job
  GET  /jobs                                         -> recent jobs
  GET  /jobs/{id}                                    -> job status
  GET  /jobs/{id}/stream                             -> live SSE progress
  GET  /people                 ?include_anon=        -> all people (cross-group pool)
  GET  /people.csv                                   -> CSV download
"""
from __future__ import annotations

import asyncio
import csv
import io
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel

from . import db
from .jobs import manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Facebook Group Scraper API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


class GroupIn(BaseModel):
    url: str
    name: str | None = None


class ScrapeIn(BaseModel):
    group_id: int
    scrolls: int = 120
    resume: bool = True


def _csv(people: list[dict], filename: str) -> Response:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["name", "profile_url", "user_id", "is_anonymous", "avatar_url"])
    for p in people:
        w.writerow([p["name"], p["profile_url"], p["user_id"], p["is_anonymous"],
                    p.get("avatar_url", "")])
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/groups")
def create_group(body: GroupIn):
    return db.add_group(body.url.strip(), body.name)


@app.get("/api/groups")
def get_groups():
    return db.list_groups()


@app.delete("/api/groups/{group_id}")
def delete_group(group_id: int):
    if not db.delete_group(group_id):
        raise HTTPException(404, "group not found")
    return {"ok": True, "deleted": group_id}


@app.get("/api/groups/{group_id}/people")
def group_people(group_id: int, include_anon: bool = True, q: str = "",
                 page: int = 1, per_page: int = 50):
    if not db.get_group(group_id):
        raise HTTPException(404, "group not found")
    return db.list_people_page(group_id, include_anon=include_anon, q=q,
                               page=page, per_page=per_page)


@app.get("/api/groups/{group_id}/people.csv")
def group_people_csv(group_id: int, include_anon: bool = True):
    if not db.get_group(group_id):
        raise HTTPException(404, "group not found")
    return _csv(db.list_people(group_id, include_anon=include_anon),
                f"group_{group_id}_people.csv")


@app.post("/api/scrape")
def start_scrape(body: ScrapeIn):
    group = db.get_group(body.group_id)
    if not group:
        raise HTTPException(404, "group not found")
    job_id = manager.start_scrape(group, scrolls=body.scrolls, resume=body.resume)
    return {"job_id": job_id, "group_id": body.group_id, "status": "started"}


@app.post("/api/jobs/{job_id}/stop")
def stop_scrape(job_id: str):
    if not manager.cancel(job_id):
        raise HTTPException(404, "job not active (already finished or unknown)")
    return {"ok": True, "job_id": job_id, "status": "stopping"}


@app.get("/api/jobs")
def get_jobs():
    return db.list_jobs()


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return job


@app.get("/api/jobs/{job_id}/stream")
async def job_stream(job_id: str):
    job = manager.get(job_id)
    if not job:
        raise HTTPException(404, "job not active (already finished or unknown)")

    async def gen():
        yield ": connected\n\n"
        idx = 0
        while True:
            events, done = job.snapshot(idx)
            for ev in events:
                idx += 1
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
            if done:
                yield "event: end\ndata: {}\n\n"
                return
            await asyncio.sleep(0.3)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


@app.get("/api/people")
def all_people(include_anon: bool = True):
    return db.list_people(None, include_anon=include_anon)


@app.get("/api/people.csv")
def all_people_csv(include_anon: bool = True):
    return _csv(db.list_people(None, include_anon=include_anon), "all_people.csv")
