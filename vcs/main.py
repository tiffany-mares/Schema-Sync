import hashlib
import json
from contextlib import asynccontextmanager

import asyncpg
import redis.asyncio as aioredis
import schemasync_core as core
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field
from pymongo import AsyncMongoClient

from vcs.settings import ATLAS_URI, EMPTY_SCHEMA_JSON, META_DB_URL, MONGO_DB, REDIS_URL

DIFF_CACHE_TTL = 3600


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = await asyncpg.create_pool(META_DB_URL)
    app.state.mongo = AsyncMongoClient(ATLAS_URI)
    app.state.snapshots = app.state.mongo[MONGO_DB].snapshots
    app.state.redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    yield
    await app.state.pool.close()
    await app.state.mongo.close()
    await app.state.redis.aclose()


app = FastAPI(title="schemasync-vcs", lifespan=lifespan)


class CommitIn(BaseModel):
    branch: str
    ddl: str
    message: str


class BranchIn(BaseModel):
    name: str
    from_: str = Field(alias="from")


async def repo_id_for(conn, name: str, create: bool = False):
    row = await conn.fetchrow("select id from repos where name = $1", name)
    if row:
        return row["id"]
    if create:
        row = await conn.fetchrow("insert into repos(name) values($1) returning id", name)
        return row["id"]
    raise HTTPException(404, f"repo {name} not found")


async def snapshot_json(app, snapshot_hash: str) -> str:
    doc = await app.state.snapshots.find_one({"_id": snapshot_hash})
    if not doc:
        raise HTTPException(500, f"snapshot {snapshot_hash} missing from store")
    return json.dumps({"tables": doc["schema"]["tables"]})


async def branch_snapshot(app, conn, repo_id, branch: str) -> tuple[str, str]:
    """Returns (head_commit_hash, snapshot_hash) for a branch."""
    row = await conn.fetchrow(
        "select b.head, c.snapshot_hash from branches b join commits c on c.hash = b.head "
        "where b.repo_id = $1 and b.name = $2",
        repo_id, branch,
    )
    if not row:
        raise HTTPException(404, f"branch {branch} not found")
    return row["head"], row["snapshot_hash"]


@app.post("/repos/{repo}/commits")
async def create_commit(repo: str, body: CommitIn):
    try:
        schema_str = core.parse_schema_json(body.ddl)
    except ValueError as e:
        raise HTTPException(400, str(e))
    snap_hash = sha256(schema_str)

    # Content-addressed: identical schemas share one snapshot document.
    await app.state.snapshots.update_one(
        {"_id": snap_hash},
        {"$setOnInsert": {"schema": json.loads(schema_str)}},
        upsert=True,
    )

    async with app.state.pool.acquire() as conn:
        async with conn.transaction():
            rid = await repo_id_for(conn, repo, create=True)
            head = await conn.fetchval(
                "select head from branches where repo_id = $1 and name = $2", rid, body.branch
            )
            parents = [head] if head else []
            commit_hash = sha256(snap_hash + "".join(parents) + body.message)
            await conn.execute(
                "insert into commits(hash, repo_id, parent_hashes, snapshot_hash, message) "
                "values($1, $2, $3, $4, $5) on conflict (hash) do nothing",
                commit_hash, rid, parents, snap_hash, body.message,
            )
            await conn.execute(
                "insert into branches(repo_id, name, head) values($1, $2, $3) "
                "on conflict (repo_id, name) do update set head = excluded.head",
                rid, body.branch, commit_hash,
            )
        if parents:
            parent_snap = await conn.fetchval(
                "select snapshot_hash from commits where hash = $1", parents[0]
            )
            old_json = await snapshot_json(app, parent_snap)
        else:
            old_json = EMPTY_SCHEMA_JSON

    changes = json.loads(core.diff_json(old_json, schema_str))
    return {"hash": commit_hash, "changes": changes}


@app.get("/repos/{repo}/diff")
async def diff(repo: str, from_: str = Query(alias="from"), to: str = Query()):
    async with app.state.pool.acquire() as conn:
        rid = await repo_id_for(conn, repo)
        _, from_snap = await branch_snapshot(app, conn, rid, from_)
        _, to_snap = await branch_snapshot(app, conn, rid, to)

    cache_key = f"diff:{from_snap}:{to_snap}"
    cached = await app.state.redis.get(cache_key)
    if cached:
        return json.loads(cached)

    from_json = await snapshot_json(app, from_snap)
    to_json = await snapshot_json(app, to_snap)
    result = {
        "changes": json.loads(core.diff_json(from_json, to_json)),
        "from_schema": json.loads(from_json),
        "to_schema": json.loads(to_json),
    }
    await app.state.redis.setex(cache_key, DIFF_CACHE_TTL, json.dumps(result))
    return result


