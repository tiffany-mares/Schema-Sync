import type { Column, ForeignKey, Schema } from "./types";

export type DiffState = "unchanged" | "added" | "dropped" | "modified";

export interface ColumnView extends Column {
  state: DiffState;
  isPk: boolean;
}

export interface FkView {
  fk: ForeignKey;
  state: DiffState;
}

export interface TableView {
  name: string;
  state: DiffState;
  columns: ColumnView[];
  fks: FkView[];
}

const fkKey = (fk: ForeignKey) => JSON.stringify([fk.columns, fk.ref_table, fk.ref_columns]);

/** Merge two schemas into one renderable view: the union of tables and
 *  columns, each tagged with its diff state. Dropped things stay visible
 *  (in red) — that is the point of the diff view. */
export function buildView(from: Schema, to: Schema): TableView[] {
  const names = [...new Set([...Object.keys(from.tables), ...Object.keys(to.tables)])].sort();
  return names.map((name) => {
    const f = from.tables[name];
    const t = to.tables[name];
    const target = t ?? f;
    const pk = new Set(target.primary_key);

    if (!f || !t) {
      const state: DiffState = f ? "dropped" : "added";
      return {
        name,
        state,
        columns: target.columns.map((c) => ({ ...c, state, isPk: pk.has(c.name) })),
        fks: target.foreign_keys.map((fk) => ({ fk, state })),
      };
    }

    const colNames = [
      ...new Set([...f.columns.map((c) => c.name), ...t.columns.map((c) => c.name)]),
    ];
    const columns: ColumnView[] = colNames.map((cn) => {
      const fc = f.columns.find((c) => c.name === cn);
      const tc = t.columns.find((c) => c.name === cn);
      if (!fc) return { ...tc!, state: "added", isPk: pk.has(cn) };
      if (!tc) return { ...fc, state: "dropped", isPk: pk.has(cn) };
      const modified =
        fc.type_name !== tc.type_name || fc.not_null !== tc.not_null || fc.default !== tc.default;
      return { ...tc, state: modified ? "modified" : "unchanged", isPk: pk.has(cn) };
    });

    const fromFks = new Map(f.foreign_keys.map((fk) => [fkKey(fk), fk]));
    const toFks = new Map(t.foreign_keys.map((fk) => [fkKey(fk), fk]));
    const fks: FkView[] = [];
    for (const [key, fk] of toFks) fks.push({ fk, state: fromFks.has(key) ? "unchanged" : "added" });
    for (const [key, fk] of fromFks) if (!toFks.has(key)) fks.push({ fk, state: "dropped" });

    const pkChanged = JSON.stringify(f.primary_key) !== JSON.stringify(t.primary_key);
    const tableModified =
      columns.some((c) => c.state !== "unchanged") ||
      fks.some((x) => x.state !== "unchanged") ||
      pkChanged;

    return { name, state: tableModified ? "modified" : "unchanged", columns, fks };
  });
}
