package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Change mirrors the Rust core's serde output. "table" and "column" carry a
// string in most kinds but an object in AddTable/AddColumn, hence RawMessage.
type Change struct {
	Kind    string          `json:"kind"`
	Table   json.RawMessage `json:"table,omitempty"`
	Name    string          `json:"name,omitempty"`
	Column  json.RawMessage `json:"column,omitempty"`
	From    json.RawMessage `json:"from,omitempty"`
	To      json.RawMessage `json:"to,omitempty"`
	Default string          `json:"default,omitempty"`
	Fk      *ForeignKey     `json:"fk,omitempty"`
}

func (c *Change) tableName() (string, error) {
	var s string
	if err := json.Unmarshal(c.Table, &s); err != nil {
		return "", fmt.Errorf("%s: table is not a string", c.Kind)
	}
	return s, nil
}

func (c *Change) tableObj() (Table, error) {
	var t Table
	if err := json.Unmarshal(c.Table, &t); err != nil {
		return t, fmt.Errorf("%s: table is not an object", c.Kind)
	}
	return t, nil
}

func (c *Change) columnName() (string, error) {
	var s string
	if err := json.Unmarshal(c.Column, &s); err != nil {
		return "", fmt.Errorf("%s: column is not a string", c.Kind)
	}
	return s, nil
}

func (c *Change) columnObj() (Column, error) {
	var col Column
	if err := json.Unmarshal(c.Column, &col); err != nil {
		return col, fmt.Errorf("%s: column is not an object", c.Kind)
	}
	return col, nil
}

func rawString(raw json.RawMessage) string {
	var s string
	_ = json.Unmarshal(raw, &s)
	return s
}

// Generate turns a change list into migration SQL. Statement order follows
// the change list, which the diff emits deterministically.
func Generate(changes []Change) (string, error) {
	var stmts []string
	for _, ch := range changes {
		sql, err := generateOne(ch)
		if err != nil {
			return "", err
		}
		stmts = append(stmts, sql...)
	}
	return strings.Join(stmts, "\n"), nil
}

func generateOne(ch Change) ([]string, error) {
	switch ch.Kind {
	case "AddTable":
		t, err := ch.tableObj()
		if err != nil {
			return nil, err
		}
		out := []string{createTableSQL(t, false)}
		for _, fk := range t.ForeignKeys {
			out = append(out, addFkSQL(t.Name, fk))
		}
		return out, nil

	case "DropTable":
		return []string{fmt.Sprintf("DROP TABLE %s;", ch.Name)}, nil

	case "AddColumn":
		tbl, err := ch.tableName()
		if err != nil {
			return nil, err
		}
		col, err := ch.columnObj()
		if err != nil {
			return nil, err
		}
		return []string{fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s;", tbl, columnDefSQL(col))}, nil

	case "DropColumn":
		tbl, err := ch.tableName()
		if err != nil {
			return nil, err
		}
		col, err := ch.columnName()
		if err != nil {
			return nil, err
		}
		return []string{fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s;", tbl, col)}, nil

	case "AlterColumnType":
		tbl, err := ch.tableName()
		if err != nil {
			return nil, err
		}
		col, err := ch.columnName()
		if err != nil {
			return nil, err
		}
		to := rawString(ch.To)
		return []string{fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s TYPE %s USING %s::%s;", tbl, col, to, col, to)}, nil

	case "SetNotNull", "DropNotNull":
		tbl, err := ch.tableName()
		if err != nil {
			return nil, err
		}
		col, err := ch.columnName()
		if err != nil {
			return nil, err
		}
		verb := "SET"
		if ch.Kind == "DropNotNull" {
			verb = "DROP"
		}
		return []string{fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s %s NOT NULL;", tbl, col, verb)}, nil

	case "SetDefault":
		tbl, err := ch.tableName()
		if err != nil {
			return nil, err
		}
		col, err := ch.columnName()
		if err != nil {
			return nil, err
		}
		return []string{fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s SET DEFAULT %s;", tbl, col, ch.Default)}, nil

	case "DropDefault":
		tbl, err := ch.tableName()
		if err != nil {
			return nil, err
		}
		col, err := ch.columnName()
		if err != nil {
			return nil, err
		}
		return []string{fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s DROP DEFAULT;", tbl, col)}, nil

	case "AddForeignKey":
		tbl, err := ch.tableName()
		if err != nil {
			return nil, err
		}
		if ch.Fk == nil {
			return nil, fmt.Errorf("AddForeignKey without fk")
		}
		return []string{addFkSQL(tbl, *ch.Fk)}, nil

	case "DropForeignKey":
		tbl, err := ch.tableName()
		if err != nil {
			return nil, err
		}
		if ch.Fk == nil || len(ch.Fk.Columns) == 0 {
			return nil, fmt.Errorf("DropForeignKey without fk columns")
		}
		// Postgres default constraint name for an unnamed FK.
		name := fmt.Sprintf("%s_%s_fkey", tbl, ch.Fk.Columns[0])
		return []string{fmt.Sprintf("ALTER TABLE %s DROP CONSTRAINT %s;", tbl, name)}, nil

	case "ChangePrimaryKey":
		tbl, err := ch.tableName()
		if err != nil {
			return nil, err
		}
		var to []string
		if err := json.Unmarshal(ch.To, &to); err != nil {
			return nil, fmt.Errorf("ChangePrimaryKey: bad to: %w", err)
		}
		stmts := []string{fmt.Sprintf("ALTER TABLE %s DROP CONSTRAINT %s_pkey;", tbl, tbl)}
		if len(to) > 0 {
			stmts = append(stmts, fmt.Sprintf("ALTER TABLE %s ADD PRIMARY KEY (%s);", tbl, strings.Join(to, ", ")))
		}
		return stmts, nil
	}
	return nil, fmt.Errorf("unknown change kind %q", ch.Kind)
}
