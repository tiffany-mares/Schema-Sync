"""Scripted review of the orders.total scenario — the Floor 2 fallback.

The message *sequence* is fixed, but the data inside is real: the change
list comes from the actual vcs diff, the draft SQL from the migrator, and
the dry-run really executes. Live agents in Phase 6 must keep exactly these
message shapes so the UI never knows the difference.
"""

import asyncio

import httpx

from agents.board import Board
from agents.settings import MIGRATOR_URL, REPO, VCS_URL

# What the Impact Scout "finds" in the sandbox repo (real Composio search in Phase 7).
SCOUT_REFS = [
    "src/models/order.py",
    "src/api/orders.py",
    "src/reports/revenue.py",
    "src/emails/receipt.py",
]

STEP_DELAY = 1.0


async def run_scripted_review(db, mr, set_status):
    mr_id = mr["id"]
    board = Board(db, mr_id)

    async with httpx.AsyncClient(timeout=60) as http:
        await set_status(mr_id, "reviewing")

        # Leader: task plan
        await board.post("leader", "plan", {
            "text": f"Reviewing MR !{mr_id} ({mr['source']} -> {mr['target']}). "
                    "Analyst: enumerate changes. Scout: find code touching them. "
                    "Engineer: draft and validate a migration.",
        })
        await asyncio.sleep(STEP_DELAY)

        # Analyst: real diff from vcs
        diff = (await http.get(
            f"{VCS_URL}/repos/{REPO}/diff",
            params={"from": mr["target"], "to": mr["source"]},
        )).json()
        changes = diff["changes"]
        await board.post("analyst", "finding", {
            "text": f"{len(changes)} schema change(s) detected.",
            "changes": changes,
        })
        await asyncio.sleep(STEP_DELAY)

        # Scout: code references for dropped columns
        dropped = [c for c in changes if c["kind"] == "DropColumn"]
        if dropped:
            col = f"{dropped[0]['table']}.{dropped[0]['column']}"
            await board.post("scout", "finding", {
                "text": f"Column {col} is referenced in {len(SCOUT_REFS)} files. "
                        "A plain DROP will break them.",
            }, refs=SCOUT_REFS)
        else:
            await board.post("scout", "finding", {"text": "No dropped columns are referenced in code."})
        await asyncio.sleep(STEP_DELAY)

        # Engineer: draft straight from the generator
        draft_sql = (await http.post(
            f"{MIGRATOR_URL}/migrations/generate", json={"changes": changes}
        )).json()["sql"]
        await board.post("engineer", "proposal", {
            "text": "Draft migration generated from the change list.",
            "sql": draft_sql,
        })
        await asyncio.sleep(STEP_DELAY)

        # Engineer: revision — the collaboration moment
        final_sql = draft_sql
        if dropped:
            col = dropped[0]["column"]
            table = dropped[0]["table"]
            expand_contract = "\n".join(
                line for line in draft_sql.splitlines()
                if f"DROP COLUMN {col}" not in line
            )
            expand_contract += (
                f"\n-- expand/contract: {table}.{col} is still read by "
                f"{len(SCOUT_REFS)} call sites.\n"
                f"-- Phase 1 (now): stop writing {table}.{col}; keep the column.\n"
                f"-- Phase 2 (after the {len(SCOUT_REFS)} references ship): "
                f"ALTER TABLE {table} DROP COLUMN {col};"
            )
            final_sql = expand_contract
            await board.post("engineer", "revision", {
                "text": f"Scout found {len(SCOUT_REFS)} live references to {table}.{col}. "
                        "Rewriting the plain DROP into an expand/contract migration: "
                        "the column survives this deploy and is dropped only after "
                        "the referencing code ships.",
                "sql": final_sql,
            }, refs=SCOUT_REFS)
            await asyncio.sleep(STEP_DELAY)

        # Real dry-run against the target branch schema
        base_schema = diff["from_schema"]
        result = (await http.post(f"{MIGRATOR_URL}/migrations/dryrun", json={
            "base_schema": base_schema,
            "migration_sql": final_sql,
            "mr_id": mr_id,
        })).json()
        await board.post("engineer", "action", {
            "text": ("Dry-run passed in "
                     f"{result['duration_ms']} ms on a fresh database with seeded rows.")
            if result["ok"] else f"Dry-run FAILED: {result.get('error')}",
            "dryrun": result,
        })
        await asyncio.sleep(STEP_DELAY)

        # Leader: verdict + human gate
        ok = result["ok"]
        await board.post("leader", "verdict", {
            "text": ("Migration validated. Expand/contract protects the "
                     f"{len(SCOUT_REFS)} referencing files. Awaiting human approval."
                     if dropped else "Migration validated. Awaiting human approval.")
            if ok else "Dry-run failed — sending back to the Engineer.",
            "approve": ok,
            "sql": final_sql,
        })
        await set_status(mr_id, "awaiting_approval" if ok else "rejected")
