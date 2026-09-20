import { useEffect, useMemo, useState } from "react";
import dagre from "@dagrejs/dagre";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  Position,
  ReactFlow,
  getSmoothStepPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { motion, useReducedMotion } from "framer-motion";
import { Database, KeyRound, Link2, LockKeyhole, Plus } from "lucide-react";
import type { Change, Schema, Table } from "@/types";

type TableNodeData = { table: Table; changes: Change[]; focused: boolean; intro: boolean; introIndex: number; [key: string]: unknown };

function getColumnChange(table: string, column: string, changes: Change[]) {
  return changes.find((change) =>
    (change.op === "DropColumn" && change.table === table && change.column.name === column) ||
    (change.op === "AlterColumn" && change.table === table && change.after.name === column) ||
    (change.op === "RenameColumn" && change.table === table && change.after === column),
  );
}

function TableNode({ data }: NodeProps<Node<TableNodeData>>) {
  const reduceMotion = useReducedMotion();
  const added = data.changes.some((change) => change.op === "AddTable" && change.table.name === data.table.name);
  const dropped = data.changes.find((change) => change.op === "DropColumn" && change.table === data.table.name);
  const changed = added || data.changes.some((change) => "table" in change && typeof change.table === "string" && change.table === data.table.name);

  return (
    <motion.div
      initial={data.intro && !reduceMotion ? { opacity: 0, y: 22, scale: 0.94 } : added && !reduceMotion ? { opacity: 0, scale: 0.9 } : false}
      animate={{ opacity: changed ? 1 : 0.42, y: 0, scale: 1 }}
      transition={data.intro ? { duration: 0.42, delay: data.introIndex * 0.16, ease: [0.22, 1, 0.36, 1] } : { type: "spring", stiffness: 250, damping: 24 }}
      className={`schema-table ${added ? "schema-table-added" : ""} ${data.intro ? "schema-table-intro" : ""} ${data.focused ? "schema-table-focused" : ""}`}
    >
      <Handle type="target" position={Position.Left} className="schema-handle" />
      <div className="schema-table-header">
        <Database aria-hidden="true" />
        <span>{data.table.name}</span>
        {added && <span className="diff-badge diff-added"><Plus /> added</span>}
      </div>
      <div>
        {data.table.columns.map((column) => {
          const change = getColumnChange(data.table.name, column.name, data.changes);
          const rowClass = change?.op === "RenameColumn" ? "column-renamed" : change?.op === "AlterColumn" ? "column-modified" : added ? "column-added" : "";
          return (
            <div key={column.name} className={`schema-column ${rowClass}`}>
              <span className="column-name">{column.name}</span>
              <span className="column-type">
                {change?.op === "RenameColumn" && <span className="old-value">{change.before} → </span>}
                {change?.op === "AlterColumn" && <span className="old-value">{change.before.type} → </span>}
                {column.type}
              </span>
              <span className="column-badges">
                {column.primaryKey && <span title="Primary key"><KeyRound /></span>}
                {column.foreignKey && <span title="Foreign key"><Link2 /></span>}
                {column.notNull && <span title="Not null"><LockKeyhole /></span>}
              </span>
            </div>
          );
        })}
        {dropped?.op === "DropColumn" && (
          <div className="schema-column column-dropped">
            <span className="column-name">− {dropped.column.name}</span>
            <span className="column-type">{dropped.column.type}</span>
            <span className="column-badges">dropped</span>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="schema-handle" />
    </motion.div>
  );
}

function GlowEdge(props: EdgeProps) {
  const [path] = getSmoothStepPath(props);
  const isNew = Boolean(props.data?.["isNew"]);
  const highlighted = Boolean(props.data?.["highlighted"]);
  const intro = Boolean(props.data?.["intro"]);
  const introDelay = Number(props.data?.["introDelay"] ?? 0);
  const reduceMotion = useReducedMotion();
  return (
    <>
      {intro && !reduceMotion ? (
        <>
          <motion.path d={path} className={`schema-edge-glow ${highlighted ? "edge-highlighted" : ""}`} fill="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.24, delay: introDelay }} />
          <motion.path d={path} className="schema-edge schema-edge-intro" fill="none" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ pathLength: { duration: 0.58, delay: introDelay, ease: "easeInOut" }, opacity: { duration: 0.12, delay: introDelay } }} />
        </>
      ) : (
        <>
          <BaseEdge path={path} className={`schema-edge-glow ${highlighted ? "edge-highlighted" : ""}`} />
          <BaseEdge path={path} className={`schema-edge ${isNew ? "schema-edge-new" : ""}`} {...(props.markerEnd ? { markerEnd: props.markerEnd } : {})} />
        </>
      )}
      {isNew && !intro && <circle r="3" className="edge-particle"><animateMotion dur="2.4s" repeatCount="indefinite" path={path} /></circle>}
    </>
  );
}

