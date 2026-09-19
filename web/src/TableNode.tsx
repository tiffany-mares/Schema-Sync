import { Handle, Position } from "@xyflow/react";
import type { TableView } from "./diffView";

export function TableNode({ data }: { data: { table: TableView } }) {
  const t = data.table;
  return (
    <div className={`table-node ${t.state}`}>
      <Handle type="target" position={Position.Left} className="port" />
      <div className="table-header">{t.name}</div>
      <div className="table-columns">
        {t.columns.map((c) => (
          <div key={c.name} className={`column-row ${c.state}`}>
            <span className="col-name">
              {c.isPk ? "\u{1F511} " : ""}
              {c.name}
            </span>
            <span className="col-type">
              {c.type_name}
              {c.not_null ? " !" : ""}
            </span>
          </div>
        ))}
      </div>
      <Handle type="source" position={Position.Right} className="port" />
    </div>
  );
}
