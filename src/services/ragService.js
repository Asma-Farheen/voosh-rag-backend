import { redisClient } from "../redisClient.js";
import { CACHE_TTL_SECONDS } from "../config/env.js";
import { embedTextWithJina } from "../utils/jinaClient.js";
import { searchQdrant } from "../utils/qdrantClient.js";
import { generateAnswerWithGemini } from "../utils/geminiClient.js";

// Simple cache via redis
export async function getCached(query) {
    if (!redisClient || !redisClient.isOpen) return null;
    const key = `rag:news:${query.trim().toLowerCase()}`;
    const raw = await redisClient.get(key);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export async function setCached(query, data) {
    if (!redisClient || !redisClient.isOpen) return;
    const key = `rag:news:${query.trim().toLowerCase()}`;
    await redisClient.setEx(key, CACHE_TTL_SECONDS, JSON.stringify(data));
}

function buildContextFromPoints(points) {
    if (!points || points.length === 0) return "No relevant articles found.";

    return points
        .map((pt, idx) => {
            const p = pt.payload || {};
            const title = p.title || p.headline || `Article ${idx + 1}`;
            const text = p.text || p.content || p.body || JSON.stringify(p, null, 2);
            return `### ${title}\n${text}`;
        })
        .join("\n\n---\n\n");
}

// Core RAG flow
export async function runRagQuery(query) {
    const cached = await getCached(query);
    if (cached) return { ...cached, cached: true };

    const vector = await embedTextWithJina(query, "retrieval.query");
    const points = await searchQdrant(vector, 5);
    const context = buildContextFromPoints(points);
    const answer = await generateAnswerWithGemini(query, context);

    const sources = points.map((pt) => ({
        id: pt.id,
        score: pt.score,
        payload: pt.payload,
    }));

    const payload = { answer, sources, cached: false };
    await setCached(query, payload);
    return payload;
}
