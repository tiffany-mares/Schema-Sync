import type { Column, ForeignKey, Schema, Table } from "@/types";

function splitDefinitions(body: string): string[] {
  const definitions: string[] = [];
  let current = "";
  let depth = 0;
  for (const character of body) {
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if (character === "," && depth === 0) {
      definitions.push(current.trim());
      current = "";
    } else current += character;
  }
  if (current.trim()) definitions.push(current.trim());
  return definitions;
}

function cleanIdentifier(value: string): string {
  return value.replace(/^[`"']|[`"']$/g, "");
}

export function schemaToSql(schema: Schema): string {
  return schema.tables.map((table) => {
    const rows = table.columns.map((column) => {
      const markers = [
        column.primaryKey ? "PRIMARY KEY" : "",
        column.notNull ? "NOT NULL" : "",
        column.foreignKey ? `REFERENCES ${column.foreignKey.replace(".", "(")})` : "",
      ].filter(Boolean);
      return `  ${column.name} ${column.type}${markers.length ? ` ${markers.join(" ")}` : ""}`;
    });
    return `CREATE TABLE ${table.name} (\n${rows.join(",\n")}\n);`;
  }).join("\n\n");
}

export function parseSchemaSql(sql: string, label: string): { schema?: Schema; error?: string } {
  const tables: Table[] = [];
  const foreignKeys: ForeignKey[] = [];
  const expression = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w"`]+)\s*\(([\s\S]*?)\)\s*;/gi;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(sql)) !== null) {
    const tableName = cleanIdentifier(match[1] ?? "");
    const body = match[2];
    if (!tableName || body === undefined) continue;
    const columns: Column[] = [];
    for (const definition of splitDefinitions(body)) {
      if (/^(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|CHECK)\b/i.test(definition)) continue;
      const columnMatch = definition.match(/^([\w"`]+)\s+([\w]+(?:\s*\([^)]*\))?)([\s\S]*)$/i);
      if (!columnMatch) continue;
      const name = cleanIdentifier(columnMatch[1] ?? "");
      const type = (columnMatch[2] ?? "").replace(/\s+/g, "");
      const rest = columnMatch[3] ?? "";
      const reference = rest.match(/REFERENCES\s+([\w"`]+)\s*\(\s*([\w"`]+)\s*\)/i);
      const foreignKey = reference ? `${cleanIdentifier(reference[1] ?? "")}.${cleanIdentifier(reference[2] ?? "")}` : undefined;
      columns.push({
        name,
        type,
        ...( /PRIMARY\s+KEY/i.test(rest) ? { primaryKey: true } : {}),
        ...( /NOT\s+NULL/i.test(rest) ? { notNull: true } : {}),
        ...(foreignKey ? { foreignKey } : {}),
      });
      if (foreignKey) {
        const [targetTable, targetColumn] = foreignKey.split(".");
        if (targetTable && targetColumn) foreignKeys.push({ id: `${tableName}-${name}-${targetTable}`, sourceTable: tableName, sourceColumn: name, targetTable, targetColumn });
      }
    }
    if (columns.length) tables.push({ name: tableName, columns });
  }

  if (!tables.length) return { error: "Add at least one complete CREATE TABLE statement ending with a semicolon." };
  return { schema: { id: `draft-${Date.now()}`, label, tables, foreignKeys } };
}