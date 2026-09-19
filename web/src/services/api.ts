import type { Branch, Change, Column, Commit, ForeignKey, MergeRequest, Schema, Table } from "@/types";

// Everything goes through the gateway: /api/* is proxied to vcs (or the
// agents service for /reviews*), /ws carries the live board + CI stream.
export const REPO = "demo";
export const BASE_BRANCH = "main";
export const HEAD_BRANCH = "feature/add-payments";

// ---- wire types coming from the Rust core / vcs ----

interface ApiColumn {
  name: string;
  type_name: string;
  not_null: boolean;
  default: string | null;
}

interface ApiForeignKey {
  columns: string[];
  ref_table: string;
  ref_columns: string[];
}

interface ApiTable {
  name: string;
  columns: ApiColumn[];
  primary_key: string[];
  foreign_keys: ApiForeignKey[];
}

export interface ApiSchema {
  tables: Record<string, ApiTable>;
}

type ApiChange = { kind: string; [key: string]: unknown };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---- conversions to the UI model ----

const fkKey = (fk: ApiForeignKey, table: string) =>
  `${table}.${fk.columns.join("_")}->${fk.ref_table}`;

export function toUiSchema(id: string, label: string, api: ApiSchema, base?: ApiSchema): Schema {
  const baseKeys = new Set<string>();
  if (base) {
    for (const table of Object.values(base.tables)) {
      for (const fk of table.foreign_keys) baseKeys.add(fkKey(fk, table.name));
    }
  }
  const tables: Table[] = Object.values(api.tables)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((table) => ({
      name: table.name,
      columns: table.columns.map((column): Column => {
        const fk = table.foreign_keys.find((item) => item.columns[0] === column.name);
        return {
          name: column.name,
          type: column.type_name,
          ...(table.primary_key.includes(column.name) ? { primaryKey: true } : {}),
          ...(column.not_null ? { notNull: true } : {}),
          ...(fk ? { foreignKey: `${fk.ref_table}.${fk.ref_columns[0]}` } : {}),
        };
      }),
    }));
  const foreignKeys: ForeignKey[] = Object.values(api.tables).flatMap((table) =>
    table.foreign_keys.map((fk) => ({
      id: fkKey(fk, table.name),
      sourceTable: table.name,
      sourceColumn: fk.columns[0] ?? "",
      targetTable: fk.ref_table,
      targetColumn: fk.ref_columns[0] ?? "",
      ...(base && !baseKeys.has(fkKey(fk, table.name)) ? { isNew: true } : {}),
    })),
  );
  return { id, label, tables, foreignKeys };
}

function toUiTable(table: ApiTable): Table {
  return {
    name: table.name,
    columns: table.columns.map((column) => ({
      name: column.name,
      type: column.type_name,
      ...(table.primary_key.includes(column.name) ? { primaryKey: true } : {}),
      ...(column.not_null ? { notNull: true } : {}),
    })),
  };
}

function baseColumn(base: ApiSchema, table: string, column: string): Column {
  const found = base.tables[table]?.columns.find((item) => item.name === column);
  return { name: column, type: found?.type_name ?? "unknown", ...(found?.not_null ? { notNull: true } : {}) };
}

/** Convert core changes to UI ops, folding drop+add pairs that the MiniLM
 *  rename detector matches into real RenameColumn entries. */
