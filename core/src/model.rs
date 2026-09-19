use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A whole database schema. BTreeMap keeps table order deterministic so the
/// serialized JSON is stable — snapshot hashes depend on this.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
pub struct Schema {
    pub tables: BTreeMap<String, Table>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Table {
    pub name: String,
    /// Declaration order, diffed by name.
    pub columns: Vec<Column>,
    pub primary_key: Vec<String>,
    pub foreign_keys: Vec<ForeignKey>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Column {
    pub name: String,
    /// Normalized: pg_catalog stripped, lowercase, typmods inline, e.g. "numeric(10,2)".
    pub type_name: String,
    pub not_null: bool,
    pub default: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ForeignKey {
    pub columns: Vec<String>,
    pub ref_table: String,
    pub ref_columns: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "kind")]
pub enum Change {
    AddTable { table: Table },
    DropTable { name: String },
    AddColumn { table: String, column: Column },
    DropColumn { table: String, column: String },
    AlterColumnType { table: String, column: String, from: String, to: String },
    SetNotNull { table: String, column: String },
    DropNotNull { table: String, column: String },
    SetDefault { table: String, column: String, default: String },
    DropDefault { table: String, column: String },
    AddForeignKey { table: String, fk: ForeignKey },
    DropForeignKey { table: String, fk: ForeignKey },
    ChangePrimaryKey { table: String, from: Vec<String>, to: Vec<String> },
}

impl Table {
    pub fn column(&self, name: &str) -> Option<&Column> {
        self.columns.iter().find(|c| c.name == name)
    }
}
