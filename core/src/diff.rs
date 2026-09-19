use crate::model::{Change, Schema, Table};
use std::collections::BTreeSet;

/// Semantic diff between two whole schemas. Deterministic: tables and columns
/// are visited in sorted order, so diff(A, B) is stable across runs.
pub fn diff(old: &Schema, new: &Schema) -> Vec<Change> {
    let mut changes = vec![];
    let names: BTreeSet<&String> = old.tables.keys().chain(new.tables.keys()).collect();
    for name in names {
        match (old.tables.get(name.as_str()), new.tables.get(name.as_str())) {
            (Some(_), None) => changes.push(Change::DropTable { name: name.to_string() }),
            (None, Some(t)) => changes.push(Change::AddTable { table: t.clone() }),
            (Some(o), Some(n)) => diff_table(o, n, &mut changes),
            (None, None) => unreachable!(),
        }
    }
    changes
}

fn diff_table(old: &Table, new: &Table, changes: &mut Vec<Change>) {
    let table = new.name.clone();

    let col_names: BTreeSet<&String> = old
        .columns
        .iter()
        .map(|c| &c.name)
        .chain(new.columns.iter().map(|c| &c.name))
        .collect();

    for name in col_names {
        match (old.column(name), new.column(name)) {
            (Some(_), None) => changes.push(Change::DropColumn {
                table: table.clone(),
                column: name.to_string(),
            }),
            (None, Some(c)) => changes.push(Change::AddColumn {
                table: table.clone(),
                column: c.clone(),
            }),
            (Some(o), Some(n)) => {
                if o.type_name != n.type_name {
                    changes.push(Change::AlterColumnType {
                        table: table.clone(),
                        column: name.to_string(),
                        from: o.type_name.clone(),
                        to: n.type_name.clone(),
                    });
                }
                match (o.not_null, n.not_null) {
                    (false, true) => changes.push(Change::SetNotNull {
                        table: table.clone(),
                        column: name.to_string(),
                    }),
                    (true, false) => changes.push(Change::DropNotNull {
                        table: table.clone(),
                        column: name.to_string(),
                    }),
                    _ => {}
                }
                if o.default != n.default {
                    match &n.default {
                        Some(d) => changes.push(Change::SetDefault {
                            table: table.clone(),
                            column: name.to_string(),
                            default: d.clone(),
                        }),
                        None => changes.push(Change::DropDefault {
                            table: table.clone(),
                            column: name.to_string(),
                        }),
                    }
                }
            }
            (None, None) => unreachable!(),
        }
    }

    if old.primary_key != new.primary_key {
        changes.push(Change::ChangePrimaryKey {
            table: table.clone(),
            from: old.primary_key.clone(),
            to: new.primary_key.clone(),
        });
    }

    for fk in &old.foreign_keys {
        if !new.foreign_keys.contains(fk) {
            changes.push(Change::DropForeignKey { table: table.clone(), fk: fk.clone() });
        }
    }
    for fk in &new.foreign_keys {
        if !old.foreign_keys.contains(fk) {
            changes.push(Change::AddForeignKey { table: table.clone(), fk: fk.clone() });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::parse_schema;

    #[test]
    fn diff_of_identical_schemas_is_empty() {
        let sql = "create table users (id serial primary key, email text not null, created_at timestamptz default now());";
        let a = parse_schema(sql).unwrap();
        let b = parse_schema(sql).unwrap();
        assert_eq!(diff(&a, &b), vec![]);
    }

    #[test]
    fn add_column_is_detected() {
        let a = parse_schema("create table t (a int);").unwrap();
        let b = parse_schema("create table t (a int, b text not null);").unwrap();
        let changes = diff(&a, &b);
        assert_eq!(changes.len(), 1);
        match &changes[0] {
            Change::AddColumn { table, column } => {
                assert_eq!(table, "t");
                assert_eq!(column.name, "b");
                assert_eq!(column.type_name, "text");
                assert!(column.not_null);
            }
            other => panic!("expected AddColumn, got {other:?}"),
        }
    }

    #[test]
    fn unsupported_statement_errors() {
        assert!(parse_schema("alter table t add column a int;").is_err());
        assert!(parse_schema("create table t (a int check (a > 0));").is_err());
    }

    #[test]
    fn int_normalizes_to_int4() {
        let s = parse_schema("create table t (a int, b integer);").unwrap();
        let t = &s.tables["t"];
        assert_eq!(t.column("a").unwrap().type_name, "int4");
        assert_eq!(t.column("b").unwrap().type_name, "int4");
    }
}
