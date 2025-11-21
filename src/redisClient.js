// backend/src/redisClient.js
import { createClient } from "redis";

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = process.env.REDIS_PORT || 6379;

// Prefer full URL when provided by host (Railway/Render)
const REDIS_URL = process.env.REDIS_URL || `redis://${REDIS_HOST}:${REDIS_PORT}`;

export const redisClient = createClient({ url: REDIS_URL });

// Helper used by server.js to initialize connection
export async function initRedis() {
  if (redisClient.isOpen) return;
  redisClient.on("error", (err) => {
    console.error("Redis error:", err);
  });
  await redisClient.connect();
  console.log("✅ Redis connected");
}
