package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

type server struct {
	meta *pgxpool.Pool
	rdb  *redis.Client
}

type generateReq struct {
	Changes []Change `json:"changes"`
}

type dryrunReq struct {
	BaseSchema Schema `json:"base_schema"`
	Migration  string `json:"migration_sql"`
	MrID       int    `json:"mr_id"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *server) handleGenerate(w http.ResponseWriter, r *http.Request) {
	var req generateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	sql, err := Generate(req.Changes)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]string{"sql": sql})
}

func (s *server) publish(ctx context.Context, mrID int, payload map[string]any) {
	if s.rdb == nil || mrID == 0 {
		return
	}
	data, _ := json.Marshal(payload)
	if err := s.rdb.Publish(ctx, fmt.Sprintf("ci:%d", mrID), data).Err(); err != nil {
		log.Printf("redis publish failed: %v", err)
	}
}

func (s *server) handleDryrun(w http.ResponseWriter, r *http.Request) {
	var req dryrunReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	ctx := r.Context()
	s.publish(ctx, req.MrID, map[string]any{"stage": "start", "mr_id": req.MrID})

	baseDDL := RenderSchema(&req.BaseSchema)
	seed, err := SeedSQL(&req.BaseSchema)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}

	// A fresh admin connection per run: CREATE DATABASE cannot run inside a
	// transaction and serializes per connection, so concurrent dry-runs each
	// get their own.
	admin, err := pgx.Connect(ctx, getenv("DRYRUN_DB_URL", "postgresql://postgres:dev@localhost:5433/postgres"))
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": "dryrun db unreachable: " + err.Error()})
		return
	}
	defer admin.Close(context.Background())

	res := DryRun(ctx, admin, baseDDL, seed, req.Migration)

	s.publish(ctx, req.MrID, map[string]any{
		"stage": "result", "mr_id": req.MrID,
		"ok": res.OK, "error": res.Error, "duration_ms": res.DurationMs,
	})
	if s.meta != nil && req.MrID > 0 {
		_, err := s.meta.Exec(ctx,
			"insert into ci_runs(mr_id, ok, migration_sql, error, duration_ms) values($1,$2,$3,nullif($4,''),$5)",
			req.MrID, res.OK, req.Migration, res.Error, res.DurationMs)
		if err != nil {
			log.Printf("ci_runs insert failed: %v", err)
		}
	}
	writeJSON(w, 200, res)
}

func main() {
	ctx := context.Background()

	meta, err := pgxpool.New(ctx, getenv("META_DB_URL", "postgresql://postgres:dev@localhost:5434/schemasync"))
	if err != nil {
		log.Printf("meta db pool init failed (ci_runs recording disabled): %v", err)
	}

	opts, err := redis.ParseURL(getenv("REDIS_URL", "redis://localhost:6379"))
	var rdb *redis.Client
	if err != nil {
		log.Printf("redis url parse failed (ci events disabled): %v", err)
	} else {
		rdb = redis.NewClient(opts)
	}

	s := &server{meta: meta, rdb: rdb}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /migrations/generate", s.handleGenerate)
	mux.HandleFunc("POST /migrations/dryrun", s.handleDryrun)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]bool{"ok": true})
	})

	addr := getenv("MIGRATOR_ADDR", ":8081")
	log.Printf("migrator on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
