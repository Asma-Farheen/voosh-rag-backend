import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_API_KEY, GEMINI_MODEL } from "../config/env.js";

let answerModel = null;

export function initGemini() {
    if (GEMINI_API_KEY) {
        try {
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            answerModel = genAI.getGenerativeModel({ model: GEMINI_MODEL });
        } catch (err) {
            console.warn("Could not initialize Gemini model:", err?.message || err);
            answerModel = null;
        }
    }
    return answerModel;
}

export function getGeminiModel() {
    return answerModel;
}

export async function generateAnswerWithGemini(query, context) {
    if (!answerModel) {
        // fallback: return a short "not available" answer so UI doesn't hang
        return "Sorry — the LLM model is not configured on this machine.";
    }

    const prompt = `
You are a news chatbot using Retrieval-Augmented Generation.

Use ONLY the context below to answer the user's question. 
If the answer is not clearly in the context, say you are not sure.

Context:
${context}

User question: ${query}

Answer in 3–6 concise sentences, neutral and factual.
`;

    const result = await answerModel.generateContent({
        contents: [
            {
                role: "user",
                parts: [{ text: prompt }],
            },
        ],
    });

    // result.response.text() works with earlier client; handle gracefully
    try {
        return result.response.text();
    } catch {
        return String(result?.response || result);
    }
}
