import { QdrantClient } from "@qdrant/js-client-rest";
import { QDRANT_URL, QDRANT_COLLECTION } from "../config/env.js";

let qdrant = null;

export function initQdrant() {
    qdrant = new QdrantClient({
        url: QDRANT_URL.replace(/\/+$/, ""), // ensure no trailing slash
    });
    return qdrant;
}

export function getQdrantClient() {
    return qdrant;
}

export async function searchQdrant(vector, limit = 5) {
    if (!qdrant) {
        throw new Error("Qdrant client not initialized");
    }

    // Qdrant js-client exposes search; the exact signature can vary with versions.
    const result = await qdrant.search(QDRANT_COLLECTION, {
        vector,
        limit,
        with_payload: true,
        with_vectors: false,
    });
    return result;
}