@app.post("/repos/{repo}/branches", status_code=201)
async def create_branch(repo: str, body: BranchIn):
    async with app.state.pool.acquire() as conn:
        rid = await repo_id_for(conn, repo)
        head, _ = await branch_snapshot(app, conn, rid, body.from_)
        try:
            await conn.execute(
                "insert into branches(repo_id, name, head) values($1, $2, $3)", rid, body.name, head
            )
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, f"branch {body.name} already exists")
    return {"name": body.name, "head": head}


@app.get("/repos/{repo}/branches")
async def list_branches(repo: str):
    async with app.state.pool.acquire() as conn:
        rid = await repo_id_for(conn, repo)
        rows = await conn.fetch(
            "select name, head from branches where repo_id = $1 order by name", rid
        )
    return [{"name": r["name"], "head": r["head"]} for r in rows]


class MergeRequestIn(BaseModel):
    source: str
    target: str


async def ancestors(conn, head: str) -> list[str]:
    """All ancestor hashes of a commit, nearest first (BFS over parents)."""
    seen: list[str] = []
    frontier = [head]
    visited = set()
    while frontier:
        row = await conn.fetch(
            "select hash, parent_hashes from commits where hash = any($1::char(64)[])", frontier
        )
        nxt: list[str] = []
        for r in row:
            if r["hash"] in visited:
                continue
            visited.add(r["hash"])
            seen.append(r["hash"])
            nxt.extend(r["parent_hashes"])
        frontier = [h for h in nxt if h not in visited]
    return seen


def change_targets(changes: list[dict]) -> dict[tuple, dict]:
    """Map each change to the (table, column) it touches for conflict checks."""
    out = {}
    for ch in changes:
        kind = ch["kind"]
        if kind in ("AddTable", "DropTable"):
            name = ch["table"]["name"] if kind == "AddTable" else ch["name"]
            out[(name, None)] = ch
        else:
            col = ch.get("column")
            col_name = col["name"] if isinstance(col, dict) else col
            out[(ch["table"], col_name)] = ch
    return out


@app.post("/repos/{repo}/merge-requests", status_code=201)
async def create_merge_request(repo: str, body: MergeRequestIn):
    async with app.state.pool.acquire() as conn:
        rid = await repo_id_for(conn, repo)
        src_head, src_snap = await branch_snapshot(app, conn, rid, body.source)
        tgt_head, tgt_snap = await branch_snapshot(app, conn, rid, body.target)

        src_anc = await ancestors(conn, src_head)
        tgt_anc = set(await ancestors(conn, tgt_head))
        base = next((h for h in src_anc if h in tgt_anc), None)
        if base is None:
            raise HTTPException(409, "branches share no common ancestor")

        base_snap = await conn.fetchval(
            "select snapshot_hash from commits where hash = $1", base
        )
        base_json = await snapshot_json(app, base_snap)
        src_changes = json.loads(core.diff_json(base_json, await snapshot_json(app, src_snap)))
        tgt_changes = json.loads(core.diff_json(base_json, await snapshot_json(app, tgt_snap)))

        conflicts = []
        tgt_map = change_targets(tgt_changes)
        for key, ch in change_targets(src_changes).items():
            other = tgt_map.get(key)
            if other is not None and other != ch:
                conflicts.append({"table": key[0], "column": key[1], "source": ch, "target": other})

        row = await conn.fetchrow(
            "insert into merge_requests(repo_id, source, target, base_commit) "
            "values($1, $2, $3, $4) returning id",
            rid, body.source, body.target, base,
        )
    return {"id": row["id"], "base_commit": base, "conflicts": conflicts}


@app.get("/repos/{repo}/merge-requests/{mr_id}")
async def get_merge_request(repo: str, mr_id: int):
    async with app.state.pool.acquire() as conn:
        rid = await repo_id_for(conn, repo)
        row = await conn.fetchrow(
            "select id, source, target, base_commit, status, verdict "
            "from merge_requests where id = $1 and repo_id = $2",
            mr_id, rid,
        )
    if not row:
        raise HTTPException(404, f"merge request {mr_id} not found")
    return dict(row)


class ColumnRef(BaseModel):
    table: str
    column: str
    type_name: str | None = None


class RenamesIn(BaseModel):
    drops: list[ColumnRef]
    adds: list[ColumnRef]


@app.post("/tools/renames")
async def renames(body: RenamesIn):
    from starlette.concurrency import run_in_threadpool

    from vcs.renames import detect_renames

    pairs = await run_in_threadpool(
        detect_renames,
        [c.model_dump() for c in body.drops],
        [c.model_dump() for c in body.adds],
    )
    return {"pairs": pairs}


@app.get("/health")
async def health():
    return {"ok": True}
