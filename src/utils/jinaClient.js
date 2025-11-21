import axios from "axios";
import { JINA_API_KEY } from "../config/env.js";

export async function embedTextWithJina(text, task = "retrieval.query") {
    if (!JINA_API_KEY) {
        throw new Error("JINA_API_KEY not configured");
    }

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
    if (!embedding) throw new Error("No embedding returned from Jina");
    return embedding;
}
