// backend/src/redisClient.js
import { createClient } from "redis";

export let redisClient = null;

export async function initRedis() {
  const REDIS_HOST = process.env.REDIS_HOST || "redis";
  const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

  redisClient = createClient({
    url: `redis://${REDIS_HOST}:${REDIS_PORT}`,
  });

  redisClient.on("error", (err) => {
    console.error("Redis error:", err);
  });

  await redisClient.connect();
  console.log("✅ Redis connected");
}
