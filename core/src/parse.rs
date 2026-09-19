use crate::model::{Column, ForeignKey, Schema, Table};
use pg_query::protobuf::{self, a_const::Val, ConstrType};
use pg_query::NodeEnum;
use std::collections::BTreeMap;

/// Parse full-schema DDL (CREATE TABLE statements only) into a Schema.
/// Anything we don't understand is an error, never silently dropped —
/// a schema snapshot that lies is worse than one that refuses.
pub fn parse_schema(sql: &str) -> Result<Schema, String> {
    let result = pg_query::parse(sql).map_err(|e| format!("parse error: {e}"))?;
    let mut tables: BTreeMap<String, Table> = BTreeMap::new();
    for raw in &result.protobuf.stmts {
        let node = raw
            .stmt
            .as_ref()
            .and_then(|s| s.node.as_ref())
            .ok_or("empty statement")?;
        match node {
            NodeEnum::CreateStmt(c) => {
                let t = parse_create(c)?;
                if tables.contains_key(&t.name) {
                    return Err(format!("duplicate table {}", t.name));
                }
                tables.insert(t.name.clone(), t);
            }
            other => return Err(format!("unsupported statement: {}", node_kind(other))),
        }
    }
    Ok(Schema { tables })
}

fn node_kind(node: &NodeEnum) -> String {
    let dbg = format!("{node:?}");
    dbg.split(['(', ' ', '{']).next().unwrap_or("Unknown").to_string()
}

fn parse_create(c: &protobuf::CreateStmt) -> Result<Table, String> {
    let rel = c.relation.as_ref().ok_or("CREATE TABLE without relation")?;
    let name = rel.relname.clone();
    if !c.inh_relations.is_empty() {
        return Err(format!("unsupported INHERITS on table {name}"));
    }

    let mut columns: Vec<Column> = vec![];
    let mut primary_key: Vec<String> = vec![];
    let mut foreign_keys: Vec<ForeignKey> = vec![];

    for elt in &c.table_elts {
        match elt.node.as_ref().ok_or("empty table element")? {
            NodeEnum::ColumnDef(cd) => {
                let col_name = cd.colname.clone();
                let tn = cd
                    .type_name
                    .as_ref()
                    .ok_or_else(|| format!("column {name}.{col_name} has no type"))?;
                let type_name = render_type(tn)?;
                let mut not_null = false;
                let mut default: Option<String> = None;

                for cons in &cd.constraints {
                    let NodeEnum::Constraint(k) = cons.node.as_ref().ok_or("empty constraint")?
                    else {
                        return Err(format!("non-constraint node on column {name}.{col_name}"));
                    };
                    match k.contype() {
                        ConstrType::ConstrNotnull => not_null = true,
                        ConstrType::ConstrNull => not_null = false,
                        ConstrType::ConstrDefault => {
                            let expr = k
                                .raw_expr
                                .as_deref()
                                .ok_or_else(|| format!("DEFAULT without expr on {name}.{col_name}"))?;
                            default = Some(render_expr(expr)?);
                        }
                        ConstrType::ConstrPrimary => {
                            if !primary_key.is_empty() {
                                return Err(format!("multiple primary keys on table {name}"));
                            }
                            primary_key = vec![col_name.clone()];
                        }
                        ConstrType::ConstrForeign => {
                            foreign_keys.push(parse_fk(k, std::slice::from_ref(&col_name), &name)?);
                        }
                        other => {
                            return Err(format!(
                                "unsupported constraint {other:?} on column {name}.{col_name}"
                            ))
                        }
                    }
                }
                columns.push(Column { name: col_name, type_name, not_null, default });
            }
            NodeEnum::Constraint(con) => match con.contype() {
                ConstrType::ConstrPrimary => {
                    if !primary_key.is_empty() {
                        return Err(format!("multiple primary keys on table {name}"));
                    }
                    primary_key = string_list(&con.keys)?;
                }
                ConstrType::ConstrForeign => {
                    let cols = string_list(&con.fk_attrs)?;
                    foreign_keys.push(parse_fk(con, &cols, &name)?);
                }
                other => {
                    return Err(format!("unsupported table constraint {other:?} on {name}"))
                }
            },
            other => {
                return Err(format!("unsupported table element {} on {name}", node_kind(other)))
            }
        }
    }

    // Postgres implies NOT NULL for primary key columns; normalize so parsed
    // originals and parsed pg_dump output agree.
    for pk_col in &primary_key {
        if let Some(col) = columns.iter_mut().find(|c| &c.name == pk_col) {
            col.not_null = true;
        } else {
            return Err(format!("primary key column {pk_col} not found on {name}"));
        }
    }

    Ok(Table { name, columns, primary_key, foreign_keys })
}

