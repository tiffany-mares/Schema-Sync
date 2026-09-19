from datetime import datetime, timezone

from pymongo import ReturnDocument


class Board:
    """The agent message board in Atlas. Agents never call each other —
    every message lands here, and change streams push it live to the UI."""

    def __init__(self, db, mr_id: int):
        self.db, self.mr_id = db, mr_id

    async def post(self, agent: str, kind: str, body: dict, refs: list | None = None):
        c = await self.db.counters.find_one_and_update(
            {"_id": f"mr:{self.mr_id}"},
            {"$inc": {"seq": 1}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        await self.db.agent_messages.insert_one({
            "mr_id": self.mr_id,
            "seq": c["seq"],
            "agent": agent,
            "kind": kind,
            "body": body,
            "refs": refs or [],
            "ts": datetime.now(timezone.utc),
        })

    async def read(self, kinds: list[str]):
        cur = self.db.agent_messages.find(
            {"mr_id": self.mr_id, "kind": {"$in": kinds}}
        ).sort("seq", 1)
        return [m async for m in cur]
