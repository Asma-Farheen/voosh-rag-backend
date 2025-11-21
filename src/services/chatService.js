import { getSessionHistory, saveSessionHistory, clearSessionHistory } from "../sessionStore.js";
import { runRagQuery } from "./ragService.js";
import { SESSION_TTL } from "../config/env.js";

export async function processChat(sessionId, userMessage) {
    const history = (await getSessionHistory(sessionId)) || [];
    history.push({ role: "user", content: userMessage });

    const { answer, sources, cached } = await runRagQuery(userMessage);

    history.push({ role: "assistant", content: answer });

    await saveSessionHistory(sessionId, history, SESSION_TTL);

    return { sessionId, answer, history, sources, cached };
}

export async function getHistory(sessionId) {
    return (await getSessionHistory(sessionId)) || [];
}

export async function clearHistory(sessionId) {
    await clearSessionHistory(sessionId);
    return { sessionId, cleared: true };
}
