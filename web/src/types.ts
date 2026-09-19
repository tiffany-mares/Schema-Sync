export interface Column {
  name: string;
  type_name: string;
  not_null: boolean;
  default: string | null;
}

export interface ForeignKey {
  columns: string[];
  ref_table: string;
  ref_columns: string[];
}

export interface Table {
  name: string;
  columns: Column[];
  primary_key: string[];
  foreign_keys: ForeignKey[];
}

export interface Schema {
  tables: Record<string, Table>;
}

export interface Change {
  kind: string;
  [key: string]: unknown;
}

export interface DiffResponse {
  changes: Change[];
  from_schema: Schema;
  to_schema: Schema;
}

export interface Branch {
  name: string;
  head: string;
}
