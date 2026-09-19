package main

import (
	"fmt"
	"sort"
	"strings"
)

type Column struct {
	Name     string  `json:"name"`
	TypeName string  `json:"type_name"`
	NotNull  bool    `json:"not_null"`
	Default  *string `json:"default"`
}

type ForeignKey struct {
	Columns    []string `json:"columns"`
	RefTable   string   `json:"ref_table"`
	RefColumns []string `json:"ref_columns"`
}

type Table struct {
	Name        string       `json:"name"`
	Columns     []Column     `json:"columns"`
	PrimaryKey  []string     `json:"primary_key"`
	ForeignKeys []ForeignKey `json:"foreign_keys"`
}

type Schema struct {
	Tables map[string]Table `json:"tables"`
}

func (s *Schema) sortedTables() []Table {
	names := make([]string, 0, len(s.Tables))
	for n := range s.Tables {
		names = append(names, n)
	}
	sort.Strings(names)
	out := make([]Table, 0, len(names))
	for _, n := range names {
		out = append(out, s.Tables[n])
	}
	return out
}

// RenderSchema turns a snapshot into full CREATE DDL. FKs are emitted as
// trailing ALTER statements so table creation order never matters.
func RenderSchema(s *Schema) string {
	var b strings.Builder
	for _, t := range s.sortedTables() {
		b.WriteString(createTableSQL(t, false))
		b.WriteString("\n")
	}
	for _, t := range s.sortedTables() {
		for _, fk := range t.ForeignKeys {
			b.WriteString(addFkSQL(t.Name, fk))
			b.WriteString("\n")
		}
	}
	return b.String()
}

func createTableSQL(t Table, inlineFks bool) string {
	var parts []string
	for _, c := range t.Columns {
		parts = append(parts, "  "+columnDefSQL(c))
	}
	if len(t.PrimaryKey) > 0 {
		parts = append(parts, fmt.Sprintf("  PRIMARY KEY (%s)", strings.Join(t.PrimaryKey, ", ")))
	}
	if inlineFks {
		for _, fk := range t.ForeignKeys {
			parts = append(parts, fmt.Sprintf("  FOREIGN KEY (%s) REFERENCES %s (%s)",
				strings.Join(fk.Columns, ", "), fk.RefTable, strings.Join(fk.RefColumns, ", ")))
		}
	}
	return fmt.Sprintf("CREATE TABLE %s (\n%s\n);", t.Name, strings.Join(parts, ",\n"))
}

func columnDefSQL(c Column) string {
	out := c.Name + " " + c.TypeName
	if c.NotNull {
		out += " NOT NULL"
	}
	if c.Default != nil {
		out += " DEFAULT " + *c.Default
	}
	return out
}

func addFkSQL(table string, fk ForeignKey) string {
	return fmt.Sprintf("ALTER TABLE %s ADD FOREIGN KEY (%s) REFERENCES %s (%s);",
		table, strings.Join(fk.Columns, ", "), fk.RefTable, strings.Join(fk.RefColumns, ", "))
}

// topoOrder returns tables parents-first so seed inserts satisfy FKs.
func topoOrder(s *Schema) ([]Table, error) {
	tables := s.sortedTables()
	deps := map[string]map[string]bool{}
	for _, t := range tables {
		deps[t.Name] = map[string]bool{}
		for _, fk := range t.ForeignKeys {
			if fk.RefTable != t.Name {
				deps[t.Name][fk.RefTable] = true
			}
		}
	}
	var out []Table
	done := map[string]bool{}
	for len(out) < len(tables) {
		progressed := false
		for _, t := range tables {
			if done[t.Name] {
				continue
			}
			ready := true
			for d := range deps[t.Name] {
				if _, exists := s.Tables[d]; exists && !done[d] {
					ready = false
					break
				}
			}
			if ready {
				out = append(out, t)
				done[t.Name] = true
				progressed = true
			}
		}
		if !progressed {
			return nil, fmt.Errorf("FK cycle detected; cannot order seed inserts")
		}
	}
	return out, nil
}

// SeedSQL inserts 3 typed rows per table, parents first. Row i uses id i so
// FK columns can also just use i. Without seed data, dry-runs cannot catch
// the classic "ADD COLUMN NOT NULL without default" failure.
func SeedSQL(s *Schema) (string, error) {
	ordered, err := topoOrder(s)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	for _, t := range ordered {
		if len(t.Columns) == 0 {
			continue
		}
		var cols []string
		for _, c := range t.Columns {
			cols = append(cols, c.Name)
		}
		var rows []string
		for i := 1; i <= 3; i++ {
			var vals []string
			for _, c := range t.Columns {
				v, err := seedValue(t, c, i)
				if err != nil {
					return "", err
				}
				vals = append(vals, v)
			}
			rows = append(rows, "("+strings.Join(vals, ", ")+")")
		}
		fmt.Fprintf(&b, "INSERT INTO %s (%s) VALUES %s;\n",
			t.Name, strings.Join(cols, ", "), strings.Join(rows, ", "))
	}
	return b.String(), nil
}

func seedValue(t Table, c Column, i int) (string, error) {
	base := strings.ToLower(c.TypeName)
	if idx := strings.Index(base, "("); idx >= 0 {
		base = base[:idx]
	}
	switch base {
	case "serial", "bigserial", "smallserial", "int", "int2", "int4", "int8", "integer", "bigint", "smallint":
		return fmt.Sprintf("%d", i), nil
	case "numeric", "decimal", "float4", "float8", "real", "money":
		return fmt.Sprintf("%d.50", i), nil
	case "text", "varchar", "char", "bpchar", "citext":
		return fmt.Sprintf("'seed-%s-%d'", c.Name, i), nil
	case "bool", "boolean":
		return "true", nil
	case "timestamptz", "timestamp", "date":
		return "now()", nil
	case "time", "timetz":
		return "'12:00:00'", nil
	case "uuid":
		return "gen_random_uuid()", nil
	case "json", "jsonb":
		return "'{}'", nil
	case "bytea":
		return "'\\x00'", nil
	}
	if !c.NotNull {
		return "NULL", nil
	}
	return "", fmt.Errorf("no seed value for NOT NULL column %s.%s of type %s", t.Name, c.Name, c.TypeName)
}
