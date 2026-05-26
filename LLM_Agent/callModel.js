/**
 * Shared LLM client wrapper — §7 of GUIDE-PART-2.
 * Wraps OpenAI-compatible API (LiteLLM / local / OpenAI) with error handling.
 */
import OpenAI from "openai";

let _client = null;
let _model = null;

/**
 * Initialises the shared OpenAI client.  Call once at startup.
 * @param {{ baseURL: string, apiKey: string, model: string }} cfg
 */
export function initClient({ baseURL, apiKey, model }) {
    _client = new OpenAI({
        baseURL,
        apiKey,
    });
    _model = model;
}

/**
 * Sends a chat-completion request and returns the assistant's text.
 * @param {Array<{role:string,content:string}>} messages
 * @param {{ temperature?: number }} options
 * @returns {Promise<string>}
 */
export async function callModel(messages, options = { temperature: 0 }) {
    if (!_client) throw new Error("callModel: client not initialised – call initClient() first");

    try {
        const response = await _client.chat.completions.create({
            model: _model || "gpt-4o",
            messages,
            ...options,
        });
        return response.choices[0]?.message?.content ?? "";
    } catch (error) {
        console.error("LLM API Error:", error.message);
        return "Error: Unable to process request.";
    }
}
