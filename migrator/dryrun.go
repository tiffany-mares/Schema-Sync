package main

import (
	"context"
	"fmt"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"
)

type Result struct {
	OK         bool   `json:"ok"`
	Error      string `json:"error,omitempty"`
	DurationMs int64  `json:"duration_ms"`
}

// DryRun creates a throwaway database on the warm dryrun-db container, applies
// the base schema and seed rows, then runs the migration. Milliseconds per
// run, no Docker socket, no container churn.
func DryRun(ctx context.Context, admin *pgx.Conn, baseDDL, seedSQL, migration string) Result {
	db := fmt.Sprintf("dry_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+db); err != nil {
		return Result{OK: false, Error: err.Error()}
	}
	defer admin.Exec(context.Background(), "DROP DATABASE IF EXISTS "+db+" WITH (FORCE)")

	conn, err := pgx.Connect(ctx, dryrunURL(db))
	if err != nil {
		return Result{OK: false, Error: err.Error()}
	}
	defer conn.Close(ctx)

	// No args = simple protocol, so multi-statement strings are allowed.
	for _, sql := range []string{baseDDL, seedSQL} {
		if sql == "" {
			continue
		}
		if _, err := conn.Exec(ctx, sql); err != nil {
			return Result{OK: false, Error: "setup: " + err.Error()}
		}
	}
	start := time.Now()
	_, err = conn.Exec(ctx, migration)
	res := Result{OK: err == nil, DurationMs: time.Since(start).Milliseconds()}
	if err != nil {
		res.Error = err.Error()
	}
	return res
}

// DryRunSchema renders base DDL + seed from a snapshot, then dry-runs the
// migration and introspects the resulting schema (used by the round-trip test).
func DryRunApply(ctx context.Context, admin *pgx.Conn, base *Schema, migration string) (Result, *Schema, error) {
	baseDDL := RenderSchema(base)
	seed, err := SeedSQL(base)
	if err != nil {
		return Result{}, nil, err
	}

	db := fmt.Sprintf("dry_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+db); err != nil {
		return Result{}, nil, err
	}
	defer admin.Exec(context.Background(), "DROP DATABASE IF EXISTS "+db+" WITH (FORCE)")

	conn, err := pgx.Connect(ctx, dryrunURL(db))
	if err != nil {
		return Result{}, nil, err
	}
	defer conn.Close(ctx)

	for _, sql := range []string{baseDDL, seed} {
		if sql == "" {
			continue
		}
		if _, err := conn.Exec(ctx, sql); err != nil {
			return Result{OK: false, Error: "setup: " + err.Error()}, nil, nil
		}
	}
	start := time.Now()
	if _, err := conn.Exec(ctx, migration); err != nil {
		return Result{OK: false, Error: err.Error(), DurationMs: time.Since(start).Milliseconds()}, nil, nil
	}
	res := Result{OK: true, DurationMs: time.Since(start).Milliseconds()}
	after, err := Introspect(ctx, conn)
	if err != nil {
		return res, nil, err
	}
	return res, after, nil
}

func dryrunURL(db string) string {
	base := getenv("DRYRUN_DB_URL", "postgresql://postgres:dev@localhost:5433/postgres")
	u, err := url.Parse(base)
	if err != nil {
		return base
	}
	u.Path = "/" + db
	return u.String()
}
