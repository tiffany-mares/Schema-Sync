import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { GitBranch, GitCommitHorizontal, GitMerge, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CanvasLoading } from "@/components/canvas-loading";
import { CommitDrawer } from "@/components/commit-drawer";
import { SchemaCanvas } from "@/components/schema-canvas";
import { ReviewBoard } from "@/components/review-board";
import { BASE_BRANCH, HEAD_BRANCH, REPO, createCommit, getBranches, getCommits, getDiff, openMergeRequest } from "@/services/api";
import type { Branch, Change, Commit, MergeRequest, Schema } from "@/types";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "SchemaSync — Database changes, reviewed" },
    { name: "description", content: "Visual database schema diffs and live AI migration reviews." },
    { property: "og:title", content: "SchemaSync — Database changes, reviewed" },
    { property: "og:description", content: "Visual database schema diffs and live AI migration reviews." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: Index,
});

function summarize(changes: Change[]) {
  const tables = changes.filter((change) => change.op === "AddTable").length - 0;
  const droppedTables = changes.filter((change) => change.op === "DropTable").length;
  const dropped = changes.filter((change) => change.op === "DropColumn").length;
  const modified = changes.filter((change) => change.op === "AlterColumn" || change.op === "AddColumn").length;
  const renamed = changes.filter((change) => change.op === "RenameColumn").length;
  return { tables, droppedTables, dropped, modified, renamed };
}