const nodeTypes = { table: TableNode };
const edgeTypes = { glow: GlowEdge };

function FocusController({ focusedRef, nodes }: { focusedRef: string | undefined; nodes: Node<TableNodeData>[] }) {
  const flow = useReactFlow();
  useEffect(() => {
    if (!focusedRef) return;
    const tableName = focusedRef.split(".")[0];
    const node = nodes.find((item) => item.id === tableName);
    if (node) void flow.setCenter(node.position.x + 145, node.position.y + 100, { zoom: 1.05, duration: 650 });
  }, [flow, focusedRef, nodes]);
  return null;
}

export function SchemaCanvas({ schema, changes, focusedRef, compact = false, playIntro = false, onIntroComplete }: { schema: Schema; changes: Change[]; focusedRef: string | undefined; compact?: boolean; playIntro?: boolean; onIntroComplete?: () => void }) {
  const reduceMotion = useReducedMotion();
  const [introActive, setIntroActive] = useState(playIntro && !compact && !reduceMotion);
  const intro = introActive && playIntro && !compact && !reduceMotion;
  const introDelay = schema.tables.length * 0.16 + 0.34;

  useEffect(() => {
    if (!playIntro || !onIntroComplete) return;
    if (reduceMotion) {
      setIntroActive(false);
      onIntroComplete();
      return;
    }
    const timer = window.setTimeout(() => {
      setIntroActive(false);
      onIntroComplete();
    }, (introDelay + 0.7) * 1000);
    return () => window.clearTimeout(timer);
  }, [introDelay, onIntroComplete, playIntro, reduceMotion]);

  const graph = useMemo(() => {
    const layout = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    layout.setGraph({ rankdir: "LR", nodesep: 72, ranksep: 150, marginx: 70, marginy: 60 });
    schema.tables.forEach((table) => layout.setNode(table.name, { width: 290, height: 64 + table.columns.length * 38 }));
    schema.foreignKeys.forEach((fk) => layout.setEdge(fk.sourceTable, fk.targetTable));
    dagre.layout(layout);
    const nodes: Node<TableNodeData>[] = schema.tables.map((table, index) => {
      const point = layout.node(table.name);
      return { id: table.name, type: "table", position: { x: point.x - 145, y: point.y - 100 }, data: { table, changes, focused: focusedRef === table.name || Boolean(focusedRef?.startsWith(`${table.name}.`)), intro, introIndex: index } };
    });
    const edges: Edge[] = schema.foreignKeys.map((fk) => ({
      id: fk.id, source: fk.sourceTable, target: fk.targetTable, type: "glow",
      data: { isNew: fk.isNew, highlighted: focusedRef?.startsWith(fk.sourceTable) || focusedRef?.startsWith(fk.targetTable), intro, introDelay },
    }));
    return { nodes, edges };
  }, [schema, changes, focusedRef, intro, introDelay]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <ReactFlow nodes={graph.nodes} edges={graph.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: compact ? 0.24 : 0.14 }} minZoom={0.25} maxZoom={1.6} proOptions={{ hideAttribution: true }} nodesDraggable={!compact} nodesConnectable={false} panOnDrag={!compact} zoomOnScroll={!compact}>
        <FocusController focusedRef={focusedRef} nodes={graph.nodes} />
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--canvas-dot)" />
        {!compact && <Controls position="top-right" showInteractive={false} />}
      </ReactFlow>
      {!compact && <div className="diff-legend" aria-label="Diff legend">
        <span><i className="legend-dot added" />+ Added</span>
        <span><i className="legend-dot dropped" />− Dropped</span>
        <span><i className="legend-dot modified" />~ Modified</span>
        <span><i className="legend-dot renamed" />→ Renamed</span>
      </div>}
    </div>
  );
}