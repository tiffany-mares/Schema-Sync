import express from "express";
import { createServer } from "http";
import { MongoClient } from "mongodb";
import { createClient } from "redis";
import { WebSocketServer } from "ws";

const PORT = +(process.env.PORT ?? 3000);
const VCS_URL = process.env.VCS_URL ?? "http://127.0.0.1:8000";
const ATLAS_URI =
  process.env.ATLAS_URI ?? "mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true";
const MONGO_DB = process.env.MONGO_DB ?? "schemasync";

const app = express();

// CORS for the vite dev server.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const AGENTS_URL = process.env.AGENTS_URL ?? "http://127.0.0.1:8090";

// Proxy /api/* to the owning service. Body is streamed through untouched, so
// no json middleware here — it would consume the stream.
app.use("/api", async (req, res) => {
  const path = req.originalUrl.replace(/^\/api/, "");
  const upstreamBase = path.startsWith("/reviews") ? AGENTS_URL : VCS_URL;
  const url = upstreamBase + path;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const hasBody = chunks.length > 0 && !["GET", "HEAD"].includes(req.method);
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: { "content-type": req.headers["content-type"] ?? "application/json" },
      body: hasBody ? Buffer.concat(chunks) : undefined,
    });
    res.status(upstream.status);
    res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json");
    res.send(await upstream.text());
  } catch (err) {
    res.status(502).json({ error: `vcs unreachable: ${(err as Error).message}` });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const server = createServer(app);
// Path is /board (not /ws): vite/TanStack dev servers use /ws for HMR, and a
// proxy rule for /ws would swallow their socket and cause reload loops.
const wss = new WebSocketServer({ server, path: "/board" });

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "hello" }));
});

function broadcast(message: object) {
  const text = JSON.stringify(message);
  for (const client of wss.clients) if (client.readyState === 1) client.send(text);
}

// The live agent feed: every insert into the Atlas agent board is pushed to
// every connected browser. Agents never talk to the UI directly.
async function relayAgentBoard() {
  const client = new MongoClient(ATLAS_URI);
  await client.connect();
  const board = client.db(MONGO_DB).collection("agent_messages");
  board
    .watch([{ $match: { operationType: "insert" } }])
    .on("change", (event) => {
      if ("fullDocument" in event) {
        broadcast({ type: "agent_message", data: event.fullDocument });
      }
    })
    .on("error", (err) => {
      console.error("change stream error, retrying in 3s:", err.message);
      setTimeout(relayAgentBoard, 3000);
    });
  console.log("agent board change stream open");
}

relayAgentBoard().catch((err) => console.error("mongo connect failed:", err.message));

// CI status stream: the migrator publishes start/result per merge request.
async function relayCiEvents() {
  const sub = createClient({ url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379" });
  sub.on("error", (err) => console.error("redis error:", err.message));
  await sub.connect();
  await sub.pSubscribe("ci:*", (message, channel) => {
    try {
      broadcast({ type: "ci", channel, data: JSON.parse(message) });
    } catch {
      broadcast({ type: "ci", channel, data: message });
    }
  });
  console.log("ci:* redis relay open");
}

relayCiEvents().catch((err) => console.error("redis connect failed:", err.message));

server.listen(PORT, () => console.log(`gateway on :${PORT}`));
