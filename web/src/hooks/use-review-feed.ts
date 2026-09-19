import { useCallback, useEffect, useRef, useState } from "react";
import { startReview } from "@/services/api";
import type { Agent, AgentMessage, MessageKind } from "@/types";

const AGENT_MAP: Record<string, Agent> = {
  leader: "Leader",
  analyst: "Schema Analyst",
  scout: "Impact Scout",
  engineer: "Migration Engineer",
  release: "Release Agent",
};

// Who is "typing" after each message lands — mirrors the Swarmflow stage order.
function nextThinker(message: AgentMessage): Agent | null {
  if (message.kind === "plan") return "Schema Analyst";
  if (message.kind === "finding" && message.agent === "Schema Analyst") return "Impact Scout";
  if (message.kind === "finding" && message.agent === "Impact Scout") return "Migration Engineer";
  if (message.kind === "proposal" || message.kind === "revision") return "Migration Engineer";
  if (message.kind === "dryrun") return "Leader";
  return null;
}

interface BoardDoc {
  mr_id: number;
  seq: number;
  agent: string;
  kind: string;
  body: { text?: string; sql?: string; lesson?: string; dryrun?: AgentMessage["dryrun"] };
  refs: string[];
  ts: string;
}

function convert(doc: BoardDoc): AgentMessage | null {
  const agent = AGENT_MAP[doc.agent];
  if (!agent) return null;
  const isDryRun = doc.kind === "action" && agent === "Migration Engineer" && Boolean(doc.body.dryrun);
  return {
    mr_id: doc.mr_id,
    seq: doc.seq,
    agent,
    kind: (isDryRun ? "dryrun" : doc.kind) as MessageKind,
    body: doc.body.text ?? "",
    ...(doc.body.sql ? { sql: doc.body.sql } : {}),
    ...(doc.body.dryrun ? { dryrun: doc.body.dryrun } : {}),
    ...(doc.body.lesson ? { lesson: doc.body.lesson } : {}),
    refs: doc.refs ?? [],
    ts: doc.ts,
  };
}

export function useReviewFeed(mrId: number) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [thinkingAgent, setThinkingAgent] = useState<Agent | null>(null);
  const mrIdRef = useRef(mrId);

  useEffect(() => {
    mrIdRef.current = mrId;
  }, [mrId]);

  // One socket for the whole board: every insert on the Atlas agent_messages
  // collection is relayed by the gateway the moment it lands.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Straight to the gateway — vite's ws proxying is flaky under load, and
    // WebSockets are not subject to CORS anyway. Auto-reconnects: long-lived
    // sockets get killed periodically on some machines.
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: number | undefined;

    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const gateway = import.meta.env.DEV ? `${window.location.hostname}:3000` : window.location.host;
      ws = new WebSocket(`${proto}://${gateway}/board`);
      ws.onmessage = (raw) => {
        try {
          const event = JSON.parse(raw.data as string);
          if (event.type !== "agent_message") return;
          const message = convert(event.data as BoardDoc);
          if (!message || message.mr_id !== mrIdRef.current) return;
          setMessages((current) =>
            current.some((item) => item.seq === message.seq) ? current : [...current, message].sort((a, b) => a.seq - b.seq),
          );
          setThinkingAgent(nextThinker(message));
          if (message.kind === "verdict") setIsPlaying(false);
        } catch {
          // non-JSON frames are ignored
        }
      };
      ws.onclose = () => {
        if (!closed) retry = window.setTimeout(connect, 1000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry !== undefined) window.clearTimeout(retry);
      ws?.close();
    };
  }, []);

  const dryRunRunning = isPlaying && ["proposal", "revision"].includes(messages[messages.length - 1]?.kind ?? "");

  const play = useCallback(async () => {
    if (isPlaying || mrIdRef.current < 0) return;
    setMessages([]);
    setIsPlaying(true);
    setThinkingAgent("Leader");
    try {
      await startReview(mrIdRef.current);
    } catch (error) {
      setIsPlaying(false);
      setThinkingAgent(null);
      throw error;
    }
  }, [isPlaying]);

  const reset = useCallback(() => {
    setMessages([]);
    setThinkingAgent(null);
    setIsPlaying(false);
  }, []);

  return { messages, isPlaying, thinkingAgent, dryRunRunning, play, reset, transport: "websocket" };
}
