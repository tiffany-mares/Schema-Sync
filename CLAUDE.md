# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SchemaSync — "GitHub for your database" — built for Hack the North 2026. Schema changes are commits, diffs render as a live ER diagram, and a multi-agent AI board reviews every migration before merge. Prize targets: openJiuwen Multi-Agent (Huawei), Backboard, Composio, MongoDB Atlas.

**Status: the repo starts empty.** Everything below describes the planned architecture from the project plan. As services come into existence, update this file to reflect what actually exists (real commands, real ports, deviations from the plan).

## Architecture

Six services, three data stores. The browser talks only to the gateway.

```
web (React/react-flow :5173)
  └─ gateway (Node/TS :3000) — REST proxy, WebSocket /ws, Atlas change-stream relay, GitHub webhook
       ├─ vcs (Python/FastAPI :8000) — commits, branches, merge requests, rename detector
       │    └─ core (Rust via PyO3) — pg_query parse, normalize, semantic diff
       ├─ migrator (Go :8081) — ALTER SQL generation + dry-run
       └─ agents (Python/JiuwenSwarm :8090) — review board (Leader + 4 agents)
```

Data stores:
- **PostgreSQL (meta-db)** — repos, commits (hash = sha256(snapshot_hash || parents || message)), branches, merge_requests (status: open→reviewing→awaiting_approval→approved→shipped / rejected), ci_runs
- **MongoDB Atlas** (external, not in compose) — `snapshots` (content-addressed by sha256 `_id`), `agent_messages` (the agent board, keyed {mr_id, seq}), `migration_history` (384-dim MiniLM embeddings, Vector Search, cosine)
- **Redis** — diff cache `diff:{hashA}:{hashB}` (TTL 1h), pub/sub `ci:{mr_id}`

Planned repo layout: `core/`, `vcs/`, `migrator/`, `agents/`, `gateway/`, `web/`, `infra/` (docker-compose.yml, init.sql, seeds), `.github/workflows/`.

## Load-bearing design decisions

Do not undo these without strong reason — each kills a whole problem class:

1. **Commits are declarative.** Clients submit the *full desired schema DDL*; the diff is computed against the parent snapshot (Prisma/Atlas-CLI style). The Rust core only ever diffs two whole schemas and never interprets ALTER statements.
2. **Dry-run = fresh throwaway database per run on one warm Postgres container** (`CREATE DATABASE dry_<nanos>` … `DROP DATABASE ... WITH (FORCE)`), never a container per run, never Docker-in-Docker. Dry-runs must seed fake rows first — an empty table lets `ADD COLUMN ... NOT NULL` without default pass, and catching that is the point.
3. **Agents never call each other directly.** All inter-agent communication goes through the `agent_messages` collection in Atlas; change streams push it to the UI live. This makes the review auditable, replayable, and demo-scriptable.
4. **The Engineer's "revise" step is an explicit Swarmflow stage**, not left to LLM initiative: any DROP with code references (found by the Impact Scout) becomes an expand/contract plan. The negotiation must happen every demo run; only its content is generated live.
5. **Sponsor SDKs (Swarmflow, Backboard, Composio) sit behind thin adapters in `agents/adapters/*.py`.** Their call signatures were unverified at planning time; an API surprise should cost one file.
6. **One embedding model** (MiniLM, 384-dim, CPU) serves both rename detection and Atlas Vector Search.

Atlas holds facts (schemas, changes, messages); Backboard holds lessons (per-repo team memory like "always backfill before adding NOT NULL").

## Service contracts (planned)

- vcs :8000 — `POST /repos/{r}/commits` {branch, ddl, message} → {hash, changes[]}; `GET /repos/{r}/diff?from=&to=`; `POST /repos/{r}/branches`; `POST /repos/{r}/merge-requests`; `POST /tools/renames` {drops[], adds[]} → {pairs[{from,to,score}]}
- migrator :8081 — `POST /migrations/generate` {changes[]} → {sql}; `POST /migrations/dryrun` {base_schema, migration_sql, mr_id} → {ok, error, duration_ms}
- agents :8090 — `POST /reviews` {mr_id} → 202 (progress goes to the Atlas board); `POST /reviews/{id}/approve` releases the human gate
- gateway :3000 — `/api/*` proxy, `WS /ws`, `POST /webhooks/github` (verify `X-Hub-Signature-256`)

## Commands (planned)

- Full stack: `docker compose up` from `infra/`
- Rust core: `cargo test` in `core/`; Python bindings built with `maturin develop`
- vcs: `pytest` in `vcs/` (after `maturin develop` in `core/`)
- migrator: `go test ./...` in `migrator/`
- web/gateway: `tsc --noEmit && vite build`
- Secrets live in a gitignored `.env`: ATLAS_URI, BACKBOARD_API_KEY, COMPOSIO_API_KEY, GITHUB_WEBHOOK_SECRET, HUAWEI_API_KEY. Sponsor keys never run in PR CI — integration tests are manual `workflow_dispatch` only.

## Testing strategy

The single test that proves the pipeline: **round-trip** — for schemas A and B, dry-run `generate(diff(A, B))` on A, dump with `pg_dump --schema-only`, parse, assert it equals B. Also: `diff(A, A) == []` (ordering bugs), golden fixtures per change type, and a scripted board replay so the demo works with live agents off.

## Hackathon constraints

36-hour build with two protected demo floors: **hour 13** = version control + visual ER diff working; **hour 21** = full demo driven by scripted agent messages (no live AI). Cut order if behind: Atlas Vector Search → rename detector → Linear tickets → live Leader (fall back to fixed Swarmflow order). **Never cut**: the Rust diff, the ER view, the Go dry-run, or the Impact Scout (the Scout→Engineer negotiation is the Huawei collaboration moment).

Known gap flagged during planning: a **snapshot → DDL renderer** (inverse of the parser) is needed to feed `base_schema` to dry-runs and to run the round-trip test, but isn't in the repo layout or timeline yet.
