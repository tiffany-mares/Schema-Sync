# SchemaSync: Build Plan

This plan turns the timeline into ordered tasks, each with a "done when" check you can actually run. The rule throughout: don't start a phase until the previous one's check passes, and tag each floor in git so you can always roll back to something demoable.

## Phase 0: Setup and blockers (hours 0–2)

Do the risky installs first, while you still have the energy to debug them.

```bash
# Rust core: pg_query compiles C, so it may need clang. Find out NOW, not at hour 4
cargo new core --lib && cd core
cargo add pg_query serde_json
cargo add serde --features derive
cargo add pyo3 --features extension-module
# in Cargo.toml: [lib] crate-type = ["cdylib", "rlib"]
cargo build        # if this fails: sudo apt install clang libclang-dev
cd ..

# Python: CPU-only torch keeps images small (the default pulls GBs of CUDA)
uv venv && source .venv/bin/activate
uv pip install maturin fastapi uvicorn asyncpg "pymongo>=4.9" redis httpx
uv pip install torch --index-url https://download.pytorch.org/whl/cpu
uv pip install sentence-transformers jiuwenswarm
python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"  # caches the model offline

# Go
mkdir migrator && cd migrator && go mod init schemasync/migrator
go get github.com/jackc/pgx/v5 github.com/redis/go-redis/v9 && cd ..

# Node + React
mkdir gateway && cd gateway && npm init -y && npm i express ws mongodb redis && npm i -D typescript tsx @types/node @types/ws @types/express && cd ..
npm create vite@latest web -- --template react-ts && cd web && npm i @xyflow/react && cd ..
```

Use PyMongo's built-in async client (AsyncMongoClient) instead of Motor, which is being deprecated. The Board class from the technical plan works unchanged with it.

Account checklist:

- [ ] Atlas M0 cluster up, IP allowlist set, ATLAS_URI in .env
- [ ] Test a change stream on M0 with coll.watch() from a Python REPL
- [ ] Create the Vector Search index on migration_history
- [ ] Backboard key works, and you know whether it's OpenAI-compatible
- [ ] Composio connected to GitHub (sandbox repo), Slack, and Linear
- [ ] Sandbox repo pushed: a tiny app that references orders.total in 4 files
- [ ] Huawei credits claimed
- [ ] docker compose up brings up meta-db, dryrun-db, and redis

**Done when:** cargo build passes, every box above is checked, and the model loads offline. If Atlas change streams fail on M0, redeem the $50 student credit now.

## Phase 1: Rust core (hours 2–6)

1. Write model.rs (Schema, Table, Column, ForeignKey, Change), taken from the earlier plan.
2. Write parse.rs: walk pg_query::parse(sql) for CreateStmt nodes only. Handle columns, types, NOT NULL, DEFAULT, inline and table-level FKs, and the PRIMARY KEY. Return an error on anything else instead of ignoring it silently.
3. Write diff.rs, plus the PyO3 bindings from the technical plan.
4. Add golden fixtures in core/tests/fixtures/: add_table, drop_column, alter_type, add_fk, nullable_change.

**Done when:**

```bash
cargo test && maturin develop -m core/Cargo.toml
python -c "import schemasync_core as s; print(s.diff_json(s.parse_schema_json('create table t(a int);'), s.parse_schema_json('create table t(a int, b text not null);')))"
```

prints an AddColumn for b.

## Phase 2: Version control (hours 6–9)

1. Apply init.sql (the DDL from the technical plan) to meta-db.
2. POST /commits: parse the DDL, hash the snapshot, upsert it into Atlas snapshots, insert the commit row, and move the branch head. Wrap the Postgres writes in one transaction.
3. GET /diff: check Redis first. On a miss, load both snapshots, call diff_json, and cache for 1 hour.
4. POST /branches, plus a seed script that creates the main branch with users, products, and orders.

**Done when:** the seed script runs, you commit a transactions table on feature/add-payments, and `curl /repos/demo/diff?from=main&to=feature/add-payments` returns an AddTable. Calling it a second time is noticeably faster (the Redis cache hit).

