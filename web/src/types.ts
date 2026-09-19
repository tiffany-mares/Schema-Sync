export interface Column {
  name: string;
  type: string;
  primaryKey?: boolean;
  foreignKey?: string;
  notNull?: boolean;
}

export interface Table {
  name: string;
  columns: Column[];
}

export interface ForeignKey {
  id: string;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  isNew?: boolean;
}

export interface Schema {
  id: string;
  label: string;
  tables: Table[];
  foreignKeys: ForeignKey[];
}

export type Change =
  | { op: "AddTable"; table: Table }
  | { op: "DropTable"; table: Table }
  | { op: "AddColumn"; table: string; column: Column }
  | { op: "DropColumn"; table: string; column: Column }
  | { op: "AlterColumn"; table: string; before: Column; after: Column }
  | { op: "RenameColumn"; table: string; before: string; after: string; similarity: number };

export type Agent = "Leader" | "Schema Analyst" | "Impact Scout" | "Migration Engineer" | "Release Agent";
export type MessageKind = "plan" | "finding" | "proposal" | "revision" | "dryrun" | "verdict" | "action";

export interface DryRunResult {
  ok: boolean;
  duration_ms: number;
  error?: string;
}

export interface AgentMessage {
  mr_id: number;
  seq: number;
  agent: Agent;
  kind: MessageKind;
  body: string;
  sql?: string;
  dryrun?: DryRunResult;
  lesson?: string;
  refs: string[];
  ts: string;
}

export interface MergeRequest {
  id: number;
  title: string;
  repository: string;
  base: string;
  head: string;
  status: "Reviewing" | "Awaiting approval" | "Approved" | "Shipped";
  changes: Change[];
}

export interface Branch {
  name: string;
  active?: boolean;
  tone: "primary" | "secondary" | "muted";
}

export interface Commit {
  hash: string;
  message: string;
  time: string;
  branch: string;
  schema: Schema;
}