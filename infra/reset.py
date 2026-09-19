"""Demo reset: wipe every store and re-seed the demo state cold.

Run with vcs up:  python -m infra.reset   (from the repo root, venv active)
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import asyncpg
import redis as redis_lib
from pymongo import AsyncMongoClient

from vcs.settings import ATLAS_URI, META_DB_URL, MONGO_DB, REDIS_URL


async def wipe():
    conn = await asyncpg.connect(META_DB_URL)
    await conn.execute(
        "truncate ci_runs, merge_requests, branches, commits, repos restart identity cascade"
    )
    await conn.close()
    print("postgres: wiped")

    mongo = AsyncMongoClient(ATLAS_URI)
    db = mongo[MONGO_DB]
    for coll in ("snapshots", "agent_messages", "counters", "migration_history"):
        await db[coll].delete_many({})
    await mongo.close()
    print("mongo: wiped")

    r = redis_lib.from_url(REDIS_URL)
    r.flushall()
    r.close()
    print("redis: flushed")


if __name__ == "__main__":
    asyncio.run(wipe())
    from vcs.seed import full_demo

    full_demo()
    print("reset complete: demo repo re-seeded")
