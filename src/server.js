// backend/src/server.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { redisClient, initRedis } from "./redisClient.js";

import {
  getSessionHistory,
  saveSessionHistory,
  clearSessionHistory,
} from "./sessionStore.js";

dotenv.config();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = process.env.BACKEND_PORT || process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const JINA_API_KEY = process.env.JINA_API_KEY;

const QDRANT_HOST = process.env.QDRANT_HOST || "qdrant";
const QDRANT_PORT = Number(process.env.QDRANT_PORT || 6333);
const QDRANT_COLLECTION =
  process.env.QDRANT_COLLECTION || "news_articles";

const CACHE_TTL_SECONDS = 600; // 10 minutes
const GEMINI_MODEL = "gemini-2.5-flash";

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY is not set.");
  process.exit(1);
}
if (!JINA_API_KEY) {
  console.error("❌ JINA_API_KEY is not set.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(bodyParser.json());

// ---------------------------------------------------------------------------
// External clients (Gemini + Qdrant)
// ---------------------------------------------------------------------------
let answerModel;
let qdrant;

async function initClients() {
  // Gemini
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  answerModel = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  // Qdrant
  qdrant = new QdrantClient({
    url: `http://${QDRANT_HOST}:${QDRANT_PORT}`,
  });

  // Redis
  await initRedis();

  console.log("✅ Gemini, Jina, Qdrant and Redis clients initialized.");
}

// ---------------------------------------------------------------------------
// Helpers (embeddings, Qdrant, Gemini, cache)
// ---------------------------------------------------------------------------

async function embedTextWithJina(text, task = "retrieval.query") {
  const resp = await axios.post(
    "https://api.jina.ai/v1/embeddings",
    {
      model: "jina-embeddings-v4",
      task,
      input: [{ text }],
    },
    {
      headers: {
        Authorization: `Bearer ${JINA_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  const embedding = resp.data?.data?.[0]?.embedding;
  if (!embedding) {
    throw new Error("No embedding returned from Jina");
  }
  return embedding;
}

async function searchQdrant(vector, limit = 5) {
  const result = await qdrant.search(QDRANT_COLLECTION, {
    vector,
    limit,
    with_payload: true,
    with_vectors: false,
  });
  return result;
}

function buildContextFromPoints(points) {
  if (!points || points.length === 0) return "No relevant articles found.";

  return points
    .map((pt, idx) => {
      const p = pt.payload || {};
      const title = p.title || p.headline || `Article ${idx + 1}`;
      const text =
        p.text || p.content || p.body || JSON.stringify(p, null, 2);
      return `### ${title}\n${text}`;
    })
    .join("\n\n---\n\n");
}

async function generateAnswerWithGemini(query, context) {
  const prompt = `
You are a news chatbot using Retrieval-Augmented Generation.

Use ONLY the context below to answer the user's question. 
If the answer is not clearly in the context, say you are not sure.

Context:
${context}

User question: ${query}

Answer in 3–6 concise sentences, neutral and factual.`;

  const result = await answerModel.generateContent({
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
  });

  return result.response.text();
}

// Simple per-query cache (optional)
async function getCached(query) {
  if (!redisClient) return null;
  const key = `rag:news:${query.trim().toLowerCase()}`;
  const raw = await redisClient.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function setCached(query, data) {
  if (!redisClient) return;
  const key = `rag:news:${query.trim().toLowerCase()}`;
  await redisClient.setEx(key, CACHE_TTL_SECONDS, JSON.stringify(data));
}

// Core RAG flow used by /api/query and /api/chat
async function runRagQuery(query) {
  // 1) Check cache
  const cached = await getCached(query);
  if (cached) {
    return { ...cached, cached: true };
  }

  // 2) Embed
  const vector = await embedTextWithJina(query, "retrieval.query");

  // 3) Retrieve
  const points = await searchQdrant(vector, 5);
  const context = buildContextFromPoints(points);

  // 4) Generate
  const answer = await generateAnswerWithGemini(query, context);

  // 5) Sources
  const sources = points.map((pt) => ({
    id: pt.id,
    score: pt.score,
    payload: pt.payload,
  }));

  const payload = { answer, sources, cached: false };

  // 6) Cache
  await setCached(query, payload);

  return payload;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check
app.get("/health", async (req, res) => {
  try {
    const redisOk = redisClient && redisClient.isOpen;
    res.json({
      status: "ok",
      message: "Backend is running",
      redis: redisOk ? "connected" : "not_connected",
      qdrantCollection: QDRANT_COLLECTION,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: String(err) });
  }
});

/**
 * POST /api/query
 * Body: { query: string }
 * Returns: { answer, sources, cached }
 */
app.post("/api/query", async (req, res) => {
  const { query } = req.body || {};
  if (!query || !query.trim()) {
    return res.status(400).json({ error: "query is required" });
  }

  try {
    const result = await runRagQuery(query);
    res.json(result);
  } catch (err) {
    console.error("❌ Error in /api/query:", err);
    res.status(500).json({
      error: "Internal server error while processing RAG query.",
    });
  }
});

/**
 * POST /api/chat
 * Body: { sessionId: string, userMessage: string }
 * Returns: { sessionId, answer, history, sources, cached }
 */
app.post("/api/chat", async (req, res) => {
  const { sessionId, userMessage } = req.body || {};

  if (!sessionId || !userMessage || !userMessage.trim()) {
    return res
      .status(400)
      .json({ error: "sessionId and userMessage are required" });
  }

  try {
    // 1) Load history
    const history = await getSessionHistory(sessionId);

    // 2) Append user
    history.push({ role: "user", content: userMessage });

    // 3) RAG
    const { answer, sources, cached } = await runRagQuery(userMessage);

    // 4) Append assistant
    history.push({ role: "assistant", content: answer });

    // 5) Save
    await saveSessionHistory(sessionId, history);

    res.json({
      sessionId,
      answer,
      history,
      sources,
      cached,
    });
  } catch (err) {
    console.error("❌ Error in /api/chat:", err);
    res.status(500).json({
      error: "Internal server error while processing chat.",
    });
  }
});

/**
 * GET /api/session/:id/history
 * Returns: { sessionId, history }
 */
app.get("/api/session/:id/history", async (req, res) => {
  try {
    const sessionId = req.params.id;
    const history = await getSessionHistory(sessionId);
    res.json({ sessionId, history });
  } catch (err) {
    console.error("❌ Error in /api/session/:id/history:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/session/:id/clear
 * Clears that session's history
 */
app.post("/api/session/:id/clear", async (req, res) => {
  try {
    const sessionId = req.params.id;
    await clearSessionHistory(sessionId);
    res.json({ sessionId, cleared: true });
  } catch (err) {
    console.error("❌ Error in /api/session/:id/clear:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function start() {
  try {
    await initClients();
    app.listen(PORT, () => {
      console.log(`🚀 Backend listening on port ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to start backend:", err);
    process.exit(1);
  }
}

start();

export default app;
