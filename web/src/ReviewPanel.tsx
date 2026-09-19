import { useCallback, useEffect, useRef, useState } from "react";

const REPO = "demo";

interface AgentMessage {
  mr_id: number;
  seq: number;
  agent: string;
  kind: string;
  body: { text?: string; sql?: string; [k: string]: unknown };
  refs: string[];
}

interface CiEvent {
  stage: string;
  ok?: boolean;
  error?: string;
  duration_ms?: number;
}

type FeedItem =
  | { type: "agent"; msg: AgentMessage }
  | { type: "ci"; ev: CiEvent; key: number };

export function ReviewPanel({ source, target }: { source: string; target: string }) {
  const [mrId, setMrId] = useState<number | null>(null);
  const [status, setStatus] = useState<string>("");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mrIdRef = useRef<number | null>(null);
  const ciKey = useRef(0);
  const feedEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mrIdRef.current = mrId;
  }, [mrId]);

  // Live feed: the gateway pushes every board insert and CI event over WS.
  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onmessage = (raw) => {
      const msg = JSON.parse(raw.data);
      if (msg.type === "agent_message" && msg.data.mr_id === mrIdRef.current) {
        setFeed((f) => [...f, { type: "agent", msg: msg.data }]);
      }
      if (msg.type === "ci" && msg.channel === `ci:${mrIdRef.current}`) {
        setFeed((f) => [...f, { type: "ci", ev: msg.data, key: ciKey.current++ }]);
      }
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed]);

  // Poll MR status while a review is running.
  useEffect(() => {
    if (!mrId || ["approved", "shipped", "rejected"].includes(status)) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/repos/${REPO}/merge-requests/${mrId}`);
      if (r.ok) setStatus((await r.json()).status);
    }, 1500);
    return () => clearInterval(t);
  }, [mrId, status]);

  const openMr = useCallback(async () => {
    try {
      setError(null);
      setFeed([]);
      const r = await fetch(`/api/repos/${REPO}/merge-requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, target }),
      });
      if (!r.ok) throw new Error(`merge request: ${await r.text()}`);
      const mr = await r.json();
      setMrId(mr.id);
      mrIdRef.current = mr.id;
      setStatus("open");
      const rev = await fetch(`/api/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mr_id: mr.id }),
      });
      if (!rev.ok) throw new Error(`review: ${await rev.text()}`);
      setStatus("reviewing");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [source, target]);

  const approve = useCallback(async () => {
    if (!mrId) return;
    const r = await fetch(`/api/reviews/${mrId}/approve`, { method: "POST" });
    if (r.ok) setStatus("approved");
    else setError(await r.text());
  }, [mrId]);

  return (
    <aside className="review-panel">
      <div className="review-header">
        <span className="review-title">Review board</span>
        {mrId && <span className={`status-badge ${status}`}>{`MR !${mrId} · ${status}`}</span>}
      </div>
      <div className="review-actions">
        <button onClick={() => void openMr()} disabled={source === target}>
          Open merge request
        </button>
        {status === "awaiting_approval" && (
          <button className="approve" onClick={() => void approve()}>
            Approve
          </button>
        )}
      </div>
      {error && <div className="error review-error">{error}</div>}
      <div className="feed">
        {feed.map((item) =>
          item.type === "agent" ? (
            <div key={`a${item.msg.seq}`} className={`bubble agent-${item.msg.agent}`}>
              <div className="bubble-meta">
                <span className="agent-name">{item.msg.agent}</span>
                <span className="msg-kind">{item.msg.kind}</span>
              </div>
              <div className="bubble-text">{item.msg.body.text}</div>
              {item.msg.body.sql != null && <pre className="sql">{String(item.msg.body.sql)}</pre>}
              {item.msg.refs.length > 0 && (
                <ul className="refs">
                  {item.msg.refs.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div key={`c${item.key}`} className={`ci-event ${item.ev.stage} ${item.ev.ok ? "ok" : "fail"}`}>
              {item.ev.stage === "start"
                ? "CI: dry-run started"
                : `CI: dry-run ${item.ev.ok ? "passed" : "failed"} in ${item.ev.duration_ms} ms` +
                  (item.ev.error ? ` — ${item.ev.error}` : "")}
            </div>
          )
        )}
        <div ref={feedEnd} />
      </div>
    </aside>
  );
}
