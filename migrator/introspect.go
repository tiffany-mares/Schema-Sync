package main

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Introspect reads the live schema of a database back into the Schema model,
// straight from pg_catalog. This is how the round-trip test proves a
// migration produced exactly the target schema.
func Introspect(ctx context.Context, conn *pgx.Conn) (*Schema, error) {
	s := &Schema{Tables: map[string]Table{}}

	rows, err := conn.Query(ctx, `
		SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
		       pg_get_expr(d.adbin, d.adrelid)
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
		LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
		WHERE n.nspname = 'public' AND c.relkind = 'r'
		ORDER BY c.relname, a.attnum`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var tbl, col, typ string
		var notNull bool
		var def *string
		if err := rows.Scan(&tbl, &col, &typ, &notNull, &def); err != nil {
			return nil, err
		}
		t := s.Tables[tbl]
		t.Name = tbl
		t.Columns = append(t.Columns, Column{Name: col, TypeName: typ, NotNull: notNull, Default: def})
		s.Tables[tbl] = t
	}
	if rows.Err() != nil {
		return nil, rows.Err()
	}

	pkRows, err := conn.Query(ctx, `
		SELECT c.relname, a.attname
		FROM pg_constraint con
		JOIN pg_class c ON c.oid = con.conrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
		JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
		WHERE con.contype = 'p' AND n.nspname = 'public'
		ORDER BY c.relname, k.ord`)
	if err != nil {
		return nil, err
	}
	for pkRows.Next() {
		var tbl, col string
		if err := pkRows.Scan(&tbl, &col); err != nil {
			return nil, err
		}
		t := s.Tables[tbl]
		t.PrimaryKey = append(t.PrimaryKey, col)
		s.Tables[tbl] = t
	}
	if pkRows.Err() != nil {
		return nil, pkRows.Err()
	}

	fkRows, err := conn.Query(ctx, `
		SELECT con.oid, c.relname, fc.relname, a.attname, fa.attname
		FROM pg_constraint con
		JOIN pg_class c ON c.oid = con.conrelid
		JOIN pg_class fc ON fc.oid = con.confrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(att, fatt, ord)
		JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.att
		JOIN pg_attribute fa ON fa.attrelid = fc.oid AND fa.attnum = k.fatt
		WHERE con.contype = 'f' AND n.nspname = 'public'
		ORDER BY c.relname, con.oid, k.ord`)
	if err != nil {
		return nil, err
	}
	type fkAcc struct {
		table string
		fk    ForeignKey
	}
	var order []uint32
	acc := map[uint32]*fkAcc{}
	for fkRows.Next() {
		var oid uint32
		var tbl, ftbl, col, fcol string
		if err := fkRows.Scan(&oid, &tbl, &ftbl, &col, &fcol); err != nil {
			return nil, err
		}
		if _, ok := acc[oid]; !ok {
			acc[oid] = &fkAcc{table: tbl, fk: ForeignKey{RefTable: ftbl}}
			order = append(order, oid)
		}
		acc[oid].fk.Columns = append(acc[oid].fk.Columns, col)
		acc[oid].fk.RefColumns = append(acc[oid].fk.RefColumns, fcol)
	}
	if fkRows.Err() != nil {
		return nil, fkRows.Err()
	}
	for _, oid := range order {
		t := s.Tables[acc[oid].table]
		t.ForeignKeys = append(t.ForeignKeys, acc[oid].fk)
		s.Tables[acc[oid].table] = t
	}

	return s, nil
}

// Normalize maps type aliases to the parser's canonical spellings and erases
// the serial <-> integer+nextval difference, so an introspected schema can be
// compared byte-for-byte with a parsed one.
func Normalize(s *Schema) {
	for name, t := range s.Tables {
		// nil vs empty slice both mean "none" — canonicalize for DeepEqual.
		if t.Columns == nil {
			t.Columns = []Column{}
		}
		if t.PrimaryKey == nil {
			t.PrimaryKey = []string{}
		}
		if t.ForeignKeys == nil {
			t.ForeignKeys = []ForeignKey{}
		}
		for i, c := range t.Columns {
			c.TypeName = normalizeType(c.TypeName)
			switch c.TypeName {
			case "serial":
				c.TypeName, c.NotNull, c.Default = "int4", true, nil
			case "bigserial":
				c.TypeName, c.NotNull, c.Default = "int8", true, nil
			case "smallserial":
				c.TypeName, c.NotNull, c.Default = "int2", true, nil
			}
			if c.Default != nil && strings.HasPrefix(*c.Default, "nextval(") {
				c.Default = nil
			}
			t.Columns[i] = c
		}
		s.Tables[name] = t
	}
}

func normalizeType(t string) string {
	t = strings.ToLower(strings.TrimSpace(t))
	for prefix, repl := range map[string]string{
		"character varying":           "varchar",
		"timestamp with time zone":    "timestamptz",
		"timestamp without time zone": "timestamp",
		"time without time zone":      "time",
		"time with time zone":         "timetz",
		"double precision":            "float8",
	} {
		if strings.HasPrefix(t, prefix) {
			t = repl + t[len(prefix):]
		}
	}
	switch strings.SplitN(t, "(", 2)[0] {
	case "integer":
		return "int4" + suffixOf(t, "integer")
	case "int":
		return "int4" + suffixOf(t, "int")
	case "bigint":
		return "int8" + suffixOf(t, "bigint")
	case "smallint":
		return "int2" + suffixOf(t, "smallint")
	case "boolean":
		return "bool"
	case "real":
		return "float4"
	case "decimal":
		return "numeric" + suffixOf(t, "decimal")
	}
	return t
}

func suffixOf(t, base string) string {
	return t[len(base):]
}
