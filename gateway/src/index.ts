import express from "express";
import { createServer } from "http";
import { MongoClient } from "mongodb";
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

// Proxy /api/* to the vcs service. Body is streamed through untouched, so no
// json middleware here — it would consume the stream.
app.use("/api", async (req, res) => {
  const url = VCS_URL + req.originalUrl.replace(/^\/api/, "");
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
const wss = new WebSocketServer({ server, path: "/ws" });

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

server.listen(PORT, () => console.log(`gateway on :${PORT}`));
