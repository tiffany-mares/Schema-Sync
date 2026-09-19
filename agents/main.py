import asyncio
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from pymongo import AsyncMongoClient

from agents.scripted import run_scripted_review
from agents.settings import ATLAS_URI, META_DB_URL, MONGO_DB


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = await asyncpg.create_pool(META_DB_URL)
    app.state.mongo = AsyncMongoClient(ATLAS_URI)
    app.state.db = app.state.mongo[MONGO_DB]
    yield
    await app.state.pool.close()
    await app.state.mongo.close()


app = FastAPI(title="schemasync-agents", lifespan=lifespan)


class ReviewIn(BaseModel):
    mr_id: int


async def set_status(mr_id: int, status: str):
    async with app.state.pool.acquire() as conn:
        await conn.execute(
            "update merge_requests set status = $2 where id = $1", mr_id, status
        )


async def get_mr(mr_id: int) -> dict:
    async with app.state.pool.acquire() as conn:
        row = await conn.fetchrow(
            "select id, source, target, base_commit, status from merge_requests where id = $1",
            mr_id,
        )
    if not row:
        raise HTTPException(404, f"merge request {mr_id} not found")
    return dict(row)


@app.post("/reviews", status_code=202)
async def start_review(body: ReviewIn):
    mr = await get_mr(body.mr_id)
    if mr["status"] not in ("open", "rejected"):
        raise HTTPException(409, f"merge request {body.mr_id} is {mr['status']}")
    # Progress goes to the Atlas board; the change stream carries it to the UI.
    asyncio.create_task(run_scripted_review(app.state.db, mr, set_status))
    return {"mr_id": body.mr_id, "status": "reviewing"}


@app.post("/reviews/{mr_id}/approve")
async def approve(mr_id: int):
    mr = await get_mr(mr_id)
    if mr["status"] != "awaiting_approval":
        raise HTTPException(409, f"merge request {mr_id} is {mr['status']}, not awaiting_approval")
    await set_status(mr_id, "approved")
    # Phase 7: this is where the Release Agent fires (PR, Linear, Slack).
    return {"mr_id": mr_id, "status": "approved"}


@app.get("/health")
async def health():
    return {"ok": True}
