import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { connect } from "../BDI_Agent/deliveroo/connection.js";
import { Beliefs } from "../BDI_Agent/bdi/beliefs.js";

import { LLMMemory } from "./LLMMemory.js";
import { LLMExecutor } from "./LLMExecutor.js";
import { LLMPlanner } from "./LLMPlanner.js";
import { LLMReplanner } from "./LLMReplanner.js";
import { LLMAgent } from "./LLMAgent.js";
import { MSG } from "../shared/common_protocol.js";

/**
 * Starts the LLM Agent on the given socket.
 * @param {object} socket — connected Deliveroo socket
 * @param {{ baseURL: string, apiKey: string, model: string }} llmConfig
 * @returns {{ socket, llmAgent: LLMAgent, beliefs: Beliefs, memory: LLMMemory }}
 */
export function startLLMAgent(socket, llmConfig) {
    const beliefs = new Beliefs();

    const memory = new LLMMemory(beliefs);
    const executor = new LLMExecutor(socket, beliefs);
    const replanner = new LLMReplanner();
    const planner = new LLMPlanner({
        baseURL: llmConfig.baseURL,
        apiKey: llmConfig.apiKey,
        model: llmConfig.model,
    });
    const llmAgent = new LLMAgent({ memory, planner, executor, replanner });

    let objectiveSet = false;

    // ─── Event Listeners ─────────────────────────────────
    socket.on("config", (config) => beliefs.updateConfig(config));
    socket.on("map", (width, height, tiles) => beliefs.updateMap(width, height, tiles));
    socket.on("you", (me) => beliefs.updateMe(me));

    socket.on("sensing", async (sensing) => {
        try {
            if (sensing.parcels) {
                beliefs.updateParcels(sensing.parcels);

                if (beliefs.me.id) {
                    const carried = sensing.parcels.filter(p => p.carriedBy === beliefs.me.id);
                    beliefs.me.carrying = carried.length;
                    beliefs.carriedParcels = carried.map(p => p.id);
                }

                // Share visible parcels with partner
                if (llmAgent.partnerId) {
                    try {
                        await socket.emitSay(llmAgent.partnerId, MSG.beliefUpdate(sensing.parcels));
                    } catch (e) { /* partner may not be connected yet */ }
                }
            }

            if (sensing.agents) beliefs.updateAgents(sensing.agents);

            memory.updateWorld();

            // Set objective once when parcels are first seen
            if (!objectiveSet && beliefs.parcels.length > 0) {
                console.log("[LLM] World ready → setting objective...");
                await llmAgent.setObjective("Collect the nearest parcel and deliver it");
                objectiveSet = true;
            }

            await llmAgent.step();

            // Broadcast current intention to partner
            if (llmAgent.partnerId && llmAgent.currentObjective) {
                try {
                    // LLM doesn't track individual parcel targets like BDI does,
                    // so we send intent based on plan existence
                    await socket.emitSay(llmAgent.partnerId, MSG.intentionClear());
                } catch (e) { /* ignore */ }
            }
        } catch (e) {
            console.error("[LLM] CRASH IN SENSING:", e);
        }
    });

    // ─── Receive messages from partner ───────────────────
    socket.on("msg", (fromId, fromName, msg) => {
        if (!msg || !msg.type) return;

        if (msg.type === MSG.TYPES.BELIEF_UPDATE) {
            for (const p of msg.parcels) {
                if (!beliefs.parcelsMap.has(p.id) && !p.carriedBy) {
                    beliefs.parcelsMap.set(p.id, {
                        ...p,
                        lastSeen: Date.now(),
                        originalReward: p.reward,
                    });
                }
            }
        } else if (msg.type === MSG.TYPES.INTENTION_COMMIT) {
            llmAgent.partnerIntentions.clear();
            if (msg.parcelId) llmAgent.partnerIntentions.add(msg.parcelId);
        } else if (msg.type === MSG.TYPES.INTENTION_CLEAR) {
            llmAgent.partnerIntentions.clear();
        }
    });

    socket.on("connect", () => console.log("[LLM] Connected to server"));
    socket.on("connect_error", (err) => console.log("[LLM] Connection error:", err.message));

    return { socket, llmAgent, beliefs, memory };
}

// ─── Standalone mode ─────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
    dotenv.config();
    const socket = connect();
    startLLMAgent(socket, {
        baseURL: process.env.LITELLM_BASE_URL,
        apiKey: process.env.LITELLM_API_KEY,
        model: process.env.LOCAL_MODEL,
    });
}