fn parse_fk(k: &protobuf::Constraint, columns: &[String], table: &str) -> Result<ForeignKey, String> {
    let pktable = k
        .pktable
        .as_ref()
        .ok_or_else(|| format!("FK on {table} without referenced table"))?;
    let ref_columns = string_list(&k.pk_attrs)?;
    if ref_columns.is_empty() {
        return Err(format!(
            "FK on {table} must list referenced columns explicitly, e.g. REFERENCES t(id)"
        ));
    }
    Ok(ForeignKey {
        columns: columns.to_vec(),
        ref_table: pktable.relname.clone(),
        ref_columns,
    })
}

fn string_list(nodes: &[protobuf::Node]) -> Result<Vec<String>, String> {
    nodes
        .iter()
        .map(|n| match n.node.as_ref() {
            Some(NodeEnum::String(s)) => Ok(s.sval.clone()),
            other => Err(format!("expected identifier, got {other:?}")),
        })
        .collect()
}

fn render_type(tn: &protobuf::TypeName) -> Result<String, String> {
    let mut parts: Vec<String> = vec![];
    for n in &tn.names {
        match n.node.as_ref() {
            Some(NodeEnum::String(s)) => parts.push(s.sval.clone()),
            other => return Err(format!("unexpected type name part: {other:?}")),
        }
    }
    let parts: Vec<String> = parts.into_iter().filter(|p| p != "pg_catalog").collect();
    if parts.is_empty() {
        return Err("empty type name".to_string());
    }
    let mut out = parts.join(".").to_lowercase();
    if !tn.typmods.is_empty() {
        let mods: Vec<String> = tn
            .typmods
            .iter()
            .map(render_typmod)
            .collect::<Result<_, _>>()?;
        out = format!("{out}({})", mods.join(","));
    }
    if !tn.array_bounds.is_empty() {
        out.push_str("[]");
    }
    Ok(out)
}

fn render_typmod(n: &protobuf::Node) -> Result<String, String> {
    match n.node.as_ref() {
        Some(NodeEnum::AConst(a)) => render_const(a),
        other => Err(format!("unsupported type modifier: {other:?}")),
    }
}

fn render_const(a: &protobuf::AConst) -> Result<String, String> {
    if a.isnull {
        return Ok("NULL".to_string());
    }
    match a.val.as_ref() {
        Some(Val::Ival(i)) => Ok(i.ival.to_string()),
        Some(Val::Fval(f)) => Ok(f.fval.clone()),
        Some(Val::Sval(s)) => Ok(format!("'{}'", s.sval.replace('\'', "''"))),
        Some(Val::Boolval(b)) => Ok(if b.boolval { "true" } else { "false" }.to_string()),
        other => Err(format!("unsupported constant: {other:?}")),
    }
}

/// Render a default-value expression back to SQL. Covers constants, function
/// calls, and casts; anything richer is an error so it surfaces immediately.
fn render_expr(node: &protobuf::Node) -> Result<String, String> {
    match node.node.as_ref().ok_or("empty expression")? {
        NodeEnum::AConst(a) => render_const(a),
        NodeEnum::FuncCall(f) => {
            let mut parts: Vec<String> = vec![];
            for n in &f.funcname {
                match n.node.as_ref() {
                    Some(NodeEnum::String(s)) => parts.push(s.sval.clone()),
                    other => return Err(format!("unexpected function name part: {other:?}")),
                }
            }
            let parts: Vec<String> = parts.into_iter().filter(|p| p != "pg_catalog").collect();
            let args: Vec<String> = f
                .args
                .iter()
                .map(render_expr)
                .collect::<Result<_, _>>()?;
            Ok(format!("{}({})", parts.join(".").to_lowercase(), args.join(", ")))
        }
        NodeEnum::TypeCast(tc) => {
            let arg = tc.arg.as_deref().ok_or("cast without argument")?;
            let tn = tc.type_name.as_ref().ok_or("cast without type")?;
            Ok(format!("{}::{}", render_expr(arg)?, render_type(tn)?))
        }
        other => Err(format!("unsupported default expression: {}", node_kind(other))),
    }
}
