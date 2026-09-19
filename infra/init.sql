CREATE TABLE repos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL
);

CREATE TABLE commits (
  hash char(64) PRIMARY KEY,              -- sha256(snapshot_hash || parents || message)
  repo_id uuid NOT NULL REFERENCES repos,
  parent_hashes char(64)[] NOT NULL DEFAULT '{}',
  snapshot_hash char(64) NOT NULL,        -- points into Atlas snapshots
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE branches (
  repo_id uuid REFERENCES repos,
  name text,
  head char(64) NOT NULL REFERENCES commits,
  PRIMARY KEY (repo_id, name)
);

CREATE TABLE merge_requests (
  id serial PRIMARY KEY,
  repo_id uuid NOT NULL REFERENCES repos,
  source text NOT NULL, target text NOT NULL,
  base_commit char(64) NOT NULL REFERENCES commits,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','reviewing','awaiting_approval','approved','shipped','rejected')),
  verdict jsonb
);

CREATE TABLE ci_runs (
  id serial PRIMARY KEY,
  mr_id int NOT NULL REFERENCES merge_requests,
  ok boolean NOT NULL, migration_sql text NOT NULL,
  error text, duration_ms int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
