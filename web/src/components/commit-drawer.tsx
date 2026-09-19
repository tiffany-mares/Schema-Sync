import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Code2, GitCommitHorizontal, Network, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SchemaCanvas } from "@/components/schema-canvas";
import { parseSchemaSql, schemaToSql } from "@/lib/schema-sql";
import type { Schema } from "@/types";

interface CommitDrawerProps {
  open: boolean;
  schema: Schema;
  onOpenChange: (open: boolean) => void;
  /** Receives the raw SQL — the backend's Postgres parser is the authority,
   *  the local regex parse only gates the button and drives the preview. */
  onCommit: (ddl: string, message: string) => Promise<void>;
}

export function CommitDrawer({ open, schema, onOpenChange, onCommit }: CommitDrawerProps) {
  const [source, setSource] = useState("");
  const [debouncedSource, setDebouncedSource] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const initial = schemaToSql(schema);
    setSource(initial);
    setDebouncedSource(initial);
    setMessage("");
  }, [open, schema]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSource(source), 300);
    return () => window.clearTimeout(timer);
  }, [source]);

  const parsed = useMemo(() => parseSchemaSql(debouncedSource, schema.label), [debouncedSource, schema.label]);
  const canCommit = Boolean(message.trim() && parsed.schema && !submitting);

  async function commit() {
    if (!parsed.schema || !message.trim()) return;
    setSubmitting(true);
    await onCommit(source, message.trim());
    setSubmitting(false);
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="commit-drawer-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => onOpenChange(false)} />
          <motion.aside className="commit-drawer glass-panel" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", damping: 28, stiffness: 260 }} aria-label="Create schema commit">
            <header className="commit-drawer-header">
              <div><span className="section-kicker">feature/add-payments</span><h2><GitCommitHorizontal />Create schema commit</h2></div>
              <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="Close commit drawer"><X /></Button>
            </header>
            <div className="commit-workspace">
              <section className="commit-editor-pane">
                <div className="commit-pane-label"><span><Code2 />Schema SQL</span><code>schema.sql</code></div>
                <CodeMirror value={source} height="100%" extensions={[sql()]} theme={oneDark} onChange={setSource} basicSetup={{ foldGutter: false, highlightActiveLineGutter: false }} aria-label="Schema SQL editor" />
              </section>
              <section className="commit-preview-pane">
                <div className="commit-pane-label"><span><Network />Live ER preview</span>{parsed.schema ? <em className="parse-ok"><CheckCircle2 />{parsed.schema.tables.length} tables</em> : <em className="parse-error">Needs valid SQL</em>}</div>
                <div className="mini-canvas">
                  {parsed.schema ? <SchemaCanvas key={parsed.schema.id} schema={parsed.schema} changes={[]} focusedRef={undefined} compact /> : <div className="parse-empty"><Code2 /><strong>Preview paused</strong><span>{parsed.error}</span></div>}
                </div>
              </section>
            </div>
            <footer className="commit-drawer-footer">
              <div><label htmlFor="commit-message">Commit message</label><Input id="commit-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe this schema change" onKeyDown={(event) => { if (event.key === "Enter" && canCommit) void commit(); }} /></div>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => void commit()} disabled={!canCommit}><GitCommitHorizontal />{submitting ? "Committing…" : "Commit"}</Button>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}