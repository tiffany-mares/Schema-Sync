# Demo runbook

Total time: ~2.5 minutes. Everything on screen is real: real Postgres parser,
real diff, real dry-run database, real MongoDB Atlas change streams.

## Pre-flight (5 minutes before)

```powershell
powershell -File infra\start-stack.ps1        # idempotent; skips healthy services
python -m infra.reset                          # cold demo state (run from repo root, venv)
```

- Open http://localhost:5173 in a **fresh Chrome tab** and **keep it foregrounded**
  (Chrome throttles background tabs to one timer tick per minute — it looks frozen).
- Verify the header pill says **2 changes** and the sidebar shows 2 commits.
- Charge the laptop; Atlas access is 0.0.0.0/0 so venue wifi is fine.

## The script

1. **Open on the schema graph.** "This is our production schema — parsed by
   Postgres's own parser, laid out live." Point at `orders`.
2. **Point at the diff.** The `transactions` table glows green (added); in
   `orders`, the `total` row is struck through red (dropped). "A teammate's
   branch adds payments and drops a column. The diff is semantic, not textual."
3. **Click `Open MR`** (gold button, top right).
4. **Click `Run review`.** Narrate as the five agents stream in live:
   - Leader plans the review
   - Schema Analyst posts the real change list
   - **Impact Scout finds `orders.total` referenced in 4 files** — point at the
     file chips
   - **Migration Engineer rewrites its plain DROP into an expand/contract
     migration** — "this is agents changing each other's plans, not a pipeline"
   - CI dry-run passes in single-digit ms — "that ran on a real Postgres with
     seeded rows; an empty table would let broken migrations through"
5. **Click `Approve`.** "External actions are gated behind a human. Always."
6. **The kicker:** "Every message you watched arrived through a MongoDB Atlas
   change stream — the agents only ever write to the board. The whole review is
   auditable and replayable."

## Sponsor lines (one breath each)

- **MongoDB Atlas** — agent board + content-addressed schema snapshots live in
  Atlas; change streams power the live feed; Vector Search indexes migration
  history for the Leader's memory.
- **openJiuwen / Swarmflow** — five specialist agents; the Scout→Engineer
  negotiation is the collaboration moment.
- **Backboard** — model routing (strong Leader, cheap specialists) and per-repo
  lessons the Leader cites on the second run.
- **Composio** — the Scout's GitHub code search and the Release Agent's
  PR/Linear/Slack actions after Approve.
- **Rust/Go/Python/TS** — right tool per job: Postgres's parser in Rust, ms
  dry-runs in Go, agents in Python, live UI in TypeScript.

## If something breaks

| Symptom | Fix |
|---|---|
| UI looks frozen | The tab was backgrounded — refresh it, keep it foregrounded |
| Services down | `powershell -File infra\start-stack.ps1` (logs in `infra\logs\`) |
| Stale MR / messy board | `python -m infra.reset`, refresh the tab |
| Atlas unreachable | `.env` ATLAS_URI unset/wrong → falls back to local mongo container; demo still works, say "local Mongo replica set" instead |
| Everything on fire | `git checkout floor-2` and run the scripted flow |