## Phase 3: Gateway and ER diff (hours 9–13)

1. Gateway: proxy /api/* to vcs, and open the Atlas change stream relay to /ws (code from the earlier plan).
2. Web: map schema to react-flow nodes (one per table, with columns listed) and FK edges. Run dagre for automatic layout so you're not hand-placing nodes.
3. Diff overlay: CSS classes added, dropped, modified on nodes and columns, with a 600ms glow transition. Newly added FK edges get animated: true.
4. A branch picker plus a "compare" button.

**Done when:** the demo schema renders, and comparing branches shows the transactions table glowing green with its FK edge drawing itself in.

`git tag floor-1`

## Phase 4: Migration CI (hours 13–17)

1. Generator: turn each Change into SQL. Also write a schema renderer that produces full CREATE DDL from a snapshot, which the dry-run needs as its base.
2. Seed generator: 3 fake rows per table, with type-appropriate values that respect FKs by inserting parent tables first.
3. DryRun from the technical plan. Publish start and result to ci:{mr_id}, and insert a ci_runs row.
4. Gateway subscribes to ci:* and forwards to /ws.
5. Round-trip test: generate the migration, apply it to A, run pg_dump --schema-only, parse the dump, and compare against B.

**Done when:** `go test ./...` passes, including the round-trip on all 5 fixtures. Dropping a NOT NULL column with no default passes, while adding one fails on the seeded rows. Both results show up live in the UI.

## Phase 5: Scripted review board (hours 17–21)

1. POST /merge-requests: find the merge base by walking parents, and detect conflicts (same table and column changed differently on both sides).
2. Write agents/scripted.py, which posts the full orders.total review to the Atlas board with 1-second delays: Analyst finding, Scout finding (4 refs), Engineer draft, Engineer revision, dry-run result, Leader verdict.
3. Review panel in the web UI: a chat-style feed, one color per agent, and an Approve button when the status is awaiting_approval.

**Done when:** you open an MR, the whole review plays through in the UI, a real dry-run fires, and Approve changes the status. This is your guaranteed demo.

`git tag floor-2`

## Phase 6: Live agents (hours 21–27)

Swap scripted messages for live agents one at a time, running the demo after each swap.

1. Map Swarmflow stages in agents/adapters/jiuwen.py. Get a two-stage flow running with dummy agents first.
2. Backboard adapter: two model tiers, strong for the Leader and cheap for the specialists.
3. Analyst: tools are diff and renames. The output must match the scripted message shape exactly, so the UI never changes.
4. Engineer: draft, then revise, then dry-run with up to 2 retries.
5. Leader: plan and verdict.

**Done when:** a live review of orders.total produces an expand/contract revision 3 runs in a row. If it fails more than once, tighten the revision stage prompt before moving on.

## Phase 7: Composio actions (hours 27–30)

1. Scout: GitHub code search per changed column, scoped to the sandbox repo.
2. Release: open a PR containing the migration file, one Linear ticket per referenced file, and one Slack summary. Only runs after Approve.
3. GitHub webhook: point the sandbox repo at your gateway through cloudflared tunnel, verify the signature, and set the MR to shipped on merge.

**Done when:** the full flow opens a real PR, and merging it on GitHub flips the MR to shipped in your UI.

## Phase 8: Memory and search (hours 30–32)

1. Once an MR ships, the Leader writes a lesson to Backboard, and an embedded summary goes into migration_history.
2. The Leader's verdict stage queries both before deciding.
3. Wire the rename detector in as an Analyst tool.

**Done when:** a second, similar review cites the first one's lesson.

`git tag final`

## Phase 9: Ship (hours 32–36)

- [ ] Reset script: wipes Postgres, the Atlas collections, and the sandbox repo, then re-seeds. The second-run memory is pre-seeded
- [ ] Two full rehearsals from a cold reset
- [ ] Backup video of the complete flow
- [ ] README with the architecture diagram and the decision log
- [ ] Devpost: submit to Atlas, Backboard, Huawei, Composio, and Warp, with one paragraph per sponsor on exactly how it's used
- [ ] GitHub Actions green
