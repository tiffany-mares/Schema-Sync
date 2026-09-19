import { ReactFlow, Background, Controls, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { useMemo } from "react";
import type { TableView } from "./diffView";
import { TableNode } from "./TableNode";

const nodeTypes = { table: TableNode };

const NODE_WIDTH = 260;
const HEADER_H = 40;
const ROW_H = 24;

function layout(tables: TableView[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 50, ranksep: 110 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const t of tables) {
    g.setNode(t.name, { width: NODE_WIDTH, height: HEADER_H + ROW_H * t.columns.length });
  }

  const edges: Edge[] = [];
  for (const t of tables) {
    for (const { fk, state } of t.fks) {
      if (!tables.some((x) => x.name === fk.ref_table)) continue;
      g.setEdge(t.name, fk.ref_table);
      edges.push({
        id: `${t.name}.${fk.columns.join("_")}->${fk.ref_table}`,
        source: t.name,
        target: fk.ref_table,
        animated: state === "added",
        label: fk.columns.join(", "),
        className: `fk-edge ${state}`,
      });
    }
  }

  dagre.layout(g);

  const nodes: Node[] = tables.map((t) => {
    const pos = g.node(t.name);
    return {
      id: t.name,
      type: "table",
      position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 },
      data: { table: t },
    };
  });

  return { nodes, edges };
}

export function SchemaFlow({ tables }: { tables: TableView[] }) {
  const { nodes, edges } = useMemo(() => layout(tables), [tables]);
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} />
      <Controls />
    </ReactFlow>
  );
}
