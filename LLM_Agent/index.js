import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { connect } from "../shared/connection.js";
import { Beliefs } from "../BDI_Agent/modules/beliefs.js";

import { LLMMemory } from "./modules/LLMMemory.js";
import { LLMExecutor } from "./modules/LLMExecutor.js";
import { LLMPlanner } from "./modules/LLMPlanner.js";
import { LLMReplanner } from "./modules/LLMReplanner.js";
import { LLMAgent } from "./modules/LLMAgent.js";
import { initClient } from "./callModel.js";
import { MSG } from "../shared/common_protocol.js";
import { TOOL_DESCRIPTIONS } from "./tools/tools_index.js";

/**
 * Starts the LLM Agent on the given socket.
 * @param {object} socket — connected Deliveroo socket
 * @param {{ baseURL: string, apiKey: string, model: string }} llmConfig
 * @returns {{ socket, llmAgent: LLMAgent, beliefs: Beliefs, memory: LLMMemory }}
 */
export function startLLMAgent(socket, llmConfig) {
    const beliefs = new Beliefs();

    // Initialise the shared LLM client
    initClient({
        baseURL: llmConfig.baseURL,
        apiKey: llmConfig.apiKey,
        model: llmConfig.model,
    });

    // Create components
    const memory = new LLMMemory(beliefs);
    const executor = new LLMExecutor(socket, beliefs);
    const replanner = new LLMReplanner();
    const planner = new LLMPlanner({ maxIterations: 30 });
    const llmAgent = new LLMAgent({ memory, planner, executor, replanner });

    // Wire back-reference so executor can read partner intentions
    executor.setAgent(llmAgent);

    // Validate tools_index ↔ executor sync
    const declared = Object.keys(TOOL_DESCRIPTIONS);
    const implemented = Object.keys(executor.TOOLS);
    const missing = declared.filter(t => !implemented.includes(t));
    const undocumented = implemented.filter(t => !declared.includes(t));
    if (missing.length) console.warn(`[LLM] Tools in tools_index but NOT implemented: ${missing.join(", ")}`);
    if (undocumented.length) console.warn(`[LLM] Tools implemented but NOT in tools_index: ${undocumented.join(", ")}`);

    let defaultObjectiveSet = false;

    // Change detection for emitSay (avoid chat spam)
    let _lastParcelFP = "";

    // Event Listeners
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

                // Share visible parcels with partner (only when changed)
                if (llmAgent.partnerId) {
                    const fp = sensing.parcels.map(p => p.id).sort().join(",");
                    if (fp !== _lastParcelFP) {
                        _lastParcelFP = fp;
                        try {
                            await socket.emitSay(llmAgent.partnerId, MSG.beliefUpdate(sensing.parcels));
                        } catch (e) { /* partner may not be connected yet */ }
                    }
                }
            }

            if (sensing.agents) beliefs.updateAgents(sensing.agents);
            if (sensing.crates) beliefs.updateCrates(sensing.crates);

            memory.updateWorld();

            // Set default autonomous objective as soon as the world is ready
            if (!defaultObjectiveSet && beliefs.mapWidth) {
                defaultObjectiveSet = true;
                console.log("[LLM] World ready → starting autonomous collection...");
                await llmAgent.setObjective(
                    "Continuously collect parcels and deliver them to delivery tiles to maximise your score. " +
                    "Pick the nearest high-reward parcel, pick it up, then go to the nearest delivery tile and put down. " +
                    "If no parcels are visible, patrol near spawn tiles to find new ones. " +
                    "If a partner agent (Agent A) is pursuing a parcel, avoid that parcel. Repeat forever."
                );
            } else {
                await llmAgent.step();
            }


        } catch (e) {
            console.error("[LLM] CRASH IN SENSING:", e);
        }
    });

    // Receive messages — NL objectives + team protocol
    socket.on("msg", async (fromId, fromName, msg) => {
        // Case 1: Plain string → NL objective from user / mission-agent
        if (typeof msg === "string") {
            console.log(`[LLM] NL instruction from ${fromName}: "${msg}"`);
            await llmAgent.setObjective(msg);
            return;
        }

        if (!msg || !msg.type) return;

        // Case 2: Structured protocol → only accept from our team partner
        if (fromId !== llmAgent.partnerId) return;

        if (msg.type === MSG.TYPES.BELIEF_UPDATE) {
            for (const p of msg.parcels) {
                if (!beliefs.parcelsMap.has(p.id) && !p.carriedBy) {
                    beliefs.parcelsMap.set(p.id, {
                        ...p,
                        lastSeen: Date.now(),
                        originalReward: p.reward,
                    });
                }
                memory.updateLLMMemory("parcel", p);
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

// Standalone mode
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