function Index() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [diff, setDiff] = useState<{ base: Schema; head: Schema; changes: Change[] }>();
  const [mr, setMr] = useState<MergeRequest>();
  const [snapshot, setSnapshot] = useState(0);
  const [focusedRef, setFocusedRef] = useState<string>();
  const [commitDrawerOpen, setCommitDrawerOpen] = useState(false);
  const [latestCommitHash, setLatestCommitHash] = useState<string>();
  const introPlayed = useRef(false);
  const finishIntro = useCallback(() => { introPlayed.current = true; }, []);

  const loadAll = useCallback(async () => {
    const [b, c, d] = await Promise.all([getBranches(), getCommits(), getDiff()]);
    setBranches(b);
    setCommits(c);
    setDiff(d);
    setSnapshot(c.length - 1);
  }, []);

  useEffect(() => {
    void loadAll().catch(() => toast.error("Schema data couldn’t be loaded", { description: "Are the gateway and vcs services running?" }));
  }, [loadAll]);

  const schema = commits[snapshot]?.schema ?? diff?.head;
  const atHead = commits.length > 0 && snapshot === commits.length - 1;
  const visibleChanges = useMemo(() => (atHead ? (diff?.changes ?? []) : []), [atHead, diff]);
  const summary = useMemo(() => summarize(diff?.changes ?? []), [diff]);

  async function handleCommit(ddl: string, message: string) {
    try {
      const commit = await createCommit(ddl, message);
      setLatestCommitHash(commit.hash.slice(0, 7));
      setCommitDrawerOpen(false);
      await loadAll();
    } catch (error) {
      toast.error("Commit failed", { description: (error as Error).message });
    }
  }

  async function handleOpenMergeRequest() {
    try {
      const nextMr = await openMergeRequest();
      setMr(nextMr);
    } catch (error) {
      toast.error("Merge request couldn’t be opened", { description: (error as Error).message });
    }
  }

  return (
    <main className="schemasync-app">
      <div className="ambient-mesh" aria-hidden="true"><i /><i /><i /></div>
      <header className="topbar glass-panel">
        <div className="brand"><span className="brand-mark"><i /></span><strong>SchemaSync</strong><span className="beta">BETA</span></div>
        <div className="repo-pill"><GitBranch /><span>{REPO}</span><kbd>⌘ K</kbd></div>
        <div className="compare-pill"><span>{BASE_BRANCH}</span><b>←</b><span>{HEAD_BRANCH}</span><i>{diff ? `${diff.changes.length} change${diff.changes.length === 1 ? "" : "s"}` : "…"}</i></div>
        <div className="top-actions"><Button variant="outline" size="sm" onClick={() => setCommitDrawerOpen(true)} disabled={!schema}><Plus />Commit</Button><Button size="sm" className="gradient-button" onClick={handleOpenMergeRequest} disabled={Boolean(mr)}><GitMerge />{mr ? `MR !${mr.id} open` : "Open MR"}</Button></div>
      </header>
      <aside className="left-sidebar glass-panel">
        <div className="sidebar-search"><Search /><span>Jump to…</span><kbd>/</kbd></div>
        <section><h3>Branches <span>{branches.length}</span></h3><div className="branch-list">{branches.map((branch, index) => <button key={branch.name} className={branch.active ? "selected" : ""}><span className="git-track"><i className={`tone-${branch.tone}`} />{index < branches.length - 1 && <b />}</span><GitBranch /><span>{branch.name}</span></button>)}</div></section>
        <section className="commits-section"><h3>Commits <span>{commits.length}</span></h3><div className="commit-list">{commits.slice().reverse().map((commit, reverseIndex) => { const index = commits.length - 1 - reverseIndex; return <button key={commit.hash} onClick={() => setSnapshot(index)} className={snapshot === index ? "selected" : ""}><GitCommitHorizontal /><div><strong>{commit.message}</strong><span><code>{commit.hash}</code> · {commit.time === "now" ? "just now" : `${commit.time} ago`}</span></div></button>; })}</div></section>
        <div className="sidebar-health"><span><i />Dry-run CI</span><strong>warm</strong></div>
      </aside>
      <section className="canvas-panel glass-panel">
        <div className="canvas-heading"><div><span className="section-kicker">Schema graph</span><h1>{schema?.label ?? "Loading snapshot…"}</h1></div>{diff && atHead && <div className="canvas-summary">{summary.tables > 0 && <span className="summary-added">+{summary.tables} table{summary.tables > 1 ? "s" : ""}</span>}{summary.renamed > 0 && <span className="summary-renamed">→{summary.renamed} renamed</span>}{summary.modified > 0 && <span className="summary-modified">~{summary.modified} column{summary.modified > 1 ? "s" : ""}</span>}{(summary.dropped > 0 || summary.droppedTables > 0) && <span className="summary-dropped">−{summary.dropped + summary.droppedTables} dropped</span>}</div>}</div>
        <div className="canvas-body">{schema ? <SchemaCanvas key={schema.id} schema={schema} changes={visibleChanges} focusedRef={focusedRef} playIntro={!introPlayed.current} onIntroComplete={finishIntro} /> : <CanvasLoading />}</div>
      </section>
      <ReviewBoard {...(mr ? { mrId: mr.id } : {})} onFocus={setFocusedRef} />
      <footer className="timeline glass-panel"><div className="timeline-label"><GitCommitHorizontal /><div><span>Commit timeline</span><strong>{commits[snapshot]?.message}</strong></div></div><div className="timeline-track"><div className="track-line"><i style={{ width: `${commits.length > 1 ? (snapshot / (commits.length - 1)) * 100 : 0}%` }} /></div>{commits.map((commit, index) => <button key={commit.hash} onClick={() => setSnapshot(index)} className={index <= snapshot ? "passed" : ""} aria-label={`View ${commit.message}`}><i /><span>{commit.hash.slice(0, 4)}</span></button>)}</div><input type="range" min="0" max={Math.max(0, commits.length - 1)} value={snapshot} onChange={(event) => setSnapshot(Number(event.target.value))} aria-label="Schema snapshot" /><div className="timeline-count"><strong>{snapshot + 1}</strong><span>/ {commits.length}</span></div></footer>
      {schema && <CommitDrawer open={commitDrawerOpen} schema={schema} onOpenChange={setCommitDrawerOpen} onCommit={handleCommit} />}
    </main>
  );
}
