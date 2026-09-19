package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

// The round-trip proof: for fixture schemas A and B, apply
// generate(diff(A, B)) to a real database seeded from A, then introspect the
// result and assert it equals B. Parsing and diffing run through the same
// Rust core the product uses, via the venv Python.

func pythonPath(t *testing.T) string {
	if p := os.Getenv("PYTHON"); p != "" {
		return p
	}
	p, err := filepath.Abs(filepath.Join("..", ".venv", "Scripts", "python.exe"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(p); err != nil {
		t.Skipf("venv python not found at %s; set PYTHON", p)
	}
	return p
}

func runPython(t *testing.T, code string, args ...string) string {
	cmd := exec.Command(pythonPath(t), append([]string{"-c", code}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("python failed: %v\n%s", err, out)
	}
	return strings.TrimSpace(string(out))
}

func parseFixture(t *testing.T, path string) (*Schema, string) {
	raw := runPython(t,
		"import sys, schemasync_core; print(schemasync_core.parse_schema_json(open(sys.argv[1], encoding='utf-8').read()))",
		path)
	var s Schema
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		t.Fatalf("bad schema json from %s: %v", path, err)
	}
	return &s, raw
}

func diffSchemas(t *testing.T, oldJSON, newJSON string) []Change {
	dir := t.TempDir()
	oldPath := filepath.Join(dir, "old.json")
	newPath := filepath.Join(dir, "new.json")
	if err := os.WriteFile(oldPath, []byte(oldJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(newPath, []byte(newJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	raw := runPython(t,
		"import sys, schemasync_core; print(schemasync_core.diff_json(open(sys.argv[1]).read(), open(sys.argv[2]).read()))",
		oldPath, newPath)
	var changes []Change
	if err := json.Unmarshal([]byte(raw), &changes); err != nil {
		t.Fatalf("bad changes json: %v\n%s", err, raw)
	}
	return changes
}

func adminConn(t *testing.T, ctx context.Context) *pgx.Conn {
	admin, err := pgx.Connect(ctx, getenv("DRYRUN_DB_URL", "postgresql://postgres:dev@localhost:5433/postgres"))
	if err != nil {
		t.Skipf("dryrun db not reachable (docker compose up?): %v", err)
	}
	t.Cleanup(func() { admin.Close(context.Background()) })
	return admin
}

func mustJSON(v any) string {
	b, _ := json.MarshalIndent(v, "", "  ")
	return string(b)
}

func TestRoundTripFixtures(t *testing.T) {
	ctx := context.Background()
	fixtures, err := filepath.Glob(filepath.Join("..", "core", "tests", "fixtures", "*"))
	if err != nil || len(fixtures) == 0 {
		t.Fatalf("no fixtures found: %v", err)
	}

	ran := 0
	for _, dir := range fixtures {
		info, err := os.Stat(dir)
		if err != nil || !info.IsDir() {
			continue
		}
		name := filepath.Base(dir)
		t.Run(name, func(t *testing.T) {
			a, aJSON := parseFixture(t, filepath.Join(dir, "old.sql"))
			b, bJSON := parseFixture(t, filepath.Join(dir, "new.sql"))
			changes := diffSchemas(t, aJSON, bJSON)

			migration, err := Generate(changes)
			if err != nil {
				t.Fatalf("generate: %v", err)
			}

			admin := adminConn(t, ctx)
			res, after, err := DryRunApply(ctx, admin, a, migration)
			if err != nil {
				t.Fatalf("dryrun: %v", err)
			}
			if !res.OK {
				t.Fatalf("migration failed: %s\nmigration:\n%s", res.Error, migration)
			}

			Normalize(after)
			Normalize(b)
			if !reflect.DeepEqual(after, b) {
				t.Fatalf("round-trip mismatch\n--- migrated db ---\n%s\n--- target B ---\n%s\n--- migration ---\n%s",
					mustJSON(after), mustJSON(b), migration)
			}
		})
		ran++
	}
	if ran != 5 {
		t.Fatalf("expected 5 fixtures, ran %d", ran)
	}
}

func TestSeedCatchesNotNullWithoutDefault(t *testing.T) {
	ctx := context.Background()
	base := &Schema{Tables: map[string]Table{
		"users": {Name: "users", Columns: []Column{
			{Name: "id", TypeName: "int4", NotNull: true},
			{Name: "email", TypeName: "text", NotNull: true},
		}, PrimaryKey: []string{"id"}},
	}}
	admin := adminConn(t, ctx)

	// Adding NOT NULL without a default must FAIL on seeded rows...
	res, _, err := DryRunApply(ctx, admin, base, "ALTER TABLE users ADD COLUMN age int NOT NULL;")
	if err != nil {
		t.Fatal(err)
	}
	if res.OK {
		t.Fatal("expected NOT NULL without default to fail on seeded rows")
	}

	// ...while dropping a NOT NULL column passes.
	res, _, err = DryRunApply(ctx, admin, base, "ALTER TABLE users DROP COLUMN email;")
	if err != nil {
		t.Fatal(err)
	}
	if !res.OK {
		t.Fatalf("expected drop column to pass, got: %s", res.Error)
	}
}

func TestGenerateAddColumn(t *testing.T) {
	changes := []Change{{
		Kind:   "AddColumn",
		Table:  json.RawMessage(`"t"`),
		Column: json.RawMessage(`{"name":"b","type_name":"text","not_null":true,"default":null}`),
	}}
	sql, err := Generate(changes)
	if err != nil {
		t.Fatal(err)
	}
	want := "ALTER TABLE t ADD COLUMN b text NOT NULL;"
	if sql != want {
		t.Fatalf("got %q want %q", sql, want)
	}
}