async function convertChanges(apiChanges: ApiChange[], base: ApiSchema): Promise<Change[]> {
  const drops = apiChanges.filter((c) => c.kind === "DropColumn");
  const adds = apiChanges.filter((c) => c.kind === "AddColumn");
  const renames = new Map<string, { to: string; score: number }>();
  if (drops.length && adds.length) {
    try {
      const detected = await post<{ pairs: { from: string; to: string; score: number }[] }>(
        "/tools/renames",
        {
          drops: drops.map((c) => ({
            table: c["table"],
            column: c["column"],
            type_name: baseColumn(base, c["table"] as string, c["column"] as string).type,
          })),
          adds: adds.map((c) => ({
            table: c["table"],
            column: (c["column"] as ApiColumn).name,
            type_name: (c["column"] as ApiColumn).type_name,
          })),
        },
      );
      for (const pair of detected.pairs) renames.set(pair.from, { to: pair.to, score: pair.score });
    } catch {
      // rename detection is an enhancement, never a blocker
    }
  }

  const renamedTargets = new Set([...renames.values()].map((pair) => pair.to));
  const changes: Change[] = [];
  for (const change of apiChanges) {
    const table = change["table"];
    switch (change.kind) {
      case "AddTable":
        changes.push({ op: "AddTable", table: toUiTable(table as ApiTable) });
        break;
      case "DropTable": {
        const name = change["name"] as string;
        const known = base.tables[name];
        changes.push({ op: "DropTable", table: known ? toUiTable(known) : { name, columns: [] } });
        break;
      }
      case "AddColumn": {
        const column = change["column"] as ApiColumn;
        const ref = `${table as string}.${column.name}`;
        if (renamedTargets.has(ref)) break; // folded into RenameColumn
        changes.push({
          op: "AddColumn",
          table: table as string,
          column: { name: column.name, type: column.type_name, ...(column.not_null ? { notNull: true } : {}) },
        });
        break;
      }
      case "DropColumn": {
        const columnName = change["column"] as string;
        const ref = `${table as string}.${columnName}`;
        const rename = renames.get(ref);
        if (rename) {
          changes.push({
            op: "RenameColumn",
            table: table as string,
            before: columnName,
            after: rename.to.split(".")[1] ?? rename.to,
            similarity: rename.score,
          });
        } else {
          changes.push({ op: "DropColumn", table: table as string, column: baseColumn(base, table as string, columnName) });
        }
        break;
      }
      case "AlterColumnType":
        changes.push({
          op: "AlterColumn",
          table: table as string,
          before: { name: change["column"] as string, type: change["from"] as string },
          after: { name: change["column"] as string, type: change["to"] as string },
        });
        break;
      case "SetNotNull":
      case "DropNotNull": {
        const column = baseColumn(base, table as string, change["column"] as string);
        changes.push({
          op: "AlterColumn",
          table: table as string,
          before: column,
          after: { ...column, ...(change.kind === "SetNotNull" ? { notNull: true } : { notNull: false }) },
        });
        break;
      }
      default:
        break; // defaults / FKs / PKs render through the schema itself
    }
  }
  return changes;
}

// ---- public API used by the routes ----

export async function getBranches(): Promise<Branch[]> {
  const branches = await request<{ name: string; head: string }[]>(`/repos/${REPO}/branches`);
  const tones: Branch["tone"][] = ["muted", "primary", "secondary"];
  return branches
    .sort((a, b) => (a.name === BASE_BRANCH ? -1 : b.name === BASE_BRANCH ? 1 : a.name.localeCompare(b.name)))
    .map((branch, index) => ({
      name: branch.name,
      tone: tones[index % tones.length] ?? "muted",
      ...(branch.name === HEAD_BRANCH ? { active: true } : {}),
    }));
}

function humanize(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return "now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export async function getCommits(): Promise<Commit[]> {
  const commits = await request<{ hash: string; message: string; created_at: string; schema: ApiSchema }[]>(
    `/repos/${REPO}/commits?branch=${encodeURIComponent(HEAD_BRANCH)}`,
  );
  return commits.map((commit, index) => ({
    hash: commit.hash.slice(0, 7),
    message: commit.message,
    time: humanize(commit.created_at),
    branch: index === 0 ? BASE_BRANCH : HEAD_BRANCH,
    schema: toUiSchema(commit.hash, index === 0 ? BASE_BRANCH : HEAD_BRANCH, commit.schema),
  }));
}

export async function createCommit(ddl: string, message: string): Promise<{ hash: string }> {
  return post(`/repos/${REPO}/commits`, { branch: HEAD_BRANCH, ddl, message });
}

export async function getDiff(): Promise<{ base: Schema; head: Schema; changes: Change[] }> {
  const diff = await request<{ changes: ApiChange[]; from_schema: ApiSchema; to_schema: ApiSchema }>(
    `/repos/${REPO}/diff?from=${encodeURIComponent(BASE_BRANCH)}&to=${encodeURIComponent(HEAD_BRANCH)}`,
  );
  const base = toUiSchema(BASE_BRANCH, BASE_BRANCH, diff.from_schema);
  const head = toUiSchema(HEAD_BRANCH, HEAD_BRANCH, diff.to_schema, diff.from_schema);
  const changes = await convertChanges(diff.changes, diff.from_schema);
  return { base, head, changes };
}

export async function openMergeRequest(): Promise<MergeRequest> {
  const created = await post<{ id: number; base_commit: string; conflicts: unknown[] }>(
    `/repos/${REPO}/merge-requests`,
    { source: HEAD_BRANCH, target: BASE_BRANCH },
  );
  return {
    id: created.id,
    title: `${HEAD_BRANCH} → ${BASE_BRANCH}`,
    repository: REPO,
    base: BASE_BRANCH,
    head: HEAD_BRANCH,
    status: "Reviewing",
    changes: [],
  };
}

export async function startReview(mrId: number): Promise<void> {
  await post(`/reviews`, { mr_id: mrId });
}

export async function approveMergeRequest(id: number): Promise<void> {
  await post(`/reviews/${id}/approve`, {});
}
