import { useEffect, useRef, useState } from "react";
import { Bot, BrainCircuit, Check, CircleDot, Database, Github, Play, Radar, Rocket, RotateCcw, TerminalSquare, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { approveMergeRequest } from "@/services/api";
import { useReviewFeed } from "@/hooks/use-review-feed";
import type { Agent, AgentMessage } from "@/types";

const agentMeta: Record<Agent, { icon: typeof Bot; className: string }> = {
  Leader: { icon: BrainCircuit, className: "agent-leader" },
  "Schema Analyst": { icon: Bot, className: "agent-analyst" },
  "Impact Scout": { icon: Radar, className: "agent-impact" },
  "Migration Engineer": { icon: TerminalSquare, className: "agent-migration" },
  "Release Agent": { icon: Rocket, className: "agent-release" },
};
const stages = ["Analyze", "Impact", "Draft", "Revise", "Dry-run", "Verdict", "Approve", "Release"] as const;

function completedStages(messages: AgentMessage[], approved: boolean): number {
  const done = [
    messages.some((m) => m.kind === "finding" && m.agent === "Schema Analyst"),
    messages.some((m) => m.kind === "finding" && m.agent === "Impact Scout"),
    messages.some((m) => m.kind === "proposal"),
    messages.some((m) => m.kind === "revision") || messages.some((m) => m.kind === "dryrun"),
    messages.some((m) => m.kind === "dryrun"),
    messages.some((m) => m.kind === "verdict"),
    approved,
    messages.some((m) => m.kind === "action" && m.agent === "Release Agent"),
  ];
  let count = 0;
  for (const stage of done) {
    if (!stage) break;
    count += 1;
  }
  return count;
}

function Pipeline({ completed }: { completed: number }) {
  return <div className="pipeline">
    <div className="pipeline-line"><i style={{ width: `${Math.min(100, (completed / 7) * 100)}%` }} /></div>
    {stages.map((stage, index) => <div key={stage} className={`pipeline-stage ${index < completed ? "complete" : ""} ${index === completed ? "active" : ""}`}>
      <span>{index < completed ? <Check /> : <CircleDot />}</span><small>{stage}</small>
    </div>)}
  </div>;
}

function MessageCard({ message, onFocus }: { message: AgentMessage; onFocus: (value?: string) => void }) {
  const meta = agentMeta[message.agent];
  const Icon = meta.icon;
  const files = message.refs.filter((ref) => ref.includes("/"));
  const focusRef = message.refs.find((ref) => !ref.includes("/"));
  return <article className="agent-message anim-in" onMouseEnter={() => onFocus(focusRef)} onMouseLeave={() => onFocus()} onClick={() => onFocus(focusRef)}>
    <div className={`agent-avatar ${meta.className}`}><Icon /></div>
    <div className="min-w-0 flex-1"><div className="agent-label"><strong>{message.agent}</strong><span>{message.kind}</span></div>
      <div className={`message-card message-${message.kind}`}>
        {message.kind === "revision" ? <>
          <div className="revision-note">{message.body}</div>
          {message.sql && <pre className="sql-diff"><code>{message.sql.split("\n").map((line, index) => <span key={index} className={line.startsWith("--") ? "sql-add" : ""}>{line}</span>)}</code></pre>}
        </> : message.kind === "verdict" ? <>
          <p>{message.body}</p>
          {message.lesson && <blockquote>“{message.lesson}”</blockquote>}
        </> : message.kind === "action" && message.agent === "Release Agent" ? (
          <div className="receipt-list">{message.body.split("|").map((row) => <span key={row}><Check />{row}</span>)}</div>
        ) : message.kind === "dryrun" ? (
          <p>{message.body}</p>
        ) : <>
          {message.body && <p>{message.body}</p>}
          {message.sql && <pre><code>{message.sql}</code></pre>}
        </>}
        {files.length > 0 && <div className="file-chips">{files.map((file) => <span key={file}><Github />{file}</span>)}</div>}
        {message.kind === "dryrun" && message.dryrun && (
          <div className={`ci-result ${message.dryrun.ok ? "" : "ci-failed"}`}>
            {message.dryrun.ok ? <Check /> : <X />} {message.dryrun.ok ? "passed" : "failed"}
            <span>{message.dryrun.duration_ms}ms</span><small>seeded Postgres</small>
          </div>
        )}
      </div>
    </div>
  </article>;
}

function EmptyReviewBoard() {
  // CSS keyframes, not framer-motion loops: nested infinite JS-driven
  // transforms proved pathological to unmount on this stack.
  const agents = (["Leader", "Schema Analyst", "Impact Scout", "Migration Engineer", "Release Agent"] as Agent[]);
  return <div className="feed-empty review-empty">
    <div className="agent-orbit" aria-hidden="true">
      <i className="orbit-track orbit-track-outer" /><i className="orbit-track orbit-track-inner" />
      <div className="orbit-database"><Database /></div>
      <div className="orbit-agents orbit-spin">
        {agents.map((agent, index) => { const meta = agentMeta[agent]; const Icon = meta.icon; return <span key={agent} className={`agent-avatar orbit-agent orbit-agent-${index + 1} orbit-counterspin ${meta.className}`}><Icon /></span>; })}
      </div>
    </div>
    <strong>Open a merge request to start the review</strong>
    <span>Five specialist agents are ready to inspect your schema.</span>
  </div>;
}

export function ReviewBoard({ mrId, onFocus }: { mrId?: number; onFocus: (value?: string) => void }) {
  const { messages, isPlaying, thinkingAgent, play, reset } = useReviewFeed(mrId ?? -1);
  const [status, setStatus] = useState<"Reviewing" | "Awaiting approval" | "Approved">("Reviewing");
  const [approving, setApproving] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const verdict = messages.find((message) => message.kind === "verdict");
  const awaiting = Boolean(verdict) && status !== "Approved";

  useEffect(() => { if (awaiting) setStatus("Awaiting approval"); }, [awaiting]);
  useEffect(() => { viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: "smooth" }); }, [messages, thinkingAgent]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.shiftKey && event.key.toLowerCase() === "r") { reset(); setStatus("Reviewing"); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [reset]);

  async function approve() {
    if (!mrId) return;
    setApproving(true);
    try { await approveMergeRequest(mrId); setStatus("Approved"); }
    catch { toast.error("Approval failed", { description: "The merge request was not changed." }); }
    finally { setApproving(false); }
  }

  function startPlay() {
    void play().catch((error: Error) => toast.error("Review couldn’t start", { description: error.message }));
  }

  const resetAll = () => { reset(); setStatus("Reviewing"); };
  const completed = completedStages(messages, status === "Approved");
  return <section className="review-panel glass-panel">
    <header className="review-header"><div><span className="section-kicker">Live agent review</span><h2>Review Board {mrId && <em>· MR #{mrId}</em>}</h2></div><div className="review-actions">{mrId ? <><span className={`status-chip status-${status.toLowerCase().replace(" ", "-")}`}><i />{status}</span><Button size="sm" variant="ghost" onClick={resetAll} title="Reset review" aria-label="Reset review"><RotateCcw /></Button><Button size="sm" onClick={startPlay} disabled={isPlaying || messages.length > 0}><Play />{isPlaying ? "Reviewing…" : "Run review"}</Button></> : <span className="status-chip"><i />No MR</span>}</div></header>
    <Pipeline completed={completed} />
    <ScrollArea className="review-feed"><div ref={viewportRef} className="review-feed-inner">
      {messages.length === 0 && !isPlaying && (mrId ? <div className="feed-empty"><BrainCircuit /><strong>Agents are standing by</strong><span>Run the review to inspect this migration.</span></div> : <EmptyReviewBoard />)}
      {messages.map((message) => <MessageCard key={message.seq} message={message} onFocus={onFocus} />)}
      {thinkingAgent && isPlaying && <div className="thinking-row anim-in"><div className={`agent-avatar ${agentMeta[thinkingAgent].className}`}><Bot /></div><div><strong>{thinkingAgent}</strong><span className="typing"><i /><i /><i /></span></div></div>}
    </div></ScrollArea>
    {awaiting && <div className="approval-card anim-up"><div><span>Leader recommends</span><strong>{verdict?.body ?? "Approve this migration"}</strong></div><div><Button size="sm" onClick={approve} disabled={approving}><Check />{approving ? "Approving…" : "Approve"}</Button></div>{approving && <div className="particle-burst">{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ "--i": i } as React.CSSProperties} />)}</div>}</div>}
  </section>;
}
